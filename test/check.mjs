// The one runnable check — drives the real bin end to end, fails loudly.
// Run: npm run check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const bin = fileURLToPath(new URL('../bin/rewind.js', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-check-'));
const work = path.join(tmp, 'repo');
fs.mkdirSync(work);

const r = (...args) => execFileSync(process.execPath, [bin, ...args], { cwd: work, encoding: 'utf8' });
function rFail(...args) {
  let err = null;
  try { r(...args); } catch (e) { err = e; }
  assert.ok(err, `expected failure: rewind ${args.join(' ')}`);
  assert.equal(err.status, 1, `expected exit 1, stderr: ${err.stderr}`);
  return err.stderr;
}
const w = (p) => path.join(work, p);
const wr = (p, s) => fs.writeFileSync(w(p), s);
const rd = (p) => fs.readFileSync(w(p), 'utf8');
const ok = (m) => console.log('  ✓ ' + m);

try {
  r('init');
  assert.ok(fs.existsSync(w('.rewind/state.json')));
  ok('init creates .rewind state');

  wr('a.txt', 'one');
  r('save', 'first');
  assert.match(r('log'), /v1 · .*first/);
  ok('save creates v1 on t1');

  wr('a.txt', 'two');
  wr('b.txt', 'hi');
  r('save', 'second');
  ok('save v2');

  r('undo');
  assert.equal(rd('a.txt'), 'one');
  assert.ok(!fs.existsSync(w('b.txt')), 'b.txt should be gone at v1');
  ok('back 1 restores the working folder');

  wr('a.txt', 'one-point-five'); // change something in the past, then save
  assert.match(r('save', 'fork'), /saved v3 on t2 \(forked from t1\)/);
  const tls = r('timelines');
  assert.match(tls, /\* t2 /);
  assert.match(tls, /t1 · 2 saves · tip v2/);
  ok('saving in the past forks a new timeline');

  r('travel', 'v2');
  assert.equal(rd('a.txt'), 'two');
  assert.ok(fs.existsSync(w('b.txt')));
  r('undo');
  assert.equal(rd('a.txt'), 'one');
  r('fwd');
  assert.equal(rd('a.txt'), 'two');
  ok('travel v2, undo, fwd round-trip along t1');

  wr('c.txt', 'junk');
  r('back');
  assert.ok(!fs.existsSync(w('c.txt')), 'folder is the v1 photograph after travel');
  assert.match(r('timelines'), /t1 · 3 saves · tip v4/);
  ok('dirty travel at the tip auto-saves in place (v4 on t1)');

  r('travel', 'v1');
  wr('c.txt', 'junk2');
  r('travel', 'v2');
  assert.match(r('timelines'), /t3 · 1 save · tip v5/);
  ok('dirty travel mid-timeline auto-saves as a fork (v5 on t3)');

  r('travel', 'v5');
  assert.equal(rd('c.txt'), 'junk2');
  ok('auto-saved work is recoverable (travel v5)');

  const d = r('diff', 'v1', 'v2');
  assert.match(d, /\+ b\.txt/);
  assert.match(d, /~ a\.txt/);
  assert.match(r('diff'), /no differences/);
  wr('a.txt', 'three');
  assert.match(r('diff'), /~ a\.txt/);
  ok('diff: version-vs-version, clean folder, dirty folder');

  const h = r('history', 'a.txt');
  assert.match(h, /v2 · .*changed/);
  assert.match(h, /v1 · .*added/);
  ok('history lists per-file versions');

  wr('.rewindignore', '*.log\nnode_modules/\n');
  wr('x.log', 'noise');
  fs.mkdirSync(w('node_modules'));
  wr(path.join('node_modules', 'j.js'), 'x');
  const saved = /saved v(\d+)/.exec(r('save', 'ignores'))[1];
  const di = r('diff', `v${saved}`);
  assert.match(di, /\+ \.rewindignore/);
  assert.ok(!di.includes('x.log'), 'x.log must be ignored');
  assert.ok(!di.includes('node_modules'), 'node_modules must be ignored');
  ok('.rewindignore and built-ins are honored');

  assert.match(rFail('save', 'dupe'), /nothing to save/);
  assert.match(r(), /at v\d+ · (clean|unsaved changes)/);
  r('help');
  assert.match(rFail('travel', 'v99'), /no such version/);
  assert.match(rFail('back', '10m'), /nothing as far back/);
  assert.match(rFail('fwd', '99'), /tip/);
  ok('status, help, refusal and error paths behave');

  console.log('\nPASS — rewind core loop verified');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
