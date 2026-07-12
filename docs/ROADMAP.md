# Okay Karaoke Studio — Additional Features

This roadmap intentionally sits outside the 0.1 MVP contract in [`MVP.md`](./MVP.md). Ordering is directional and should be revisited after real editing sessions.

## Next: faster professional editing

- Command-based editing history with named operations and a visual history panel.
- Crash-safe autosave snapshots and project recovery.
- Ripple timing, range retime, quantize, nudge presets, copy/move to the other voice, and unsynchronize-from-cursor.
- Line, phrase, and arbitrary group dragging with magnetic snapping.
- Loop ranges, markers, count-in, metronome, and configurable keyboard shortcuts.
- Replace the backing track while retaining timing, with an alignment offset assistant.
- Multiple lyric revisions: original, corrected, machine-aligned, and approved.
- Side-by-side source lyrics and synchronized lyrics.

## Automatic preparation

- Local speech transcription with word timestamps.
- LRC-anchored alignment that preserves corrected lyric spelling.
- Offline stem separation for instrumental, lead vocal, and backing vocal stems.
- Waveform and onset analysis as resumable background jobs.
- Confidence indicators and a review queue for interpolated or uncertain words.
- Pluggable lyrics providers with clear provenance and rights metadata.

## Visual production

- Rich style editor for fonts, outline, shadow, gradients, positioning, and per-track themes.
- Standards-aware ASS import that preserves unknown sections and column formats.
- Scheduled still images, animated backgrounds, and per-section scenes.
- Aspect-ratio presets, title-safe/action-safe overlays, and multiple preview devices.
- Bundle or securely provision a pinned, license-audited media encoder so video export does not depend on a system FFmpeg installation.
- Add advanced video controls for resolution, codec, frame rate, background scenes, and subtitle-safe-area presets.
- Theme packs and reusable project templates.

## Karaoke formats

- MP3 ID3 synchronized-lyrics (SYLT) import/export.
- MIDI/KAR import, playback, and lyric-event export.
- Lead Vocal Track note display and note-to-word synchronization.
- CDG packet authoring, preview, validation, and MP3+G export.
- UltraStar TXT and additional enhanced-LRC variants.
- Interchange fixtures and conformance tests for each adapter.

## Audio and performance

- Multi-stem, sample-aligned mixer driven by one authoritative audio clock.
- Vocal guide ducking, pitch reference, pan, EQ, and limiter controls.
- Non-destructive tempo and pitch changes with a bundled, license-audited engine.
- Proxy generation and waveform cache for long or lossless media.
- Low-latency input monitoring for rehearsal.

## Live and collaborative workflows

- Optional full-screen singer output or a deliberately separate audience display mode.
- Set lists, singer rotation, remote requests, and QR join flow.
- Shared review links with timestamped comments.
- Project bundles for moving work between machines.
- Team roles, change attribution, and approval states.

## Platform and distribution

- Windows and Linux packaging and platform-specific media verification.
- Signed and notarized macOS releases with automatic updates.
- Optional Tauri shell evaluation after the editor contracts stabilize.
- Bundled, pinned media binaries with documented LGPL/GPL compliance.
- Performance telemetry that is opt-in, local-first, and privacy-preserving.

## Decision gates

Before promoting a roadmap item into the MVP or a scheduled release, document:

1. The editing problem it solves.
2. The minimum interaction that solves it.
3. Project-format impact and migration requirements.
4. Export-format and licensing implications.
5. Automated and hands-on acceptance checks.
