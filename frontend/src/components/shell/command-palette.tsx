'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SearchIcon } from 'lucide-react'
import { refHref } from '@/components/atoms/format'
import { Button } from '@/components/ui/button'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { useWorkspace } from '@/components/workspace/context'
import { NAV } from './nav'
import { KIND_LABEL, paletteHits } from './search'

const LIMIT = 50

export function CommandPalette() {
  const { model } = useWorkspace()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(href: string) {
    setOpen(false)
    setQuery('')
    router.push(href)
  }

  const q = query.trim().toLowerCase()
  const pages = q ? NAV.filter((n) => n.label.toLowerCase().includes(q)) : []
  const { hits, heading } = open ? paletteHits(model.claimList, query, LIMIT) : { hits: [], heading: '' }

  return (
    <>
      <Button
        variant="ghost"
        className="cursor-pointer gap-2 rounded-full bg-muted px-3 text-foreground/75 ring-1 ring-inset ring-foreground/10 transition-colors duration-200 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none max-lg:pointer-coarse:h-11 max-lg:pointer-coarse:min-w-11"
        onClick={() => setOpen(true)}
        aria-label="Search refs and labels (⌘K)"
      >
        <SearchIcon />
        <span className="hidden 2xl:inline">Search refs and labels</span>
        {/* The hint shows from xl, the label from 2xl; below xl the button is the icon alone. Both keep the title whole. */}
        <Kbd className="hidden bg-background text-foreground/70 ring-1 ring-inset ring-foreground/10 xl:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search the workpaper" description="Find a line, document, household fact or client answer by ref or label" className="sm:max-w-2xl">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Ref or label: F8949.B, D28, 1099-B, theo…" />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>
            {pages.length > 0 && (
              <CommandGroup heading="Go to">
                {pages.map((n) => (
                  <CommandItem key={n.href} value={`page:${n.href}`} onSelect={() => go(n.href)}>
                    <n.icon /> {n.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {hits.length > 0 && (
              <CommandGroup heading={heading}>
                {hits.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => go(refHref(c.id))}>
                    <span className="w-40 shrink-0 truncate font-mono text-xs">{c.id}</span>
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[c.kind]}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
