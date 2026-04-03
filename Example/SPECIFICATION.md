# AISI S100-16 AI-Assisted Design Calculator — Specification Document

## 1. Input Schema

### 1.1 SectionInput

```typescript
interface SectionInput {
    // Option A: Standard designation (auto-lookup)
    designation?: string;           // e.g., "9CS2.5x059", "800S200-54"

    // Option B: Manual dimensions
    section_type?: SectionType;     // 'lippedc' | 'lippedz' | 'hat' | 'track' | 'angle' | 'sigma'
    D?: number;                     // Overall depth (in.)
    B?: number;                     // Flange width (in.)
    t?: number;                     // Design thickness (in.)
    d?: number;                     // Lip length (in.) — 0 for unlipped
    R?: number;                     // Inside bend radius (in.)

    // Sigma section additional
    stiffener_depth?: number;       // Web stiffener depth (in.)
    stiffener_width?: number;       // Web stiffener width (in.)

    // Perforations (optional)
    holes?: {
        dh: number;                 // Hole diameter or height (in.)
        Lh: number;                 // Hole length (in.)
        S: number;                  // Hole spacing center-to-center (in.)
    };
}

type SectionType = 'lippedc' | 'lippedz' | 'hat' | 'track' | 'angle' | 'sigma'
                 | 'rhs' | 'chs' | 'isect' | 'tee';
```

### 1.2 MaterialInput

```typescript
interface MaterialInput {
    Fy: number;                     // Yield stress (ksi) — REQUIRED
    Fu?: number;                    // Tensile strength (ksi) — auto-infer if missing
    E?: number;                     // Elastic modulus (ksi) — default 29500
    G?: number;                     // Shear modulus (ksi) — default 11300
    mu?: number;                    // Poisson's ratio — default 0.3
    steel_grade?: string;           // e.g., "A653-50", "A1003-SS50"
}
```

### 1.3 MemberInput

```typescript
interface MemberInput {
    member_type: 'beam' | 'column' | 'beam-column';

    // Bracing
    bracing: 'fully_braced' | 'unbraced' | 'discrete';
    Lb?: number;                    // Unbraced length for bending (in.)
    KLx?: number;                   // Effective length for x-axis buckling (in.)
    KLy?: number;                   // Effective length for y-axis buckling (in.)
    KLt?: number;                   // Effective length for torsional buckling (in.)
    Kx?: number;                    // Effective length factor x — default 1.0
    Ky?: number;                    // Effective length factor y — default 1.0
    Kt?: number;                    // Effective length factor t — default 1.0

    // Loading
    bending_axis?: 'strong' | 'weak';  // default 'strong'
    Cb?: number;                    // Moment gradient factor — default 1.0

    // Sheathing restraint
    sheathing?: {
        k_phi: number;              // Rotational stiffness (kip-in./rad/in.)
        kx?: number;                // Lateral stiffness (kip/in./in.)
    };

    // Through-fastened
    through_fastened?: boolean;     // Section I6.2 provisions
}
```

### 1.4 DesignInput

```typescript
interface DesignInput {
    method: 'ASD' | 'LRFD' | 'LSD';
    analysis: 'DSM' | 'EWM' | 'both';

    // Required strengths (optional — for adequacy check)
    Pu?: number;                    // Required axial strength (kips)
    Mu?: number;                    // Required flexural strength (kip-in.)
    Vu?: number;                    // Required shear strength (kips)
}
```

### 1.5 Complete DesignRequest

```typescript
interface DesignRequest {
    section: SectionInput;
    material: MaterialInput;
    member: MemberInput;
    design: DesignInput;
}
```

---

## 2. Output Schema

### 2.1 SectionProperties

```typescript
interface SectionProperties {
    // Gross section
    Ag: number;                     // Gross area (in.^2)
    Ix: number;                     // Moment of inertia x (in.^4)
    Iy: number;                     // Moment of inertia y (in.^4)
    Sx: number;                     // Section modulus x (in.^3)
    Sy: number;                     // Section modulus y (in.^3)
    rx: number;                     // Radius of gyration x (in.)
    ry: number;                     // Radius of gyration y (in.)
    J: number;                      // St. Venant torsion constant (in.^4)
    Cw: number;                     // Warping constant (in.^6)
    xo: number;                     // Shear center x-offset (in.)
    yo: number;                     // Shear center y-offset (in.)
    ro: number;                     // Polar radius of gyration (in.)

    // Net section (if holes)
    net?: {
        Anet: number;
        Ix_net: number;
        Iy_net: number;
        J_net: number;
        Cw_net: number;
    };
}
```

### 2.2 BucklingResult

```typescript
interface BucklingResult {
    // Compression buckling
    compression?: {
        Pcrl: number;               // Local buckling load (kips)
        Pcrl_ratio: number;         // Pcrl/Py
        Lcrl: number;               // Local half-wavelength (in.)
        Pcrd: number;               // Distortional buckling load (kips)
        Pcrd_ratio: number;         // Pcrd/Py
        Lcrd: number;               // Distortional half-wavelength (in.)
        Pcre?: number;              // Global buckling load at KL (kips)
        Pcre_ratio?: number;        // Pcre/Py
        Py: number;                 // Yield load (kips)
    };

    // Flexural buckling
    flexure?: {
        Mcrl: number;               // Local buckling moment (kip-in.)
        Mcrl_ratio: number;         // Mcrl/My
        Lcrl: number;               // Local half-wavelength (in.)
        Mcrd: number;               // Distortional buckling moment (kip-in.)
        Mcrd_ratio: number;         // Mcrd/My
        Lcrd: number;               // Distortional half-wavelength (in.)
        Mcre?: number;              // Global buckling moment (kip-in.)
        Mcre_ratio?: number;        // Mcre/My
        My: number;                 // Yield moment (kip-in.)
    };

    // Shear buckling
    shear?: {
        Vcr: number;                // Elastic shear buckling (kips)
        Vy: number;                 // Shear yield (kips)
    };

    // Raw curve data for plotting
    curve_data?: {
        half_wavelengths: number[];
        load_factors: number[];
    };
}
```

### 2.3 StrengthResult

```typescript
interface StrengthResult {
    compression?: {
        // E2: Global
        Fcre: number;               // Critical elastic stress (ksi)
        lambda_c: number;           // Global slenderness
        Fn: number;                 // Nominal stress (ksi)
        Pne: number;                // Nominal global strength (kips)

        // E3: Local
        lambda_l: number;           // Local slenderness
        Pnl: number;                // Nominal local strength (kips)

        // E4: Distortional
        lambda_d: number;           // Distortional slenderness
        Pnd: number;                // Nominal distortional strength (kips)

        // Controlling
        Pn: number;                 // Nominal strength (kips)
        controlling: 'global' | 'local' | 'distortional';

        // Design strength
        phi: number;                // Resistance factor (0.85)
        omega: number;              // Safety factor (1.80)
        phi_Pn: number;             // LRFD design strength
        Pn_omega: number;           // ASD allowable strength
    };

    flexure?: {
        // F2: Global
        Fcre: number;
        Fn: number;
        Mne: number;

        // F3: Local
        lambda_l: number;
        Mnl: number;

        // F4: Distortional
        lambda_d: number;
        Mnd: number;

        // Controlling
        Mn: number;
        controlling: 'global' | 'local' | 'distortional';

        // Design strength
        phi: number;                // 0.90 or 0.95
        omega: number;              // 1.67 or 1.60
        phi_Mn: number;
        Mn_omega: number;
    };

    shear?: {
        lambda_v: number;
        Vn: number;
        phi: number;                // 0.95
        omega: number;              // 1.60
        phi_Vn: number;
        Vn_omega: number;
    };

    interaction?: {
        ratio_P: number;            // Pu / (phi*Pn)
        ratio_M: number;            // Mu / (phi*Mn)
        interaction_value: number;  // <= 1.0 to pass
        equation_used: 'H1-1' | 'H1-2';
        passed: boolean;
    };
}
```

---

## 3. Check Rules Database

### 3.1 Geometric Limits (Table B4.1-1)

```typescript
const GEOMETRIC_CHECKS: CheckRule[] = [
    {
        id: 'CHK-G01',
        title: 'Stiffened element w/t ratio',
        category: 'geometric',
        spec_ref: 'Table B4.1-1',
        evaluate: (section) => {
            const w = section.D - 2*(section.t + section.R);
            const ratio = w / section.t;
            return {
                value: ratio,
                limit: 500,
                status: ratio <= 500 ? 'pass' : 'fail',
                message: `w/t = ${ratio.toFixed(0)} ${ratio <= 500 ? '<=' : '>'} 500`
            };
        }
    },
    {
        id: 'CHK-G02',
        title: 'Edge-stiffened element b/t ratio',
        category: 'geometric',
        spec_ref: 'Table B4.1-1',
        evaluate: (section) => {
            const b = section.B - (section.t + section.R);
            const ratio = b / section.t;
            return {
                value: ratio,
                limit: 160,
                status: ratio <= 160 ? 'pass' : 'fail',
                message: `b/t = ${ratio.toFixed(1)} ${ratio <= 160 ? '<=' : '>'} 160`
            };
        }
    },
    {
        id: 'CHK-G03',
        title: 'Unstiffened element d/t ratio',
        category: 'geometric',
        spec_ref: 'Table B4.1-1',
        evaluate: (section) => {
            if (!section.d || section.d === 0) return { status: 'skip', message: 'No lip' };
            const d_flat = section.d - (section.t + section.R) / 2;
            const ratio = d_flat / section.t;
            return {
                value: ratio,
                limit: 60,
                status: ratio <= 60 ? 'pass' : 'fail',
                message: `d/t = ${ratio.toFixed(1)} ${ratio <= 60 ? '<=' : '>'} 60`
            };
        }
    },
    {
        id: 'CHK-G04',
        title: 'Inside bend radius R/t ratio',
        category: 'geometric',
        spec_ref: 'Table B4.1-1',
        evaluate: (section) => {
            const ratio = section.R / section.t;
            return {
                value: ratio,
                limit: 20,
                status: ratio <= 20 ? 'pass' : (ratio <= 10 ? 'warning' : 'fail'),
                message: `R/t = ${ratio.toFixed(2)} ${ratio <= 20 ? '<=' : '>'} 20`
            };
        }
    },
    {
        id: 'CHK-G05',
        title: 'Single edge stiffener ds/bo ratio',
        category: 'geometric',
        spec_ref: 'Table B4.1-1',
        evaluate: (section) => {
            if (!section.d || section.d === 0) return { status: 'skip' };
            const ratio = section.d / section.B;
            return {
                value: ratio,
                limit: 0.7,
                status: ratio <= 0.7 ? 'pass' : 'fail',
                message: `ds/bo = ${ratio.toFixed(3)} ${ratio <= 0.7 ? '<=' : '>'} 0.7`
            };
        }
    },
    {
        id: 'CHK-G07',
        title: 'Yield stress limit for DSM',
        category: 'geometric',
        spec_ref: 'Table B4.1-1',
        evaluate: (material) => {
            return {
                value: material.Fy,
                limit: 95,
                status: material.Fy <= 95 ? 'pass' : 'fail',
                message: `Fy = ${material.Fy} ksi ${material.Fy <= 95 ? '<=' : '>'} 95 ksi`
            };
        }
    },
];
```

### 3.2 Material Checks

```typescript
const MATERIAL_CHECKS: CheckRule[] = [
    {
        id: 'CHK-M01',
        title: 'Yield stress within recognized range',
        evaluate: (mat) => {
            const valid = mat.Fy >= 25 && mat.Fy <= 95;
            return {
                status: valid ? 'pass' : (mat.Fy > 95 ? 'fail' : 'warning'),
                message: valid ? `Fy = ${mat.Fy} ksi OK` :
                    `Fy = ${mat.Fy} ksi outside typical range (25-95 ksi)`
            };
        }
    },
    {
        id: 'CHK-M02',
        title: 'Fu/Fy ductility ratio',
        spec_ref: 'Section A2.3.1',
        evaluate: (mat) => {
            if (!mat.Fu) return { status: 'skip', message: 'Fu not provided' };
            const ratio = mat.Fu / mat.Fy;
            return {
                value: ratio,
                limit: 1.08,
                status: ratio >= 1.08 ? 'pass' : 'fail',
                message: `Fu/Fy = ${ratio.toFixed(2)} ${ratio >= 1.08 ? '>=' : '<'} 1.08`
            };
        }
    },
];
```

### 3.3 Buckling Analysis Checks

```typescript
const BUCKLING_CHECKS: CheckRule[] = [
    {
        id: 'CHK-B01',
        title: 'Local buckling minimum identified',
        evaluate: (buckling) => {
            const found = buckling.Pcrl_ratio > 0 || buckling.Mcrl_ratio > 0;
            return {
                status: found ? 'pass' : 'warning',
                message: found ? `Local min at L=${buckling.Lcrl} in.` :
                    'No distinct local buckling minimum found'
            };
        }
    },
    {
        id: 'CHK-B02',
        title: 'Distortional buckling minimum identified',
        evaluate: (buckling) => {
            const found = buckling.Pcrd_ratio > 0 || buckling.Mcrd_ratio > 0;
            return {
                status: found ? 'pass' : 'info',
                message: found ? `Distortional min at L=${buckling.Lcrd} in.` :
                    'No distortional mode (may be valid for unlipped/hat sections)'
            };
        }
    },
    {
        id: 'CHK-B04',
        title: 'Buckling mode confidence',
        evaluate: (buckling) => {
            // Check if local and distortional wavelengths are well-separated
            if (!buckling.Lcrl || !buckling.Lcrd)
                return { status: 'info', message: 'Single mode identified' };
            const separation = buckling.Lcrd / buckling.Lcrl;
            return {
                value: separation,
                status: separation > 3 ? 'pass' : 'warning',
                message: separation > 3 ?
                    `Modes well-separated (Lcrd/Lcrl = ${separation.toFixed(1)})` :
                    `Modes close (Lcrd/Lcrl = ${separation.toFixed(1)}) — verify identification`
            };
        }
    },
];
```

### 3.4 Strength Adequacy Checks

```typescript
const STRENGTH_CHECKS: CheckRule[] = [
    {
        id: 'CHK-S02',
        title: 'Flexural adequacy',
        evaluate: (strength, demand) => {
            if (!demand.Mu) return { status: 'skip', message: 'No required moment specified' };
            const capacity = strength.flexure.phi_Mn; // LRFD
            const ratio = demand.Mu / capacity;
            return {
                value: ratio,
                limit: 1.0,
                status: ratio <= 1.0 ? (ratio > 0.95 ? 'warning' : 'pass') : 'fail',
                message: `Mu/φMn = ${ratio.toFixed(3)} ${ratio <= 1.0 ? '<=' : '>'} 1.0`
            };
        }
    },
];
```

### 3.5 Warning Thresholds

| Condition | Warning Level |
|-----------|--------------|
| Demand/Capacity > 0.95 | ⚠️ Near capacity limit |
| Demand/Capacity > 1.0 | ❌ Over capacity |
| w/t > 400 (approaching 500 limit) | ⚠️ Very slender |
| Mcrl/My < 0.5 | ⚠️ Significant local buckling |
| Mcrd/My < 0.5 | ⚠️ Significant distortional buckling |
| Fy > 80 ksi | ⚠️ High-strength steel, verify ductility |
| No distortional mode found | ℹ️ May be valid for some sections |

---

## 4. Safety and Resistance Factors

### 4.1 Factor Table (from AISI S100-16)

| Limit State | φ (LRFD) | Ω (ASD) | Spec Section |
|-------------|----------|---------|-------------|
| Tension yielding | 0.90 | 1.67 | D2 |
| Tension rupture | 0.75 | 2.00 | D3 |
| Compression (global) | 0.85 | 1.80 | E2 |
| Compression (local) | 0.85 | 1.80 | E3 |
| Compression (distortional) | 0.85 | 1.80 | E4 |
| Flexure (global) | 0.90 | 1.67 | F2 |
| Flexure (local, Section F3.1) | 0.90 | 1.67 | F3.1 |
| Flexure (local, Section F3.2) | 0.90 | 1.67 | F3.2 |
| Flexure (distortional) | 0.90 | 1.67 | F4 |
| Shear | 0.95 | 1.60 | G2 |
| Web crippling | 0.75-0.90 | 1.65-2.00 | G5 |
| Welds | 0.50-0.70 | 2.00-2.50 | J2 |
| Bolts | 0.55-0.70 | 2.00-2.22 | J3 |
| Screws | 0.50-0.65 | 2.00-3.00 | J4 |

### 4.2 DSM-Specific Factors (Table B4.1-1 satisfied)

When all geometric limits pass:
- Compression: φ = 0.85, Ω = 1.80
- Flexure: φ = 0.90, Ω = 1.67

When geometric limits NOT satisfied:
- Must use reduced factors per Section A1.2(b)
- φ = 0.80, Ω = 1.95 (compression)
- φ = 0.85, Ω = 1.76 (flexure)

---

## 5. DSM Equation Reference

### 5.1 Compression (Chapter E)

| Equation | Number | Condition |
|----------|--------|-----------|
| Pne = Ag*Fn | E2-1 | All cases |
| Fn = (0.658^λc²)*Fy | E2-2 | λc ≤ 1.5 |
| Fn = (0.877/λc²)*Fy | E2-3 | λc > 1.5 |
| λc = √(Fy/Fcre) | E2-4 | - |
| Pnl = Pne | E3.2.1-1 | λl ≤ 0.776 |
| Pnl = [1-0.15(Pcrl/Pne)^0.4](Pcrl/Pne)^0.4 * Pne | E3.2.1-2 | λl > 0.776 |
| λl = √(Pne/Pcrl) | E3.2.1-3 | - |
| Pnd = Py | E4.1-1 | λd ≤ 0.561 |
| Pnd = [1-0.25(Pcrd/Py)^0.6](Pcrd/Py)^0.6 * Py | E4.1-2 | λd > 0.561 |
| λd = √(Py/Pcrd) | E4.1-3 | - |
| Py = Ag*Fy | E4.1-4 | - |

### 5.2 Flexure (Chapter F)

| Equation | Number | Condition |
|----------|--------|-----------|
| Mne = Sf*Fn ≤ My | F2.1-1 | All cases |
| My = Sf*Fy | F2.1-2 | - |
| Fn = Fy | F2.1-3 | Fcre ≥ 2.78*Fy |
| Fn = (10/9)Fy(1-10Fy/(36Fcre)) | F2.1-4 | 2.78Fy > Fcre > 0.56Fy |
| Fn = Fcre | F2.1-5 | Fcre ≤ 0.56*Fy |
| Mnl = Mne | F3.2.1-1 | λl ≤ 0.776 |
| Mnl = [1-0.15(Mcrl/Mne)^0.4](Mcrl/Mne)^0.4 * Mne | F3.2.1-2 | λl > 0.776 |
| λl = √(Mne/Mcrl) | F3.2.1-3 | - |
| Mnd = My | F4.1-1 | λd ≤ 0.673 |
| Mnd = [1-0.22(Mcrd/My)^0.5](Mcrd/My)^0.5 * My | F4.1-2 | λd > 0.673 |
| λd = √(My/Mcrd) | F4.1-3 | - |

### 5.3 Shear (Chapter G)

| Equation | Number | Condition |
|----------|--------|-----------|
| Vn = Vy | G2.1-1 | λv ≤ 0.815 |
| Vn = 0.815√(Vcr*Vy) | G2.1-2 | 0.815 < λv ≤ 1.227 |
| Vn = Vcr | G2.1-3 | λv > 1.227 |
| λv = √(Vy/Vcr) | G2.1-4 | - |
| Vy = 0.6*Aw*Fy | G2.1-5 | - |
| Aw = h*t | G2.1-6 | - |

---

## 6. Error and Warning Codes

| Code | Severity | Message | Action |
|------|----------|---------|--------|
| E001 | Error | "Section dimensions incomplete" | Ask user for missing dimensions |
| E002 | Error | "Fy not specified" | Ask user for yield stress |
| E003 | Error | "w/t exceeds 500" | DSM not applicable |
| E004 | Error | "Fu/Fy < 1.08" | Material ductility insufficient |
| W001 | Warning | "Fu inferred from Fy" | Inform user of assumption |
| W002 | Warning | "Cb assumed 1.0" | Conservative, suggest user verify |
| W003 | Warning | "Demand/Capacity > 0.95" | Near limit, review carefully |
| W004 | Warning | "Very slender section (w/t > 400)" | Check fabrication feasibility |
| W005 | Warning | "Distortional mode not distinct" | May be valid for section type |
| W006 | Warning | "KL assumed equal to member length" | User should verify effective length |
| I001 | Info | "Fully braced — LTB not applicable" | No action needed |
| I002 | Info | "No distortional mode for this section" | Valid for hat/unlipped sections |
| I003 | Info | "Yield controls (section is stocky)" | No buckling reduction |

---

## 7. Dashboard UI Specification

### 7.1 Layout

```
┌─────────────────────────────────────────────────┐
│ AISI S100-16 Design Check Dashboard              │
│ Section: 9CS2.5x059  |  Fy=55 ksi  |  LRFD-DSM │
├─────────────┬───────────────────────────────────┤
│  Summary    │  ✅ 12 Pass  ⚠️ 2 Warn  ❌ 0 Fail │
│  D/C Ratio  │  ████████░░  0.83                  │
│  Controls   │  Local Buckling (F3)               │
├─────────────┴───────────────────────────────────┤
│                                                  │
│  ▼ Geometric Limits          [5/5 ✅]            │
│    ✅ CHK-G01  w/t = 145 ≤ 500                   │
│    ✅ CHK-G02  b/t = 38.5 ≤ 160                  │
│    ✅ CHK-G03  d/t = 11.2 ≤ 60                   │
│    ✅ CHK-G04  R/t = 3.18 ≤ 20                   │
│    ✅ CHK-G05  ds/bo = 0.31 ≤ 0.7                │
│                                                  │
│  ▼ Material                  [2/2 ✅]            │
│    ✅ CHK-M01  Fy = 55 ksi (valid)               │
│    ✅ CHK-M02  Fu/Fy = 1.27 ≥ 1.08              │
│                                                  │
│  ▼ Buckling Analysis         [3/3 ✅]            │
│    ✅ CHK-B01  Local: Mcrl/My = 0.67 at 10 in.  │
│    ✅ CHK-B02  Distortional: Mcrd/My = 0.85      │
│    ⚠️ CHK-B04  Mode separation Lcrd/Lcrl = 3.0   │
│                                                  │
│  ▼ Strength Adequacy         [2/2 ✅]            │
│    ✅ CHK-S02  Mu/φMn = 0.83 ≤ 1.0              │
│    ⏭️ CHK-S01  (compression not applicable)       │
│                                                  │
│  ▼ Special Conditions        [0 items]           │
│    (none applicable)                             │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 7.2 Color Scheme

| Status | Background | Border | Icon |
|--------|-----------|--------|------|
| Pass | #e6f4ea | #34a853 | ✅ |
| Warning | #fef7e0 | #f9ab00 | ⚠️ |
| Fail | #fce8e6 | #ea4335 | ❌ |
| Info | #e8f0fe | #4285f4 | ℹ️ |
| Skip | #f1f3f4 | #9aa0a6 | ⏭️ |

### 7.3 D/C Ratio Bar

```
D/C ≤ 0.75   → Green bar
0.75 < D/C ≤ 0.95 → Yellow bar
0.95 < D/C ≤ 1.0  → Orange bar
D/C > 1.0    → Red bar
```

---

## 8. Specification Cross-Reference Table (from AISI Design Manual)

### 8.1 Appendix 2.2 (FSM Numerical Solutions) → Examples

이 테이블은 AISI 기준서의 어떤 조항이 어떤 예제에서 사용되는지를 보여줌.
계산 엔진의 단위 테스트 매핑에 활용.

| Spec Section | Examples Using It | Context |
|---|---|---|
| Appendix 1.1 (EWM stiffened) | I-8A, I-9A, I-10, I-11, I-14, II-6A, III-2, III-11 | 보강요소 유효폭 |
| Appendix 1.2 (EWM unstiffened) | I-9A, I-12, I-14 | 비보강요소 유효폭 |
| Appendix 1.3 (Edge stiffener) | I-8A, I-10, I-11, I-13, I-14, III-2 | 립 보강요소 |
| **Appendix 2.2 (FSM/numerical)** | **I-8B, II-1B, II-1C, II-2B, II-4B, II-5, II-6B, II-7B, II-13, II-14, III-1B, III-3, III-5B, III-7B, III-14** | **FSM 좌굴해석** |
| Appendix 2.3.1.3 (Distortional analytical) | II-5, III-3 | 비틀림좌굴 해석공식 |
| E2 (Global compression) | III-1A, III-1B, III-3, III-5A, III-5B, III-7A, III-7B | 전체좌굴 |
| E3 (Local compression) | III-1A, III-1B, III-5A, III-5B, III-7A, III-7B | 국부좌굴 |
| E4 (Distortional compression) | III-3, III-14 | 비틀림좌굴 |
| F2 (Global flexure) | II-1A, II-1B, II-2A, II-2B, II-4B, II-6B | LTB |
| F3 (Local flexure) | II-1A, II-1B, II-4B, II-7B, II-13 | 국부좌굴 |
| F4 (Distortional flexure) | II-5, II-13, II-14 | 비틀림좌굴 |
| G2 (Shear) | II-15 | 전단강도 |
| H1.2 (Combined) | III-5B, III-12, III-13 | 복합하중 |

### 8.2 Ductility Requirements (Section A2.3.1)

| Elongation (2") | Usage | Factor |
|-----------------|-------|--------|
| ≥ 10% | Unrestricted use | Fy, Fu as-is |
| 3% ~ 10% | Restricted: use 0.9Fy and 0.9Fu | Reduced |
| < 3% | Deck/multiple-web members only | Rb factor applied |

### 8.3 Complete ASTM Steel Grade Database

| ASTM Standard | Grades | Fy Range (ksi) | Coating |
|---|---|---|---|
| A653/A653M | SS 33, 37, 40, 50, 55, 60, 70, 80 | 33-80 | Hot-dip galvanized (G40-G90) |
| A1003/A1003M | ST 33H, 37H, 40H, 50H | 33-50 | Various |
| A792/A792M | 33, 37, 40, 50, 60, 80 | 33-80 | Al-Zn coated (AZ50/AZ55) |
| A875/A875M | 33-50H | 33-50 | Zn-5%Al coated |
| A1008/A1008M | 25-70 | 25-70 | Cold-rolled, uncoated |
| A1011/A1011M | 30-70 | 30-70 | Hot-rolled, uncoated |

### 8.4 Web Crippling (Chapter G5) — Additional Check

```
Pn = C * t² * Fy * sin(θ) * [1 - CR*√(R/t)] * [1 + CN*√(N/t)] * [1 - Ch*√(h/t)]
```

| Parameter | Description |
|-----------|------------|
| C, CR, CN, Ch | Coefficients from Tables G5-1 ~ G5-5 (by support/load condition) |
| θ | Bearing angle (45°-90°) |
| R | Inside bend radius |
| N | Bearing length |
| h | Web flat depth |
| φ_w | 0.75 ~ 0.90 (LRFD), Ω_w = 1.65 ~ 2.00 (ASD) |

### 8.5 Distortional Buckling Analytical Formula (Appendix 2.3.1.3)

```
Fcrd = (k_φfe + k_φwe + k_φ) / (k̃_φfg + k̃_φwg)
```

Characteristic half-wavelength:
```
Lcrd = { [6π⁴ ho(1-μ²)/t³] * [Ixf(xof-hxf)² + Cwf - Ixyf²/Iyf*(xof-hxf)²] }^(1/4)
```

Required flange section properties (Table 2.3.1.3-1):
- Af, Jf, Ixf, Iyf, Ixyf, Cwf, xof, yof, hxf

---

## 9. API Endpoints (JSON-RPC)

### 8.1 Design Calculation

```json
// Request
{
    "method": "design.calculate",
    "params": {
        "section": { "designation": "9CS2.5x059" },
        "material": { "Fy": 55 },
        "member": { "member_type": "beam", "bracing": "fully_braced" },
        "design": { "method": "LRFD", "analysis": "DSM", "Mu": 70 }
    }
}

// Response
{
    "result": {
        "input_summary": { ... },          // Validated + auto-filled inputs
        "section_properties": { ... },      // SectionProperties
        "buckling": { ... },               // BucklingResult
        "strength": { ... },               // StrengthResult
        "dashboard": { ... },              // DashboardData
        "ai_messages": [                   // AI assistant messages
            { "type": "info", "message": "Fu = 70 ksi auto-applied (ASTM A653 Grade 55)" },
            { "type": "result", "message": "Controlling: Local buckling, φMn = 83.3 kip-in." }
        ]
    }
}
```

### 8.2 Input Validation

```json
// Request
{
    "method": "design.validate",
    "params": {
        "section": { "D": 9.0, "B": 2.5, "t": 0.059 },
        "material": { "Fy": 55 }
    }
}

// Response
{
    "result": {
        "is_complete": false,
        "missing": ["section_type", "d", "R", "member_type"],
        "auto_filled": { "E": 29500, "G": 11300, "mu": 0.3, "Fu": 70 },
        "questions": [
            { "field": "section_type", "question": "단면 형상을 선택하세요", "options": ["lippedc", "lippedz", "hat", "track"] },
            { "field": "d", "question": "립(lip) 길이를 입력하세요 (in.). 립이 없으면 0" },
            { "field": "R", "question": "내부 코너 반경(R)을 입력하세요 (in.)" }
        ]
    }
}
```

### 8.3 Section Lookup

```json
// Request
{ "method": "design.lookup_section", "params": { "designation": "800S200-54" } }

// Response
{
    "result": {
        "found": true,
        "section_type": "lippedc",
        "D": 8.0, "B": 2.0, "t": 0.0566, "d": 0.625, "R": 0.0849,
        "source": "AISI Table I-2"
    }
}
```
