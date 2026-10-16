'use client'
// The keyboard shortcuts (queue spec §5): a "?" button in the top bar from lg, and the ? key on every staff page. The
// list is SHORTCUTS, so a key a screen adds is written down once, here.
import { Fragment, useEffect, useState } from 'react'
import { CircleQuestionMarkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { inOverlay, isTypingTarget, type ElLike } from './keys'

export const SHORTCUTS: { section: 'Everywhere' | 'Queue' | 'Full trace page'; items: { keys: string[]; label: string }[] }[] = [
  {
    section: 'Everywhere',
    items: [
      { keys: ['⌘K'], label: 'Search refs and labels' },
      { keys: ['⌘B'], label: 'Collapse or expand the navigation' },
      { keys: ['?'], label: 'This list' },
    ],
  },
  {
    section: 'Queue',
    items: [
      { keys: ['j', 'k'], label: 'Next and previous row' },
      { keys: ['Enter'], label: 'Open the claim beside the list' },
      { keys: ['Shift+Enter'], label: 'Open the full trace page' },
      { keys: ['Esc'], label: 'Close the claim' },
      { keys: ['x'], label: 'Select the row' },
      { keys: ['a'], label: 'Adjust' },
      { keys: ['v'], label: 'Verify' },
      { keys: ['n'], label: 'Add a note' },
      { keys: ['u'], label: 'Undo your last act' },
      { keys: ['/'], label: 'Search the queue' },
    ],
  },
  {
    section: 'Full trace page',
    items: [{ keys: ['1', '2', '3'], label: 'Switch Evidence, Built and History' }],
  },
]

/** Whether "?" opens the list: not while typing (there the key types "?"), not inside an overlay that owns its keys (a
 *  menu, a list box, the tour card), and not while any dialog-content is open (an act form, search, or this list). The
 *  claim drawer is a Base UI popup without that slot, and inOverlay exempts it, so it does not count. */
export function shouldOpenShortcuts(target: ElLike, dialogOpen: boolean): boolean {
  return !dialogOpen && !isTypingTarget(target) && !inOverlay(target)
}

export function ShortcutHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift is how "?" is typed on most layouts, so only the other modifiers rule it out.
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      if (!shouldOpenShortcuts(target, document.querySelector('[data-slot="dialog-content"]') !== null)) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(true)}
              aria-label="Keyboard shortcuts (?)"
              className="hidden cursor-pointer rounded-full text-foreground/75 transition-colors duration-200 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none pointer-coarse:size-11 lg:inline-flex"
            />
          }
        >
          <CircleQuestionMarkIcon aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">Keyboard shortcuts (?)</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Single keys and ⌘B work while you are not typing in a field or using a menu, ⌘B only on screens 1024 px
              wide or more. ⌘K works anywhere. On Windows and Linux, ⌘ is Ctrl.
            </DialogDescription>
          </DialogHeader>
          {SHORTCUTS.map((s) => (
            <section key={s.section} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{s.section}</h3>
              <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-1.5">
                {s.items.map((item) => (
                  <Fragment key={item.label}>
                    <dt>
                      <KbdGroup>
                        {item.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </dt>
                    <dd>{item.label}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </DialogContent>
      </Dialog>
    </>
  )
}
