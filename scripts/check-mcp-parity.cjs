#!/usr/bin/env node
// F04: 소스 정의 vs 빌드 번들의 MCP 도구 패리티 검사.
//
// - src/mcp/*.ts를 임시 디렉토리에 transpile해 소스 서버를 기동하고,
//   media/mcp-server.js 번들 서버와 initialize/listTools를 대조한다.
// - 번들 serverInfo.version이 package.json 버전 + 현재 git 해시와
//   일치하는지 확인한다 (배포본-소스 어긋남 방지).
// - 불일치 시 exit 1. listTools는 브리지가 필요 없어 격리 실행된다.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.parity-tmp');
const BUNDLE = path.join(ROOT, 'media', 'mcp-server.js');

function gitShort() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

async function probe(label, script) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [script],
        env: { ...process.env, STCFSD_MCP_PORT: '1' },
        stderr: 'pipe',
    });
    const client = new Client({ name: 'stcfsd-parity-check', version: '1.0.0' });
    try {
        await client.connect(transport);
        const version = client.getServerVersion();
        const list = await client.listTools();
        return { label, version, tools: list.tools };
    } finally {
        try { await client.close(); } catch { /* ignore */ }
    }
}

function stable(value) {
    return JSON.stringify(value);
}

async function main() {
    if (!fs.existsSync(BUNDLE)) {
        console.error(`Bundle not found: ${BUNDLE} (run 'npm run build:mcp' first)`);
        process.exitCode = 1;
        return;
    }
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    try {
        execSync(
            `${JSON.stringify(path.join(ROOT, 'node_modules', '.bin', 'tsc'))} ` +
            `src/mcp/server.ts src/mcp/siUnits.ts --outDir ${JSON.stringify(TMP)} ` +
            `--module commonjs --target es2022 --moduleResolution node ` +
            `--esModuleInterop --skipLibCheck --sourceMap false --declaration false`,
            { cwd: ROOT, stdio: 'inherit' },
        );
        const [bundle, source] = await Promise.all([
            probe('bundle', BUNDLE),
            probe('source', path.join(TMP, 'server.js')),
        ]);
        const failures = [];

        // 1. 번들 버전 = package 버전 + 현재 git 해시
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const hash = gitShort();
        if (hash) {
            const expected = `${pkg.version}+${hash}`;
            if (bundle.version?.version !== expected) {
                failures.push(`bundle version ${bundle.version?.version} != expected ${expected}`);
            }
        } else {
            console.warn('git unavailable: skipping bundle version check');
        }
        if (bundle.version?.name !== 'stcfsd-section-designer') {
            failures.push(`bundle name ${bundle.version?.name} unexpected`);
        }

        // 2. 도구명 집합 일치
        const bNames = bundle.tools.map((t) => t.name).sort();
        const sNames = source.tools.map((t) => t.name).sort();
        const onlyBundle = bNames.filter((n) => !sNames.includes(n));
        const onlySource = sNames.filter((n) => !bNames.includes(n));
        if (onlyBundle.length > 0) { failures.push(`only in bundle: ${onlyBundle.join(', ')}`); }
        if (onlySource.length > 0) { failures.push(`only in source: ${onlySource.join(', ')}`); }

        // 3. 도구별 inputSchema 일치
        const sByName = Object.fromEntries(source.tools.map((t) => [t.name, t]));
        for (const b of bundle.tools) {
            const s = sByName[b.name];
            if (!s) { continue; }
            if (stable(b.inputSchema) !== stable(s.inputSchema)) {
                failures.push(`schema differs: ${b.name}`);
            }
            if (b.description !== s.description) {
                failures.push(`description differs: ${b.name}`);
            }
        }

        console.log(`bundle: ${bundle.version?.name} ${bundle.version?.version} (${bNames.length} tools)`);
        console.log(`source: ${source.version?.name} ${source.version?.version} (${sNames.length} tools)`);
        if (failures.length > 0) {
            console.error('MCP parity FAILED:');
            for (const f of failures) { console.error(` - ${f}`); }
            process.exitCode = 1;
        } else {
            console.log('MCP parity OK: deployed bundle matches source definitions');
        }
    } finally {
        fs.rmSync(TMP, { recursive: true, force: true });
    }
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
