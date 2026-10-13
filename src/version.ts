import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  name: string
  version: string
}

export const version: string = manifest.version
export const packageName: string = manifest.name
