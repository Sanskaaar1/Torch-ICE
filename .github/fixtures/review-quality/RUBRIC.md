# Review-quality replay rubric

The original fixture pins PR #9 at base `1bb34963cb395d1d1c5e849a279ad38a06ad88c6`
and head `134115efd4be8377a933b94894d4616907e3f5df`. The posted
review at `https://github.com/Sanskaaar1/Torch-ICE/pull/9#issuecomment-5888856543`
is the historical baseline: it found dispatch, invocation examples, executive
summary, and provenance, and missed the measurement and execution items below.

Score each live original trial by reading its rendered findings. Credit a
topic only when a finding explains the concrete defect and cites the changed
source. Related topics may share one finding if each is stated clearly.

- Dispatch: the performance checklist is selected but its `EVAL.md` is not
  loaded by `--performance` or `--all`. This is blocking.
- p95 sample: five measured runs after warmup do not support a useful p95.
  This is blocking when the report claims a tail-latency result.
- Accelerator timing: no synchronization, completed device events, or
  equivalent harness is specified for asynchronous work. This is blocking.
- Failure isolation: the new dimension's instructions do not explicitly
  carry forward the shared per-probe failure rule.
- Partial report: the new dimension does not explicitly carry forward the
  shared partial-implementation rule.
- Manual verification: the dimension does not specify how to mark benchmarks
  that cannot be verified.
- Report hygiene: the dimension does not say to exclude internal instructions.
- Existing useful findings remain: invocation examples, Executive Summary,
  and Torch-ICE/model provenance.

For the corrected fixture, reject any finding alleging these defects if it
ignores the explicit repairs or incorporated shared rule. For the general
control, reject framework-assessment findings. In every trial, check that
`--performance` is described as also producing an assessment, citation ranges
include supporting changed lines, blocker findings precede minor findings,
and the recommendation says “Changes needed before merge; advisory review”
when a blocker remains. Record pass/fail per topic, false positives, latency,
model, prompt hash, and usage from the JSON replay artifact. The replay runner
never posts to GitHub.
