# Contributing

Okay Karaoke Studio keeps `main` green and releasable. Read the completed
[`docs/MVP.md`](docs/MVP.md) contract, the prioritized
[`docs/ROADMAP.md`](docs/ROADMAP.md), and the
[`docs/SDLC.md`](docs/SDLC.md) change policy before starting nontrivial work.

## Local setup

```bash
bun install --frozen-lockfile
bun run test
bun run build
```

Use a short-lived branch from current `main` and open a pull request. The pull
request should explain the problem, intended scope, verification, risks, data or
export-format impact, and what was deliberately left out.

Run `bun run dist:dir` for Electron or packaging changes. Run the gated
`bun run test:video` smoke test for video, audio-muxing, or media-process changes;
it requires Electron, FFmpeg, and FFprobe.

Do not attach copyrighted songs, lyrics, or media to public issues or pull
requests. Use a minimal synthetic project or redacted `.oks` example when a
reproduction is needed.
