# Example II-1B: C-Section With Lips - Flexural Strength - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 273-275

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (interior span purlin, negative moment) |
| Section Type | C-section with lips (9CS2.5x059) |
| Design Method | LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curve with 3 modes (local, distortional, global) |
| Spec Reference | Sections F2, F3, F4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 9CS2.5x059 (same as I-8B)

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

## 4. FSM Output: Buckling Curve (3 Modes)

| Buckling Mode | Ratio (Mcr/My) | Half-wavelength | Value | Unit |
|---------------|----------------|-----------------|-------|------|
| My = Fy*Sf | - | - | 126 | kip-in. |
| Local | 0.67 | ~10 | 84.4 | kip-in. |
| Distortional | 0.85 | ~30 | 107 | kip-in. |
| Global (LTB) | 1.73 | ~100 | 218 | kip-in. |

Note: Mcre at Ly=Lt=56.3 in., adjusted by Cb = 1.67 and beta = 1.23

## 5. DSM Calculation Results

### Adjusted buckling moments

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Mcre (with Cb) | 1.73 * 1.67 * My | 364 | kip-in. |
| Mcrl | 0.67 * My | 84.4 | kip-in. |
| Mcrd (with beta) | 0.85 * 1.23 * My | 132 | kip-in. |

### Nominal strengths

| Limit State | lambda | Mn (kip-in.) | phi*Mn (kip-in.) |
|-------------|--------|-------------|------------------|
| Global (F2) | Fcre >> 2.78Fy | Mne = 126 | 113 |
| Local (F3) | lambda_l = 1.22 | Mnl = 93.6 | 84.2 |
| Distortional (F4) | lambda_d = 0.977 | Mnd = 101 | 90.9 |
| **Controlling** | | **Local: 93.6** | **84.2** |

## 6. Key Features for Validation

- **Three-mode buckling curve**: Local, distortional, AND global all visible
- **Same section as I-8B**: Can validate same section in different loading/bracing
- **Moment gradient effects**: Cb and beta adjustment factors applied to FSM results
- **Unbraced length**: Ly = Lt = 56.3 in. - reads global buckling from curve at specific length
- **Cross-reference**: Example II-1A (EWM) provides comparison data
