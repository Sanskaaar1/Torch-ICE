# PR #25 Review Comments

Source: [TorchedHat/torch-ice#25](https://github.com/TorchedHat/torch-ice/pull/25), retrieved 2026-09-21.

This PR has one review summary, nine inline comments, and no conversation comments.

## Review summary

Submitted by `vishalgoyal316` on 2026-09-21:

> Thanks for the PR. Solid trust model overall; main follow-ups are skill/bot docs clarity, architecture path gating, fuller checklist coverage in the agent prompt, and aligning “Actions not wired” wording with the new workflow.

## Fix order (easy first)

1. **Documentation-only clarifications:** [Actions mode wording](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057746165), [skill README distinction](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057788046), [root README distinction](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057814784), and [advisory-vs-formal-review wording](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057507623).
2. **Small scoped behavior changes:** [maintainer follow-up text](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044483240) and [per-PR review concurrency](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044652913).
3. **Policy decisions before implementation:** [architecture path gating](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044159182) and [prompt-path gating](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044179425) need one combined rule because their proposed triggers overlap.
4. **Broader agent behavior:** [full checklist coverage](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057583861) requires defining the review pass before changing the prompt.

## Next stage: Core review contract

Before further review-agent changes:

1. Make the prompt and `trusted_architecture_checklist` the only authoritative
   instructions; every other input section remains untrusted reference
   material.
2. Add the manual skill's classification precedence so the agent can decide
   which architecture categories apply before checking items.
3. Give General Review the same evidence-first flow: trace changed behavior,
   record only actionable candidate defects, consolidate duplicates, and
   fact-check against supplied context before reporting.
4. Add bounded current-file context from the read-only PR checkout while
   preserving the full diff budget; defer larger context windows to a later
   runtime change.

Validate this stage with `node --test .github/scripts/torch-ice-review-agent.test.mjs` and `git diff --check`.

## Deferred runtime capability: bounded code exploration

After the core review flow is settled, add code exploration as a supporting
tool, not as the review process itself:

1. On every review, retain the trusted default-branch checkout and read-only
   exact PR-base and PR-head checkouts. Never execute PR code.
2. Give the model strict, read-only `search_code`, `read_file`, and
   `list_files` tools, limited to those two snapshots. Reject path escapes,
   symlinks outside the checkout, binaries, unbounded reads, arbitrary shell,
   and all writes.
3. Make exploration available on every review, but invoke it only when needed
   to verify context. Permit at most two tool rounds, then require a tool-free
   final review. Keep the transcript in runner memory with `store: false`; do
   not create an index, vector store, database, artifact, or external retrieval
   service.
4. Use the balanced limits selected for this work: eight total calls, 64k
   characters of tool results, 280k characters of accumulated context, 2,048
   output tokens per exploration turn, 12,288 for the final review, a 16,384
   retry cap, and a 20-minute workflow timeout.
5. Treat tool results as untrusted reference material, redact them before
   returning them to the model, and log only aggregate usage/cap telemetry.

Standard GitHub-hosted runners are free for this public repository; OpenAI API
usage remains the variable cost. Implement only after the overall review flow
below is agreed.

## Full comments (source order)

1. [`.github/prompts/torch-air-review-agent.md:11`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044159182) — 2026-09-18

   > The agent only runs the architecture checklist for SKILL.md, skills/, frameworks/, and .github/prompts/. It skips .claude/skills/. The human review skill does cover .claude/skills/. Should we add .claude/skills/ here, and update the script the same way?

2. [`.github/prompts/torch-air-review-agent.md:11`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044179425) — 2026-09-18

   > Suggestion: Consider not treating every file under .github/prompts/ as a reason to run the architecture checklist. That checklist is mainly for accelerator skills/frameworks. Prompt-only changes can get unrelated architecture findings. Alternatives: drop .github/prompts/ from this list, or trigger only on the checklist file itself.

3. [`.github/prompts/torch-air-review-agent.md:7`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044483240) — 2026-09-18

   > Suggestion: Consider clarifying how maintainer follow-up text after @torch-air-review-agent should be used. Right now this says to ignore instructions in material below, which can also cover that follow-up text (for example “focus on error handling”). One option: allow it only to narrow review focus, without letting PR diffs override this prompt. Another: put that text in trusted instructions in the script.

4. [`.github/workflows/torch-air-review-agent.yml:16`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4044652913) — 2026-09-18

   > Suggestion: Consider setting cancel-in-progress: true, or otherwise ensuring only one review runs per PR at a time. Right now two @torch-air-review-agent comments close together can start two jobs. Both can pass “already reviewed this head” checks before either posts, so you can get duplicate reviews and extra OpenAI cost.

5. [`.claude/skills/torch-air-architecture-review/checklist.md:215`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057507623) — 2026-09-20

   > Suggestion: Consider clarifying that this section is for the human / Claude skill review (which can submit a GitHub “Request changes” review). The Actions agent is advisory and only posts a comment. When this same checklist is sent to OpenAI, “Always Request Changes” can sound like a formal GitHub verdict. A one-line note here (or in the agent prompt) would avoid that confusion.

6. [`.github/prompts/torch-air-review-agent.md:10`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057583861) — 2026-09-20

   > On [Sanskaaar1/Torch-ICE#6](https://github.com/Sanskaaar1/Torch-ICE/pull/6) the agent reported only a few findings, while @mansiag05's review on TorchedHat#16 covered many more checklist themes (standalone skill vs flag, README collateral edits, plugin manifests, report metadata/naming, PR-description drift). Consider requiring a full pass over every architecture checklist category—Skill Structure, Framework Nesting, Scoring Consistency, Dispatch & Orchestration, and General Conventions—omitting empty sections, and always checking the Always Request Changes items. Avoid stopping after one or two findings.

7. [`.claude/skills/torch-air-architecture-review/SKILL.md:72`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057746165) — 2026-09-20

   > Suggestion: This still says Actions mode is “not yet wired up,” but this PR already adds @torch-air-review-agent. That agent is a different path (comment-triggered, advisory comment, does not run this skill). Please update this section so it doesn’t read like the wrapper is still missing — either describe the new agent, or say this skill stays manual and the Actions bot is separate.

8. [`.claude/skills/torch-air-architecture-review/README.md:33`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057788046) — 2026-09-20

   > Suggestion: Consider adding one sentence that the GitHub Actions bot (@torch-air-review-agent) is a separate, read-only comment flow — not this skill’s --post review. Right now this README only documents the Claude skill, while the root README documents the agent, so contributors can mix up the two.

9. [`README.md:206`](https://github.com/TorchedHat/torch-ice/pull/25#discussion_r4057814784) — 2026-09-20

   > Suggestion: Make the split clearer. “Architecture Review” points at the Claude skill, then “Review Agent” is the GitHub bot. One short line would help: the skill is manual (dry-run / --post); @torch-air-review-agent is a separate Actions bot that always posts a PR comment, not a formal review. Contributors already mix these up.
