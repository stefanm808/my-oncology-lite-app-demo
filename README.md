# MelaCDS — Melanoma Clinical Decision Support

A standalone, open-source clinical decision support application for melanoma. Built as a React web app with full clinical logic, molecular profiling, and evidence-based treatment recommendations.

> **For educational and research purposes only. Not intended for clinical decision-making. Always consult a qualified healthcare provider.**

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![Status](https://img.shields.io/badge/Status-Active-green)

---

## Features

### 1. Patient Profile Management
- Age, sex, ECOG performance status
- Melanoma subtype (cutaneous, acral, mucosal, uveal, desmoplastic)
- AJCC staging (0 through IV M1a-M1d)
- Pathological features: Breslow depth, ulceration, sentinel lymph node status
- Molecular markers: BRAF (V600E/K/other), NRAS, c-KIT, LDH, PD-L1

### 2. Recurrence Risk Classifier
- Composite risk score from Breslow depth, ulceration, SLN status, and stage
- Visual probability gauge with risk categories
- Feature contribution waterfall chart

### 3. Treatment Recommendation Engine
Evidence-based pathways branching on molecular profile and stage:
- **Stage III adjuvant**: dabrafenib + trametinib, nivolumab, pembrolizumab
- **Stage IV first-line**: nivolumab + ipilimumab, nivolumab + relatlimab
- **BRAF V600+**: encorafenib + binimetinib, dabrafenib + trametinib
- **NRAS mutant**: binimetinib
- **c-KIT mutant**: imatinib
- **Brain metastases**: SRS ± immunotherapy
- **Emerging**: lifileucel TIL therapy

### 4. Survival Estimation
- Stage-calibrated survival with BRAF/LDH/ECOG/age modifiers
- Interactive SVG survival curve (120-month horizon)
- 1-year, 2-year, and 5-year survival probabilities

### 5. Molecular Profile Explainer
Seven markers (BRAF, NRAS, c-KIT, CDKN2A, TERT, PTEN, PD-L1) with plain-language explanations, therapies, and population frequencies.

## Getting Started

```bash
git clone https://github.com/stefanm808/my-oncology-lite-app-demo.git
cd my-oncology-lite-app-demo
npm install
npm run dev
```

Open http://localhost:5173

### Build

```bash
npm run build
```

## Clinical References

| Reference | Topic |
|---|---|
| COMBI-AD — Long et al., NEJM 2017 | Adjuvant dabrafenib + trametinib |
| CheckMate 238 — Weber et al., NEJM 2017 | Adjuvant nivolumab |
| KEYNOTE-054 — Eggermont et al., NEJM 2018 | Adjuvant pembrolizumab |
| CheckMate 067 — Larkin et al., NEJM 2015 | Nivo + ipi first-line |
| RELATIVITY-047 — Tawbi et al., NEJM 2022 | Nivo + relatlimab |
| COLUMBUS — Dummer et al., Lancet Oncol 2018 | Encorafenib + binimetinib |
| COMBI-v — Robert et al., NEJM 2015 | Dabrafenib + trametinib |
| NEMO — Dummer et al., Lancet Oncol 2017 | Binimetinib for NRAS |
| C-144-01 — Chesney et al., JCO 2022 | Lifileucel TIL therapy |
| CheckMate 204 — Tawbi et al., NEJM 2018 | Brain metastases |
| NCCN Guidelines Melanoma v4.2024 | Standard of care |

## License

MIT — see [LICENSE](LICENSE)
