// rewind commands. Each prints its own output; bin/rewind.js dispatches and
// turns thrown Errors into `rewind: <message>` + exit 1.
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';

const fmtTime = (ts) => new Date(ts).toLocaleString();

export function requireRoot() {
  const root = store.findRoot(process.cwd());
  if (!root) throw new Error('not a rewind folder — run `rewind init` first');
  return root;
}

export function init(cwd) {
  const existing = store.findRoot(cwd);
  if (existing) throw new Error(`already inside a rewind folder (${existing})`);
  const root = path.resolve(cwd);
  fs.mkdirSync(path.join(root, '.rewind', 'blobs'), { recursive: true });
  fs.mkdirSync(path.join(root, '.rewind', 'versions'), { recursive: true });
  store.writeState(root, { head: null, tips: {}, nextVersionId: 1, nextTimelineId: 1 });
  console.log(`tracking ${root} — save something with: rewind save "first save"`);
}

function sameMap(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

function isDirty(root) {
  const state = store.readState(root);
  if (!state.head) return false;
  const head = store.readVersion(root, state.head.version);
  return !sameMap(store.hashFolder(root), head.files);
}

// A save at the tip of its timeline continues that timeline;
// a save anywhere else forks a new one. That rule is the whole branch model.
export function save(root, msg, opts = {}) {
  let state = store.readState(root);
  const files = store.hashFolder(root);
  if (state.head && !opts.auto) {
    const head = store.readVersion(root, state.head.version);
    if (sameMap(files, head.files)) throw new Error(`nothing to save — folder matches v${head.id}`);
  }
  let timeline, forkedFrom = null;
  if (!state.head) timeline = `t${state.nextTimelineId++}`;
  else if (state.head.version === state.tips[state.head.timeline]) timeline = state.head.timeline;
  else { forkedFrom = state.head.timeline; timeline = `t${state.nextTimelineId++}`; }
  const v = {
    id: state.nextVersionId++,
    ts: Date.now(),
    msg: msg || '(no message)',
    auto: !!opts.auto,
    timeline,
    parent: state.head ? state.head.version : null,
    files,
  };
  store.writeBlobs(root, files);
  store.writeVersion(root, v);
  state.tips[timeline] = v.id;
  state.head = { timeline, version: v.id };
  store.writeState(root, state);
  if (opts.auto) console.log(`auto-saved v${v.id} on ${timeline}`);
  else if (forkedFrom) console.log(`saved v${v.id} on ${timeline} (forked from ${forkedFrom})`);
  else console.log(`saved v${v.id} on ${timeline}`);
  return v;
}

export function status(root) {
  const state = store.readState(root);
  if (!state.head) { console.log('tracking this folder — no versions yet. Save one: rewind save "message"'); return; }
  console.log(`on ${state.head.timeline} at v${state.head.version} · ${isDirty(root) ? 'unsaved changes — rewind save to keep them' : 'clean'}`);
}

export function log(root) {
  const state = store.readState(root);
  if (!state.head) { console.log('no versions yet — save one: rewind save "message"'); return; }
  const rows = [];
  let v = store.readVersion(root, state.head.version);
  while (v) {
    rows.push(`v${v.id} · ${fmtTime(v.ts)} · ${v.auto ? '(auto) ' : ''}${v.msg}`);
    v = v.parent == null ? null : store.readVersion(root, v.parent);
  }
  console.log(`${state.head.timeline}, newest first, standing at v${state.head.version}:\n${rows.join('\n')}`);
}

export function timelines(root) {
  const state = store.readState(root);
  const ids = Object.keys(state.tips);
  if (!ids.length) { console.log('no timelines yet — save one: rewind save "message"'); return; }
  const all = store.listVersions(root);
  const rows = ids
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((tl) => {
      const tip = store.readVersion(root, state.tips[tl]);
      const n = all.filter((v) => v.timeline === tl).length;
      const cur = state.head && state.head.timeline === tl ? '*' : ' ';
      return `${cur} ${tl} · ${n} save${n === 1 ? '' : 's'} · tip v${tip.id} · ${fmtTime(tip.ts)} · ${tip.auto ? '(auto) ' : ''}${tip.msg}`;
    });
  console.log(rows.join('\n'));
}

export function travel(root, ref) {
  let state = store.readState(root);
  if (!state.head) throw new Error('no versions yet — save first');
  const target = store.readVersion(root, store.parseRef(ref));
  if (isDirty(root)) save(root, '(auto before travel)', { auto: true }); // nothing is ever lost
  state = store.readState(root); // the auto-save may have forked
  store.restoreVersion(root, target.files);
  state.head = { timeline: target.timeline, version: target.id };
  store.writeState(root, state);
  console.log(`now at v${target.id} on ${target.timeline} · ${fmtTime(target.ts)} · ${target.auto ? '(auto) ' : ''}${target.msg}`);
}

export function back(root, arg = '1') {
  const state = store.readState(root);
  if (!state.head) throw new Error('no versions yet — save first');
  let v = store.readVersion(root, state.head.version);
  const rel = /^(\d+)([smhd])$/.exec(arg);
  if (rel) {
    const secs = { s: 1, m: 60, h: 3600, d: 86400 }[rel[2]] * Number(rel[1]);
    const cutoff = Date.now() - secs * 1000;
    while (v.ts > cutoff) {
      if (v.parent == null) throw new Error(`nothing as far back as ${arg}`);
      v = store.readVersion(root, v.parent);
    }
  } else if (/^\d+$/.test(arg)) {
    const steps = Number(arg);
    if (steps < 1) throw new Error('step count must be at least 1');
    for (let i = 0; i < steps; i++) {
      if (v.parent == null) throw new Error(i === 0 ? `v${v.id} is the first save — nothing before it` : `can't go back ${steps} from v${state.head.version} — only ${i} step${i === 1 ? '' : 's'} available`);
      v = store.readVersion(root, v.parent);
    }
  } else {
    throw new Error(`can't parse '${arg}' — use steps (back 3) or relative time (back 10m); to jump to a version use travel`);
  }
  travel(root, `v${v.id}`);
}

export function fwd(root, arg = '1') {
  if (!/^\d+$/.test(arg)) throw new Error(`can't parse '${arg}' — use a step count (fwd 2)`);
  const steps = Number(arg);
  if (steps < 1) throw new Error('step count must be at least 1');
  const state = store.readState(root);
  if (!state.head) throw new Error('no versions yet — save first');
  const chain = []; // oldest → tip of the current timeline
  for (let id = state.tips[state.head.timeline]; id != null;) {
    const v = store.readVersion(root, id);
    chain.unshift(v);
    if (id === state.head.version) break;
    id = v.parent;
  }
  const idx = chain.findIndex((v) => v.id === state.head.version);
  if (idx === -1) throw new Error('corrupt state: position is not on the current timeline');
  if (idx + steps >= chain.length) {
    const tip = chain[chain.length - 1];
    throw new Error(`at the tip of ${state.head.timeline} (v${tip.id}) — nothing forward; see rewind timelines`);
  }
  travel(root, `v${chain[idx + steps].id}`);
}

export function undo(root) { back(root, '1'); }
export function redo(root) { fwd(root, '1'); }

function diffMaps(oldF, newF) {
  const added = Object.keys(newF).filter((k) => !(k in oldF)).sort().map((k) => `+ ${k}`);
  const changed = Object.keys(newF).filter((k) => k in oldF && oldF[k] !== newF[k]).sort().map((k) => `~ ${k}`);
  const deleted = Object.keys(oldF).filter((k) => !(k in newF)).sort().map((k) => `- ${k}`);
  return [...added, ...changed, ...deleted];
}

export function diff(root, aRef, bRef) {
  const state = store.readState(root);
  let aFiles, bFiles, label;
  if (!aRef) {
    if (!state.head) throw new Error('no versions yet — save first');
    const head = store.readVersion(root, state.head.version);
    aFiles = head.files;
    bFiles = store.hashFolder(root);
    label = `v${head.id} → working folder`;
  } else {
    const a = store.readVersion(root, store.parseRef(aRef));
    const b = bRef ? store.readVersion(root, store.parseRef(bRef)) : (a.parent == null ? null : store.readVersion(root, a.parent));
    const older = bRef ? a : b; // diff vA → parent→vA; diff vA vB → vA→vB
    const newer = bRef ? b : a;
    aFiles = older ? older.files : {};
    bFiles = newer.files;
    label = older ? `v${older.id} → v${newer.id}` : `(empty) → v${newer.id}`;
  }
  const lines = diffMaps(aFiles, bFiles);
  console.log(`${label}\n${lines.length ? lines.join('\n') : '  no differences'}`);
}

export function history(root, file) {
  const rel = path.relative(root, path.resolve(process.cwd(), file)).split(path.sep).join('/');
  const all = store.listVersions(root);
  if (!all.length) throw new Error('no versions yet — save first');
  const byId = new Map(all.map((v) => [v.id, v]));
  const rows = [];
  for (const v of all) { // every timeline: history is a list of travel targets
    const parent = v.parent == null ? null : byId.get(v.parent);
    const now = v.files[rel], before = parent ? parent.files[rel] : undefined;
    if (now !== before) {
      const what = now === undefined ? 'deleted' : before === undefined ? 'added' : 'changed';
      rows.push(`v${v.id} · ${fmtTime(v.ts)} · ${what} · ${v.auto ? '(auto) ' : ''}${v.msg}`);
    }
  }
  if (!rows.length) console.log(`no history for ${rel}`);
  else console.log(rows.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).join('\n'));
}
