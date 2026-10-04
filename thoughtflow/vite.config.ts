import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

export default defineConfig({
  // 빌드 결과를 Electron에서 file:// 로 불러오기 위해 상대 경로 사용
  base: './',
  plugins: [
    react(),
    {
      // 개발 서버는 HMR용 inline script/websocket이 필요하므로 CSP는 빌드 결과에만 넣는다.
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
