/** Amounts are integer paise everywhere. These helpers are the only place that converts. */

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;

const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,23,456 — always positive; callers add the sign. */
export function inr(paise: number): string {
  return "₹" + fmt.format(Math.round(Math.abs(paise) / 100));
}

/** ₹1.2k, ₹4.5L, ₹1.20Cr — for tight spaces. */
export function inrCompact(paise: number): string {
  const r = Math.abs(paise) / 100;
  if (r >= 1e7) return "₹" + (r / 1e7).toFixed(2) + "Cr";
  if (r >= 1e5) return "₹" + (r / 1e5).toFixed(2) + "L";
  if (r >= 1e3) return "₹" + (r / 1e3).toFixed(1) + "k";
  return "₹" + Math.round(r);
}

/** Signed display: −₹340 / +₹18,000 */
export function inrSigned(paise: number): string {
  return (paise < 0 ? "−" : "+") + inr(paise);
}
