// The records a CPA expects, each with the one line it proves. Pure metadata: safe to import from server pages.

export interface RecordInfo {
  name: string
  title: string
  proves: string
}

export const RECORDS: RecordInfo[] = [
  { name: 'summary', title: 'Return summary vs last year', proves: 'Every key total is in line with 2024, or the swing is visible and flagged.' },
  { name: 'tax-computation', title: 'Tax computation', proves: 'Total tax (F1040 line 24) is built from the lines below it, with Sch 2, AMT, NIIT and Additional Medicare.' },
  { name: 'sales', title: 'Sales detail (Form 8949)', proves: 'Every broker summary ties to its lots; exceptions (blank or zero basis, wash sales, open findings) are visible, and each lot shows its residency period.' },
  { name: 'payments', title: 'Payments vs agency', proves: 'Each estimate, withholding and extension payment agrees with the IRS transcript and FTB ledger by date and year.' },
  { name: 'depreciation', title: 'Depreciation by asset', proves: 'Each asset has method, life and placed-in-service date, with federal, California and AMT amounts and recapture on disposal.' },
  { name: 'books-to-tax', title: 'Books to tax', proves: 'The studio P&L (D14) reconciles to Schedule C line by line; every difference is visible.' },
  { name: 'state-split', title: 'State split (Schedule CA 540NR)', proves: 'Each income line is split between federal, adjustments and California source, columns A to E.' },
  { name: 'carryovers', title: 'Carryovers', proves: 'What came in from 2024 is used or carried out, and stale carryovers are flagged.' },
  { name: 'basis', title: 'Basis by year', proves: 'Every stock, partnership, IRA and home basis chain has a source for each year; gaps are flagged.' },
  { name: 'prior-preparer', title: 'Prior preparer vs ours', proves: "The prior preparer's notes and open items each have our disposition, and our changes are listed." },
  { name: 'rentals', title: 'Rentals and passive losses', proves: 'Both rentals, the passive-loss limits and the condo sale (Form 4797) are on the return.' },
  { name: 'k1', title: 'K-1 lines', proves: 'Each K-1 box lands on the right line (Sch E part II, Form 7203, Sch B, Sch D).' },
  { name: 'retirement-foreign', title: 'Retirement and foreign', proves: 'IRA basis (8606), HSA (8889), foreign accounts (Sch B, 8938) and the FX year are consistent.' },
  { name: 'deductions', title: 'Deductions and credits with limits', proves: 'Itemized deductions respect the SALT cap; charitable, child-care and child-tax credits are within limits.' },
  { name: 'swings', title: 'Prior-year swings', proves: 'Every line over the firm variance threshold is listed, root causes first.' },
  { name: 'areas', title: 'Area summaries', proves: 'Each of the 9 areas shows its definition of done, open items and sign-offs.' },
]

export const recordInfo = (name: string): RecordInfo | undefined => RECORDS.find((r) => r.name === name)
