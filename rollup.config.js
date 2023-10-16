import ts from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import nodePolyfills from 'rollup-plugin-polyfill-node';

export default [
  {
    input: './src/index.ts',
    output: {
      file: './dist/flvjs.js',
      format: 'umd',
      name: 'flvjs',
    },
    plugins: [
      ts(),
      resolve(),
      nodePolyfills({
        include: ['events'],
      }),
    ],
  },
];
