# Review Agent Evidence and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review every path in both the GitHub PR diff and the current-base-to-head diff before posting a successful advisory comment.

**Architecture:** A read-only Git helper produces exact base-to-head patches from the two existing checkouts. An evidence module joins those patches with GitHub's per-file PR patches, splits them into bounded units, and packs sequential review batches. The current agent script validates structured batch results, consolidates findings, and posts only after complete coverage and its existing final SHA check.

**Tech Stack:** Node.js ESM, `node:test`, Git CLI via `execFile`, GitHub REST, OpenAI Responses API; no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-review-agent-evidence-coverage-design.md`

## Global Constraints

- Work on the current `torch-air-review-agent-pr` branch only; do not push, post to GitHub, or change PR #8.
- Preserve the three uncommitted quick-fix files; Task 0 tests and commits them separately so subsequent task commits are self-contained.
- Preserve trusted default-branch execution, exact base/head verification, `persist-credentials: false`, read-only snapshots, redaction, untrusted framing, output sanitization, and final success-post SHA verification.
- Use `execFile`, fixed Git arguments, `--no-ext-diff`, `--no-textconv`, and `--no-color`; do not run PR-head code or diff drivers.
- Batch evidence: at most 20,000 escaped characters per batch, eight batches, and 160,000 escaped characters per run. Keep the 14-minute model deadline and 20-minute workflow limit.
- Review batches sequentially. Share the existing aggregate exploration budget across every batch and retry. Permit at most two model attempts per batch, including output-limit retries.
- A run with missing evidence, invalid coverage, oversized units, exceeded limits, or an unfinished batch posts only a safe failure comment, with no partial findings or success marker.
- Prefix shell commands with `rtk` per `/home/sanspras/.codex/RTK.md`. Use `rtk proxy git diff` only when the filtered diff is unusable as patch data.

---

### Task 0: Preserve the existing quick-fix baseline

**Files:**
- Existing modifications: `.github/prompts/torch-ice-review-agent.md`, `.github/scripts/torch-ice-review-agent.mjs`, `.github/scripts/torch-ice-review-agent.test.mjs`

**Interfaces:**
- Produces: a separate tested commit containing the already-written SHA, section, and shared-budget fixes; Tasks 1–4 build on it.

- [ ] **Step 1: Run the existing focused test and whitespace check.**

```bash
rtk node --test .github/scripts/torch-ice-review-agent.test.mjs
rtk git diff --check
```

- [ ] **Step 2: Commit only the three existing quick-fix files.**

```bash
rtk git add .github/prompts/torch-ice-review-agent.md .github/scripts/torch-ice-review-agent.mjs .github/scripts/torch-ice-review-agent.test.mjs
rtk git commit -m "Guard review output and final PR state"
```

### Task 1: Produce exact current-base diff evidence

**Files:**
- Create: `.github/scripts/torch-ice-review-evidence.mjs`
- Create: `.github/scripts/torch-ice-review-evidence.test.mjs`

**Interfaces:**
- Produces: `collectDirectEvidence({ baseRoot, headRoot, baseSha, headSha }) -> Promise<Array<{ path: string, status: string, patch: string }>>`.
- A deletion and addition from a rename are separate paths; `--no-renames` makes this deterministic.

- [ ] **Step 1: Write a failing synthetic-history test.** Create a temporary seed repo with an initial commit, advance `main` with `src/guard.js`, and make a PR commit from the initial commit that changes `README.md`. Initialize separate `baseRoot` and `headRoot` repos; fetch only the corresponding SHA into each with `git fetch --depth=1` from the seed repo and check it out. The assertion is that `collectDirectEvidence()` includes the missing `src/guard.js` as a deletion even though a merge-base PR diff only changes `README.md`. Use `node:test`, temporary directories, and `execFile`; remove the directories in `finally`.

```js
const evidence = await collectDirectEvidence({ baseRoot, headRoot, baseSha, headSha });
assert.equal(evidence.find((item) => item.path === 'src/guard.js')?.status, 'D');
assert.match(evidence.find((item) => item.path === 'src/guard.js').patch, /-export const guard/);
```

- [ ] **Step 2: Run the focused test and see the missing export fail.**

```bash
rtk node --test .github/scripts/torch-ice-review-evidence.test.mjs
```

- [ ] **Step 3: Implement read-only Git object sharing and per-path patches.** Resolve the head checkout's object directory with `git rev-parse --git-path objects`, pass it as `GIT_ALTERNATE_OBJECT_DIRECTORIES` to Git in the base checkout, then run a NUL-delimited `--name-status` diff followed by a patch diff for each path. Use `execFile` with argument arrays, never a shell; cap each captured patch at 200,000 bytes and fail on overflow. Keep the NUL-delimited name output as a Buffer until after parsing; each status token is followed by one path token because renames are disabled. Prefix all diff calls with these options:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const DIFF_ARGS = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'];
const git = (cwd, args, env) => execFileAsync('git', args, { cwd, env, maxBuffer: 200_000, encoding: 'buffer' });
const names = await git(baseRoot, [...DIFF_ARGS, '--name-status', '-z', baseSha, headSha], env);
const patch = await git(baseRoot, [...DIFF_ARGS, '--patch', baseSha, headSha, '--', filePath], env);
```

Parse NUL-delimited status/path pairs. Keep binary `Binary files ... differ` metadata; do not use `--binary` to inline blob contents. Confirm both SHA objects exist before diffing and throw a bounded evidence error if Git fails.

- [ ] **Step 4: Run the focused test and check the diff.**

```bash
rtk node --test .github/scripts/torch-ice-review-evidence.test.mjs
rtk git diff --check
```

- [ ] **Step 5: Commit only Task 1 files.**

```bash
rtk git add .github/scripts/torch-ice-review-evidence.mjs .github/scripts/torch-ice-review-evidence.test.mjs
rtk git commit -m "Collect current-base review evidence"
```

### Task 2: Make a complete, bounded path inventory

**Files:**
- Modify: `.github/scripts/torch-ice-review-evidence.mjs`
- Modify: `.github/scripts/torch-ice-review-evidence.test.mjs`

**Interfaces:**
- Consumes: `collectDirectEvidence()` from Task 1, untruncated `rawDiff`, and GitHub `/pulls/{number}/files` objects already fetched by the agent.
- Produces: `buildReviewUnits({ githubFiles, rawDiff, directEvidence }) -> Array<{ id: string, path: string, views: Array<'pr'|'base_head'>, evidence: string }>` and `packReviewBatches(units) -> Array<{ ids: string[], units: Array<{ id: string, path: string, views: Array<'pr'|'base_head'> }>, evidence: string }>`.
- The existing agent script escapes and redacts each complete unit's evidence before calling `packReviewBatches()`. Packing measures that final evidence string. Do not send the old truncated `diff` section alongside these batches; it would duplicate evidence and obscure accounting.

- [ ] **Step 1: Write failing unit tests for inventory and packing.** Use GitHub files with `filename`, `previous_filename`, `status`, and `patch`. Include a PR-only path, a direct-only deletion, a path in both views, a rename, and a binary path with explicit binary metadata. Assert every path appears in the sorted inventory, paired view labels remain visible, no unit is silently truncated, and a 20,001-character hunk fails rather than disappearing.

```js
const githubFiles = [
  { filename: 'src/shared.js', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
  { filename: 'src/pr-only.js', status: 'added', patch: '@@ -0,0 +1 @@\n+new' },
];
const directEvidence = [
  { path: 'src/shared.js', status: 'M', patch: '@@ -1 +1 @@\n-old\n+new' },
  { path: 'src/guard.js', status: 'D', patch: '@@ -1 +0,0 @@\n-guard' },
];
const rawDiff = '';
const expectedPaths = ['src/guard.js', 'src/pr-only.js', 'src/shared.js'];
const units = buildReviewUnits({ githubFiles, rawDiff, directEvidence });
assert.deepEqual([...new Set(units.map((unit) => unit.path))], expectedPaths);
assert.match(units.find((unit) => unit.path === 'src/shared.js').evidence, /PR diff[\s\S]*current base to head/);
const oversizedUnits = [{ id: 'u1', path: 'too-large.js', views: ['pr'], evidence: 'x'.repeat(20_001) }];
assert.throws(() => packReviewBatches(oversizedUnits), /Review evidence incomplete/);
```

- [ ] **Step 2: Run the focused test and see the new exports fail.**

```bash
rtk node --test .github/scripts/torch-ice-review-evidence.test.mjs
```

- [ ] **Step 3: Implement deterministic units and sequential packing.** Sort paths lexically so nearby directories stay together. Use both `filename` and `previous_filename`; pair PR and direct patches for a path, labeled by source. Split a file at complete `@@` hunks when needed, repeating path/view metadata in each segment; if a hunk is too large, split at complete diff lines while retaining source line ranges. An indivisible line above 20,000 escaped characters fails. Treat a missing GitHub `patch` as binary only if `rawDiff` or the direct patch explicitly says binary; otherwise fail as missing textual evidence. Escape with the existing `escapeUntrustedSection()` and redact with `redactSensitiveText()` in the agent script before measuring or sending evidence. Use stable `u1`, `u2`, ... unit IDs and keep the exact ID list in each batch.

```js
const batches = [];
for (const unit of units) {
  if (unit.evidence.length > 20_000) throw new Error('Review evidence incomplete: oversized unit.');
  const last = batches.at(-1);
  if (!last || last.evidence.length + 2 + unit.evidence.length > 20_000) batches.push({ ids: [], units: [], evidence: '' });
  const batch = batches.at(-1);
  batch.ids.push(unit.id);
  batch.units.push({ id: unit.id, path: unit.path, views: unit.views });
  batch.evidence += `${batch.evidence ? '\n\n' : ''}${unit.evidence}`;
}
if (batches.length > 8 || batches.reduce((sum, batch) => sum + batch.evidence.length, 0) > 160_000)
  throw new Error('Review evidence incomplete: batch limit.');
```

- [ ] **Step 4: Run tests and commit Task 2.**

```bash
rtk node --test .github/scripts/torch-ice-review-evidence.test.mjs
rtk git diff --check
rtk git add .github/scripts/torch-ice-review-evidence.mjs .github/scripts/torch-ice-review-evidence.test.mjs
rtk git commit -m "Batch complete review evidence by path"
```

### Task 3: Require structured results for every batch

**Files:**
- Modify: `.github/scripts/torch-ice-review-agent.mjs`
- Modify: `.github/prompts/torch-ice-review-agent.md`
- Modify: `.github/scripts/torch-ice-review-agent.test.mjs`

**Interfaces:**
- Consumes: `packReviewBatches()` from Task 2.
- Produces: `validateBatchResult(result, batch) -> Array<Finding>` and `reviewBatches(batches, requestBatch, deadline) -> Promise<Array<Finding>>`.
- `Finding` has `unit_ids`, `category` (`general` or `framework`), `view` (`pr` or `base_head`), `path`, `location`, `evidence`, `impact`, and `fix`.

- [ ] **Step 1: Write failing tests for exact ID accounting and retry.** Accept a result only when `reviewed_unit_ids` matches the assigned batch IDs exactly once and each finding cites an assigned ID. Require the finding's path and view to match at least one cited unit. Mock a malformed or incomplete first attempt and a complete second attempt. Assert a second failure throws and no third request happens; Task 4 checks the post boundary.

```js
const batchU1 = { ids: ['u1'], evidence: 'PR diff: src/a.js', units: [{ id: 'u1', path: 'src/a.js', views: ['pr'] }] };
const deadline = Date.now() + 60_000;
assert.deepEqual(validateBatchResult({ reviewed_unit_ids: ['u1'], findings: [] }, batchU1), []);
assert.throws(() => validateBatchResult({ reviewed_unit_ids: [], findings: [] }, batchU1), /Review evidence incomplete/);
await assert.rejects(reviewBatches([batchU1], async () => ({ reviewed_unit_ids: [], findings: [] }), deadline), /Review evidence incomplete/);
```

- [ ] **Step 2: Run the focused tests and see the new behavior fail.**

```bash
rtk node --test .github/scripts/torch-ice-review-agent.test.mjs
```

- [ ] **Step 3: Add internal batch output mode.** Keep the existing prompt's trust and review rules. Add a trusted batch-stage instruction that applies General Review to assigned evidence and the framework checklist when relevant, then returns only JSON. Use Responses `text.format` with `type: 'json_schema'`, `strict: true`, and a schema with `additionalProperties: false` and required `reviewed_unit_ids` and `findings`; each finding requires every field listed above. The current model and `store: false` remain unchanged. Parse the completed response with `extractResponseText()` and `JSON.parse()`; reject a refusal, incomplete response, invalid JSON, or semantic ID/path/view mismatch. Follow [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) for the exact schema shape.

```js
text: { format: { type: 'json_schema', name: 'review_batch', strict: true, schema: BATCH_RESULT_SCHEMA }, verbosity: 'medium' }
```

- [ ] **Step 4: Run batches sequentially under the shared deadline and tool budget.** Replace the one-shot review call with `reviewBatches()`. Select framework mode from normalized paths in both views, preserving the current assessment-structure criteria. Each batch gets its own relevant changed-file context and the existing trusted checklist when its units are relevant. One invalid/incomplete attempt, including an output-token limit, permits one fresh attempt for that batch; remove the old nested output-limit retry so a batch never gets a third attempt. Keep the existing snapshot exploration tools and a single aggregate `explorationBudget` for all attempts. Do not reset the deadline or budget per batch. `buildReviewInput()` must accept complete batch evidence without applying its old `DIFF_MAX_CHARS` truncation, while retaining the existing bounded metadata/history/context sections and global input ceiling.

```js
const findings = [];
for (const batch of batches) {
  let accepted;
  for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
    if (Date.now() >= deadline) throw new Error('Review evidence incomplete: deadline.');
    try { accepted = validateBatchResult(await requestBatch(batch, attempt), batch); }
    catch (error) { if (attempt === 1) throw error; }
  }
  findings.push(...accepted);
}
```

- [ ] **Step 5: Run tests and commit Task 3.**

```bash
rtk node --test .github/scripts/*.test.mjs
rtk git diff --check
rtk git add .github/scripts/torch-ice-review-agent.mjs .github/scripts/torch-ice-review-agent.test.mjs .github/prompts/torch-ice-review-agent.md
rtk git commit -m "Require complete batch review results"
```

### Task 4: Consolidate findings and finish the public review

**Files:**
- Modify: `.github/scripts/torch-ice-review-agent.mjs`
- Modify: `.github/prompts/torch-ice-review-agent.md`
- Modify: `.github/scripts/torch-ice-review-agent.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: validated `Finding[]` from Task 3.
- Produces: `consolidateFindings({ findings, pr, reviewMode, deadline, requestConsolidation }) -> Promise<string>` and the existing Markdown advisory comment; no public coverage ledger. Production supplies the OpenAI request; tests supply a fake.

- [ ] **Step 1: Write failing integration-style tests with fake model responses.** Feed a PR #8-like two-view inventory through the batch controller; assert the direct-only reverted path appears in a batch and its finding reaches the final General Review output. Also assert incomplete coverage, an oversized hunk, and an updated PR SHA cannot post a success marker. Reuse the existing `postSuccessComment()` mock rather than hitting GitHub or OpenAI.

```js
const escapedUnits = [{ id: 'u1', path: 'src/guard.js', views: ['base_head'], evidence: 'current base to head: src/guard.js\n-guard' }];
const fakeBatchModel = async () => ({ reviewed_unit_ids: ['u1'], findings: [{ unit_ids: ['u1'], category: 'general', view: 'base_head', path: 'src/guard.js', location: 'deleted line 1', evidence: 'guard deleted', impact: 'validation bypassed', fix: 'rebase onto main' }] });
const pr = { number: 8, title: 'Performance assessment' };
const fakeConsolidationModel = async () => ({ groups: [{ finding_ids: ['f1'] }] });
const batches = packReviewBatches(escapedUnits);
assert.ok(batches.some((batch) => batch.evidence.includes('src/guard.js')));
const findings = await reviewBatches(batches, fakeBatchModel, Date.now() + 60_000);
const publicReview = await consolidateFindings({ findings, pr, reviewMode: 'general', deadline: Date.now() + 60_000, requestConsolidation: fakeConsolidationModel });
assert.match(publicReview, /## General Review[\s\S]*src\/guard\.js/);
let successPosts = 0;
await assert.rejects(async () => {
  await reviewBatches(batches, async () => ({ reviewed_unit_ids: [], findings: [] }), Date.now() + 60_000);
  successPosts += 1;
}, /Review evidence incomplete/);
assert.equal(successPosts, 0);
```

- [ ] **Step 2: Run the focused tests and see the missing pipeline fail.**

```bash
rtk node --test .github/scripts/*.test.mjs
```

- [ ] **Step 3: Add one final consolidation request.** Assign stable `f1`, `f2`, ... IDs to validated findings. Supply only those findings, their cited evidence, PR metadata, and review mode. Disable tools for this request. Require strict JSON `groups: [{ finding_ids: string[] }]`; validate that each ID exists and appears at most once. The model may group same-root-cause findings and omit unsupported ones, but cannot provide new finding text. Render the existing advisory Markdown sections from the retained original finding fields, joining paths and evidence examples within a group. For stale-branch regressions with one rebase fix, render one General Review finding with concrete examples. Pass Markdown through existing sanitization and required-section validation, then the existing final SHA recheck and success post. If consolidation fails, use the safe failure path without partial findings.

```js
const findings = await reviewBatches(batches, requestBatch, deadline);
const markdown = await consolidateFindings({ findings, pr, reviewMode, deadline, requestConsolidation });
await postSuccessComment(api, prNumber, `${markdown}\n\n${BOT_MARKER}${headSha}${command.force ? ' attempt=force' : ''} -->`, baseSha, headSha);
```

- [ ] **Step 4: Update README and failure mapping.** Document the two comparison views, eight-batch/160,000-character cap, complete-coverage requirement, one batch retry, and failure-without-partial-output policy. Map `Review evidence incomplete` to a safe public failure reason; logs contain counts and reasons, never raw untrusted evidence.

- [ ] **Step 5: Verify the whole branch and commit Task 4.**

```bash
rtk node --test .github/scripts/*.test.mjs
rtk git diff --check
rtk git status --short
rtk git add .github/scripts/torch-ice-review-agent.mjs .github/scripts/torch-ice-review-agent.test.mjs .github/prompts/torch-ice-review-agent.md README.md
rtk git commit -m "Consolidate complete bounded PR reviews"
```

After Task 4, inspect the full branch diff against the preflight base, confirm only the intended bot and documentation files changed, and stop before any push or GitHub posting.
