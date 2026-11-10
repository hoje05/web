/**
 * ThoughtFlow MCP 서버 정의 (도구 목록·설명·입력 형식).
 *
 * 같은 정의를 두 곳에서 쓴다.
 *  - Claude 데스크톱: mcp/stdio.ts (확장 .mcpb 안에서 실행) → 로컬 브리지로 앱에 전달
 *  - ChatGPT: Electron main의 HTTPS(터널) 엔드포인트 → 바로 앱에 전달
 * 도구가 실제로 하는 일은 앱 화면 쪽(src/ai/aiBridge.ts)이 처리하고, 여기서는 call()로 넘기기만 한다.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AiResponse, AiToolName } from '../src/ai/protocol';

export type CallTool = (tool: AiToolName, args: Record<string, unknown>, client: string) => Promise<AiResponse>;

export const SERVER_INSTRUCTIONS = `ThoughtFlow is the user's desktop "thinking map": each Box holds one thought, action or result, and each Route (arrow) shows how one led to the next (thought → action → result → new thought). These tools read and edit the project that is currently open in the user's ThoughtFlow app.

How to use it well:
- Organizing a conversation: when the user asks to organize, summarize, map or record the conversation (e.g. "정리해줘", "ThoughtFlow에 정리"), put it in a NEW project: call create_project once with a short topic name AND the boxes/routes, so a fresh empty board opens with the whole flow on it. Only add to the currently open project (or open another with list_projects/open_project) when the user says so, e.g. "이어서", "지금 보드에", or names a project.
- Ground the conversation in the board. When the user talks about their plans, ideas or anything they may have recorded, call get_board first and refer to their boxes by title. Use read_box for a box's full note and search_boxes to find related boxes.
- Record the conversation's structure as it develops. When the discussion produces new thoughts, questions, decisions, actions or results, add them with add_flow (usually one call per conversational step; each call is a single undo step for the user).
  - Box title: short (about 5–40 characters), in the user's language. Put details, reasons and quotes in the note.
  - Connect new boxes to the existing box they follow from (use "after" or explicit routes with existing box ids) instead of leaving disconnected islands. Reuse existing boxes by id rather than creating duplicates.
  - Routes point forward in time or causality (cause → effect, idea → action → outcome).
- Use update_box (append_note) to add details to an existing box, connect_boxes to link related boxes, and focus_box to show the user the box you are talking about.
- Notes are shown in a Notion-like editor and stored as simple Markdown where one line is one block: "# " / "## " / "### " headings, "- " bullets, "1. " numbered items, "- [ ] " to-dos ("- [x] " done), "> " quotes, "---" divider, **bold**, *italic*, ~~strike~~, \`code\`. Indent a list line by 2 spaces to nest it. Do not leave blank lines between items of one list. Use to-dos for next actions the user decided on.
- Charts: to show numbers in a note (results, comparisons, trends, shares), put a chart block on its own lines — ThoughtFlow draws it as a real chart:
  \`\`\`chart
  type: bar            (bar = compare items, default · line = change over time · pie = share of a whole, up to 6 parts)
  title: 청크 크기별 정확도
  unit: %
  크기, 정확도, 속도     (first row = column names: first column = item labels, the others = series, up to 8)
  256, 71, 120
  512, 78, 140
  \`\`\`
  Use plain numbers (no thousands separators unless the cell is quoted). Prefer append_note to add a chart below the user's writing.
- Pictures in notes appear as lines like ![설명](assets/…png). Keep these lines exactly as they are when you rewrite a note; you cannot add new pictures yourself (the user adds them in the app).
- Never delete or rewrite the user's own content unless they ask. Deleting only works if the user allowed it in ThoughtFlow's AI settings.
- After changing the board, briefly tell the user what you added or changed. The user can undo any change with Ctrl+Z in ThoughtFlow.

Plans (워크플로우): some boxes are "plan blocks" (get_board marks them [계획 블록 · 상태]). Together they form a plan the USER designed for you to carry out exactly. The user's goal is that you build what they planned, the way they planned it.
- Read the plan with get_plan, pick the next step with next_steps, call start_step to begin it — it returns that step's work order: what to do, the done-when checklist, the deliverables, references, and the skills / slash commands / connectors / sub-agent to use and how.
- Do exactly what the work order says: make only the listed deliverables, follow the references, use the listed tools (a skill → the Skill tool; a command → run that slash command; a connector → that MCP server's tools; a sub-agent → the Agent tool with that subagent_type) and nothing on the "하지 말 것" list.
- You cannot create or edit the plan. update_box, delete_items, connect_boxes and add_flow refuse to change plan blocks or the routes between them. If the plan looks wrong or incomplete, call propose_change and keep following the plan (or ask_user and wait).
- When a decision is not covered by the plan, call ask_user and wait for the answer instead of guessing. Record progress notes with log_step.
- Steps that need approval: call request_approval and wait. Steps assigned to a person: wait until the user finishes them. Steps with review: after finish_step, wait until the user accepts the review.
- Finish with finish_step: report where each deliverable was made, check every done-when item yourself with concrete evidence (pass true/false), and list the tools you actually used. If a criterion fails, keep working or call fail_step with the reason. Never mark something passed that you did not verify.
- At the start of a plan, call report_capabilities with the names of the skills, slash commands, connectors (MCP servers) and sub-agents you actually have, so missing tools are found before work starts.`;

const boxRef = (what: string) =>
  z.string().min(1).describe(`${what}: a box id such as "n_abc123" from get_board (an exact, unique box title also works)`);

const flowBoxes = z
  .array(
    z.object({
      key: z.string().optional().describe('Name for this new box, used only inside this call to refer to it in routes'),
      title: z.string().min(1).describe("Short text shown on the box (about 5–40 characters, in the user's language)"),
      note: z.string().optional().describe('Longer details, reasons or quotes shown in the side panel (Markdown: - bullets, - [ ] to-dos, **bold**, ```chart blocks for numbers …)'),
    }),
  )
  .max(60);

const flowRoutes = z
  .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
  .optional()
  .describe('Routes (arrows) to draw: from → to. Omit to chain the boxes in order.');

export function createMcpServer(call: CallTool, version: string): McpServer {
  const server = new McpServer({ name: 'thoughtflow', title: 'ThoughtFlow', version }, { instructions: SERVER_INSTRUCTIONS });

  const run = (tool: AiToolName) => async (args: Record<string, unknown>) => {
    const client = server.server.getClientVersion()?.name ?? '';
    const res = await call(tool, args ?? {}, client);
    return { content: [{ type: 'text' as const, text: res.text }], ...(res.isError ? { isError: true } : {}) };
  };
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const additive = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    'get_board',
    {
      title: '보드 읽기',
      description:
        'Read the whole open ThoughtFlow project as an indented outline of flows (roots first, "→" = route direction), with box ids, notes, and the box the user is currently looking at. Call this before discussing or extending the user\'s thinking.',
      inputSchema: {
        include_notes: z.boolean().optional().describe('Include box notes (default true). Use false for a quick overview of a large board.'),
      },
      annotations: readOnly,
    },
    run('get_board'),
  );

  server.registerTool(
    'read_box',
    {
      title: 'Box 자세히 보기',
      description: "Read one box: full title, the complete note, and its incoming (←) and outgoing (→) boxes.",
      inputSchema: { id: boxRef('The box') },
      annotations: readOnly,
    },
    run('read_box'),
  );

  server.registerTool(
    'search_boxes',
    {
      title: 'Box 검색',
      description: 'Find boxes whose title or note contains all the given words (case-insensitive). Returns ids and note snippets.',
      inputSchema: { query: z.string().min(1).describe('Words to look for') },
      annotations: readOnly,
    },
    run('search_boxes'),
  );

  server.registerTool(
    'add_flow',
    {
      title: '흐름 추가',
      description: `Add one or more boxes and the routes between them in a single step; ThoughtFlow lays them out automatically (left → right, branches stacked).
- Without "routes", the boxes are chained in the given order (1 → 2 → 3 …).
- With "routes", only the listed routes are drawn. "from"/"to" may be a new box's key or an existing box id.
- "after": an existing box id; every new box without an incoming route is connected after it.
Example: {"after":"n_abc","boxes":[{"key":"q","title":"예산이 문제"},{"key":"a","title":"기차로 가기"},{"key":"b","title":"날짜 바꾸기"}],"routes":[{"from":"q","to":"a"},{"from":"q","to":"b"}]}`,
      inputSchema: {
        boxes: flowBoxes.min(1).describe('New boxes, in flow order'),
        routes: flowRoutes,
        after: z.string().optional().describe('Existing box id to continue from'),
      },
      annotations: additive,
    },
    run('add_flow'),
  );

  server.registerTool(
    'update_box',
    {
      title: 'Box 고치기',
      description: "Change a box's title, replace its note, or append text to its note (preferred for adding details without losing the user's writing).",
      inputSchema: {
        id: boxRef('The box to change'),
        title: z.string().optional().describe('New title'),
        note: z.string().optional().describe('Replaces the whole note — only when the user asked to rewrite it'),
        append_note: z
          .string()
          .optional()
          .describe('Markdown appended to the end of the note as new lines (e.g. "- [ ] 새로 정한 할 일", or a ```chart block to draw numbers as a chart)'),
      },
      annotations: { ...additive, idempotentHint: false },
    },
    run('update_box'),
  );

  server.registerTool(
    'connect_boxes',
    {
      title: 'Box 잇기',
      description: 'Draw a route (arrow) from one existing box to another. Does nothing if that route already exists.',
      inputSchema: { from: boxRef('Start box'), to: boxRef('End box') },
      annotations: { ...additive, idempotentHint: true },
    },
    run('connect_boxes'),
  );

  server.registerTool(
    'delete_items',
    {
      title: '지우기',
      description:
        "Delete boxes (with their routes) and/or single routes. Only works if the user enabled deleting in ThoughtFlow's AI settings, and only use it when the user asked for it.",
      inputSchema: {
        box_ids: z.array(z.string().min(1)).optional().describe('Boxes to delete'),
        routes: z
          .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
          .optional()
          .describe('Routes to delete, given by their start and end box'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    run('delete_items'),
  );

  server.registerTool(
    'focus_box',
    {
      title: 'Box 보여 주기',
      description: "Select a box in the user's ThoughtFlow window, center it and open its note panel — use it to point at what you are talking about.",
      inputSchema: { id: boxRef('The box to show') },
      annotations: { ...additive, idempotentHint: true },
    },
    run('focus_box'),
  );

  server.registerTool(
    'list_projects',
    {
      title: '프로젝트 목록',
      description: 'List the user\'s ThoughtFlow projects (each is a separate board), most recently changed first, marking the open one.',
      inputSchema: {},
      annotations: readOnly,
    },
    run('list_projects'),
  );

  server.registerTool(
    'open_project',
    {
      title: '프로젝트 열기',
      description: 'Switch the ThoughtFlow window to another project by name (the current one is saved first). Returns the newly opened board.',
      inputSchema: { name: z.string().min(1).describe('Project name from list_projects') },
      annotations: { ...additive, idempotentHint: true },
    },
    run('open_project'),
  );

  server.registerTool(
    'create_project',
    {
      title: '새 프로젝트',
      description: `Open a brand-new, empty board as a new project (the current one is saved first) and, optionally, fill it with boxes and routes in the same step. This is the default way to organize a conversation.
- name: short topic name in the user's language. If it is taken, a number is added ("여행 계획 2").
- boxes/routes: same as add_flow (new box keys only — the new board has no other boxes). Without routes the boxes are chained in order.
Example: {"name":"제주도 여행","boxes":[{"key":"a","title":"여행 가고 싶다"},{"key":"b","title":"비행기 표 비쌈","note":"왕복 40만원"},{"key":"c","title":"배편 알아보기"}],"routes":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}`,
      inputSchema: {
        name: z.string().min(1).max(120).describe('Project name'),
        boxes: flowBoxes.optional().describe('Boxes to put on the new board, in flow order'),
        routes: flowRoutes,
      },
      annotations: additive,
    },
    run('create_project'),
  );

  // ───────────── 계획 진행 ─────────────

  const stepRef = z.string().min(1).describe('The plan block (step): its box id from get_plan (an exact, unique title also works)');
  const toolLists = {
    skills: z.array(z.string().min(1)).max(300).optional().describe('Skill names, e.g. "dataviz", "my-plugin:release-check"'),
    commands: z.array(z.string().min(1)).max(300).optional().describe('Slash commands, e.g. "/review"'),
    connectors: z.array(z.string().min(1)).max(300).optional().describe('Connector / MCP server names, e.g. "github", "Gmail"'),
  };
  const planWrite = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    'get_plan',
    {
      title: '계획 읽기',
      description:
        "Read the user's plan on the open board: overall goal, working folder, permissions, progress, the steps in run order with every instruction (task, done-when checklist, deliverables, references, tools, design note), results, questions and answers. With id, returns that one step's work order instead (use it to check for answers to your questions).",
      inputSchema: { id: z.string().optional().describe('Optional: a step id to read only that step') },
      annotations: readOnly,
    },
    run('get_plan'),
  );

  server.registerTool(
    'next_steps',
    {
      title: '다음 단계',
      description: 'List the plan steps you can start now, in order. If none, explains what the plan is waiting for (your running step, an answer, an approval, a review, a person, a failure) or that the plan is complete.',
      inputSchema: {},
      annotations: readOnly,
    },
    run('next_steps'),
  );

  server.registerTool(
    'start_step',
    {
      title: '단계 시작',
      description:
        "Mark a step as running and get its full work order. Refused if earlier steps are not finished, the step is the user's own, it needs approval first, or too many steps are already running.",
      inputSchema: { id: stepRef },
      annotations: { ...planWrite, idempotentHint: true },
    },
    run('start_step'),
  );

  server.registerTool(
    'request_approval',
    {
      title: '시작 승인 요청',
      description: 'Ask the user to approve starting a step that requires approval. Then wait; once approved it appears in next_steps again.',
      inputSchema: { id: stepRef, why: z.string().optional().describe('What you are about to do in this step (shown to the user)') },
      annotations: { ...planWrite, idempotentHint: true },
    },
    run('request_approval'),
  );

  server.registerTool(
    'log_step',
    {
      title: '진행 기록',
      description: 'Add a short progress note to a running step (shown in its history). Does not change the plan.',
      inputSchema: { id: stepRef, note: z.string().min(1).max(2000).describe('What you did or found') },
      annotations: planWrite,
    },
    run('log_step'),
  );

  server.registerTool(
    'ask_user',
    {
      title: '사용자에게 묻기',
      description:
        "Ask the user a question about a running step when the plan does not decide something. The step waits ('질문 중') until the user answers in ThoughtFlow; read the answer with get_plan(id). Do not guess instead.",
      inputSchema: { id: stepRef, question: z.string().min(1).max(4000).describe('The question, with the options you see if any') },
      annotations: planWrite,
    },
    run('ask_user'),
  );

  server.registerTool(
    'finish_step',
    {
      title: '단계 끝내기',
      description: `Report a step as finished. ThoughtFlow checks the report against the plan and refuses it unless:
- every deliverable (numbered from 1 in the work order) has the place where you made it,
- every done-when item (numbered from 1) is reported with pass=true and concrete evidence you verified,
- "used" lists the tools you actually used (empty lists if none).
Steps with review then wait for the user's review; others become done.
Example: {"id":"n_abc","summary":"보고서 초안 작성","outputs":[{"deliverable":1,"path":"docs/report.md"}],"criteria":[{"item":1,"pass":true,"evidence":"표 3개, 그래프 2개 포함 확인"}],"used":{"skills":["report-writer"],"commands":[],"connectors":[]}}`,
      inputSchema: {
        id: stepRef,
        summary: z.string().min(1).max(4000).describe('What you did, briefly'),
        outputs: z
          .array(z.object({ deliverable: z.number().int().min(1), path: z.string().min(1).describe('File path, URL or place where it was made') }))
          .max(50)
          .describe('One entry per deliverable'),
        criteria: z
          .array(z.object({ item: z.number().int().min(1), pass: z.boolean(), evidence: z.string().describe('How you verified it') }))
          .max(50)
          .describe('One entry per done-when item'),
        used: z
          .object({
            ...toolLists,
            subagent: z.object({ type: z.string().min(1), model: z.string().optional() }).optional().describe('Sub-agent you used, if any'),
          })
          .describe('Tools you actually used in this step'),
      },
      annotations: planWrite,
    },
    run('finish_step'),
  );

  server.registerTool(
    'fail_step',
    {
      title: '단계 실패',
      description: 'Mark a step as failed with the reason (e.g. a done-when item cannot be met). Later steps stay blocked until the user decides to redo or skip it.',
      inputSchema: { id: stepRef, reason: z.string().min(1).max(2000) },
      annotations: planWrite,
    },
    run('fail_step'),
  );

  server.registerTool(
    'propose_change',
    {
      title: '계획 수정 제안',
      description: 'Suggest a change to the plan (it stays unchanged until the user edits it). Use it when the plan looks wrong, incomplete or impossible.',
      inputSchema: {
        step_id: z.string().optional().describe('The step it is about, if any'),
        change: z.string().min(1).max(4000).describe('What should change'),
        why: z.string().max(2000).optional().describe('Why'),
      },
      annotations: planWrite,
    },
    run('propose_change'),
  );

  server.registerTool(
    'get_catalog',
    {
      title: '도구 목록',
      description: "List the skills, slash commands, connectors (MCP servers) and sub-agents ThoughtFlow found on this PC (user folder, the plan's working folder, plugins, Claude Desktop settings).",
      inputSchema: { kind: z.enum(['skill', 'command', 'connector', 'subagent']).optional().describe('Only this kind') },
      annotations: readOnly,
    },
    run('get_catalog'),
  );

  server.registerTool(
    'report_capabilities',
    {
      title: '쓸 수 있는 도구 알리기',
      description:
        'Tell ThoughtFlow the names of the skills, slash commands, connectors (MCP servers) and sub-agent types you can actually use now. Returns the plan tools you do not have, so you can tell the user before starting. Call it once at the start of a plan.',
      inputSchema: { ...toolLists, subagents: z.array(z.string().min(1)).max(100).optional().describe('Sub-agent types, e.g. "general-purpose"') },
      annotations: { ...planWrite, idempotentHint: true },
    },
    run('report_capabilities'),
  );

  server.registerPrompt(
    'run_plan',
    {
      title: '계획대로 진행하기',
      description: 'ThoughtFlow에 사용자가 만든 계획을 읽고, 단계마다 지정한 도구로, 계획에 적힌 그대로 진행합니다.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'ThoughtFlow에 열려 있는 내 계획을 내가 설계한 그대로 진행해 줘.',
              '1. get_plan으로 계획 전체를 읽고, report_capabilities로 네가 지금 쓸 수 있는 스킬·명령어·커넥터·서브 에이전트 이름을 알려 줘. 계획에 있는데 없는 도구가 있으면 시작하기 전에 나에게 말해 줘.',
              '2. next_steps로 다음 단계를 고르고 start_step으로 시작해. 받은 작업 지시서를 그대로 따라.',
              '3. 단계에 지정된 도구를 써: 스킬은 Skill 도구로, 명령어는 그 슬래시 명령으로, 커넥터는 그 MCP 서버의 도구로, 서브 에이전트는 Agent 도구(subagent_type)로.',
              '4. 만들 것에 적힌 것만 만들고, 참고 자료를 따르고, 하지 말 것은 하지 마. 계획에 없는 것을 더하지 마.',
              '5. 완료 기준을 하나씩 직접 확인하고 근거와 함께 finish_step으로 보고해. 통과하지 못하면 계속 고치거나 fail_step으로 알려 줘.',
              '6. 계획에 없는 결정은 ask_user로 묻고 기다려. 계획이 틀려 보이면 propose_change로 제안만 하고 계획대로 해.',
              '7. 승인·검토·사람 단계는 내가 ThoughtFlow에서 처리할 때까지 기다려. 계획에 없는 위험한 일(지우기, 배포, 돈이 드는 일 등)은 하지 마.',
              '8. 단계를 끝낼 때마다 다음 단계로 넘어가고, 더 할 단계가 없으면 next_steps가 알려 주는 이유를 나에게 짧게 말해 줘.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'organize_conversation',
    {
      title: '대화를 ThoughtFlow에 정리하기',
      description: '지금까지의 대화를 ThoughtFlow의 새 프로젝트(빈 보드)에 Box와 Route로 정리합니다.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: '지금까지 우리 대화의 흐름을 ThoughtFlow의 새 프로젝트에 정리해줘. create_project 한 번으로 주제 이름을 붙인 빈 보드를 만들고, 생각·질문·결정·행동·결과를 짧은 제목의 Box로, 어떤 생각에서 어떤 행동과 결과가 나왔는지를 Route로 함께 넣어 줘. 자세한 이유나 인용은 Box의 메모(note)에 적어 줘.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'talk_from_board',
    {
      title: '보드를 바탕으로 이야기하기',
      description: 'ThoughtFlow에 적어 둔 생각의 흐름을 읽고 그걸 바탕으로 대화를 시작합니다.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: 'ThoughtFlow에 지금 열려 있는 내 생각의 흐름을 읽고(get_board), 흐름을 짧게 요약해 줘. 그다음 아직 결과가 없는 행동이나 이어지지 않은 생각을 짚어 주고, 다음에 무엇을 생각하거나 해 보면 좋을지 같이 이야기하자. 우리가 새로 정한 내용은 보드에 이어서 기록해 줘.',
          },
        },
      ],
    }),
  );

  return server;
}
