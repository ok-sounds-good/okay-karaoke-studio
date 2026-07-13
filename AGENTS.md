# Okay Karaoke Studio agent guide

This file defines the shared working contract for agents operating in this
repository.

## Sources of truth

Read these before nontrivial work:

- `docs/MVP.md` defines the completed version 0.1 product contract.
- `docs/ROADMAP.md` defines current priorities and explicit exclusions.
- `docs/SDLC.md` defines branch, pull-request, review, CI, and release policy.
- `CONTRIBUTING.md` defines setup, verification, and safe reproduction guidance.

Keep `main` green and releasable. Do not silently expand a task beyond its
acceptance criteria or the roadmap scope.

## Toolchain and setup

- Use Bun `1.3.14` and Node.js `24` or newer, as declared in `package.json`.
- Install dependencies with `bun install --frozen-lockfile`.
- Use repository scripts rather than substituting ad hoc commands.
- Do not commit generated `dist/`, `release/`, logs, or local project artifacts.

## Branches and worktrees

- For nontrivial change work, the lead agent should create or use a short-lived
  branch in an isolated worktree before editing.
- Place repository-local worktrees under `.worktrees/<task-slug>/`. The
  `.worktrees/` directory is intentionally ignored and must never be committed.
- If the task already runs inside an assigned worktree, use it.
- Subagents must not create, switch, move, or remove worktrees; create, switch,
  merge, or delete branches; push commits; open, update, or merge pull requests;
  or prune worktree metadata. The lead agent owns all lifecycle and
  remote-repository operations.
- Follow the pull-request and merge policy in `docs/SDLC.md`. Do not commit
  directly to `main` unless the user explicitly requests that workflow.
- Flag pre-existing or concurrent changes whose provenance or intent is unclear.
  Do not revert, overwrite, discard, exclude, or silently fold them into the
  task. A material change that aligns with the task may be intentional steering;
  if there is any doubt about its provenance or intent, **STOP AND ASK** what to
  do with it before proceeding.

`docs/SDLC.md` governs deletion of a merged pull request's head branch.

## Architecture boundaries

- Preserve the Electron trust boundary: renderer code has no Node.js access,
  preload exposure stays minimal, and IPC channels are explicit and validated.
- When a change crosses main-process, preload, renderer, filesystem, or
  media-process boundaries, trace the normal and failure paths through every
  affected boundary.
- Keep the single-window layout invariant from `docs/MVP.md`.
- Project-schema changes require migration handling and round-trip regression
  coverage.
- Save and export operations must fail safely without stale success state,
  corrupted projects, or partial destination files.
- FFmpeg video support means verified H.264 (`libx264`) and AAC encoder
  capability, not only the presence of an executable.
- Do not bundle FFmpeg or other codec binaries without an explicit licensing and
  distribution decision.

## Validation

Run the smallest sufficient validation while working, then the complete gate
required by the change:

- Every change: `bun run test` and `bun run build`.
- Electron, preload, main-process, or packaging changes: `bun run dist:dir`.
- Video rendering, audio muxing, frame planning, or media-process changes:
  `bun run test:video`.
- User-visible behavior: exercise the task-specific manual acceptance criteria
  first. Then check affected steps in the **Editing workflow** section of
  `README.md` and relevant existing criteria in `docs/MVP.md` as regression
  coverage. Record the exact steps and results in the pull request.
- Visual changes: capture before/after evidence at the affected desktop size and
  at the minimum supported 1280 x 720 window when relevant.
- Project-format or export-format changes: add fixtures, round-trip validation,
  and migration or licensing notes as applicable.

If an environment-dependent gate cannot run, report the exact blocker and what
remains unverified. Do not represent a partial validation result as a full pass.

## Delegation and review

Project-scoped custom agent definitions are stored in `.codex/agents/`. Use the
descriptions to select the relevant role and read the selected definition before
delegating work.

- Use subagents for bounded, independent work that benefits from separate
  context: code-path mapping, documentation verification, test/log analysis,
  security review, or adversarial review.
- Prefer parallel delegation for read-heavy tasks. Do not let multiple agents
  edit the same worktree concurrently.
- Give each write-capable agent an explicit file and behavior scope.
- For nontrivial changes, obtain an independent adversarial review before merge.
  Treat confirmed correctness, security, data-integrity, and missing-test
  findings as merge blockers until resolved or explicitly accepted by the user.
- The lead agent waits for delegated results, resolves contradictions, and owns
  the final synthesis, validation statement, and merge recommendation.
- Do not delegate trivial tasks where coordination cost exceeds likely value.

## Data, media, and licensing

- Never attach copyrighted songs, lyrics, or media to public issues, pull
  requests, tests, or fixtures.
- Use synthetic, generated, redacted, or clearly redistributable examples.
- Call out export-format, codec, font, asset, and binary-distribution licensing
  impact when relevant.

## Handoff

At completion, report:

- the behavior and files changed;
- validation performed and its results;
- manual or environment-dependent checks still required;
- project-format, export, packaging, security, or licensing impact;
- deliberate exclusions and residual risk.
