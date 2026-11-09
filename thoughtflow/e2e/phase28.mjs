// 워크플로우 3단계 — 도구 목록: 이 PC의 스킬·명령어·서브 에이전트·커넥터(MCP 서버)를 찾아 자동 완성.
// 사용자 폴더(~/.claude), 작업 폴더(.claude, .mcp.json), 플러그인, Claude Code·데스크톱 설정. 찾지 못한 이름은 점선.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, launch, makeSandbox, shutdown } from './harness.mjs';

const sandbox = makeSandbox();
const put = (path, text) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
const home = join(sandbox.dir, 'home', '.claude');
const project = join(sandbox.dir, 'work', 'app');
const desktop = join(sandbox.dir, 'desktop');
put(join(home, 'skills', 'report-writer', 'SKILL.md'), '---\nname: report-writer\ndescription: 결과를 표와 그래프가 있는 보고서로 쓴다\n---\n# 본문');
put(join(home, 'skills', 'no-front', 'SKILL.md'), '# 머리말 없는 스킬');
put(join(home, 'skills', 'not-a-skill', 'README.md'), '스킬 아님');
put(join(home, 'commands', 'review-pr.md'), '---\ndescription: PR을 검토한다\n---\n$ARGUMENTS 를 검토');
put(join(home, 'commands', 'git', 'sync.md'), '브랜치를 최신으로 맞춘다');
put(join(home, 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\ndescription: 바뀐 코드를 검토하는 에이전트\ntools: Read, Grep\n---\n지시');
put(join(home, 'plugins', 'cache', 'market', 'myplug', '1.0.0', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'myplug' }));
put(join(home, 'plugins', 'cache', 'market', 'myplug', '1.0.0', 'skills', 'deploy-check', 'SKILL.md'), '---\nname: deploy-check\ndescription: 배포 전에 점검한다\n---\n');
put(join(sandbox.dir, 'home', '.claude.json'), JSON.stringify({ mcpServers: { github: { command: 'x' } }, projects: { [project]: { mcpServers: { postgres: {} } } } }));
put(join(project, '.claude', 'skills', 'app-style', 'SKILL.md'), '---\nname: app-style\ndescription: 이 앱의 코드 규칙\n---\n');
put(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { linear: {} } }));
put(join(desktop, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { filesystem: {}, thoughtflow: {} } }));
process.env.THOUGHTFLOW_CLAUDE_HOME = home;
process.env.THOUGHTFLOW_CLAUDE_JSON = join(sandbox.dir, 'home', '.claude.json');
process.env.THOUGHTFLOW_CLAUDE_DIR = desktop;

let { app, win } = await launch([], { sandbox, autoPanel: true });
const resources = () => win.evaluate(() => window.__tf.getState().doc.nodes.A.step.resources);
const options = () => win.$$eval('[data-testid=res-option] .res-option-name', (els) => els.map((e) => e.textContent));

try {
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, nodes: { A: { id: 'A', x: 0, y: 0, width: 180, height: 56, text: '보고서', note: '' } } });
    s.openPage('A', { force: true });
  });
  await win.click('[data-testid=step-enable]');

  // ── 스킬: 사용자 폴더 + 플러그인 (작업 폴더를 정하기 전)
  await win.click('[data-testid=res-skill-add]');
  await win.waitForSelector('[data-testid=res-suggest]');
  let names = await options();
  assert(names.includes('report-writer') && names.includes('no-front') && names.includes('myplug:deploy-check'), `skills from ~/.claude and plugins (${names})`);
  assert(!names.includes('not-a-skill') && !names.includes('app-style'), 'folders without SKILL.md and the not-yet-chosen work folder are not listed');
  await win.keyboard.type('rep');
  names = await options();
  assert(names[0] === 'report-writer', `typing narrows the list (${names})`);
  assert((await win.textContent('[data-testid=res-option]')).includes('표와 그래프'), 'each option shows its description');
  await win.screenshot({ path: 'e2e/out/phase28-tools.png' });
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('Enter');
  await win.keyboard.type('배포');
  await win.click('[data-testid=res-option] >> nth=0');
  assert(JSON.stringify((await resources()).skills) === '["report-writer","myplug:deploy-check"]', 'pick with keys or a click (search by description too)');

  // ── 명령어 · 서브 에이전트
  await win.click('[data-testid=res-command-add]');
  await win.keyboard.type('/re');
  assert(JSON.stringify(await options()) === '["/review-pr"]', 'commands from ~/.claude/commands');
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('Enter');
  await win.keyboard.type('sy');
  assert((await options()).includes('/sync'), 'commands in sub-folders too');
  await win.keyboard.press('Escape');
  await win.fill('[data-testid=res-command-add]', '');
  await win.click('[data-testid=res-subagent-type]');
  names = await options();
  assert(['code-reviewer', 'Explore', 'general-purpose', 'Plan'].every((n) => names.includes(n)), `sub-agents: user agents + built-in (${names})`);
  await win.keyboard.type('code');
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('Enter');
  let r = await resources();
  assert(JSON.stringify(r.commands) === '["/review-pr"]' && r.subagent?.type === 'code-reviewer', 'command and sub-agent chosen');

  // ── 커넥터: 사용자 설정 + Claude 데스크톱 (ThoughtFlow 자신은 빼고)
  await win.click('[data-testid=res-connector-add]');
  names = await options();
  assert(names.includes('github') && names.includes('filesystem') && !names.includes('thoughtflow') && !names.includes('linear'), `connectors from Claude Code and Claude Desktop settings (${names})`);
  // 목록에 없는 이름도 적을 수 있다 (claude.ai 커넥터 등) → 점선
  await win.keyboard.type('Gmail');
  await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  const gmail = win.locator('[data-testid=res-connector] [data-testid=res-chip]', { hasText: 'Gmail' });
  assert((await gmail.getAttribute('data-known')) === 'no' && (await gmail.getAttribute('class')).includes('is-unknown'), 'names not found on this PC are shown dashed');
  const known = win.locator('[data-testid=res-skill] [data-testid=res-chip]', { hasText: 'report-writer' });
  assert((await known.getAttribute('data-known')) === 'yes' && (await known.getAttribute('title')).includes('보고서'), 'found tools show their description on hover');

  // ── 작업 폴더를 정하면 그 폴더의 스킬·MCP 서버도
  await win.click('[data-testid=workflow-button]');
  await win.waitForSelector('[data-testid=wf-catalog]');
  const before = await win.textContent('[data-testid=wf-catalog]');
  assert(before.includes('스킬 3') && before.includes('명령어 2') && before.includes('서브 에이전트 1'), `plan window shows what was found (${before})`);
  await win.fill('[data-testid=wf-dir]', project);
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => document.querySelector('[data-testid=wf-catalog]')?.textContent.includes('작업 폴더 포함'));
  const after = await win.textContent('[data-testid=wf-catalog]');
  assert(after.includes('스킬 4') && after.includes('커넥터 4'), `the work folder adds its own skills and MCP servers (${after})`);
  await win.keyboard.press('Escape'); // 입력 칸에서 나오기
  await win.keyboard.press('Escape'); // 계획 창 닫기
  await win.waitForSelector('[data-testid=workflow-panel]', { state: 'detached' });
  await win.click('[data-testid=res-connector-add]');
  names = await options();
  assert(names.includes('linear') && names.includes('postgres'), `.mcp.json and the project's Claude Code servers (${names})`);
  await win.keyboard.press('Escape');

  // ── 새로 설치한 스킬: 다시 찾기
  put(join(home, 'skills', 'new-skill', 'SKILL.md'), '---\nname: new-skill\ndescription: 방금 설치\n---\n');
  await win.click('[data-testid=workflow-button]');
  await win.click('[data-testid=wf-catalog-refresh]');
  await win.waitForFunction(() => document.querySelector('[data-testid=wf-catalog]')?.textContent.includes('스킬 5'));
  assert(true, '"다시 찾기" picks up newly installed skills');
  await win.keyboard.press('Escape');
  console.log('PHASE 28 OK');
} finally {
  await shutdown(app);
}
