const path = require('path');
const webpack = require('webpack');

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
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    ],
    devtool: 'source-map',
    mode: 'production',
};
