# AISI S100-16 AI-Assisted Design Calculator — Implementation Document

## 1. System Vision

사용자가 냉간성형강 단면 정보와 하중 조건을 입력하면, AI가 AISI S100-16 기준에 따라:
1. **누락 입력을 감지**하고 적절한 기본값 제안 또는 사용자에게 질문
2. **DSM/EWM 강도 계산**을 자동 수행
3. **체크 대시보드**로 각 단계별 통과/오류/주의 상태를 시각적으로 표시

초보자도 AISI 예제 수준의 설계 검증을 수행할 수 있는 시스템.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface (WebView)               │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Input     │  │ AI Assistant │  │ Check Dashboard   │  │
│  │ Wizard    │  │ Chat Panel   │  │ (Pass/Warn/Fail)  │  │
│  └────┬─────┘  └──────┬───────┘  └─────────┬─────────┘  │
│       │               │                    │             │
│       └───────────────┼────────────────────┘             │
│                       │ postMessage                      │
├───────────────────────┼──────────────────────────────────┤
│  Extension Host       │                                  │
│  ┌────────────────────┴─────────────────────┐            │
│  │         Design Engine Controller          │            │
│  │  ┌─────────────┐  ┌──────────────────┐   │            │
│  │  │ Input       │  │ Calculation      │   │            │
│  │  │ Validator   │  │ Pipeline         │   │            │
│  │  └─────────────┘  └──────────────────┘   │            │
│  │  ┌─────────────┐  ┌──────────────────┐   │            │
│  │  │ Check       │  │ AISI Rule        │   │            │
│  │  │ Engine      │  │ Database         │   │            │
│  │  └─────────────┘  └──────────────────┘   │            │
│  └──────────────────────────────────────────┘            │
│       │ JSON-RPC                                         │
├───────┼──────────────────────────────────────────────────┤
│  Python Engine                                           │
│  ┌─────────────┐  ┌───────────────┐  ┌────────────────┐ │
│  │ FSM Solver  │  │ Section Props │  │ DSM Calculator │ │
│  │ (existing)  │  │ Calculator    │  │ (NEW)          │ │
│  └─────────────┘  └───────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 2.1 New Modules (to be created)

| Module | Location | Purpose |
|--------|----------|---------|
| **DSM Calculator** | `python/design/dsm.py` | DSM strength calculation (E2-E4, F2-F4, G2) |
| **EWM Calculator** | `python/design/ewm.py` | Effective Width Method (Appendix 1) |
| **Section Properties** | `python/design/section_props.py` | Gross/effective/net properties |
| **Material DB** | `python/design/materials.py` | ASTM steel grade database |
| **Check Engine** | `python/design/checks.py` | Validation rules + dashboard data |
| **Input Validator** | `python/design/validator.py` | Input completeness + range checks |
| **AI Assistant Logic** | `python/design/assistant.py` | Smart defaults, suggestions, questions |
| **Design Controller** | `src/services/DesignController.ts` | Orchestrate calculation pipeline |
| **Dashboard Panel** | `webview/js/panels/dashboard.js` | Check dashboard UI |
| **Input Wizard** | `webview/js/panels/inputWizard.js` | Step-by-step guided input |

---

## 3. Design Calculation Pipeline

### 3.1 Overall Flow

```
[1. Input Collection]
      │
      ▼
[2. Input Validation & AI Completion]
      │
      ▼
[3. Section Property Calculation]
      │  ├── Gross properties (Ag, Ix, Iy, Sx, Sy, J, Cw, xo, ro)
      │  └── Net properties (if holes: Anet, Ix,net, etc.)
      │
      ▼
[4. Elastic Buckling Analysis (FSM)]
      │  ├── Compression: Pcrl, Pcrd, Pcre (+ half-wavelengths)
      │  └── Bending: Mcrl, Mcrd, Mcre (+ half-wavelengths)
      │
      ▼
[5. Member Strength Calculation]
      │  ├── Compression: Pne (E2), Pnl (E3), Pnd (E4)
      │  ├── Flexure: Mne (F2), Mnl (F3), Mnd (F4)
      │  ├── Shear: Vn (G2)
      │  └── Combined: H1 interaction check
      │
      ▼
[6. Design Strength (ASD or LRFD)]
      │  ├── ASD: Rn / Omega >= Ra
      │  └── LRFD: phi * Rn >= Ru
      │
      ▼
[7. Check Dashboard Generation]
      │  ├── Geometric limit checks (Table B4.1-1)
      │  ├── Material limit checks
      │  ├── Strength adequacy checks
      │  └── Special condition warnings
      │
      ▼
[8. Report Output]
```

### 3.2 Step 1: Input Collection

사용자가 제공해야 하는 입력을 3단계 우선순위로 분류:

#### Tier 1: 필수 (Must provide)

| Category | Parameters | Description |
|----------|-----------|-------------|
| Section | section_type, dimensions (D, B, t, d, R) | 단면 형상 정의 |
| Material | Fy | 항복강도 (최소) |
| Member | member_type ('beam' or 'column') | 부재 유형 |

#### Tier 2: 중요 (AI suggests default if missing)

| Parameter | Default Logic | AI Message |
|-----------|--------------|------------|
| Fu | Infer from Fy per ASTM grade table | "항복강도 50 ksi 기준으로 인장강도 Fu = 65 ksi를 사용합니다 (ASTM A653 Grade 50)" |
| E | 29500 ksi | "탄성계수 E = 29,500 ksi (냉간성형강 표준값)" |
| G | 11300 ksi | "전단탄성계수 G = 11,300 ksi (표준값)" |
| mu | 0.3 | "포아송비 mu = 0.3 (표준값)" |
| design_method | 'LRFD' | "설계법을 LRFD로 설정합니다. ASD를 원하시면 변경하세요" |
| analysis_method | 'DSM' | "해석법을 DSM으로 설정합니다. EWM도 선택 가능합니다" |

#### Tier 3: 조건부 (Only needed for certain checks)

| Parameter | When Needed | AI Behavior |
|-----------|------------|-------------|
| Lb (unbraced length) | Column or unbraced beam | "비지지 길이가 필요합니다. 부재 길이를 입력해 주세요" |
| Kx, Ky, Kt | Column buckling | Default 1.0, warn user |
| k_phi (sheathing) | Distortional w/ restraint | "외장재 구속이 있으면 k_phi를 입력하세요. 없으면 0으로 계산합니다" |
| Cb (moment gradient) | Unbraced beam | Auto-calculate from moment diagram or default 1.0 |
| holes (dh, Lh, S) | Perforated section | "관통홀이 있으면 홀 치수를 입력하세요" |
| Required strength | Adequacy check | "요구강도(Mu 또는 Pu)를 입력하면 적정성 검토를 수행합니다" |

### 3.3 Step 2: Input Validation & AI Completion

```python
class InputValidator:
    def validate(self, input_data: dict) -> ValidationResult:
        """
        Returns:
            ValidationResult with:
            - is_complete: bool
            - missing_required: list[str]  # Must ask user
            - auto_filled: dict            # AI-filled with defaults
            - warnings: list[str]          # Unusual values
            - questions: list[Question]    # Ask user for decisions
        """
```

#### AI Decision Logic

```
IF section_type given AND dimensions given:
    → Proceed (core input satisfied)
ELIF section_designation given (e.g., "9CS2.5x059"):
    → Look up in AISI Table I-1/I-2 and auto-fill all dimensions
ELIF only partial dimensions:
    → AI asks: "웹 높이(D)가 누락되었습니다. 입력해 주세요"

IF Fy given BUT Fu missing:
    → Infer Fu from Fy using ASTM grade table
    → Message: "Fy=50 ksi → ASTM A653 Grade 50 추정, Fu=65 ksi 적용"

IF member_type == 'beam' AND Lb not given:
    → Ask: "비지지 길이를 입력해 주세요. 완전 횡지지인 경우 'braced'를 입력하세요"

IF member_type == 'column' AND KL not given:
    → Ask: "유효좌굴길이(KL)를 입력해 주세요. K=1.0, L=부재길이 기본 적용합니다"
```

### 3.4 Step 4: Elastic Buckling Analysis

기존 Python FSM 엔진(`python/engine/fsm_solver.py`)을 활용:

```python
class BucklingAnalyzer:
    def analyze(self, section, material, load_type) -> BucklingResult:
        """
        1. Generate section nodes/elements from template
        2. Apply reference stress (Fy for compression, linear for bending)
        3. Run FSM solver over range of half-wavelengths
        4. Extract minima: Pcrl/Mcrl (local), Pcrd/Mcrd (distortional)
        5. Extract global buckling at specified unbraced length
        """
        # Uses existing: fsm_solver.stripmain()
        # Uses existing: template.generate_section()
        # New: auto_extract_minima() for mode identification
```

### 3.5 Step 5: Member Strength Calculation

#### DSM Compression (Chapter E)

```python
def dsm_compression(Py, Pcrl, Pcrd, Pcre) -> CompressionResult:
    # E2: Yielding and Global Buckling
    Fcre = Pcre / Ag
    lambda_c = sqrt(Fy / Fcre)
    if lambda_c <= 1.5:
        Fn = (0.658 ** lambda_c**2) * Fy
    else:
        Fn = (0.877 / lambda_c**2) * Fy
    Pne = Ag * Fn

    # E3: Local Buckling interacting with Yielding and Global
    lambda_l = sqrt(Pne / Pcrl)
    if lambda_l <= 0.776:
        Pnl = Pne
    else:
        Pnl = (1 - 0.15*(Pcrl/Pne)**0.4) * (Pcrl/Pne)**0.4 * Pne

    # E4: Distortional Buckling
    lambda_d = sqrt(Py / Pcrd)
    if lambda_d <= 0.561:
        Pnd = Py
    else:
        Pnd = (1 - 0.25*(Pcrd/Py)**0.6) * (Pcrd/Py)**0.6 * Py

    Pn = min(Pnl, Pnd)
    return CompressionResult(Pne, Pnl, Pnd, Pn, controlling_mode)
```

#### DSM Flexure (Chapter F)

```python
def dsm_flexure(My, Mcrl, Mcrd, Mcre) -> FlexureResult:
    # F2: Yielding and Global (Lateral-Torsional) Buckling
    Fcre = Mcre / Sf
    if Fcre >= 2.78*Fy:
        Fn = Fy
    elif Fcre > 0.56*Fy:
        Fn = (10/9)*Fy*(1 - 10*Fy/(36*Fcre))
    else:
        Fn = Fcre
    Mne = Sf * Fn  # <= My

    # F3: Local Buckling
    lambda_l = sqrt(Mne / Mcrl)
    if lambda_l <= 0.776:
        Mnl = Mne
    else:
        Mnl = (1 - 0.15*(Mcrl/Mne)**0.4) * (Mcrl/Mne)**0.4 * Mne

    # F4: Distortional Buckling
    lambda_d = sqrt(My / Mcrd)
    if lambda_d <= 0.673:
        Mnd = My
    else:
        Mnd = (1 - 0.22*(Mcrd/My)**0.5) * (Mcrd/My)**0.5 * My

    Mn = min(Mnl, Mnd)
    return FlexureResult(Mne, Mnl, Mnd, Mn, controlling_mode)
```

#### DSM Shear (Chapter G)

```python
def dsm_shear(Vy, Vcr) -> ShearResult:
    # G2.1
    lambda_v = sqrt(Vy / Vcr)
    if lambda_v <= 0.815:
        Vn = Vy
    elif lambda_v <= 1.227:
        Vn = 0.815 * sqrt(Vcr * Vy)
    else:
        Vn = Vcr
    return ShearResult(Vn, lambda_v)
```

#### Combined Forces (Chapter H)

```python
def check_interaction_H1(Pu, Mu, Pn, Mn, phi_c, phi_b) -> InteractionResult:
    # H1.1: Combined axial and bending
    ratio_P = Pu / (phi_c * Pn)
    ratio_M = Mu / (phi_b * Mn)

    if ratio_P / phi_c >= 0.15:
        # H1-1: linear interaction
        check = ratio_P + ratio_M
    else:
        # H1-2: simplified
        check = ratio_P / 2 + ratio_M

    return InteractionResult(check, passed=(check <= 1.0))
```

---

## 4. AI Assistant Module

### 4.1 Smart Default Engine

```python
# Material inference table
STEEL_GRADES = {
    # (Fy, Fu, typical_ASTM)
    33: (33, 45, "ASTM A653 Grade 33 / A1003 SS-33"),
    37: (37, 52, "ASTM A653 Grade 37"),
    40: (40, 55, "ASTM A653 Grade 40"),
    50: (50, 65, "ASTM A653 Grade 50 / A1003 SS-50"),
    55: (55, 70, "ASTM A653 Grade 55"),
    80: (80, 82, "ASTM A1003 SS-80"),
}

SECTION_DEFAULTS = {
    'E': 29500,   # ksi
    'G': 11300,   # ksi
    'mu': 0.3,
    'design_method': 'LRFD',
    'analysis_method': 'DSM',
    'K': 1.0,
    'Cb': 1.0,
}
```

### 4.2 Section Designation Lookup

AISI Design Manual Tables I-1 through I-8에서 표준 단면 지정을 자동 조회:

```python
# 예: "9CS2.5x059" → C-section, D=9.0, B=2.5, t=0.059
SECTION_CATALOG = {
    '9CS2.5x059': {'type': 'lippedc', 'D': 9.0, 'B': 2.5, 't': 0.059,
                    'd': 0.773, 'R': 0.1875, 'Ag': 0.881, 'Ix': 10.3},
    '9CS2.5x070': {'type': 'lippedc', 'D': 9.0, 'B': 2.5, 't': 0.070,
                    'd': 0.773, 'R': 0.1875, 'Ag': 1.05, 'Ix': 12.2},
    '8ZS2.25x059': {'type': 'lippedz', 'D': 8.0, 'B': 2.25, 't': 0.059,
                     'd': 0.910, 'R': 0.1875},
    '800S200-54': {'type': 'lippedc', 'D': 8.0, 'B': 2.0, 't': 0.0566,
                    'd': 0.625, 'R': 0.0849},
    # ... more from AISI Tables
}
```

### 4.3 Conversational Flow

```
User: C형강 50ksi 보 설계하고 싶어

AI: C형강 보(beam) 설계를 시작합니다.

    ✅ 재료: Fy = 50 ksi (Fu = 65 ksi 자동 적용, ASTM A653 Grade 50)
    ✅ 설계법: LRFD (기본)
    ✅ 해석법: DSM (기본)

    ❓ 단면 치수를 알려주세요:
       - 표준 지정명 (예: 9CS2.5x059) 또는
       - 직접 입력: 웹 높이(D), 플랜지 폭(B), 두께(t), 립 길이(d), 코너 반경(R)

    ❓ 비지지 길이(Lb)는 얼마입니까?
       - 완전 횡지지인 경우 'braced' 입력

User: 9CS2.5x059, braced

AI: ✅ 단면: 9CS2.5x059 (D=9.0", B=2.5", t=0.059", d=0.773", R=0.1875")
    ✅ 비지지: 완전 횡지지 (LTB 해당 없음)

    🔄 FSM 좌굴 해석 실행 중...

    ✅ 좌굴 결과:
       Local:       Mcrl/My = 0.67 (half-wavelength = 10 in.)
       Distortional: Mcrd/My = 0.85 (half-wavelength = 30 in.)

    📊 DSM 강도 계산 결과:
    ┌─────────────────────┬──────────┬────────┐
    │ Limit State         │ Mn (k-in)│ Status │
    ├─────────────────────┼──────────┼────────┤
    │ Global (F2)         │ 126      │ ✅     │
    │ Local (F3)          │ 92.6     │ ⚠️ Gov │
    │ Distortional (F4)   │ 99.2     │ ✅     │
    ├─────────────────────┼──────────┼────────┤
    │ φMn (LRFD)          │ 83.3     │        │
    └─────────────────────┴──────────┴────────┘

    지배적 한계상태: 국부좌굴 (Local buckling)

    요구강도(Mu)를 입력하면 적정성 검토를 수행합니다.
```

---

## 5. Check Dashboard

### 5.1 Check Categories

```
Dashboard
├── 1. Geometric Limits (Table B4.1-1)
│   ├── CHK-G01: Stiffened element w/t ratio
│   ├── CHK-G02: Edge-stiffened element b/t ratio
│   ├── CHK-G03: Unstiffened element d/t ratio
│   ├── CHK-G04: Inside bend radius R/t ratio
│   ├── CHK-G05: Stiffener ds/bo ratio
│   ├── CHK-G06: Number of intermediate stiffeners
│   └── CHK-G07: Yield stress limit
│
├── 2. Material Checks
│   ├── CHK-M01: Fy within recognized range
│   ├── CHK-M02: Fu/Fy ratio >= 1.08 (ductility)
│   └── CHK-M03: Steel grade recognized
│
├── 3. Buckling Analysis Checks
│   ├── CHK-B01: Local buckling minimum found
│   ├── CHK-B02: Distortional buckling minimum found
│   ├── CHK-B03: Global buckling evaluated (if unbraced)
│   └── CHK-B04: Mode identification confidence
│
├── 4. Strength Checks
│   ├── CHK-S01: Compression adequacy (Pu <= φPn)
│   ├── CHK-S02: Flexure adequacy (Mu <= φMn)
│   ├── CHK-S03: Shear adequacy (Vu <= φVn)
│   ├── CHK-S04: Combined interaction (H1 <= 1.0)
│   └── CHK-S05: Web crippling (if applicable)
│
└── 5. Special Conditions
    ├── CHK-X01: Hole effects considered
    ├── CHK-X02: Sheathing restraint applied
    ├── CHK-X03: Moment gradient factor (Cb)
    └── CHK-X04: Through-fastened provisions (I6.2)
```

### 5.2 Check Status Definitions

| Status | Symbol | Meaning | Color |
|--------|--------|---------|-------|
| PASS | ✅ | Check satisfied, no issues | Green |
| WARNING | ⚠️ | Check passes but near limit or needs attention | Yellow |
| FAIL | ❌ | Check failed, design inadequate | Red |
| INFO | ℹ️ | Informational, no action needed | Blue |
| SKIP | ⏭️ | Not applicable for this configuration | Gray |

### 5.3 Check Data Model

```typescript
interface CheckItem {
    id: string;           // "CHK-G01"
    category: string;     // "geometric" | "material" | "buckling" | "strength" | "special"
    title: string;        // "Stiffened element w/t ratio"
    status: Status;       // "pass" | "warning" | "fail" | "info" | "skip"
    value: number | null; // Calculated value (e.g., 172)
    limit: number | null; // Code limit (e.g., 500)
    ratio: number | null; // value/limit (e.g., 0.344)
    spec_ref: string;     // "Table B4.1-1"
    message: string;      // "w/t = 172 < 500 OK"
    detail: string;       // Extended explanation
}

interface DashboardData {
    summary: {
        total: number;
        passed: number;
        warnings: number;
        failed: number;
        skipped: number;
    };
    checks: CheckItem[];
    controlling_mode: string;  // "Local buckling (F3)"
    design_ratio: number;      // Mu / (phi*Mn) or Pu / (phi*Pn)
}
```

---

## 6. AISI Example Mapping

각 AISI 예제가 시스템의 어떤 계산 경로를 검증하는지 매핑:

| Example | Pipeline Path | Key Checks |
|---------|--------------|------------|
| I-8B | Bending + Compression (fully braced) | CHK-B01, B02, S01, S02 |
| II-1B | Bending (3-mode curve, Cb adjustment) | CHK-B01, B02, B03, S02 |
| II-1C | Bending (spring restraints, cFSM) | CHK-B01, B02, X02, S02 |
| II-2B | Bending (Z-section, curve fitting) | CHK-B01, B02, B03, S02 |
| II-4B | Bending (unlipped, mode ambiguity) | CHK-B01, B04, S02 |
| II-5 | Bending (3-method Fcrd comparison) | CHK-B02, X02, S02 |
| II-6B | Bending (weak axis, no distortional) | CHK-B01, B03, S02 |
| II-7B | Bending (hat, very stocky) | CHK-B01, S02 |
| II-13 | Bending (sigma, DSM required) | CHK-B01, B02, S02 |
| II-14 | Bending (perforations, t=0) | CHK-B01, B02, X01, S02 |
| III-3 | Compression (Z, distortional focus) | CHK-B02, X02, S01 |
| III-5B | Compression (angle, torsional) | CHK-B01, B03, S01, S02 |
| III-7B | Compression (Z, through-fastened) | CHK-B01, X04, S01 |
| III-14 | Compression (sigma, 2 bracing cases) | CHK-B01, B02, B03, S01 |

---

## 7. Implementation Phases

### Phase A: Core DSM Engine (Priority 1)

1. `python/design/dsm.py` — DSM strength formulas (E2-E4, F2-F4, G2)
2. `python/design/materials.py` — Steel grade database
3. `python/design/section_props.py` — Gross property calculator
4. Unit tests against all 13 Example validation datasets

### Phase B: Input Validation & AI Assistant (Priority 2)

1. `python/design/validator.py` — Input completeness checker
2. `python/design/assistant.py` — Smart defaults, suggestion engine
3. Section designation catalog (AISI Tables I-1 ~ I-8)
4. Conversational flow state machine

### Phase C: Check Dashboard (Priority 3)

1. `python/design/checks.py` — All check rules (Table B4.1-1, etc.)
2. `webview/js/panels/dashboard.js` — Dashboard UI rendering
3. Check data model and status computation
4. Summary statistics and controlling mode identification

### Phase D: EWM + Combined Forces (Priority 4)

1. `python/design/ewm.py` — Effective Width Method (Appendix 1)
2. Combined forces interaction check (Chapter H)
3. Web crippling (Chapter G)
4. Sheathing/through-fastened provisions (Chapter I)

### Phase E: Advanced Features (Priority 5)

1. Net section for perforations (t=0 technique)
2. Moment gradient (Cb) auto-calculation
3. Global buckling curve fitting (two-point method)
4. Report generation (PDF/HTML)

---

## 8. Validation Test Matrix

13개 검증 예제를 통해 계산 엔진의 정확성을 검증하는 테스트 매트릭스.

### 8.1 Test Coverage by Calculation Path

| Test ID | Example | Section | Load | Method | Key Formula Path |
|---------|---------|---------|------|--------|-----------------|
| T01 | I-8B (bend) | C 9CS2.5x059 | Bending | DSM | F2→F3→F4 (fully braced) |
| T02 | I-8B (comp) | C 9CS2.5x059 | Compression | DSM | E2→E3→E4 (fully braced) |
| T03 | II-1B | C 9CS2.5x059 | Bending | DSM | F2(LTB+Cb)→F3→F4 |
| T04 | II-1C | C 9CS2.5 (2 sizes) | Bending | DSM+cFSM | F2→F3→F4 + springs |
| T05 | II-2B | Z 8ZS2.25x059 | Bending | DSM | F2(curve fit)→F3→F4 |
| T06 | II-4B | Track 550T125-54 | Bending | DSM | F2(inelastic LTB)→F3→F4(ambiguity) |
| T07 | II-5 | C 800S200-54 | Bending | DSM | F4(3-method Fcrd comparison) |
| T08 | II-6B | Track 600T200-68 | Bending(weak) | DSM | F2(inelastic)→F3, no F4 |
| T09 | II-7B | Hat 3HU4.5x135 | Bending | DSM | F2→F3(stocky), no F4 |
| T10 | II-13 | Sigma | Bending | DSM | F2→F3→F4 (complex section) |
| T11 | II-14 | C 550S162-33+holes | Bending | DSM | F2→F3→F4 + perforation |
| T12 | III-3 | Z 362S162-54 | Compression | EWM+DSM | E2(FTB)→E3(EWM)→E4(CUFSM) |
| T13 | III-5B | Angle 4LS4x060 | Comp+Bend | DSM | E2(torsional)→E3 + F2→F3 + H1 |
| T14 | III-7B | Z 8ZS2.25x059 | Compression | DSM | E2(flexural)→E3 + I6.2.3 |
| T15 | III-14 (case1) | Sigma | Compression | DSM | E2→E3→E4 (fully braced) |
| T16 | III-14 (case2) | Sigma | Compression | DSM | E2→E3→E4 (braced@66in) |

### 8.2 Expected Results for Regression Testing

| Test | Key Output | Expected Value | Tolerance |
|------|-----------|----------------|-----------|
| T01 | Mnl (local) | 92.6 kip-in. | ±1% |
| T02 | Pnl (local) | 19.4 kips | ±1% |
| T03 | Mnl (local) | 93.6 kip-in. | ±1% |
| T07 | Fcrd (CUFSM) | 51.5 ksi | ±2% |
| T07 | Fcrd (simplified) | 26.1 ksi | ±1% |
| T10 | Mnd (distortional) | 71.0 kip-in. | ±1% |
| T11 | Mnl (local+holes) | 12.4 kip-in. | ±1% |
| T12 | Fcrd (CUFSM, no sheathing) | 55.5 ksi | ±2% |
| T15 | Pnl (case1, local) | 30.9 kips | ±1% |
| T16 | Pnd (case2, distortional) | 21.0 kips | ±1% |

### 8.3 Check Dashboard Validation

각 예제에서 Table B4.1-1 기하 한계 체크가 모두 PASS 되는지 확인:

| Example | CHK-G01 (w/t≤500) | CHK-G04 (R/t≤20) | CHK-G07 (Fy≤95) |
|---------|-------------------|-------------------|------------------|
| II-13 (Sigma) | w/t=172 ✅ | R/t=4.16 ✅ | Fy=50 ✅ |
| III-14 (Sigma) | w/t=172 ✅ | R/t=1.58 ✅ | Fy=50 ✅ |
| II-14 (perforated) | w/t=147 ✅ | R/t=2.21 ✅ | Fy=33 ✅ |

---

## 9. Key Design Decisions from AISI Specification Analysis

### 9.1 EWM vs DSM Applicability Limits (Table B4.1-1 차이점)

| Parameter | EWM Limit | DSM Limit | 의미 |
|-----------|-----------|-----------|------|
| Inside bend R/t | ≤ 10 | ≤ 20 | DSM이 더 넓은 범위 허용 |
| Yield stress Fy | < 80 ksi | < 95 ksi | DSM이 고강도강 허용 |
| Edge-stiffened b/t | ≤ 60~90 | ≤ 160 | DSM이 세장한 립 허용 |
| Web stiffeners | 0 | ≤ 4 | DSM만 중간보강재 허용 |

→ **DSM이 기본 추천 방법**, EWM은 비교/검증용

### 9.2 Combined Loading Interaction (Chapter H)

```
H1.2: P/Pa + Mx/Max + My/May ≤ 1.0
```

- 단축(single-axis) 복합하중: 선형 상호작용
- 앵글 부재: 편심 P*L/1000 고려 필요 (H1.2 특별규정)

### 9.3 Ductility Check (Section A2.3.1)

재료 연성 검증이 설계 전에 필수:
- Fu/Fy ≥ 1.08 (최소 연성비)
- 신장률 ≥ 10% (제한 없이 사용)
- 신장률 3~10%: Fy, Fu에 0.9 계수 적용
- 신장률 < 3%: 데크/다중웹 부재만 허용
