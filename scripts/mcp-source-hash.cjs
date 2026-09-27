// R3-03: MCP 번들 provenance — 소스 내용 해시 (공유 헬퍼).
//
// 번들에 git HEAD를 주입하면 "미커밋 상태에서 빌드 → 이후 커밋" 순서에서
// 해시가 실제 내용을 가리키지 않는다. 대신 번들 입력 소스의 내용 해시를
// 주입하고, parity 검사가 같은 해시를 현재 소스에서 재계산해 대조한다.
// 커밋 순서와 무관하게 "이 번들이 이 소스로 만들어졌는가"를 판정한다.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 웹팩 MCP 번들의 입력. 이 목록이 바뀌면 번들 내용도 바뀌어야 한다.
const BUNDLE_INPUTS = [
    'src/mcp/server.ts',
    'src/mcp/siUnits.ts',
    'package.json',
    'tsconfig.mcp.json',
    'webpack.mcp.config.js',
];

function mcpSourceHash(rootDir) {
    const root = rootDir || path.resolve(__dirname, '..');
    const h = crypto.createHash('sha256');
    for (const rel of BUNDLE_INPUTS) {
        const abs = path.join(root, rel);
        h.update(rel + '\0');
        h.update(fs.readFileSync(abs));
        h.update('\0');
    }
    return h.digest('hex').slice(0, 12);
}

module.exports = { mcpSourceHash, BUNDLE_INPUTS };
