# StCFSD — Cold-Formed Steel Buckling Analysis

A VS Code extension for **elastic buckling analysis** of cold-formed steel members using the **Finite Strip Method (FSM)**, with built-in **Direct Strength Method (DSM)** design value extraction and **AI-powered MCP** integration.

Based on the open-source [StCFSD](https://github.com/thinwalled/cufsm-git) by B.W. Schafer, S. Adany, Z. Li, and S. Jin (Johns Hopkins University).

---

## Features

### Section Designer (WebView GUI)

| Preprocessor | Postprocessor |
|:---:|:---:|
| Parametric section templates | Buckling curve (semilog) |
| Node/element table editor | 2D / 3D mode shapes |
| SVG cross-section preview | G/D/L/O modal classification |
| Material & BC selection | DSM design values table |

### Parametric Section Templates

8 built-in section types with customizable dimensions:

- **Lipped C-Channel** — lips pointing inward
- **Lipped Z-Section** — opposing flanges with inward lips
- **Hat Section** — symmetric trapezoid
- **RHS** — Rectangular Hollow Section
- **CHS** — Circular Hollow Section
- **Angle (L)** — single angle
- **I-Section** — doubly symmetric
- **T-Section**

### DSM Design Values (Automatic)

After analysis completes, the extension automatically extracts:

| Value | Description |
|-------|-------------|
| **Py** | Yield axial load |
| **My** | Yield moment |
| **Pcrl / Mcrl** | Local buckling critical load/moment |
| **Pcrd / Mcrd** | Distortional buckling critical load/moment |
| **Pcre / Mcre** | Global buckling critical load/moment |

Each value includes the corresponding **half-wavelength** and **load factor**.

### Boundary Conditions

5 end boundary condition types supported:

| Code | Description |
|------|-------------|
| S-S | Simply-Simply Supported |
| C-C | Clamped-Clamped |
| S-C | Simply-Clamped |
| C-F | Clamped-Free |
| C-G | Clamped-Guided |

### 3D Mode Shape Visualization

Interactive 3D buckling mode shapes rendered with **Babylon.js**:
- Mouse drag to rotate, scroll to zoom
- Displacement-based color mapping
- Multi-half-wave display for short wavelengths
- Canvas 2D isometric fallback

### AI Integration (MCP)

20 MCP tools for AI-driven structural analysis via **Claude Code**, **Cursor**, or **Codex**:

```
AI: "Design a Lipped C-channel H=200 B=75 D=20 t=2.0 and find Pcrl, Mcrl"

→ set_section_template(type="lippedc", H=200, B=75, D=20, t=2.0)
→ run_analysis(neigs=10)
→ get_dsm_values(fy=350)
→ Pcrl=45.2kN, Pcrd=52.8kN, Mcrl=8.9kNm, Mcrd=10.4kNm
```

All changes are reflected in the WebView GUI in real-time.

---

## Requirements

- **Python 3.10+** with `numpy` and `scipy`
- The extension automatically detects `.venv` in the project directory

```bash
pip install numpy scipy
```

---

## Getting Started

1. Install the extension from VS Code Marketplace
2. Click the **StCFSD icon** in the Activity Bar (left sidebar)
3. Click **"StCFSD: Open Section Designer"** in the tree view toolbar
4. Select a section template → **Generate** → **Run Analysis**
5. View results in the **Postprocessor** tab

---

## MCP Tools

| Category | Tools |
|----------|-------|
| **Status** | `get_status`, `get_section_properties`, `get_dsm_values`, `get_buckling_curve` |
| **Section** | `set_section_template`, `set_material`, `set_stress`, `set_boundary_condition`, `set_lengths` |
| **Analysis** | `run_analysis`, `run_signature_curve`, `classify_modes` |
| **Edit** | `get_nodes`, `get_elements`, `set_node_stress`, `double_mesh` |
| **Advanced** | `get_cutwp`, `run_plastic_surface`, `run_vibration`, `save_project` |

---

## Analysis Engine

The Python backend implements the complete FSM analysis pipeline:

- **Element matrices**: `klocal`, `kglocal` (elastic + geometric stiffness)
- **Assembly**: Sparse matrix assembly with spring support
- **Boundary conditions**: 5 types via closed-form integral evaluation
- **Eigenvalue solver**: `scipy.linalg.eig` for generalized eigenvalue problem
- **cFSM**: Constrained FSM with GBT-based mode classification (G/D/L/O)
- **fcFSM**: Force-based constrained FSM
- **Vibration**: Free vibration analysis with mass matrix
- **Plastic**: P-Mxx-Mzz interaction surface (fiber-based)
- **CUTWP**: Warping properties (J, Cw, shear center)

---

## References

- Schafer, B.W. & Li, Z. (2010). "Buckling analysis of cold-formed steel members with general boundary conditions using CUFSM." *Proc. 20th ISCCSS*, pp. 17-32.
- Schafer, B.W. & Adany, S. (2006). "Buckling analysis of cold-formed steel members using CUFSM." *Proc. 18th ISCCSS*, pp. 39-54.
- Jin, S., Adany, S. & Schafer, B.W. (2024). "Constrained Finite Strip Method: kinematic- and force-based approaches." *SSRC Annual Stability Conference*.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Publisher

**Jeil Structural Engineering Consultants**

- GitHub: [gogohkm/cufsmAi](https://github.com/gogohkm/cufsmAi)
