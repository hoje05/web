import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, parseInline } from '../src/editor/markdown';

const roundTrip = (md: string) => docToMarkdown(markdownToDoc(md));
const text = (t: string, ...marks: string[]) => (marks.length ? { type: 'text', text: t, marks: marks.map((type) => ({ type })) } : { type: 'text', text: t });

describe('예전 메모(그냥 글)는 그대로', () => {
  it.each([
    '',
    '한 줄',
    'A/B 테스트로 버튼 색을 바꿔 봤다.\n전환율이 조금 올랐다.',
    '첫 줄\n\n\n빈 줄 두 개 뒤',
    '  앞에 공백 있는 줄',
    '가격: 3~4만원, 10월~11월',
    'C:\\Users\\me\\ThoughtFlow 폴더',
    'snake_case_name 과 이메일 a_b@c.com',
    '5 * 3 * 2 = 30',
    '끝에 줄바꿈\n',
  ])('%j', (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it('한 줄 = 한 문단, 빈 줄 = 빈 문단', () => {
    expect(markdownToDoc('가\n\n나').content).toEqual([
      { type: 'paragraph', content: [text('가')] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [text('나')] },
    ]);
  });
});

describe('블록', () => {
  it('제목·목록·할 일·인용·코드·구분선', () => {
    const md = [
      '# 여행 계획',
      '## 준비물',
      '### 세부',
      '- 여권',
      '- 충전기',
      '1. 표 사기',
      '2. 숙소 예약',
      '- [ ] 환전하기',
      '- [x] 휴가 신청',
      '> 가장 싼 날은 화요일',
      '```',
      'const a = 1;',
      '  들여쓰기 유지',
      '```',
      '---',
      '끝',
    ].join('\n');
    const doc = markdownToDoc(md);
    expect(doc.content!.map((n) => n.type)).toEqual([
      'heading',
      'heading',
      'heading',
      'bulletList',
      'orderedList',
      'taskList',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'paragraph',
    ]);
    expect(doc.content![5].content!.map((i) => i.attrs!.checked)).toEqual([false, true]);
    expect(doc.content![7].content![0].text).toBe('const a = 1;\n  들여쓰기 유지');
    expect(roundTrip(md)).toBe(md);
  });

  it('안쪽 목록 (2칸 들여쓰기), 4칸·* 표시도 읽는다', () => {
    const md = '- 과일\n  - 사과\n  - 배\n    1. 신고배\n- 채소';
    expect(roundTrip(md)).toBe(md);
    const doc = markdownToDoc('* 과일\n    * 사과\n* 채소');
    expect(docToMarkdown(doc)).toBe('- 과일\n  - 사과\n- 채소');
    expect(doc.content![0].content![0].content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
  });

  it('번호 목록은 시작 번호를 기억하고 이어서 번호를 매긴다', () => {
    expect(roundTrip('3. 셋\n4. 넷')).toBe('3. 셋\n4. 넷');
    expect(roundTrip('1. 가\n1. 나\n1. 다')).toBe('1. 가\n2. 나\n3. 다');
  });

  it('종류가 바뀌거나 빈 줄이 오면 목록이 끝난다', () => {
    const doc = markdownToDoc('- 가\n- [ ] 나\n\n- 다');
    expect(doc.content!.map((n) => n.type)).toEqual(['bulletList', 'taskList', 'paragraph', 'bulletList']);
    expect(roundTrip('- 가\n- [ ] 나\n\n- 다')).toBe('- 가\n- [ ] 나\n\n- 다');
  });

  it('인용 안의 여러 줄과 목록', () => {
    const md = '> 첫 줄\n>\n> - 목록\n일반';
    expect(roundTrip(md)).toBe(md);
    expect(markdownToDoc(md).content![0].content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'bulletList']);
  });

  it('목록 표시처럼 보이는 그냥 글은 \\ 로 지킨다', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('- 그냥 글')] },
        { type: 'paragraph', content: [text('1. 이것도')] },
        { type: 'paragraph', content: [text('# 해시')] },
        { type: 'paragraph', content: [text('> 꺾쇠')] },
        { type: 'paragraph', content: [text('---')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('[ ] 글머리')] }] }] },
      ],
    };
    const md = docToMarkdown(doc);
    expect(md).toBe('\\- 그냥 글\n1\\. 이것도\n\\# 해시\n\\> 꺾쇠\n\\---\n- \\[ ] 글머리');
    expect(markdownToDoc(md)).toEqual(doc);
  });

  it('빈 항목, 항목 안의 빈 줄', () => {
    const md = '- \n- 둘\n  \n  둘의 둘째 문단';
    expect(roundTrip(md)).toBe(md);
    expect(markdownToDoc(md).content![0].content![1].content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('닫히지 않은 코드는 끝까지 코드', () => {
    expect(markdownToDoc('```js\nlet a').content).toEqual([{ type: 'codeBlock', attrs: { language: 'js' }, content: [text('let a')] }]);
  });

  it('#### 이상은 제목3으로', () => {
    expect(roundTrip('#### 작은 제목')).toBe('### 작은 제목');
  });
});

describe('글자 꾸미기', () => {
  it('굵게·기울임·취소선·코드', () => {
    expect(parseInline('**굵게** *기울임* ~~취소~~ `코드`')).toEqual([
      text('굵게', 'bold'),
      text(' '),
      text('기울임', 'italic'),
      text(' '),
      text('취소', 'strike'),
      text(' '),
      text('코드', 'code'),
    ]);
  });

  it("한국어 조사가 바로 붙어도 굵게: **'중요'**합니다", () => {
    expect(parseInline("**'중요'**합니다")).toEqual([text("'중요'", 'bold'), text('합니다')]);
  });

  it('겹친 꾸미기: ***둘 다***, **굵게 *안쪽 기울임***', () => {
    expect(parseInline('***둘 다***')).toEqual([text('둘 다', 'bold', 'italic')]);
    expect(parseInline('**굵게 *안쪽***')).toEqual([text('굵게 ', 'bold'), text('안쪽', 'bold', 'italic')]);
  });

  it('짝이 없거나 공백에 붙은 표시는 그대로 글자', () => {
    expect(parseInline('별 * 하나')).toEqual([text('별 * 하나')]);
    expect(parseInline('**닫히지 않음')).toEqual([text('**닫히지 않음')]);
    expect(parseInline('** 공백 **')).toEqual([text('** 공백 **')]);
  });

  it('꾸미기 안팎의 공백은 표시 밖으로 (다시 읽어도 같은 모양)', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('가 '), text(' 굵게 ', 'bold'), text('나')] }] };
    const md = docToMarkdown(doc);
    expect(md).toBe('가  **굵게** 나');
    expect(roundTrip(md)).toBe(md);
  });

  it('글자로 쓴 * ` ~~ \\ 는 \\ 로 지켜서 되살린다', () => {
    const plain = { type: 'doc', content: [{ type: 'paragraph', content: [text('a*b*c `x` ~~y~~ 끝\\')] }] };
    const md = docToMarkdown(plain);
    expect(markdownToDoc(md)).toEqual(plain);
  });

  it('코드 안의 ` 와 \\', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('a`b\\', 'code')] }] };
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  it('제목과 목록 안의 꾸미기', () => {
    const md = '# **굵은** 제목\n- [x] ~~끝낸 일~~\n1. `npm ci` 실행';
    expect(roundTrip(md)).toBe(md);
  });
});

describe('어떤 글이든 한 번 읽고 쓰면 그 뒤로는 바뀌지 않는다', () => {
  const samples = [
    '* 별 목록\n+ 더하기 목록',
    '   - 들여쓴 목록\n  1) 괄호 번호',
    '**열림 *섞임** 닫힘*',
    '~~~\n물결 코드\n~~~',
    '>인용 공백 없음\n>> 두 겹',
    '- [X] 대문자 X\n- [ ]\n- [x]',
    '___\n***\n- - -',
    '\\# 이스케이프 \\* 별 \\\\ 역슬래시',
    '`닫히지 않은 코드\n``\n`',
    '1. 가\n   - 안쪽\n2. 나',
  ];
  it.each(samples)('%j', (md) => {
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
    expect(markdownToDoc(once)).toEqual(markdownToDoc(md));
  });

  it('무작위 글자 조합', () => {
    const chars = ['a', '가', ' ', '*', '**', '~', '~~', '`', '\\', '-', '#', '>', '1.', '[ ]', '\n', '_', '  '];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 400; k++) {
      let md = '';
      const len = 1 + Math.floor(rand() * 30);
      for (let i = 0; i < len; i++) md += chars[Math.floor(rand() * chars.length)];
      const once = roundTrip(md);
      expect(roundTrip(once), JSON.stringify(md)).toBe(once);
    }
  });
});
