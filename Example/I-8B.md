# Example I-8B: C-Section With Lips - Fully Braced - DSM (Bending + Compression)

AISI Cold-Formed Steel Design Manual 2017, Pages 96-102

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam + Column (fully braced, both analyzed) |
| Section Type | C-section with lips (9CS2.5x059) |
| Design Method | ASD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curves for bending AND compression |
| Spec Reference | Chapters E, F; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 9CS2.5x059

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | D | 9.000 | in. |
| Flange width | B | 2.500 | in. |
| Lip length | d | 0.773 | in. |
| Design thickness | t | 0.059 | in. |
| Inside bend radius | R | 0.1875 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 55 | ksi |
| Elastic modulus | E | 29500 | ksi |

## 4. Gross Section Properties (from Table I-1)

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Area | A | 0.881 | in.^2 |
| Moment of inertia | Ix | 10.3 | in.^4 |
| Section modulus | Sx | 2.29 | in.^3 |

## 5. FSM Output: Bending (Strong Axis)

| Buckling Mode | Ratio (Mcr/My) | Value | Unit |
|---------------|----------------|-------|------|
| My = Fy*Sf | - | 126 | kip-in. |
| Local | Mcrl/My = 0.67 | 84.4 | kip-in. |
| Distortional | Mcrd/My = 0.85 | 107 | kip-in. |

## 6. FSM Output: Compression (Uniform)

| Buckling Mode | Ratio (Pcr/Py) | Value | Unit |
|---------------|----------------|-------|------|
| Py = Fy*Ag | - | 48.5 | kips |
| Local | Pcrl/Py = 0.12 | 5.82 | kips |
| Distortional | Pcrd/Py = 0.27 | 13.1 | kips |

## 7. DSM Bending Results (fully braced)

| Limit State | Mn (kip-in.) | Ma = Mn/1.67 (kip-in.) |
|-------------|-------------|------------------------|
| Global (F2) | Mne = 126 | 75.4 |
| Local (F3) | Mnl = 92.6 | 55.4 |
| Distortional (F4) | Mnd = 99.2 | 59.4 |
| **Controlling** | **Local: 92.6** | **55.4** |

## 8. DSM Compression Results (fully braced)

| Limit State | Pn (kips) | Pa = Pn/1.80 (kips) |
|-------------|----------|---------------------|
| Global (E2) | Pne = 48.5 | 26.9 |
| Local (E3) | Pnl = 19.4 | 10.8 |
| Distortional (E4) | Pnd = 25.4 | (calculated) |
| **Controlling** | **Local: 19.4** | **10.8** |

## 9. Key Features for Validation

- **Same section in two load cases**: Bending AND compression FSM on same 9CS2.5x059
- **Same section as II-1B**: Direct comparison possible
- **Effective I_eff curve**: Provides Ieff/Ig vs M/Mn relationship (Ieff/Ig = 0.964 at 60% Mn)
- **Both local and distortional modes**: Clearly visible minima in both load cases
- **Fully braced baseline**: No global buckling interaction - pure local/distortional comparison
