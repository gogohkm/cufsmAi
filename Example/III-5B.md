# Example III-5B: Unbraced Equal Leg Angle With Lips - DSM (Compression + Bending)

AISI Cold-Formed Steel Design Manual 2017, Pages 486-491

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Column + Beam (eccentric compression per H1.2) |
| Section Type | Equal leg angle with lips (4LS4x060) |
| Design Method | ASD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curves for compression AND minor-axis bending |
| Spec Reference | Chapters E, F, H; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 4LS4x060 (Equal leg angle with lips)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Leg length | L | 4.000 | in. |
| Lip length | d | (standard) | in. |
| Design thickness | t | 0.060 | in. |
| Unbraced length | KL | 18.0 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 50 | ksi |

## 4. Gross Section Properties

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Area | Ag | 0.512 | in.^2 |
| Section modulus (minor) | Sf = Sy2 | 0.250 | in.^3 |
| Iy2 | Iy2 | 0.397 | in.^4 |
| Distance to extreme fiber | c | 1.59 | in. |

## 5. FSM Output: Compression

| Buckling Mode | Ratio (Pcr/Py) | Half-wavelength | Value | Unit |
|---------------|----------------|-----------------|-------|------|
| Py = Ag*Fy | - | - | 25.6 | kips |
| Local | 0.53 | 4.1 | 13.6 | kips |
| Global (Torsional) | 0.31 | 18.0 | 7.94 | kips |
| Distortional | (merged with torsional) | - | - | - |

Note: Distortional buckling is not distinct from torsional/global buckling.

## 6. FSM Output: Minor Axis Bending (lips in compression)

| Buckling Mode | Ratio (Mcr/My) | Half-wavelength | Value | Unit |
|---------------|----------------|-----------------|-------|------|
| My = Fy*Sf | - | - | 12.5 | kip-in. |
| Local | 4.92 | 2.5 | 61.5 | kip-in. |
| Global (Torsional) | 0.69 | 18.0 | 8.63 | kip-in. |

## 7. DSM Compression Results

| Parameter | Value |
|-----------|-------|
| Fcre = Pcre/Ag = 15.5 ksi | (torsional buckling) |
| lambda_c = sqrt(50/15.5) = 1.80 | > 1.5 |
| Fn = (0.877/lambda_c^2)*Fy = 13.5 ksi | |
| Pne = 6.91 kips | |
| lambda_l = sqrt(6.91/13.6) = 0.713 | < 0.776 |
| **Pnl = Pne = 6.91 kips** | **(no local reduction)** |
| Pa = 6.91/1.80 = 3.84 kips | |

## 8. DSM Bending Results

| Parameter | Value |
|-----------|-------|
| Fcre = Mcre/Sf = 34.5 ksi | |
| Fn (inelastic) from F2.1-4 | |
| Mne (from Fn) | |
| lambda_l (very small, Mcrl/My=4.92) | |
| **Mnl controlled by global** | |

## 9. Key Features for Validation

- **Angle section**: Unusual cross-section type with lips
- **Torsional buckling**: Global mode is torsional (not flexural or LTB)
- **No distinct distortional mode**: Distortional merges with torsional for angle
- **Two FSM analyses**: Compression + minor-axis bending on same section
- **Very stocky locally**: Mcrl/My = 4.92 in bending - local buckling far away
- **Combined loading**: H1.2 eccentricity check (P*L/1000 about minor axis)
- **Cross-reference**: Example III-5A (EWM) provides comparison
