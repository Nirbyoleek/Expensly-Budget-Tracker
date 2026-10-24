"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateTransaction } from "@/app/actions";
import { Sheet, useApp } from "@/components/app";
import { SubPicker } from "@/components/CategoryPicker";
import { CategoryPickerWithNew } from "@/components/CategoryForm";
import { isGenericName, prepareRow, vpaOf } from "@/lib/ingest/core";
import { fullCategoryName } from "@/lib/taxonomy";
import { toPaise } from "@/lib/money";
import type { Transaction } from "@/lib/types";

const SOURCE: Record<string, string> = {
  manual: "Added by you",
  sms: "Read from a bank SMS",
  shortcut: "Forwarded by your iOS Shortcut",
  import: "Imported from a statement",
  sample: "Sample data",
};

export default function TxSheet({ tx, onClose, onDelete, startWithDelete, onMerchant, similar = 0 }: { tx: Transaction; onClose: () => void; onDelete: () => void; startWithDelete?: boolean; onMerchant?: () => void; similar?: number }) {
  const { cats, toast, rules, memory } = useApp();
  const router = useRouter();
  const [name, setName] = useState(tx.merchant_name);
  const [amount, setAmount] = useState(String(Math.abs(tx.amount_paise) / 100));
  const [date, setDate] = useState(tx.date);
  const [cat, setCat] = useState(tx.category_id);
  const [sub, setSub] = useState<string | null>(tx.subcategory_id ?? null);
  const [note, setNote] = useState(tx.note ?? "");
  // A real payee (a UPI ID or a proper name) can be learned; "Money sent" can't.
  const learnable = !!vpaOf(tx.merchant_raw) || !isGenericName(tx.merchant_name);
  const [always, setAlways] = useState(learnable);
  const [confirmDelete, setConfirmDelete] = useState(Boolean(startWithDelete));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [moneyIn, setMoneyIn] = useState(tx.amount_paise > 0);
  // Why Expensly filed it here: re-run the categoriser on the original bank text.
  const why = useMemo(() => {
    if (!tx.merchant_raw || tx.source === "manual" || tx.source === "sample") return null;
    const r = prepareRow({ date: tx.date, amount_paise: tx.amount_paise, merchant_raw: tx.merchant_raw, source: tx.source === "shortcut" ? "shortcut" : tx.source }, rules, memory);
    return r.category_id === tx.category_id ? r.reasons : null;
  }, [tx, rules, memory]);
  const label = fullCategoryName(cat, sub, cats.find((c) => c.id === cat)?.name);

  const save = () => {
    const rupees = parseFloat(amount.replace(/,/g, ""));
    if (!(rupees > 0)) return setError("Enter an amount above zero.");
    setError("");
    start(async () => {
      const r = await updateTransaction(tx.id, { merchant_name: name, amount_paise: (moneyIn ? 1 : -1) * toPaise(rupees), date, category_id: cat, subcategory_id: sub, note: note.trim() || null }, always && learnable && (cat !== tx.category_id || sub !== (tx.subcategory_id ?? null)));
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
      const more = r.ok ? r.alsoChanged : 0;
      toast(more || (always && learnable && cat !== tx.category_id) ? `Saved${more ? ` · ${more} more from ${tx.merchant_name} re-filed` : ""}. Future ones go to ${label} too.` : "Saved");
    });
  };

  return (
    <Sheet title="Transaction" onClose={onClose}>
      <label className="lbl" htmlFor="tx-name">NAME<input id="tx-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <div className="btns">
        <label className="lbl" htmlFor="tx-amount">AMOUNT (₹)<input id="tx-amount" className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="lbl" htmlFor="tx-date">DATE<input id="tx-date" className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="seg" role="group" aria-label="Direction">
        <button type="button" aria-pressed={!moneyIn} onClick={() => setMoneyIn(false)}>Money out</button>
        <button type="button" aria-pressed={moneyIn} onClick={() => setMoneyIn(true)}>Money in</button>
      </div>
      <div className="lbl">CATEGORY</div>
      <CategoryPickerWithNew value={cat} onChange={(c) => { setCat(c); setSub(null); if (c === "income") setMoneyIn(true); }} />
      <SubPicker category={cat} value={sub} onChange={setSub} />
      {cat === "uncat" && <p className="hint warn-text">Pick a category to take this out of “To review”. None fit? Use ＋ New category.</p>}
      {why && cat === tx.category_id && (
        <div className="note" style={{ fontSize: 12 }}>
          <b>Why {label}?</b>
          <ul className="why">{why.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {learnable && (cat !== tx.category_id || sub !== (tx.subcategory_id ?? null)) && (
        <label className="check" htmlFor="tx-always">
          <input id="tx-always" type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          {similar > 0 ? `Also move the other ${similar} from ${tx.merchant_name}, and future ones` : `Always put ${tx.merchant_name} in ${label}`}
        </label>
      )}
      <label className="lbl" htmlFor="tx-note">NOTE<input id="tx-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500} /></label>
      <div className="note" style={{ fontSize: 12 }}>
        <b>Source</b>
        {SOURCE[tx.source] ?? tx.source}{tx.reviewed ? " · Reviewed" : " · Waiting for review"}
        {tx.merchant_raw && <span className="muted" style={{ display: "block", marginTop: 4, wordBreak: "break-word" }}>{tx.merchant_raw.split(" | ").pop()}</span>}
      </div>
      {confirmDelete && (
        <div className="note danger">
          <b>Delete {tx.merchant_name}?</b>It comes out of your budgets and reports. You can undo for a few seconds.
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: "flex-start", gap: 16, flexWrap: "wrap" }}>
        {onMerchant && <button className="link" onClick={onMerchant}>Everything from {tx.merchant_name} →</button>}
        <Link className="link" href={`/ask?q=${encodeURIComponent(`Tell me about my spending at ${tx.merchant_name}: how often, how much, and is it going up?`)}`}>✦ Ask AI about this</Link>
      </div>
      <div className="btns">
        <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Delete</button>
        <button className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : tx.reviewed ? "Save" : "Save & approve"}</button>
      </div>
    </Sheet>
  );
}
