#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = resolve(root, 'Frontend/node_modules/@tauri-apps/cli/tauri.js')

if (!existsSync(cli)) {
  console.error('Установите зависимости: npm run install:frontend')
  process.exit(1)
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: resolve(root, 'Backend'),
  stdio: 'inherit',
  env: process.env,
})

child.on('error', (error) => {
  console.error('Не удалось запустить Tauri:', error.message)
  process.exitCode = 1
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
