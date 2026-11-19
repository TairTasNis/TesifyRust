import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const children = []
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  process.exitCode = code
}

function run(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.on('error', (error) => { console.error(error.message); stop(1) })
  child.on('exit', (code) => { if (!stopping) stop(code ?? 0) })
  return child
}

async function ready() {
  try { return (await fetch('http://127.0.0.1:17830/health', { signal: AbortSignal.timeout(1000) })).ok }
  catch { return false }
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

if (!await ready()) {
  run('cargo', ['run', '--manifest-path', resolve(root, 'Backend/Cargo.toml'), '--bin', 'tesify-preview', '--locked'])
  let started = false
  for (let attempt = 0; attempt < 240 && !stopping; attempt++) {
    if (await ready()) { started = true; break }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (!started && !stopping) { console.error('Не удалось запустить библиотеку. Проверьте сообщения Rust выше.'); stop(1) }
}
if (!stopping) run(process.execPath, [resolve(root, 'Frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], resolve(root, 'Frontend'))
