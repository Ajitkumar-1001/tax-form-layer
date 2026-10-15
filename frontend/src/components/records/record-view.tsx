'use client'
// /records/[name]: one record, built from packet + acts by its pure builder and rendered by ClaimTable.
import Link from 'next/link'
import { PrinterIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { BUILDERS } from './builders'
import { ClaimTable } from './claim-table'
import { recordInfo } from './registry'

export function RecordView({ name }: { name: string }) {
  const { model, state } = useWorkspace()
  const info = recordInfo(name)
  const build = BUILDERS[name]
  if (!info || !build) return null // the page answers unknown names with notFound()
  const table = build(model, state)
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 print:p-0">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground print:hidden">
            <Link href="/records" className="hover:underline">Records</Link> / {info.name}
          </nav>
          <h1 className="text-lg font-semibold">{info.title}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">What this proves: </span>
            {info.proves}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()} className="print:hidden">
          <PrinterIcon /> Print
        </Button>
      </header>
      <ClaimTable table={table} />
    </div>
  )
}
