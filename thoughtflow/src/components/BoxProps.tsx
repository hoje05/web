import { useEffect, useMemo, useRef, useState } from 'react';
import { commitChange } from '../interaction/editSession';
import { addTagByName, applyTag, findTag, removeTagFromNode, suggestTags } from '../model/tags';
import type { Attachment, BoxNode, Tag } from '../model/types';
import {
  assetUrl,
  formatSize,
  isTextAttachment,
  openAttachment,
  pickAttachments,
  removeAttachmentFrom,
} from '../persistence/attachments';
import { useStore } from '../store/store';

/**
 * 오른쪽 창의 Box 정보 줄: 태그와 첨부.
 *  태그  [AI ×] [Project ×] [+ 태그]   ← 입력하면 저장된 태그를 추천, Enter로 새 태그
 *  첨부  [그림][그림] 📄 results.csv  [+ 이미지·파일]
 */
export function BoxProps({ node }: { node: BoxNode }) {
  return (
    <div className="panel-props" data-testid="panel-props">
      <TagEditor node={node} />
      <AttachmentList node={node} />
    </div>
  );
}

type Option = { kind: 'tag'; tag: Tag } | { kind: 'create'; name: string } | { kind: 'revive'; tag: Tag };

function TagEditor({ node }: { node: BoxNode }) {
  const tags = useStore((s) => s.doc.tags);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  /** 화살표·마우스로 고른 추천 (-1 = 고르지 않음 → Enter는 입력한 이름 그대로) */
  const [hi, setHi] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = node.tagIds ?? [];

  const options = useMemo<Option[]>(() => {
    if (!adding) return [];
    const list: Option[] = suggestTags(tags, query, ids).map((tag) => ({ kind: 'tag', tag }));
    const name = query.trim();
    if (name) {
      const same = findTag({ nodes: {}, edges: {}, tags }, name);
      if (!same) list.push({ kind: 'create', name });
      else if (!same.active) list.push({ kind: 'revive', tag: same });
    }
    return list;
  }, [adding, tags, query, ids]);

  useEffect(() => setHi(-1), [query]);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const choose = (o: Option | undefined) => {
    const name = query.trim();
    if (!o && !name) return;
    if (o?.kind === 'tag') commitChange((doc) => applyTag(doc, node.id, o.tag.id));
    else commitChange((doc) => addTagByName(doc, node.id, o?.kind === 'revive' ? o.tag.name : (o?.name ?? name))?.doc ?? doc);
    setQuery('');
  };
  const close = () => {
    setAdding(false);
    setQuery('');
  };

  return (
    <div className="panel-props-row" data-testid="tag-editor">
      <span className="panel-props-label">태그</span>
      <div className="tag-list">
        {ids.map((id) => {
          const t = tags?.[id];
          if (!t) return null;
          return (
            <span
              key={id}
              className={`tag-chip${t.active ? '' : ' is-archived'}`}
              title={t.active ? t.name : `${t.name} — 저장된 태그에서 지운 태그 (이 Box에는 남아 있음)`}
              data-testid="tag-chip"
            >
              <span className="tag-chip-name">{t.name}</span>
              <button
                className="tag-chip-remove"
                aria-label={`${t.name} 태그 떼기`}
                title="이 Box에서 떼기 (저장된 태그는 그대로)"
                onClick={() => commitChange((doc) => removeTagFromNode(doc, node.id, id))}
              >
                ×
              </button>
            </span>
          );
        })}
        {adding ? (
          <div className="tag-input-wrap">
            <input
              ref={inputRef}
              className="tag-input"
              value={query}
              placeholder="태그 이름"
              spellCheck={false}
              maxLength={60}
              data-testid="tag-input"
              onChange={(e) => setQuery(e.target.value)}
              onBlur={close}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const n = options.length;
                  if (n) setHi((h) => (e.key === 'ArrowDown' ? (h + 1) % n : h <= 0 ? n - 1 : h - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  // 추천을 골랐으면 그 태그, 아니면 입력한 이름 그대로 (같은 이름의 태그가 있으면 그것, 지운 태그면 다시 살림, 없으면 새로)
                  choose(hi >= 0 ? options[hi] : undefined);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
              }}
            />
            {options.length > 0 && (
              <div className="tag-suggest" role="listbox" data-testid="tag-suggest" onMouseDown={(e) => e.preventDefault()}>
                {options.map((o, i) => (
                  <button
                    key={o.kind === 'create' ? '+create' : `${o.kind}:${o.tag.id}`}
                    role="option"
                    aria-selected={i === hi}
                    className={`tag-option${i === hi ? ' is-hi' : ''}`}
                    data-testid="tag-option"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(o)}
                  >
                    {o.kind === 'tag' && <span className="tag-chip is-static">{o.tag.name}</span>}
                    {o.kind === 'create' && (
                      <>
                        <span className="tag-option-hint">새 태그</span>
                        <span className="tag-chip is-static">{o.name}</span>
                      </>
                    )}
                    {o.kind === 'revive' && (
                      <>
                        <span className="tag-option-hint">지운 태그 다시 쓰기</span>
                        <span className="tag-chip is-static">{o.tag.name}</span>
                      </>
                    )}
                  </button>
                ))}
                <button className="tag-option tag-manage-link" onClick={() => useStore.getState().setTagManagerOpen(true)}>
                  저장된 태그 관리…
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="props-add" data-testid="tag-add" title="태그 붙이기 (저장된 태그를 다시 쓰거나 새로 만들기)" onClick={() => setAdding(true)}>
            + 태그
          </button>
        )}
      </div>
    </div>
  );
}

function AttachmentList({ node }: { node: BoxNode }) {
  const filePath = useStore((s) => s.filePath);
  const all = node.attachments ?? [];
  const images = all.filter((a) => a.type === 'image');
  const files = all.filter((a) => a.type !== 'image');
  const preview = (a: Attachment) => useStore.getState().setPreview({ nodeId: node.id, attachmentId: a.id });

  return (
    <div className="panel-props-row" data-testid="attachments">
      <span className="panel-props-label">첨부</span>
      <div className="attach-area">
        {images.length > 0 && (
          <div className="attach-thumbs">
            {images.map((a) => (
              <div key={a.id} className="attach-thumb" data-testid="attachment" data-type="image" title={`${a.name} (${formatSize(a.size)})`}>
                <button className="attach-thumb-open" onClick={() => preview(a)} aria-label={`${a.name} 크게 보기`}>
                  <Thumb src={assetUrl(filePath, a)} alt={a.name} />
                </button>
                <button
                  className="attach-remove"
                  aria-label={`${a.name} 첨부 빼기`}
                  title="첨부 빼기 (Ctrl+Z로 되돌리기)"
                  data-testid="attachment-remove"
                  onClick={() => removeAttachmentFrom(node.id, a.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {files.map((a) => (
          <div key={a.id} className="attach-file" data-testid="attachment" data-type="file">
            <button
              className="attach-file-open"
              title={isTextAttachment(a) ? `${a.name} 미리 보기` : `${a.name} — 이 PC의 기본 프로그램으로 열기`}
              onClick={() => (isTextAttachment(a) ? preview(a) : void openAttachment(a))}
            >
              <FileIcon name={a.name} />
              <span className="attach-file-name">{a.name}</span>
              <span className="attach-file-size">{formatSize(a.size)}</span>
            </button>
            <button
              className="attach-remove"
              aria-label={`${a.name} 첨부 빼기`}
              title="첨부 빼기 (Ctrl+Z로 되돌리기)"
              data-testid="attachment-remove"
              onClick={() => removeAttachmentFrom(node.id, a.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="props-add"
          data-testid="attach-add"
          title="이미지·파일 첨부 (여기로 끌어다 놓거나, 이미지를 붙여 넣어도 됩니다)"
          onClick={() => void pickAttachments(node.id)}
        >
          + 이미지·파일
        </button>
      </div>
    </div>
  );
}

/** 작은 그림: 화면에 보일 때만 불러오고, 파일이 없으면 표시 */
export function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [missing, setMissing] = useState(false);
  if (!src || missing) return <span className="attach-missing">파일 없음</span>;
  return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setMissing(true)} />;
}

export function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const label = ext.length <= 4 ? ext.toUpperCase() : 'FILE';
  return (
    <span className={`file-icon file-${['csv', 'tsv', 'xls', 'xlsx'].includes(ext) ? 'sheet' : ext === 'pdf' ? 'pdf' : 'doc'}`}>
      {label || 'FILE'}
    </span>
  );
}
