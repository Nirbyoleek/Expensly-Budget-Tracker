/** All "today" logic uses India time so the month never flips early on a UTC server. */

const TZ = "Asia/Kolkata";

export function todayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA gives YYYY-MM-DD
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function monthStart(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shift a YYYY-MM-01 by n months. */
export function addMonths(monthIso: string, n: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

export function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const monthShort = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
export const monthLong = (iso: string) => `${LONG_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** "Oct 22" */
export const shortDate = (iso: string) => `${monthShort(iso)} ${dayOf(iso)}`;

/** "Thursday, 22 Oct" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MONTHS[m - 1]}`;
}

/** Monday-first weekday index (0 = Mon) of the 1st of the month. */
export function firstWeekdayMon(monthIso: string): number {
  const [y, m] = monthIso.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}
