# Example III-7B: Z-Section With One Flange Through-Fastened - Compression - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 498-501

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Column (wall stud, through-fastened one flange) |
| Section Type | Z-section with lips (8ZS2.25x059) |
| Design Method | ASD and LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curve for compression (local + distortional) |
| Spec Reference | Sections E2, E3, I6.2.3; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 8ZS2.25x059 (same as II-2B)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | D | 8.000 | in. |
| Flange width | B | 2.250 | in. |
| Lip length | d | 0.910 | in. |
| Design thickness | t | 0.059 | in. |
| Inside bend radius | R | 0.1875 | in. |
| Unbraced length | KL | 300 | in. (25 ft) |
| Radius of gyration | rx | 3.07 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 55 | ksi |

## 4. Gross Section Properties

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Area | Ag | 0.822 | in.^2 |

## 5. FSM Output: Compression Buckling Curve

| Buckling Mode | Ratio (Pcr/Py) | Half-wavelength | Value | Unit |
|---------------|----------------|-----------------|-------|------|
| Py = Ag*Fy | - | - | 45.2 | kips |
| Local | 0.16 | 6.0 | 7.23 | kips |
| Distortional | 0.29 | 22.0 | 13.1 | kips |

Note: FSM analysis does NOT include sheathing restraint.

## 6. DSM Calculation Results

### Flexural Buckling about X-axis (E2 + E3)

| Parameter | Value | Unit |
|-----------|-------|------|
| Fcre = pi^2*E/(KL/r)^2 | 30.5 | ksi |
| lambda_c = sqrt(55/30.5) = 1.34 | < 1.5 | - |
| Fn = 0.658^(1.34^2) * 55 | 25.9 | ksi |
| Pne = 0.822 * 25.9 | 21.3 | kips |
| lambda_l = sqrt(21.3/7.23) = 1.72 | > 0.776 | - |
| Pnl | 12.5 | kips |

### Flexural-Torsional Buckling (I6.2.3, from III-7A)

| Parameter | Value | Unit |
|-----------|-------|------|
| Pn (FTB) | 11.8 | kips |

### Controlling

Pn = min(12.5, 11.8) = **11.8 kips** (flexural-torsional controls)

Note: Per Section I6.2.3, distortional buckling (E4) is excluded when through-fastened.

## 7. Key Features for Validation

- **Same section as II-2B**: Z-section 8ZS2.25x059, compression vs bending
- **Very slender local buckling**: Pcrl/Py = 0.16 (highly slender)
- **Long column**: KL = 300 in., significant global buckling interaction
- **Through-fastened**: One flange fastened to sheathing (Section I6.2.3)
- **Distortional excluded**: Per I6.2.3, distortional check omitted for through-fastened
- **Cross-reference**: III-7A (EWM) and III-7C (DSM with distortional) provide comparison
