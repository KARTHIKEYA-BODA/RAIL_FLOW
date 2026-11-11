import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/(.*)/, replacement: `${path.resolve(__dirname, 'src')}/$1` },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
});
