# Example III-3: Stiffened Z-Section - Distortional Buckling - Compression

AISI Cold-Formed Steel Design Manual 2017, Pages 466-478

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Column (concentrically loaded) |
| Section Type | Z-section with lips (362S162-54) |
| Design Method | ASD and LRFD |
| Analysis Method | EWM (Sections E2, E3) + DSM distortional (Section E4) |
| CUFSM Usage | (1) Fcrd via finite strip analysis, (2) net section properties via t=0 |
| Spec Reference | Sections E2, E3, E4; Appendix 2, Sections 2.2 and 2.3 |

## 2. Section Geometry

Section: 362S162-54 (Z-section with lips)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | D | 3.625 | in. |
| Overall flange width | B | 1.625 | in. |
| Design thickness | t | 0.0566 | in. |
| Lip length | d | 0.500 | in. |
| Hole diameter | dh | 1.500 | in. |

### Bracing Conditions

| Axis | Bracing | KL |
|------|---------|----|
| x-axis | Ends only | Kx*Lx (full length) |
| y-axis | Ends + mid-span | Ky*Ly (half length) |
| Torsion | Ends + mid-span | Kt*Lt (half length) |
| K factors | Kx = Ky = Kt = 1.0 | - |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 50 | ksi |
| Elastic modulus | E | 29500 | ksi |
| Shear modulus | G | 11300 | ksi |
| Poisson's ratio | mu | 0.3 | - |

## 4. Gross Section Properties (from Table I-2)

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Gross area | Ag | 0.422 | in.^2 |

## 5. CUFSM Input Configuration

### For Distortional Buckling Analysis

- **Template**: Dimensions match flat lengths and radii of standard 362S162-54
- **Reference loading**: Uniform compression stress = 50 ksi (= Fy)
- **CUFSM interface screenshot included** in original example (nodes, elements, material properties)

### For Net Section Properties

- **Method**: Set element thickness = 0 at hole location
- **Purpose**: Calculate Ix,net, Iy,net, Anet, xo,net, yo,net, Jnet, Cw,net

## 6. CUFSM Output: Distortional Buckling

### Without Sheathing

| Parameter | Value | Half-wavelength | Unit |
|-----------|-------|-----------------|------|
| Pcr/Py (local) | 0.75 | 2.8 | in. |
| Pcr/Py (distortional) | 1.11 | 13.5 | in. |
| Fcrd = 1.11 * Fy | 55.5 | - | ksi |

### With Sheathing (k_phi = 0.0957 kip-in./rad/in.)

| Parameter | Value | Half-wavelength | Unit |
|-----------|-------|-----------------|------|
| Pcr/Py (distortional) | 1.26 | 12.1 | in. |
| Fcrd = 1.26 * Fy | 63.0 | - | ksi |

## 7. CUFSM Output: Net Section Properties

| Property | Gross Section | Net Section (t=0 at hole) | Unit |
|----------|--------------|--------------------------|------|
| A | 0.422 | Anet | in.^2 |
| Ix | 1.46 | Ix,net | in.^4 |
| Iy | 0.111 | Iy,net | in.^4 |
| xo | -1.13 | xo,net | in. |
| J | 0.000130 | Jnet = 0.000110 | in.^4 |
| Cw | 0.713 | Cw,net = 0.677 | in.^6 |

## 8. Comparison: Analytical vs CUFSM for Fcrd

### Without Sheathing

| Method | Fcrd (ksi) | Lcrd (in.) |
|--------|-----------|-----------|
| Appendix 2, Section 2.3 (analytical, from Table III-5) | (from table) | 13.3 |
| CUFSM finite strip analysis | 55.5 | 13.5 |

### With Sheathing

| Method | Fcrd (ksi) | Pcrd (kips) | Pnd (kips) |
|--------|-----------|------------|-----------|
| Appendix 2, Section 2.3 (analytical) | 66.5 | 28.1 | 17.6 |
| CUFSM finite strip analysis | 63.0 | 26.6 | (similar) |

## 9. Design Results Summary

### Sections E2 and E3 (Global + Local Buckling, EWM)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Critical elastic stress | Fcre | 18.5 | ksi |
| Column slenderness | lambda_c | 1.64 | - |
| Nominal stress | Fn | 16.3 | ksi |
| Nominal global strength | Pne | 6.88 | kips |
| Effective area at Fn | Ae | 0.414 | in.^2 |
| Nominal local strength | Pnl | 6.75 | kips |

### Section E4 (Distortional Buckling, with sheathing)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Fcrd (analytical) | Fcrd | 66.5 | ksi |
| Pcrd | Pcrd | 28.1 | kips |
| Py | Py | 21.1 | kips |
| lambda_d | lambda_d | 0.867 | - |
| Pnd | Pnd | 17.6 | kips |

### Available Strengths (controlling: local buckling)

| Method | Pnl (kips) | Available Strength (kips) |
|--------|-----------|--------------------------|
| ASD | 6.75 | Pa = 6.75/1.80 = 3.75 |
| LRFD | 6.75 | phi*Pn = 0.85*6.75 = 5.74 |

## 10. Key Features for Validation

- **Z-section**: Singly-symmetric, flexural-torsional buckling applicable
- **CUFSM interface screenshot**: Full node/element definition visible
- **Net section via t=0 technique**: Cw,net and Jnet values provided for validation
- **Analytical vs CUFSM comparison**: Side-by-side Fcrd comparison validates both methods
- **Sheathing with/without**: Spring restraint effect quantified
- **Combined EWM + DSM**: EWM for global/local, DSM for distortional

## 11. Source Reference

CUFSM is a free, open source program using the semi-analytical finite strip method for determination of thin-walled member stability. Available at www.ce.jhu.edu/bschafer/cufsm.
