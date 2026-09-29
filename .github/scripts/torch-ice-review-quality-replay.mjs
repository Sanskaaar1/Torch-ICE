#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { packReviewBatches } from './torch-ice-review-evidence.mjs';
import {
  BATCH_RESULT_SCHEMA, EXPLORATION_TOOLS, batchStageInstructions, buildReviewInput, parseBatchResponse,
  prepareReviewUnits, readFileContext, redactSensitiveText, renderFindings, reviewBatches,
  reviewRequestTimeoutMs, runExplorationLoop, selectReviewMode, validateBatchResult, verifySnapshotReferences,
} from './torch-ice-review-agent.mjs';

const run = promisify(execFile);
const MODEL = 'gpt-5.6-terra';
const FIXTURES = ['original', 'corrected', 'general'];
const ROOT = path.resolve(import.meta.dirname, '../..');

async function git(args) {
  try { return (await run('git', args, { cwd: ROOT, maxBuffer: 300_000 })).stdout; }
  catch (error) { if (error.code === 1 && args[0] === 'diff') return error.stdout; throw error; }
}

async function readAt(sha, file) {
  try { return await git(['show', `${sha}:${file}`]); }
  catch (error) { if (error.code === 128) return null; throw error; }
}

export async function prepareFixture(name, root) {
  if (!FIXTURES.includes(name)) throw new Error('Unknown fixture.');
  const fixture = JSON.parse(await fs.readFile(path.join(ROOT, '.github/fixtures/review-quality', `${name}.json`), 'utf8'));
  const snapshots = { base: path.join(root, 'base'), head: path.join(root, 'head') };
  const contextFiles = [...new Set([...fixture.files, 'SKILL.md', 'frameworks/pytorch/EVAL.md', 'frameworks/pytorch/checklist.md'])];
  for (const snapshot of ['base', 'head']) {
    await fs.mkdir(snapshots[snapshot], { recursive: true });
    for (const file of contextFiles) {
      if (!/^[\w./-]+$/.test(file) || file.split('/').includes('..')) throw new Error('Invalid fixture path.');
      const content = await readAt(fixture[snapshot], file);
      if (content === null) continue;
      const destination = path.join(snapshots[snapshot], file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content);
    }
  }
  for (const edit of fixture.edits) {
    const destination = path.join(snapshots.head, edit.path);
    const before = await fs.readFile(destination, 'utf8');
    if (!before.includes(edit.find)) throw new Error(`Fixture edit did not match: ${edit.path}`);
    await fs.writeFile(destination, before.replace(edit.find, edit.replace));
  }
  const files = [];
  for (const file of fixture.files) {
    const baseFile = path.join(snapshots.base, file);
    const headFile = path.join(snapshots.head, file);
    const baseExists = await fs.stat(baseFile).then(() => true, () => false);
    const headExists = await fs.stat(headFile).then(() => true, () => false);
    const patch = await git(['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--', baseExists ? baseFile : '/dev/null', headExists ? headFile : '/dev/null']);
    if (patch) files.push({ filename: file, status: baseExists ? headExists ? 'modified' : 'removed' : 'added', patch,
      additions: patch.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
      deletions: patch.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length });
  }
  const directEvidence = files.map((file) => ({ path: file.filename, status: file.status === 'added' ? 'A' : file.status === 'removed' ? 'D' : 'M', patch: file.patch }));
  const units = prepareReviewUnits({ githubFiles: files, rawDiff: files.map((file) => file.patch).join('\n'), directEvidence });
  const batches = packReviewBatches(units);
  const reviewMode = selectReviewMode(files);
  return { fixture, snapshots, files, units, batches, reviewMode };
}

async function requestModel({ instructions, schema, name, input, deadline, usage, tools = [], toolChoice = 'none', maxOutputTokens = 6144 }) {
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(reviewRequestTimeoutMs(deadline)),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, text: { format: { type: 'json_schema', name, strict: true, schema }, verbosity: 'medium' },
      max_output_tokens: maxOutputTokens, store: false, instructions, tools, tool_choice: toolChoice,
      parallel_tool_calls: false, input }) });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  const result = await response.json();
  usage.push({ stage: name, usage: result.usage ?? null });
  return result;
}

export async function liveTrial(prepared, instructions, checklist, usage) {
  const { fixture, snapshots, files, units, reviewMode } = prepared;
  const batches = prepared.batches;
  const evidenceById = new Map(units.map((unit) => [unit.id, unit.evidence]));
  for (const batch of batches) {
    batch.unitEvidence = Object.fromEntries(batch.ids.map((id) => [id, evidenceById.get(id)]));
  }
  const deadline = Date.now() + 14 * 60_000;
  const started = Date.now();
  const explorationBudget = { calls: 0, characters: 0 };
  const findings = await reviewBatches(batches, async (batch, attempt, retryReason, retryDraft) => {
    const paths = new Set(batch.units.map((unit) => unit.path));
    const batchFiles = files.filter((file) => paths.has(file.filename));
    const assessmentFiles = batchFiles.filter((file) => /\/(?:EVAL|checklist)\.md$/.test(file.filename));
    const contextFiles = reviewMode === 'framework-assessment'
      ? [{ filename: 'SKILL.md' }, ...assessmentFiles, ...batchFiles.filter((file) => file.filename !== 'SKILL.md' && !assessmentFiles.includes(file))]
      : batchFiles;
    const fileContext = await readFileContext(snapshots.head, contextFiles);
    const priorReview = retryDraft ? `\n\n<untrusted_prior_review>\n${JSON.stringify(retryDraft).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n</untrusted_prior_review>` : '';
    const input = buildReviewInput({ pr: { number: 9, title: fixture.name }, headSha: fixture.head, files: batchFiles,
      batchEvidence: batch.evidence, fileContext, history: [], checklist, reviewMode, reservedChars: priorReview.length }).input;
    const requestInput = redactSensitiveText(`${input}${priorReview}`).text;
    const stage = batchStageInstructions(instructions, attempt, retryReason);
    const exploration = await runExplorationLoop((turns, { toolChoice = 'auto' } = {}) => requestModel({ instructions: stage, schema: BATCH_RESULT_SCHEMA, name: 'review_batch', input: turns, deadline, usage,
      tools: EXPLORATION_TOOLS, toolChoice, maxOutputTokens: 8192 }), requestInput, snapshots, explorationBudget);
    let result;
    try {
      result = parseBatchResponse(exploration.response);
      validateBatchResult(result, batch);
      await verifySnapshotReferences(result.findings, snapshots);
      return result;
    } catch (error) {
      if (attempt === 0 && result && String(error.message).startsWith('Review evidence incomplete:')) error.reviewDraft = result;
      throw error;
    }
  }, deadline);
  const markdown = renderFindings({ findings, pr: { number: 9, title: fixture.name }, reviewMode });
  return { name: fixture.name, latency_ms: Date.now() - started, findings: findings.length, markdown };
}

async function main() {
  const offline = process.argv.includes('--offline');
  if (!offline && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is unavailable; live replay was not run.');
  const instructions = await fs.readFile(path.join(ROOT, '.github/prompts/torch-ice-review-agent.md'), 'utf8');
  const checklist = await fs.readFile(path.join(ROOT, '.claude/skills/torch-ice-review/checklist.md'), 'utf8');
  const output = { model: MODEL, prompt_sha256: createHash('sha256').update(instructions).digest('hex'), baseline: 'PR #9 posted comment 5888856543', trials: [] };
  let failure = null;
  for (const name of FIXTURES) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `torch-ice-replay-${name}-`));
    try {
      const prepared = await prepareFixture(name, root);
      if (offline) output.trials.push({ name, files: prepared.files.length, units: prepared.units.length, batches: prepared.batches.length, reviewMode: prepared.reviewMode });
      else for (let index = 0; index < (name === 'general' ? 1 : 3); index++) {
        const usage = [];
        output.trials.push({ ...await liveTrial(prepared, instructions, checklist, usage), usage });
      }
    } catch (error) {
      failure = error;
      output.trials.push({ name, error: error.message });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
    if (failure) break;
  }
  const destination = path.join(os.tmpdir(), `torch-ice-review-quality-${Date.now()}.json`);
  await fs.writeFile(destination, JSON.stringify(output, null, 2));
  process.stdout.write(process.argv.includes('--stdout') ? `${JSON.stringify(output)}\n` : `${destination}\n`);
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
