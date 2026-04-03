# Example II-1C: Four-Span Continuous C-Purlins (LRFD-DSM)

AISI Cold-Formed Steel Design Manual 2017, Pages 276-337

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (continuous purlin) |
| Section Type | C-section with lips |
| Design Method | LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| CUFSM Usage | Constrained finite strip method (cFSM) for local & distortional buckling moments |
| Spec Reference | Chapters F2, F3, F4 |

## 2. Section Geometry

Two different C-sections used in 4-span system:

### 9CS2.5x059 (Interior spans)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Depth | D | 9.00 | in. |
| Design thickness | t | 0.059 | in. |
| Inside bend radius | R | 0.1875 | in. |
| Flange width | B | 2.50 | in. |
| Lip length | d | (standard) | in. |

### 9CS2.5x070 (Exterior spans)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Depth | D | 9.00 | in. |
| Design thickness | t | 0.070 | in. |
| Inside bend radius | R | 0.1875 | in. |
| Flange width | B | 2.50 | in. |
| Lip length | d | (standard) | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 55 | ksi |
| Tensile strength | Fu | 70 | ksi |
| Elastic modulus | E | 29500 | ksi |
| Shear modulus | G | 11300 | ksi |
| Poisson's ratio | mu | 0.3 | - |

## 4. Gross Section Properties

| Property | 9CS2.5x059 | 9CS2.5x070 | Unit |
|----------|------------|------------|------|
| A | 0.881 | 1.05 | in.^2 |
| Ix | 10.3 | 12.2 | in.^4 |
| Sf | 2.29 | 2.71 | in.^3 |
| Iy | 0.698 | 0.828 | in.^4 |
| J | 0.00102 | 0.00171 | in.^4 |
| Cw | 11.9 | 14.2 | in.^6 |

## 5. CUFSM Input: Spring Restraints from Metal Roof Deck

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Lateral stiffness | kx | 1.28 | kip/in./in. |
| Rotational stiffness | k_phi | 0.113 | kip-in./rad/in. |

Springs applied at top flange to model deck restraint effect.

## 6. CUFSM Output: Elastic Buckling Results

### 9CS2.5x059 - Positive Bending (with deck)

| Buckling Mode | Ratio (Mcr/My) | Half-wavelength | Unit |
|---------------|----------------|-----------------|------|
| Local | 0.67 | 4.9 | in. |
| Distortional | 1.10 | 21.0 | in. |

### 9CS2.5x059 - Negative Bending (with deck)

| Buckling Mode | Ratio (Mcr/My) | Half-wavelength | Unit |
|---------------|----------------|-----------------|------|
| Local | 0.67 | 4.9 | in. |
| Distortional | 0.85 | 25.0 | in. |

### 9CS2.5x070 - Positive Bending (with deck)

| Buckling Mode | Ratio (Mcr/My) | Half-wavelength | Unit |
|---------------|----------------|-----------------|------|
| Local | 0.95 | 4.9 | in. |
| Distortional | 1.27 | 21.0 | in. |

### 9CS2.5x070 - Negative Bending (with deck)

| Buckling Mode | Ratio (Mcr/My) | Half-wavelength | Unit |
|---------------|----------------|-----------------|------|
| Local | 0.95 | 4.9 | in. |
| Distortional | 1.06 | 24.0 | in. |

## 7. Key Features for Validation

- **Constrained FSM (cFSM)**: Uses constrained finite strip method for mode decomposition
- **Spring restraints**: Models lateral (kx) and rotational (k_phi) springs at top flange
- **Multiple load cases**: Both positive and negative bending analyzed
- **Two sections**: Same depth, different thickness - good for parametric study
- **With/Without deck comparison**: Deck restraint increases distortional & global capacity but not local

## 8. Source Reference

Li, Z. and B.W. Schafer (2010), "Buckling analysis of cold-formed steel members with general boundary conditions using CUFSM: conventional and constrained finite strip methods," Proceedings of the 20th Int'l. Spec. Conf. on Cold-Formed Steel Structures.
