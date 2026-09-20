// Never send fixture telemetry to a developer's real DSN from .env.local.
import { spawnSync } from 'node:child_process'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = { ...process.env, VITE_SENTRY_DSN: '' }
const build = spawnSync(npm, ['run', 'build'], { env, stdio: 'inherit', shell: process.platform === 'win32' })
if (build.error || build.status !== 0) process.exit(build.status || 1)
const result = spawnSync(npm, ['exec', '--', 'playwright', 'test', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
