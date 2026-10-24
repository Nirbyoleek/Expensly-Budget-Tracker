"use client";

import { useState } from "react";

/**
 * "Where do I get a statement?" Kept to steps that hold across banks, with each bank's menu name,
 * because exact screens change often. Opens closed, inside the statement import pane.
 */
const BANKS: Record<string, { where: string; tip?: string }> = {
  HDFC: { where: "NetBanking or the HDFC app → Accounts → Account statement. Pick the dates and download as PDF or Excel/CSV." },
  SBI: { where: "YONO or SBI Online → Account statement. Choose the date range and download or email the PDF." },
  ICICI: { where: "iMobile or ICICI Internet Banking → Accounts → Statement. Download the PDF or Excel." },
  Axis: { where: "Axis Mobile or Internet Banking → Accounts → Statement. Download as PDF or Excel." },
  Kotak: { where: "Kotak app or Net Banking → Accounts → Statement. Download PDF or Excel." },
  Other: { where: "In your bank's app or net banking, look for Statement or Account statement under Accounts. Choose the last 1–3 months and download." },
};

export default function StatementGuide() {
  const [bank, setBank] = useState("HDFC");
  const b = BANKS[bank];
  return (
    <details className="guide">
      <summary>Where do I get a statement?</summary>
      <div className="guide-body">
        <div className="guide-banks" role="radiogroup" aria-label="Your bank">
          {Object.keys(BANKS).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={bank === k} className={bank === k ? "on" : ""} onClick={() => setBank(k)}>{k}</button>
          ))}
        </div>
        <ol>
          <li>{b.where}</li>
          <li><b>Pick Excel/CSV if it&apos;s offered.</b> It reads more reliably than a PDF. PDFs work too.</li>
          <li><b>Credit cards:</b> use the monthly e-statement PDF from your email. Its password is usually explained in that email (often part of your name plus your date of birth).</li>
          <li>Upload it here. It&apos;s read on this device and the file is never uploaded; duplicates are skipped.</li>
        </ol>
      </div>
    </details>
  );
}
