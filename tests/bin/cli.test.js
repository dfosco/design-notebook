import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../../bin/design-notebook.js', import.meta.url))

test('the npm-style symlink launcher runs help and reports invalid commands', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-bin-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const link = path.join(directory, 'design-notebook')
  fs.symlinkSync(executable, link, 'file')

  const help = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Design Notebook first-look runtime/)

  const invalid = spawnSync(process.execPath, [link, 'invalid-command'], { encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Unknown command: invalid-command/)
})
