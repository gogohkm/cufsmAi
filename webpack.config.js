const path = require('path');
const webpack = require('webpack');

/** Babylon.js 3D 뷰어 번들 (TypeScript → media/viewer3d.js) */
const viewer3dConfig = {
    entry: './src/webview/viewer3d/index.ts',
    output: {
        path: path.resolve(__dirname, 'media'),
        filename: 'viewer3d.js'
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
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
    ],
    devtool: 'source-map',
    mode: 'production'
};

module.exports = [viewer3dConfig];
