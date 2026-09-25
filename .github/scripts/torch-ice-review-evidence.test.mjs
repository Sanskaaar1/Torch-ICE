import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { collectDirectEvidence, buildReviewUnits, packReviewBatches } from './torch-ice-review-evidence.mjs';

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

test('collects the patch for a filename containing pathspec syntax', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-ice-review-evidence-path-'));
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
    const baseSha = await git(seed, 'rev-parse', 'HEAD');
    await fs.writeFile(path.join(seed, 'a[1].txt'), 'literal filename\n');
    await fs.writeFile(path.join(seed, 'a1.txt'), 'other filename\n');
    await git(seed, 'add', '--all');
    await git(seed, 'commit', '-qm', 'add bracketed filename');
    const headSha = await git(seed, 'rev-parse', 'HEAD');

    for (const [checkout, sha] of [[baseRoot, baseSha], [headRoot, headSha]]) {
      await fs.mkdir(checkout);
      await git(checkout, 'init', '-q');
      await git(checkout, 'fetch', '-q', '--depth=1', seed, sha);
      await git(checkout, 'checkout', '-q', 'FETCH_HEAD');
    }

    const evidence = await collectDirectEvidence({ baseRoot, headRoot, baseSha, headSha });
    const file = evidence.find((item) => item.path === 'a[1].txt');
    assert.equal(file?.status, 'A');
    assert.match(file.patch, /\+literal filename/);
    assert.doesNotMatch(file.patch, /other filename/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inventories PR, direct, renamed, and binary paths with their source labels', () => {
  const githubFiles = [
    { filename: 'src/shared.js', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
    { filename: 'src/pr-only.js', status: 'added', patch: '@@ -0,0 +1 @@\n+new' },
    { filename: 'src/new-name.js', previous_filename: 'src/old-name.js', status: 'renamed', patch: '@@ -1 +1 @@\n-old name\n+new name' },
    { filename: 'src/image.png', status: 'added' },
  ];
  const directEvidence = [
    { path: 'src/shared.js', status: 'M', patch: '@@ -1 +1 @@\n-old\n+new' },
    { path: 'src/guard.js', status: 'D', patch: '@@ -1 +0,0 @@\n-guard' },
  ];
  const rawDiff = 'diff --git a/src/image.png b/src/image.png\nnew file mode 100644\nBinary files /dev/null and b/src/image.png differ\n';
  const units = buildReviewUnits({ githubFiles, rawDiff, directEvidence });
  assert.deepEqual([...new Set(units.map((unit) => unit.path))], [
    'src/guard.js', 'src/image.png', 'src/new-name.js', 'src/old-name.js', 'src/pr-only.js', 'src/shared.js',
  ]);
  assert.deepEqual(units.find((unit) => unit.path === 'src/shared.js').views, ['pr', 'base_head']);
  assert.match(units.find((unit) => unit.path === 'src/shared.js').evidence, /PR diff[\s\S]*current base to head/);
  assert.match(units.find((unit) => unit.path === 'src/guard.js').evidence, /-guard/);
  assert.match(units.find((unit) => unit.path === 'src/image.png').evidence, /Binary files/);
  assert.match(units.find((unit) => unit.path === 'src/old-name.js').evidence, /old name/);
  assert.deepEqual(units.map((unit) => unit.id), units.map((_, index) => `u${index + 1}`));
});

test('rejects missing textual evidence and oversized indivisible lines', () => {
  assert.throws(() => buildReviewUnits({ githubFiles: [{ filename: 'lost.js', status: 'modified' }], rawDiff: '', directEvidence: [] }), /Review evidence incomplete/);
  assert.throws(() => buildReviewUnits({ githubFiles: [{ filename: 'large.js', status: 'modified', patch: `@@ -1 +1 @@\n+${'x'.repeat(20_001)}` }], rawDiff: '', directEvidence: [] }), /Review evidence incomplete/);
  assert.throws(() => packReviewBatches([{ id: 'u1', path: 'large.js', views: ['pr'], evidence: 'x'.repeat(20_001) }]), /Review evidence incomplete/);
});

test('splits long patches at complete hunks or lines and packs without loss', () => {
  const first = `@@ -1 +1 @@\n-${'a'.repeat(9_000)}\n+${'b'.repeat(9_000)}`;
  const second = `@@ -3 +3 @@\n-${'c'.repeat(9_000)}\n+${'d'.repeat(9_000)}`;
  const units = buildReviewUnits({ githubFiles: [{ filename: 'long.js', status: 'modified', patch: `${first}\n${second}` }], rawDiff: '', directEvidence: [] });
  assert.ok(units.length > 1);
  assert.ok(units.every((unit) => unit.path === 'long.js' && unit.views[0] === 'pr' && unit.evidence.length <= 20_000));
  const batches = packReviewBatches(units);
  assert.deepEqual(batches.flatMap((batch) => batch.ids), units.map((unit) => unit.id));
  assert.ok(batches.every((batch) => batch.evidence.length <= 20_000));
  assert.match(batches.map((batch) => batch.evidence).join(''), /\+b{9000}/);
  assert.match(batches.map((batch) => batch.evidence).join(''), /\+d{9000}/);
});

test('rejects evidence needing a ninth batch', () => {
  const units = Array.from({ length: 9 }, (_, index) => ({ id: `u${index + 1}`, path: `${index}.js`, views: ['pr'], evidence: 'x'.repeat(20_000) }));
  assert.throws(() => packReviewBatches(units), /Review evidence incomplete: batch limit/);
});

test('bounds complete diff lines by their escaped size before packing', () => {
  assert.throws(() => buildReviewUnits({
    githubFiles: [{ filename: 'angle.js', status: 'modified', patch: `@@ -0,0 +1 @@\n+${'<'.repeat(5_000)}` }], rawDiff: '', directEvidence: [],
  }), /Review evidence incomplete: oversized diff line/);
});

test('rejects an empty textual patch instead of listing a file without evidence', () => {
  assert.throws(() => buildReviewUnits({
    githubFiles: [{ filename: 'empty.js', status: 'modified', patch: '' }], rawDiff: '', directEvidence: [],
  }), /Review evidence incomplete: missing textual evidence/);
});

test('line split retains the old and new source positions', () => {
  const patch = `@@ -10,2 +10,2 @@\n-${'a'.repeat(9_000)}\n+${'b'.repeat(9_000)}\n ${'c'.repeat(9_000)}`;
  const units = buildReviewUnits({ githubFiles: [{ filename: 'line-split.js', status: 'modified', patch }], rawDiff: '', directEvidence: [] });
  assert.equal(units.length, 2);
  assert.match(units[0].evidence, /@@ -10,1 \+10,1 @@/);
  assert.match(units[1].evidence, /@@ -11,1 \+11,1 @@/);
  assert.match(units[1].evidence, / c{9000}/);
});

test('split units advertise only views present in their evidence', () => {
  const patch = `@@ -1 +1 @@\n-${'a'.repeat(9_000)}\n+${'b'.repeat(9_000)}`;
  const units = buildReviewUnits({
    githubFiles: [{ filename: 'shared.js', status: 'modified', patch }],
    rawDiff: '', directEvidence: [{ path: 'shared.js', status: 'M', patch }],
  });
  assert.equal(units.length, 2);
  assert.ok(units.every((unit) => unit.path === 'shared.js'));
  assert.deepEqual(units.map((unit) => unit.views), [['pr'], ['base_head']]);
  assert.match(units[0].evidence, /PR diff/);
  assert.doesNotMatch(units[0].evidence, /current base to head/);
  assert.match(units[1].evidence, /current base to head/);
  assert.doesNotMatch(units[1].evidence, /PR diff/);
});

test('uses complete raw textual evidence when the GitHub hunk is incomplete', () => {
  const rawDiff = 'diff --git a/partial.js b/partial.js\n--- a/partial.js\n+++ b/partial.js\n@@ -1,2 +1,2 @@\n-old\n-context\n+new\n+extra\n';
  const units = buildReviewUnits({
    githubFiles: [{ filename: 'partial.js', status: 'modified', patch: '@@ -1,2 +1,2 @@\n-old\n+new' }],
    rawDiff, directEvidence: [],
  });
  assert.match(units[0].evidence, /-context/);
  assert.match(units[0].evidence, /\+extra/);
  assert.match(units[0].evidence, /@@ -1,2 \+1,2 @@/);
});

test('does not treat a quoted binary marker in a textual hunk as binary metadata', () => {
  assert.throws(() => buildReviewUnits({
    githubFiles: [{ filename: 'text.js', status: 'modified' }], rawDiff: '',
    directEvidence: [{ path: 'text.js', status: 'M', patch: 'diff --git a/text.js b/text.js\n@@ -0,0 +1 @@\n+console.log("GIT binary patch")' }],
  }), /Review evidence incomplete: missing textual evidence/);
});

test('does not count a trailing newline as hunk context', () => {
  const units = buildReviewUnits({
    githubFiles: [{ filename: 'newline.js', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new\n' }],
    rawDiff: '', directEvidence: [],
  });
  assert.match(units[0].evidence, /@@ -1,1 \+1,1 @@/);
  assert.doesNotMatch(units[0].evidence, /@@ -1,2 \+1,2 @@/);
});

test('accepts complete PR metadata for changes without textual hunks', () => {
  const cases = [
    [{ filename: 'new.txt', previous_filename: 'old.txt', status: 'renamed' }, 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'],
    [{ filename: 'empty.txt', status: 'added' }, 'diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000..e69de29\n'],
    [{ filename: 'empty.txt', status: 'removed' }, 'diff --git a/empty.txt b/empty.txt\ndeleted file mode 100644\nindex e69de29..0000000\n'],
    [{ filename: 'script.sh', status: 'modified' }, 'diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n'],
  ];
  for (const [file, rawDiff] of cases) {
    for (const patch of [undefined, '']) {
      const units = buildReviewUnits({ githubFiles: [{ ...file, additions: 0, deletions: 0, patch }], rawDiff, directEvidence: [] });
      assert.deepEqual(units.map((unit) => unit.path).sort(), [file.filename, file.previous_filename].filter(Boolean).sort());
      for (const unit of units) {
        assert.deepEqual(unit.views, ['pr']);
        assert.ok(unit.evidence.includes(rawDiff.trim()));
        assert.doesNotMatch(unit.evidence, /Binary file/);
      }
    }
  }
});

test('does not accept metadata when PR textual evidence is missing', () => {
  for (const [additions, deletions, metadata] of [
    [1, 1, 'old mode 100644\nnew mode 100755\n'],
    [0, 0, 'old mode 100644\n'],
    [0, 0, 'index 1234567..abcdef0 100644\n--- a/file.txt\n+++ b/file.txt\n'],
  ]) {
    assert.throws(() => buildReviewUnits({
      githubFiles: [{ filename: 'file.txt', status: 'modified', additions, deletions }],
      rawDiff: `diff --git a/file.txt b/file.txt\n${metadata}`, directEvidence: [],
    }), /Review evidence incomplete/);
  }
});

test('uses raw PR text independently of a binary current-base comparison', () => {
  const rawDiff = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old text\n+new text\n';
  const directEvidence = [{ path: 'file.txt', status: 'M', patch: 'diff --git a/file.txt b/file.txt\nBinary files a/file.txt and b/file.txt differ\n' }];
  for (const patch of [undefined, '']) {
    const units = buildReviewUnits({ githubFiles: [{ filename: 'file.txt', status: 'modified', patch }], rawDiff, directEvidence });
    assert.match(units[0].evidence, /PR diff[\s\S]*-old text\n\+new text/);
    assert.match(units[0].evidence, /current base to head[\s\S]*Binary files/);
    assert.doesNotMatch(units[0].evidence, /GitHub omitted patch/);
  }
  for (const unavailable of ['', rawDiff.replace('+new text\n', '')]) {
    assert.throws(() => buildReviewUnits({
      githubFiles: [{ filename: 'file.txt', status: 'modified' }], rawDiff: unavailable, directEvidence,
    }), /Review evidence incomplete/);
  }
});
