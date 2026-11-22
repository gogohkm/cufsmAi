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

59 MCP tools let an AI client (Claude Code, Cursor, Codex …) drive the Section Designer:
section → buckling analysis → load analysis → member check → connections → validation / report.

```
AI: "Lipped C 200 x 75 x 20 x 2.0 mm, inside radius 3 mm: find Pcrl and Pcrd"

→ set_section_template(type="lippedc", H=200, B=75, D=20, t=2.0, r=3, units="SI")
→ set_load_case(load_case="compression", fy=345, units="SI")
→ run_analysis()
→ get_dsm_values(load_type="P", units="SI")      # reference stress = the analysis stress
```

- **The panel must be open.** The tools talk to the Section Designer panel of a running VS Code
  window through a local bridge (127.0.0.1). Without the panel every tool returns an error.
- **No invented input.** The tools do not fill in Fy, lip length, thicknesses, loads or connection
  geometry. Missing required input comes back as the engine's error naming it.
- **Verdicts.** `pass` is `true`, `false`, or `null` = no verdict (something applicable could not be
  evaluated — see `not_evaluated`). `warnings`, `assumptions` and `scope_notes` are returned as the
  engine wrote them.
- **Units.** The engine works in US units (in, ksi, kips, kip-in; load analysis ft, plf, kip-ft).
  Tools with a `units` argument accept `units: "SI"` (mm, MPa, kN, kN-m; m, kN/m) and then return
  numeric results in SI as well, including nested results, limit-state tables and calculation steps.
  Engine text (report, formulas, warnings) stays in US units and is labelled so. Conversion factors are
  the exact definitions; SI input is converted by division, so values that are exact in inches
  (12.7 mm → 0.5 in) reach the engine exactly.

All changes are reflected in the WebView GUI in real time.

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
| **Status** | `get_status`, `get_full_state`, `get_section_properties`, `get_dsm_values`, `get_buckling_curve` |
| **Section** | `set_section_template`, `set_custom_section`, `build_section`, `get_section_preview`, `custom_section_guide`, `set_material` |
| **Stress / BC** | `set_load_case`, `set_stress`, `set_boundary_condition`, `set_lengths`, `set_springs`, `set_constraints`, `set_gbtcon` |
| **Analysis** | `run_analysis`, `run_signature_curve`, `classify_modes`, `get_energy_recovery`, `get_cutwp`, `run_plastic_surface`, `run_vibration` |
| **Edit** | `get_nodes`, `get_elements`, `set_nodes`, `set_elements`, `add_node`, `add_element`, `modify_node`, `modify_element`, `delete_node`, `delete_element`, `set_node_stress`, `double_mesh` |
| **Member design** | `aisi_design_compression`, `aisi_design_flexure`, `aisi_design_combined`, `aisi_design_tension`, `get_web_crippling`, `steel_grades`, `aisi_design_guide` |
| **Loads / purlins** | `analyze_loads`, `calc_deck_stiffness`, `design_purlin` |
| **Connections** | `aisi_design_connection`, `design_connection`, `design_lap_connection`, `check_lap_length`, `check_shear_lag`, `check_block_shear` |
| **Special topics** | `cold_work`, `flange_curling` |
| **Session** | `save_project`, `load_project`, `generate_report`, `validate_design` |

The local bridge accepts only requests from the bundled MCP server: it sends no CORS headers and
rejects requests that carry an `Origin` header, use a content type other than `application/json`,
or address a host other than 127.0.0.1 / localhost. MCP registration leaves a configuration
file's content untouched when its StCFSD entry is already up to date.

### Connecting to the host

| | VS Code extension (default) | Standalone StCFSD program (port file) |
|---|---|---|
| How the MCP server finds the host | `STCFSD_MCP_PORT` (fixed range 52790–52809), read once | `STCFSD_MCP_PORT_FILE` → JSON `{app, version, port, token, pid, instanceId, startedAt}`, read on every call; no port guessing |
| Authentication | none (local-only checks above) | `Authorization: Bearer <token>` on every request, a new random token per host process; 401 otherwise |
| Host not running | `StCFSD bridge not reachable …` | with `STCFSD_MCP_STANDALONE=1`: "The StCFSD program is not running. Ask the user to start StCFSD …" |
| Host restarted | restart the MCP client | re-attaches; until `get_status` has succeeded on the new process only `get_status` is sent (its result carries `restart_notice`), every other call is refused before sending |
| Registration | `.mcp.json`, `.claude/mcp.json`, `~/.claude/mcp.json` (entry `stcfsd-section-designer`, command `node`) | Claude Desktop `claude_desktop_config.json`, entry `mcpServers.stcfsd`: `StCFSD.exe <app>/media/mcp-server.js` with `ELECTRON_RUN_AS_NODE=1` (no Node needed) — `src/mcp/claudeDesktop.ts`, called by the desktop program, not by the extension |

Without `STCFSD_MCP_PORT_FILE` the extension and the MCP server behave exactly as before. The MCP server
always sends `X-StCFSD-Request-Id` and `X-StCFSD-Client` (`<client name>/<version>`); in port-file mode the
host exposes the last AI call at `GET /last-call` (token required). Details: `docs/reviews/20261122-engine-review/fixes/K1-mcp-connection.md`.

---

## MCP Bundle Release Policy

`media/mcp-server.js` is a committed build artifact. Its `initialize`
`serverInfo.version` carries `package.json` version + source-content hash
(e.g. `0.1.1+src.a3f9c21e7b44`), so any client can tell which sources a
running server was built from. The hash covers `src/mcp/server.ts`,
`src/mcp/siUnits.ts`, `src/mcp/hostConnection.ts`, `src/mcp/portFile.ts`,
`tsconfig.mcp.json`, `webpack.mcp.config.js` and the
name, version and dependencies of `package.json` — see `scripts/mcp-source-hash.cjs`.
Line endings are normalised to LF before hashing, so Windows (CRLF) and Linux checkouts
give the same hash; `.gitattributes` keeps the bundle and the `src/mcp` sources in LF.

Release steps after touching MCP sources:

```bash
npm run build:mcp        # deterministic bundle (no timestamps)
npm run check:mcp-parity # bundle version + 59 tool schemas vs source
git add media/mcp-server.js media/mcp-server.js.map <sources...>
git commit               # single release commit: sources + rebuilt bundle
```

CI (`mcp-parity` job) rebuilds from a clean tree, fails when the committed
bundle bytes differ, and re-runs the parity check. After updating the bundle,
restart/reconnect the MCP client (and reload the VS Code window for the
extension host) so the new server process is used.

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
