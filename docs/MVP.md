# Okay Karaoke Studio — MVP Definition

## Product promise

Okay Karaoke Studio is a desktop editor for turning a backing track and plain lyrics into precisely timed karaoke lyrics. It keeps the stage preview, lyric editor, timing board, project settings, and playback controls in **one unified window**.

This document is the release contract for version 0.1. Features that are not required below belong in [`ROADMAP.md`](./ROADMAP.md).

## Primary user journey

1. Create a project or open an existing `.oks` project.
2. Attach an audio backing track.
3. Paste lyrics or import an LRC file.
4. Press and hold Space with the singer to time each word.
5. Correct individual words by dragging and resizing them in the TimeBoard.
6. Preview the result continuously without opening another window.
7. Save the editable project and export LRC or ASS lyrics.

## Single-window layout invariant

The main window must always provide simultaneous access to:

- Project metadata and vocal-track controls.
- A live karaoke stage preview.
- The active track's lyric lines and word state.
- A scrollable waveform TimeBoard.
- Playback, seeking, speed, volume, zoom, and tap-sync controls.

Focused overlays are permitted for short, transactional tasks such as pasting raw lyrics or choosing an export format. The preview, editor, and transport must never become separate application windows.

## In scope

### Projects and media

- New, open, save, and save-as for versioned `.oks` JSON project files.
- Link MP3, WAV, M4A, FLAC, AAC, or OGG audio without copying it into the project.
- Display the decoded waveform when possible, with a deterministic placeholder before audio is attached.
- Song title, artist, global timing offset, audio path, and duration metadata.
- A useful demo project on first launch.

### Lyrics and vocal tracks

- One lead track and one optional duet track with independent names and colors.
- Paste or edit lyrics as lines of plain text.
- Treat `/` as a visible syllable boundary (`·`) while preserving the source token.
- Warn when a line is likely to exceed the title-safe preview width.
- Import line-timed or enhanced LRC into the active track.
- Clear timing without deleting lyrics.

### Synchronization and TimeBoard

- Tap-sync mode in which Space key-down sets a word start and key-up sets its end.
- Start or resume synchronization from the current playhead.
- A visible next-word cursor and timed/untimed progress.
- Click the ruler or waveform to seek.
- Drag timed words or a multi-word selection to move them.
- Drag word edges to change start or end times.
- Select words from the lyric list or TimeBoard.
- Keyboard delete for selected words' timing, Escape to exit sync, and undo/redo.
- Zoom and horizontal scrolling suitable for detailed timing correction.

### Preview and transport

- Progressive word highlighting driven by the same authoritative playback clock as the editor.
- Display both active voices during duet passages.
- Title card, instrumental state, upcoming line, safe-area guide, and current time.
- Play/pause, short skip backward/forward, playback speed, volume, playhead time, and duration.
- Demo-clock playback when no audio is attached so the workflow is immediately explorable.

### Save and export

- Save all lyric text, word timings, track styling, media linkage, and metadata in `.oks`.
- Export the active vocal track as LRC.
- Export the project as ASS with karaoke timing tags.
- Validate and report untimed, invalid, or overlapping timing before export.
- Browser fallbacks for open/download when the React surface is run outside Electron.

### Quality bar

- Electron desktop shell with a constrained preload bridge and no renderer Node access.
- Responsive down to a 1280 × 720 application window; optimized for larger desktop displays.
- Complete keyboard focus states, labels for icon-only actions, and adequate contrast.
- Unit tests for project parsing, lyric parsing, timing validation, and LRC/ASS round trips.
- Clean TypeScript build, production Vite build, and launchable unpacked desktop package.

## Explicitly out of scope for 0.1

- Automatic transcription or word alignment.
- Stem separation or vocal removal.
- MIDI/KAR playback and lead-vocal-note mapping.
- CDG authoring or MP3+G export.
- Video rendering or subtitle burn-in.
- Background image scheduling.
- Automatic linguistic hyphenation.
- Embedded audio, cloud sync, collaboration, show rotation, or a singer-facing second display.

## Release acceptance checklist

- [ ] A first-time user can complete the primary journey without leaving the main window.
- [ ] A saved project reopens with identical metadata, tracks, lyrics, and timings.
- [x] Space press/release produces a visible timed word and advances the sync cursor.
- [ ] Timeline movement and resize operations immediately affect the live preview.
- [x] LRC and ASS exports contain monotonic, non-negative timing.
- [x] Undo and redo cover lyric replacement and timing edits.
- [x] Unit tests and production build pass.
- [x] The unpacked desktop application launches on this Mac.
- [x] The final UI has been visually checked at desktop and minimum supported dimensions.

## Behavioral references

- [MidiCo Maker overview](https://www.midicokaraoke.com/user-guide/maker.php)
- [MidiCo synchronization workflow](https://www.midicokaraoke.com/user-guide/mk_syn.php)
- [MidiCo TimeBoard operations](https://www.midicokaraoke.com/user-guide/mk_tbo.php)
- [Karaoke Suite](https://github.com/jonesy827/karaoke-suite) for clean-room inspiration around local media and word-timing data
- [ChromaLyric](https://github.com/mattjoykaraoke/ChromaLyric) for clean-room inspiration around ASS styling and preview behavior

No source from the reference applications is copied into this project.
