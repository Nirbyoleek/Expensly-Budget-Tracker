/**
 * Quick-adds made with no connection wait here (this browser's storage) and are sent as soon as
 * the phone is back online. Only hand-typed entries are queued: imports need the server anyway.
 */
export type QueuedRow = {
  date: string; amount_paise: number; merchant_name: string; merchant_raw: string | null;
  category_id: string; subcategory_id: string | null; source: string; dedupe_hash?: string | null; reviewed: boolean;
};
type Entry = { id: string; at: number; rows: QueuedRow[] };

const KEY = "expensly.offline-queue.v1";
const MAX = 200;

function read(store: Storage | undefined): Entry[] {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((e) => e && Array.isArray(e.rows)) : [];
  } catch { return []; }
}
function write(store: Storage | undefined, list: Entry[]) {
  try { store?.setItem(KEY, JSON.stringify(list.slice(-MAX))); return true; } catch { return false; }
}
const local = () => (typeof window === "undefined" ? undefined : window.localStorage);

/** Looks like the request never reached the server (as opposed to the server saying no). */
export const isOfflineError = (e: unknown) =>
  (typeof navigator !== "undefined" && navigator.onLine === false) || (e instanceof TypeError) || /fetch|network|load failed/i.test(String((e as Error)?.message ?? e));

export function enqueue(rows: QueuedRow[], store = local()): boolean {
  if (!rows.length) return false;
  return write(store, [...read(store), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), rows }]);
}

export const pendingCount = (store = local()) => read(store).reduce((n, e) => n + e.rows.length, 0);

/**
 * Sends everything queued, oldest first. An entry leaves the queue once the server accepts it,
 * or rejects it outright (so one bad row can't block the rest forever); a network error stops the run.
 */
export async function flush(send: (rows: QueuedRow[]) => Promise<{ ok: boolean; added?: number }>, store = local()) {
  let added = 0, failed = 0;
  for (const e of read(store)) {
    let r: { ok: boolean; added?: number };
    try { r = await send(e.rows); } catch { break; }
    if (r.ok) added += r.added ?? e.rows.length; else failed += e.rows.length;
    write(store, read(store).filter((x) => x.id !== e.id));
  }
  return { added, failed, left: pendingCount(store) };
}
