const path = require('path');
const webpack = require('webpack');
const { execSync } = require('child_process');
const pkg = require('./package.json');

// F04: 번들에 버전·빌드 해시를 주입한다 (initialize serverInfo로 노출).
// 타임스탬프는 넣지 않아 동일 소스에서는 바이트 결정적 빌드를 유지한다.
function buildInfo() {
    let gitHash = 'nogit';
    try {
        gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch { /* git 없는 아카이브 */ }
    return { version: pkg.version, gitHash };
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
