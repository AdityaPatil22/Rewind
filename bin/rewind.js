#!/usr/bin/env node
// rewind — dispatch. All logic lives in src/.
import * as core from '../src/core.js';

const USAGE = `rewind — a time machine for folders

usage: rewind <command> [args]

  init                  start tracking this folder
  save [message]        photograph the folder now (message optional, quotes optional)
  status                where you are, clean or dirty (default when no command given)
  log                   versions on your timeline, newest first, from where you stand
  timelines             all timelines (* = current)
  back [n | time]       go back n steps, or to a time: back 10m (s/m/h/d)
  fwd [n]               go forward n steps toward the timeline tip
  undo / redo           sugar for back 1 / fwd 1
  travel <version>      jump to an exact version: travel v42
  diff [vA [vB]]        what changed: working folder vs head, vA vs vB, or vA vs its parent
  history <file>        versions where this file changed

nothing is ever lost: unsaved changes are auto-saved before any travel,
and saving while in the past forks a new timeline automatically.
ignore junk with .rewindignore (gitignore-style).`;

const [cmd, ...rest] = process.argv.slice(2);

try {
  if (cmd === 'init') core.init(process.cwd());
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') console.log(USAGE);
  else if (!cmd || cmd === 'status') core.status(core.requireRoot());
  else {
    const root = core.requireRoot();
    if (cmd === 'save') core.save(root, rest.join(' '));
    else if (cmd === 'log') core.log(root);
    else if (cmd === 'timelines') core.timelines(root);
    else if (cmd === 'back') core.back(root, rest[0]);
    else if (cmd === 'fwd') core.fwd(root, rest[0]);
    else if (cmd === 'undo') core.undo(root);
    else if (cmd === 'redo') core.redo(root);
    else if (cmd === 'travel') {
      if (!rest[0]) throw new Error('travel needs a version — e.g. travel v42');
      core.travel(root, rest[0]);
    } else if (cmd === 'diff') core.diff(root, rest[0], rest[1]);
    else if (cmd === 'history') {
      if (!rest[0]) throw new Error('history needs a file — e.g. history notes.txt');
      core.history(root, rest[0]);
    } else {
      console.error(`unknown command: ${cmd}\n`);
      console.log(USAGE);
      process.exit(1);
    }
  }
} catch (e) {
  console.error(`rewind: ${e.message}`);
  process.exit(1);
}
