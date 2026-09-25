import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { collectDirectEvidence } from './torch-ice-review-evidence.mjs';

const execFileAsync = promisify(execFile);
const git = async (cwd, ...args) => (await execFileAsync('git', args, { cwd })).stdout.trim();

test('includes a current-base deletion hidden by the merge-base PR diff', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-ice-review-evidence-'));
  const seed = path.join(root, 'seed');
  const baseRoot = path.join(root, 'base');
  const headRoot = path.join(root, 'head');
  try {
    await fs.mkdir(seed);
    await git(seed, 'init', '-q', '-b', 'main');
    await git(seed, 'config', 'user.name', 'Review Test');
    await git(seed, 'config', 'user.email', 'review-test@example.com');
    await fs.writeFile(path.join(seed, 'README.md'), 'initial\n');
    await git(seed, 'add', 'README.md');
    await git(seed, 'commit', '-qm', 'initial');
    const initialSha = await git(seed, 'rev-parse', 'HEAD');

    await fs.mkdir(path.join(seed, 'src'));
    await fs.writeFile(path.join(seed, 'src/guard.js'), 'export const guard = true;\n');
    await git(seed, 'add', 'src/guard.js');
    await git(seed, 'commit', '-qm', 'advance main');
    const baseSha = await git(seed, 'rev-parse', 'HEAD');

    await git(seed, 'checkout', '-q', '-b', 'pr', initialSha);
    await fs.writeFile(path.join(seed, 'README.md'), 'PR change\n');
    await git(seed, 'commit', '-qam', 'change README');
    const headSha = await git(seed, 'rev-parse', 'HEAD');
    assert.equal(await git(seed, 'diff', '--name-only', `${baseSha}...${headSha}`), 'README.md');

    for (const [checkout, sha] of [[baseRoot, baseSha], [headRoot, headSha]]) {
      await fs.mkdir(checkout);
      await git(checkout, 'init', '-q');
      await git(checkout, 'fetch', '-q', '--depth=1', seed, sha);
      await git(checkout, 'checkout', '-q', 'FETCH_HEAD');
    }

    const evidence = await collectDirectEvidence({ baseRoot, headRoot, baseSha, headSha });
    assert.equal(evidence.find((item) => item.path === 'src/guard.js')?.status, 'D');
    assert.match(evidence.find((item) => item.path === 'src/guard.js').patch, /-export const guard/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
