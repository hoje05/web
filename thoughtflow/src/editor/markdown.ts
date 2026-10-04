/**
 * 메모 글(Markdown) ↔ 편집기 문서(Tiptap JSON).
 *
 * 메모는 파일에 Markdown 글자로 저장한다. AI가 그대로 읽고 쓸 수 있고, 예전의 그냥 글도 그대로 열린다.
 * Notion처럼 "한 줄 = 한 블록"이다 (Enter마다 새 블록, 빈 줄은 빈 줄 그대로).
 *
 *   # 제목1   ## 제목2   ### 제목3
 *   - 글머리 목록   1. 번호 목록   - [ ] 할 일   - [x] 한 일    (2칸 들여쓰면 안쪽 목록)
 *   > 인용   ``` 코드 ```   --- 구분선
 *   **굵게**  *기울임*  ~~취소선~~  `코드`      \* 처럼 \ 를 앞에 붙이면 그 글자 그대로
 *
 * 굵게·기울임은 CommonMark의 복잡한 규칙 대신 "표시 앞뒤에 공백이 없으면 짝을 맞춘다"만 쓴다.
 * 그래야 **'중요'**합니다 처럼 한국어 조사가 바로 붙어도 굵게가 풀리지 않는다.
 * 이 파일이 만든 글을 다시 읽으면 언제나 같은 문서가 된다 (tests/markdown.test.ts).
 */
import type { JSONContent } from '@tiptap/core';

type Node = JSONContent;
type InlineMark = 'bold' | 'italic' | 'strike';
const MARK_ORDER = ['bold', 'italic', 'strike', 'code'] as const;
const DELIM: Record<InlineMark, string> = { bold: '**', italic: '*', strike: '~~' };

/** \ 뒤에 오면 그 글자 그대로가 되는 글자 */
const ESCAPABLE = '\\`*~_#-+>.)[]';

const FENCE = /^(\s*)(```|~~~)(.*)$/;
const HR = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6}) (.*)$/;
const QUOTE = /^\s{0,3}> ?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)]) (.*)$/;
const TASK = /^\[([ xX])\](?: (.*))?$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

// ───────────── 읽기: Markdown → 문서 ─────────────

export function markdownToDoc(md: string): JSONContent {
  const content = parseBlocks(md.replace(/\r\n?/g, '\n').split('\n'));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function paragraph(text: string): Node {
  const content = parseInline(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function parseBlocks(lines: string[]): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if ((m = line.match(FENCE))) {
      const [, pad, fence, info] = m;
      const close = new RegExp(`^\\s*${fence === '```' ? '```' : '~~~'}\\s*$`);
      const body: string[] = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) {
        body.push(lines[i].slice(Math.min(pad.length, indentOf(lines[i]))));
      }
      i++; // 닫는 줄 (없으면 끝까지 코드)
      const text = body.join('\n');
      const node: Node = { type: 'codeBlock', attrs: { language: info.trim() || null } };
      if (text) node.content = [{ type: 'text', text }];
      out.push(node);
    } else if (HR.test(line)) {
      out.push({ type: 'horizontalRule' });
      i++;
    } else if ((m = line.match(HEADING))) {
      const content = parseInline(m[2]);
      out.push({ type: 'heading', attrs: { level: Math.min(3, m[1].length) }, ...(content.length ? { content } : {}) });
      i++;
    } else if (QUOTE.test(line)) {
      const inner: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(lines[i].match(QUOTE)![1]);
      const content = parseBlocks(inner);
      out.push({ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] });
    } else if (listInfo(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
    } else {
      out.push(paragraph(line));
      i++;
    }
  }
  return out;
}

type ListKind = 'bullet' | 'ordered' | 'task';

function listInfo(line: string): { indent: number; kind: ListKind; checked: boolean; start: number; text: string } | null {
  const m = line.match(LIST);
  if (!m) return null;
  const marker = m[2];
  let text = m[3];
  if (/\d/.test(marker[0])) return { indent: m[1].length, kind: 'ordered', checked: false, start: parseInt(marker, 10), text };
  const t = text.match(TASK);
  if (t) return { indent: m[1].length, kind: 'task', checked: t[1] !== ' ', start: 1, text: t[2] ?? '' };
  return { indent: m[1].length, kind: 'bullet', checked: false, start: 1, text };
}

/** 같은 들여쓰기·같은 종류의 목록 줄을 모은다. 더 들여쓴 줄은 그 항목 안의 내용(안쪽 목록 등). */
function parseList(lines: string[], start: number): [Node, number] {
  const first = listInfo(lines[start])!;
  const items: Node[] = [];
  let i = start;
  while (i < lines.length) {
    const info = listInfo(lines[i]);
    if (!info || info.indent !== first.indent || info.kind !== first.kind) break;
    i++;
    const child: string[] = [];
    // 빈 줄("")은 목록을 끝낸다. 공백만 있는 줄("  ")은 항목 안의 빈 줄.
    for (; i < lines.length && lines[i].length > 0 && indentOf(lines[i]) > first.indent; i++) child.push(lines[i]);
    const filled = child.filter((l) => l.trim());
    const cut = filled.length ? Math.min(...filled.map(indentOf)) : 0;
    const content = [paragraph(info.text), ...parseBlocks(child.map((l) => l.slice(Math.min(cut, indentOf(l)))))];
    items.push(info.kind === 'task' ? { type: 'taskItem', attrs: { checked: info.checked }, content } : { type: 'listItem', content });
  }
  if (first.kind === 'task') return [{ type: 'taskList', content: items }, i];
  if (first.kind === 'ordered') return [{ type: 'orderedList', attrs: { start: first.start }, content: items }, i];
  return [{ type: 'bulletList', content: items }, i];
}

type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'delim'; mark: InlineMark; raw: string; canOpen: boolean; canClose: boolean };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let buf = '';
  const flush = () => {
    if (buf) toks.push({ kind: 'text', text: buf });
    buf = '';
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
    } else if (c === '`') {
      // 코드: 다음 ` 까지 (안에서는 \` 와 \\ 만 글자)
      let j = i + 1;
      let code = '';
      while (j < s.length && s[j] !== '`') {
        if (s[j] === '\\' && (s[j + 1] === '`' || s[j + 1] === '\\')) {
          code += s[j + 1];
          j += 2;
        } else code += s[j++];
      }
      if (j < s.length && code) {
        flush();
        toks.push({ kind: 'code', text: code });
        i = j + 1;
      } else {
        buf += c;
        i++;
      }
    } else if (c === '*' || (c === '~' && s[i + 1] === '~')) {
      const raw = c === '~' ? '~~' : s[i + 1] === '*' ? '**' : '*';
      const mark: InlineMark = raw === '**' ? 'bold' : raw === '~~' ? 'strike' : 'italic';
      const next = s[i + raw.length];
      flush();
      toks.push({ kind: 'delim', mark, raw, canOpen: next !== undefined && !/\s/.test(next), canClose: i > 0 && !/\s/.test(s[i - 1]) });
      i += raw.length;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return toks;
}

export function parseInline(s: string): Node[] {
  const toks = tokenize(s);
  // 종류마다: 열 수 있는 표시 → 그 뒤의 닫을 수 있는 표시와 짝 (사이에 글이 있어야 함)
  const pair = new Map<number, 'open' | 'close'>();
  for (const mark of ['bold', 'italic', 'strike'] as const) {
    let open = -1;
    toks.forEach((t, k) => {
      if (t.kind !== 'delim' || t.mark !== mark) return;
      if (open >= 0 && t.canClose && k > open + 1) {
        pair.set(open, 'open');
        pair.set(k, 'close');
        open = -1;
      } else if (t.canOpen) open = k;
    });
  }
  const out: Node[] = [];
  const active = new Set<InlineMark>();
  const push = (text: string, code = false) => {
    const marks = MARK_ORDER.filter((m) => (m === 'code' ? code : active.has(m)));
    const last = out[out.length - 1];
    const same = last && JSON.stringify((last.marks ?? []).map((x) => x.type)) === JSON.stringify(marks);
    if (same) last.text += text;
    else out.push(marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text });
  };
  toks.forEach((t, k) => {
    if (t.kind === 'text') push(t.text);
    else if (t.kind === 'code') push(t.text, true);
    else if (pair.get(k) === 'open') active.add(t.mark);
    else if (pair.get(k) === 'close') active.delete(t.mark);
    else push(t.raw);
  });
  return out;
}

// ───────────── 쓰기: 문서 → Markdown ─────────────

export function docToMarkdown(doc: JSONContent): string {
  return serializeBlocks(doc.content ?? []);
}

function serializeBlocks(blocks: Node[]): string {
  return blocks.map(serializeBlock).join('\n');
}

function serializeBlock(n: Node): string {
  switch (n.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(3, Math.max(1, Number(n.attrs?.level) || 1)))} ${serializeInline(n.content)}`;
    case 'bulletList':
      return (n.content ?? []).map((item) => serializeItem('- ', item)).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.start) || 1;
      return (n.content ?? []).map((item, k) => serializeItem(`${start + k}. `, item)).join('\n');
    }
    case 'taskList':
      return (n.content ?? []).map((item) => serializeItem(`- [${item.attrs?.checked ? 'x' : ' '}] `, item)).join('\n');
    case 'blockquote':
      return serializeBlocks(n.content ?? [])
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'codeBlock': {
      const text = (n.content ?? []).map((t) => t.text ?? '').join('');
      const lang = typeof n.attrs?.language === 'string' ? n.attrs.language : '';
      return text ? `\`\`\`${lang}\n${text}\n\`\`\`` : `\`\`\`${lang}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    default:
      return escapeLineStart(serializeInline(n.content));
  }
}

function serializeItem(marker: string, item: Node): string {
  const [first, ...rest] = item.content ?? [];
  let head = '';
  let children = rest;
  if (first?.type === 'paragraph') {
    head = serializeInline(first.content);
    // 글머리·번호 항목의 글이 "[ ] "로 시작하면 할 일로 읽히지 않게
    if (item.type !== 'taskItem' && /^\[[ xX]\]( |$)/.test(head)) head = `\\${head}`;
  } else if (first) children = item.content ?? [];
  const lines = [marker + head];
  if (children.length) lines.push(...serializeBlocks(children).split('\n').map((l) => `  ${l}`));
  return lines.join('\n');
}

/** 그냥 문단의 글이 목록·제목 표시처럼 시작하면 \ 를 붙여 그대로 읽히게 */
function escapeLineStart(line: string): string {
  const pad = line.match(/^\s*/)![0];
  const rest = line.slice(pad.length);
  if (/^(#{1,6} |[-+] |>|```|~~~)/.test(rest) || HR.test(rest)) return `${pad}\\${rest}`;
  const num = rest.match(/^(\d{1,9})([.)] .*)$/);
  if (num) return `${pad}${num[1]}\\${num[2]}`;
  return line;
}

function escapeText(t: string): string {
  let r = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') r += i === t.length - 1 || ESCAPABLE.includes(t[i + 1]) ? '\\\\' : '\\';
    else if (c === '`') r += '\\`';
    // 양옆이 띄어진 * 는 꾸미기 표시가 될 수 없으니 그대로 (5 * 3)
    else if (c === '*') r += i > 0 && i < t.length - 1 && /\s/.test(t[i - 1]) && /\s/.test(t[i + 1]) ? '*' : '\\*';
    else if (c === '~' && (i === 0 || i === t.length - 1 || t[i - 1] === '~' || t[i + 1] === '~')) r += '\\~';
    else r += c;
  }
  return r;
}

function escapeCode(t: string): string {
  let r = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '`') r += '\\`';
    else if (c === '\\') r += i === t.length - 1 || t[i + 1] === '`' || t[i + 1] === '\\' ? '\\\\' : '\\';
    else r += c;
  }
  return r;
}

/**
 * 글자 꾸미기를 표시로. 표시 바로 안쪽에는 공백이 오지 않게(앞뒤 공백은 표시 밖으로) 해서
 * 다시 읽을 때 반드시 짝이 맞는다.
 */
function serializeInline(nodes: Node[] = []): string {
  let out = '';
  let active: InlineMark[] = [];
  let pendingSpace = '';
  const closeExcept = (keep: InlineMark[]) => {
    const closing = active.filter((m) => !keep.includes(m));
    out += closing
      .reverse()
      .map((m) => DELIM[m])
      .join('');
    active = active.filter((m) => keep.includes(m));
  };
  const open = (want: InlineMark[]) => {
    const opening = want.filter((m) => !active.includes(m));
    out += opening.map((m) => DELIM[m]).join('');
    active.push(...opening);
  };
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text) continue;
    const types = (n.marks ?? []).map((m) => m.type);
    const want = (['bold', 'italic', 'strike'] as const).filter((m) => types.includes(m));
    if (types.includes('code')) {
      closeExcept(want);
      out += pendingSpace;
      pendingSpace = '';
      open(want);
      out += `\`${escapeCode(n.text)}\``;
      continue;
    }
    const lead = n.text.match(/^\s*/)![0];
    const core = n.text.slice(lead.length).trimEnd();
    if (!core) {
      pendingSpace += n.text;
      continue;
    }
    closeExcept(want);
    out += pendingSpace + lead;
    open(want);
    out += escapeText(core);
    pendingSpace = n.text.slice(lead.length + core.length);
  }
  closeExcept([]);
  return out + pendingSpace;
}
