## PyTorch Performance & Resource-Efficiency Assessment

Read `frameworks/pytorch/performance/checklist.md`. Copy it to
`torch-ice-report/torch_performance_report_<backend>.md` and keep its score
separate from the core integration-readiness score.

1. Record exact hardware, driver/runtime, backend, PyTorch, model, input,
   precision, batch size, and execution mode for every measurement.
2. Compare only equivalent workloads. Use the stated target or a documented
   baseline; do not imply cross-hardware parity from incomparable setups.
3. Warm up first, then record median and p95 from at least five timed runs.
   Put raw measurements, units, and the command or benchmark source in Notes.
4. Score each row: 2 = target met with reproducible evidence, 1 = measured
   but target missed or coverage is partial, 0 = unavailable or unsupported,
   N/A = no applicable workload or target. Exclude N/A rows.
5. Compute each section percentage with `sum(score * (1 / priority)) /
   sum(2 * (1 / priority)) * 100`. Compute Performance Readiness by weighting
   sections with `1 / level`.

Do not use source inspection alone for a performance score. A missing benchmark
is N/A only when the workload is genuinely inapplicable; otherwise it is 0.
