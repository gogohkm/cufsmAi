# Example II-4B: C-Section Without Lips (Track) - Braced at Mid-Span - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 338-342

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (simple span, braced at mid-span) |
| Section Type | Track / C-section without lips (550T125-54) |
| Design Method | ASD and LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curve - local/distortional ambiguity |
| Spec Reference | Sections F2, F3, F4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 550T125-54 (Track - unlipped channel)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | D | 5.698 | in. |
| Flange width | B | 1.250 | in. |
| Design thickness | t | 0.0566 | in. |
| Inside bend radius | R | 0.0849 | in. |
| Lip | - | None | - |
| Span | L | 72.0 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 33 | ksi |

## 4. Gross Section Properties (from Table I-3)

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Section modulus | Sx | 0.668 | in.^3 |

## 5. FSM Output: Buckling Curve

| Buckling Mode | Ratio (Mcr/My) | Value | Unit |
|---------------|----------------|-------|------|
| My = Fy*Sf | - | 22.0 | kip-in. |
| Local (or distortional) | 1.34 | 29.5 | kip-in. |
| Global (LTB at L/2=36 in.) | 1.32 | - | - |
| Global (with Cb=1.30) | 1.32*1.30 = 1.72 | 37.8 | kip-in. |

Note: Mcrl/My = Mcrd/My = 1.34. Mode shape ambiguous - conservatively treated as both local AND distortional.

## 6. DSM Calculation Results

| Limit State | Mn (kip-in.) | Ma (kip-in.) | phi*Mn (kip-in.) |
|-------------|-------------|-------------|-----------------|
| Global (F2) | Mne = 20.9 | 12.5 | 18.8 |
| Local (F3) | Mnl = 20.9 | 12.5 | 18.8 |
| Distortional (F4) | Mnd = 21.5 | 12.9 | 19.4 |
| **Controlling** | **Global: 20.9** | **12.5** | **18.8** |

## 7. Key Features for Validation

- **Unlipped channel (Track)**: No lip stiffeners - different buckling behavior
- **Mode ambiguity**: Local and distortional modes overlap at same ratio (1.34)
- **Low Fy**: 33 ksi steel (vs typical 50-55 ksi in other examples)
- **Global buckling controls**: LTB at 36 in. unbraced length dominates
- **Cb factor**: Moment gradient adjustment for uniform load (Cb = 1.30)
