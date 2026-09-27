// Electron main/preload와 Claude 데스크톱 확장(.mcpb)을 빌드한다.
//   dist-electron/main.js, preload.js      ← electron/*.ts (esbuild로 한 파일씩 묶음)
//   dist-mcp/bundle/                        ← 확장 내용 (manifest.json, icon.png, server/index.js)
//   dist-mcp/ThoughtFlow.mcpb               ← Claude 데스크톱에서 여는 설치 파일
// 사용: node scripts/build-electron.mjs [--no-mcpb]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning',
  legalComments: 'none',
};

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js', target: 'node20', external: ['electron'] });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js', target: 'node20', external: ['electron'] });

// ── Claude 데스크톱 확장 ──
const out = 'dist-mcp/bundle';
rmSync('dist-mcp', { recursive: true, force: true });
mkdirSync(join(out, 'server'), { recursive: true });
await build({
  ...common,
  entryPoints: ['mcp/stdio.ts'],
  outfile: join(out, 'server/index.js'),
  target: 'node18',
  minify: true,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
copyFileSync('build/icon.png', join(out, 'icon.png'));

const manifest = {
  manifest_version: '0.2',
  name: 'thoughtflow',
  display_name: 'ThoughtFlow',
  version: pkg.version,
  description: 'Claude와 나눈 대화의 흐름을 ThoughtFlow 보드에 Box와 Route로 정리하고, 보드에 적힌 생각을 바탕으로 대화합니다.',
  long_description:
    '이 PC에서 실행 중인 ThoughtFlow 앱과 연결합니다. Claude는 지금 열린 프로젝트의 Box와 Route를 읽고, 대화에서 나온 생각·행동·결과를 새 Box로 추가하고 이어 줍니다. 모든 내용은 이 PC 안(127.0.0.1)에서만 오가며, ThoughtFlow에서 Ctrl+Z로 언제든 되돌릴 수 있습니다. ThoughtFlow가 꺼져 있으면 자동으로 켭니다.',
  author: { name: pkg.author ?? 'ThoughtFlow' },
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] },
  },
  tools: [
    { name: 'get_board', description: '지금 열린 보드의 흐름 읽기' },
    { name: 'read_box', description: 'Box 하나의 메모와 앞뒤 흐름 읽기' },
    { name: 'search_boxes', description: '제목·메모에서 찾기' },
    { name: 'add_flow', description: '새 Box와 Route를 한 번에 추가 (자동 배치)' },
    { name: 'update_box', description: 'Box 제목·메모 고치기' },
    { name: 'connect_boxes', description: 'Box끼리 잇기' },
    { name: 'delete_items', description: 'Box·Route 지우기 (앱 설정에서 허용한 경우만)' },
    { name: 'focus_box', description: '앱 화면에서 Box 보여 주기' },
    { name: 'list_projects', description: '프로젝트 목록' },
    { name: 'open_project', description: '다른 프로젝트 열기' },
    { name: 'create_project', description: '새 프로젝트 만들기' },
  ],
  keywords: ['thoughtflow', 'mind map', 'thinking', 'notes', '생각 정리'],
  compatibility: { platforms: ['win32', 'darwin', 'linux'], runtimes: { node: '>=18.0.0' } },
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

if (!process.argv.includes('--no-mcpb')) {
  const cli = join('node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'pack', out, 'dist-mcp/ThoughtFlow.mcpb'], { encoding: 'utf-8' });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    process.exit(r.status ?? 1);
  }
  console.log('[build] dist-mcp/ThoughtFlow.mcpb');
}
