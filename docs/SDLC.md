# Software Development Lifecycle

`main` is the technically green, releasable baseline. Version 0.1 product
acceptance remains open and is held by the user until they make and accept a
karaoke video for a new song with the Studio. The purpose of this process is to
preserve that technical baseline while making product and technical decisions
easy to audit.

## Authoritative contracts and checkpoints

The copies of `docs/MVP.md`, `docs/SDLC.md`, and `docs/ROADMAP.md` on `main` are
authoritative. A checkpoint or extraction branch is implementation evidence and
a source of tested code; its documentation never overrides newer decisions on
`main`.

Before extracting implementation from a checkpoint, bring the authoritative
documents from `main` into that checkpoint with `main` winning every
documentation conflict. Start each delivery slice from current `main` and port
only the cohesive implementation and tests that belong to that slice. Do not
merge a checkpoint wholesale merely because its integrated test suite passed.

## Durable Issue and authorship record

The lead agent acts as the **Orchestrator** for repository lifecycle and required
GitHub I/O. Before the Orchestrator assigns or resumes any implementation chunk,
a durable, scoped GitHub Issue must exist. The Issue records the motivating
problem or evidence, scope, deliberate exclusions, acceptance criteria,
dependencies, and assignment. A roadmap entry, chat instruction, branch name,
or local handoff is not a substitute.

An existing active branch without that record must receive a reconciliation
Issue before its implementation resumes. Preserve recovered assignment,
validation, review, and decision context under a clearly labeled **Transcribed
history** section, including its source and date when known; do not present
reconstructed context as a contemporaneous GitHub exchange.

The Issue and linked pull request collectively retain:

- scope, exclusions, and acceptance criteria;
- implementation assignment and status;
- exact validation commands, results, and unrun or unavailable gates;
- review findings, Developer responses or rebuttals, and exact-head rereviews;
- accepted-residual decisions and their linked Issues; and
- the Orchestrator's exact-head merge recommendation and rationale.

The implementation pull request must link and close its delivery Issue with a
GitHub closing keyword such as `Closes #123`. Related discovery or residual
Issues may also be linked, but they do not replace that primary delivery record.

Every agent-authored GitHub Issue body, pull-request body, review, comment,
rebuttal, status update, and merge rationale starts with the substantive
author's role marker as its first nonblank line: `## Orchestrator`,
`## Developer`, or `## Reviewer`. The marker identifies who made the analysis or
decision, not whose credentials transported it.

Developer and Reviewer execution never depends on GitHub, a connector, a
browser, `gh`, or direct network access. The Orchestrator supplies the scoped
Issue/PR snapshot and exact local commits or diff, then transports GitHub-ready
text when needed. A relay preserves the originating `## Developer` or
`## Reviewer` marker and the authored text verbatim. When the authored text does
not already disclose transport, an immediately adjacent `## Orchestrator` post
must state that the content was relayed verbatim and identify its originating
role. Any new Orchestrator interpretation, acceptance, or decision belongs in a
separate `## Orchestrator` post. Transport never grants the originating agent or
the Orchestrator authority beyond the user's task, and it does not transfer the
lead-owned lifecycle operations listed in `AGENTS.md`.

## Change flow

1. Establish the scoped delivery Issue above before assigning implementation.
   Start its work from an observed MVP workflow blocker, roadmap decision, bug,
   or other recorded evidence.
2. Create a short-lived branch from current `main`. Use a descriptive prefix such
   as `feature/`, `fix/`, `docs/`, or `chore/`.
3. Open a draft pull request early, and link and close the delivery Issue. Keep
   unrelated changes in separate pull requests. Aim for 750–1000 changed lines,
   counting additions and deletions, so an adversarial reviewer can understand
   the complete diff. This is a soft limit: a documented invariant class may
   exceed it when splitting schema, trust-boundary, persistence, or
   renderer/export parity changes would make the result less safe or less
   reviewable.
   Formatting never counts as a way to meet this target. A dedicated
   whole-repository formatter pass may receive a complete-invariant exception
   only after full behavior-preservation gates and an independent adversarial
   review find no formatting-induced semantic change.
4. Record scope, tests, manual checks, project-format impact, export or licensing
   impact, and deliberate exclusions in the pull request. For MVP work, record
   the observation from the real-song attempt and any supporting contract
   criterion added, removed, or revised.
5. Prefer a sequence of cohesive **Foundation**, **Behavior**, and **Hardening**
   pull requests. Minimize duplicated invariants and cross-module dependencies;
   never split a security or data-integrity invariant solely to satisfy the line
   target.
6. Obtain an independent adversarial review using the reachability and finding
   contract in [`REVIEWING.md`](./REVIEWING.md). A confirmed finding remains a
   merge blocker until it is fixed or the maintainer explicitly accepts it with
   a linked GitHub issue created before merge. Merge only after the review
   passes at the exact head, all review conversations are resolved, and the
   required macOS and Windows CI checks pass.
7. Squash merge, delete the branch, and leave `main` green and releasable.

One human approval becomes required when a second maintainer is reliably available.
Until then, pull requests still provide the change record, while a zero-approval
requirement avoids a solo maintainer deadlock.

## Protected hosted CI

CircleCI is the active hosted provider. The repository-owned
`.circleci/config.yml` defines parallel `macOS` and `Windows` jobs, reported to
GitHub as `ci/circleci: macOS` and `ci/circleci: Windows`. The previous GitHub
Actions definition remains available, unchanged, at
`.github/workflows/ci.yml.disabled`; its non-workflow extension keeps it from
triggering or consuming GitHub-hosted capacity.

Both CircleCI contexts are merge blockers. A provider outage, unreachable
executor, account-capacity failure, or job that never starts is recorded as
**unavailable — not passed** and does not satisfy the platform gate. All feasible
local and environment-dependent checks remain mandatory, but never infer a pass
from another platform or from static inspection. A temporary exception requires
a new explicit user decision and a linked Issue; there is no standing outage
exception.

CircleCI stores each platform's validated production-window evidence directory.
Artifact retention is controlled by the CircleCI plan rather than
`.circleci/config.yml`; retain the prior 14-day target in **Plan → Usage Controls**
when the active plan exposes that setting. Configure redundant-workflow
auto-cancellation in the CircleCI project settings when available.

Changing CI providers does not close Windows x64 MVP validation, the final
user-held product-acceptance gate, or the public-distribution license and FFmpeg
decisions in `MVP.md`.

## Definition of done

A change is done when:

- Task acceptance criteria are met. Any supporting MVP scope change is explicit,
  evidence-backed, and tied to the user-held product gate.
- `bun run test` and `bun run build` pass.
- `bun run dist:dir` passes when Electron, packaging, preload, or main-process code
  changes.
- The final Windows MVP candidate produces an unsigned x64 NSIS installer and
  unpacked app in Windows CI, launch-smokes the package, and runs the applicable
  font, visual, project, and H.264/AAC media gates.
- `bun run test:video` passes when video rendering, audio muxing, frame planning,
  or media-process code changes.
- User-visible behavior is checked manually; visual changes include before/after
  evidence in the pull request. For Video Style Editor changes, the protected
  macOS and Windows jobs also capture ordered 1280 x 720 production-window
  evidence; inspect those short-lived artifacts rather than treating a passing
  geometry assertion as a design review.
- During the clean-slate pre-v1 MVP, project-schema changes include exhaustive
  current-format round-trip coverage and clear rejection of unsupported earlier
  artifacts. Migration coverage becomes required once the product promises
  compatibility with a prior format.
- Format or export changes include fixtures, validation, and licensing notes.
- The public-distribution license and any FFmpeg redistribution policy remain
  user-held decisions. Do not change license files, package metadata, or bundled
  binary policy without explicit user direction.
- Documentation and the relevant release or roadmap status are updated.
- Every accepted review residual links to its GitHub issue, and that issue
  records its finding class and class-specific evidence, impact, deferral
  rationale, and closure criteria.

## Recommended `main` ruleset

Create one repository branch ruleset named `protect-main` in **Settings → Rules →
Rulesets**. Target the default branch and set enforcement to **Active**. The
required check names are `ci/circleci: macOS` and `ci/circleci: Windows`; use a
protected pull request to confirm enforcement.

Configure:

- Restrict deletions.
- Block force pushes.
- Require a pull request before merging. Use zero required approvals when there
  is no reliable second maintainer; otherwise require one approval.
- Require all conversations to be resolved.
- Require the existing `ci/circleci: macOS` and `ci/circleci: Windows` status
  checks.
- Require branches to be up to date before merging.
- Require linear history and squash merges.
- Do not grant Write or Maintain roles a bypass. If an emergency escape hatch is
  necessary, grant repository administrators **For pull requests only** so the
  exception still leaves a pull request and audit trail.

Also enable squash merging and automatic head-branch deletion in the repository's
pull-request settings. Do not add signed-commit, merge-queue, deployment, code-owner,
or coverage gates until the project has the people and stable automation to support
them.

GitHub documents ruleset availability and layering in [About
rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
the setup and bypass flow in [Creating rulesets for a
repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository),
and each protection in [Available rules for
rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

This repository is currently private. GitHub currently makes repository rulesets
for private repositories available on Pro, Team, and Enterprise Cloud plans. If
the account plan does not expose rulesets, use the equivalent classic branch
protection settings or revisit protection when the repository becomes public.

## Releases

Create releases only from green `main`. Do not describe version 0.1 as
product-accepted until the user-held gate in [`MVP.md`](./MVP.md) closes. Before
the next distributable release, add a release checklist covering versioning,
clean installation, the gated video smoke test, artifacts, signing/notarization
where applicable, checksums, release notes, and known limitations.

An emergency bypass is for restoring the delivery process or addressing an urgent
security issue. Document why it was used, validate immediately afterward, and
return `main` to the normal pull-request flow.
