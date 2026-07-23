# Okay Karaoke Studio agent guide

Keep `main` green and releasable. Version 0.1 product acceptance remains open
until the user makes and accepts a karaoke video for a new song with the Studio.

## Read what the task needs

Do not load every project document for every task:

- Read the relevant parts of `docs/MVP.md` for product behavior or acceptance.
- Read `docs/ROADMAP.md` when priorities, scope, or exclusions may change.
- Read `docs/SDLC.md` for branch, pull-request, CI, or release work.
- Read `docs/REVIEWING.md` when reviewing a change.
- Read `CONTRIBUTING.md` for setup and validation commands.

Document an evidence-backed product-contract change instead of silently changing
MVP scope or a roadmap boundary.

## Toolchain

- Use Bun `1.3.14` and Node.js `24` or newer, as declared in `package.json`.
- Install dependencies with `bun install --frozen-lockfile`.
- Use repository scripts rather than ad hoc substitutes.
- Do not commit generated `dist/`, `release/`, logs, or local project artifacts.

The checked-in post-write hook formats changed ranges. Run `bun run format`
manually when the hook did not cover a write, then verify with
`bun run format:check`.

## Branches, worktrees, and authority

For nontrivial edits, use a short-lived branch in an isolated worktree under
`.worktrees/<task-slug>/`. If the task already has an assigned worktree, use it.
The lead agent owns branch, worktree, publication, merge, and cleanup lifecycle.

Delegated agents are local-only unless their current assignment explicitly
authorizes a specific remote action. Delegation never expands the user's
authority. Give each writer an exclusive file and behavior scope; never allow
overlapping writers in one worktree.

Preserve pre-existing or concurrent changes. If their ownership or intent is
unclear and they overlap the task, stop and ask rather than reverting, excluding,
or silently incorporating them.

## Architecture invariants

- Renderer code has no Node.js access; preload APIs stay minimal and IPC channels
  are explicit and validated.
- Trace normal and failure paths when a change crosses renderer, preload, main,
  filesystem, or media-process boundaries.
- Preserve the single-window product contract.
- Project-schema changes require current-format round-trip and rejection tests.
  Add migration handling once compatibility with an earlier format is promised.
- Save and export operations must not produce stale success, corrupt projects,
  or partial destination files.
- FFmpeg support requires verified `libx264` and AAC capability, not merely an
  executable. Do not bundle codec binaries without an explicit licensing and
  distribution decision.

## Validation

- Every change: `bun run format:check`.
- Application, test, or build-configuration changes: `bun run test` and
  `bun run build`.
- Electron, preload, main-process, or packaging changes: `bun run dist:dir`.
- On macOS under a Codex sandbox, request scoped escalation for the exact
  GUI-bearing Electron command before its first run. Treat a sandbox `SIGABRT`
  as an environment failure, not a test result; if escalation is unavailable,
  report the gate as unrun. Do not broaden the whole agent sandbox.
- Video rendering, audio muxing, frame planning, or media-process changes:
  `bun run test:video`.
- User-visible behavior: exercise the affected workflow and record the result.
- Visual changes: capture relevant before/after evidence, including the minimum
  supported 1280 x 720 window when layout may be affected.
- Project or export format changes: add fixtures, round-trip validation, and
  compatibility or licensing notes as applicable.

For documentation, policy, or template-only changes, run focused contract tests
when they exist; the application suite and renderer build are not required unless
the change can affect executable behavior.

Report exactly what ran and what did not. An unavailable or unrun gate is not a
pass.

## Delegation and review

Use subagents only for bounded work where separate context or independent review
justifies the coordination cost. Project roles live in `.codex/agents/`.

For nontrivial changes, obtain an independent review before merge. The reviewer
uses `docs/REVIEWING.md`, the exact local diff, relevant contract excerpts, and
the available pull-request context. The lead resolves findings and owns the final
validation and merge recommendation.

## Data and handoff

Use synthetic, generated, redacted, or clearly redistributable media in public
Issues, pull requests, tests, and fixtures.

At completion, report behavior and files changed, validation and gaps, material
security/data/project/export/packaging/licensing impact, deliberate exclusions,
and residual risk. When the work is published, keep that record in the pull
request as required by `docs/SDLC.md`.
