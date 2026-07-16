# Okay Karaoke Studio

Okay Karaoke Studio is a single-window desktop application for editing and synchronizing karaoke lyrics. It combines a verification-focused stage preview, transactional lyric editor, waveform Lyric Timing editor, project inspector, and playback transport in one workspace.

![Status](https://img.shields.io/badge/status-MVP%20acceptance%20open-d7fa4a?labelColor=171e1b)
![Electron](https://img.shields.io/badge/Electron-desktop-58d6de?labelColor=171e1b)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-ff8064?labelColor=171e1b)

## MVP highlights

- Unified viewer, editor, timeline, inspector, and playback controls—no detached
  production windows. Armed synchronization replaces the stage with a
  lightweight current/next-line Sync Focus, then restores it for verification.
- Clean-slate startup with one empty lead-vocal track and no implicit example content.
- One lead-vocal authoring track for the active MVP; adding singer tracks is
  deferred.
- Low-latency Spacebar onset synchronization: each same-line onset closes the
  previous word, while holding the final word of a line extends it. Shift+Space
  controls playback.
- Live karaoke preview and MP4 output share a persisted 1-to-5 line count and
  Clear/Scroll advance mode, blank lyric rows separating sections, and the same
  per-word timing and purple/orange production palette. Per-word color is the
  lyric progress signal; stage lyric lines do not repeat the singer or track
  name, and section gaps do not inject an automatic Instrumental graphic.
- Draggable, resizable word blocks on a common chronological baseline, readable
  staggered label lanes, range selection, and timing controls on a zoomable
  waveform Lyric Timing editor. Timing edits cannot cross the preceding or following
  timed word in lyric order, including across line boundaries.
- Live Preview's single **Edit text** action opens raw lyric editing with
  syllable separators, preserved blank-row section breaks, and screen-fit
  guidance; Lyric Timing does not duplicate it, and no Word Map is persistently
  rendered in the main workspace.
- LRC import, enhanced LRC and ASS export, configurable 240p-through-2160p MP4
  karaoke rendering at 30 or 60 fps, and current v0 `.oks` projects.
- Native open/save/import/export dialogs with secure linked-media streaming.
- Command history, timing review, hover help, playback Stop, and browser fallback.

The version 0.1 product-acceptance gate remains open until the user makes and
accepts a karaoke video for a new song with the Studio. Supporting criteria can
change when that real workflow exposes a blocker, while every iteration must
leave `main` technically green and releasable. The active contract is in
[`docs/MVP.md`](docs/MVP.md); deliberately deferred ideas are in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

Changes follow the lightweight, green-`main` workflow in
[`docs/SDLC.md`](docs/SDLC.md). Contribution setup and verification expectations
are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Run locally

Requirements: Node.js 24 LTS or newer and Bun 1.3.14 or newer. The exact Bun
version used for the lockfile is pinned in `package.json`.

MP4 export additionally requires FFmpeg with the `libx264` and AAC encoders. The
desktop app checks this before asking for an export destination. If FFmpeg is
missing, it can install the Gyan FFmpeg package through an existing WinGet on
Windows or the `ffmpeg` formula through an existing Homebrew on macOS, after
explicit confirmation. It never installs Homebrew, runs Linux package managers,
or bundles the FFmpeg command-line encoder. Manual and system installations remain
supported; set `OKAY_KARAOKE_FFMPEG` to use a specific executable. Video rendering
is currently limited to 30 minutes and the active lead-vocal track.

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run dev` opens the Electron app and starts its Vite renderer. Bun manages
dependencies and launches scripts; Electron, Vite, Vitest, and TypeScript retain
their existing runtimes and responsibilities. For renderer-only work:

```bash
bun run dev:web
```

## Build and test

```bash
bun run test
bun run build
bun run dist:dir
# Requires Electron, FFmpeg, and FFprobe:
bun run test:video
```

- `bun run test` runs strict current-schema coverage, synchronization
  semantics/history, preview/video display planning, validation, LRC, ASS, and
  renderer tests through Vitest.
- `bun run build` performs a strict TypeScript check and production renderer build.
- `bun run dist:dir` creates an unpacked desktop application in `release/`.
- `bun run dist` creates distributable macOS artifacts. Public distribution still requires signing and notarization credentials.
- `bun run test:video` performs the gated end-to-end H.264/AAC render and stream inspection.

## Editing workflow

1. Launch into the clean-slate project, choose **New Project** for another clean
   slate, or open an existing `.oks` project.
2. Choose **Attach an audio file** and select the backing track.
3. Choose **Edit text** in Live Preview to paste one lyric line per row,
   retaining blank rows between lyrical sections, or import an LRC into the
   active track. Applying the dialog replaces the active track's text;
   cancelling leaves it unchanged.
4. In Live Preview, choose 1 through 5 visible lyric lines and either **Clear**
   or **Scroll** advance behavior. These project settings also govern MP4 output.
5. Choose **Style** beside the application identity to edit Project lyrics, the
   project Background, the independent Title card roles, or the Stage frame's
   master visibility and independent Brand, Clock, and Footer roles in the same
   window. Background supports editable Solid and Gradient colors; linked Image
   settings remain preserved but are not yet authorable or Preview/MP4-ready
   here. Changes appear in the fixed 16:9 Design preview. Choose **Apply & close**
   to create one undoable project edit, or **Cancel** to leave the project unchanged.
6. Move the playhead to the desired start and choose **Start Sync** in the
   Lyric Timing editor. Live Preview is suspended and a lightweight Sync Focus shows the
   current and next lyric lines in cursor order.
7. Press Space at each word onset. A new onset on the same line backfills the
   preceding word's end; hold the final word of a line until its sung end. The
   resulting timing remains bounded by the preceding and following timed words
   in lyric order, even across line boundaries. The authoritative playback
   clock supplies timestamps, and taps before lyric time `0:00` are ignored.
   Press Escape to finish the synchronization session and restore Live Preview.
8. Verify timing in Live Preview, then select words in Lyric Timing.
   Command/Ctrl+A selects the active track outside text fields; dragging across
   empty Lyric Timing space creates a marquee selection. Drag blocks to move timing
   and drag either edge to resize; moves and resizes stop at the adjacent timed
   words in lyric order, including across line boundaries. A synchronization
   session is one undoable history step; individual Lyric Timing corrections remain
   undoable edits.
9. Use Lyric Timing's **Clear Timing** or **Clear Timing After Cursor** controls
   when resynchronizing. Use transport **Stop** to pause and return to `0:00`.
10. Review the timing status, save the current v0 `.oks` project, and export LRC,
   ASS, or an MP4 karaoke video. Video export requires attached audio and offers
   240p (426 x 240), 360p (640 x 360), 480p (854 x 480), 720p (1280 x 720),
   1080p (1920 x 1080), 1440p (2560 x 1440), and 2160p (3840 x 2160), each at
   30 or 60 fps. It defaults to 720p at 30 fps for faster iteration. Closing the
   export dialog, closing the application, quitting, or choosing Cancel during an
   active export asks for confirmation; a confirmed cancellation preserves a
   UUID-named partial file beside the destination. This clean-slate build accepts
   only the current v0 project format with numeric `schemaVersion: 0`; this build
   provides no compatibility or migration path for any other `.oks` format.

## Keyboard controls

| Key | Action |
|---|---|
| Space | Key-down starts the current word; the next same-line onset closes the preceding word, and key-up extends the final word of a line. Ignored before lyric time `0:00`; never controls playback |
| Shift + Space | Play/pause |
| Escape | Exit Tap Sync and restore Live Preview |
| Left / Right | Nudge playhead by 250 ms |
| Shift + Left / Right | Nudge playhead by 1 second |
| Delete / Backspace | Clear timing from selected words |
| Command/Ctrl + A | Select every word in the active track when not editing text |
| Command/Ctrl + Z | Undo |
| Shift + Command/Ctrl + Z | Redo |
| Command/Ctrl + S | Save project |
| Command/Ctrl + O | Open project |

## Project structure

```text
electron/              Secure Electron main process and preload bridge
src/
  components/          Unified workspace panels, dialogs, and transport
  hooks/               Audio playback and waveform decoding
  lib/                 Project model, strict schema, validation, LRC, and ASS
  App.tsx               Application state, commands, sync, and file workflows
tests/                  Pure model and interchange tests
docs/MVP.md             Active version 0.1 product-acceptance contract
docs/ROADMAP.md         Prioritized future capabilities and product boundaries
docs/SDLC.md            Pull-request, verification, ruleset, and release policy
```

The canonical current v0 model stores integer-millisecond word timings, blank-row
section separators, stage/vocal styles, and shared Live Preview/MP4
lyric-display settings inside the project. Any other project format is rejected
by this build. Compatibility or migration requires an intentional future product
promise. The active MVP authors one lead track; adding new singer tracks remains
deferred. The renderer does not receive Node.js access. Electron
exposes a small typed bridge for project dialogs, audio import,
project-authorized audio restoration, text/video export, and menu commands.
Linked audio is streamed through an owner-scoped, tokenized read-only custom
protocol with byte-range support. MP4 export renders the same line-selection
plan and per-word timing as Live Preview in an isolated offscreen Electron
surface. It renders target-resolution, selected-rate unique frames, waits for
each requested compositor paint, streams backpressured JPEGs into a shell-free
FFmpeg process, and uses a faster `libx264` preset for H.264/AAC encoding.
Ordinary failures leave the chosen destination safe. Confirmed cancellation
terminates the encoder and preserves any partial output under a UUID-based
filename beside that destination.

## License

MIT. See [`LICENSE`](LICENSE).
