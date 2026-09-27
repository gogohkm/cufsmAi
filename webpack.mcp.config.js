const path = require('path');
const webpack = require('webpack');
const pkg = require('./package.json');
const { mcpSourceHash } = require('./scripts/mcp-source-hash.cjs');

// F04/R3-03: 번들에 버전·소스 내용 해시를 주입한다 (initialize serverInfo 노출).
// git HEAD가 아니라 내용 해시를 쓰므로 커밋 순서와 무관하게 판정된다.
// 타임스탬프는 넣지 않아 동일 소스에서는 바이트 결정적 빌드를 유지한다.
function buildInfo() {
    return { version: pkg.version, srcHash: mcpSourceHash(__dirname) };
}

module.exports = {
    entry: './src/mcp/server.ts',
    output: {
        path: path.resolve(__dirname, 'media'),
        filename: 'mcp-server.js',
    },
    target: 'node',
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [{
            test: /\.ts$/,
            use: [{
                loader: 'ts-loader',
                options: { configFile: 'tsconfig.mcp.json' }
            }],
            exclude: /node_modules/,
        }],
    },
    externals: {
        // Node.js 내장 모듈은 번들에서 제외
    },
    plugins: [
        new webpack.DefinePlugin({ __STCFSD_BUILD__: JSON.stringify(buildInfo()) }),
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    ],
    devtool: 'source-map',
    mode: 'production',
};
