// Record name → pure builder. Kept apart from registry.ts so server pages can list names without the model code.
import type { Builder } from './table'
import { areas, deductions, rentals, retirementForeign, stateSplit, summary, swings, taxComputation } from './rows-return'
import { basis, carryovers, depreciation } from './rows-assets'
import { booksToTax, k1, priorPreparer } from './rows-sources'
import { payments, sales } from './rows-tieouts'

export const BUILDERS: Record<string, Builder> = {
  summary,
  'tax-computation': taxComputation,
  sales,
  payments,
  depreciation,
  'books-to-tax': booksToTax,
  'state-split': stateSplit,
  carryovers,
  basis,
  'prior-preparer': priorPreparer,
  rentals,
  k1,
  'retirement-foreign': retirementForeign,
  deductions,
  swings,
  areas,
}
