# Example II-7B: Fully Braced Hat Section - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 362-365

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (simple span, fully braced) |
| Section Type | Hat section (3HU4.5x135) |
| Design Method | ASD and LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curve - local only, no distortional mode |
| Spec Reference | Sections F2, F3, F4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 3HU4.5x135

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall width | B | 4.500 | in. |
| Overall depth | D | 3.000 | in. |
| Brim width | b | 1.670 | in. |
| Design thickness | t | 0.135 | in. |
| Inside bend radius | R | 0.1875 | in. |
| Span | L | 6.00 | ft |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 50 | ksi |

## 4. Gross Section Properties (from Table I-8)

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Section modulus | Sy | 1.52 | in.^3 |

## 5. FSM Output: Buckling Curve

| Buckling Mode | Ratio (Mcr/My) | Value | Unit |
|---------------|----------------|-------|------|
| My = Fy*Sy | - | 76.0 | kip-in. |
| Local | 3.47 | 264 | kip-in. |
| Distortional | (none observed) | - | - |

## 6. DSM Calculation Results

| Parameter | Value |
|-----------|-------|
| Mne = My = 76.0 kip-in. | (fully braced) |
| lambda_l = sqrt(76.0/264) = 0.537 | < 0.776 |
| Mnl = Mne = 76.0 kip-in. | (no local buckling reduction) |
| Mnd = My = 76.0 kip-in. | (no distortional) |
| **Mn = 76.0 kip-in.** | **(yield controls)** |

### Available Strengths

| Method | Mn | Available Strength | Unit |
|--------|-----|-------------------|------|
| ASD | 76.0 | Ma = 76.0/1.67 = 45.5 | kip-in. |
| LRFD | 76.0 | phi*Mn = 0.90*76.0 = 68.4 | kip-in. |

## 7. Key Features for Validation

- **Hat section**: Inverted U-shape with brims - unique cross-section type
- **Very stocky**: Mcrl/My = 3.47 means section is far from local buckling
- **No local buckling reduction**: lambda_l < 0.776, so Mn = My (yield controls)
- **No distortional mode**: Hat section geometry prevents distortional buckling
- **Thick section**: t = 0.135 in. (relatively thick for cold-formed steel)
- **Cross-reference**: Example II-7A (EWM) provides comparison
