# Software Development Lifecycle

The version 0.1 MVP is the green baseline. The purpose of this process is to keep
`main` releasable while making product and technical decisions easy to audit.

## Change flow

1. Start nontrivial work from a roadmap item or issue with acceptance criteria.
2. Create a short-lived branch from current `main`. Use a descriptive prefix such
   as `feature/`, `fix/`, `docs/`, or `chore/`.
3. Open a draft pull request early. Keep unrelated changes in separate pull
   requests.
4. Record scope, tests, manual checks, project-format impact, export or licensing
   impact, and deliberate exclusions in the pull request.
5. Merge only after the required macOS and Windows CI checks pass and all review
   conversations are resolved.
6. Squash merge, delete the branch, and leave `main` green and releasable.

One human approval becomes required when a second maintainer is reliably available.
Until then, pull requests still provide the change record, while a zero-approval
requirement avoids a solo maintainer deadlock.

## Definition of done

A change is done when:

- Acceptance criteria are met without silently expanding the release scope.
- `bun run test` and `bun run build` pass.
- `bun run dist:dir` passes when Electron, packaging, preload, or main-process code
  changes.
- `bun run test:video` passes when video rendering, audio muxing, frame planning,
  or media-process code changes.
- User-visible behavior is checked manually; visual changes include before/after
  evidence in the pull request.
- Project-schema changes include migration and round-trip regression tests.
- Format or export changes include fixtures, validation, and licensing notes.
- Documentation and the relevant release or roadmap status are updated.

## Recommended `main` ruleset

Create one repository branch ruleset named `protect-main` in **Settings → Rules →
Rulesets**. Target the default branch and set enforcement to **Active**. The MVP
pull request confirms that the existing required check names are `macOS` and
`Windows`; use the first protected pull request to confirm enforcement.

Configure:

- Restrict deletions.
- Block force pushes.
- Require a pull request before merging. Use zero required approvals when there
  is no reliable second maintainer; otherwise require one approval.
- Require all conversations to be resolved.
- Require the existing `macOS` and `Windows` status checks.
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

Create releases only from green `main`. Before the next distributable release,
add a release checklist covering versioning, clean installation, the gated video
smoke test, artifacts, signing/notarization where applicable, checksums, release
notes, and known limitations.

An emergency bypass is for restoring the delivery process or addressing an urgent
security issue. Document why it was used, validate immediately afterward, and
return `main` to the normal pull-request flow.
