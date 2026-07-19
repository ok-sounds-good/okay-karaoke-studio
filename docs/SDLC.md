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

The lead agent acts as the **Orchestrator** for repository lifecycle, Issue and
queue arbitration, and coordination of the GitHub record.
Before the Orchestrator assigns or resumes any implementation chunk,
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

### Issue classification labels

Every open Issue carries at least one relevant canonical classification when it
is created or reconciled. The Orchestrator corrects its labels when scope changes.
Labels support filtering and queue review; they never replace the Issue's scope,
acceptance criteria, dependencies, assignment, or durable decision history.

Broad-purpose labels describe why the Issue exists:

- `feature` — a new or expanded user-facing product capability;
- `infrastructure` — CI, packaging, tooling, or execution infrastructure;
- `tracking` — coordination, reconciliation, or delivery tracking rather than a
  directly implementable change by itself;
- `maintenance` — mechanical repository upkeep that does not change product
  behavior;
- `refactor` — behavior-preserving restructuring or responsibility cleanup;
- `bug` — an observed malfunction or regression; and
- `documentation` — documentation-primary work, not every change that also
  updates documentation.

Delivery-class labels describe the role of a cohesive implementation slice:

- `foundation` — a shared model, contract, or platform foundation;
- `behavior` — user-visible behavior built on established foundations; and
- `hardening` — correctness, resilience, parity, or acceptance hardening.

Use a broad-purpose label plus a delivery class when both add useful information,
such as `feature` + `foundation`, `feature` + `behavior`, `infrastructure` +
`hardening`, or `bug` + `infrastructure`. One canonical label is sufficient when
a second would add no signal. New user behavior is not a `refactor`; classify it
as `feature` and, when it is a delivery slice, `behavior`. GitHub default labels
outside this taxonomy may support transient triage, but `enhancement` does not
replace the canonical `feature` classification.

Every agent-authored GitHub Issue body, pull-request body, review, comment,
rebuttal, status update, and merge rationale starts with the substantive
author's role marker as its first nonblank line: `## Orchestrator`,
`## Developer`, or `## Reviewer`. The marker identifies who made the analysis or
decision, not whose credentials transported it.

Developer and Reviewer execution never depends on GitHub, a connector, a
browser, `gh`, or direct network access. The Orchestrator supplies the scoped
Issue/PR snapshot and exact local commits or diff. Agents other than the
Orchestrator are local-only by default and return GitHub-ready text for relay.

Direct GitHub participation is a fail-closed exception that requires an
explicit per-task assignment. The assignment must name the participating role,
the existing assigned branch, the linked delivery Issue, any existing linked
pull request, and each permitted remote operation. General repository access,
tool availability, silence, or permission from an earlier task is not
authorization. The exception cannot expand the user's authority, the Issue's
scope, or the writer's exclusive file and behavior ownership.

Within that explicit assignment:

- The sole assigned writer may commit only its own scoped changes, push without
  force only its already assigned branch, open or update only that branch's
  linked pull request, read that pull request's review feedback, and post only
  its own comments whose first nonblank line is `## Developer`.
- An independent Reviewer may read that linked pull request and post only its
  own findings-first review whose first nonblank line is `## Reviewer`. Before
  posting, it confirms that the pull-request head exactly matches the locally
  reviewed commit. A changed head requires local rereview and a new exact-head
  recommendation.

Only the Orchestrator may create, switch, move, or remove worktrees; create,
switch, merge, or delete branches; arbitrate Issues, labels, assignments, or the
delivery queue; change a pull request's base; merge a pull request; perform
post-merge verification or cleanup; or prune worktree metadata. A remote
participation assignment never transfers those operations. Repository policy
authorization also does not provide credentials, network, keychain, sandbox, or
approval access, or permit bypassing inherited or managed permissions. Use a
connector or `gh` only for an operation named in the assignment; if the required
access is unavailable, return the local handoff for relay.

An authorized agent posts only its own substantive analysis under its own role
marker. When the Orchestrator transports text instead, the relay contract
applies. A relay preserves the originating `## Developer` or
`## Reviewer` marker and the authored text verbatim. When the authored text does
not already disclose transport,
an immediately adjacent `## Orchestrator` post must state that the content was
relayed verbatim and identify its originating role. Any new Orchestrator
interpretation, acceptance, or decision belongs in a separate `## Orchestrator` post.
Direct posting and relay never grant either role authority beyond the user's
task or transfer the Orchestrator-only operations above.

## Change flow

1. Establish the scoped delivery Issue above before assigning implementation.
   Start its work from an observed MVP workflow blocker, roadmap decision, bug,
   or other recorded evidence.
2. The Orchestrator creates a short-lived branch from current `main`. Use a
   descriptive prefix such as `feature/`, `fix/`, `docs/`, or `chore/`.
3. The Orchestrator or an explicitly authorized writer opens a draft pull
   request early and links and closes the delivery Issue. Keep unrelated changes
   in separate pull requests. Aim for 750–1000 changed lines,
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
   required protected CI checks pass.
7. The Orchestrator squash merges, deletes the branch, and leaves `main` green
   and releasable.

One human approval becomes required when a second maintainer is reliably available.
Until then, pull requests still provide the change record, while a zero-approval
requirement avoids a solo maintainer deadlock.

## Protected hosted CI

CircleCI is the active hosted provider. The repository-owned
`.circleci/config.yml` defines a Linux `unit tests` gate, a pull-request-only
`authorize-native-candidate` approval job, and thin `macOS` and `Windows`
compatibility jobs. CircleCI reports the executable jobs to GitHub as
`ci/circleci: unit tests`, `ci/circleci: macOS`, and `ci/circleci: Windows`.
The protected contexts remain `ci/circleci: macOS` and
`ci/circleci: Windows`; the approval is a workflow-internal control rather than
a new protected context. The previous GitHub Actions definition remains
available, unchanged, at
`.github/workflows/ci.yml.disabled`; its non-workflow extension keeps it from
triggering or consuming GitHub-hosted capacity.

Automatic hosted workflows run only for GitHub pushes to `main` and pull-request
events whose base branch is `main`. Configure the CircleCI GitHub App project
trigger with **PR opened or pushed to, default branch and tag pushes** so open,
reopen, and synchronize events reach the repository workflow guard. The guard
rejects tag pushes, ordinary non-`main` branch pushes, and pull requests targeting
another branch. It also excludes manual and API pipelines; broadening that
contract requires an explicit repository change.

The protected macOS and Windows contexts are merge blockers. On a pull request,
both require the Linux gate and `authorize-native-candidate`, so portable
validation is transitively required and duplicated platform work does not begin
before Linux succeeds and a candidate is deliberately authorized. The approval
job has the expression filter `pipeline.event.name == "pull_request"`. On a push
to current `main`, that filter omits the approval job; CircleCI ignores a
filtered-out dependency, so macOS and Windows still run after Linux succeeds.
The repository trigger, workflow guard, and protected contexts therefore remain
unchanged. This dependency does not claim that `ci/circleci: unit tests`
is itself directly required by the
GitHub ruleset.

A pull-request workflow has three named phases:

1. **Portable phase (`unit tests`).** Run changed-range formatting, the portable
   unit suite, and the renderer build once on Linux.
2. **Authorization phase (`authorize-native-candidate`).** After Linux passes,
   compare the CircleCI revision with the current pull-request head. Approve only
   an exact-head candidate, then record the full commit SHA, the CircleCI actor
   who approved it, and the CircleCI workflow URL or ID. The approval applies
   only to that workflow and revision. A new pull-request head starts a new
   workflow and always requires a fresh approval; approval evidence from an
   older head never carries forward.
3. **Native-candidate phase (`macOS` and `Windows`).** After both prerequisites
   are satisfied, run the native-image decode, live Electron lifecycle, and
   focused style-template atomic-replacement checks, then verify external
   FFmpeg/FFprobe `libx264` and AAC capability and run the sequential
   production-path 14-case H.264/AAC export matrix on both executors.

The approval is a declarative CircleCI workflow job. Do not replace its event
filter with shell inspection, dump environment variables or event payloads, or
enable shell or PowerShell execution tracing to decide whether to authorize a
candidate. If the pull-request head advances after approval, cancel any queued
or running native work for the old head and wait for the new workflow's Linux
gate and fresh approval.

Hosted failures are not retried automatically. After diagnosing a failure and
deciding that another attempt is warranted, use only CircleCI's **Rerun workflow
from failed** action, and only while its revision still equals the current
pull-request head. If the head advances before or while the rerun starts, cancel
the old-head rerun; do not let it consume native executors or treat its result as
current-head evidence. If CircleCI presents another approval hold during a
same-head rerun, record that approval event under the same exact-SHA, actor, and
workflow-evidence rule.

A provider outage, unreachable executor, account-capacity
failure, or job that never starts is recorded as **unavailable — not passed**
and does not satisfy the applicable gate. Never infer a pass from another
platform or from static inspection. A temporary exception requires a new
explicit user decision and a linked Issue; there is no standing outage
exception.

Routine hosted CI is a compatibility backstop, not the primary proof for a
change. The Linux job runs changed-range `bun run format:check`, the portable
unit suite, and the renderer build once. The macOS and Windows jobs run only the
native-image decode smoke, live Electron lifecycle smoke, focused style-template
atomic-replacement check, and production-path video export matrix with externally
installed FFmpeg on their respective platforms.
Broader full-environment macOS and Windows suites belong to a future
official-v1 deployment or release step, not routine pull-request CI, and do not
replace the targeted final Windows MVP acceptance run. Configure
redundant-workflow auto-cancellation in the CircleCI project settings when
available.

At the exact pull-request head, the Developer runs focused checks for the change
plus the complete local regression gates required by the validation matrix and
records the commands, environment, and results. The independent Reviewer reruns
the applicable commands from that exact head and inspects the evidence rather
than accepting the report on trust. The Orchestrator verifies that the two
records and protected statuses agree; it need not become a third full-suite
executor unless a discrepancy or uncovered risk requires investigation.

Routine CircleCI does not capture visual artifacts or build application
packages. For a visual change, the Developer captures the required local
before/after evidence and the Reviewer independently inspects it and exercises
the affected workflow. Electron and packaging changes still run
`bun run dist:dir` under the local validation matrix. The final Windows MVP
candidate receives a separately initiated Windows acceptance run that produces
the installer and unpacked application and exercises the package, font, visual,
project, and media gates; that final-candidate proof is not charged to every
pull request.

Changing CI providers does not close Windows x64 MVP validation, the final
user-held product-acceptance gate, or the FFmpeg redistribution decision in
`MVP.md`.

## Definition of done

A change is done when:

- Task acceptance criteria are met. Any supporting MVP scope change is explicit,
  evidence-backed, and tied to the user-held product gate.
- `bun run test` and `bun run build` pass.
- `bun run dist:dir` passes when Electron, packaging, preload, or main-process code
  changes.
- A separately initiated final Windows MVP acceptance run produces an unsigned
  x64 NSIS installer and unpacked app, launch-smokes the package, and runs the
  applicable font, visual, project, and H.264/AAC media gates.
- `bun run test:video` passes when video rendering, audio muxing, frame planning,
  or media-process code changes.
- User-visible behavior is checked manually; visual changes include before/after
  evidence in the pull request at the required desktop sizes. The Reviewer
  inspects that evidence and the affected workflow rather than treating a
  passing geometry assertion or hosted smoke check as a design review.
- During the clean-slate pre-v1 MVP, project-schema changes include exhaustive
  current-format round-trip coverage and clear rejection of unsupported earlier
  artifacts. Migration coverage becomes required once the product promises
  compatibility with a prior format.
- Format or export changes include fixtures, validation, and licensing notes.
- The repository is licensed under GNU GPL v3.0 or later
  (`GPL-3.0-or-later`). Any FFmpeg redistribution policy remains a separate
  user-held decision. Do not change license files, package license metadata, or
  bundled-binary policy without explicit user direction.
- Documentation and the relevant release or roadmap status are updated.
- Every accepted review residual links to its GitHub issue, and that issue
  records its finding class and class-specific evidence, impact, deferral
  rationale, and closure criteria.

## Recommended `main` ruleset

Create one repository branch ruleset named `protect-main` in **Settings → Rules →
Rulesets**. Target the default branch and set enforcement to **Active**. The
required check names are `ci/circleci: macOS` and `ci/circleci: Windows`; use a
protected pull request to confirm enforcement. Both jobs require
`ci/circleci: unit tests`, so that upstream gate must pass before either
protected context can succeed.

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

This repository is public and protects `main` with a repository ruleset. When a
protected context is renamed or added, update the ruleset as part of that CI
change and confirm the exact context names on a protected pull request before
merge.

## Releases

Create releases only from green `main`. Do not describe version 0.1 as
product-accepted until the user-held gate in [`MVP.md`](./MVP.md) closes. Before
the next distributable release, add a release checklist covering versioning,
clean installation, the gated video smoke test, artifacts, signing/notarization
where applicable, checksums, release notes, and known limitations.

An emergency bypass is for restoring the delivery process or addressing an urgent
security issue. Document why it was used, validate immediately afterward, and
return `main` to the normal pull-request flow.
