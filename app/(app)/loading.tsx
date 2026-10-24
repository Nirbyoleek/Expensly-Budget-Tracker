export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 52, borderRadius: 16, maxWidth: 320 }} />
      <div className="skel" style={{ height: 320, borderRadius: 28 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="skel" style={{ height: 130, borderRadius: 20 }} />
        <div className="skel" style={{ height: 130, borderRadius: 20 }} />
      </div>
      <div className="skel" style={{ height: 200, borderRadius: 22 }} />
    </div>
  );
}
