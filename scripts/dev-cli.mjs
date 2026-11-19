#!/usr/bin/env node
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const isWindows = process.platform === 'win32'
const cmd = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm'
const cmdArgs = isWindows ? ['/d', '/s', '/c', 'npm', 'run', 'dev', ...args] : ['run', 'dev', ...args]

const child = spawn(cmd, cmdArgs, {
  cwd: process.cwd(),
  stdio: 'inherit',
})

child.on('error', (err) => {
  console.error('Ошибка запуска dev:', err.message)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exitCode = code ?? 0
})
