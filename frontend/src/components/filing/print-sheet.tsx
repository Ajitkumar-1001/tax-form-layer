'use client'
import type { ReactNode } from 'react'
import { PrinterIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

// While the sheet is open, printing shows only the sheet (the app shell around it is hidden).
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet { position: absolute; inset: 0; padding: 0 !important; }
  .print-hide { display: none !important; }
}`

/** A full-screen, print-friendly view with Print and Close. Escape closes it. */
export function PrintSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 overflow-auto bg-background"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <style>{PRINT_CSS}</style>
      <div className="print-sheet mx-auto flex max-w-3xl flex-col gap-6 p-8 text-sm">
        <div className="print-hide flex items-center gap-2">
          <Button autoFocus onClick={() => window.print()}>
            <PrinterIcon /> Print
          </Button>
          <Button variant="outline" onClick={onClose}>
            <XIcon /> Close
          </Button>
          <span className="text-xs text-muted-foreground">Prints this sheet only.</span>
        </div>
        {children}
      </div>
    </div>
  )
}
