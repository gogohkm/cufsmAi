const path = require('path');
const webpack = require('webpack');

module.exports = {
    entry: {
        webview: './webview/js/app.js'
    },
    output: {
        path: path.resolve(__dirname, 'media'),
        filename: '[name].js'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    plugins: [
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1
        })
    ],
    devtool: 'source-map'
};
