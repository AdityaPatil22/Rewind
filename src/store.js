// rewind storage layer: blobs, version manifests, state, ignores, folder walks.
// ponytail: no locking — a single rewind process at a time is assumed.
// ponytail: blobs stored raw (no compression) — swap in zlib if disk ever hurts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BUILTIN_IGNORES = ['.rewind', '.DS_Store', '*.swp', '*~', '.Spotlight-V100', '.Trashes'];

export function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.rewind'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function atomicWrite(p, data) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, p);
}

// ---- state ----

export function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.rewind', 'state.json'), 'utf8'));
}

export function writeState(root, s) {
  atomicWrite(path.join(root, '.rewind', 'state.json'), JSON.stringify(s, null, 2) + '\n');
}

// ---- versions ----

export function parseRef(ref) {
  const m = /^v?(\d+)$/i.exec(String(ref));
  if (!m) throw new Error(`can't parse version '${ref}' — use v42 or 42`);
  return Number(m[1]);
}

export function readVersion(root, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.rewind', 'versions', `v${id}.json`), 'utf8'));
  } catch {
    throw new Error(`no such version: v${id}`);
  }
}

export function writeVersion(root, v) {
  atomicWrite(path.join(root, '.rewind', 'versions', `v${v.id}.json`), JSON.stringify(v, null, 2) + '\n');
}

export function listVersions(root) {
  const dir = path.join(root, '.rewind', 'versions');
  return fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// ---- blobs ----

export function hashBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function writeBlobs(root, files) {
  for (const [rel, hash] of Object.entries(files)) {
    const p = path.join(root, '.rewind', 'blobs', hash);
    if (fs.existsSync(p)) continue; // dedup: identical content stored once
    atomicWrite(p, fs.readFileSync(path.join(root, ...rel.split('/'))));
  }
}

export function readBlob(root, hash) {
  try {
    return fs.readFileSync(path.join(root, '.rewind', 'blobs', hash));
  } catch {
    throw new Error(`blob ${hash.slice(0, 12)} missing — store is corrupt`);
  }
}

// ---- ignores (gitignore-ish subset: names, * / ? globs, dir/ patterns) ----

export function loadIgnores(root) {
  const p = path.join(root, '.rewindignore');
  const extra = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n') : [];
  return [...BUILTIN_IGNORES, ...extra.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))];
}

function globToRe(pat) {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') { i++; re += '.*'; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function isIgnored(rel, isDir, patterns) {
  const base = path.posix.basename(rel);
  return patterns.some((pat) => {
    if (pat.endsWith('/')) return isDir && globToRe(pat.slice(0, -1)).test(base);
    const re = globToRe(pat);
    return re.test(rel) || re.test(base);
  });
}

// ---- folder walks ----
// ponytail: symlinks are deliberately untracked (loops, outside-the-tree targets).

export function walkFiles(root, patterns, dir = root, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (isIgnored(rel, e.isDirectory(), patterns)) continue; // ignored dir → whole subtree skipped
    if (e.isDirectory()) walkFiles(root, patterns, abs, acc);
    else if (e.isFile()) acc.push(rel);
  }
  return acc;
}

export function hashFolder(root) {
  const patterns = loadIgnores(root);
  const files = {};
  for (const rel of walkFiles(root, patterns)) {
    files[rel] = hashBytes(fs.readFileSync(path.join(root, ...rel.split('/'))));
  }
  return files;
}

// Make the working folder become the manifest's photograph:
// restore manifest files, delete tracked-but-absent files, prune empty dirs.
// ponytail: ignored files (node_modules etc.) are left untouched by travel —
// they're outside history. Current ignore rules decide what "tracked" means,
// so changed .rewindignore rules across versions can leave stale ignored files.
export function restoreVersion(root, manifest) {
  for (const [rel, hash] of Object.entries(manifest)) {
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`bad path in version data: ${rel}`);
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    atomicWrite(abs, readBlob(root, hash));
  }
  const patterns = loadIgnores(root);
  for (const rel of walkFiles(root, patterns)) {
    if (!(rel in manifest)) fs.rmSync(path.join(root, ...rel.split('/')));
  }
  pruneEmptyDirs(root, root);
}

function pruneEmptyDirs(root, dir) {
  if (dir === path.join(root, '.rewind')) return false; // never touch state
  let hasContent = false;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!pruneEmptyDirs(root, abs)) hasContent = true; }
    else hasContent = true;
  }
  if (!hasContent && dir !== root) { try { fs.rmdirSync(dir); } catch { /* not empty after all */ } }
  return hasContent;
}
