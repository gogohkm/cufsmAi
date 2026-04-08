/**
 * StCFSD MCP Server — AI가 단면 해석을 제어하는 도구 모음
 *
 * stgen MCP 패턴 따름:
 * - stdio 프로토콜로 AI 클라이언트와 통신
 * - HTTP로 VS Code Extension 브릿지에 요청
 * - 도구별 Zod 스키마 검증
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as http from "http";

const DEFAULT_PORT = 52790;
const BRIDGE_PORT = parseInt(process.env.STCFSD_MCP_PORT || String(DEFAULT_PORT));

// ============================================================
// HTTP Bridge 호출 헬퍼
// ============================================================
function callBridgeGet(endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${BRIDGE_PORT}${endpoint}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ error: data }); }
            });
        }).on('error', reject);
    });
}

function callBridgePost(endpoint: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost', port: BRIDGE_PORT,
            path: endpoint, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ error: data }); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function textResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

// ============================================================
// MCP Server 생성
// ============================================================
const server = new McpServer({
    name: "stcfsd-section-designer",
    version: "1.0.0",
}, {
    instructions: `StCFSD - Cold-Formed Steel Section Buckling Analysis Tool.

IMPORTANT: All values must be in US customary units:
- Dimensions (H, B, D, t, r): inches
- Stress (Fy, Fu, E): ksi
- Force: kips
- Moment: kip-in
- Length (half-wavelength, Lb): inches

Default steel: SGC400 (Fy=35.53 ksi, Fu=58.02 ksi, E=29500 ksi)

Workflow:
1. get_status → check current state
2. set_section_template → generate a section (lippedc, lippedz, track, hat, rhs, chs, angle, isect, tee, lipped_angle)
3. set_material / set_boundary_condition / set_lengths → configure analysis
4. run_analysis → execute FSM buckling analysis
5. get_dsm_values → extract Pcrl, Pcrd, Mcrl, Mcrd, Py, My
6. get_buckling_curve → view load factors vs half-wavelengths

All changes are reflected in the VS Code WebView in real-time.`
});

// ============================================================
// 1. STATUS & INFO (4 tools)
// ============================================================
server.tool("get_status", "Get current section and analysis status", {},
    async () => {
        const r = await callBridgeGet('/status');
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_full_state", "Get complete model state: section dimensions, material, stress, BC, lengths, analysis results summary, and minima",
    {},
    async () => {
        const r = await callBridgePost('/action', { action: 'get_full_state' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_section_properties", "Get cross-section properties (A, Ixx, Izz, J, Cw, etc.)", {},
    async () => {
        const r = await callBridgePost('/action', { action: 'get_properties' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_dsm_values", "Get DSM design values: Pcrl, Pcrd, Mcrl, Mcrd, Py, My",
    { fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)") },
    async ({ fy }) => {
        const r = await callBridgePost('/action', { action: 'get_dsm', fy: fy || 35.53 });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_buckling_curve", "Get buckling curve data (half-wavelength vs load factor)", {},
    async () => {
        const r = await callBridgePost('/action', { action: 'get_curve' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// 2. SECTION DEFINITION (5 tools)
// ============================================================
server.tool("set_section_template",
    "Generate a parametric section. Types: lippedc, lippedz, track, hat, rhs, chs, angle, isect, tee, lipped_angle",
    {
        type: z.enum(['lippedc', 'lippedz', 'track', 'hat', 'rhs', 'chs', 'angle', 'isect', 'tee', 'lipped_angle'])
            .describe("Section type"),
        H: z.number().describe("Height in inches (web height, out-to-out)"),
        B: z.number().describe("Width in inches (flange width, out-to-out)"),
        D: z.number().optional().describe("Lip length in inches"),
        t: z.number().describe("Thickness in inches"),
        r: z.number().optional().describe("Corner radius in inches (default 0)"),
        qlip: z.number().optional().describe("Lip angle in degrees (default 90). For lippedc/lippedz: 90=vertical, <90=inward, >90=outward"),
    },
    async (params) => {
        const r = await callBridgePost('/action', {
            action: 'generate_template',
            section_type: params.type,
            params: {
                H: params.H, B: params.B, D: params.D || 1, t: params.t, r: params.r || 0,
                qlip: params.qlip,
            }
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_custom_section",
    "Generate an arbitrary open section from outer corner coordinates. Uses the CFS centerline algorithm: outer corners → t/2 offset → fillet → centroid shift. Works for any open section: sigma, rack, modified C/Z, etc.",
    {
        outer_corners: z.array(z.array(z.number()).length(2))
            .describe("Outer (outside face) sharp corner coordinates [[x0,y0],[x1,y1],...] in path order from one free end to the other. Use out-to-out dimensions, no corner radius."),
        t: z.number().describe("Sheet thickness"),
        R_inner: z.number().optional().describe("Inside corner bend radius (default 0, same for all corners)"),
        corner_radii: z.array(z.number()).optional()
            .describe("Per-corner inside radii (length = N-2 inner corners). Overrides R_inner. Use 0 for sharp corners."),
        n_arc: z.number().optional().describe("Arc subdivisions per corner (default 4)"),
        outer_side: z.enum(['left', 'right']).optional()
            .describe("Which side of the path is the outer face. 'left'=outer face is left of travel direction (default for C/sigma). 'right'=outer face is right."),
    },
    async (params) => {
        const r = await callBridgePost('/action', {
            action: 'generate_template',
            section_type: 'custom',
            params: {
                outer_corners: params.outer_corners,
                t: params.t,
                R_inner: params.R_inner || 0,
                corner_radii: params.corner_radii,
                n_arc: params.n_arc || 4,
                outer_side: params.outer_side || 'left',
            }
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("build_section",
    "Build a section from structural elements (building blocks) instead of raw coordinates. Uses SectionBuilder: start point → add elements (lip, flange, web, stiffener, track_flange) with direction keywords. Much safer than raw coordinates.",
    {
        steps: z.array(z.object({
            type: z.enum(['start', 'lip', 'lip_inward', 'flange', 'web', 'stiffener', 'track_flange', 'go'])
                .describe("Element type. 'lip_inward' automatically points lip toward section center."),
            length: z.number().optional().describe("Length/width of element"),
            direction: z.string().optional().describe("Direction: up, down, left, right"),
            x: z.number().optional().describe("For 'start': x coordinate"),
            y: z.number().optional().describe("For 'start': y coordinate"),
            protrusion: z.number().optional().describe("For 'stiffener': horizontal protrusion"),
            height: z.number().optional().describe("For 'stiffener': vertical height"),
            width: z.number().optional().describe("For 'track_flange': flange width"),
            depth: z.number().optional().describe("For 'track_flange': C-depth"),
            lip_length: z.number().optional().describe("For 'track_flange': lip length"),
            flange_dir: z.string().optional().describe("For 'track_flange': flange direction"),
            lip_dir: z.string().optional().describe("For 'track_flange': lip direction"),
            dx: z.number().optional().describe("For 'go': delta x"),
            dy: z.number().optional().describe("For 'go': delta y"),
        })).describe("Build steps in order"),
        t: z.number().describe("Sheet thickness"),
        R_inner: z.number().optional().describe("Inside corner radius"),
        n_arc: z.number().optional().describe("Arc subdivisions per corner (default 4)"),
        outer_side: z.enum(['left', 'right']).optional().describe("Outer face side"),
        expected_center: z.array(z.number()).length(2).optional()
            .describe("Expected section centroid [x,y] for accurate lip_inward at path start. E.g. [0, 4] for H=8 section."),
    },
    async (params) => {
        // SectionBuilder steps → outer_corners → generate_template(custom)
        const r = await callBridgePost('/action', {
            action: 'generate_template',
            section_type: 'custom_builder',
            params: {
                steps: params.steps,
                t: params.t,
                R_inner: params.R_inner || 0,
                n_arc: params.n_arc || 4,
                outer_side: params.outer_side || 'left',
                expected_center: params.expected_center,
            }
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_section_preview",
    "Capture the current cross-section preview as a PNG image file. Returns the file path to a temporary PNG that can be read with the Read tool to visually verify the section shape.",
    {},
    async () => {
        const r = await callBridgePost('/action', { action: 'capture_section_preview' });
        if (r?.file_path) {
            return textResult(`Section preview saved to: ${r.file_path}\nUse the Read tool to view this image file.`);
        }
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("custom_section_guide",
    "Get step-by-step guide for modeling arbitrary cold-formed steel sections using set_custom_section. Includes lessons learned from sigma section modeling, path tracing rules, outer_side determination, and common pitfalls.",
    {
        section_type: z.string().optional().describe("Section type for specific guidance: 'sigma', 'rack', 'general'. Default 'general'."),
    },
    async ({ section_type }) => {
        const st = section_type || 'general';
        let guide = `
=== CUSTOM SECTION MODELING GUIDE ===

⭐ PREFERRED: Use build_section instead of set_custom_section!
build_section uses structural elements (lip, flange, web, stiffener) with
direction keywords (up/down/left/right). Much safer than raw coordinates.

Example (sigma section):
  build_section(steps=[
    {type:'start', x:2.75, y:7.125},
    {type:'lip', length:0.875, direction:'up'},
    {type:'flange', length:2.75, direction:'left'},
    {type:'web', length:0.875, direction:'down'},      // ← reversal!
    {type:'web', length:2.0, direction:'down'},
    {type:'stiffener', protrusion:0.5, height:2.25, direction:'right'},
    {type:'web', length:2.0, direction:'down'},
    {type:'flange', length:2.75, direction:'right'},
    {type:'web', length:0.875, direction:'down'},      // ← reversal!
    {type:'lip', length:0.5, direction:'left'},
  ], t=0.0451, R_inner=0.1875, outer_side='left')

STEP 1: STRUCTURAL ELEMENT IDENTIFICATION
Before any coordinate calculation, identify the structural elements:
- How many elements? (lips, flanges, webs, stiffeners)
- Which direction does each element extend? (horizontal/vertical/diagonal)
- Is the section symmetric? (mirror / point / none)
- Where are the free ends? (lip tips)

STEP 2: PATH TRACING (CRITICAL!)
Trace the path from one free end to the other. Mark direction at each corner:
- Does the path go straight, turn left, turn right, or U-TURN (reverse)?
- ⚠ U-TURNS ARE COMMON in track/sigma flanges! The path goes one direction then comes back.
- Example: sigma flange = lip_end → down(D) → left(B) → UP(D, reversal!) → web continues

STEP 3: OUTER CORNER COORDINATES
Convert the path to outer (outside face) coordinates:
- Use OUT-TO-OUT dimensions from the drawing
- Each corner is a sharp point (no radius)
- Path order: free_end_1 → ... → free_end_2
- ALWAYS ask: "what structural element does this dimension belong to?"

STEP 4: outer_side DETERMINATION
- Face the direction from P0 to P1
- If the OUTSIDE face of the sheet is on your LEFT → outer_side = 'left'
- If on your RIGHT → outer_side = 'right'
- Wrong outer_side = section offset in wrong direction (shape gets bigger or smaller)

STEP 5: CALL set_custom_section
- outer_corners: [[x0,y0], [x1,y1], ...]
- t: sheet thickness
- R_inner: inside corner radius (0 for sharp)
- outer_side: 'left' or 'right'

STEP 6: VISUAL VERIFICATION (MANDATORY!)
- Call get_section_preview() after EVERY set_custom_section
- Read the PNG file to visually verify shape
- Compare with the reference drawing
- If shape is wrong → go back to Step 2 and re-trace the path

STEP 7: PROPERTY VERIFICATION
- Call get_section_properties()
- Check: theta_p ≈ 0° for symmetric sections
- Check: A ≈ expected (within 10%)
- Check: Ixx, Sx reasonable for the section depth

=== COMMON PITFALLS ===

1. FLANGE U-TURN: Track/sigma flanges reverse direction. The path goes:
   down → left(flange) → UP(reversal) → down(web continues)
   NOT: down → left → down (this is wrong!)

2. DIMENSION IDENTITY: "0.875 in." could be:
   - Web depth? Flange width? Lip depth? C-shape depth?
   Always identify WHICH structural element the dimension describes.

3. SYMMETRY TYPE:
   - Mirror symmetry: top and bottom flanges face SAME direction
   - Point symmetry: top and bottom flanges face OPPOSITE directions (like Z)
   - "상하 대칭" usually means MIRROR symmetry

4. PATH CROSSING: If the path crosses itself, the coordinates are wrong.
   Call validate before analysis.

5. outer_side WRONG: If the generated shape looks "inflated" or "deflated",
   try switching outer_side from 'left' to 'right' or vice versa.
`;

        if (st === 'sigma') {
            guide += `
=== SIGMA (Σ) SECTION SPECIFIC GUIDE ===

Structure: Upper ∪-flange + Upper web + Stiffener + Lower web + Lower ∩-flange

The sigma section has TRACK-TYPE flanges (3-sided, not simple L-lips).
Each flange is a ∪ or ∩ shape with the path reversing direction.

Correct path (12 points):
P0: upper lip end (free end)
P1: lip top corner → up(D)
P2: flange top-left → left(B)
P3: flange bottom-left = web junction → down(D) ← PATH REVERSAL!
P4: stiffener top → down(web_seg)
P5: stiffener right-top → right(Ds)
P6: stiffener right-bottom → down(Ws)
P7: stiffener end → left(Ds), back to web
P8: lower flange top = web junction → down(web_seg)
P9: lower flange bottom-right → right(B) ← PATH REVERSAL at P10!
P10: lower lip corner → down(D)
P11: lower lip end (free end) → left(D_lip)

Key dimensions:
H = total depth = 2*D + 2*web_seg + Ws
B = flange width (web to lip end, horizontal)
D = flange C-depth (vertical, ∪/∩ depth)
D_lip = lip width (horizontal extension beyond flange)
Ds = stiffener horizontal protrusion
Ws = stiffener vertical height

Python factory: from engine.cfs_centerline import sigma_outer_corners
corners = sigma_outer_corners(H=8, B=2.25, D=0.875, D_lip=0.5, Ds=0.5, Ws=2.25)
`;
        }

        return textResult(guide);
    }
);

server.tool("set_material", "Set material properties",
    {
        E: z.number().describe("Young's modulus in ksi (default 29500)"),
        v: z.number().describe("Poisson's ratio (default 0.3)"),
        G: z.number().optional().describe("Shear modulus in ksi (auto-calculated if omitted)"),
    },
    async ({ E, v, G }) => {
        const Gval = G || E / (2 * (1 + v));
        const r = await callBridgePost('/action', {
            action: 'set_material', E, v, G: Gval
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_load_case", "Set load case and automatically apply stress distribution before analysis",
    {
        load_case: z.enum(['compression', 'bending_xx_pos', 'bending_xx_neg', 'bending_zz_pos', 'bending_zz_neg', 'custom'])
            .describe("compression=uniform axial, bending_xx_pos=strong-axis z+ compression, bending_xx_neg=strong-axis z- compression, bending_zz_pos=weak-axis x+ compression, bending_zz_neg=weak-axis x- compression, custom=P+Mxx+Mzz"),
        fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        P: z.number().optional().describe("Axial force for custom (kips)"),
        Mxx: z.number().optional().describe("Strong-axis moment for custom (kip-in)"),
        Mzz: z.number().optional().describe("Weak-axis moment for custom (kip-in)"),
    },
    async ({ load_case, fy, P, Mxx, Mzz }) => {
        const r = await callBridgePost('/action', {
            action: 'set_load_case', load_case, fy: fy || 35.53, P: P || 0, Mxx: Mxx || 0, Mzz: Mzz || 0
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_stress", "Set nodal stress distribution (low-level, prefer set_load_case)",
    {
        type: z.enum(['uniform_compression', 'pure_bending', 'custom']).describe("Stress type"),
        fy: z.number().optional().describe("Yield stress for reference ksi (default 35.53 = 245 MPa, SGC400)"),
        P: z.number().optional().describe("Axial force (for custom)"),
        Mxx: z.number().optional().describe("Moment about xx axis (for custom)"),
        Mzz: z.number().optional().describe("Moment about zz axis (for custom)"),
    },
    async (params) => {
        const r = await callBridgePost('/action', {
            action: 'set_stress', ...params
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_boundary_condition", "Set end boundary condition",
    {
        BC: z.enum(['S-S', 'C-C', 'S-C', 'C-F', 'C-G'])
            .describe("S-S=simply-simply, C-C=clamped-clamped, S-C=simply-clamped, C-F=clamped-free, C-G=clamped-guided"),
    },
    async ({ BC }) => {
        const r = await callBridgePost('/action', { action: 'set_bc', BC });
        return textResult(`Boundary condition set to ${BC}`);
    }
);

server.tool("set_lengths", "Set analysis half-wavelength range",
    {
        min: z.number().describe("Minimum half-wavelength in inches"),
        max: z.number().describe("Maximum half-wavelength in inches"),
        n: z.number().optional().describe("Number of points (default 50)"),
    },
    async ({ min, max, n }) => {
        const r = await callBridgePost('/action', {
            action: 'set_lengths', min, max, n: n || 60
        });
        return textResult(`Lengths set: ${n || 60} points from ${min} to ${max}`);
    }
);

// ============================================================
// 3. ANALYSIS (3 tools)
// ============================================================
server.tool("run_analysis", "Run FSM buckling analysis with current settings",
    { neigs: z.number().optional().describe("Number of eigenvalues (default 10)") },
    async ({ neigs }) => {
        const r = await callBridgePost('/action', {
            action: 'run_analysis', neigs: neigs || 10
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("run_signature_curve", "Run signature curve analysis (S-S, 100 lengths, automatic)",
    {},
    async () => {
        const r = await callBridgePost('/action', { action: 'signature_ss' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("classify_modes", "Classify buckling modes into G/D/L/O using cFSM",
    {},
    async () => {
        const r = await callBridgePost('/action', { action: 'classify' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// 4. NODE/ELEMENT EDITING (11 tools)
// ============================================================
server.tool("get_nodes", "Get all node coordinates and stresses", {},
    async () => {
        const r = await callBridgePost('/action', { action: 'get_nodes' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_elements", "Get all element connectivity and thickness", {},
    async () => {
        const r = await callBridgePost('/action', { action: 'get_elements' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_node_stress", "Set stress value for specific nodes",
    {
        node_ids: z.array(z.number()).describe("Node IDs (1-based)"),
        stress: z.number().describe("Stress value"),
    },
    async ({ node_ids, stress }) => {
        const r = await callBridgePost('/action', {
            action: 'set_node_stress', node_ids, stress
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_nodes", "Replace entire node array. Each row: [node#, x, z, dofx, dofz, dofy, dofrot, stress]",
    {
        nodes: z.array(z.array(z.number())).describe("Full node array (1-based node#, 8 columns)"),
    },
    async ({ nodes }) => {
        const r = await callBridgePost('/action', { action: 'set_nodes', nodes });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_elements", "Replace entire element array. Each row: [elem#, nodei, nodej, thickness, matnum]",
    {
        elements: z.array(z.array(z.number())).describe("Full element array (1-based, 5 columns)"),
    },
    async ({ elements }) => {
        const r = await callBridgePost('/action', { action: 'set_elements', elements });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("add_node", "Add a single node to the model",
    {
        x: z.number().describe("X coordinate"),
        z: z.number().describe("Z coordinate"),
        stress: z.number().optional().describe("Stress value (default 0)"),
    },
    async ({ x, z: zc, stress }) => {
        const r = await callBridgePost('/action', {
            action: 'add_node', x, z: zc, stress: stress ?? 0
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("add_element", "Add a single element connecting two nodes",
    {
        nodei: z.number().describe("Start node ID (1-based)"),
        nodej: z.number().describe("End node ID (1-based)"),
        thickness: z.number().describe("Element thickness"),
    },
    async ({ nodei, nodej, thickness }) => {
        const r = await callBridgePost('/action', {
            action: 'add_element', nodei, nodej, thickness
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("modify_node", "Modify coordinates and/or stress of an existing node",
    {
        node_id: z.number().describe("Node ID (1-based)"),
        x: z.number().optional().describe("New X coordinate"),
        z: z.number().optional().describe("New Z coordinate"),
        stress: z.number().optional().describe("New stress value"),
    },
    async ({ node_id, x, z: zc, stress }) => {
        const r = await callBridgePost('/action', {
            action: 'modify_node', node_id, x, z: zc, stress
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("delete_node", "Delete a node and its connected elements",
    {
        node_id: z.number().describe("Node ID to delete (1-based)"),
    },
    async ({ node_id }) => {
        const r = await callBridgePost('/action', { action: 'delete_node', node_id });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("modify_element", "Modify thickness or connectivity of an existing element",
    {
        elem_id: z.number().describe("Element ID (1-based)"),
        thickness: z.number().optional().describe("New thickness"),
        nodei: z.number().optional().describe("New start node ID"),
        nodej: z.number().optional().describe("New end node ID"),
    },
    async ({ elem_id, thickness, nodei, nodej }) => {
        const r = await callBridgePost('/action', {
            action: 'modify_element', elem_id, thickness, nodei, nodej
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("delete_element", "Delete an element",
    {
        elem_id: z.number().describe("Element ID to delete (1-based)"),
    },
    async ({ elem_id }) => {
        const r = await callBridgePost('/action', { action: 'delete_element', elem_id });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("double_mesh", "Double mesh refinement (split each element into two)", {},
    async () => {
        const r = await callBridgePost('/action', { action: 'doubler' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// 5. ADVANCED (4 tools)
// ============================================================
server.tool("get_cutwp", "Calculate warping properties (J, Cw, shear center, warping function)", {},
    async () => {
        const r = await callBridgePost('/action', { action: 'cutwp' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("run_plastic_surface", "Generate P-Mxx-Mzz plastic interaction surface",
    { fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)") },
    async ({ fy }) => {
        const r = await callBridgePost('/action', { action: 'plastic', fy: fy || 35.53 });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("run_vibration", "Run free vibration analysis",
    { rho: z.number().optional().describe("Material density (default 1.0)") },
    async ({ rho }) => {
        const r = await callBridgePost('/action', { action: 'vibration', rho: rho || 1.0 });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("save_project", "Save current model to .stcfsd JSON file",
    { filepath: z.string().describe("File path to save") },
    async ({ filepath }) => {
        const r = await callBridgePost('/action', { action: 'save_project', filepath });
        return textResult(`Project saved to ${filepath}`);
    }
);

// ============================================================
// 6. CONSTRAINTS & SPRINGS (3 tools)
// ============================================================
server.tool("set_springs", "Add spring restraints to model",
    {
        springs: z.array(z.array(z.number())).describe(
            "Spring data rows: [[spring#, nodei, nodej, ku, kv, kw, kq, orient_flag, discrete, ys], ...]"
        ),
    },
    async ({ springs }) => {
        const r = await callBridgePost('/action', { action: 'set_springs', springs });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_constraints", "Set master-slave DOF constraints",
    {
        constraints: z.array(z.array(z.number())).describe(
            "Constraint rows: [[node_e, dof_e, coeff, node_k, dof_k], ...] where dof: 1=x,2=z,3=y,4=theta"
        ),
    },
    async ({ constraints }) => {
        const r = await callBridgePost('/action', { action: 'set_constraints', constraints });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_gbtcon", "Set cFSM/GBT classification options",
    {
        ospace: z.number().optional().describe("O-space: 1=ST basis, 2=K null, 3=Kg null, 4=vector null (default 1)"),
        norm: z.number().optional().describe("Normalization: 0=none, 1=vector, 2=strain energy, 3=work (default 0)"),
        couple: z.number().optional().describe("Coupling: 1=uncoupled (block diagonal), 2=coupled (default 1)"),
        orth: z.number().optional().describe("Orthogonalization: 1=natural, 2=modal axial, 3=modal load-dependent (default 1)"),
    },
    async (params) => {
        const r = await callBridgePost('/action', { action: 'set_gbtcon', ...params });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_energy_recovery", "Calculate element-wise strain energy (membrane vs bending) for a buckling mode",
    {
        length_index: z.number().optional().describe("Index of half-wavelength in analysis results (default 0)"),
        mode_index: z.number().optional().describe("Index of buckling mode (default 0, first mode)"),
    },
    async ({ length_index, mode_index }) => {
        const r = await callBridgePost('/action', {
            action: 'energy_recovery',
            length_index: length_index ?? 0,
            mode_index: mode_index ?? 0,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// AISI S100-16 설계 도구
// ============================================================

server.tool("aisi_design_compression", "AISI S100-16 DSM compression member design (Chapters E2, E3.2, E4)",
    {
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 58.02 = 400 MPa, SGC400)"),
        KxLx: z.number().describe("Effective length about x-axis (in)"),
        KyLy: z.number().describe("Effective length about y-axis (in)"),
        KtLt: z.number().optional().describe("Effective torsional length (in, default=KyLy)"),
        Pu: z.number().optional().describe("Required axial strength (kips)"),
    },
    async ({ design_method, Fy, Fu, KxLx, KyLy, KtLt, Pu }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'compression',
            design_method: design_method || 'LRFD',
            Fy: Fy || 35.53, Fu: Fu || 58.02,
            KxLx, KyLy, KtLt: KtLt ?? KyLy,
            Pu: Pu || 0,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_flexure", "AISI S100-16 DSM flexural member design (Chapters F2, F3.2, F4, I6.2.1)",
    {
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 58.02 = 400 MPa, SGC400)"),
        Lb: z.number().describe("Unbraced length for LTB (in)"),
        Cb: z.number().optional().describe("Moment gradient factor (default 1.0)"),
        Mu: z.number().optional().describe("Required flexural strength (kip-in)"),
        R_uplift: z.number().optional().describe("Uplift reduction factor R per §I6.2.1 for through-fastened panels (e.g. 0.60 for C, 0.70 for Z)"),
    },
    async ({ design_method, Fy, Fu, Lb, Cb, Mu, R_uplift }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'flexure',
            design_method: design_method || 'LRFD',
            Fy: Fy || 35.53, Fu: Fu || 58.02,
            Lb, Cb: Cb || 1.0,
            Mu: Mu || 0,
            ...(R_uplift != null && { R_uplift }),
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_combined", "AISI S100-16 combined axial+bending design check (Chapter H1.2, C1 amplification)",
    {
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 58.02 = 400 MPa, SGC400)"),
        KxLx: z.number().describe("Effective length x-axis (in)"),
        KyLy: z.number().describe("Effective length y-axis (in)"),
        KtLt: z.number().optional().describe("Effective torsional length (in)"),
        Lb: z.number().describe("Unbraced length for LTB (in)"),
        Cb: z.number().optional().describe("Moment gradient factor (default 1.0)"),
        Cmx: z.number().optional().describe("Equivalent moment factor x-axis §C1 (default 0.85)"),
        Cmy: z.number().optional().describe("Equivalent moment factor y-axis §C1 (default 0.85)"),
        Pu: z.number().describe("Required axial strength (kips)"),
        Mux: z.number().describe("Required moment about x-axis (kip-in)"),
        Muy: z.number().optional().describe("Required moment about y-axis (kip-in)"),
        Vu: z.number().optional().describe("Required shear (kips)"),
    },
    async ({ design_method, Fy, Fu, KxLx, KyLy, KtLt, Lb, Cb, Cmx, Cmy, Pu, Mux, Muy, Vu }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'combined',
            design_method: design_method || 'LRFD',
            Fy: Fy || 35.53, Fu: Fu || 58.02,
            KxLx, KyLy, KtLt: KtLt ?? KyLy,
            Lb, Cb: Cb || 1.0,
            Cmx: Cmx || 0.85, Cmy: Cmy || 0.85,
            Pu, Mux, Muy: Muy || 0, Vu: Vu || 0,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_tension", "AISI S100-16 tension member design (Chapters D2, D3)",
    {
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        Fu: z.number().optional().describe("Ultimate stress ksi (default 58.02 = 400 MPa, SGC400)"),
        Tu: z.number().optional().describe("Required tensile force kips"),
        An: z.number().optional().describe("Net section area in² (default = gross area)"),
    },
    async ({ design_method, Fy, Fu, Tu, An }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'tension',
            design_method: design_method || 'LRFD',
            Fy: Fy || 35.53, Fu: Fu || 58.02,
            Tu: Tu || 0, An,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_connection", "AISI S100-16 connection design (Chapter J) — bolt, screw, fillet/arc-spot/groove weld",
    {
        connection_type: z.enum(["bolt", "screw", "fillet_weld", "arc_spot", "arc_seam", "groove", "paf"]).describe("Connection type"),
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().describe("Yield stress of connected sheet ksi"),
        Fu: z.number().describe("Ultimate stress of connected sheet ksi"),
        t1: z.number().describe("Thickness of sheet 1 (in)"),
        t2: z.number().optional().describe("Thickness of sheet 2 (in, default = t1)"),
        d: z.number().optional().describe("Bolt/screw diameter (in)"),
        Fub: z.number().optional().describe("Bolt/screw ultimate strength ksi"),
        n: z.number().optional().describe("Number of fasteners (default 1)"),
        e: z.number().optional().describe("Edge distance (in)"),
        s: z.number().optional().describe("Fastener spacing (in)"),
        weld_length: z.number().optional().describe("Weld length (in, fillet/groove weld)"),
        weld_size: z.number().optional().describe("Weld leg size (in, fillet weld)"),
        da: z.number().optional().describe("Arc spot/seam weld visible diameter (in)"),
        groove_type: z.enum(["complete", "partial"]).optional().describe("Groove weld type (default complete)"),
        Fxx: z.number().optional().describe("Weld electrode strength ksi (default 60)"),
        Fuf: z.number().optional().describe("PAF pin ultimate strength ksi (default 60)"),
        Pu: z.number().optional().describe("Required force kips"),
    },
    async ({ connection_type, design_method, Fy, Fu, t1, t2, d, Fub, n, e, s, weld_length, weld_size, da, groove_type, Fxx, Fuf, Pu }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'connection',
            connection_type,
            design_method: design_method || 'LRFD',
            Fy, Fu, t1, t2: t2 || t1,
            d, Fub, n: n || 1, e, s,
            weld_length, weld_size, da,
            groove_type: groove_type || 'complete',
            Fxx: Fxx || 60, Fuf: Fuf || 60,
            Pu: Pu || 0,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("steel_grades", "List available CFS steel grades (KS SGC490/570, ASTM A653/A792/A1003) with Fy/Fu values",
    {},
    async () => {
        const r = await callBridgePost('/action', { action: 'steel_grades' });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_guide", "Get AISI S100-16 design workflow guide for AI — returns steps, formulas, examples",
    {
        query_type: z.enum(["column", "beam", "beam_column", "tension", "connection"]).describe("Design type"),
    },
    async ({ query_type }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_guide',
            query_type,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("get_web_crippling", "AISI S100-16 §G5 web crippling strength calculation",
    {
        h: z.number().describe("Web flat width (in)"),
        t: z.number().describe("Web thickness (in)"),
        R: z.number().describe("Inside bend radius (in)"),
        N: z.number().describe("Bearing length (in)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        theta: z.number().optional().describe("Angle between web and bearing surface deg (default 90)"),
        support: z.enum(["EOF", "IOF", "ETF", "ITF"]).optional().describe("Support condition (default EOF)"),
        fastened: z.enum(["fastened", "unfastened"]).optional().describe("Fastened to support? (default fastened)"),
    },
    async ({ h, t, R, N, Fy, theta, support, fastened }) => {
        const r = await callBridgePost('/action', {
            action: 'web_crippling',
            h, t, R, N,
            Fy: Fy || 35.53,
            theta: theta || 90,
            support: support || 'EOF',
            fastened: fastened || 'fastened',
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("analyze_loads", "Analyze service loads → structural analysis → required strengths for CFS members (purlins, joists, studs)",
    {
        member_app: z.enum(["roof-purlin", "floor-joist", "wall-girt", "wall-stud"]).describe("Application type"),
        span_type: z.enum(["simple", "cantilever", "cont-2", "cont-3", "cont-4", "cont-5", "cont-n"]).describe("Span configuration"),
        span_ft: z.number().describe("Span length in feet (equal spans default)"),
        spans_ft: z.array(z.number()).optional().describe("Per-span lengths in feet for unequal spans (overrides span_ft)"),
        supports: z.array(z.string()).optional().describe("Support conditions per support: 'P'=Pin, 'R'=Roller, 'F'=Fixed (default all 'P')"),
        loads: z.object({
            D: z.number().optional().describe("Dead load PLF"),
            L: z.number().optional().describe("Floor live load PLF"),
            Lr: z.number().optional().describe("Roof live load PLF"),
            S: z.number().optional().describe("Snow load PLF"),
            W: z.number().optional().describe("Wind load PLF (negative=uplift)"),
        }).describe("Service loads in PLF"),
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("Design method (default LRFD)"),
        spacing_ft: z.number().optional().describe("Member spacing ft (default 5)"),
        laps: z.object({
            left_ft: z.number().optional(),
            right_ft: z.number().optional(),
        }).optional().describe("Lap lengths at first interior support"),
        laps_per_support: z.array(z.object({
            left_ft: z.number().optional(),
            right_ft: z.number().optional(),
        })).optional().describe("Per-support lap lengths array"),
        deck: z.object({
            type: z.enum(["through-fastened", "standing-seam", "none"]).optional(),
            t_panel: z.number().optional().describe("Panel thickness in."),
            fastener_spacing: z.number().optional().describe("Fastener spacing in. (default 12)"),
            kphi_override: z.number().optional().describe("Override rotational stiffness kip-in/rad/in"),
        }).optional().describe("Deck/panel properties"),
    },
    async ({ member_app, span_type, span_ft, spans_ft, supports, loads, design_method, spacing_ft, laps, laps_per_support, deck }) => {
        const r = await callBridgePost('/action', {
            action: 'analyze_loads',
            member_app, span_type, span_ft, spans_ft, supports,
            loads: loads || {},
            design_method: design_method || 'LRFD',
            spacing_ft: spacing_ft || 5.0,
            laps, laps_per_support, deck,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("calc_deck_stiffness", "Calculate deck/panel rotational (kφ) and lateral (kx) stiffness for CFS design",
    {
        t_panel: z.number().describe("Panel thickness (in)"),
        t_purlin: z.number().describe("Purlin thickness (in)"),
        fastener_spacing: z.number().optional().describe("Fastener spacing in. (default 12)"),
        flange_width: z.number().optional().describe("Flange width in. (default 2.5)"),
    },
    async ({ t_panel, t_purlin, fastener_spacing, flange_width }) => {
        const r = await callBridgePost('/action', {
            action: 'calc_deck_stiffness',
            t_panel, t_purlin,
            fastener_spacing: fastener_spacing || 12,
            flange_width: flange_width || 2.5,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("design_purlin", "Complete purlin design: analyze loads → dual StCFSD (positive/negative moment with deck springs) → DSM design",
    {
        member_app: z.enum(["roof-purlin", "floor-joist", "wall-girt", "wall-stud"]).describe("Application type"),
        span_type: z.string().describe("Span type: simple, cantilever, cont-2, cont-3, cont-4, cont-N"),
        span_ft: z.number().describe("Span length in feet"),
        loads: z.object({
            D: z.number().optional(),
            L: z.number().optional(),
            Lr: z.number().optional(),
            S: z.number().optional(),
            W: z.number().optional(),
        }).describe("Service loads in PLF"),
        design_method: z.enum(["ASD", "LRFD"]).optional(),
        Fy: z.number().optional().describe("Yield stress ksi"),
        spacing_ft: z.number().optional(),
        laps: z.object({
            left_ft: z.number().optional(),
            right_ft: z.number().optional(),
        }).optional(),
        deck: z.object({
            type: z.enum(["through-fastened", "standing-seam", "none"]).optional(),
            t_panel: z.number().optional(),
            fastener_spacing: z.number().optional(),
            kphi_override: z.number().optional(),
        }).optional(),
    },
    async (params) => {
        const r = await callBridgePost('/action', {
            action: 'design_purlin', ...params,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// Report Generation
// ============================================================
server.tool("generate_report", "Generate a comprehensive design report with all calculation details — section, buckling, loads, DSM design, and summary",
    {
        member_type: z.enum(["compression", "flexure", "combined", "tension"]).optional().describe("Member type for design calculation"),
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("Design method (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 58.02 = 400 MPa, SGC400)"),
        Mu: z.number().optional().describe("Required flexural strength kip-in"),
        Pu: z.number().optional().describe("Required axial strength kips"),
        Lb: z.number().optional().describe("Unbraced length in"),
        Cb: z.number().optional().describe("Moment gradient factor"),
        KxLx: z.number().optional().describe("Effective length x-axis in"),
        KyLy: z.number().optional().describe("Effective length y-axis in"),
        member_app: z.string().optional().describe("Member application for load analysis"),
        span_type: z.string().optional().describe("Span type for load analysis"),
        span_ft: z.number().optional().describe("Span length ft"),
        spacing_ft: z.number().optional().describe("Tributary width ft"),
        loads: z.object({
            D: z.number().optional(),
            L: z.number().optional(),
            Lr: z.number().optional(),
            S: z.number().optional(),
            W: z.number().optional(),
        }).optional().describe("Service loads in PLF"),
    },
    async (params) => {
        const r = await callBridgePost('/action', {
            action: 'generate_report', ...params,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("validate_design", "Validate current design state — checks section geometry, material, DSM limits, analysis status, and returns pass/warn/fail for each item per AISI S100-16",
    {
        Fy: z.number().optional().describe("Yield stress ksi (default 35.53 = 245 MPa, SGC400)"),
    },
    async ({ Fy }) => {
        const r = await callBridgePost('/action', {
            action: 'validate_design', Fy: Fy || 35.53,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// CONNECTION DESIGN (3 tools)
// ============================================================
server.tool("design_lap_connection",
    "Design lap splice connection — calculate required fasteners (§J3, §J4, §I6.2.1(g))",
    {
        d: z.number().describe("Member depth in inches"),
        t: z.number().describe("Member thickness in inches"),
        Fy: z.number().optional().describe("Yield stress ksi"),
        Fu: z.number().optional().describe("Tensile stress ksi"),
        lap_left_in: z.number().describe("Left lap length in inches"),
        lap_right_in: z.number().describe("Right lap length in inches"),
        Mu_support: z.number().optional().describe("Support moment kip-in"),
        Vu_support: z.number().optional().describe("Support shear kips"),
        fastener_type: z.enum(['screw', 'bolt']).optional().describe("Fastener type (default screw)"),
        fastener_dia: z.number().optional().describe("Fastener diameter in inches"),
        n_rows: z.number().optional().describe("Number of fastener rows (default 2)"),
    },
    async (params) => {
        const r = await callBridgePost('/action', { action: 'lap_connection', ...params });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("check_lap_length",
    "Check if lap length meets §I6.2.1(g) requirement: Lap ≥ 1.5d",
    {
        d: z.number().describe("Member depth in inches"),
        lap_left: z.number().describe("Left lap length in inches"),
        lap_right: z.number().describe("Right lap length in inches"),
    },
    async ({ d, lap_left, lap_right }) => {
        const r = await callBridgePost('/action', { action: 'check_lap_length', d, lap_left, lap_right });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("design_connection",
    "Design a single connection per AISI Chapter J (7 types: bolt, screw, PAF, fillet/arc_spot/arc_seam/groove weld)",
    {
        connection_type: z.enum(['bolt', 'screw', 'paf', 'fillet_weld', 'arc_spot', 'arc_seam', 'groove']).describe("Connection type"),
        t1: z.number().describe("Thickness of sheet 1 in inches"),
        t2: z.number().optional().describe("Thickness of sheet 2 in inches"),
        d: z.number().optional().describe("Fastener diameter or weld size in inches"),
        Fy: z.number().optional().describe("Yield strength ksi"),
        Fu: z.number().optional().describe("Tensile strength ksi"),
        n: z.number().optional().describe("Number of fasteners"),
        Pu: z.number().optional().describe("Required strength kips (0=capacity only)"),
        weld_length: z.number().optional().describe("Weld length in inches"),
        weld_size: z.number().optional().describe("Weld size in inches"),
        groove_type: z.enum(['complete', 'partial']).optional().describe("Groove weld type"),
        Fub: z.number().optional().describe("Bolt tensile strength ksi"),
    },
    async (params) => {
        const r = await callBridgePost('/action', { action: 'design_connection', ...params });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("check_shear_lag",
    "Calculate shear lag coefficient U and effective net area (§D3)",
    {
        Ag: z.number().describe("Gross area in²"),
        An_net: z.number().describe("Net area in² (holes deducted)"),
        x_bar: z.number().describe("Distance from connection plane to centroid of unconnected elements, in inches"),
        L_conn: z.number().describe("Connection length in inches"),
        Fu: z.number().describe("Tensile strength ksi"),
        Fy: z.number().describe("Yield strength ksi"),
    },
    async (params) => {
        const r = await callBridgePost('/action', { action: 'shear_lag', ...params });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("check_block_shear",
    "Calculate block shear rupture strength (§J7)",
    {
        Agv: z.number().describe("Gross shear area in²"),
        Anv: z.number().describe("Net shear area in²"),
        Ant: z.number().describe("Net tension area in²"),
        Fy: z.number().describe("Yield strength ksi"),
        Fu: z.number().describe("Tensile strength ksi"),
    },
    async (params) => {
        const r = await callBridgePost('/action', { action: 'block_shear', ...params });
        return textResult(JSON.stringify(r, null, 2));
    }
);

// ============================================================
// 서버 시작
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(console.error);
