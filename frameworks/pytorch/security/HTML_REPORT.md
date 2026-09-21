# HTML Security Report Generation

Graphical, **product-management-facing** companion to the security readiness
evaluation. The **markdown checklist is the source of truth**; the HTML renders
the *same* scores, leading with **security levels** and **required actions** so
non-technical stakeholders see posture and next steps at a glance. Full item
detail lives in a collapsed appendix.

Run this **after** the markdown security report is complete
(`torch_security_readiness_report_<backend>.md`). Never invent numbers or
evidence — copy every value from the filled markdown.

## Steps

1. Read the completed `torch-air-report/torch_security_readiness_report_<backend>.md`.
2. Copy `frameworks/pytorch/security/report_template.html` to
   `torch-air-report/torch_security_readiness_report_<backend>.html`.
3. Replace every `{{TOKEN}}` and expand every `REPEAT:x` … `/REPEAT:x` block
   (tables below). Then remove **all** HTML comments — the header and every
   inline hint/`REPEAT` marker — so the final report contains no `{{...}}`
   tokens and no `REPEAT` markers.
4. Output must be a **single self-contained `.html`** — no external files or
   scripts. All styling is inline.

## Band color + label (readiness %)

Same thresholds everywhere (`{{OVERALL_BAND_COLOR}}`, `{{LEVEL_BAND_COLOR}}`,
`{{LD_BAND_COLOR}}`, `{{DOMAIN_BAND_COLOR}}`):

| Readiness % | color | `OVERALL_BAND_LABEL` |
|-------------|-------|----------------------|
| ≥ 70 | `green` | `Production-leaning` |
| 40–69 | `amber` | `Needs hardening` |
| < 40 | `red` | `Not deployment-ready` |

## Verdict (scalars)

| Token | Value |
|-------|-------|
| `{{ACCELERATOR}}`, `{{BACKEND_PACKAGE}}`, `{{VERSION_EVALUATED}}`, `{{PYTORCH_VERSION}}`, `{{DEPLOYMENT_MODEL}}`, `{{TORCH_AIR_VERSION}}`, `{{MODEL}}`, `{{EVALUATION_DATE}}` | From the markdown metadata table |
| `{{OVERALL_PCT}}` | Overall Security Readiness %, integer |
| `{{VERDICT_HEADLINE}}` | One action-oriented line, e.g. `3 critical actions required before shared deployment` |
| `{{OVERALL_SUMMARY}}` | 1–2 sentences from the Executive Summary |

## `REPEAT:level` — exactly 3 cards (levels 1, 2, 3)

Fixed level metadata (do not change):

| `{{LEVEL_NUM}}` | `{{LEVEL_NAME}}` | `{{LEVEL_DESC}}` | domains |
|-----------------|------------------|-----------------|---------|
| `1` | `Foundational` | `Tenant isolation, device-memory encryption, and data scrubbing. Highest weight — unmet Level 1 controls block safe multi-tenant deployment.` | SEC-MT, SEC-ME, SEC-DS |
| `2` | `Production` | `Firmware/driver integrity and host-device transit protection. Expected before production use.` | SEC-HT, SEC-FD |
| `3` | `Integration` | `PyTorch integration surface: security testing, input validation, and safe error handling.` | SEC-PI |

- `{{LEVEL_PCT}}` = **mean of the domain %s in that level** (integer). `{{LEVEL_BAND_COLOR}}` from that %.
- Inside each card, `REPEAT:leveldomain` once per domain in the level:
  `{{LD_NAME}}`, `{{LD_ID}}`, `{{LD_PCT}}` (domain %), `{{LD_BAND_COLOR}}`.

## `REPEAT:action` — prioritized required actions

Derive from the markdown Gap Analysis / Recommendations. One row per action,
**Critical → High → Medium** order. If a severity has no findings, omit it; if
there are no actions at all, replace the whole block with
`<p class="none">No blocking actions — see appendix for detail.</p>`.

| Token | Value |
|-------|-------|
| `{{ACTION_SEV}}` | `Critical` / `High` / `Medium` |
| `{{ACTION_SEV_CLASS}}` | `critical` / `high` / `medium` |
| `{{ACTION_TEXT}}` | The action, phrased as a next step (what to do + why) |
| `{{ACTION_REFS}}` | Item IDs it addresses, e.g. `SEC-DS-02, SEC-HT-01` |

## `REPEAT:bar` — domain snapshot (one per domain, level order L1→L3)

`{{LEVEL}}` (1/2/3), `{{DOMAIN_ID}}`, `{{DOMAIN_NAME}}`, `{{DOMAIN_PCT}}`,
`{{DOMAIN_BAND_COLOR}}`.

## Appendix — `REPEAT:domain` / `REPEAT:item`

| Token | Value |
|-------|-------|
| `{{LEVEL}}`,`{{DOMAIN_ID}}`,`{{DOMAIN_NAME}}` | Domain identity |
| `{{DOMAIN_EARNED}}`/`{{DOMAIN_MAX}}` | Earned/max raw points (exclude N/A from max) |
| `{{DOMAIN_PCT}}` | Domain % |
| `{{DOMAIN_THREAT}}` | The domain's **Threat:** line |
| `{{ITEM_ID}}`,`{{ITEM_CHECK}}`,`{{ITEM_PRIORITY}}`,`{{ITEM_NOTES}}` | Per item (escape `<`,`>`,`&` in text) |
| `{{ITEM_PTS}}` | `2`/`1`/`0`/`N/A` |
| `{{ITEM_PTS_CLASS}}` | `2`→`p2`, `1`→`p1`, `0`→`p0`, `N/A`→`pna` |

## `REPEAT:source`

One `<li>` per evidence source (repo path or URL) from the markdown. Wrap any
URL or domain in an `<a href="...">` so it is clickable (prefix bare domains
with `https://`); leave non-URL text (file paths, prose) as plain text.

## Consistency checks (before finishing)

- Overall %, every level %, and every domain % match the markdown / formulas.
- Every color band matches its %; every item badge class matches its score.
- Every Critical/High gap has a corresponding Required Action.
- All `{{...}}` tokens and `REPEAT` markers removed; no HTML comments left.
- File opens standalone (no external references).

See `examples/torch_security_readiness_report_example.html` for a complete
rendered reference (real evaluation of IBM Spyre / torch-spyre).
