const GENERAL_CHECKS = ['correctness', 'regressions', 'security', 'performance'];
const incomplete = () => { throw new Error('Review evidence incomplete: invalid batch result.'); };
const quoted = (text, quote) => text.includes(quote) || text.includes(quote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

export function requiredReviewChecks(checklist, reviewMode) {
  const checks = GENERAL_CHECKS.map((name) => ({ id: `general-${name}`, label: `General Review: ${name}` }));
  if (reviewMode !== 'framework-assessment') return checks;
  let section = '';
  for (const line of checklist.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) section = heading[1];
    const item = /^- \[ \] \*\*(.+?)\*\*/.exec(line);
    if (!item) continue;
    const slug = (value) => value.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    checks.push({ id: `${slug(section)}-${slug(item[1])}`, label: item[1] });
  }
  if (new Set(checks.map((check) => check.id)).size !== checks.length) incomplete();
  return checks;
}

function changedLines(evidence, view, side) {
  const lines = [];
  let currentView = null;
  let oldLine = null;
  let newLine = null;
  for (const line of evidence.split(/\r?\n/)) {
    if (/^PR diff \(/.test(line)) { currentView = 'pr'; oldLine = null; newLine = null; }
    else if (/^current base to head \(/.test(line)) { currentView = 'base_head'; oldLine = null; newLine = null; }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); continue; }
    if (oldLine === null || !/^[ +\-]/.test(line)) continue;
    if (currentView === view) {
      if (side === 'old' && line[0] !== '+') lines.push({ number: oldLine, changed: line[0] === '-', text: line.slice(1) });
      if (side === 'new' && line[0] !== '-') lines.push({ number: newLine, changed: line[0] === '+', text: line.slice(1) });
    }
    if (line[0] !== '+') oldLine++;
    if (line[0] !== '-') newLine++;
  }
  return lines;
}

export function validateReference(ref, finding, batch) {
  if (!ref || !['diff', 'metadata', 'snapshot'].includes(ref.kind) || typeof ref.quote !== 'string' || !ref.quote.trim() || ref.quote.includes('\n')) incomplete();
  if (ref.kind === 'snapshot') {
    if (!['base', 'head'].includes(ref.snapshot) || typeof ref.path !== 'string' || !Number.isSafeInteger(ref.line_start) || ref.line_start < 1 || ref.line_end !== ref.line_start || ref.unit_id !== null || ref.view !== null || ref.side !== null) incomplete();
    return;
  }
  const unit = batch.units.find((entry) => entry.id === ref.unit_id && entry.path === finding.path && entry.views.includes(ref.view));
  if (!unit || ref.view !== finding.view || ref.snapshot !== null || ref.path !== null || (finding.unit_ids && !finding.unit_ids.includes(ref.unit_id))) incomplete();
  const evidence = unit.evidence ?? batch.unitEvidence?.[unit.id];
  if (typeof evidence !== 'string') incomplete();
  if (ref.kind === 'metadata') {
    const segment = evidence.split(/(?=^Path: )/m).find((part) => part.includes(ref.view === 'pr' ? 'PR diff (' : 'current base to head ('));
    const metadataLine = segment?.split(/\r?\n/).some((line) => /^(?:old mode|new mode|rename from|rename to|similarity index|Binary files|GIT binary patch|new file mode|deleted file mode|index)\b/.test(line) && quoted(line, ref.quote));
    if (ref.side !== null || ref.line_start !== null || ref.line_end !== null || !segment || /^@@ /m.test(segment) || !metadataLine) incomplete();
    return;
  }
  if (!['old', 'new'].includes(ref.side) || !Number.isSafeInteger(ref.line_start) || !Number.isSafeInteger(ref.line_end) || ref.line_start < 1 || ref.line_end < ref.line_start || ref.line_end - ref.line_start > 19) incomplete();
  const lines = changedLines(evidence, ref.view, ref.side);
  for (let number = ref.line_start; number <= ref.line_end; number++) if (!lines.some((line) => line.number === number)) incomplete();
  if (!lines.some((line) => line.number >= ref.line_start && line.number <= ref.line_end && line.changed && quoted(line.text, ref.quote))) incomplete();
}

export function validateQuality(result, batch) {
  const expected = batch.checks.map((check) => check.id);
  if (!Array.isArray(result.checks) || result.checks.length !== expected.length || new Set(result.checks.map((check) => check?.id)).size !== expected.length) incomplete();
  for (const check of result.checks) {
    if (!expected.includes(check.id) || !['pass', 'violation', 'not_applicable', 'unresolved'].includes(check.status) || check.status === 'unresolved' || typeof check.reason !== 'string' || !check.reason.trim() || !Array.isArray(check.finding_indexes) || new Set(check.finding_indexes).size !== check.finding_indexes.length || !Array.isArray(check.references)) incomplete();
    if (check.finding_indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= result.findings.length)) incomplete();
    if (check.status === 'violation' ? !check.finding_indexes.length : check.finding_indexes.length) incomplete();
    if (check.finding_indexes.some((index) => result.findings[index].category !== (check.id.startsWith('general-') ? 'general' : 'framework'))) incomplete();
    if (check.status !== 'not_applicable' && !check.references.length) incomplete();
    for (const ref of check.references) {
      const unit = batch.units.find((entry) => entry.id === ref.unit_id);
      validateReference(ref, { path: unit?.path, view: ref.view }, batch);
    }
  }
  if (result.findings.some((_, index) => !result.checks.some((check) => check.finding_indexes.includes(index)))) incomplete();
  for (const finding of result.findings) {
    if (!['blocking', 'major', 'minor'].includes(finding.severity) || !Array.isArray(finding.references) || !finding.references.length) incomplete();
    for (const ref of finding.references) validateReference(ref, finding, batch);
    if (!finding.references.some((ref) => ref.kind !== 'snapshot')) incomplete();
  }
}
