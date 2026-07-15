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

<!-- Record exact commands/evidence and PASS, FAIL, UNAVAILABLE, or NOT RUN. -->

| Gate                 | Exact command or evidence | Result         |
| -------------------- | ------------------------- | -------------- |
| Changed-range format | `bun run format:check`    |                |
| Test suite           | `bun run test`            |                |
| Build                | `bun run build`           |                |
| Electron/package     | `bun run dist:dir`        | Not applicable |
| Video/media          | `bun run test:video`      | Not applicable |
| Manual workflow      |                           | Not applicable |
| Visual evidence      |                           | Not applicable |

- Environment-dependent or manual gaps:
- Protected `macOS` check and evidence:
- Protected `Windows` check and evidence:

<!-- During the documented Actions outage, use UNAVAILABLE, never PASS. -->

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
