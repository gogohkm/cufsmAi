/**
 * CUFSM MCP Server — AI가 단면 해석을 제어하는 도구 모음
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
const BRIDGE_PORT = parseInt(process.env.CUFSM_MCP_PORT || String(DEFAULT_PORT));

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
    name: "cufsm-section-designer",
    version: "1.0.0",
}, {
    instructions: `CUFSM - Cold-Formed Steel Section Buckling Analysis Tool.

You can design cross-sections, run finite strip buckling analysis, and extract DSM design values (Pcrl, Pcrd, Mcrl, Mcrd).

Workflow:
1. get_status → check current state
2. set_section_template → generate a section (lippedc, lippedz, hat, rhs, chs, angle, isect, tee)
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
    { fy: z.number().optional().describe("Yield stress (default 50)") },
    async ({ fy }) => {
        const r = await callBridgePost('/action', { action: 'get_dsm', fy: fy || 50 });
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
    "Generate a parametric section. Types: lippedc, lippedz, hat, rhs, chs, angle, isect, tee",
    {
        type: z.enum(['lippedc', 'lippedz', 'track', 'hat', 'rhs', 'chs', 'angle', 'isect', 'tee'])
            .describe("Section type"),
        H: z.number().describe("Height (web height, out-to-out)"),
        B: z.number().describe("Width (flange width, out-to-out)"),
        D: z.number().optional().describe("Lip length or secondary dimension"),
        t: z.number().describe("Thickness"),
        r: z.number().optional().describe("Corner radius (default 0)"),
    },
    async (params) => {
        const r = await callBridgePost('/action', {
            action: 'generate_template',
            section_type: params.type,
            params: { H: params.H, B: params.B, D: params.D || 1, t: params.t, r: params.r || 0 }
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_material", "Set material properties",
    {
        E: z.number().describe("Young's modulus"),
        v: z.number().describe("Poisson's ratio"),
        G: z.number().optional().describe("Shear modulus (auto-calculated if omitted)"),
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
        fy: z.number().optional().describe("Yield stress (default 50)"),
        P: z.number().optional().describe("Axial force for custom (kips)"),
        Mxx: z.number().optional().describe("Strong-axis moment for custom (kip-in)"),
        Mzz: z.number().optional().describe("Weak-axis moment for custom (kip-in)"),
    },
    async ({ load_case, fy, P, Mxx, Mzz }) => {
        const r = await callBridgePost('/action', {
            action: 'set_load_case', load_case, fy: fy || 50, P: P || 0, Mxx: Mxx || 0, Mzz: Mzz || 0
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("set_stress", "Set nodal stress distribution (low-level, prefer set_load_case)",
    {
        type: z.enum(['uniform_compression', 'pure_bending', 'custom']).describe("Stress type"),
        fy: z.number().optional().describe("Yield stress for reference (default 50)"),
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
        min: z.number().describe("Minimum half-wavelength"),
        max: z.number().describe("Maximum half-wavelength"),
        n: z.number().optional().describe("Number of points (default 50)"),
    },
    async ({ min, max, n }) => {
        const r = await callBridgePost('/action', {
            action: 'set_lengths', min, max, n: n || 50
        });
        return textResult(`Lengths set: ${n || 50} points from ${min} to ${max}`);
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
    { fy: z.number().optional().describe("Yield stress (default 50)") },
    async ({ fy }) => {
        const r = await callBridgePost('/action', { action: 'plastic', fy: fy || 50 });
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

server.tool("save_project", "Save current model to .cufsm JSON file",
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
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 65)"),
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
            Fy: Fy || 50, Fu: Fu || 65,
            KxLx, KyLy, KtLt: KtLt ?? KyLy,
            Pu: Pu || 0,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_flexure", "AISI S100-16 DSM flexural member design (Chapters F2, F3.2, F4)",
    {
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 65)"),
        Lb: z.number().describe("Unbraced length for LTB (in)"),
        Cb: z.number().optional().describe("Moment gradient factor (default 1.0)"),
        Mu: z.number().optional().describe("Required flexural strength (kip-in)"),
    },
    async ({ design_method, Fy, Fu, Lb, Cb, Mu }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'flexure',
            design_method: design_method || 'LRFD',
            Fy: Fy || 50, Fu: Fu || 65,
            Lb, Cb: Cb || 1.0,
            Mu: Mu || 0,
        });
        return textResult(JSON.stringify(r, null, 2));
    }
);

server.tool("aisi_design_combined", "AISI S100-16 combined axial+bending design check (Chapter H1.2, C1 amplification)",
    {
        design_method: z.enum(["ASD", "LRFD"]).optional().describe("ASD or LRFD (default LRFD)"),
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 65)"),
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
            Fy: Fy || 50, Fu: Fu || 65,
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
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
        Fu: z.number().optional().describe("Ultimate stress ksi (default 65)"),
        Tu: z.number().optional().describe("Required tensile force kips"),
        An: z.number().optional().describe("Net section area in² (default = gross area)"),
    },
    async ({ design_method, Fy, Fu, Tu, An }) => {
        const r = await callBridgePost('/action', {
            action: 'aisi_design',
            member_type: 'tension',
            design_method: design_method || 'LRFD',
            Fy: Fy || 50, Fu: Fu || 65,
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

server.tool("steel_grades", "List available CFS steel grades (ASTM A653, A792, A1003) with Fy/Fu values",
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
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
        theta: z.number().optional().describe("Angle between web and bearing surface deg (default 90)"),
        support: z.enum(["EOF", "IOF", "ETF", "ITF"]).optional().describe("Support condition (default EOF)"),
        fastened: z.enum(["fastened", "unfastened"]).optional().describe("Fastened to support? (default fastened)"),
    },
    async ({ h, t, R, N, Fy, theta, support, fastened }) => {
        const r = await callBridgePost('/action', {
            action: 'web_crippling',
            h, t, R, N,
            Fy: Fy || 50,
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
        span_type: z.enum(["simple", "cont-2", "cont-3", "cont-4", "cont-n"]).describe("Span configuration"),
        span_ft: z.number().describe("Span length in feet"),
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
        }).optional().describe("Lap lengths at supports"),
        deck: z.object({
            type: z.enum(["through-fastened", "standing-seam", "none"]).optional(),
            t_panel: z.number().optional().describe("Panel thickness in."),
            fastener_spacing: z.number().optional().describe("Fastener spacing in. (default 12)"),
            kphi_override: z.number().optional().describe("Override rotational stiffness kip-in/rad/in"),
        }).optional().describe("Deck/panel properties"),
    },
    async ({ member_app, span_type, span_ft, loads, design_method, spacing_ft, laps, deck }) => {
        const r = await callBridgePost('/action', {
            action: 'analyze_loads',
            member_app, span_type, span_ft,
            loads: loads || {},
            design_method: design_method || 'LRFD',
            spacing_ft: spacing_ft || 5.0,
            laps, deck,
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

server.tool("design_purlin", "Complete purlin design: analyze loads → dual CUFSM (positive/negative moment with deck springs) → DSM design",
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
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
        Fu: z.number().optional().describe("Tensile stress ksi (default 65)"),
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
        Fy: z.number().optional().describe("Yield stress ksi (default 50)"),
    },
    async ({ Fy }) => {
        const r = await callBridgePost('/action', {
            action: 'validate_design', Fy: Fy || 50,
        });
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
