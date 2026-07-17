## Developer

<!-- Keep the substantive author's role marker as the first nonblank line. -->
<!-- If relayed, disclose verbatim Orchestrator transport here. -->

Closes #

## Issue contract

- Delivery Issue:
- Problem or evidence:
- Acceptance criteria addressed:
- Deliberate exclusions:

## Change

<!-- Summarize the smallest coherent solution. -->

## Validation

<!-- Record exact commands/evidence and PASS, FAIL, UNAVAILABLE, NOT RUN, or -->
<!-- NOT APPLICABLE — <reason>. NOT APPLICABLE is valid only with a concrete -->
<!-- applicability rationale; a blank conditional row is not an exemption. -->

| Gate                 | Exact command or evidence | Result |
| -------------------- | ------------------------- | ------ |
| Changed-range format | `bun run format:check`    |        |
| Test suite           | `bun run test`            |        |
| Build                | `bun run build`           |        |
| Electron/package     | `bun run dist:dir`        |        |
| Video/media          | `bun run test:video`      |        |
| Manual workflow      |                           |        |
| Visual evidence      |                           |        |

- Environment-dependent or manual gaps:
- Upstream `ci/circleci: unit tests` check:
- `authorize-native-candidate` exact-head approval:
  - Full commit SHA:
  - Approving CircleCI actor:
  - CircleCI workflow URL or ID:
- Protected `ci/circleci: macOS` compatibility check:
- Protected `ci/circleci: Windows` compatibility check:

<!-- UNAVAILABLE is never PASS. A temporary required-check exception requires -->
<!-- an explicit user decision and a linked Issue under docs/SDLC.md. -->
<!-- A new pull-request head requires a fresh approval record. -->

## Impact review

- Project-format or migration impact:
- Export-format, codec, rights, or licensing impact:
- Packaging or security-update impact:
- Documentation impact:

## Adversarial review record

- Exact base and head:
- Canonical `## Reviewer` review link and recommendation:
- `## Developer` response or rebuttal links:
- Exact-head rereview link:
- Accepted residual Issues: None

<!-- Keep later Reviewer, Developer, and Orchestrator judgment in separate -->
<!-- role-marked reviews/comments instead of silently rewriting their history. -->

## Release note

<!-- User-visible summary, or "None". -->
