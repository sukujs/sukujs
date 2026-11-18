import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  // Cloudflare workerd SSR can load two React copies unless these are pre-bundled
  // into deps_ssr (Invalid hook call / useContext null). See TanStack/router#7119.
  environments: {
    ssr: {
      optimizeDeps: {
        include: [
          'react',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'react-dom',
          'react-dom/server',
          '@tanstack/react-router > @tanstack/react-store',
        ],
        // Avoid prebundling the browser stub of fumadocs-core/server (breaks .md
        // routes when includeProcessedMarkdown still uses the function form).
        exclude: ['fumadocs-core/server'],
      },
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
      },
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom'],
    alias: {
      tslib: 'tslib/tslib.es6.js',
    },
  },
});
