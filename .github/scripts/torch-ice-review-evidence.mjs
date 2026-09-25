import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DIFF_ARGS = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'];
const git = (cwd, args, env) => execFileAsync('git', args, { cwd, env, maxBuffer: 200_000, encoding: 'buffer' });

export async function collectDirectEvidence({ baseRoot, headRoot, baseSha, headSha }) {
  if (![baseSha, headSha].every((sha) => /^[a-f0-9]{40,64}$/i.test(sha))) {
    throw new Error('Current-base review evidence unavailable: invalid commit SHA.');
  }

  try {
    const objects = await git(headRoot, ['rev-parse', '--git-path', 'objects']);
    const env = { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: path.resolve(headRoot, objects.stdout.toString().trim()) };
    for (const sha of [baseSha, headSha]) await git(baseRoot, ['cat-file', '-e', `${sha}^{commit}`], env);

    const names = await git(baseRoot, [...DIFF_ARGS, '--name-status', '-z', baseSha, headSha], env);
    const tokens = [];
    for (let start = 0; start < names.stdout.length;) {
      const end = names.stdout.indexOf(0, start);
      if (end < 0) throw new Error('Malformed NUL-delimited Git diff.');
      tokens.push(names.stdout.subarray(start, end).toString('utf8'));
      start = end + 1;
    }
    if (tokens.length % 2) throw new Error('Malformed NUL-delimited Git diff.');

    const evidence = [];
    for (let index = 0; index < tokens.length; index += 2) {
      const [status, filePath] = tokens.slice(index, index + 2);
      const patch = await git(baseRoot, [...DIFF_ARGS, '--patch', baseSha, headSha, '--', `:(literal)${filePath}`], env);
      evidence.push({ path: filePath, status, patch: patch.stdout.toString('utf8') });
    }
    return evidence;
  } catch {
    throw new Error('Current-base review evidence unavailable: Git failed or exceeded the 200,000-byte capture limit.');
  }
}

const UNIT_LIMIT = 20_000;
const incomplete = (reason) => new Error(`Review evidence incomplete: ${reason}.`);
const binaryMarker = (patch) => patch && !/^@@ /m.test(patch) && /^(?:Binary files .* differ|GIT binary patch)$/m.test(patch);
const escapedLength = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').length;

function completeHunks(patch) {
  let expected = null;
  let actual = [0, 0];
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    const match = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (match) {
      if (expected && (actual[0] !== expected[0] || actual[1] !== expected[1])) return false;
      expected = [Number(match[1] ?? 1), Number(match[2] ?? 1)];
      actual = [0, 0];
    } else if (expected) {
      if (line.startsWith('-')) actual[0]++;
      else if (line.startsWith('+')) actual[1]++;
      else if (line.startsWith(' ')) { actual[0]++; actual[1]++; }
      else if (!line.startsWith('\\')) return false;
    }
  }
  return !expected || (actual[0] === expected[0] && actual[1] === expected[1]);
}

function sourcePieces(label, patch) {
  if (!completeHunks(patch)) throw incomplete('incomplete diff hunk');
  const lines = patch.replace(/\n$/, '').split('\n');
  const pieces = [];
  let current = label;
  const flush = () => { if (current !== label) pieces.push(current); current = label; };
  const add = (line) => {
    if (escapedLength(`${label}\n${line}`) > UNIT_LIMIT) throw incomplete('oversized diff line');
    if (escapedLength(`${current}\n${line}`) > UNIT_LIMIT) flush();
    current += `\n${line}`;
  };

  for (let index = 0; index < lines.length;) {
    const match = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (!match) { add(lines[index++]); continue; }

    const [, old, , next, , suffix] = match;
    let oldLine = Number(old);
    let newLine = Number(next);
    const hunk = [];
    index++;
    while (index < lines.length && !lines[index].startsWith('@@ ')) hunk.push(lines[index++]);
    let part = [];
    let partOld = oldLine;
    let partNew = newLine;
    const header = () => {
      const oldCount = part.filter((line) => line[0] !== '+' && line[0] !== '\\').length;
      const newCount = part.filter((line) => line[0] !== '-' && line[0] !== '\\').length;
      return `@@ -${partOld},${oldCount} +${partNew},${newCount} @@${suffix}`;
    };
    const emit = () => {
      if (!part.length) return;
      const block = `${header()}\n${part.join('\n')}`;
      if (escapedLength(`${current}\n${block}`) > UNIT_LIMIT) flush();
      current += `\n${block}`;
      part = [];
      partOld = oldLine;
      partNew = newLine;
    };
    for (const line of hunk) {
      part.push(line);
      const block = `${header()}\n${part.join('\n')}`;
      if (escapedLength(`${label}\n${block}`) > UNIT_LIMIT) {
        part.pop();
        if (!part.length) throw incomplete('oversized diff line');
        emit();
        part.push(line);
      }
      if (line[0] !== '+' && line[0] !== '\\') oldLine++;
      if (line[0] !== '-' && line[0] !== '\\') newLine++;
    }
    emit();
  }
  flush();
  return pieces;
}

export function buildReviewUnits({ githubFiles, rawDiff, directEvidence }) {
  const paths = new Map();
  const ensure = (filePath) => {
    if (!paths.has(filePath)) paths.set(filePath, []);
    return paths.get(filePath);
  };
  const sections = String(rawDiff ?? '').split(/(?=^diff --git )/m);
  for (const file of githubFiles) {
    const names = [...new Set([file.previous_filename, file.filename].filter(Boolean))];
    const rawSection = sections.find((section) => {
      const heading = section.split('\n', 1)[0];
      return heading.endsWith(` b/${file.filename}`) || heading.endsWith(` b/${file.filename}"`);
    });
    let patch = file.patch ?? (binaryMarker(rawSection) ? rawSection : null);
    if (patch?.trim() && !completeHunks(patch)) {
      if (!rawSection || !/^@@ /m.test(rawSection) || !completeHunks(rawSection)) throw incomplete(`incomplete diff hunk for ${file.filename}`);
      patch = rawSection;
    }
    if (!patch?.trim() && !names.some((name) => directEvidence.some((item) => item.path === name && binaryMarker(item.patch)))) {
      throw incomplete(`missing textual evidence for ${file.filename}`);
    }
    for (const name of names) ensure(name).push({ view: 'pr', label: `Path: ${name}\nPR diff (${file.status})`, patch: patch?.trim() ? patch : 'Binary file (GitHub omitted patch).' });
  }
  for (const item of directEvidence) {
    if (!item.patch?.trim()) throw incomplete(`missing textual evidence for ${item.path}`);
    ensure(item.path).push({ view: 'base_head', label: `Path: ${item.path}\ncurrent base to head (${item.status})`, patch: item.patch });
  }

  const units = [];
  for (const [filePath, sources] of [...paths].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    let evidence = '';
    let views = [];
    const emit = () => { if (evidence) units.push({ id: `u${units.length + 1}`, path: filePath, views, evidence }); evidence = ''; views = []; };
    for (const source of sources) {
      for (const piece of sourcePieces(source.label, String(source.patch))) {
        if (evidence && escapedLength(`${evidence}\n\n${piece}`) > UNIT_LIMIT) emit();
        if (!views.includes(source.view)) views.push(source.view);
        evidence += `${evidence ? '\n\n' : ''}${piece}`;
      }
    }
    emit();
  }
  return units;
}

export function packReviewBatches(units) {
  const batches = [];
  for (const unit of units) {
    if (unit.evidence.length > UNIT_LIMIT) throw incomplete('oversized unit');
    const last = batches.at(-1);
    if (!last || last.evidence.length + (last.evidence ? 2 : 0) + unit.evidence.length > UNIT_LIMIT) batches.push({ ids: [], units: [], evidence: '' });
    const batch = batches.at(-1);
    batch.ids.push(unit.id);
    batch.units.push({ id: unit.id, path: unit.path, views: unit.views });
    batch.evidence += `${batch.evidence ? '\n\n' : ''}${unit.evidence}`;
  }
  if (batches.length > 8 || batches.reduce((sum, batch) => sum + batch.evidence.length, 0) > 160_000) throw incomplete('batch limit');
  return batches;
}
