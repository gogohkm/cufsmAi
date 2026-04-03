# Example II-6B: C-Section Without Lips - Weak Axis Bending - DSM

AISI Cold-Formed Steel Design Manual 2017, Pages 356-359

## 1. Overview

| Item | Value |
|------|-------|
| Member Type | Beam (simple span, cable tray) |
| Section Type | Track / C-section without lips (600T200-68) |
| Design Method | ASD and LRFD |
| Analysis Method | DSM (Direct Strength Method) |
| FSM Usage | Buckling curve - weak axis bending, no distortional mode |
| Spec Reference | Sections F2, F3, F4; Appendix 2, Section 2.2 |

## 2. Section Geometry

Section: 600T200-68 (Track oriented lips-up)

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Overall depth (horizontal) | D | 6.250 | in. |
| Flange width (vertical) | B | 2.000 | in. |
| Design thickness | t | 0.0713 | in. |
| Inside bend radius | R | 0.1069 | in. |
| Lip | - | None | - |
| Span | L | 120 | in. |

## 3. Material Properties

| Parameter | Symbol | Value | Unit |
|-----------|--------|-------|------|
| Yield stress | Fy | 33 | ksi |

## 4. Gross Section Properties

| Property | Symbol | Value | Unit |
|----------|--------|-------|------|
| Section modulus (weak axis) | Sy | 0.161 | in.^3 |

## 5. FSM Output: Buckling Curve (Weak Axis Bending)

| Buckling Mode | Ratio (Mcr/My) | Value | Unit |
|---------------|----------------|-------|------|
| My = Fy*Sy | - | 5.31 | kip-in. |
| Local | 1.42 | 7.54 | kip-in. |
| Distortional | (none observed) | - | - |
| Global (LTB at L=120 in.) | 1.26 | - | - |
| Global (with Cb=1.14) | 1.26*1.14 = 1.44 | 7.63 | kip-in. |

## 6. DSM Calculation Results

| Parameter | Value | Unit |
|-----------|-------|------|
| Fcre = Mcre/Sf | 47.4 | ksi |
| Fn (inelastic LTB) | 29.6 | ksi |
| Mne = Sf*Fn | 4.77 | kip-in. |
| lambda_l = sqrt(Mne/Mcrl) | 0.795 | - |
| Mnl | 4.70 | kip-in. |
| Mnd = My (no distortional) | 5.31 | kip-in. |

### Available Strengths

| Method | Controlling | Value | Unit |
|--------|------------|-------|------|
| ASD | Local: Mnl/1.67 | 2.81 | kip-in. |
| LRFD | Local: 0.90*Mnl | 4.23 | kip-in. |

## 7. Key Features for Validation

- **Weak axis bending**: Rare test case - bending about minor axis
- **No distortional mode**: FSM curve shows only local and global minima
- **Inelastic LTB**: Global buckling falls in inelastic range (0.56Fy < Fcre < 2.78Fy)
- **Unlipped section**: Track section without edge stiffeners
- **Low Fy steel**: 33 ksi material
