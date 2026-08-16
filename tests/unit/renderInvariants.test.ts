/**
 * Render-layer invariants that unit tests can see without a GPU.
 *
 * §17.2 permits exactly one `useFrame` in `src/render`. That rule lived in
 * prose for months while `Sun.tsx` owned a second one. Counting call sites
 * is the cheapest way to keep it from going false again.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

describe('render invariants', () => {
  it('has exactly one useFrame( call in src/render', () => {
    const files = walk(join(process.cwd(), 'src', 'render'))
    let count = 0
    const sites: string[] = []
    for (const file of files) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
      const src = readFileSync(file, 'utf8')
      const matches = src.match(/\buseFrame\s*\(/g)
      if (matches !== null && matches.length > 0) {
        count += matches.length
        sites.push(`${file} ×${String(matches.length)}`)
      }
    }
    expect(count, sites.join('\n')).toBe(1)
  })
})
