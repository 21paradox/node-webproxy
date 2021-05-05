const path = require('path');
const webpack = require('webpack');

const config = {
  // entry: path.join(__dirname, './agent.js'),
  entry: {
    httpsconnect: path.join(__dirname, './apisrc/httpsconnect.js'),
  },
  target: 'node',
  optimization: {
    // We no not want to minimize our code.
    minimize: false,
  },
  externals: {

  },
  module: {

  },
  output: {
    path: path.join(__dirname, 'api'),
    filename: "[name].js",
  },
  plugins: [
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1,
    }),
  ],
};

module.exports = config;
