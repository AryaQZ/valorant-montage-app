import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('./vendor/siwc-devkit/', import.meta.url));
const patch = fileURLToPath(new URL('./siwc-reasoning-effort.patch', import.meta.url));
const gitApply = (...args) => spawnSync('git', ['apply', ...args, patch], { cwd, encoding: 'utf8' });
if (gitApply('--reverse', '--check').status !== 0) {
  const result = gitApply();
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Could not apply the Studio DevKit patch.');
}
