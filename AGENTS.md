# Okay Karaoke Studio agent guide

This file defines the shared working contract for agents operating in this
repository.

## Sources of truth

Read these before nontrivial work:

- `docs/MVP.md` defines the active, user-held version 0.1 product-acceptance
  contract.
- `docs/ROADMAP.md` defines current priorities and explicit exclusions.
- `docs/SDLC.md` defines branch, pull-request, review, CI, and release policy.
- `CONTRIBUTING.md` defines setup, verification, and safe reproduction guidance.

Keep `main` green and releasable. Version 0.1 product acceptance remains open
until the user makes and accepts a karaoke video for a new song with the Studio.
Supporting MVP criteria may change when that attempt exposes evidence; document
the blocker and contract change instead of silently changing task scope or the
roadmap boundary.

## Toolchain and setup

- Use Bun `1.3.14` and Node.js `24` or newer, as declared in `package.json`.
- Install dependencies with `bun install --frozen-lockfile`.
- Use repository scripts rather than substituting ad hoc commands.
- Run `bun run format` after writes. It formats only changed Git ranges and may
  expand them to their enclosing syntax structures; do not manipulate
  whitespace to satisfy pull-request or file-length guidance.
- Do not commit generated `dist/`, `release/`, logs, or local project artifacts.

## Branches and worktrees

- The lead agent is the Orchestrator for the Issue, repository lifecycle, and
  GitHub record defined in `docs/SDLC.md`. Before assigning or resuming an
  implementation chunk, confirm that its scoped delivery Issue exists; an
  existing branch without one requires a reconciliation Issue first.
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
- Project-schema changes require current-format round-trip and rejection
  coverage. Before v1.0, an MVP iteration may replace the format without
  migration when `docs/MVP.md` says so. Once compatibility is promised,
  migration handling is required.
- Save and export operations must fail safely without stale success state,
  corrupted projects, or partial destination files.
- FFmpeg video support means verified H.264 (`libx264`) and AAC encoder
  capability, not only the presence of an executable.
- Do not bundle FFmpeg or other codec binaries without an explicit licensing and
  distribution decision.

## Validation

Run the smallest sufficient validation while working, then the complete gate
required by the change:

- Every change: `bun run format:check`, `bun run test`, and `bun run build`.
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
  and compatibility, migration, or licensing notes as applicable.

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
  Use the canonical reachability rubric and finding template in
  `docs/REVIEWING.md`, and pass that document to reviewer agents.
  Treat confirmed correctness, security, data-integrity, and missing-test
  findings as merge blockers until resolved or explicitly accepted by the user
  with a linked GitHub issue created before merge.
- The lead agent waits for delegated results, resolves contradictions, and owns
  the final synthesis, validation statement, and merge recommendation.
- Developer and Reviewer work must be possible from the assigned local
  worktree, exact commit range, and supplied Issue/PR snapshot without GitHub, a
  connector, a browser, `gh`, or direct network access. They return
  GitHub-ready text to the Orchestrator instead of becoming repository gateways.
- Follow the substantive-author role-marker and transparent-relay rules in
  `docs/SDLC.md`. Relaying a `## Developer` or `## Reviewer` handoff does not
  transfer worktree, branch, commit, pull-request, merge, or other lifecycle
  authority.
- Do not delegate trivial tasks where coordination cost exceeds likely value.

## Data, media, and licensing

- Never attach copyrighted songs, lyrics, or media to public issues, pull
  requests, tests, or fixtures.
- Use synthetic, generated, redacted, or clearly redistributable examples.
- Call out export-format, codec, font, asset, and binary-distribution licensing
  impact when relevant.

## Handoff

At completion, report:

- the appropriate `## Orchestrator`, `## Developer`, or `## Reviewer` marker as
  the first nonblank line when the handoff is intended for a GitHub post or
  relay;
- the behavior and files changed;
- validation performed and its results;
- manual or environment-dependent checks still required;
- project-format, export, packaging, security, or licensing impact;
- deliberate exclusions and residual risk.
