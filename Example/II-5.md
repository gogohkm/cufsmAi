# Example II-5: Distortional Buckling of C-Section

AISI Cold-Formed Steel Design Manual 2017, Pages 343-351

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (simply supported) |
| Section Type | C-section with lips (800S200-54) |
| Design Method | ASD |
| Analysis Method | DSM (Section F4 - Distortional Buckling) |
| CUFSM Usage | C/Z template for cross-section modeling, Fcrd determination |
| Spec Reference | Sections F2, F3, F4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 800S200-54

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth | ho (D) | 8.000 | in. |
| Overall flange width | bo (B) | 2.000 | in. |
| Design thickness | t | 0.0566 | in. |
| Lip length | do (d) | 0.625 | in. |
| Inside bend radius | R | 0.0849 | in. |
| Spacing | - | 24 | in. o.c. |

### CUFSM Centerline Dimensions (flat lengths)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Web flat | h | 7.943 | in. |
| Flange flat | b | 1.943 | in. |
| Lip flat | d | 0.597 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 50 | ksi |
| Tensile strength | Fu | 65 | ksi |
| Elastic modulus | E | 29500 | ksi |
| Shear modulus | G | 11300 | ksi |
| Poisson's ratio | mu | 0.3 | - |

## 4. Gross Section Properties (from Table I-2)

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Section modulus | Sf (Sx) | 1.64 | in.^3 |
| Shear center offset | xo | -1.27 | in. |

## 5. CUFSM Input Configuration

- **Template**: C/Z template in CUFSM
- **Reference loading**: Linear stress gradient, Fy compression at top, Fy tension at bottom (pure bending)
- **Sheathing restraint**: 0.0957 kip-in./rad/in. (from OSB, #8 fasteners at 12 in. o.c.)

## 6. CUFSM Output: Elastic Buckling Results

### Without Sheathing Restraint

| Buckling Mode | Ratio (Mcrd/My) | Half-wavelength | Fcrd | Unit |
|---------------|-----------------|-----------------|------|------|
| Local | 0.86 | 4.3 | - | in. |
| Distortional | 1.03 | 19.0 | 51.5 | ksi |

### With Sheathing Restraint (k_phi = 0.0957 kip-in./rad/in.)

| Buckling Mode | Ratio (Mcrd/My) | Half-wavelength | Fcrd | Unit |
|---------------|-----------------|-----------------|------|------|
| Distortional | 1.20 | 17.0 | 60.0 | ksi |

## 7. Comparison of Three Fcrd Calculation Methods

| Method | Fcrd (ksi) | Conservatism |
|--------|-----------|-------------|
| Commentary Appendix 2, Section 2.3.3.3(c) (simplified) | 26.1 | Very conservative |
| Specification Appendix 2, Section 2.3.3.3 (analytical) | 46.5 | Moderate |
| CUFSM finite strip analysis (Appendix 2, Section 2.2) | 51.5 | Most accurate |

## 8. DSM Calculation Results

### Yield moment

My = Sf * Fy = 1.64 * 50 = 82.0 kip-in.

### Effective section modulus (at Fn = Fy)

Se = 1.50 in.^3

### Strength Results

| Limit State | Mn (kip-in.) | Ma = Mn/Omega (kip-in.) | Controlling? |
|-------------|-------------|------------------------|-------------|
| Global (F2) | Mne = 82.0 | 49.1 | No |
| Local (F3, EWM) | Mnl = 75.0 | 44.9 | No |
| Distortional (F4, simplified Fcrd=26.1) | Mnd = 49.8 | 29.8 | Yes (conservative) |
| Distortional (F4, analytical Fcrd=46.5) | Mnd = 66.7 | 39.9 | Yes (moderate) |
| Distortional (F4, CUFSM Fcrd=51.5) | Mnd = 69.6 | 41.7 | No (local controls) |

## 9. Key Features for Validation

- **C/Z template**: CUFSM built-in template for standard C/Z sections
- **Three-method comparison**: Simplified, analytical, CUFSM - validates CUFSM against closed-form
- **Sheathing effect**: Spring restraint models OSB sheathing
- **CUFSM interface screenshot included** in original example
- **Flange properties**: Detailed calculation of flange geometric properties (Ixf, Iyf, Ixyf, xof, yof, hxf, Jf)
- **Distortional half-wavelength**: Lcrd comparison across methods

## 10. Source Reference

Li, Z. and B.W. Schafer (2010), "Buckling analysis of cold-formed steel members with general boundary conditions using CUFSM: conventional and constrained finite strip methods." Proceedings of the 20th Int'l. Spec. Conf. on Cold-Formed Steel Structures, St. Louis, MO. November, 2010.
