// The tour only looks. Nothing under src/components/tour may write or press anything, and nothing outside it may add a way to
// write that the tour's guard (components/workspace/api.ts) does not see. Three layers, none a substitute for the browser gate
// (docs/superpowers/tools/tour-gate.cjs, which proves it with a request counter):
//   1. an import allowlist for the tour: React, Next's router and link, icons, zod, the ui primitives, its own modules. The
//      workspace, the act forms and everything server-side are out of reach by name or alias;
//   2. a word list for the ways code writes without importing it (raw requests, forms, synthetic presses, a link to an API);
//   3. repo-wide pins on what can write at all: the browser's request sites, and who calls the act-log writers.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.join(process.cwd(), 'src')
const tourDir = path.join(root, 'components/tour')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
}

// Source without comments: a word in a comment is not code. (A `//` after a colon is a URL, not a comment.)
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

// What a file imports: static imports and re-exports (at the start of a line, so a word in a string cannot pass for one),
// side-effect imports, and dynamic import() calls.
function importsOf(file: string): string[] {
  const source = code(file)
  const statements = [...source.matchAll(/^(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const sideEffects = [...source.matchAll(/^import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const dynamic = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
  return [...statements, ...sideEffects, ...dynamic]
}

const ALLOWED_IMPORTS = [/^react$/, /^next\/(navigation|link)$/, /^lucide-react$/, /^zod$/, /^@\/components\/ui\//, /^@\/lib\/utils$/, /^\.\//]

const FORBIDDEN: [RegExp, string][] = [
  [/\bpost(Acts|Reveal|Identity)\b|\.post\(|\.reveal\(|switchIdentity/, 'a workspace writer'],
  [/WorkspaceContext|useWorkspace|useActHost/, 'the workspace (the tour reads nothing from it, so it never waits for it)'],
  [/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|new Request\b/, 'a raw request'],
  [/\.click\b|\.submit\b|\.requestSubmit\b|dispatchEvent/, 'a synthetic press'],
  [/location\.(assign|replace)\b|window\.open|\/api\//, 'a navigation that is not the router'],
]

describe('src/components/tour', () => {
  const files = walk(tourDir)

  it('has source to check, nested folders included', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  for (const file of files) {
    const name = path.relative(tourDir, file)
    it(`${name} imports only what a read-only tour may`, () => {
      const imports = importsOf(file)
      for (const spec of imports) expect(ALLOWED_IMPORTS.some((re) => re.test(spec)), `${name} imports "${spec}", which the tour may not`).toBe(true)
    })

    it(`${name} calls nothing that writes`, () => {
      const source = code(file)
      for (const [pattern, what] of FORBIDDEN) expect(source, `${name} must not use ${what}`).not.toMatch(pattern)
    })
  }
})

describe('what can write, repo-wide (the tour guard lives in components/workspace/api.ts)', () => {
  const client = walk(root).filter((f) => !f.includes(`${path.sep}app${path.sep}api${path.sep}`) && !f.includes(`${path.sep}lib${path.sep}server${path.sep}`))
  const sitesOf = (re: RegExp): string[] => client.filter((f) => re.test(code(f))).map((f) => path.relative(root, f).split(path.sep).join('/')).sort()

  it('has two places in the browser that make requests: the API client and the Fresh copy switch', () => {
    expect(sitesOf(/\bfetch\(/), 'a new request site: send it through components/workspace/api.ts, or check the tour guard covers it and add it here').toEqual([
      'components/firm/firm-page.tsx',
      'components/workspace/api.ts',
    ])
  })

  it('calls the two act-log writers from the provider only', () => {
    expect(sitesOf(/\bpost(Acts|Reveal)\(/), 'a new caller of postActs/postReveal: it must go through the provider').toEqual(['components/workspace/api.ts', 'components/workspace/provider.tsx'])
  })

  it('asks the tour guard first in each of those writers', () => {
    const api = code(path.join(root, 'components/workspace/api.ts'))
    expect(api).toMatch(/export async function postActs\([^)]*\)[^{]*\{\s*refuseDuringTour\(/)
    expect(api).toMatch(/export async function postReveal\([^)]*\)[^{]*\{\s*refuseDuringTour\(/)
  })
})
