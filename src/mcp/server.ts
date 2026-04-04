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
        type: z.enum(['lippedc', 'lippedz', 'hat', 'rhs', 'chs', 'angle', 'isect', 'tee'])
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
        load_case: z.enum(['compression', 'bending_xx', 'bending_zz', 'custom'])
            .describe("compression=uniform axial, bending_xx=strong-axis bending, bending_zz=weak-axis bending, custom=P+Mxx+Mzz combination"),
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
// 서버 시작
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(console.error);
