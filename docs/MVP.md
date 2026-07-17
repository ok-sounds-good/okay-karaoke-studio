# Okay Karaoke Studio — MVP Definition

## Product promise

Okay Karaoke Studio is a desktop editor for turning a backing track and plain
lyrics into precisely timed karaoke lyrics on one lead-vocal authoring track.
Project settings, lyric editing, Lyric Timing, stage verification, and playback
stay in **one unified window**, with a focused low-latency surface replacing the
stage while synchronization is armed.

This document is the active product-acceptance contract for version 0.1. The
supporting criteria below may change as real editing work exposes blockers;
capabilities that are deliberately deferred belong in
[`ROADMAP.md`](./ROADMAP.md).

Version 0.1 is a clean-slate **v0** product. Before v1.0, `.oks` files are
disposable development artifacts: an MVP iteration may replace the project
format without migration or backward compatibility. During this clean-slate
pre-v1 period, each build writes and accepts one canonical project format. This
build's format is current v0, identified by numeric `schemaVersion: 0`. A later
build may intentionally accept older formats and add migrations after the
product promises compatibility. Fixtures and tests change in lockstep with the
current format.

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
- **Distribution acceptance: open and user-held.** The repository is licensed
  under GNU GPL v3.0 or later (`GPL-3.0-or-later`). Before public distribution,
  the user still explicitly decides whether FFmpeg remains externally installed
  or is redistributed with a documented compatible build and compliance plan.
  This remaining decision does not block private-repository MVP implementation,
  CI, or product testing, and no agent may close it on the user's behalf.

## Primary user journey

1. Launch into a clean-slate project, or open an existing `.oks` project.
2. Attach an audio backing track.
3. Open **Edit text** to paste lyrics, preserving internal blank rows as section
   separators, or import an LRC file.
4. Press Space at each word onset. Each same-line onset closes the preceding
   word; hold Space on the final word of a line to extend its duration. The
   resulting timing cannot cross the preceding or following timed word in lyric
   order, including across line boundaries.
5. Correct individual words by dragging and resizing them in Lyric Timing;
   edits stop at those same lyric-order boundaries.
6. Exit synchronization, configure the video's stage style, and verify the
   result in the restored Live Preview, choosing its line count and Clear or
   Scroll advance behavior as needed.
7. Save the editable project and export LRC, ASS, or a finished MP4 karaoke video.

## Single-window layout invariant

The main window must provide access to:

- Project metadata, video-style settings, and lead-track controls.
- An **Edit text** action in Live Preview that opens the transactional lyric
  editor; Lyric Timing does not duplicate it, and the main workspace does not
  persistently render a Word Map or lyric list. While synchronization replaces
  Live Preview, Sync Focus owns the single equivalent action.
- A scrollable waveform Lyric Timing editor.
- Playback, seeking, speed, volume, zoom, and tap-sync controls.
- A live karaoke stage preview for timing verification when synchronization is
  not armed.

While synchronization is armed, the stage preview is intentionally suspended
and replaced in the same workspace by a lightweight, cursor-ordered Sync Focus
showing the current and next lyric lines. Exiting synchronization restores the
preview. Focused overlays are permitted for short, transactional tasks such as
pasting raw lyrics or choosing an export format. Video-style editing must remain
in the unified window and preserve a practical way to compare changes with Live
Preview; its exact inline or focused presentation is a design decision. The
preview, editor, and transport must never become separate application windows.
The inspector does not reserve a decorative **Document / Project** header row.
The **Style** entry point belongs in the application header beside the Okay
Karaoke Studio identity.

## In scope

### Projects and media

- New, open, save, and save-as for current v0 `.oks` JSON project files.
- Link MP3, WAV, M4A, FLAC, AAC, or OGG audio without copying it into the project.
- Link one static background image without copying it into the project. A
  missing, animated, or decoder-invalid linked image must be reported before
  export rather than silently replaced in the requested result; a matching
  filename extension or magic header alone is not sufficient.
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

- One lead-vocal authoring track with its own name and sung color.
- Creating additional independently timed singer tracks is deferred.
- **Edit text** opens a transactional plain-text lyric editor rather than a
  persistent Word Map or lyric panel in the main workspace.
- Preserve internal blank lyric rows as section separators through edits and
  `.oks` save/open round trips.
- Treat `/` as a visible syllable boundary (`·`) while preserving the source token.
- Warn when a line is likely to exceed the title-safe preview width.
- Import line-timed or enhanced LRC into the active track.
- Clear timing without deleting lyrics.

### Synchronization and Lyric Timing

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
- Lyric Timing controls for **Start Sync**, **Clear Timing**, and **Clear
  Timing After Cursor**. Clear operations affect timing in the active track,
  preserve lyric text, and participate in undo/redo.
- Click the ruler or waveform to seek.
- Drag timed words or a multi-word selection to move them without crossing the
  preceding or following timed lyric-order word, including across line
  boundaries.
- Drag word edges to change start or end times within those same lyric-order
  bounds.
- Select words from Lyric Timing, including its untimed-word tray.
- Outside a text-editing field, Command/Ctrl+A selects every word in the active
  track instead of selecting page text.
- Dragging across empty Lyric Timing space draws a visible marquee and selects the
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
  history step. Lyric Timing selection and correction operations remain available
  as their own undoable edits.
- Zoom and horizontal scrolling suitable for detailed timing correction.

### Preview and transport

- Progressive word highlighting from the configured unsung color to the sung
  color, driven by the same authoritative playback clock as the editor.
- Per-word highlighting is the lyric progress signal; the stage does not add a
  separate whole-line progress meter.
- Render full lyric lines without repeating the singer or track name above each
  line. The authored lead track still supplies the lyrics and any vocal style
  overrides.
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

### Video style

- A project-persisted stage-style model governs both Live Preview and MP4
  output. The fixed current stage appearance is the default for new projects in
  the current v0 format.
- Choose a **Solid**, **Gradient**, or **Image** background. Solid mode has a
  configurable color, Gradient mode has configurable colors, and Image mode
  selects one linked static image. Background scheduling, animation, and
  per-section scenes remain deferred.
- The **Stage frame** means the visible frame plus its built-in brand, clock,
  and song-metadata elements. It can be enabled or disabled as a whole, and its
  built-in elements can be configured independently.
- Title-card, footer, and Stage-frame text roles retain independent visibility
  and typography instead of receiving one project font indiscriminately. Their
  typeface, style, size, and color are configurable without changing the
  semantic project title, artist, or playback time they display.
- Project lyric defaults include typeface, style, size, unsung color, and sung
  color. The sung color is the progressive fill applied to words as they are
  performed; it is independent of Clear or Scroll line advance mode.
- The font selector uses a searchable, keyboard-accessible typeface combobox.
  Visible options render in their own typeface and are loaded incrementally so
  a large installed catalog remains responsive. Available face traits use
  compact modern controls, unsupported traits are unavailable rather than
  synthesized, and size comes from an enumerated dropdown.
- Font selection activates a target-aware design mode in Live Preview. The
  fixed logical video stage renders representative content for the role being
  edited at the selected face, traits, and size, so scale is judged relative to
  the real video frame. There is no separate oversized `This is <typeface>`
  specimen in the control panel.
- The chosen face must resolve consistently in Live Preview and MP4 output.
  Typeface, Style, and Size are separate persisted fields; selecting or
  inheriting one does not mutate the others. Persisted local faces use actual
  enumerated PostScript names and a deterministic catalog/trait fallback, never
  a guessed name. A changed installed catalog is an explicit Typeface
  replacement: until chosen, the persisted face and its shared Preview/MP4
  fallback remain selected.
- Font files are neither copied into projects nor bundled with the application.
  Reopening a project on a system without its selected font produces a visible
  warning and uses a deterministic fallback rather than silently changing only
  one renderer.
- A vocal track can independently inherit or override the project lyric
  typeface, style, size, unsung color, and sung color. It also owns horizontal
  alignment (**Left**, **Center**, or **Right**), line preview time, and sync-aid
  settings.
- Preview time is measured in milliseconds and controls how far before a lyric
  line's first sung word the line becomes eligible to appear, subject to the
  configured line count and Clear or Scroll advance behavior.
- One built-in sync-aid animation cues only the first lyric line of each blank-
  row-separated lyric section, including the first section. It renders only
  when that line's literal first word has a valid start/end timing pair and
  never transfers to a later word or line in the section. Its horizontal travel
  is at least 128 logical pixels for Left, Center, and Right alignment.
- Let `A` be the available time between that first line becoming visible and its
  first sung word, `Min` the minimum useful sync-aid lead time, and `Max` the
  configured maximum. Let `D = min(A, Max, Preview time)`. Render the aid only
  when `D >= Min`; when rendered, its duration is `D` and it ends at the first
  word's start. The default `Min` is 2000 ms. If the minimum time is not
  available, skip the aid rather than compressing it or showing it before the
  lyric line.
- Live Preview and MP4 output use the same resolved styles, font fallback,
  background asset, line-visibility plan, and sync-aid timing.
- A missing or errored active Image background is not MP4-ready even if a stale
  scoped URL remains. Applying the style preserves the linked-path warning;
  both the Export UI and command handler block MP4 until it is resolved.

### Saved style templates

- Save the Studio's creator preferences as named, application-level templates
  that can be created, applied, renamed, and deleted.
- A template includes every supported creator-configurable stage, lyric-display,
  vocal-style, sync-aid, and export-default setting. It includes the linked
  background-image selection and path, but does not copy or embed the image.
- A template excludes project content and timing: title, artist, loaded audio,
  audio metadata, lyrics, section separators, word timings, global offset, and
  vocal-track identity remain properties of the `.oks` project.
- Applying a template changes only the included preferences, is one undoable
  project edit, and never replaces excluded project content. Saving, renaming,
  or deleting a template does not dirty the open project.
- A template retains a missing linked-image path and shows the established
  Preview warning/fallback, but MP4 export remains blocked until the image is
  replaced, cleared, or no longer selected. An unavailable font remains selected
  and uses the same named deterministic fallback in Live Preview and MP4 output
  as a font loaded directly from the project.

### Save and export

- Save lyric text, blank-row section separators, word timings, lyric-display
  settings, stage style, track styling and overrides, linked media paths, and
  metadata in the current v0 `.oks` format.
- The current build accepts only numeric `schemaVersion: 0`. Any other value is
  rejected with one clear unsupported-format error. This build does not provide
  compatibility handling or migration. All fields and linked paths in the
  current format must round trip without loss.
- Export the active vocal track as LRC.
- Export the project as ASS with karaoke timing tags.
- Render an MP4 up to 30 minutes from the persisted stage style, lyric line
  count and advance mode, per-word timing, authored lead track, linked static
  background when selected, and linked backing track through a locally
  installed FFmpeg executable.
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

### Platform and distribution

- Windows x64 is an MVP distribution target. A separately initiated final
  Windows acceptance run produces both an unsigned NSIS installer and the
  unpacked application, launch-smokes the packaged application, and runs the
  applicable font, visual, project, and H.264/AAC media gates. Routine
  pull-request CI does not repeat this final-candidate package proof. Windows
  signing and automatic updates remain deferred.
- The portable Linux gate and thin macOS and Windows compatibility gates must
  pass for the final candidate. Linux packaging and Linux-specific media
  verification remain Roadmap work.
- The Windows package continues to use the guided external-FFmpeg setup unless
  the user separately approves a redistributable FFmpeg build and its compliance
  plan. Bundling FFmpeg is not required for Windows MVP acceptance.
- The repository is licensed under GNU GPL v3.0 or later
  (`GPL-3.0-or-later`). This selection does not authorize bundling FFmpeg. Its
  redistribution policy remains a separate user-held MVP decision, and agents
  must not change `LICENSE`, package license metadata, or bundled-binary policy
  without the user's explicit direction.

### Quality bar

- Electron desktop shell with a constrained preload bridge and no renderer Node access.
- Responsive down to a 1280 × 720 application window; optimized for larger desktop displays.
- Complete keyboard focus states, accessible labels for icon-only actions, and
  adequate contrast.
- Inputs and dropdowns share the same control treatment. Stage-style defaults
  preserve the app's existing purple, orange, and neutral identity until the
  user changes them.
- Icon-only and compact controls expose concise hover help that names the action
  and, when applicable, its keyboard shortcut.
- Unit tests for TypeScript/main-process strict current v0 format acceptance
  parity and round trips, clear rejection of every other project format and
  authorization from rejected data, blank-row section preservation,
  synchronization semantics/history, timing validation, and LRC/ASS round
  trips.
- Unit tests must keep Live Preview and video frame planning aligned for line
  count, Clear/Scroll behavior, section boundaries, resolved styles, preview
  time, and sync-aid eligibility and timing, plus the gated `bun run test:video`
  H.264/AAC export smoke check.
- Clean TypeScript build, production Vite build, launchable unpacked macOS and
  Windows packages, and the required Windows installer artifact.

## Explicitly out of scope for 0.1

- Automatic transcription or word alignment.
- Stem separation or vocal removal.
- MIDI/KAR playback and lead-vocal-note mapping.
- CDG authoring or MP3+G export.
- Background image scheduling, animated backgrounds, or per-section scenes. One
  linked static project background is in scope.
- Embedded background-image data, bundled fonts, or fonts copied into project
  files.
- Alternative sync-aid animations.
- Automatic linguistic hyphenation.
- Authoring additional independently timed singer tracks. Those tracks are the
  future mechanism for intentional overlapping vocals; timing within the active
  single-track workflow remains chronological and non-overlapping.
- Embedded audio, cloud sync, collaboration, show rotation, or a singer-facing second display.

## Product acceptance checklist

- [ ] The user makes and accepts a karaoke video for a new song using the Studio.
- [x] Launch and **New Project** start with a clean slate; the development demo is
  never introduced implicitly.
- [x] The primary journey can be completed without leaving the main window; the
  Sync Focus replaces Live Preview only while synchronization is armed.
- [x] The main workspace has no persistent Word Map or lyric list; its single
  **Edit text** action lives in Live Preview (or its Sync Focus replacement),
  not in Lyric Timing, and transactionally applies or cancels lyric edits.
- [x] The current v0 project format round trips every project field and linked
  path without loss, while every nonzero or nonnumeric `schemaVersion` fails
  with the generic unsupported-format error and no partial load state.
- [x] Lyric Timing start, clear-all, and clear-after-cursor actions operate on
  the active track without deleting lyrics.
- [x] Bare Space times words only while synchronization is armed; Shift+Space
  controls playback.
- [x] Space onsets backfill preceding same-line word ends, holding the final word
  extends that line's final duration, and taps before lyric time `0:00` are
  ignored.
- [x] One synchronization session is one undoable history step; Lyric Timing
  selection and correction behaviors remain available afterward.
- [x] Command/Ctrl+A and marquee selection select the intended active-track words
  without selecting page text.
- [x] Non-overlapping lead-track timing blocks share one chronological baseline;
  label lanes may stagger while full word labels remain readable.
- [x] Sync capture, block movement, and edge resizing cannot cross the preceding
  or following timed word in lyric order, including across line boundaries.
- [x] Timeline navigation, transport Stop, and hover help are discoverable and
  behave as labeled.
- [x] Live Preview and MP4 show the persisted 1-to-5 line count with matching
  Clear/Scroll behavior, no miniature upcoming line, and no blending across
  blank-row section boundaries.
- [x] Live Preview and MP4 use the same per-word timing, show no repeated singer
  or track label above lyric lines, and add no automatic Instrumental treatment
  between sections.
- [ ] The project can choose a solid, gradient, or linked-image background and
  can configure or disable the Stage frame, while title-card, footer, and frame
  typography remain independently configurable.
- [ ] The searchable font combobox reliably lists installed typefaces on each
  supported system, renders visible options in their own fonts, exposes only
  supported face traits plus an enumerated size list, and remains usable with a
  large catalog by loading visible choices incrementally.
- [ ] Font editing switches Live Preview into a target-aware fixed-stage design
  mode that shows the selected face, traits, and size relative to the video
  frame, and produces the same resolved font or visible fallback warning in MP4
  output without a separate oversized control-panel specimen.
- [ ] Project lyric defaults and vocal overrides produce matching typeface,
  style, size, unsung color, sung color, and horizontal alignment in Live
  Preview and MP4 output.
- [ ] Preview time controls line eligibility, and the built-in sync aid appears
  only on the first line of a blank-row-separated section when at least its
  configured minimum lead time is available.
- [ ] Named style templates preserve every supported creator preference,
  including the linked background-image path, and applying one leaves title,
  artist, audio, lyrics, section separators, word timing, global offset, and
  vocal-track identity unchanged.
- [ ] Style-template create, apply, rename, and delete behavior persists across
  application restarts; missing linked images remain explicit and block MP4
  export, while missing fonts remain explicit and use the same deterministic
  Preview/MP4 fallback as project-loaded settings.
- [x] Timeline movement and resize operations immediately affect the Live Preview
  when it is mounted outside armed synchronization.
- [x] LRC and ASS exports contain monotonic, non-negative timing.
- [x] Undo and redo cover lyric replacement, timing edits, and timing clears.
- [ ] Required tests, builds, packages, and platform CI are green for the final
  acceptance candidate.
- [ ] A separately initiated Windows x64 acceptance run produces an unsigned
      NSIS installer and unpacked app, launch-smokes the packaged app, and passes
      the applicable font, visual, project, and H.264/AAC media gates without
      bundling FFmpeg by default.
- [ ] The inspector has no decorative **Document / Project** header row, and
  **Style** is available beside the Okay Karaoke Studio identity in the
  application header.
- [x] The repository's public-distribution license is GNU GPL v3.0 or later
      (`GPL-3.0-or-later`).
- [ ] The user decides whether FFmpeg remains externally installed or is
      redistributed with a documented compatible build and compliance plan.
- [ ] A linked-audio project renders synchronized H.264/AAC MP4 lyric frames at
  every supported resolution and at 30 or 60 fps; a new export defaults to
  720p/30.
- [x] Cancelling an active MP4 export from its dialog, application close, or quit
  requires confirmation and preserves a UUID-named partial file beside the
  chosen destination, while an ordinary export failure leaves the destination
  safe.
- [ ] The final UI is visually checked at the working desktop size and the minimum
  supported 1280 × 720 window.
