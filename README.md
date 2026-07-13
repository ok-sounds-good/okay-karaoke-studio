# Okay Karaoke Studio

Okay Karaoke Studio is a single-window desktop application for editing and synchronizing karaoke lyrics. It combines a live stage preview, line-and-word editor, waveform TimeBoard, project inspector, and playback transport in one workspace.

![Status](https://img.shields.io/badge/status-MVP-d7fa4a?labelColor=171e1b)
![Electron](https://img.shields.io/badge/Electron-desktop-58d6de?labelColor=171e1b)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-ff8064?labelColor=171e1b)

## MVP highlights

- Unified viewer, editor, timeline, inspector, and playback controls—no detached production windows.
- One lead vocal plus an optional independently timed duet track.
- Spacebar press/release word synchronization with an obvious next-word cursor.
- Live karaoke preview with word-progress highlighting and simultaneous duet lines.
- Draggable, resizable word blocks on a zoomable waveform TimeBoard.
- Raw lyric editing with syllable separators and screen-fit guidance.
- LRC import, enhanced LRC and ASS export, 1080p MP4 karaoke rendering, and versioned `.oks` projects.
- Native open/save/import/export dialogs with secure linked-media streaming.
- Command history, timing review, browser fallback, and a ready-to-explore demo project.

The exact version 0.1 contract is in [`docs/MVP.md`](docs/MVP.md). Additional ideas are deliberately separated into [`docs/ROADMAP.md`](docs/ROADMAP.md).

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
is currently limited to 30 minutes and the MVP's two vocal tracks.

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

- `bun run test` runs the project-model, migration, validation, LRC, ASS, and renderer tests through Vitest.
- `bun run build` performs a strict TypeScript check and production renderer build.
- `bun run dist:dir` creates an unpacked desktop application in `release/`.
- `bun run dist` creates distributable macOS artifacts. Public distribution still requires signing and notarization credentials.
- `bun run test:video` performs the gated end-to-end 1080p H.264/AAC render and stream inspection.

## Editing workflow

1. Open the bundled demo or create a new project.
2. Choose **Attach an audio file** and select the backing track.
3. Choose **Edit text** to paste one lyric line per row, or import an LRC into the active track.
4. Move the playhead to the desired start and choose **Tap sync**.
5. Hold Space while each word is sung; release it at the word end. Press Escape to leave sync mode.
6. Select words in the lyric map or TimeBoard. Drag blocks to move timing and drag either edge to resize.
7. Add a duet track when needed and synchronize it independently.
8. Review the timing status, save the `.oks` project, and export LRC, ASS, or a 1080p MP4 karaoke video. Video export requires attached audio.

## Keyboard controls

| Key | Action |
|---|---|
| Space | Play/pause, or press/release the current word in Tap Sync |
| Escape | Exit Tap Sync |
| Left / Right | Nudge playhead by 250 ms |
| Shift + Left / Right | Nudge playhead by 1 second |
| Delete / Backspace | Clear timing from selected words |
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
  lib/                 Project model, migration, validation, LRC, and ASS
  App.tsx               Application state, commands, sync, and file workflows
tests/                  Pure model and interchange tests
docs/MVP.md             Version 0.1 release contract
docs/ROADMAP.md         Prioritized post-MVP capabilities and product boundaries
docs/SDLC.md            Pull-request, verification, ruleset, and release policy
```

The canonical model stores integer-millisecond word timings inside lines and vocal tracks. The renderer does not receive Node.js access. Electron exposes a small typed bridge for project dialogs, audio import, project-authorized audio restoration, text/video export, and menu commands. Linked audio is streamed through an owner-scoped, tokenized read-only custom protocol with byte-range support. MP4 export renders the stage in an isolated offscreen Electron surface and streams backpressured PNG frames directly into a shell-free FFmpeg process for H.264/AAC encoding. Cancellation terminates the encoder and removes its partial output before close or quit continues.

## Reference boundaries

The product workflow was researched from [MidiCo Maker](https://www.midicokaraoke.com/user-guide/maker.php), [Karaoke Suite](https://github.com/jonesy827/karaoke-suite), and [ChromaLyric](https://github.com/mattjoykaraoke/ChromaLyric). This implementation is clean-room and does not copy their source. Karaoke Suite is AGPL-3.0; ChromaLyric identifies itself as proprietary. Their code is not a dependency of this project.

## License

MIT. See [`LICENSE`](LICENSE).
