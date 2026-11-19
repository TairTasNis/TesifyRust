import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')

const commands = [
  { name: 'run', script: resolve(root, 'scripts/run-cli.mjs') },
  { name: 'build', script: resolve(root, 'scripts/build-cli.mjs') },
  { name: 'dev', script: resolve(root, 'scripts/dev-cli.mjs') },
  { name: 'tauri', script: resolve(root, 'scripts/desktop.mjs') },
]

const targetDirs = [
  resolve(root, 'node_modules/.bin'),
  resolve(root, 'Frontend/node_modules/.bin'),
]

for (const targetDir of targetDirs) {
  mkdirSync(targetDir, { recursive: true })

  for (const { name, script } of commands) {
    const relFromBin = relative(targetDir, script).replace(/\\/g, '/')

    // .cmd wrapper (Windows cmd / PowerShell)
    const cmdContent = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relFromBin.replace(/\//g, '\\')}" %*
`
    writeFileSync(resolve(targetDir, `${name}.cmd`), cmdContent, 'utf-8')

    // .ps1 wrapper (PowerShell)
    const ps1Content = `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir/node$exe"  "$basedir/${relFromBin}" $args
  } else {
    & "$basedir/node$exe"  "$basedir/${relFromBin}" $args
  }
  $ret=$LASTEXITCODE
} else {
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe"  "$basedir/${relFromBin}" $args
  } else {
    & "node$exe"  "$basedir/${relFromBin}" $args
  }
  $ret=$LASTEXITCODE
}
exit $ret
`
    writeFileSync(resolve(targetDir, `${name}.ps1`), ps1Content, 'utf-8')

    // Shell script wrapper (Linux / macOS / Git Bash)
    const shContent = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case \`uname\` in
    *CYGWIN*|*MINGW*|*MSYS*)
        if command -v cygpath > /dev/null 2>&1; then
            basedir=\`cygpath -w "$basedir"\`
        fi
    ;;
esac

if [ -x "$basedir/node" ]; then
  exec "$basedir/node" "$basedir/${relFromBin}" "$@"
else
  exec node "$basedir/${relFromBin}" "$@"
fi
`
    const shFile = resolve(targetDir, name)
    writeFileSync(shFile, shContent, 'utf-8')
    try {
      chmodSync(shFile, 0o755)
    } catch {}
  }
}

console.log('npx wrappers installed successfully for run, build, dev.')
