# Rewind

A time machine for folders.

`rewind` photographs your whole folder on every save, lets you travel back to any
moment, and forks a new timeline automatically whenever you change the past.
One promise: **nothing is ever lost**.

It is deliberately not a git clone. No staging area, no `add`, no named branches,
no merge conflicts to resolve. Just saves, and a timeline you travel.

```
$ rewind save "fixed the bug"
saved v3 on t1

$ rewind back 10m
auto-saved v4 on t1          # unsaved work was kept first
now at v2 on t1 · 2:31pm · before the refactor

$ echo "trying another approach" >> main.js
$ rewind save "other approach"
saved v5 on t2 (forked from t1)   # saving in the past forks a timeline
```

## Install

Requires Node 18+. From this repo:

```bash
npm link
```

That gives you a global `rewind` command.

## Quick start

```bash
cd my-folder
rewind init                # start tracking this folder
echo hello > note.txt
rewind save first          # photograph the folder
echo hello world > note.txt
rewind back                # go back one save — note.txt is "hello" again
rewind fwd                 # and forward — "hello world" is back
rewind log                 # see where you are
```

## Commands

| Command | What it does |
|---|---|
| `rewind init` | Start tracking the current folder (state lives in `.rewind/`) |
| `rewind save [message]` | Photograph the whole folder now — message optional, quotes optional |
| `rewind` (or `rewind status`) | Where you are, clean or dirty |
| `rewind log` | Versions on your timeline, newest first, from where you stand |
| `rewind timelines` | All timelines (`*` marks the current one) |
| `rewind back [n \| time]` | Back `n` steps, or to a time: `back 10m` (`s`/`m`/`h`/`d`) |
| `rewind fwd [n]` | Forward `n` steps toward the timeline tip |
| `rewind undo` / `rewind redo` | Sugar for `back 1` / `fwd 1` |
| `rewind travel v42` | Jump to an exact version |
| `rewind diff [vA [vB]]` | What changed: working folder vs head, `vA` vs `vB`, or `vA` vs its parent (file-level: `+` added, `~` changed, `-` deleted) |
| `rewind history <file>` | Every version where this file changed, across all timelines |

## How the model works

- **A save is a photograph of the whole folder.** Every file is stored
  content-addressed (SHA-256), so identical files are stored once — full
  snapshots stay cheap and there is nothing to stage or select.
- **Timelines are emergent.** Save at the tip of your timeline and it simply
  continues. Travel back, change something, save — and a new timeline forks
  automatically (`t2`, `t3`, ...). The future you left behind is never deleted;
  it stays listed in `rewind timelines` and reachable via `rewind travel`.
- **Travel never refuses and never discards.** If you have unsaved changes when
  you travel, they are silently kept as an `(auto)` version first. Auto-saves
  are marked in `log` and `timelines`.
- **`back` counts saves.** Unsaved work becomes an `(auto)` version only when a
  travel actually happens.
- **No merging.** Timelines can be listed and traveled freely; stitching them
  together is deliberately out of scope for v1.

## Ignoring files

`rewind` skips junk by default (`.DS_Store`, swap files, `.rewind/` itself).
Add a `.rewindignore` at the folder root for anything else, gitignore-style:

```
node_modules/
*.log
dist
```

Ignored files live outside history: they are never photographed and never
touched by travel.

## What's on disk

Everything is plain files inside `.rewind/` — no database, no compression:

```
.rewind/
  blobs/<sha256>        file contents, stored once each
  versions/v<n>.json    one manifest per save: message, time, parent, {path: hash}
  state.json            current position and timeline tips
```

Delete `.rewind/` and the folder is exactly a normal folder again.

## Not in v1

Line-level diffs, merging timelines, remotes, compression. The seams are there
(`diff` gains line output, timelines gain a merge) if any of it ever earns its
keep.

## Development

```bash
npm run check    # end-to-end check of the core loop: save, travel, fork, recover
```

Zero dependencies. `bin/rewind.js` dispatches, `src/core.js` holds the commands,
`src/store.js` holds the storage layer.
