import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Кастомный домен admin.nmchv.ru → приложение живёт в корне, base = '/'.
// Роутинг — HashRouter, поэтому GitHub Pages не нужен SPA-fallback.
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
