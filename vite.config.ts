import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * Подставляет публичные Supabase URL и anon key в dist/maintenance.js и dist/analytics.js,
 * чтобы приложениям хватало одного <script>. Ключ публичный (anon), как и в самом клиенте панели.
 */
function injectMaintenanceConfig(env: Record<string, string>): Plugin {
  return {
    name: 'nmchv-maintenance-config',
    apply: 'build',
    closeBundle() {
      const url = env.VITE_SUPABASE_URL ?? '';
      const key = env.VITE_SUPABASE_ANON_KEY ?? '';
      for (const name of ['maintenance.js', 'analytics.js']) {
        const file = resolve('dist', name);
        if (!existsSync(file)) continue;
        const src = readFileSync(file, 'utf8')
          .split("'__NMCHV_SUPABASE_URL__'")
          .join(JSON.stringify(url))
          .split("'__NMCHV_SUPABASE_ANON_KEY__'")
          .join(JSON.stringify(key));
        writeFileSync(file, src);
      }
    },
  };
}

// Кастомный домен admin.nmchv.ru → приложение живёт в корне, base = '/'.
// Роутинг — HashRouter, поэтому GitHub Pages не нужен SPA-fallback.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: '/',
    plugins: [react(), injectMaintenanceConfig(env)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  };
});
