# Review agent evidence and coverage design

## Goal

Make the advisory review agent inspect both what a PR introduced and what its
head would change relative to the current base. Every changed path from either
comparison must receive a bounded review pass before the agent posts a success
comment. This addresses stale branches such as PR #8, where GitHub's PR diff
did not present current-base reversions as direct changes.

This design covers evidence and review coverage. Prior-finding reconciliation
across reruns and a general review-quality evaluation suite are separate work.

## Evidence

- Keep the GitHub PR files and textual PR diff as the introduced-change view.
- From the workflow's already verified exact base and head checkouts, compute a
  read-only base-commit-to-head-commit diff. Use `execFile`, fixed Git arguments,
  `--no-ext-diff`, `--no-textconv`, and `--no-color`; make the head checkout's
  object directory available to Git in the trusted base checkout without a
  network fetch. Never execute PR-head code or Git diff drivers.
- Build review units from the union of paths in both views. A rename contributes
  both its old and new paths. Keep paired evidence for a path together and label
  each excerpt `PR diff` or `current base to head` so the model does not confuse
  branch divergence with an author-introduced patch.
- Require inspectable patch evidence for textual changes and change metadata
  for binary files. Missing or oversized evidence is an incomplete review, not
  a silently omitted path. Escape and redact all new evidence using the
  existing untrusted-input safeguards.

GitHub documents that PRs use a merge-base comparison while a direct
base-to-head diff compares the current endpoints:
https://docs.github.com/en/pull-requests/reference/branches.

## Review flow

- Pack related review units into deterministic batches. Each batch contains at
  most 20,000 characters of escaped diff evidence. Split an oversized file by
  hunk or line span, retaining its path, source view, and line range. Do not
  truncate a unit and call it covered.
- Permit at most eight batches and 160,000 characters of diff evidence across
  the run. Keep the existing 14-minute model deadline and 20-minute workflow
  limit. Run batches sequentially and share the existing exploration budget
  across them and retries.
- Each batch applies General Review to its assigned units and the framework
  checklist when its units are relevant. It returns internal structured data:
  the exact IDs of units reviewed plus evidenced findings with category,
  source view, path/hunk, impact, and fix. These coverage dispositions are not
  posted publicly. Reject missing, extra, or duplicate unit IDs.
- The controller tracks all planned unit IDs. After every batch completes, one
  consolidation pass merges findings with the same root cause, checks their
  supplied evidence, and renders the existing advisory Markdown format.
  It may drop unsupported findings but must not invent new ones. For a stale
  branch, report concrete regressions and consolidate those sharing a rebase
  fix into one General Review finding with examples.
- Retain the current output sanitization, required-section check, exact-SHA
  verification immediately before success posting, deduplication marker, and
  read-only workflow boundary.

## Failure behavior and verification

- Retry an incomplete or malformed batch once if the deadline permits. The
  two attempts include output-length retries; there is no third batch attempt.
  If a batch still fails, a unit cannot fit, the batch count would exceed
  eight, or the deadline expires, post only the safe failure comment. Do not
  post partial findings or a success marker. Log counts and the reason without
  leaking untrusted content.
- Use a PR #8-like fixture whose merge-base diff omits a current-base
  regression. Assert the direct diff exposes it and the path enters a batch.
  Test union-path accounting, paired evidence labels, rename/binary handling,
  oversized units, retry-once failure, budget exhaustion, consolidation, and
  no success post on incomplete coverage or SHA change.
- An internal coverage disposition proves that evidence was presented and a
  batch completed; it cannot prove that the model found every defect. Assess
  semantic detection with the later review-quality fixture work.
