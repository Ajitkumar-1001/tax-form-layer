// The tour only looks. Nothing under src/components/tour may call anything that writes, or press anything: if one of these
// words ever appears in its source, this fails, and the author has to decide on purpose (and update the safety plan).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = path.join(process.cwd(), 'src/components/tour')
const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f))

// What the tour must not touch: the workspace's writers, raw requests, synthetic clicks.
const FORBIDDEN: [RegExp, string][] = [
  [/\.post\(/, 'ws.post(…)'],
  [/\.reveal\(/, 'ws.reveal(…)'],
  [/switchIdentity/, 'switchIdentity'],
  [/\bfetch\(/, 'fetch(…)'],
  [/XMLHttpRequest|sendBeacon/, 'a raw request'],
  [/\.click\(/, 'element.click()'],
  [/dispatchEvent/, 'dispatchEvent'],
  [/useWorkspace/, 'useWorkspace (the tour reads nothing from the workspace, so it never waits for it)'],
]

describe('src/components/tour', () => {
  it('has source to check', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const file of files) {
    it(`${file} calls nothing that writes`, () => {
      const source = readFileSync(path.join(dir, file), 'utf8')
      for (const [pattern, name] of FORBIDDEN) expect(source, `${file} must not use ${name}`).not.toMatch(pattern)
    })
  }
})
