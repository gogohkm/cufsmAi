# CUFSM / FSM Validation Dataset

AISI S100-16 Design Manual (2017)에서 유한스트립법(FSM) 좌굴 해석을 사용하는 예제를 검증 데이터셋으로 정리.

- **Group A** (6개): CUFSM 프로그램을 명시적으로 사용 (인터페이스 캡처, 참조문헌 포함)
- **Group B** (7개): "Finite Strip Analysis (Appendix 2.2)"로 좌굴곡선 데이터 제공

---

## Group A: CUFSM 명시 예제 (6개)

| File | Example | Section | Member | CUFSM Technique |
|------|---------|---------|--------|-----------------|
| [II-1C.md](II-1C.md) | Four-Span C-Purlins (LRFD-DSM) | C-section (9CS2.5) | Beam | cFSM + spring restraints |
| [II-5.md](II-5.md) | Distortional Buckling of C-Section | C-section (800S200-54) | Beam | C/Z template, Fcrd, screenshot |
| [II-13.md](II-13.md) | Web-Stiffened C-Section (Flexure) | Sigma section | Beam | Buckling curve (Mcrl, Mcrd) |
| [II-14.md](II-14.md) | C-Section With Web Perforations | C-section (550S162-33) | Beam | t=0 perforation modeling |
| [III-3.md](III-3.md) | Z-Section Distortional Buckling | Z-section (362S162-54) | Column | Fcrd + net section (t=0), screenshot |
| [III-14.md](III-14.md) | Web-Stiffened C-Section (Compression) | Sigma section | Column | Buckling curve (Pcrl, Pcrd, Pcre) |

## Group B: FSM 좌굴곡선 데이터 예제 (7개)

| File | Example | Section | Member | FSM Data |
|------|---------|---------|--------|----------|
| [I-8B.md](I-8B.md) | C-Section Fully Braced (Bend+Comp) | C-section (9CS2.5x059) | Both | Bending + compression curves |
| [II-1B.md](II-1B.md) | C-Section Flexural Strength | C-section (9CS2.5x059) | Beam | 3-mode curve (L/D/G) |
| [II-2B.md](II-2B.md) | Z-Section Flexural Strength | Z-section (8ZS2.25x059) | Beam | Global curve fitting technique |
| [II-4B.md](II-4B.md) | Track Section Braced Mid-Span | Track (550T125-54) | Beam | Mode ambiguity (L/D overlap) |
| [II-6B.md](II-6B.md) | Track Weak Axis Bending | Track (600T200-68) | Beam | Weak axis, no distortional |
| [II-7B.md](II-7B.md) | Fully Braced Hat Section | Hat (3HU4.5x135) | Beam | Stocky section, no distortional |
| [III-5B.md](III-5B.md) | Equal Leg Angle (Comp+Bend) | Angle (4LS4x060) | Both | Torsional buckling, two analyses |
| [III-7B.md](III-7B.md) | Z-Section Through-Fastened | Z-section (8ZS2.25x059) | Column | Very slender local (Pcrl/Py=0.16) |

---

## Section Types Covered (13 examples)

```
C-section (lipped)     ██████████████  5 examples (I-8B, II-1B, II-1C, II-5, II-14)
Z-section (lipped)     ████████████    4 examples (II-2B, III-3, III-7B + II-1C has 2 sections)
Track (unlipped)       ████████        2 examples (II-4B, II-6B)
Sigma (web-stiffened)  ████████        2 examples (II-13, III-14) -- same section
Hat section            ████            1 example  (II-7B)
Angle (lipped)         ████            1 example  (III-5B)
```

## Buckling Mode Coverage

| Mode | Bending Examples | Compression Examples |
|------|-----------------|---------------------|
| Local | I-8B, II-1B, II-2B, II-4B, II-5, II-6B, II-7B, II-13, II-14 | I-8B, III-3, III-5B, III-7B, III-14 |
| Distortional | I-8B, II-1B, II-1C, II-2B, II-5, II-13, II-14 | I-8B, III-3, III-7B, III-14 |
| Global (LTB/FTB) | II-1B, II-2B, II-4B, II-6B | III-5B (torsional), III-14 |

## FSM Techniques Demonstrated

### 1. Buckling Curve Analysis (Mcr/My or Pcr/Py vs half-wavelength)
- Read off local, distortional, global minima
- **Examples**: I-8B, II-1B, II-1C, II-2B, II-4B, II-6B, II-7B, II-13, III-5B, III-7B, III-14

### 2. Distortional Buckling Stress (Fcrd) Direct Calculation
- C/Z template, with/without sheathing spring
- **Examples**: II-5, III-3

### 3. Net Section Properties (Perforation Modeling, t=0)
- **Examples**: II-14, III-3

### 4. Spring Restraint Modeling
- **Examples**: II-1C (deck), II-5 (OSB), III-3 (sheathing)

### 5. Global Curve Fitting (when distortional obscures global)
- Two-point extraction from global portion of curve
- **Examples**: II-2B

### 6. Mode Shape Identification
- Torsional vs flexural vs distortional distinction
- **Examples**: III-5B (angle torsional), II-4B (mode ambiguity)

## Material Properties Summary

| Fy (ksi) | Examples |
|----------|---------|
| 33 | II-4B, II-6B, II-14 |
| 50 | II-5, II-7B, II-13, III-3, III-5B, III-14 |
| 55 | I-8B, II-1B, II-1C, II-2B, III-7B |

## Key Cross-References

| Section | Bending | Compression |
|---------|---------|-------------|
| 9CS2.5x059 (C) | I-8B, II-1B | I-8B |
| 8ZS2.25x059 (Z) | II-2B | III-7B |
| Sigma (web-stiffened) | II-13 | III-14 |
| 4LS4x060 (Angle) | III-5B (minor axis) | III-5B |

## Data Structure

Each file contains:
1. **Overview** - member type, section type, design/analysis method
2. **Section Geometry** - all dimensions needed for FSM input
3. **Material Properties** - Fy, Fu, E, G, mu
4. **FSM Input** - reference loading, boundary conditions, springs
5. **FSM Output** - buckling ratios, half-wavelengths, section properties
6. **DSM Calculation** - step-by-step strength calculation with equations
7. **Key Features** - what makes this example useful for validation

## Source

AISI Cold-Formed Steel Design Manual, 2017 Edition (Volume 1)
AISI S100-16 North American Specification for the Design of Cold-Formed Steel Structural Members
