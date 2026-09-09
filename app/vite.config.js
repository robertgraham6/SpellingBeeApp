import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large libraries into separate chunks so the main
          // app bundle stays small and they can be cached independently.
          'exceljs':  ['exceljs'],
          'supabase': ['@supabase/supabase-js'],
          'router':   ['react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Proxy /audio requests to the Express server during development
    // so you don't need to set ALLOWED_ORIGINS
    proxy: {
      '/audio': 'http://localhost:3000',
    },
  },
});
