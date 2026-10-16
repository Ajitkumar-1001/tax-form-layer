'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CompassIcon, SearchIcon, XIcon } from 'lucide-react'
import { refHref } from '@/components/atoms/format'
import { Button } from '@/components/ui/button'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DialogClose } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { openTour } from '@/components/tour/store'
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
  const wantsTour = q !== '' && ['tour', 'take the tour', 'help', 'guide'].some((w) => w.startsWith(q))
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
      {/* Centred on the screen: top-1/2 -translate-y-1/2 replaces the primitive's upper-third anchor (ui/command.tsx). A centred box
          re-centres whenever its height changes, so the list below is a fixed height, not a maximum: the input stays put as hits come and go. */}
      <CommandDialog open={open} onOpenChange={setOpen} title="Search the workpaper" description="Find a line, document, household fact or client answer by ref or label" className="top-1/2 -translate-y-1/2 sm:max-w-2xl">
        {/* The field stops short of the top-right corner (pr-11) for the close button below. That button sits outside <Command> on purpose:
            Command's root handler swallows Enter (preventDefault, then it picks the highlighted hit), so a button inside it could not be
            pressed with Enter. */}
        <Command shouldFilter={false} className="**:data-[slot=command-input-wrapper]:pr-11">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Ref or label: F8949.B, D28, 1099-B" />
          <CommandList className="h-96 max-h-[60svh]">
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
            {wantsTour && (
              <CommandGroup heading="Help">
                <CommandItem
                  value="help:tour"
                  onSelect={() => {
                    setOpen(false)
                    setQuery('')
                    openTour()
                  }}
                >
                  <CompassIcon /> Take the tour
                </CommandItem>
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
        {/* 32 px, as the shell's other icon buttons. On coarse pointers the ::after widens the hit area to 44 px without moving the visible
            button, so it keeps its 8 px inset and its focus ring is never clipped by the dialog's edge. */}
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 cursor-pointer transition-colors duration-200 hover:bg-foreground/[0.08] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:-inset-[7px] pointer-coarse:after:content-['']"
              aria-label="Close search"
              title="Close (Esc)"
            />
          }
        >
          <XIcon />
        </DialogClose>
      </CommandDialog>
    </>
  )
}
