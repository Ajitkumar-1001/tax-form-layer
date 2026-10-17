'use client'
import type { ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { PrinterIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

// While the sheet is open, printing shows only the sheet (the app shell around it is hidden).
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet { position: absolute; inset: 0; padding: 0 !important; }
  .print-hide { display: none !important; }
}`

/** A full-screen, print-friendly view with Print and Close. Tab stays inside, Escape closes it, focus returns to the opener. */
export function PrintSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // "trap-focus" traps and hides the page like a modal but skips the scroll lock; an outside press (a toast) never closes it.
  return (
    <Dialog.Root
      open
      modal="trap-focus"
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) return
        // Base UI listens for Esc on the document for every open dialog; with the palette (or an act dialog) open over
        // the sheet, Esc closes that dialog alone.
        if (details.reason === 'escape-key' && document.querySelector('[data-slot="dialog-content"]')) details.cancel()
        else onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup aria-label={title} aria-modal="true" className="fixed inset-0 z-50 overflow-auto bg-background outline-none">
          <PrintSheetBody onClose={onClose}>{children}</PrintSheetBody>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The sheet's contents, free of Dialog parts so tests can render it. Print is the first tabbable element, so it takes
 *  first focus from the Dialog; nothing focuses itself. */
export function PrintSheetBody({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="print-sheet mx-auto flex max-w-3xl flex-col gap-6 p-8 text-sm">
        <div className="print-hide flex items-center gap-2">
          <Button onClick={() => window.print()}>
            <PrinterIcon /> Print
          </Button>
          <Button variant="outline" onClick={onClose}>
            <XIcon /> Close
          </Button>
          <span className="text-xs text-muted-foreground">Prints this sheet only.</span>
        </div>
        {children}
      </div>
    </>
  )
}
