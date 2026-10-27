/** Calendar months in UTC, clamped to the last day of the target month. */
export function addBillingMonths(start: Date, months: number): Date {
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(months) || months < 1) throw new Error("Invalid billing period");
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}
