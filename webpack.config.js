const path = require('path');
const webpack = require('webpack');

/** Babylon.js 3D 뷰어 번들 (TypeScript → media/viewer3d.js) */
const viewer3dConfig = {
    entry: './src/webview/viewer3d/index.ts',
    output: {
        path: path.resolve(__dirname, 'media'),
        filename: 'viewer3d.js',
        chunkFilename: 'viewer3d.[name].js',
        publicPath: 'auto'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [{
            test: /\.ts$/,
            use: [{
                loader: 'ts-loader',
                options: { configFile: 'tsconfig.webview.json' }
            }],
            exclude: /node_modules/
        }]
    },
    plugins: [
        // 진입점과 Babylon 지연 청크만 유지하여 WebView 내 다중 요청을 줄인다.
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 2 })
    ],
    performance: {
        // Babylon/WebGL 엔진은 기능 사용 시에만 로드되는 별도 청크다.
        maxAssetSize: 1100000,
        maxEntrypointSize: 250000
    },
    devtool: 'source-map',
    mode: 'production'
};

module.exports = [viewer3dConfig];
