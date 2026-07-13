# Okay Karaoke Studio — MVP Definition

## Product promise

Okay Karaoke Studio is a desktop editor for turning a backing track and plain
lyrics into precisely timed karaoke lyrics on one lead-vocal authoring track.
Project settings, lyric editing, the TimeBoard, stage verification, and playback
stay in **one unified window**, with a focused low-latency surface replacing the
stage while synchronization is armed.

This document is the active product-acceptance contract for version 0.1. The
supporting criteria below may change as real editing work exposes blockers;
capabilities that are deliberately deferred belong in
[`ROADMAP.md`](./ROADMAP.md).

## Acceptance status and scope control

- **Product acceptance: open.** The user holds the gate until they can use the
  Studio to make a karaoke video for a new song.
- **Passing evidence:** the user completes that real-song workflow in the Studio
  and accepts the resulting video. A synthetic fixture, demo project, automated
  export, or maintainer walkthrough cannot close the gate on the user's behalf.
- **Flexible supporting scope:** features and codified behaviors may be added,
  removed, or revised when the attempt identifies a blocker or shows that a
  criterion does not serve the primary gate. Record the observation and the
  resulting contract change so the decision remains auditable.
- **Technical baseline:** every iteration must leave `main` green and releasable.
  Passing CI or producing a package is required engineering evidence, but is not
  equivalent to product acceptance.

## Primary user journey

1. Launch into a clean-slate project, or open an existing `.oks` project.
2. Attach an audio backing track.
3. Open **Edit text** to paste lyrics, preserving internal blank rows as section
   separators, or import an LRC file.
4. Press Space at each word onset. Each same-line onset closes the preceding
   word; hold Space on the final word of a line to extend its duration. The
   resulting timing cannot cross the preceding or following timed word in lyric
   order, including across line boundaries.
5. Correct individual words by dragging and resizing them in the TimeBoard;
   edits stop at those same lyric-order boundaries.
6. Exit synchronization and verify the result in the restored Live Preview,
   choosing its line count and Clear or Scroll advance behavior as needed.
7. Save the editable project and export LRC, ASS, or a finished MP4 karaoke video.

## Single-window layout invariant

The main window must provide access to:

- Project metadata and lead-track controls.
- An **Edit text** action that opens the transactional lyric editor; the main
  workspace does not persistently render a Word Map or lyric list.
- A scrollable waveform TimeBoard.
- Playback, seeking, speed, volume, zoom, and tap-sync controls.
- A live karaoke stage preview for timing verification when synchronization is
  not armed.

While synchronization is armed, the stage preview is intentionally suspended
and replaced in the same workspace by a lightweight, cursor-ordered Sync Focus
showing the current and next lyric lines. Exiting synchronization restores the
preview. Focused overlays are permitted for short, transactional tasks such as
pasting raw lyrics or choosing an export format. The preview, editor, and
transport must never become separate application windows.

## In scope

### Projects and media

- New, open, save, and save-as for versioned `.oks` JSON project files.
- Link MP3, WAV, M4A, FLAC, AAC, or OGG audio without copying it into the project.
- Display the decoded waveform when possible, with a deterministic placeholder before audio is attached.
- Song title, artist, global timing offset, audio path, and duration metadata.
- First launch and **New Project** create a clean slate: one empty **Lead Vocal**
  track is permitted, but no example title, artist, lyrics, timing, or media is
  populated.
- `createDemoProject` is retained only as an explicitly invoked development,
  debugging, or test fixture. It must not supply startup state, the **New
  Project** action, a packaged user workflow, or fallback data after a load
  failure.

### Lyrics and vocal track

- One lead-vocal authoring track with its own name and color.
- Creating additional independently timed singer tracks is deferred.
- **Edit text** opens a transactional plain-text lyric editor rather than a
  persistent Word Map or lyric panel in the main workspace.
- Preserve internal blank lyric rows as section separators through edits and
  `.oks` save/open round trips.
- Treat `/` as a visible syllable boundary (`·`) while preserving the source token.
- Warn when a line is likely to exceed the title-safe preview width.
- Import line-timed or enhanced LRC into the active track.
- Clear timing without deleting lyrics.

### Synchronization and TimeBoard

- Tap-sync mode in which bare Space key-down starts the current word. The next
  same-line key-down backfills the preceding word's end to that new onset;
  key-up duration extends the final word of a line. The resulting start and end
  remain bounded by the preceding and following timed words in lyric order,
  including when either adjacent word is on another lyric line.
- Sample synchronization timestamps from the authoritative playback clock.
  Convert them to lyric time with the project offset, and ignore taps that occur
  before lyric time `0:00` when a positive offset delays the lyrics.
- Start or resume synchronization from the current playhead.
- A low-latency Sync Focus with cursor-ordered current and next lyric lines, a
  visible target word, and timed/untimed progress. The heavier stage preview is
  not mounted while synchronization is armed.
- TimeBoard-native controls for **Start Sync**, **Clear Timing**, and **Clear
  Timing After Cursor**. Clear operations affect timing in the active track,
  preserve lyric text, and participate in undo/redo.
- Click the ruler or waveform to seek.
- Drag timed words or a multi-word selection to move them without crossing the
  preceding or following timed lyric-order word, including across line
  boundaries.
- Drag word edges to change start or end times within those same lyric-order
  bounds.
- Select words from the TimeBoard, including its untimed-word tray.
- Outside a text-editing field, Command/Ctrl+A selects every word in the active
  track instead of selecting page text.
- Dragging across empty TimeBoard space draws a visible marquee and selects the
  active track's intersecting word blocks.
- Word text is rendered separately from duration-sized timing blocks. Timing
  blocks for non-overlapping words in the single lead track share a common
  chronological baseline; label lanes may stagger vertically so full labels
  remain readable without ellipses.
- The timeline navigation group is ordered **Jump to start (`|<`)**, **Scroll
  backward (`<`)**, **Scroll forward (`>`)**. Each action has an unambiguous
  accessible name and hover description.
- Keyboard delete clears selected words' timing, Escape exits sync, and timing
  selection and clear operations participate in undo/redo.
- All timing captured in one armed synchronization session is one undoable
  history step. TimeBoard selection and correction operations remain available
  as their own undoable edits.
- Zoom and horizontal scrolling suitable for detailed timing correction.

### Preview and transport

- Progressive word highlighting driven by the same authoritative playback clock as the editor.
- Render full lyric lines without repeating the singer or track name above each
  line. The authored lead track still supplies the lyrics and color.
- A project-persisted visible-line count from 1 through 5 governs both Live
  Preview and MP4 output. The stage renders only those full lines, with no
  miniature upcoming-line treatment.
- Project-persisted **Clear** and **Scroll** advance modes govern both Live
  Preview and MP4 output. Clear replaces a page of lines within a section;
  Scroll advances one line and maintains the configured count where enough
  lines remain in that section.
- Internal blank lyric rows split sections. Neither advance mode blends lines
  across a separator: after one section passes, the next section loads as its
  own group.
- Do not automatically insert an Instrumental word, graphic, or countdown in
  gaps between lyric sections.
- Title card, safe-area guide, and current time.
- Live Preview is primarily a timing-verification surface. It is suspended
  during armed synchronization and restored on exit.
- Play/pause, Stop, short skip backward/forward, playback speed, volume, playhead
  time, and duration. Stop pauses playback and returns the playhead to project
  time `0:00`.
- Outside text-editing fields, bare Space is reserved for key-down/key-up lyric
  synchronization while Tap Sync is armed and never toggles playback.
  Shift+Space toggles playback.
- Fallback-clock playback when no audio is attached so timing interactions can
  still be exercised without loading the development demo fixture.

### Save and export

- Save lyric text, blank-row section separators, word timings, lyric-display
  settings, track styling, media linkage, and metadata in schema-v3 `.oks`.
- Open schema-v1 and schema-v2 projects by migrating them to schema v3 with the
  lyric-display defaults of 3 lines and Clear advance mode. Schema-v3 settings
  and blank separators must round trip without loss.
- Export the active vocal track as LRC.
- Export the project as ASS with karaoke timing tags.
- Render an MP4 up to 30 minutes from the built-in stage design, persisted lyric
  line count and advance mode, per-word timing, the authored lead track, and
  linked backing track through a locally installed FFmpeg executable.
- Offer the exact resolution presets 240p (426 x 240), 360p (640 x 360), 480p
  (854 x 480), 720p (1280 x 720), 1080p (1920 x 1080), 1440p (2560 x 1440),
  and 2160p (3840 x 2160), with 30 fps and 60 fps choices. Default to 720p at
  30 fps for faster iteration.
- Render target-resolution, selected-rate unique frames rather than duplicating
  a 10 fps render, stream backpressured JPEG frames to FFmpeg, and use a faster
  `libx264` encoding preset.
- Show frame-rendering and encoding progress. Closing the export dialog, closing
  the application, quitting, or choosing Cancel during an active export asks for
  confirmation. Keep the progress and cancellation surface available until the
  cancellation request is accepted. A confirmed cancellation stops the export
  and preserves any partial output as a UUID-named file beside the chosen
  destination; it does not publish that partial file as the requested result.
- Keep the chosen destination safe and remove staging output after ordinary
  errors, including unavailable video requirements.
- Validate and report untimed, invalid, or overlapping timing before export.
- Browser fallbacks for open/download when the React surface is run outside Electron.

### Quality bar

- Electron desktop shell with a constrained preload bridge and no renderer Node access.
- Responsive down to a 1280 × 720 application window; optimized for larger desktop displays.
- Complete keyboard focus states, accessible labels for icon-only actions, and
  adequate contrast.
- Icon-only and compact controls expose concise hover help that names the action
  and, when applicable, its keyboard shortcut.
- Unit tests for schema-v1/v2 migration, schema-v3 project round trips, blank-row
  section preservation, synchronization semantics/history, timing validation,
  and LRC/ASS round trips.
- Unit tests must keep Live Preview and video frame planning aligned for line
  count, Clear/Scroll behavior, and section boundaries, plus the gated
  `bun run test:video` H.264/AAC export smoke check.
- Clean TypeScript build, production Vite build, and launchable unpacked desktop package.

## Explicitly out of scope for 0.1

- Automatic transcription or word alignment.
- Stem separation or vocal removal.
- MIDI/KAR playback and lead-vocal-note mapping.
- CDG authoring or MP3+G export.
- Background image scheduling.
- Automatic linguistic hyphenation.
- Authoring additional independently timed singer tracks. Those tracks are the
  future mechanism for intentional overlapping vocals; timing within the active
  single-track workflow remains chronological and non-overlapping.
- Embedded audio, cloud sync, collaboration, show rotation, or a singer-facing second display.

## Product acceptance checklist

- [ ] The user makes and accepts a karaoke video for a new song using the Studio.
- [ ] Launch and **New Project** start with a clean slate; the development demo is
  never introduced implicitly.
- [ ] The primary journey can be completed without leaving the main window; the
  Sync Focus replaces Live Preview only while synchronization is armed.
- [ ] The main workspace has no persistent Word Map or lyric list; **Edit text**
  opens and transactionally applies or cancels lyric edits.
- [ ] A schema-v3 project reopens with identical metadata, tracks, lyrics, blank
  section separators, timings, and lyric-display settings; schema-v1/v2 projects
  migrate with the 3-line/Clear defaults.
- [ ] TimeBoard-native start, clear-all, and clear-after-cursor actions operate on
  the active track without deleting lyrics.
- [ ] Bare Space times words only while synchronization is armed; Shift+Space
  controls playback.
- [ ] Space onsets backfill preceding same-line word ends, holding the final word
  extends that line's final duration, and taps before lyric time `0:00` are
  ignored.
- [ ] One synchronization session is one undoable history step; TimeBoard
  selection and correction behaviors remain available afterward.
- [ ] Command/Ctrl+A and marquee selection select the intended active-track words
  without selecting page text.
- [ ] Non-overlapping lead-track timing blocks share one chronological baseline;
  label lanes may stagger while full word labels remain readable.
- [ ] Sync capture, block movement, and edge resizing cannot cross the preceding
  or following timed word in lyric order, including across line boundaries.
- [ ] Timeline navigation, transport Stop, and hover help are discoverable and
  behave as labeled.
- [ ] Live Preview and MP4 show the persisted 1-to-5 line count with matching
  Clear/Scroll behavior, no miniature upcoming line, and no blending across
  blank-row section boundaries.
- [ ] Live Preview and MP4 use the same per-word timing, show no repeated singer
  or track label above lyric lines, and add no automatic Instrumental treatment
  between sections.
- [ ] Timeline movement and resize operations immediately affect the Live Preview
  when it is mounted outside armed synchronization.
- [ ] LRC and ASS exports contain monotonic, non-negative timing.
- [ ] Undo and redo cover lyric replacement, timing edits, and timing clears.
- [ ] Required tests, builds, packages, and platform CI are green for the final
  acceptance candidate.
- [ ] A linked-audio project renders synchronized H.264/AAC MP4 lyric frames at
  every supported resolution and at 30 or 60 fps; a new export defaults to
  720p/30.
- [ ] Cancelling an active MP4 export from its dialog, application close, or quit
  requires confirmation and preserves a UUID-named partial file beside the
  chosen destination, while an ordinary export failure leaves the destination
  safe.
- [ ] The final UI is visually checked at the working desktop size and the minimum
  supported 1280 × 720 window.
