import { useEffect, useState } from 'react';
import type { Attachment } from '../model/types';
import { assetUrl, formatSize, isTextAttachment, openAttachment, readAttachmentText, revealAttachment } from '../persistence/attachments';
import { useStore } from '../store/store';
import { FileIcon } from './BoxProps';

/**
 * 첨부 미리보기 (창 안에서):
 *  - 이미지: 크게 보기. 같은 Box의 다른 이미지로 ‹ › (← → 키)
 *  - CSV/TSV: 표로, JSON: 보기 좋게, 그 밖의 글자 파일: 그대로 (앞부분만)
 *  - 어떤 파일이든 "기본 프로그램으로 열기", "폴더에서 보기"
 */
export function AttachmentPreview() {
  const preview = useStore((s) => s.preview);
  const node = useStore((s) => (s.preview ? s.doc.nodes[s.preview.nodeId] : undefined));
  const filePath = useStore((s) => s.filePath);
  const att = node?.attachments?.find((a) => a.id === preview?.attachmentId);
  const close = () => useStore.getState().setPreview(null);

  const images = (node?.attachments ?? []).filter((a) => a.type === 'image');
  const at = att ? images.findIndex((a) => a.id === att.id) : -1;
  const go = (d: number) => {
    if (at < 0 || images.length < 2 || !node) return;
    const next = images[(at + d + images.length) % images.length];
    useStore.getState().setPreview({ nodeId: node.id, attachmentId: next.id });
  };

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') close();
        else go(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // 첨부가 지워졌거나(Undo 등) 다른 보드로 바뀌면 닫는다
  useEffect(() => {
    if (preview && !att) close();
  }, [preview, att]);

  if (!preview || !att) return null;
  return (
    <>
      <div className="modal-backdrop preview-backdrop" onMouseDown={close} />
      <div className="preview" role="dialog" aria-label={att.name} data-testid="attachment-preview">
        <div className="preview-head">
          <FileIcon name={att.name} />
          <span className="preview-name" title={att.name}>
            {att.name}
          </span>
          <span className="preview-meta">
            {formatSize(att.size)}
            {att.width && att.height ? ` · ${att.width}×${att.height}` : ''}
            {images.length > 1 && at >= 0 ? ` · ${at + 1}/${images.length}` : ''}
          </span>
          <button className="preview-action" onClick={() => void openAttachment(att)} data-testid="preview-open">
            기본 프로그램으로 열기
          </button>
          <button className="preview-action" onClick={() => void revealAttachment(att)}>
            폴더에서 보기
          </button>
          <button className="preview-close" aria-label="닫기" onClick={close}>
            ×
          </button>
        </div>
        <div className="preview-body">
          {att.type === 'image' ? (
            <>
              <ImageView key={att.id} src={assetUrl(filePath, att)} alt={att.name} />
              {images.length > 1 && (
                <>
                  <button className="preview-nav prev" aria-label="이전 이미지" onClick={() => go(-1)}>
                    ‹
                  </button>
                  <button className="preview-nav next" aria-label="다음 이미지" onClick={() => go(1)}>
                    ›
                  </button>
                </>
              )}
            </>
          ) : isTextAttachment(att) ? (
            <TextView key={att.id} att={att} />
          ) : (
            <div className="preview-empty">
              이 파일은 창 안에서 미리 볼 수 없습니다. <b>기본 프로그램으로 열기</b>를 눌러 주세요.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ImageView({ src, alt }: { src: string | null; alt: string }) {
  const [missing, setMissing] = useState(false);
  if (!src || missing) return <div className="preview-empty">이미지 파일을 찾을 수 없습니다. 자료 폴더에서 지워졌거나 옮겨졌을 수 있습니다.</div>;
  return <img className="preview-image" src={src} alt={alt} decoding="async" draggable={false} onError={() => setMissing(true)} data-testid="preview-image" />;
}

const MAX_ROWS = 300;

function TextView({ att }: { att: Attachment }) {
  const [state, setState] = useState<{ text: string; truncated: boolean } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void readAttachmentText(att).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [att]);
  if (!state) return <div className="preview-empty">불러오는 중…</div>;
  if ('error' in state) return <div className="preview-empty">{state.error}</div>;
  const ext = att.name.split('.').pop()?.toLowerCase();
  const note = state.truncated ? <div className="preview-note">파일이 커서 앞부분만 보여 줍니다.</div> : null;
  if (ext === 'csv' || ext === 'tsv') {
    const rows = parseDelimited(state.text, ext === 'tsv' ? '\t' : guessDelimiter(state.text), MAX_ROWS + 1);
    return (
      <div className="preview-text">
        {note}
        <table className="preview-table" data-testid="preview-table">
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > MAX_ROWS && <div className="preview-note">처음 {MAX_ROWS}줄만 보여 줍니다.</div>}
      </div>
    );
  }
  let text = state.text;
  if (ext === 'json' && !state.truncated) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // 그대로
    }
  }
  return (
    <div className="preview-text">
      {note}
      <pre data-testid="preview-pre">{text}</pre>
    </div>
  );
}

/** 쉼표 대신 세미콜론을 쓰는 CSV도 있다 (유럽식 Excel) */
function guessDelimiter(text: string): string {
  const nl = text.indexOf('\n');
  const first = text.slice(0, nl < 0 ? 2000 : nl);
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** 간단한 CSV 읽기 (따옴표, 따옴표 안의 줄바꿈 지원) */
export function parseDelimited(text: string, sep: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < maxRows) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
