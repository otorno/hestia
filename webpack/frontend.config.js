const path = require('path');
const ForkTsCheckWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const VueLoaderPlugin = require('vue-loader/lib/plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const TsConfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const TerserJsPlugin = require('terser-webpack-plugin')
const { ProvidePlugin } = require('webpack');

module.exports = (env, argv) => {

  const production = (env && env.production) || (argv && argv.mode == 'production') ? true : false;
  console.log('Environment:', (production ? 'Production' : 'Development') + '!')
return {
  mode: production ? 'production' : 'development',
  entry: {
    'hestia-frontend': path.resolve(__dirname, '..', 'src', 'frontend', 'main.ts'),
  },

  output: {
    path: path.resolve(__dirname, '..', production ? 'build-prod' : 'build', 'frontend'),
    publicPath: '',
    filename: '[name].[contenthash].js',
  },

  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      },
      {
        test: /\.[jt]s$/,
        loader: 'ts-loader',
        options: { transpileOnly: true }
      },
      {
        test: /\.scss$/,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: 'css-loader', options: { importLoaders: 2, url: false } },
          'postcss-loader',
          'sass-loader'
        ]
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader'
        ]
      },
      {
        test: /\.(ttf|eot|svg|woff2?)(\?[a-z0-9=&.]+)?$/,
        loader: 'file-loader'
      }
    ]
  },

  resolve: {
    modules: ['node_modules'],
    extensions: ['.vue', '.ts', '.js', '.json', '.html', '.scss', '.css'],
    plugins: [new TsConfigPathsPlugin()],
    fallback: {
      stream: require.resolve('stream-browserify'),
      crypto: require.resolve('crypto-browserify'),
      buffer: require.resolve('buffer-browserify'),
    }
  },

  devtool: production ? undefined : 'inline-source-map',

  optimization: {
    splitChunks: {
      chunks: 'all'
    },
    minimizer: [ new TerserJsPlugin({ terserOptions: {
      mangle: {
        reserved: [
          'Buffer',
          'BigInteger',
          'Point',
          'ECPubKey',
          'ECKey',
          'sha512_asm',
          'asm',
          'ECPair',
          'HDNode'
        ]
      },
      sourceMap: production ? false : true
    } }) ]
  },

  plugins: [
    new ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    }),
    new CleanWebpackPlugin(),
    new VueLoaderPlugin(),
    new ForkTsCheckWebpackPlugin(),
    new MiniCssExtractPlugin({
      filename: '[name].css'
    }),
    new HtmlWebpackPlugin({
      chunks: ['hestia-frontend'],
      template: 'src/frontend/index.html',
      filename: 'index.html'
    })
  ],
}
}
