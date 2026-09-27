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
- Ground the conversation in the board. When the user talks about their plans, ideas or anything they may have recorded, call get_board first and refer to their boxes by title. Use read_box for a box's full note and search_boxes to find related boxes.
- Record the conversation's structure as it develops. When the discussion produces new thoughts, questions, decisions, actions or results, add them with add_flow (usually one call per conversational step; each call is a single undo step for the user).
  - Box title: short (about 5–40 characters), in the user's language. Put details, reasons and quotes in the note.
  - Connect new boxes to the existing box they follow from (use "after" or explicit routes with existing box ids) instead of leaving disconnected islands. Reuse existing boxes by id rather than creating duplicates.
  - Routes point forward in time or causality (cause → effect, idea → action → outcome).
- Use update_box (append_note) to add details to an existing box, connect_boxes to link related boxes, and focus_box to show the user the box you are talking about.
- Never delete or rewrite the user's own content unless they ask. Deleting only works if the user allowed it in ThoughtFlow's AI settings.
- After changing the board, briefly tell the user what you added or changed. The user can undo any change with Ctrl+Z in ThoughtFlow.`;

const boxRef = (what: string) =>
  z.string().min(1).describe(`${what}: a box id such as "n_abc123" from get_board (an exact, unique box title also works)`);

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
        boxes: z
          .array(
            z.object({
              key: z.string().optional().describe('Name for this new box, used only inside this call to refer to it in routes'),
              title: z.string().min(1).describe("Short text shown on the box (about 5–40 characters, in the user's language)"),
              note: z.string().optional().describe('Longer details, reasons or quotes shown in the side panel'),
            }),
          )
          .min(1)
          .max(60)
          .describe('New boxes, in flow order'),
        routes: z
          .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
          .optional()
          .describe('Routes (arrows) to draw: from → to. Omit to chain the boxes in order.'),
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
        append_note: z.string().optional().describe('Text appended to the end of the note'),
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
      description: 'Create a new, empty project with this name and open it (the current one is saved first). Use for a clearly separate topic.',
      inputSchema: { name: z.string().min(1).max(120).describe('Project name') },
      annotations: additive,
    },
    run('create_project'),
  );

  server.registerPrompt(
    'organize_conversation',
    {
      title: '대화를 ThoughtFlow에 정리하기',
      description: '지금까지의 대화를 ThoughtFlow 보드에 Box와 Route로 정리합니다.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: '지금까지 우리 대화의 흐름을 ThoughtFlow에 정리해줘. 먼저 get_board로 보드를 보고, 이미 있는 Box는 다시 만들지 말고 이어서 붙여 줘. 생각·질문·결정·행동·결과를 짧은 제목의 Box로 만들고, 어떤 생각에서 어떤 행동과 결과가 나왔는지 Route로 이어 줘.',
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
