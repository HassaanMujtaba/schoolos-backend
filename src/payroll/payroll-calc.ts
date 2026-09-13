import { round2 } from '../fees/fee-calc';

/**
 * Server-side implementation of PRD §20's formula — the only place this computation runs. The
 * frontend only ever displays a `PayslipBreakdown` (module doc "Payroll math ... is computed
 * entirely server-side"), never recomputes it, same discipline `fee-calc.ts`'s own header comment
 * documents for invoice totals.
 *
 * ```
 * Basic Salary + Allowances + Overtime + Bonus - Tax - Deductions - Absence - Loans = Net Salary
 * ```
 *
 * **A real, flagged limit, not a bug:** `overtime`/`bonus` are always `0` this phase — nothing in
 * this contract captures a per-period overtime-hours or bonus-amount input yet (the PRD's own
 * §20 feature list names them, but `SalaryStructureForm`'s fixed inputs don't extend that far —
 * module doc "Simplifications made to fit this doc's own scope"). `absenceDeduction` **is** real:
 * it's derived from approved `unpaid` `EmployeeLeaveRequest` days that overlap the payroll
 * period, at a flat `basicSalary / 30` daily rate (also this function's own assumption — no
 * per-tenant working-days-per-month config exists yet).
 */
export interface PayslipInputs {
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  taxDeduction: number;
  loanDeduction: number;
  otherDeduction: number;
  unpaidLeaveDaysInPeriod: number;
}

export interface PayslipBreakdown {
  basicSalary: number;
  allowances: number;
  overtime: number;
  bonus: number;
  tax: number;
  deductions: number;
  absenceDeduction: number;
  loanDeduction: number;
  netPay: number;
}

export function computePayslipBreakdown(
  inputs: PayslipInputs,
): PayslipBreakdown {
  const allowances = round2(
    inputs.housingAllowance + inputs.transportAllowance + inputs.otherAllowance,
  );
  const overtime = 0;
  const bonus = 0;
  const tax = round2(inputs.taxDeduction);
  const deductions = round2(inputs.otherDeduction);
  const dailyRate = inputs.basicSalary / 30;
  const absenceDeduction = round2(dailyRate * inputs.unpaidLeaveDaysInPeriod);
  const loanDeduction = round2(inputs.loanDeduction);

  const netPay = Math.max(
    0,
    round2(
      inputs.basicSalary +
        allowances +
        overtime +
        bonus -
        tax -
        deductions -
        absenceDeduction -
        loanDeduction,
    ),
  );

  return {
    basicSalary: round2(inputs.basicSalary),
    allowances,
    overtime,
    bonus,
    tax,
    deductions,
    absenceDeduction,
    loanDeduction,
    netPay,
  };
}
