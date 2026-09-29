// 프로그램 바(창 조작, 이름 바꾸기) + 왼쪽 프로젝트 창(새 프로젝트, 전환, 이름 바꾸기, 휴지통)
import { launch, state, assert, toScreen, shutdown } from './harness.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let { app, win, sandbox } = await launch([], { autoPanel: true });
const trash = join(sandbox.dir, 'trash');
mkdirSync(trash, { recursive: true });
const boards = () => (existsSync(sandbox.boards) ? readdirSync(sandbox.boards).filter((f) => f.endsWith('.tflow')).sort() : []);
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });
const drawerOpen = () => win.evaluate(() => window.__tf.getState().drawerOpen);
const projectTitle = () => win.textContent('[data-testid=project-name]');
/** 프로그램 바의 이름을 눌러 이름 바꾸기 */
const renameInBar = async (name) => {
  await win.click('[data-testid=project-name]');
  await win.waitForSelector('input[data-testid=project-name-input]');
  await win.waitForFunction(() => document.activeElement?.matches('input[data-testid=project-name-input]'));
  await win.keyboard.press('Control+a');
  await win.keyboard.type(name);
  await win.keyboard.press('Enter');
  await win.waitForFunction((n) => window.__tf.getState().filePath?.endsWith(`${n}.tflow`), name);
};
const openDrawer = async () => {
  await win.click('[data-testid=project-button]');
  await win.waitForSelector('[data-testid=project-drawer].is-open');
  await win.waitForTimeout(350); // 애니메이션
};
const items = () => win.$$eval('[data-testid=project-item] .project-name', (els) => els.map((e) => e.textContent));
const itemRow = (name) => win.locator('.project-list li', { has: win.locator('.project-name', { hasText: name }) });
const box = async (x, y, text) => {
  await win.mouse.dblclick(x, y);
  await win.keyboard.type(text);
  await win.keyboard.press('Escape');
};

try {
  // ── 프로그램 바
  const bar = await win.locator('[data-testid=titlebar]').boundingBox();
  assert(bar.y === 0 && bar.height === 38 && bar.width === 1280, 'program bar across the top (38px)');
  assert((await win.$eval('[data-testid=titlebar]', (e) => getComputedStyle(e).webkitAppRegion ?? getComputedStyle(e).getPropertyValue('-webkit-app-region'))) === 'drag',
    'empty area of the bar drags the window');
  assert((await projectTitle()) === '새 보드', 'bar shows the project name');

  // 창 조작 버튼 → BrowserWindow 호출 기록
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const w = BrowserWindow.getAllWindows()[0];
    globalThis.__calls = [];
    let max = false;
    w.minimize = () => globalThis.__calls.push('minimize');
    w.isMaximized = () => max;
    w.maximize = () => {
      globalThis.__calls.push('maximize');
      max = true;
      w.emit('maximize');
    };
    w.unmaximize = () => {
      globalThis.__calls.push('unmaximize');
      max = false;
      w.emit('unmaximize');
    };
    Menu.getApplicationMenu().popup = () => globalThis.__calls.push('menu');
  });
  await win.click('[data-testid=win-minimize]');
  await win.click('[data-testid=win-maximize]');
  await win.waitForSelector('[data-testid=win-maximize][title="이전 크기로"]');
  await win.click('[data-testid=win-maximize]');
  await win.waitForSelector('[data-testid=win-maximize][title="최대화"]');
  await win.click('[data-testid=app-menu]');
  const calls = await app.evaluate(() => globalThis.__calls);
  assert(JSON.stringify(calls) === JSON.stringify(['minimize', 'maximize', 'unmaximize', 'menu']), `window buttons work (${calls.join(', ')})`);
  assert(true, 'maximize button icon follows window state');

  // ── 프로젝트 창: 왼쪽에서 스르륵
  const closedX = (await win.locator('[data-testid=project-drawer]').boundingBox())?.x ?? -1000;
  await win.click('[data-testid=project-button]');
  await win.waitForTimeout(90);
  const midX = (await win.locator('[data-testid=project-drawer]').boundingBox()).x;
  await win.waitForTimeout(300);
  const openX = (await win.locator('[data-testid=project-drawer]').boundingBox()).x;
  assert(closedX < -250 && midX > closedX && midX < 0 && openX === 0, `drawer slides in from the left (${Math.round(closedX)} → ${Math.round(midX)} → ${openX})`);
  assert(await drawerOpen(), 'project button opens the drawer');

  assert((await win.textContent('[data-testid=projects-dir]')).includes(sandbox.boards), 'drawer shows where projects are stored (this PC)');

  // 새 프로젝트: 누르면 텅 빈 새 보드가 바로 열린다 (이름은 나중에)
  await win.click('[data-testid=new-project]');
  await win.waitForFunction(() => window.__tf.getState().filePath?.endsWith('새 프로젝트.tflow'));
  assert(!(await drawerOpen()), 'drawer closes after creating');
  assert((await projectTitle()) === '새 프로젝트', 'new project opens right away as “새 프로젝트”');
  assert(boards().includes('새 프로젝트.tflow'), 'project file created right away');
  await renameInBar('여행 계획');
  assert((await projectTitle()) === '여행 계획', 'clicking the name in the bar renames the project');
  assert(boards().includes('여행 계획.tflow') && !boards().includes('새 프로젝트.tflow'), 'renaming in the bar renames the file');
  await box(520, 300, '비행기 예약');
  await box(820, 300, '숙소 알아보기');
  let s = await state(win);
  const ids = Object.keys(s.doc.nodes);
  await win.click('[data-node-id] >> text=비행기 예약');
  await win.click('[data-testid=panel-note]');
  await win.keyboard.type('10월 첫째 주 오사카');
  await win.keyboard.press('Escape');
  await waitSaved();

  // Ctrl+N → 텅 빈 새 보드가 바로
  await win.keyboard.press('Control+n');
  await win.waitForFunction(() => window.__tf.getState().filePath?.endsWith('새 프로젝트.tflow'));
  s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 0 && !s.panelOpen && !(await drawerOpen()), 'Ctrl+N opens a new empty board right away');
  await renameInBar('독서 노트');
  await box(600, 400, '데미안 3장');
  await waitSaved();

  // 같은 이름으로 바꾸기는 거절
  await openDrawer();
  await itemRow('독서 노트').hover();
  await itemRow('독서 노트').locator('[data-testid=project-rename]').click();
  await win.fill('[data-testid=project-name-input]', '여행 계획');
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-testid=drawer-error]');
  assert((await win.textContent('[data-testid=drawer-error]')).includes('이미 있습니다'), 'duplicate project name rejected');
  await win.keyboard.press('Escape'); // 입력 취소

  // 목록: 최근 순, 현재 프로젝트 표시, Box 수
  const list = await items();
  assert(list[0] === '독서 노트' && list[1] === '여행 계획', `projects listed most recent first (${list.join(', ')})`);
  assert((await itemRow('독서 노트').getAttribute('class'))?.includes('is-current'), 'current project marked');
  assert((await itemRow('여행 계획').textContent()).includes('Box 2개'), 'list shows box count');
  await win.screenshot({ path: 'e2e/out/phase15-drawer.png' });

  // 이전 프로젝트 클릭 → 그 보드로 전환 (오른쪽 창 탭까지 그대로)
  await itemRow('여행 계획').locator('[data-testid=project-item]').click();
  await win.waitForFunction(() => window.__tf.getState().filePath?.endsWith('여행 계획.tflow'));
  s = await state(win);
  assert(Object.values(s.doc.nodes).map((n) => n.text).sort().join() === '비행기 예약,숙소 알아보기', 'switching shows that project’s boxes');
  assert(Object.values(s.doc.nodes).some((n) => n.note === '10월 첫째 주 오사카'), 'notes kept per project');
  assert(s.panelOpen && s.tabs.length === 1 && s.doc.nodes[s.activeTab].text === '비행기 예약', 'right panel tabs restored for that project');
  assert((await projectTitle()) === '여행 계획', 'bar shows switched project');
  assert(ids.every((id) => s.doc.nodes[id]), 'same boxes (ids) as before');

  // 이름 바꾸기 (다른 프로젝트)
  await openDrawer();
  await itemRow('독서 노트').hover();
  await itemRow('독서 노트').locator('[data-testid=project-rename]').click();
  await win.fill('[data-testid=project-name-input]', '책 메모');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => [...document.querySelectorAll('.project-name')].some((e) => e.textContent === '책 메모'));
  assert(boards().includes('책 메모.tflow') && !boards().includes('독서 노트.tflow'), 'rename renames the file');

  // 이름 바꾸기 (지금 프로젝트) → 이후 자동 저장도 새 이름으로
  await itemRow('여행 계획').hover();
  await itemRow('여행 계획').locator('[data-testid=project-rename]').click();
  await win.fill('[data-testid=project-name-input]', '가을 여행');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => window.__tf.getState().filePath?.endsWith('가을 여행.tflow'));
  assert((await projectTitle()) === '가을 여행', 'renaming the current project updates the bar');
  // 이름 입력칸이 닫힌 뒤의 Esc (입력칸이 남아 있는 동안의 Esc는 입력 취소)
  await win.waitForSelector('[data-testid=project-name-input]', { state: 'detached' });
  await win.keyboard.press('Escape');
  assert(!(await drawerOpen()), 'Esc closes the drawer');
  await box(700, 600, '환전하기');
  await waitSaved();
  await win.waitForTimeout(600);
  const b = boards();
  assert(!b.includes('여행 계획.tflow') && JSON.parse(readFileSync(join(sandbox.boards, '가을 여행.tflow'), 'utf-8')).nodes.length === 3,
    `autosave continues under the new name only (${b.join(', ')})`);

  // 휴지통으로 옮기기 (확인 → 예)
  await app.evaluate(({ dialog, shell }, trashDir) => {
    const fs = process.mainModule.require('fs');
    const path = process.mainModule.require('path');
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    shell.trashItem = async (p) => fs.renameSync(p, path.join(trashDir, path.basename(p)));
  }, trash);
  await openDrawer();
  await itemRow('책 메모').hover();
  await itemRow('책 메모').locator('[data-testid=project-delete]').click();
  await win.waitForFunction(() => ![...document.querySelectorAll('.project-name')].some((e) => e.textContent === '책 메모'));
  assert(!boards().includes('책 메모.tflow') && readdirSync(trash).includes('책 메모.tflow'), 'delete moves the project file to the trash');
  assert((await projectTitle()) === '가을 여행', 'deleting another project keeps the current one');

  // 바깥(어두운 배경) 클릭 → 닫힘
  await win.mouse.click(900, 400);
  await win.waitForTimeout(300);
  assert(!(await drawerOpen()), 'clicking outside closes the drawer');
  assert(Object.keys((await state(win)).doc.nodes).length === 3, 'outside click does not act on the board');

  // 다시 실행 → 마지막 프로젝트
  await shutdown(app);
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  await win.waitForFunction(() => window.__tf.getState().filePath?.endsWith('가을 여행.tflow'));
  assert((await projectTitle()) === '가을 여행', 'relaunch reopens the last project');
  await win.screenshot({ path: 'e2e/out/phase15-relaunch.png' });

  // 프로그램 바의 닫기 버튼 → 마지막 변경까지 저장하고 종료
  await box(300, 650, '닫기 직전 생각');
  const closed = app.waitForEvent('close');
  await win.click('[data-testid=win-close]');
  await closed;
  const last = JSON.parse(readFileSync(join(sandbox.boards, '가을 여행.tflow'), 'utf-8'));
  assert(last.nodes.some((n) => n.text === '닫기 직전 생각'), 'close button saves the last change and quits');
  console.log('PHASE 15 OK');
} finally {
  await shutdown(app);
  rmSync(sandbox.dir, { recursive: true, force: true });
}
