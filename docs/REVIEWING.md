# Adversarial Review Standard

This is the canonical review contract for Okay Karaoke Studio pull requests.
Reviewers use it with the product and delivery contracts in `MVP.md`,
`ROADMAP.md`, and `SDLC.md`. A review should find credible failures in the
change under review, not manufacture blockers from states that production
boundaries already make impossible.

## Review inputs

Before reviewing:

1. Identify the exact base and head commits and inspect the complete diff.
2. Read the pull request's acceptance criteria, deliberate exclusions, and
   validation record.
3. Trace each changed path through the relevant renderer, preload, main-process,
   filesystem, platform, or media boundary.
4. Check the normal path, one realistic failure or recovery path, and one
   cross-boundary integration edge when the change has such a boundary.
5. Apply the validation matrix in `AGENTS.md` and `SDLC.md`; static inspection
   does not substitute for required tests or hands-on evidence.
6. Compare the pull request's stated scope with every changed file and the
   existing-file word diff. Identify unrelated edits and opportunistic cleanup.
7. Verify that implementation, tests, documentation, agent instructions,
   configuration, and pull-request claims describe the same behavior.

## Protect scope and contract meaning

Code is not the only source of behavioral change. Documentation, agent prompts,
CI configuration, issue forms, and pull-request templates can alter product,
review, validation, or delivery obligations. Review those changes with the same
care as implementation.

For every deletion or rewording of an existing contract, description, or
instruction, verify that it is:

- necessary to the declared purpose of the pull request;
- disclosed in the pull-request description;
- justified by an accepted decision or concrete evidence; and
- reflected consistently in the authoritative documentation, implementation,
  and tests that depend on it.

Flag unrelated changes, semantic edits presented as formatting or line-length
cleanup, and unjustified narrowing or broadening of product scope, platform or
compatibility promises, trust boundaries, validation requirements, review
obligations, or user-held acceptance gates. An implementation change that lacks
required documentation is the same class of scope-integrity problem as a
documentation change that no longer matches the implementation.

Scope-integrity findings are evidenced by the diff and the pull request's stated
purpose; they do not require a synthetic runtime trigger to be actionable. When
the same change also creates a reachable behavior failure, report that distinct
impact as a separate runtime/path finding rather than blending the two evidence
contracts.

## Classify findings before reachability

Every actionable finding uses exactly one finding class:

- **Runtime/path finding** — a current, accepted-dependent, platform, failure,
  or internal path produces incorrect or unsafe behavior.
- **Scope-integrity finding** — the diff itself contains an unrelated,
  undisclosed, unjustified, or inconsistent change to an obligation or contract.

Only a runtime/path concern uses exactly one of these reachability labels:

- **Current product path** — a user can reach the state through the current UI,
  keyboard or accessibility commands, application menus, or another supported
  workflow.
- **Accepted dependent behavior** — an accepted, in-scope delivery slice relies
  on the changed interface or state. A hypothetical feature or roadmap item is
  not enough.
- **Platform/failure path** — the operating system, Electron, IPC ordering,
  asynchronous completion, filesystem, media process, cancellation, retry, or
  recovery behavior can reach the state without contrived code changes.
- **Internal invariant only** — a direct internal call or synthetic test can
  represent the state, but no current, accepted-dependent, platform, or credible
  failure path has been demonstrated.
- **Not reachable under an enforced boundary** — a shared code boundary rejects
  the state for every relevant entry point, and focused evidence covers that
  enforcement. Use this label when recording why a concern is not actionable.

**Not reachable under an enforced boundary** is a non-finding disposition. It
cannot be carried as an accepted residual unless the reviewer identifies a
separate actionable failure in the enforcement or its required validation.

Do not make a finding merge-blocking solely because an internal API can
represent the state. Demonstrate a current product, accepted-dependent,
platform, or credible failure path. If a state is intended to be impossible,
prefer enforcing and testing that boundary over adding complexity to the core
state machine.

Visual UI assumptions are not enforced boundaries. Hidden or disabled controls
do not by themselves constrain application menus, native window events, IPC
messages, asynchronous completions, failure recovery, or accessibility paths.
An interface restriction counts as enforced only when all relevant entry points
converge on a checked boundary and the evidence covers it.

## Finding contract

Return findings first, ordered by severity. Every actionable finding includes:

- **Severity and confidence** — distinguish demonstrated impact from uncertainty.
- **Location** — exact file and line, or the smallest owning symbol when line
  anchors are unstable.
- **Finding class** — `Runtime/path finding` or `Scope-integrity finding`.
- **Impact** — the resulting user or system harm, including data, security,
  correctness, recovery, latency, accessibility, or governance consequences.
- **Smallest defensible correction** — identify the narrowest code, boundary,
  documentation, or scope correction that resolves the evidence.
- **Required validation** — name the focused regression test or manual/platform
  evidence that would prove the correction.

A runtime/path finding additionally includes:

- **Reachability** — one runtime label from the list above.
- **Concrete trigger** — the smallest exact action, event, and completion order
  that reaches the failure.
- **Boundary evidence** — the call path, event path, or missing guard that makes
  the trigger credible.
- **Preventing invariant** — state whether prevention is mechanically enforced,
  merely assumed by the current UI, or absent.

A scope-integrity finding instead includes:

- **Declared scope or contract** — the pull-request claim or existing obligation
  against which the diff is being judged.
- **Diff evidence** — the exact unrelated file, deletion, addition, or rewording.
- **Integrity failure** — identify the undisclosed change, semantic cleanup,
  unjustified narrowing or broadening, or implementation/documentation mismatch.
- **Consistency evidence** — identify affected documentation, implementation,
  tests, configuration, templates, or agent instructions and whether they agree.

Do not add a runtime reachability label, event-order trigger, boundary path, or
preventing invariant to a pure scope-integrity finding. Its class-specific diff
evidence replaces those runtime-only fields.

A runtime/path finding is merge-blocking when it demonstrates a credible
correctness, security, data-integrity, accepted-behavior, or
required-validation failure. A scope-integrity finding is merge-blocking when
the pull request contains unrelated behavior or silently or unjustifiably
changes an authoritative obligation. Maintainability is actionable only when
the reviewer identifies a concrete failure risk; style preferences and
speculative future callers are not findings.

For interactive timing, playback, and drag paths, evaluate both correctness and
real-time responsiveness. A correction is not complete if it prevents a rare
state by materially degrading the primary editing experience without measured
justification.

## Accepted residuals require an issue

A confirmed finding remains unresolved until it is fixed or explicitly accepted
by the maintainer. Residual acceptance requires a linked GitHub issue created
before merge; prose in the pull request or a resolved review thread is not a
ticket substitute. Use an existing matching issue rather than creating a
duplicate.

The issue must record:

- the originating pull request and review thread;
- the finding class and all evidence required for that class;
- for a runtime/path finding, its reachability label, concrete trigger,
  boundary evidence, and preventing invariant;
- for a scope-integrity finding, its declared scope or contract, diff evidence,
  integrity failure, and consistency evidence;
- impact, severity, and the reason deferral is acceptable now;
- existing mitigations, enforced invariants, or consistency mechanisms;
- available reproduction evidence and any validation gap;
- acceptance criteria for closing the residual; and
- a target milestone, delivery dependency, or roadmap disposition.

Use the **Accepted review residual** issue form when creating a new ticket and
apply the `accepted-residual` label when that label exists. The review thread
must link the issue, and the issue must link back to the pull request. The
reviewer identifies the residual; only the maintainer can accept it.

Security-sensitive details may instead use a private advisory or other
restricted ticket, with a non-sensitive reference in the pull request.
Unconfirmed theoretical concerns need no issue unless the team chooses to carry
them forward as actionable work.

## Review outcome

After the findings, report:

1. **Recommendation** — `PASS`, `NOT PASS`, or
   `PASS WITH ACCEPTED RESIDUALS` followed by issue links. Do not use the latter
   until the maintainer has explicitly accepted every linked residual.
2. **Residual risk** — remaining uncertainty, even when it is not actionable.
3. **Validation gaps** — exact environment-dependent or manual checks not
   observed by the reviewer.

If there are no actionable findings, say so explicitly. A clean static review
does not claim that unrun gates passed.

## Reusable review assignment

Pass this compact instruction to an independent reviewer along with the branch
or commit range:

> Review `<base>...<head>` independently under `docs/REVIEWING.md`. Read
> `AGENTS.md`, `docs/MVP.md`, `docs/ROADMAP.md`, `docs/SDLC.md`, and
> `CONTRIBUTING.md` before judging the diff. Return findings first and use the
> canonical finding classes and class-specific fields. Apply reachability,
> event-order, boundary, and preventing-invariant fields only to runtime/path
> findings; use declared-contract and diff evidence for pure scope-integrity
> findings. Do not block solely because an internal API can represent a state;
> demonstrate a current, accepted-dependent, platform, or credible failure path.
> Do not treat visual UI restrictions as enforced boundaries. Audit the stated
> scope against every changed file and the existing-file word diff; flag
> unrelated changes, semantic edits disguised as formatting, undocumented
> contract changes, and unjustified narrowing or broadening of obligations.
> Verify that code, tests, documentation, configuration, and PR claims agree. A
> confirmed residual can pass only after explicit maintainer acceptance and a
> linked GitHub issue. Report residual risk and unobserved validation even when
> there are no findings. Do not edit the worktree or manage repository lifecycle.
