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
