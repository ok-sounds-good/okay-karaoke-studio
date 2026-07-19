# Okay Karaoke Studio

Okay Karaoke Studio is a single-window desktop editor for turning a backing
track and plain lyrics into timed karaoke lyrics and a finished MP4 video. Live
Preview, Lyric Timing, project settings, and playback stay together while you
work.

> This is a pre-v1 implementation. The `.oks` project file format is still under
> active development and may be subject to change.

## Before you launch

You need Node.js 24 LTS or newer and Bun 1.3.14 or newer.

MP4 export also requires FFmpeg with both the `libx264` and AAC encoders and the
modern per-stream `fps_mode` and `enc_time_base` options. When available, the
Studio can install FFmpeg through WinGet on Windows or Homebrew on macOS after
you confirm. You can also install FFmpeg manually or set `OKAY_KARAOKE_FFMPEG`
to use a specific executable; unsupported builds are rejected before export.

## Launch from source

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run dev` opens the desktop app.

## Build the unsigned Windows package

On Windows x64, `bun run dist:win` creates an unsigned NSIS installer named
`Okay-Karaoke-Studio-<version>-x64-setup.exe` and a `release/win-unpacked`
application. The command never publishes an artifact. CircleCI validates the
actual PE architecture, installer payload, packaged-file inventory, and bounded
artifact sizes before retaining both outputs.

FFmpeg and FFprobe command-line executables and external encoder libraries are
not included in either artifact. Electron's standard `ffmpeg.dll` media runtime
remains part of the Electron distribution and is inventoried separately. MP4
export continues to use the separately installed executable described above;
packaging does not add FFmpeg, FFprobe, libx264, or AAC encoder binaries and does
not change the external-FFmpeg or licensing policy.

## Start a project

When the Studio opens, start a new project or choose **Open project** to reopen
an existing `.oks` file. Choose **Workflow** in the top bar at any time for the
in-app first-project guide.

## Make your first karaoke video

1. **Describe the song and attach audio.** Enter the title and artist in **Song
   details**. Under **Backing track**, choose **Attach an audio file** and select
   an MP3, WAV, M4A, FLAC, AAC, or OGG file.

2. **Add lyrics.** Choose **Edit text** in Live Preview, paste one lyric line per
   row, and keep blank rows between sections. A slash marks a visible syllable
   break, so `nev/er` displays as `nev·er`. Choose **Apply lyrics** to keep the
   edit, or import line-timed or enhanced LRC with **Import LRC lyrics**.

3. **Synchronize the words.** Move the playhead to the desired starting point
   and choose **Start sync** in Lyric Timing or the playback bar. Press Space at
   each word onset, or press Right to start the displayed word and Down to end
   the active word. Each new onset on the same line closes the previous word
   unless Down explicitly ended it. Hold Space through a final word. Press
   Escape when you are finished.

4. **Correct the timing.** Select words in Lyric Timing, drag blocks to move
   them, or drag either edge to resize them. Changes stop at neighboring timed
   words. Drag across empty Lyric Timing space for a marquee selection, or use
   Command/Ctrl+A outside a text field to select the active track. Use **Clear
   timing** to clear the active track or **Clear from cursor** to clear timings
   beginning at the playhead.

5. **Verify and style the result.** In Live Preview, set **Lines** to 1 through 5
   and choose **Clear** or **Scroll** under **Advance**. Blank lyric rows keep
   sections separate.

   Choose **Style** to set the project lyric appearance, customize the active
   Lead Vocal, choose a solid, gradient, or linked-image background, edit the
   title card, and control the Stage frame's Brand, Clock, and Footer. Choose,
   replace, or clear one PNG or JPEG linked to its original file. A newly
   selected image appears in Design Preview only after its immutable snapshot
   loads; Apply promotes it with the complete Style edit, while Cancel or a
   failed Apply discards it. Live and Design Preview use a gradient fallback and
   offer retry after failures. Image-backed MP4 export requires the linked image
   to be current and successfully displayed in Live Preview. Use
   **Lead Vocal** to set the line **Preview Time** and configure the section-start
   **Sync Aid**. A literal blank lyric row starts a section; the cue requires
   that section's literal first line and its literal first word to have valid
   timing. It is skipped when the minimum useful lead is unavailable and ends
   at that first word. Use the 16:9 Design preview to compare changes, then
   choose **Apply & close** or **Cancel**.

6. **Save the editable project.** Choose **Save project** in the top bar or use
   Command/Ctrl+S. **Save As** is also available from the File menu.

7. **Export the result.** Choose **Export** in the top bar. You can export
   Enhanced LRC, ASS karaoke subtitles, an MP4 karaoke video, or another
   editable `.oks` project.

   MP4 export requires lyrics and attached audio, produces H.264/AAC video, and
   is limited to 30 minutes. Resolution choices range from 240p (426 × 240) to
   2160p (3840 × 2160) at 30 or 60 fps; new exports default to 720p at 30 fps.
   If you cancel an active video export, the Studio keeps a partial file beside
   the chosen destination.

## Keyboard controls

| Key                      | Action                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Space                    | Start the current word during synchronization; hold the final word of a line through its sung duration. |
| Shift + Space            | Play or pause.                                                                                          |
| Escape                   | Exit synchronization or cancel an open Style edit.                                                      |
| Left / Right             | Move by 250 ms; armed Right instead starts the displayed target word.                                   |
| Down                     | End the active word while synchronization is armed.                                                     |
| Shift + Left / Right     | Move the playhead by 1 second without timing a word.                                                    |
| Delete / Backspace       | Clear timing from selected words.                                                                       |
| Command/Ctrl + A         | Select every word in the active track when not editing text.                                            |
| Command/Ctrl + Z         | Undo.                                                                                                   |
| Shift + Command/Ctrl + Z | Redo.                                                                                                   |
| Command/Ctrl + N         | Start a new project.                                                                                    |
| Command/Ctrl + O         | Open a project.                                                                                         |
| Command/Ctrl + S         | Save the project.                                                                                       |
| Shift + Command/Ctrl + S | Save the project as a new `.oks` file.                                                                  |
| Shift + Command/Ctrl + A | Import audio.                                                                                           |
| Shift + Command/Ctrl + L | Import LRC lyrics.                                                                                      |
| Shift + Command/Ctrl + E | Open Export.                                                                                            |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and verification guidance.

## License

Copyright © 2026 Okay Karaoke Studio contributors.

Okay Karaoke Studio is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

Okay Karaoke Studio is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See [`LICENSE`](LICENSE) for the complete
license terms. The SPDX identifier is `GPL-3.0-or-later`.
