import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

// Automatically detect system native esbuild inside PRoot/Termux/ARM64 platforms.
// Setting ESBUILD_BINARY_PATH prevents the "Bus error (core dumped)" crash caused by mismatched 4KB/16KB memory page size page-alignment in pre-compiled npm packages.
if (!process.env.ESBUILD_BINARY_PATH) {
  if (fs.existsSync('/usr/bin/esbuild')) {
    process.env.ESBUILD_BINARY_PATH = '/usr/bin/esbuild';
    console.log('System native esbuild detected at /usr/bin/esbuild. Environment path override registered successfully.');
  } else if (fs.existsSync('/usr/local/bin/esbuild')) {
    process.env.ESBUILD_BINARY_PATH = '/usr/local/bin/esbuild';
    console.log('System native esbuild detected at /usr/local/bin/esbuild. Environment path override registered successfully.');
  }
}

export default defineConfig(() => {
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      commonjsOptions: {
        exclude: [/node_modules\/framer-motion/, /node_modules\/motion/],
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
