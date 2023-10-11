import ts from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';

export default [
  {
    input: './src/index.ts',
    output: {
      file: './dist/flvjs.js',
      format: 'umd',
      name: 'flvjs',
    },
    plugins: [ts(), resolve()],
  },
];
