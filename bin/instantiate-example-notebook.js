#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(repositoryRoot, 'examples/first-look/notebook')
const destination = path.join(repositoryRoot, 'example-notebook')

if (fs.existsSync(destination)) {
  throw new Error(`Refusing to replace existing ${destination}. Remove it first if you want a fresh example copy.`)
}

fs.cpSync(source, destination, { recursive: true, errorOnExist: true })
console.log(`Created ${destination} from examples/first-look/notebook`)
