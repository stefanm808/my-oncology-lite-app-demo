import { useState } from "react";

const C = {
  bg: "#ffffff", surface: "#f7f8fa", surfaceAlt: "#eef0f4", border: "#e2e5ec",
  text: "#1a1d26", textMuted: "#6b7280", accent: "#2563eb", accentLight: "#dbeafe",
  favorable: "#059669", favorableLight: "#d1fae5",
  unfavorable: "#dc2626", unfavorableLight: "#fee2e2",
  neutral: "#d97706", neutralLight: "#fef3c7",
  actionable: "#7c3aed", actionableLight: "#ede9fe",
};

const S = {
  app: { fontFamily: "'Source Sans 3', sans-serif", background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" },
  header: { padding: "14px 20px", background: C.bg, borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", gap: 12 },
  main: { flex: 1, padding: "16px 16px 100px", maxWidth: 600, margin: "0 auto", width: "100%", boxSizing: "border-box" },
  nav: { position: "fixed", bottom: 0, left: 0, right: 0, background: C.bg, borderTop: "1px solid " + C.border, display: "flex", justifyContent: "space-around", padding: "6px 0 10px", zIndex: 100 },
  navBtn: (a) => ({ background: "none", border: "none", color: a ? C.accent : C.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10, fontWeight: a ? 700 : 500, cursor: "pointer", padding: "4px 10px" }),
  card: { background: C.surface, borderRadius: 12, padding: 18, marginBottom: 12, border: "1px solid " + C.border },
  disclaimer: { padding: "12px 16px", background: C.surface, borderRadius: 10, border: "1px solid " + C.border, marginTop: 16, fontSize: 11, color: C.textMuted, lineHeight: 1.6, textAlign: "center" },
};

function NavIcon({ name, size = 20 }) {
  const p = { width: size, height: size, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "patients") return <svg {...p} viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>;
  if (name === "classifier") return <svg {...p} viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
  if (name === "treatment") return <svg {...p} viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
  if (name === "survival") return <svg {...p} viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/></svg>;
  if (name === "molecular") return <svg {...p} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>;
  return null;
}

const NAV = [
  { key: "patients", icon: "patients", label: "Patients" },
  { key: "classifier", icon: "classifier", label: "Risk" },
  { key: "treatment", icon: "treatment", label: "Treatment" },
  { key: "survival", icon: "survival", label: "Survival" },
  { key: "molecular", icon: "molecular", label: "Molecular" },
];

function Disclaimer() {
  return <div style={S.disclaimer}>For educational and research purposes only. Not intended for clinical decision-making. Always consult a qualified healthcare provider.</div>;
}

export default function App() {
  const [tab, setTab] = useState("patients");
  return (
    <div style={S.app}>
      <style>{String.raw`
        @import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; background: #fff; }
      `}</style>
      <header style={S.header}>
        <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #2563eb, #7c3aed)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 800 }}>M</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>MelaCDS</div>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Melanoma Decision Support</div>
        </div>
      </header>
      <main style={S.main}>
        <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{tab.charAt(0).toUpperCase() + tab.slice(1)} — under development</div>
        </div>
        <Disclaimer />
      </main>
      <nav style={S.nav}>
        {NAV.map(n => <button key={n.key} style={S.navBtn(tab === n.key)} onClick={() => setTab(n.key)}><NavIcon name={n.icon} /><span>{n.label}</span></button>)}
      </nav>
    </div>
  );
}
