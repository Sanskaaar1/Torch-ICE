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
ignores the explicit repairs or incorporated shared rule. Its overall section
weighting also has an explicit normalization denominator. For the general
control, reject framework-assessment findings. In every trial, check that
`--performance` is described as also producing an assessment, citation ranges
include supporting changed lines, blocker findings precede minor findings,
and the recommendation says “Changes needed before merge; advisory review”
when a blocker remains. Record pass/fail per topic, false positives, latency,
model, prompt hash, and usage from the JSON replay artifact. The replay runner
never posts to GitHub.

PR #10 is a second pinned regression case at base
`b851531d6a4ede30d8dcc2d27e78642a80491e20` and head
`06ee66c3ab960ded7b55c38b99ecb9a2653a51c4`. Its changed `SKILL.md`
unconditionally promises scored workload modes and a single readiness report,
while the existing private-backend path selects a narrative template and a
different report filename. Each PR #10 trial must identify that conflict with
a changed-line citation and must not add framework-assessment findings.

PR #8 is the larger, stale-branch control: its PR diff starts at
`deb0cf6c036bad9e6206321e8aca360eeeb3aadf`, while its direct comparison
uses base `9f45ba8e4d7e147003556bc5a5935b0e9a0cad57`; both end at
`7590182fe98c5f1ae5448a79302b2c65af6e6491`. Its one live trial must
complete without dropping either view and identify the same performance
dispatch, p95, accelerator-timing, and four execution-rule gaps as PR #9.
