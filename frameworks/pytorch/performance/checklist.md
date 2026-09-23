# PyTorch Performance & Resource-Efficiency Assessment

> Optional assessment. Its Performance Readiness score is separate from core
> PyTorch integration readiness.

| Field | Value |
|-------|-------|
| **Backend** | _[FILL: backend name and version]_ |
| **PyTorch / backend runtime** | _[FILL: versions]_ |
| **Hardware / driver** | _[FILL: accelerator, host, driver, firmware]_ |
| **Baseline or target** | _[FILL: target and comparable configuration]_ |
| **Evaluation date** | _[FILL: date]_ |

## Performance Readiness

Points: 2 = target met with reproducible evidence; 1 = measured but partial or
below target; 0 = unsupported or missing; N/A = inapplicable. Row weight is
`1 / priority`; N/A rows are excluded.

| Section | Level | Percentage |
|---------|-------|------------|
| Benchmark reproducibility | 1 | |
| Eager execution | 1 | |
| Compiled execution | 2 | |
| Memory and transfers | 2 | |
| Distributed scaling | 3 | |

**Performance Readiness**: _____ %

## 1. Benchmark Reproducibility -- Level: **1**

| # | Item | Priority | Points | Notes |
|---|------|----------|--------|-------|
| 1.1 | Hardware, software versions, precision, and input shape recorded | 1 | | |
| 1.2 | Comparable baseline or target and command recorded | 1 | | |
| 1.3 | Warmup, run count, median, and p95 reported | 2 | | |

## 2. Eager Execution -- Level: **1**

| # | Item | Priority | Points | Notes |
|---|------|----------|--------|-------|
| 2.1 | Representative inference latency meets target | 1 | | |
| 2.2 | Representative training-step throughput meets target | 1 | | |
| 2.3 | p95 latency remains within the stated bound | 2 | | |
| 2.4 | CPU fallback and synchronization overhead measured | 2 | | |

## 3. Compiled Execution -- Level: **2**

| # | Item | Priority | Points | Notes |
|---|------|----------|--------|-------|
| 3.1 | Compile warmup time is measured | 1 | | |
| 3.2 | Steady-state compiled latency or throughput meets target | 1 | | |
| 3.3 | Graph-break or recompilation rate is measured | 2 | | |

## 4. Memory and Transfers -- Level: **2**

| # | Item | Priority | Points | Notes |
|---|------|----------|--------|-------|
| 4.1 | Peak allocated and reserved device memory measured | 1 | | |
| 4.2 | Host-to-device transfer bandwidth or overlap meets target | 2 | | |
| 4.3 | No unexpected memory growth in a repeated workload | 2 | | |

## 5. Distributed Scaling -- Level: **3**

| # | Item | Priority | Points | Notes |
|---|------|----------|--------|-------|
| 5.1 | Two-device scaling efficiency is measured | 2 | | |
| 5.2 | Multi-node scaling efficiency is measured, when applicable | 3 | | |
