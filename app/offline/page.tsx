export const metadata = { title: "Offline · Expensly" };
export const dynamic = "force-static";

/** Shown by the service worker when there's no connection and no saved copy of the page. */
export default function Offline() {
  return (
    <main className="auth" style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
      <div className="card stack" style={{ maxWidth: 420, textAlign: "center" }}>
        <div className="logo" aria-hidden="true" style={{ margin: "0 auto" }}>E</div>
        <h1 style={{ fontSize: 22 }}>You&apos;re offline</h1>
        <p className="muted">Pages you&apos;ve opened recently still work. Spends you add with Quick add are kept on this phone and sync when you&apos;re back online.</p>
        <a className="btn" href="/home">Try again</a>
      </div>
    </main>
  );
}
