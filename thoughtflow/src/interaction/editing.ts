/**
 * 텍스트 편집 중이면 편집기를 blur 시켜 내용을 commit 한다.
 * (Box 안의 편집기, 왼쪽 창의 제목/메모 입력칸)
 * 다른 명령(삭제, Undo, 저장, 열기 …)을 실행하기 전에 항상 호출한다.
 */
export function flushEditing() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return;
  if (el.classList.contains('box-editor') || el.closest('.side-panel')) el.blur();
}
