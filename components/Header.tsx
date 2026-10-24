import Link from "next/link";
import AddButton, { PaletteButton } from "./AddButton";
import NotificationBell from "./NotificationBell";

/**
 * Phone: the Expensly brand with the page name underneath.
 * Desktop: the sidebar carries the brand, so the header shows a large page title and actions.
 */
export default function Header({ title, subtitle, sample }: { title: string; subtitle?: string; sample?: boolean }) {
  return (
    <header className="top">
      <div className="brand only-mobile">
        <div className="logo" aria-hidden="true">E</div>
        <div>
          <h1>Expensly</h1>
          <small>{subtitle ? (title === "Overview" ? subtitle : `${title} · ${subtitle}`) : title}</small>
        </div>
      </div>
      <div className="page-title only-desktop">
        {subtitle && <div className="eyebrow">{subtitle}</div>}
        <h1>{title}</h1>
      </div>
      <div className="top-actions">
        {sample && <Link href="/settings" className="tag" title="Remove it in Settings">Sample data</Link>}
        <PaletteButton variant="icon" />
        <AddButton />
        <NotificationBell />
        <Link href="/settings" className="icon-btn only-mobile" aria-label="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
