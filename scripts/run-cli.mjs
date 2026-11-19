#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Использование: npx run <script-name> [аргументы] (например: npx run dev, npx run tauri build)')
  process.exit(1)
}

const isWindows = process.platform === 'win32'

if (args[0] === 'tauri') {
  const desktopScript = resolve(root, 'scripts/desktop.mjs')
  const child = spawn(process.execPath, [desktopScript, ...args.slice(1)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  child.on('error', (err) => {
    console.error('Ошибка запуска tauri:', err.message)
    process.exit(1)
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 0
  })
} else {
  const cmd = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const scriptName = args[0]
  const extraArgs = args.slice(1)
  const npmRunArgs = extraArgs.length > 0
    ? ['run', scriptName, '--', ...extraArgs]
    : ['run', scriptName]
  const cmdArgs = isWindows
    ? ['/d', '/s', '/c', 'npm', ...npmRunArgs]
    : npmRunArgs

  const child = spawn(cmd, cmdArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  child.on('error', (err) => {
    console.error('Ошибка запуска:', err.message)
    process.exit(1)
  })

  child.on('exit', (code) => {
    process.exitCode = code ?? 0
  })
}
