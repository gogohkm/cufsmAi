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

server.tool("set_stress", "Set nodal stress distribution",
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
// 4. NODE/ELEMENT EDITING (4 tools)
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
// 서버 시작
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(console.error);
