import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

// ─── PRoot / ARM64 esbuild fix ──────────────────────────────────────────────
// Pre-built esbuild npm binaries are compiled for x86_64 page-alignment (4 KB).
// ARM64 kernels (Android/Termux/PRoot) use 16 KB pages, causing a Bus Error when
// the npm binary is executed.  Point to the system-native esbuild to avoid this.
if (!process.env.ESBUILD_BINARY_PATH) {
  const candidates = ['/usr/bin/esbuild', '/usr/local/bin/esbuild'];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      process.env.ESBUILD_BINARY_PATH = p;
      console.log(`[vite] Using system esbuild at ${p} (ARM64 page-alignment fix)`);
      break;
    }
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

    // ─── framer-motion / motion fix ────────────────────────────────────────
    // framer-motion v12 ships dual CJS + ESM.  On proot/ARM64 with older
    // Rollup internals, excluding them from the @rollup/plugin-commonjs resolver
    // causes "Failed to resolve entry" because the ESM conditional export is
    // never reached.  We remove the exclusion so Rollup can resolve via CJS
    // fallback and let Vite's dep-optimiser pre-bundle the ESM entry instead.
    optimizeDeps: {
      include: ['framer-motion', 'motion', 'motion/react'],
    },

    build: {
      // No commonjsOptions.exclude – let Rollup resolve framer-motion normally.
      rollupOptions: {
        onwarn(warning, warn) {
          // Suppress noisy "use client" directive warnings from motion packages
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            warning.message.includes('"use client"')
          ) return;
          warn(warning);
        },
      },
    },

    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true,
      // HMR can be disabled via DISABLE_HMR=true to save CPU during agent edits
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
