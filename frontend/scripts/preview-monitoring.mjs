import { spawn, spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = { ...process.env, VITE_SENTRY_DSN: 'http://public@127.0.0.1:9999/1' }
const build = spawnSync(npm, ['run', 'build'], { env, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const preview = spawn(npm, ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], { env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => preview.kill(signal))
}
preview.on('exit', (code) => process.exit(code ?? 1))
