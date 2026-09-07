import { DiscountKind } from './dto/fee-structure.dto';

/**
 * Server-side mirror of `frontend/src/features/fees/lib/invoiceCalc.ts` — the frontend only
 * *previews* a discount before generating an invoice (that file's own top comment: "only
 * genuinely client-side math lives here... the invoice's actual status is server-computed"), so
 * the real computation the client preview must agree with lives here, run once at invoice
 * generation time and never trusted from the client afterward.
 */

export interface DiscountRule {
  label: string;
  kind: DiscountKind;
  value: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Rounded to 2dp, clamped at 0 — a rule (or their sum) can't discount past a free invoice. */
export function computeDiscountedAmount(
  baseAmount: number,
  discountRules: DiscountRule[],
): number {
  const totalDiscount = discountRules.reduce((sum, rule) => {
    const amount =
      rule.kind === 'percentage' ? baseAmount * (rule.value / 100) : rule.value;
    return sum + amount;
  }, 0);
  return Math.max(0, round2(baseAmount - totalDiscount));
}

/** `totalAmount - paidAmount`, clamped at 0 (an overpayment never shows as a negative balance). */
export function computeInvoiceBalance(invoice: {
  totalAmount: number;
  paidAmount: number;
}): number {
  return Math.max(0, round2(invoice.totalAmount - invoice.paidAmount));
}

/** Percent of `totalInvoiced` actually collected — `0` (not `NaN`) when nothing's been invoiced yet. */
export function computeCollectionRatePercent(totals: {
  totalCollected: number;
  totalOutstanding: number;
}): number {
  const totalInvoiced = totals.totalCollected + totals.totalOutstanding;
  if (totalInvoiced <= 0) return 0;
  return Math.round((totals.totalCollected / totalInvoiced) * 1000) / 10;
}

/**
 * `pending`/`partial`/`paid` are computed fresh from `totalAmount`/`paidAmount` every time a
 * payment is recorded or refunded — always accurate. `overdue` additionally depends on wall-clock
 * time relative to `dueDate`, so it's re-checked here at read time too (`InvoicesService`'s
 * callers), not just at write time — see `Invoice`'s own schema doc comment for the one real gap
 * this leaves (no scheduled sweep flips a stale row in the database itself). `cancelled` is never
 * set by this function — nothing in this phase's contract cancels an invoice.
 */
export function computeInvoiceStatus(
  totalAmount: number,
  paidAmount: number,
  dueDate: Date,
  now: Date = new Date(),
): 'pending' | 'partial' | 'paid' | 'overdue' {
  if (totalAmount > 0 && paidAmount >= totalAmount) return 'paid';
  if (paidAmount > 0) return 'partial';
  return dueDate.getTime() < now.getTime() ? 'overdue' : 'pending';
}
