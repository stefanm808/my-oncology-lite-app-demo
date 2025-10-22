import { useState, useEffect, useMemo } from "react";

// ─── Clinical Constants ──────────────────────────────────────────────────────

const MELANOMA_TYPES = ["Cutaneous", "Acral", "Mucosal", "Uveal", "Desmoplastic"];
const STAGES = ["0 (in situ)", "I", "IIA", "IIB", "IIC", "IIIA", "IIIB", "IIIC", "IIID", "IV M1a", "IV M1b", "IV M1c", "IV M1d"];
const BRAF_OPTIONS = ["V600E", "V600K", "Other V600", "Non-V600", "Wild-Type", "Unknown"];
const NRAS_OPTIONS = ["Mutant", "Wild-Type", "Unknown"];
const CKIT_OPTIONS = ["Mutant", "Wild-Type", "Unknown"];
const LDH_OPTIONS = ["Normal", "Elevated", "Unknown"];
const PD_L1_OPTIONS = ["Positive (≥1%)", "Negative (<1%)", "Unknown"];
const ULCERATION_OPTIONS = ["Present", "Absent", "Unknown"];
const SLN_OPTIONS = ["Positive", "Negative", "Not performed"];
const SEX_OPTIONS = ["Male", "Female"];
const ECOG_OPTIONS = ["0", "1", "2", "3", "4"];
const BRESLOW_RANGES = ["≤1.0 mm", "1.01–2.0 mm", "2.01–4.0 mm", ">4.0 mm"];

// ─── Classifier: Breslow + Ulceration → Risk ────────────────────────────────

function classifyRecurrenceRisk(breslow, ulceration, slnStatus, stage) {
  let score = 0;
  if (breslow === "≤1.0 mm") score += 1;
  else if (breslow === "1.01–2.0 mm") score += 2;
  else if (breslow === "2.01–4.0 mm") score += 3;
  else score += 4;

  if (ulceration === "Present") score += 2;
  if (slnStatus === "Positive") score += 3;
  if (stage && stage.startsWith("IV")) score += 4;
  else if (stage && stage.startsWith("III")) score += 2;

  const maxScore = 13;
  const riskPct = Math.min(Math.round((score / maxScore) * 100), 99);
  const category = riskPct <= 25 ? "Low" : riskPct <= 55 ? "Intermediate" : riskPct <= 80 ? "High" : "Very High";

  const features = [
    { name: "Breslow Depth", value: breslow, contribution: breslow === "≤1.0 mm" ? 1 : breslow === "1.01–2.0 mm" ? 2 : breslow === "2.01–4.0 mm" ? 3 : 4 },
    { name: "Ulceration", value: ulceration, contribution: ulceration === "Present" ? 2 : 0 },
    { name: "SLN Status", value: slnStatus, contribution: slnStatus === "Positive" ? 3 : 0 },
    { name: "Stage", value: stage || "N/A", contribution: stage?.startsWith("IV") ? 4 : stage?.startsWith("III") ? 2 : 0 },
  ];

  return { score, maxScore, riskPct, category, features };
}

// ─── Survival estimation (literature-calibrated) ─────────────────────────────

function estimateSurvival(stage, braf, ldh, ecog, age) {
  const baselines = {
    "0 (in situ)": 240, "I": 180, "IIA": 120, "IIB": 84, "IIC": 60,
    "IIIA": 72, "IIIB": 48, "IIIC": 36, "IIID": 24,
    "IV M1a": 22, "IV M1b": 16, "IV M1c": 12, "IV M1d": 8,
  };
  let median = baselines[stage] || 36;
  let modifier = 1.0;

  if (stage?.startsWith("IV") || stage?.startsWith("III")) {
    if (braf?.startsWith("V600")) modifier *= 1.3;
    if (ldh === "Normal") modifier *= 1.4;
    else if (ldh === "Elevated") modifier *= 0.7;
  }
  const ecogNum = parseInt(ecog) || 0;
  if (ecogNum >= 2) modifier *= 0.6;
  else if (ecogNum === 0) modifier *= 1.15;
  const ageNum = parseInt(age) || 55;
  if (ageNum > 70) modifier *= 0.8;
  else if (ageNum < 40) modifier *= 1.1;

  median = Math.round(median * modifier * 10) / 10;
  const lambda = Math.log(2) / median;
  const survAt = (t) => Math.exp(-lambda * t);

  return {
    medianOS: median,
    s12: Math.round(survAt(12) * 100),
    s24: Math.round(survAt(24) * 100),
    s60: Math.round(survAt(60) * 100),
    curve: Array.from({ length: 121 }, (_, i) => ({ month: i, survival: Math.round(survAt(i) * 1000) / 10 })),
  };
}

// ─── Treatment recommendation engine ────────────────────────────────────────

function generateTreatmentPlan(patient) {
  const recs = [];
  const { stage, braf, nras, ckit, ldh, pdl1, melanomaType } = patient;
  const isAdvanced = stage?.startsWith("IV") || stage?.startsWith("III");
  const isStageIV = stage?.startsWith("IV");

  // Adjuvant for resected stage III
  if (stage?.startsWith("III") && !isStageIV) {
    if (braf?.startsWith("V600")) {
      recs.push({
        category: "Adjuvant — Targeted",
        title: "Dabrafenib + Trametinib (12 months)",
        detail: "BRAF/MEK inhibition for resected BRAF V600-mutant stage III melanoma. COMBI-AD trial demonstrated significant relapse-free survival benefit.",
        evidence: "Level 1A",
        trial: "COMBI-AD — Long et al., NEJM 2017",
      });
    }
    recs.push({
      category: "Adjuvant — Immunotherapy",
      title: "Nivolumab (12 months)",
      detail: "Anti-PD-1 checkpoint inhibitor for resected stage IIIB-IV melanoma. CheckMate 238 showed superior RFS vs ipilimumab.",
      evidence: "Level 1A",
      trial: "CheckMate 238 — Weber et al., NEJM 2017",
    });
    recs.push({
      category: "Adjuvant — Immunotherapy",
      title: "Pembrolizumab (12 months)",
      detail: "Anti-PD-1 for resected stage III melanoma. KEYNOTE-054 demonstrated significant improvement in recurrence-free survival.",
      evidence: "Level 1A",
      trial: "KEYNOTE-054 — Eggermont et al., NEJM 2018",
    });
  }

  // Unresectable / metastatic (stage IV)
  if (isStageIV) {
    recs.push({
      category: "First-Line — Immunotherapy",
      title: "Nivolumab + Ipilimumab",
      detail: "Combined PD-1 + CTLA-4 blockade. CheckMate 067 showed 52% 5-year OS rate. Higher toxicity profile but durable responses. Consider for BRAF-WT and fit patients.",
      evidence: "Level 1A",
      trial: "CheckMate 067 — Larkin et al., NEJM 2015; Wolchok et al., NEJM 2022",
    });
    recs.push({
      category: "First-Line — Immunotherapy",
      title: "Nivolumab + Relatlimab",
      detail: "PD-1 + LAG-3 blockade. RELATIVITY-047 showed improved PFS vs nivolumab alone with more favorable toxicity profile than nivo+ipi.",
      evidence: "Level 1B",
      trial: "RELATIVITY-047 — Tawbi et al., NEJM 2022",
    });

    if (braf?.startsWith("V600")) {
      recs.push({
        category: "First-Line — Targeted (BRAF V600+)",
        title: "Encorafenib + Binimetinib",
        detail: "BRAF + MEK inhibition. COLUMBUS trial showed median PFS 14.9 months and favorable tolerability. Preferred targeted combo for rapid disease control.",
        evidence: "Level 1A",
        trial: "COLUMBUS — Dummer et al., Lancet Oncol 2018",
      });
      recs.push({
        category: "First-Line — Targeted (BRAF V600+)",
        title: "Dabrafenib + Trametinib",
        detail: "BRAF + MEK inhibition with established long-term data. COMBI-v/-d trials. 5-year OS ~34%. Consider when rapid response needed (high tumor burden, elevated LDH).",
        evidence: "Level 1A",
        trial: "COMBI-v — Robert et al., NEJM 2015",
      });
    }

    if (nras === "Mutant") {
      recs.push({
        category: "Consider — NRAS Mutant",
        title: "Binimetinib (MEK inhibitor)",
        detail: "NEMO trial showed modest PFS benefit for NRAS-mutant melanoma. Generally, immunotherapy preferred first-line. Consider if immunotherapy fails.",
        evidence: "Level 2B",
        trial: "NEMO — Dummer et al., Lancet Oncol 2017",
      });
    }

    if (ckit === "Mutant") {
      recs.push({
        category: "Consider — c-KIT Mutant",
        title: "Imatinib",
        detail: "KIT-mutant melanomas (common in acral/mucosal) may respond to imatinib, especially with exon 11/13 mutations. Limited but meaningful responses reported.",
        evidence: "Level 2B",
        trial: "Guo et al., JCO 2011; Carvajal et al., JAMA 2011",
      });
    }
  }

  // Early stage surgical
  if (!isAdvanced || stage?.startsWith("III")) {
    recs.push({
      category: "Surgical",
      title: "Wide Local Excision",
      detail: `Margins per NCCN: in situ → 0.5–1 cm; ≤1 mm → 1 cm; 1.01–2 mm → 1–2 cm; >2 mm → 2 cm. Complete excision with histologically negative margins required.`,
      evidence: "Level 1A",
      trial: "NCCN Guidelines Melanoma v4.2024",
    });
  }

  if (stage?.startsWith("IV") && stage.includes("M1d")) {
    recs.push({
      category: "Brain Metastases",
      title: "SRS ± Immunotherapy",
      detail: "Stereotactic radiosurgery for limited brain metastases. Concurrent ipilimumab + nivolumab shows intracranial response rates of ~50%. CheckMate 204 data.",
      evidence: "Level 2A",
      trial: "CheckMate 204 — Tawbi et al., NEJM 2018",
    });
  }

  if (isStageIV) {
    recs.push({
      category: "Emerging",
      title: "Lifileucel (TIL therapy)",
      detail: "Tumor-infiltrating lymphocyte therapy for anti-PD-1 refractory unresectable/metastatic melanoma. FDA-approved 2024. C-144-01 trial showed 31.5% ORR.",
      evidence: "Level 2A",
      trial: "C-144-01 — Chesney et al., JCO 2022",
    });
  }

  return recs;
}

// ─── Molecular markers ──────────────────────────────────────────────────────

const MOLECULAR_MARKERS = {
  BRAF: {
    gene: "BRAF",
    fullName: "B-Raf Proto-Oncogene Serine/Threonine Kinase",
    description: "BRAF is a key kinase in the MAPK signaling pathway that tells cells when to grow and divide. The V600E mutation locks BRAF in an 'always on' state, driving uncontrolled cell proliferation.",
    mutant: { prognosis: "Actionable — BRAF V600 mutations are the primary target for combination BRAF/MEK inhibitor therapy. Also predicts response to adjuvant targeted therapy.", favorability: "actionable" },
    wildType: { prognosis: "No targeted BRAF therapy available. Immunotherapy (anti-PD-1 ± anti-CTLA-4) is the primary systemic approach.", favorability: "neutral" },
    therapies: ["Dabrafenib + Trametinib", "Encorafenib + Binimetinib", "Vemurafenib + Cobimetinib"],
    frequency: "~45-50% of cutaneous melanoma; ~15% acral; ~5% mucosal",
  },
  NRAS: {
    gene: "NRAS",
    fullName: "Neuroblastoma RAS Viral Oncogene Homolog",
    description: "NRAS is an upstream activator of both the MAPK and PI3K pathways. Mutations (most commonly Q61) drive tumor growth through parallel signaling cascades.",
    mutant: { prognosis: "Associated with thicker tumors and higher mitotic rate. MEK inhibitors show modest activity. Immunotherapy generally preferred.", favorability: "unfavorable" },
    wildType: { prognosis: "Neutral — absence of NRAS mutation does not independently predict outcome.", favorability: "neutral" },
    therapies: ["Binimetinib (MEK inhibitor — NEMO trial)", "Clinical trials: ERK inhibitors, combination approaches"],
    frequency: "~15-20% of cutaneous melanoma; mutually exclusive with BRAF V600",
  },
  CKIT: {
    gene: "c-KIT (CD117)",
    fullName: "KIT Proto-Oncogene Receptor Tyrosine Kinase",
    description: "KIT is a receptor tyrosine kinase involved in cell survival and proliferation. Activating mutations are enriched in melanomas arising from sun-protected or mucosal sites.",
    mutant: { prognosis: "Actionable in specific contexts — KIT exon 11 and 13 mutations may respond to imatinib. Amplifications are less predictive of response.", favorability: "actionable" },
    wildType: { prognosis: "Standard treatment approaches apply.", favorability: "neutral" },
    therapies: ["Imatinib (best for exon 11/13 mutations)", "Nilotinib", "Dasatinib (limited data)"],
    frequency: "~15-20% of acral; ~20-30% of mucosal; ~2-3% of cutaneous melanoma",
  },
  CDKN2A: {
    gene: "CDKN2A",
    fullName: "Cyclin-Dependent Kinase Inhibitor 2A (p16)",
    description: "CDKN2A encodes the p16 protein, a critical brake on the cell cycle. Loss of p16 removes a key checkpoint, allowing cells to divide without proper regulation. Germline mutations are the most common cause of familial melanoma.",
    lost: { prognosis: "Unfavorable — loss of p16 associated with more aggressive disease. Important for genetic counseling in familial melanoma.", favorability: "unfavorable" },
    intact: { prognosis: "Intact cell cycle regulation through this pathway.", favorability: "favorable" },
    therapies: ["CDK4/6 inhibitors (palbociclib, ribociclib — clinical trials in melanoma)", "Genetic counseling for germline carriers"],
    frequency: "~50% somatic loss in melanoma; ~40% of familial melanoma kindreds carry germline mutations",
  },
  TERT: {
    gene: "TERT",
    fullName: "Telomerase Reverse Transcriptase",
    description: "TERT promoter mutations reactivate telomerase, allowing tumor cells to maintain their chromosome ends and divide indefinitely. Among the most common mutations in melanoma.",
    mutant: { prognosis: "Associated with worse melanoma-specific survival in several studies. Frequently co-occurs with BRAF V600E.", favorability: "unfavorable" },
    normal: { prognosis: "Relatively favorable — absence may indicate less aggressive biology.", favorability: "neutral" },
    therapies: ["No approved targeted therapies. Telomerase inhibitors in early development."],
    frequency: "~70-80% of cutaneous melanoma; one of the most frequent somatic alterations",
  },
  PTEN: {
    gene: "PTEN",
    fullName: "Phosphatase and Tensin Homolog",
    description: "PTEN suppresses the PI3K/AKT survival pathway. When lost, this pathway drives resistance to cell death and may reduce sensitivity to both targeted therapy and immunotherapy.",
    lost: { prognosis: "Unfavorable — PTEN loss associated with resistance to anti-PD-1 immunotherapy and shorter survival. May predict resistance to BRAF inhibitors.", favorability: "unfavorable" },
    intact: { prognosis: "Favorable — intact PTEN associated with better immunotherapy responses.", favorability: "favorable" },
    therapies: ["PI3K inhibitors (alpelisib — under investigation)", "AKT inhibitors (clinical trials)", "Combination strategies to overcome resistance"],
    frequency: "~30-40% loss in cutaneous melanoma; ~10% in acral",
  },
  PDL1: {
    gene: "PD-L1 (CD274)",
    fullName: "Programmed Death-Ligand 1",
    description: "PD-L1 is a protein tumors display to evade the immune system. High PD-L1 expression suggests the immune system is trying to attack the tumor but is being blocked — a signal that checkpoint inhibitors may be effective.",
    positive: { prognosis: "Favorable for immunotherapy response — higher PD-L1 correlates with better anti-PD-1 outcomes. However, PD-L1-negative patients can still respond.", favorability: "favorable" },
    negative: { prognosis: "Lower but not absent probability of immunotherapy response. Combination immunotherapy (nivo+ipi) may still be effective.", favorability: "neutral" },
    therapies: ["Pembrolizumab (KEYNOTE-006)", "Nivolumab (CheckMate 066/067)", "Nivolumab + Ipilimumab", "Nivolumab + Relatlimab"],
    frequency: "~35-50% of melanomas show PD-L1 ≥1% (varies by assay and cutoff)",
  },
};

// ─── Colors & Styles ─────────────────────────────────────────────────────────

const C = {
  bg: "#ffffff",
  surface: "#f7f8fa",
  surfaceAlt: "#eef0f4",
  border: "#e2e5ec",
  text: "#1a1d26",
  textMuted: "#6b7280",
  accent: "#2563eb",
  accentLight: "#dbeafe",
  favorable: "#059669",
  favorableLight: "#d1fae5",
  unfavorable: "#dc2626",
  unfavorableLight: "#fee2e2",
  neutral: "#d97706",
  neutralLight: "#fef3c7",
  actionable: "#7c3aed",
  actionableLight: "#ede9fe",
};

const S = {
  app: { fontFamily: "'Source Sans 3', 'Helvetica Neue', sans-serif", background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" },
  header: { padding: "14px 20px", background: C.bg, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 },
  main: { flex: 1, padding: "16px 16px 100px", maxWidth: 600, margin: "0 auto", width: "100%", boxSizing: "border-box" },
  nav: { position: "fixed", bottom: 0, left: 0, right: 0, background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-around", padding: "6px 0 10px", zIndex: 100 },
  navBtn: (a) => ({ background: "none", border: "none", color: a ? C.accent : C.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10, fontWeight: a ? 700 : 500, cursor: "pointer", padding: "4px 10px" }),
  card: { background: C.surface, borderRadius: 12, padding: 18, marginBottom: 12, border: `1px solid ${C.border}` },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8, color: C.text },
  label: { fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 5, display: "block", textTransform: "uppercase", letterSpacing: "0.06em" },
  input: { width: "100%", padding: "9px 12px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "9px 12px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box" },
  btn: (v = "primary") => ({
    padding: "10px 20px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
    ...(v === "primary" ? { background: C.accent, color: "#fff" } :
      v === "danger" ? { background: C.unfavorableLight, color: C.unfavorable, border: `1px solid ${C.unfavorable}33` } :
      { background: C.surfaceAlt, color: C.textMuted, border: `1px solid ${C.border}` })
  }),
  badge: (color, bgColor) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bgColor || color + "18", color }),
  disclaimer: { padding: "12px 16px", background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, marginTop: 16, fontSize: 11, color: C.textMuted, lineHeight: 1.6, textAlign: "center" },
  mono: { fontFamily: "'IBM Plex Mono', 'SF Mono', monospace" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  pillGroup: { display: "flex", gap: 5, flexWrap: "wrap" },
  pill: (a) => ({ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${a ? C.accent : C.border}`, background: a ? C.accentLight : "#fff", color: a ? C.accent : C.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }),
};

// ─── Shared Components ───────────────────────────────────────────────────────

function Disclaimer() {
  return <div style={S.disclaimer}>For educational and research purposes only. Not intended for clinical decision-making. Always consult a qualified healthcare provider.</div>;
}
function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}><label style={S.label}>{label}</label>{children}</div>;
}
function PillSelect({ options, value, onChange }) {
  return <div style={S.pillGroup}>{options.map(o => <button key={o} style={S.pill(value === o)} onClick={() => onChange(o)}>{o}</button>)}</div>;
}
function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 3, marginBottom: 14, background: C.surfaceAlt, borderRadius: 10, padding: 3, overflowX: "auto" }}>
      {tabs.map(t => <button key={t} onClick={() => onChange(t)} style={{
        flex: "1 0 auto", padding: "7px 12px", borderRadius: 8, border: "none",
        background: active === t ? "#fff" : "transparent", boxShadow: active === t ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
        color: active === t ? C.accent : C.textMuted, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
      }}>{t}</button>)}
    </div>
  );
}
function NavIcon({ name, size = 20 }) {
  const p = { width: size, height: size, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "patients") return <svg {...p} viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
  if (name === "classifier") return <svg {...p} viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
  if (name === "treatment") return <svg {...p} viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
  if (name === "survival") return <svg {...p} viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>;
  if (name === "molecular") return <svg {...p} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>;
  return null;
}

// ─── Patient Screen ──────────────────────────────────────────────────────────

function PatientScreen({ patients, setPatients, onSelect }) {
  const [adding, setAdding] = useState(false);
  const empty = { name: "", age: "", sex: "Male", ecog: "0", melanomaType: "Cutaneous", stage: "IIA", breslow: "1.01–2.0 mm", ulceration: "Absent", slnStatus: "Not performed", braf: "Unknown", nras: "Unknown", ckit: "Unknown", ldh: "Unknown", pdl1: "Unknown" };
  const [form, setForm] = useState({ ...empty });
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name || !form.age) return;
    setPatients(p => [...p, { ...form, id: Date.now(), age: parseInt(form.age) }]);
    setAdding(false); setForm({ ...empty });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Patients</h2>
        <button style={S.btn("primary")} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ New"}</button>
      </div>
      {adding && (
        <div style={S.card}>
          <div style={S.cardTitle}>New Patient Profile</div>
          <Field label="Name"><input style={S.input} value={form.name} onChange={e => u("name", e.target.value)} placeholder="Patient ID or name" /></Field>
          <div style={S.grid2}>
            <Field label="Age"><input style={S.input} type="number" value={form.age} onChange={e => u("age", e.target.value)} /></Field>
            <Field label="ECOG PS"><PillSelect options={ECOG_OPTIONS} value={form.ecog} onChange={v => u("ecog", v)} /></Field>
          </div>
          <Field label="Sex"><PillSelect options={SEX_OPTIONS} value={form.sex} onChange={v => u("sex", v)} /></Field>
          <Field label="Melanoma Subtype"><PillSelect options={MELANOMA_TYPES} value={form.melanomaType} onChange={v => u("melanomaType", v)} /></Field>
          <Field label="AJCC Stage">
            <select style={S.select} value={form.stage} onChange={e => u("stage", e.target.value)}>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Breslow Depth"><PillSelect options={BRESLOW_RANGES} value={form.breslow} onChange={v => u("breslow", v)} /></Field>
          <Field label="Ulceration"><PillSelect options={ULCERATION_OPTIONS} value={form.ulceration} onChange={v => u("ulceration", v)} /></Field>
          <Field label="Sentinel Lymph Node"><PillSelect options={SLN_OPTIONS} value={form.slnStatus} onChange={v => u("slnStatus", v)} /></Field>
          <div style={{ borderTop: `1px solid ${C.border}`, margin: "14px 0", paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, marginBottom: 10 }}>MOLECULAR PROFILE</div>
          </div>
          <Field label="BRAF"><PillSelect options={BRAF_OPTIONS} value={form.braf} onChange={v => u("braf", v)} /></Field>
          <Field label="NRAS"><PillSelect options={NRAS_OPTIONS} value={form.nras} onChange={v => u("nras", v)} /></Field>
          <Field label="c-KIT"><PillSelect options={CKIT_OPTIONS} value={form.ckit} onChange={v => u("ckit", v)} /></Field>
          <Field label="LDH"><PillSelect options={LDH_OPTIONS} value={form.ldh} onChange={v => u("ldh", v)} /></Field>
          <Field label="PD-L1"><PillSelect options={PD_L1_OPTIONS} value={form.pdl1} onChange={v => u("pdl1", v)} /></Field>
          <button style={{ ...S.btn("primary"), width: "100%", marginTop: 8 }} onClick={save}>Save Patient</button>
        </div>
      )}
      {patients.length === 0 && !adding && (
        <div style={{ ...S.card, textAlign: "center", padding: 36 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>No patients yet</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Add a patient profile to begin clinical analysis</div>
        </div>
      )}
      {patients.map(p => (
        <div key={p.id} style={{ ...S.card, cursor: "pointer" }} onClick={() => onSelect(p)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 7 }}>
                {p.age}y {p.sex} · ECOG {p.ecog} · {p.melanomaType} · Stage {p.stage}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <span style={S.badge(p.braf?.startsWith("V600") ? C.actionable : C.textMuted, p.braf?.startsWith("V600") ? C.actionableLight : undefined)}>BRAF {p.braf?.startsWith("V600") ? p.braf : "WT"}</span>
                {p.nras === "Mutant" && <span style={S.badge(C.unfavorable, C.unfavorableLight)}>NRAS Mut</span>}
                {p.ldh === "Elevated" && <span style={S.badge(C.unfavorable, C.unfavorableLight)}>LDH ↑</span>}
                {p.pdl1?.startsWith("Positive") && <span style={S.badge(C.favorable, C.favorableLight)}>PD-L1+</span>}
              </div>
            </div>
            <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 11 }} onClick={e => { e.stopPropagation(); setPatients(prev => prev.filter(x => x.id !== p.id)); }}>Remove</button>
          </div>
        </div>
      ))}
      <Disclaimer />
    </div>
  );
}

// ─── Classifier Screen ───────────────────────────────────────────────────────

function ClassifierScreen({ selectedPatient }) {
  const [breslow, setBreslow] = useState(selectedPatient?.breslow || "1.01–2.0 mm");
  const [ulceration, setUlceration] = useState(selectedPatient?.ulceration || "Absent");
  const [slnStatus, setSlnStatus] = useState(selectedPatient?.slnStatus || "Not performed");
  const [stage, setStage] = useState(selectedPatient?.stage || "IIA");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (selectedPatient) {
      setBreslow(selectedPatient.breslow); setUlceration(selectedPatient.ulceration);
      setSlnStatus(selectedPatient.slnStatus); setStage(selectedPatient.stage);
    }
  }, [selectedPatient]);

  const run = () => setResult(classifyRecurrenceRisk(breslow, ulceration, slnStatus, stage));

  const riskColor = (cat) => cat === "Low" ? C.favorable : cat === "Intermediate" ? C.neutral : cat === "High" ? "#ea580c" : C.unfavorable;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>Recurrence Risk</h2>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>Composite risk stratification based on pathological features</div>
      {selectedPatient && (
        <div style={{ ...S.card, padding: 10, background: C.accentLight, borderColor: C.accent + "44" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>{selectedPatient.name} — auto-populated</span>
        </div>
      )}
      <div style={S.card}>
        <div style={S.cardTitle}>Pathological Features</div>
        <Field label="Breslow Depth"><PillSelect options={BRESLOW_RANGES} value={breslow} onChange={setBreslow} /></Field>
        <Field label="Ulceration"><PillSelect options={ULCERATION_OPTIONS.slice(0, 2)} value={ulceration} onChange={setUlceration} /></Field>
        <Field label="Sentinel Lymph Node"><PillSelect options={SLN_OPTIONS} value={slnStatus} onChange={setSlnStatus} /></Field>
        <Field label="AJCC Stage">
          <select style={S.select} value={stage} onChange={e => setStage(e.target.value)}>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <button style={{ ...S.btn("primary"), width: "100%", marginTop: 4 }} onClick={run}>Calculate Risk</button>
      </div>
      {result && (
        <>
          <div style={S.card}>
            <div style={S.cardTitle}>Risk Assessment</div>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <svg viewBox="0 0 200 120" style={{ width: "100%", maxWidth: 260 }}>
                <defs>
                  <linearGradient id="rg" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={C.favorable} />
                    <stop offset="40%" stopColor={C.neutral} />
                    <stop offset="70%" stopColor="#ea580c" />
                    <stop offset="100%" stopColor={C.unfavorable} />
                  </linearGradient>
                </defs>
                <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#eef0f4" strokeWidth="14" strokeLinecap="round" />
                <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#rg)" strokeWidth="14" strokeLinecap="round" opacity="0.5" />
                {(() => {
                  const angle = (result.riskPct / 100) * 180 - 90;
                  const nx = 100 + 58 * Math.cos((angle * Math.PI) / 180);
                  const ny = 100 - 58 * Math.sin((angle * Math.PI) / 180);
                  return <>
                    <line x1="100" y1="100" x2={nx} y2={ny} stroke={C.text} strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="100" cy="100" r="4" fill={riskColor(result.category)} />
                  </>;
                })()}
                <text x="100" y="78" textAnchor="middle" fill={C.text} fontSize="22" fontWeight="800" fontFamily="'IBM Plex Mono', monospace">{result.riskPct}%</text>
                <text x="24" y="115" fill={C.favorable} fontSize="8" fontWeight="700">LOW</text>
                <text x="176" y="115" textAnchor="end" fill={C.unfavorable} fontSize="8" fontWeight="700">HIGH</text>
              </svg>
              <div style={{ marginTop: 6 }}><span style={S.badge(riskColor(result.category))}>{result.category} Risk</span></div>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Feature Contributions</div>
            {result.features.map((f, i) => {
              const maxC = Math.max(...result.features.map(x => x.contribution), 1);
              const w = (f.contribution / maxC) * 100;
              return (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700 }}>{f.name} <span style={{ color: C.textMuted, fontWeight: 400 }}>({f.value})</span></span>
                    <span style={{ ...S.mono, color: f.contribution > 0 ? C.unfavorable : C.favorable }}>+{f.contribution}</span>
                  </div>
                  <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: f.contribution > 2 ? C.unfavorable : f.contribution > 0 ? C.neutral : C.favorable, borderRadius: 3, transition: "width 0.4s" }} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, ...S.mono }}>
              Composite score: {result.score} / {result.maxScore}
            </div>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

// ─── Treatment Screen ────────────────────────────────────────────────────────

function TreatmentScreen({ selectedPatient }) {
  if (!selectedPatient) return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px" }}>Treatment</h2>
      <div style={{ ...S.card, textAlign: "center", padding: 36 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>💊</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>No patient selected</div>
        <div style={{ fontSize: 13, color: C.textMuted }}>Select a patient from the Patients tab</div>
      </div>
      <Disclaimer />
    </div>
  );

  const recs = generateTreatmentPlan(selectedPatient);
  const evColor = (e) => e.includes("1A") ? C.favorable : e.includes("1B") ? C.accent : e.includes("2A") ? C.neutral : C.textMuted;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>Treatment</h2>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>Evidence-based recommendations for {selectedPatient.name}</div>
      <div style={{ ...S.card, padding: 12, background: C.surface }}>
        <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.8 }}>
          {selectedPatient.age}y {selectedPatient.sex} · ECOG {selectedPatient.ecog} · {selectedPatient.melanomaType} · Stage {selectedPatient.stage}<br />
          BRAF {selectedPatient.braf} · NRAS {selectedPatient.nras} · LDH {selectedPatient.ldh} · PD-L1 {selectedPatient.pdl1}
        </div>
      </div>
      {recs.map((r, i) => (
        <div key={i} style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{r.category}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{r.title}</div>
            </div>
            <span style={S.badge(evColor(r.evidence))}>{r.evidence}</span>
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.7, marginBottom: 8 }}>{r.detail}</div>
          <div style={{ fontSize: 11, color: C.accent, fontWeight: 600 }}>{r.trial}</div>
        </div>
      ))}
      <Disclaimer />
    </div>
  );
}

// ─── Survival Screen ─────────────────────────────────────────────────────────

function SurvivalScreen({ selectedPatient }) {
  const [custom, setCustom] = useState(!selectedPatient);
  const [cStage, setCStage] = useState("IIA");
  const [cBraf, setCBraf] = useState("Wild-Type");
  const [cLdh, setCLdh] = useState("Normal");
  const [cEcog, setCEcog] = useState("0");
  const [cAge, setCAge] = useState("55");

  const params = useMemo(() => {
    if (!custom && selectedPatient) return { stage: selectedPatient.stage, braf: selectedPatient.braf, ldh: selectedPatient.ldh, ecog: selectedPatient.ecog, age: selectedPatient.age };
    return { stage: cStage, braf: cBraf, ldh: cLdh, ecog: cEcog, age: cAge };
  }, [custom, selectedPatient, cStage, cBraf, cLdh, cEcog, cAge]);

  const result = useMemo(() => estimateSurvival(params.stage, params.braf, params.ldh, params.ecog, params.age), [params]);

  const chartW = 320, chartH = 170, pad = { t: 10, r: 16, b: 28, l: 40 };
  const plotW = chartW - pad.l - pad.r, plotH = chartH - pad.t - pad.b;
  const toPath = (pts, maxMonth = 120) => pts.filter(p => p.month <= maxMonth).map((p, i) =>
    `${i === 0 ? "M" : "L"}${pad.l + (p.month / maxMonth) * plotW} ${pad.t + (1 - p.survival / 100) * plotH}`
  ).join(" ");

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>Survival</h2>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>Literature-based survival estimation</div>
      {selectedPatient && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button style={S.pill(!custom)} onClick={() => setCustom(false)}>{selectedPatient.name}</button>
          <button style={S.pill(custom)} onClick={() => setCustom(true)}>Custom</button>
        </div>
      )}
      {custom && (
        <div style={S.card}>
          <div style={S.grid2}>
            <Field label="Age"><input style={S.input} type="number" value={cAge} onChange={e => setCAge(e.target.value)} /></Field>
            <Field label="ECOG"><PillSelect options={ECOG_OPTIONS.slice(0, 4)} value={cEcog} onChange={setCEcog} /></Field>
          </div>
          <Field label="Stage"><select style={S.select} value={cStage} onChange={e => setCStage(e.target.value)}>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="BRAF"><PillSelect options={["V600E", "V600K", "Wild-Type"]} value={cBraf} onChange={setCBraf} /></Field>
          <Field label="LDH"><PillSelect options={["Normal", "Elevated"]} value={cLdh} onChange={setCLdh} /></Field>
        </div>
      )}
      <div style={S.card}>
        <div style={S.cardTitle}>Estimated Outcomes</div>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 36, fontWeight: 800, ...S.mono, color: C.accent }}>{result.medianOS}</div>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Median OS (months)</div>
        </div>
        <div style={S.grid3}>
          {[
            { l: "1-year", v: result.s12 },
            { l: "2-year", v: result.s24 },
            { l: "5-year", v: result.s60 },
          ].map(s => (
            <div key={s.l} style={{ textAlign: "center", padding: 10, background: "#fff", borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ ...S.mono, fontSize: 20, fontWeight: 800, color: s.v > 50 ? C.favorable : s.v > 25 ? C.neutral : C.unfavorable }}>{s.v}%</div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginTop: 3 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={S.card}>
        <div style={S.cardTitle}>Survival Curve</div>
        <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: "100%" }}>
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={pad.l} y1={pad.t + (1 - v / 100) * plotH} x2={chartW - pad.r} y2={pad.t + (1 - v / 100) * plotH} stroke={C.border} strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={pad.l - 5} y={pad.t + (1 - v / 100) * plotH + 3} textAnchor="end" fill={C.textMuted} fontSize="8" fontFamily="'IBM Plex Mono', monospace">{v}%</text>
            </g>
          ))}
          {[0, 24, 48, 72, 96, 120].map(m => (
            <g key={m}>
              <line x1={pad.l + (m / 120) * plotW} y1={pad.t} x2={pad.l + (m / 120) * plotW} y2={chartH - pad.b} stroke={C.border} strokeWidth="0.5" strokeDasharray="3,3" />
              <text x={pad.l + (m / 120) * plotW} y={chartH - pad.b + 12} textAnchor="middle" fill={C.textMuted} fontSize="7" fontFamily="'IBM Plex Mono', monospace">{m}mo</text>
            </g>
          ))}
          <path d={toPath(result.curve)} fill="none" stroke={C.accent} strokeWidth="2.5" />
          <line x1={pad.l + (result.medianOS / 120) * plotW} y1={pad.t} x2={pad.l + (result.medianOS / 120) * plotW} y2={chartH - pad.b} stroke={C.accent} strokeWidth="1" strokeDasharray="4,2" opacity="0.5" />
        </svg>
      </div>
      <Disclaimer />
    </div>
  );
}

// ─── Molecular Screen ────────────────────────────────────────────────────────

function MolecularScreen({ selectedPatient }) {
  const [active, setActive] = useState("BRAF");
  const m = MOLECULAR_MARKERS[active];

  const getStatus = () => {
    if (!selectedPatient) return null;
    if (active === "BRAF") return selectedPatient.braf !== "Unknown" ? selectedPatient.braf : null;
    if (active === "NRAS") return selectedPatient.nras !== "Unknown" ? selectedPatient.nras : null;
    if (active === "CKIT") return selectedPatient.ckit !== "Unknown" ? selectedPatient.ckit : null;
    if (active === "PDL1") return selectedPatient.pdl1 !== "Unknown" ? selectedPatient.pdl1 : null;
    return null;
  };
  const status = getStatus();
  const measured = status !== null;

  const getInfo = () => {
    if (!m) return null;
    if (active === "BRAF") return status?.startsWith("V600") ? m.mutant : status === "Wild-Type" ? m.wildType : null;
    if (active === "NRAS") return status === "Mutant" ? m.mutant : status === "Wild-Type" ? m.wildType : null;
    if (active === "CKIT") return status === "Mutant" ? m.mutant : status === "Wild-Type" ? m.wildType : null;
    if (active === "CDKN2A") return m.lost;
    if (active === "TERT") return m.mutant;
    if (active === "PTEN") return m.lost;
    if (active === "PDL1") return status?.startsWith("Positive") ? m.positive : status?.startsWith("Negative") ? m.negative : null;
    return null;
  };
  const info = getInfo();

  const fColor = (f) => f === "favorable" ? C.favorable : f === "unfavorable" ? C.unfavorable : f === "actionable" ? C.actionable : C.neutral;
  const fBg = (f) => f === "favorable" ? C.favorableLight : f === "unfavorable" ? C.unfavorableLight : f === "actionable" ? C.actionableLight : C.neutralLight;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>Molecular Profile</h2>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>Gene-level explainer</div>
      <TabBar tabs={Object.keys(MOLECULAR_MARKERS)} active={active} onChange={setActive} />
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, ...S.mono }}>{m.gene}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{m.fullName}</div>
          </div>
          {measured ? <span style={S.badge(C.accent, C.accentLight)}>Measured</span> : <span style={S.badge(C.textMuted)}>Reference</span>}
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...S.label, marginBottom: 6 }}>What does this gene do?</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>{m.description}</div>
        </div>
        {info && (
          <div style={{ padding: 12, background: fBg(info.favorability), borderRadius: 10, border: `1px solid ${fColor(info.favorability)}22`, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={S.badge(fColor(info.favorability), fBg(info.favorability))}>{info.favorability.charAt(0).toUpperCase() + info.favorability.slice(1)}</span>
              {measured && <span style={{ fontSize: 12, fontWeight: 600 }}>Status: {status}</span>}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>{info.prognosis}</div>
          </div>
        )}
        {!info && (
          <div style={{ padding: 12, background: C.surfaceAlt, borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: C.textMuted }}>{selectedPatient ? "Marker status not available in patient profile." : "Select a patient for personalized interpretation."}</div>
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...S.label, marginBottom: 6 }}>Therapies</div>
          {m.therapies.map((t, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.7, padding: "5px 0", borderBottom: i < m.therapies.length - 1 ? `1px solid ${C.border}` : "none" }}>{t}</div>
          ))}
        </div>
        <div style={{ padding: 10, background: "#fff", borderRadius: 8, border: `1px solid ${C.border}` }}>
          <div style={{ ...S.label, marginBottom: 3 }}>Melanoma Frequency</div>
          <div style={{ fontSize: 12, ...S.mono, color: C.accent }}>{m.frequency}</div>
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}

// ─── Splash ──────────────────────────────────────────────────────────────────

function Splash({ onDismiss }) {
  const [vis, setVis] = useState(true);
  useEffect(() => { const t = setTimeout(() => { setVis(false); setTimeout(onDismiss, 300); }, 2500); return () => clearTimeout(t); }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: vis ? 1 : 0, transition: "opacity 0.3s" }}>
      <div style={{ width: 64, height: 64, background: `linear-gradient(135deg, ${C.accent}, #7c3aed)`, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, marginBottom: 18, color: "#fff", fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace" }}>M</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: C.text, marginBottom: 4 }}>MelaCDS</div>
      <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500, marginBottom: 28 }}>Melanoma Clinical Decision Support</div>
      <div style={{ width: 32, height: 3, background: C.accent, borderRadius: 2, opacity: 0.4, marginBottom: 32 }} />
      <div style={{ maxWidth: 300, textAlign: "center", fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
        For educational and research purposes only.<br />Not intended for clinical decision-making.
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

const NAV = [
  { key: "patients", icon: "patients", label: "Patients" },
  { key: "classifier", icon: "classifier", label: "Risk" },
  { key: "treatment", icon: "treatment", label: "Treatment" },
  { key: "survival", icon: "survival", label: "Survival" },
  { key: "molecular", icon: "molecular", label: "Molecular" },
];

export default function App() {
  const [splash, setSplash] = useState(true);
  const [tab, setTab] = useState("patients");
  const [patients, setPatients] = useState([
    { id: 1, name: "Demo Patient", age: 62, sex: "Male", ecog: "1", melanomaType: "Cutaneous", stage: "IIIB", breslow: "2.01–4.0 mm", ulceration: "Present", slnStatus: "Positive", braf: "V600E", nras: "Wild-Type", ckit: "Wild-Type", ldh: "Normal", pdl1: "Positive (≥1%)" }
  ]);
  const [selected, setSelected] = useState(null);

  const selectAndGo = (p) => { setSelected(p); setTab("treatment"); };

  if (splash) return <Splash onDismiss={() => setSplash(false)} />;

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; background: #fff; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      `}</style>
      <header style={S.header}>
        <div style={{ width: 32, height: 32, background: `linear-gradient(135deg, ${C.accent}, #7c3aed)`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace" }}>M</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" }}>MelaCDS</div>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Melanoma Decision Support</div>
        </div>
        {selected && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={S.badge(C.accent, C.accentLight)}>{selected.name}</span>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
        )}
      </header>
      <main style={S.main}>
        {tab === "patients" && <PatientScreen patients={patients} setPatients={setPatients} onSelect={selectAndGo} />}
        {tab === "classifier" && <ClassifierScreen selectedPatient={selected} />}
        {tab === "treatment" && <TreatmentScreen selectedPatient={selected} />}
        {tab === "survival" && <SurvivalScreen selectedPatient={selected} />}
        {tab === "molecular" && <MolecularScreen selectedPatient={selected} />}
      </main>
      <nav style={S.nav}>
        {NAV.map(n => (
          <button key={n.key} style={S.navBtn(tab === n.key)} onClick={() => setTab(n.key)}>
            <NavIcon name={n.icon} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
