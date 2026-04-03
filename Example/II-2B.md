# Example II-2B: Z-Section With Lips - Flexural Strength - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 320-323

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (interior span purlin, negative moment) |
| Section Type | Z-section with lips (8ZS2.25x059) |
| Design Method | ASD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curve + global curve fitting technique |
| Spec Reference | Sections F2, F3, F4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 8ZS2.25x059

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | A | 8.000 | in. |
| Flange width (top) | B | 2.250 | in. |
| Lip length | C | 0.910 | in. |
| Design thickness | t | 0.059 | in. |
| Inside bend radius | R | 0.1875 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 55 | ksi |

## 4. FSM Output: Buckling Curve

| Buckling Mode | Ratio (Mcr/My) | Value | Unit |
|---------------|----------------|-------|------|
| My = Fy*Sf | - | 107 | kip-in. |
| Local | 0.85 | 91.0 | kip-in. |
| Distortional | 0.77 | 82.4 | kip-in. |
| Global (from curve fit) | 2.64 | (at specific L) | - |

### Global Buckling Curve Fitting (two-point method)

The global buckling curve cannot be read directly at Ly because distortional buckling dominates. Two points on the global portion are used:

| Point | L (in.) | Mcre/My |
|-------|---------|---------|
| 1 | 100 | 0.6451 |
| 2 | 200 | 0.1693 |

Curve fit: Mcre = sqrt(alpha * L^-2 + beta * L^-4)
- alpha = 141 in.^2 * My^2
- beta = 4.02e7 in.^4 * My^2

At Ly = Lt = 49.1 in. with Cb = 1.67:
- Mcre = 472 kip-in.

With moment gradient (beta = 1.23):
- Mcrd = 0.77 * 1.23 * My = 101 kip-in.

## 5. DSM Calculation Results

| Limit State | Mn (kip-in.) | Ma = Mn/1.67 (kip-in.) |
|-------------|-------------|------------------------|
| Global (F2) | Mne = 107 | 64.1 |
| Local (F3) | Mnl = 87.1 | 52.2 |
| Distortional (F4) | Mnd = 88.2 | 52.8 |
| **Controlling** | **Local: 87.1** | **52.2** |

## 6. Key Features for Validation

- **Z-section geometry**: Point-symmetric, different from C-section
- **Global curve fitting technique**: Shows how to extract global buckling when obscured by distortional
- **Two-point curve fit**: alpha, beta parameters for Mcre(L) function
- **Moment gradient**: Both Cb (global) and beta (distortional) adjustments
- **Cross-reference**: Example II-2A (EWM/ASD) provides comparison
