'use client'
// The rail's collapse toggle (spec §3.2). The choice lives on <html data-rail>: the root layout's inline script sets it
// from localStorage before the first paint, and the rail-wide / rail-narrow variants (globals.css) read it, so the rail's
// width never waits for React and never flashes the default. This module reads and flips that attribute, nothing else.
import { useEffect, useSyncExternalStore } from 'react'
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { inOverlay, isTypingTarget } from './keys'

const KEY = 'wp:rail'
const WIDE = '(min-width: 80rem)' // xl: from here the rail is labelled unless collapsed
const LG = '(min-width: 64rem)' // lg: below this there is no rail

/** Whether the rail shows labels, from `<html data-rail>` and whether the viewport is xl or wider. Only the two known
 *  values count; anything else means the default (labelled from xl, icons from lg to xl). */
export function expandedFrom(dataRail: string | null | undefined, wide: boolean): boolean {
  return dataRail === 'expanded' || (dataRail !== 'collapsed' && wide)
}

/** What a toggle writes: the explicit opposite of what shows, so the choice holds at every width. */
export function nextRail(dataRail: string | null | undefined, wide: boolean): 'collapsed' | 'expanded' {
  return expandedFrom(dataRail, wide) ? 'collapsed' : 'expanded'
}

const listeners = new Set<() => void>()

// matchMedia is called lazily, never at import: this module is also imported where there is no window (tests, the server).
function subscribe(onChange: () => void) {
  const wide = matchMedia(WIDE)
  listeners.add(onChange)
  wide.addEventListener('change', onChange)
  return () => {
    listeners.delete(onChange)
    wide.removeEventListener('change', onChange)
  }
}
const snapshot = () => expandedFrom(document.documentElement.dataset.rail, matchMedia(WIDE).matches)
const serverSnapshot = () => null

/** Whether the rail shows labels; null on the server, where the stored choice and the width are unknown. */
export function useRailExpanded(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, snapshot, serverSnapshot)
}

export function toggleRail(): void {
  const next = nextRail(document.documentElement.dataset.rail, matchMedia(WIDE).matches)
  document.documentElement.dataset.rail = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // storage unavailable: the choice lasts for this page view only
  }
  for (const l of listeners) l()
}

/** ⌘B / Ctrl+B toggles the rail. One listener: call it once, in AppShell. */
export function useRailShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not with Shift (⌘⇧B is the browser's bookmarks bar) or Alt, and not a held key repeating.
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.repeat || e.defaultPrevented) return
      if (e.key !== 'b' && e.key !== 'B') return
      if (!matchMedia(LG).matches) return
      const el = e.target instanceof Element ? e.target : null
      if (isTypingTarget(el) || inOverlay(el)) return
      e.preventDefault()
      toggleRail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The collapse button, from lg: at the top bar's left edge (`topbar`), or as the last row of the rail's foot (`rail`),
 *  labelled "Collapse" while the rail is labelled. It renders only in the browser (the server snapshot is null). */
export function RailToggle({ placement }: { placement: 'topbar' | 'rail' }) {
  const expanded = useRailExpanded()
  if (expanded === null) return null
  const label = expanded ? 'Collapse navigation' : 'Expand navigation'
  const Icon = expanded ? PanelLeftCloseIcon : PanelLeftOpenIcon
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={placement === 'topbar' ? 'icon' : 'default'}
            onClick={toggleRail}
            aria-controls="rail"
            aria-expanded={expanded}
            aria-label={label}
            className={cn(
              'cursor-pointer text-foreground/75 transition-colors duration-200 hover:text-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none',
              placement === 'topbar'
                ? 'hidden rounded-full hover:bg-foreground/[0.08] pointer-coarse:size-11 lg:inline-flex'
                : // A row like the foot's others (rail.tsx): its icon on their edge at both widths (no border, so the
                  // padding alone offsets the negative margin), its label fading with the rail's own width like theirs. The
                  // ghost button's expanded fill would read as the current page.
                  '-mx-2 h-8 justify-start gap-2 rounded-lg border-0 px-2 text-xs text-foreground/70 hover:bg-foreground/[0.06] aria-expanded:bg-transparent aria-expanded:text-foreground/70 aria-expanded:hover:bg-foreground/[0.06] aria-expanded:hover:text-foreground pointer-coarse:h-11',
            )}
          />
        }
      >
        <Icon aria-hidden />
        {placement === 'rail' && <span className="truncate transition-opacity duration-200 @max-[12rem]:opacity-0 motion-reduce:transition-none">Collapse</span>}
      </TooltipTrigger>
      <TooltipContent side={placement === 'topbar' ? 'bottom' : 'right'}>{label} (⌘B)</TooltipContent>
    </Tooltip>
  )
}
