# Example III-14: Web-Stiffened C-Section - Compression - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 551-556

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Column (two bracing cases) |
| Section Type | Sigma section (C-section with web stiffener) |
| Design Method | ASD and LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| CUFSM Usage | FSM analysis for Py, Pcrl, Pcre, Pcrd from buckling curve |
| Spec Reference | Sections E2, E3, E4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Sigma section (C-Section with web stiffener) - same section as Example II-13

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | D | 8.00 | in. |
| Flange width | bo | 0.875 | in. |
| Lip length | d | 0.500 | in. |
| Design thickness | t | 0.0451 | in. |
| Inside bend radius | R | 0.0712 | in. |
| Web stiffener depth | - | 0.500 | in. |
| Web stiffener width | - | 2.25 | in. |
| Overall width | - | 2.50 | in. |

### Table B4.1-1 Geometric Limits Check

| Check | Ratio | Limit | Status |
|-------|-------|-------|--------|
| Stiffened element w/t | 172 | < 500 | OK |
| Edge-stiffened b/t | 14.2 | < 160 | OK |
| Unstiffened d/t | 8.51 | < 60 | OK |
| Inside bend R/t | 1.58 | < 20 | OK |
| Stiffener ds/bo | 0.571 | < 0.7 | OK |
| Intermediate stiffeners nf | 1 | < 4 | OK |
| Fy | 50 ksi | < 95 ksi | OK |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 50 | ksi |
| Tensile strength | Fu | 65 | ksi |
| Elastic modulus | E | 29500 | ksi |
| Poisson's ratio | mu | 0.3 | - |

## 4. CUFSM Input

- **Reference loading**: Pure axial compression (uniform stress on all fibers)
- **Boundary conditions**: Simply-simply (default FSM)
- **Analysis range**: Half-wavelength from 1 to 1000 in.

## 5. CUFSM Output: Elastic Buckling Results

### From Buckling Curve

| Parameter | Symbol | Ratio (Pcr/Py) | Value | Half-wavelength | Unit |
|-----------|--------|----------------|-------|-----------------|------|
| Gross area | Ag | - | 0.747 | - | in.^2 |
| Yield load | Py | - | 37.4 | - | kips |
| Local buckling | Pcrl | 0.92 | 34.4 | 2.0 | in. / kips |
| Flexural buckling (at 66 in.) | Pcre | 1.04 | 38.9 | 66.0 | in. / kips |
| Distortional buckling (at 66 in.) | Pcrd | 0.52 | 19.4 | 66.0 | in. / kips |

## 6. DSM Calculation Results

### Case 1: Continuously Braced (against global + distortional)

| Limit State | Parameter | Value | Unit |
|-------------|-----------|-------|------|
| Global (E2) | Pne = Py | 37.4 | kips |
| Local (E3) | lambda_l = sqrt(37.4/34.4) = 1.04 | - | - |
| | Pnl | 30.9 | kips |
| Distortional (E4) | Pnd = Py | 37.4 | kips |
| **Controlling** | **Local buckling** | **30.9** | **kips** |

### Case 2: Discretely Braced at 66.0 in. spacing

| Limit State | Parameter | Value | Unit |
|-------------|-----------|-------|------|
| Global (E2) | Fcre = 52.1 ksi, lambda_c = 0.980 | - | - |
| | Fn = 33.4 ksi | - | ksi |
| | Pne | 24.9 | kips |
| Local (E3) | lambda_l = sqrt(24.9/34.4) = 0.851 | - | - |
| | Pnl | 23.5 | kips |
| Distortional (E4) | lambda_d = sqrt(37.4/19.4) = 1.39 | - | - |
| | Pnd | 21.0 | kips |
| **Controlling** | **Distortional buckling** | **21.0** | **kips** |

### Available Strengths

| Case | Pn (kips) | ASD: Pn/1.80 (kips) | LRFD: 0.85*Pn (kips) | Controls |
|------|----------|---------------------|----------------------|----------|
| Case 1 (fully braced) | 30.9 | 17.2 | 26.3 | Local |
| Case 2 (braced at 66 in.) | 21.0 | 11.7 | 17.9 | Distortional |

## 7. Key Features for Validation

- **Same section as II-13**: Sigma section used in both flexure (II-13) and compression (III-14)
- **Complex section**: Web stiffener makes EWM inapplicable, DSM required
- **Two bracing cases**: Fully braced vs discretely braced - demonstrates bracing effect
- **Buckling curve with mode shapes**: Local at 2.0 in., flexural at 66 in., distortional at 66 in.
- **Mode interaction at 66 in.**: Both flexural and distortional modes at same length
- **Global mode isolation**: Dashed line on buckling curve shows isolated global mode
- **Complete Table B4.1-1 check**: All geometric limits verified for DSM applicability

## 8. Cross-Reference

- **Example II-13**: Same section in flexure (My=86.4, Mcrl/My=0.96, Mcrd/My=1.16)
- **Comparison**: Flexure controlled by distortional; Compression (Case 2) also distortional

## 9. Source Reference

Li, Z. and B.W. Schafer (2010), "Buckling analysis of cold-formed steel members with general boundary conditions using CUFSM: conventional and constrained finite strip methods," Proceedings of the 20th Int'l. Spec. Conf. on Cold-Formed Steel Structures, St. Louis, MO, November, 2010. Available at www.ce.jhu.edu/bschafer/cufsm.
