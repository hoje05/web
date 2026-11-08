# ThoughtFlow 워크플로우 모드 — 수정 계획

> 목표: ThoughtFlow 보드를 **실행 가능한 계획(워크플로우)** 으로 쓴다.
> 사람이 보드에 계획을 그리고, 각 블록에 **어떤 스킬 · 명령어 · 커넥터 · 서브 에이전트**를 쓸지 정해 두면,
> Claude가 그 보드를 읽고 **순서대로 진행하면서 상태와 결과를 보드에 다시 적는다.**

---

## 0. 핵심 원칙 — "내가 설계한 계획대로" 만들게 한다

계획은 **사람이 쓰고**, Claude는 **그 계획을 그대로 실행하는 쪽**이다. 그래서 아래를 모든 기능의 기준으로 삼는다.

| 원칙 | 어떻게 지키나 |
|---|---|
| **계획은 사람만 고친다** | Claude의 기본 권한은 "상태·결과 적기"뿐. 할 일·완료 기준·만들 것·도구·순서는 Claude가 바꿀 수 없다. 바꿔야 할 것 같으면 `propose_change`로 **제안만** 하고, 사용자가 앱에서 받아들여야 반영된다 |
| **순서대로** | 앞 단계가 끝나지 않은 단계는 `start_step`이 거부한다. 한 번에 하나씩(기본). |
| **정한 결과물을 만든다** | 단계마다 **만들 것**(파일 경로·형식·내용 조건)을 적는다. Claude는 그 목록에 맞춰 만들고, 끝낼 때 각 항목을 실제로 만든 위치와 함께 보고해야 한다 |
| **정한 도구를 쓴다** | 끝낼 때 **실제로 쓴 스킬·명령어·커넥터·서브 에이전트**를 보고하게 하고, 앱이 지정한 것과 비교해 다르면 ⚠ 표시 |
| **완료 기준을 하나씩 확인** | 완료 기준을 체크리스트로 적고, Claude는 항목마다 통과/실패와 근거를 보고. 하나라도 실패면 완료로 바꿀 수 없다 |
| **사람이 확인하고 넘어간다** | 단계별로 "검토 후 다음으로"를 켜면 Claude가 끝내도 **검토 대기**가 되고, 사용자가 승인해야 다음 단계가 열린다 |
| **모르면 묻는다** | 계획에 없는 결정이 필요하면 추측하지 말고 `ask_user`로 질문 → 앱에 질문이 뜨고, 답을 적으면 Claude가 이어서 진행 |
| **기록이 남는다** | 실행할 때의 계획 버전, 단계별 시작·끝·사용 도구·결과물·질문과 답이 남아, 계획과 결과를 나란히 비교할 수 있다 |

---

## 1. 기본 개념 — 지금 구조를 그대로 살린다

| 지금 | 워크플로우에서 |
|---|---|
| 보드(프로젝트) | **계획 하나** (목표, 기본 설정) |
| Box | **계획 블록(단계)** — 할 일, 완료 기준, 쓸 도구, 상태 |
| Route (A → B) | **순서 / 의존 관계** — A가 끝나야 B를 시작 |
| 메모 | 단계의 자세한 지시 · 진행 기록 · 결과 |
| 태그 | 분류 (예: `조사`, `코딩`, `검토`) |
| 첨부 | 단계의 입력 자료 · 결과물 |
| AI 변경 알림 + Ctrl+Z | Claude가 바꾼 상태·결과도 그대로 되돌리기 가능 |

- 모든 Box를 강제로 단계로 만들지 않는다. Box마다 **"계획 블록으로 만들기"** 를 켠 것만 단계가 된다.
  생각 정리용 보드는 지금처럼 쓰고, 생각과 단계를 한 보드에 섞어 쓸 수도 있다.
- 순서 판단은 **단계끼리 이어진 Route**로만 한다. 생각 Box와 이어진 Route는 참고 관계로 본다.

---

## 2. 데이터 모델 (파일 형식 v4)

`src/model/types.ts`에 추가. 예전 파일(v1~v3)은 그대로 열리고, 저장하면 v4가 된다.

```ts
/** Box가 계획 블록이면 있음 */
interface StepInfo {
  status: 'todo' | 'ready' | 'running' | 'waiting' | 'asking' | 'review' | 'done' | 'failed' | 'skipped';
  /** 이 단계에서 할 일 (Claude에게 주는 지시) — 길면 메모에 */
  goal: string;
  /** 완료 기준 (체크리스트) — 하나씩 통과해야 완료 */
  doneWhen: string[];
  /** 만들 것 — 이 단계의 결과물 명세 (예: { path: "src/login.tsx", spec: "이메일·비밀번호 입력, 오류 문구 표시" }) */
  deliverables: { path?: string; spec: string }[];
  /** 꼭 읽고 따를 참고 자료 (첨부 id, 파일 경로, 링크, 다른 단계의 결과물) */
  references: string[];
  /** Claude가 끝내도 사람이 검토·승인해야 다음 단계가 열림 */
  review: boolean;
  /** 누가 하는가 */
  assignee: 'claude' | 'human';
  /** 시작 전에 사람 승인이 필요한가 (위험한 단계: 배포, 메일 보내기 …) */
  approval: 'auto' | 'ask';
  /** 쓸 도구 */
  resources: StepResources;
  /** 마지막 결과 요약 / 결과물 (파일 경로, 링크) */
  result?: {
    summary: string;
    outputs: { deliverable: number; path: string }[];       // 만들 것 각 항목 → 실제 만든 위치
    criteria: { item: number; pass: boolean; evidence: string }[]; // 완료 기준 각 항목의 확인 결과
    used: StepResources;                                     // 실제로 쓴 도구 (지정한 것과 비교)
    planVersion: string;                                     // 실행할 때의 계획 버전
    at: string; by: string;
  };
  /** Claude의 질문과 사용자의 답 */
  questions?: { at: string; question: string; answer?: string }[];
  /** 진행 기록 (상태가 바뀔 때마다 한 줄) */
  log: { at: string; by: string; status: StepInfo['status']; note?: string }[];
}

interface StepResources {
  skills: string[];       // 예: "dataviz", "pdf", "my-team:release-check"
  commands: string[];     // 예: "/review", "/deploy staging"
  connectors: string[];   // 예: "Gmail", "Linear", "github", "Supabase"
  subagent?: {            // 이 단계를 맡길 서브 에이전트
    type: string;         // 예: "Explore", "Plan", "general-purpose", 사용자 정의 에이전트 이름
    model?: string;       // 비우면 기본값
    instructions?: string;// 서브 에이전트에게 따로 줄 지시
  };
  /** 이 단계에서 쓰면 안 되는 것 (예: "배포 명령 금지") — 선택 */
  avoid?: string[];
}

interface BoxNode { …; step?: StepInfo }

/** 보드 전체 설정 */
interface WorkflowMeta {
  goal: string;                 // 계획 전체 목표
  workingDir?: string;          // Claude Code가 작업할 폴더/저장소 (선택)
  defaults: Partial<StepResources>; // 모든 단계에 기본으로 붙는 도구
  stepPermission: 'read' | 'status'; // AI가 할 수 있는 일 — 기본 'status'. 계획 고치기는 제안(propose_change)만
  /** 계획 버전 — 사람이 계획을 고칠 때마다 바뀜 (실행 기록과 묶음) */
  version: string;
  /** 진행 중에는 계획 잠금 (실수로 바꾸지 않게, 풀면 버전이 올라감) */
  locked: boolean;
  /** 동시에 진행할 수 있는 단계 수 — 기본 1 */
  parallel: number;
}
interface Doc { …; workflow?: WorkflowMeta }
```

- Route는 지금 그대로 둔다(방향 = 순서). 다음 단계에서 필요하면 `RouteEdge.when?: 'done' | 'failed'`
  (실패했을 때 가는 길)을 추가한다 — 처음에는 넣지 않는다.
- 상태 `ready`는 저장하지 않고 **계산**한다: 앞 단계가 모두 `done/skipped`이고 자기는 `todo`이면 ready.

---

## 3. 새 모듈 `src/workflow/` (순수 함수, 단위 테스트 대상)

| 파일 | 하는 일 |
|---|---|
| `graph.ts` | 단계만 골라 순서 그래프 만들기, 위상 정렬(진행 순서), **ready 단계 계산**, 순환 찾기, 막힌 단계(앞 단계 실패) 찾기, 전체 진행률 |
| `transitions.ts` | 상태 바꾸기 규칙: `todo → running → done/failed`, `approval: ask`이면 `waiting`을 거쳐야 함, 앞 단계가 안 끝났으면 시작 거부, 되돌리기 가능한 doc 연산으로 |
| `resources.ts` | 도구 이름 정리·중복 제거, 보드 기본값 + 단계 설정 합치기, 카탈로그에 없는 이름 표시 |
| `planText.ts` | Claude에게 줄 **계획 설명 글** + 구조화 JSON 만들기 (지금의 board→text를 확장) |
| `templates.ts` | 보드를 계획 템플릿으로 저장/불러오기 (상태·기록은 비우고) |

`src/model/docOps.ts`에 `setStep`, `updateStep`, `appendStepLog`, `setWorkflowMeta` 추가 → 모두 Undo 한 칸.

---

## 4. 도구 카탈로그 — "쓸 수 있는 스킬·명령어·커넥터·서브 에이전트" 목록

단계에 도구를 고를 때 자동 완성으로 보여 줄 목록. **이 PC 안에서만 읽고, 아무 곳에도 보내지 않는다.**

`electron/catalog.ts` (새 파일, 읽기 전용):

| 종류 | 읽는 곳 |
|---|---|
| 스킬 | `~/.claude/skills/*/SKILL.md`, 작업 폴더의 `.claude/skills/*/SKILL.md`, 설치된 플러그인의 skills (앞부분 `name`·`description`) |
| 명령어 | `~/.claude/commands/*.md`, `.claude/commands/*.md` (+ 기본 명령어 몇 개) |
| 서브 에이전트 | `~/.claude/agents/*.md`, `.claude/agents/*.md` + 기본 제공(`general-purpose`, `Explore`, `Plan`) |
| 커넥터 | Claude Code `~/.claude.json`·`.mcp.json`의 MCP 서버, Claude 데스크톱 `claude_desktop_config.json`의 `mcpServers` (이미 claudeDesktop.ts에서 찾는 위치) |

- claude.ai 계정에 연결한 커넥터(Gmail, Linear 등)는 PC 파일로는 알 수 없다 → 두 가지로 보완:
  1. **Claude가 직접 알려 주기**: MCP 도구 `report_capabilities` — Claude가 지금 쓸 수 있는 스킬·커넥터·에이전트 이름을 보내면 카탈로그에 "Claude가 알려 줌"으로 추가.
  2. **직접 입력**: 목록에 없어도 이름을 적을 수 있다 (점선으로 "확인 안 됨" 표시).
- 카탈로그 항목: `{ kind, name, description, source: 'user' | 'project' | 'plugin' | 'claude' | 'manual', path? }`
- IPC: `catalog:list(workingDir?)`, `catalog:refresh`.

---

## 5. 화면 (UI)

새 단축키는 넣지 않는다 (기존 단축키와 겹치지 않게). 버튼·메뉴·`/` 메뉴로만.

### 오른쪽 창 — 계획 블록 설정 (`StepProps.tsx`, BoxProps 아래)
- **계획 블록으로 만들기** 스위치 → 켜면 아래가 나타남
- 상태 칩 (할 일 / 진행 중 / 승인 대기 / 질문 / 검토 대기 / 완료 / 실패 / 건너뜀) — 사람이 직접 바꿀 수도 있음
- **할 일** (한 줄 지시, 자세한 설계는 메모에), **완료 기준** 체크리스트, **만들 것** 목록(경로 + 조건), **참고 자료**
- **검토 후 다음으로** 스위치
- 끝난 뒤: **계획 대비 결과** — 만들 것 ↔ 만든 위치, 완료 기준 ✓/✗와 근거, 지정 도구 ↔ 실제 쓴 도구 (다르면 ⚠)
- Claude의 **질문**에 답하는 칸, **계획 수정 제안** 받아들이기/거절
- **담당**: Claude / 사람, **시작 전 승인 필요** 스위치
- **도구** — 태그처럼 칩 + 자동 완성 (`ResourcePicker.tsx`, TagInput을 재사용):
  `스킬 ＋` `명령어 ＋` `커넥터 ＋` / **서브 에이전트** 고르기 (종류, 모델, 따로 줄 지시)
  카탈로그에 없는 이름은 점선, 설명은 마우스를 올리면
- **결과** (요약, 결과물 링크·파일), **진행 기록** (시각 · 누가 · 상태 · 한 줄)

### 보드
- 계획 블록은 왼쪽에 **상태 색 띠** + 작은 상태 아이콘 (진행 중은 천천히 빛남, 완료는 흐리게)
- 도구 개수 아이콘 (🧩 스킬 · ⌘ 명령어 · 🔌 커넥터 · 🤖 에이전트) — 태그처럼 작게
- **지금 할 수 있는 단계(ready)** 는 테두리 강조, 막힌 단계는 점선
- 프로그램 바에 **진행률** (예: `계획 4/9 완료`)

### 계획 창 (`WorkflowPanel.tsx`, 프로그램 바의 새 버튼)
- 계획 목표 · 작업 폴더 · 기본 도구 · AI 권한 설정
- 진행 순서대로 단계 목록 (체크리스트처럼) — 누르면 보드에서 그 Box로
- **Claude로 진행하기** 버튼 → 7장의 방법 안내 + 명령 복사
- 템플릿으로 저장 / 템플릿에서 새 계획
- 계획 점검: 순환, 완료 기준 없는 단계, 카탈로그에 없는 도구, 담당 없는 단계 경고

### `/` 메뉴 · 메뉴
- 메모 `/` 메뉴는 그대로. 파일 메뉴에 "새 계획(템플릿에서)…", 보드 우클릭에 "계획 블록으로 만들기 / 풀기".

---

## 6. Claude 연결 (MCP) — Claude가 계획을 읽고 진행하게

`src/ai/protocol.ts`, `src/ai/boardOps.ts`, `src/ai/aiBridge.ts`, `mcp/server.ts`에 추가.
기존 도구(get_board, add_flow …)는 그대로 둔다.

### 새 도구

| 도구 | 하는 일 | 권한 |
|---|---|---|
| `get_plan` | 계획 전체: 목표, 단계(진행 순서), 각 단계의 할 일·완료 기준·도구·상태·결과, 의존 관계, **ready 단계**. 글 + 구조화 JSON(structuredContent) | 읽기 |
| `get_catalog` | 이 PC에서 찾은 스킬·명령어·커넥터·에이전트 목록 | 읽기 |
| `next_steps` | 지금 시작할 수 있는 단계와 그 단계의 전체 지시 | 읽기 |
| `start_step(id)` | 진행 중으로. 앞 단계가 안 끝났거나 승인이 필요하면 **거부하고 이유를 알려 줌** | status |
| `request_approval(id, why)` | 승인 대기로 바꾸고 사용자에게 알림 (작업 표시줄 깜빡임) | status |
| `finish_step(id, summary, outputs[], criteria[], used)` | 결과물·완료 기준 확인·쓴 도구를 함께 보고. 만들 것이 빠졌거나 기준이 하나라도 실패면 **거부**. 검토가 켜져 있으면 `review`(검토 대기)로 | status |
| `ask_user(id, question)` | 계획에 없는 결정이 필요할 때 질문 → 앱에 표시, 답이 오면 `get_plan`/`next_steps`에 함께 실림 | status |
| `propose_change(id?, change, why)` | 계획 수정 **제안** (바로 바뀌지 않음) → 앱에 제안 카드, 사용자가 받아들이면 반영 | status |
| `fail_step(id, reason)` | 실패 + 이유. 뒤 단계는 막힘으로 표시 | status |
| `log_step(id, note)` | 진행 중 메모 한 줄 (긴 작업의 중간 보고) | status |
| (없음) | Claude가 계획을 직접 만들거나 고치는 도구는 두지 않는다. 계획 초안 도움이 필요하면 기존 `add_flow`로 **생각 Box**를 그려 주고, 계획 블록으로 바꾸는 것은 사람이 한다 | — |
| `report_capabilities(list)` | Claude가 쓸 수 있는 도구 이름 알려 주기 → 카탈로그 | 읽기 |

- `stepPermission` (계획 창에서 설정): `read`(읽기만) / `status`(상태·결과·질문·제안, **기본값**). 계획 자체를 고치는 권한은 없다.
- 승인 필요 단계는 **사람이 앱에서 "승인"을 눌러야** `start_step`이 통과한다 (Claude가 스스로 승인 못 함).
- 모든 변경은 지금처럼 Box에 `Claude` 표시 + 알림 + Ctrl+Z.

### 진행 방법을 알려 주는 프롬프트 · 지시

- MCP 프롬프트 **`run_plan`** ("ThoughtFlow 계획 진행하기") + 서버 지시문(SERVER_INSTRUCTIONS)에 규칙 추가:
  1. `get_plan`으로 전체를 읽는다 → 2. `next_steps`에서 하나 고른다 → 3. `start_step`
  4. 단계에 적힌 도구를 쓴다: **스킬**은 Skill 도구로 그 이름을 불러 지시를 따르고, **명령어**는 그 슬래시 명령을 실행하고,
     **커넥터**는 그 커넥터의 도구로, **서브 에이전트**가 정해져 있으면 Agent 도구(subagent_type=그 이름)에 단계 지시와 완료 기준을 넘긴다
  5. **만들 것** 목록을 정확히 만들고, **참고 자료**를 따른다. 계획에 없는 기능·파일·구조를 덧붙이지 않는다
  6. 완료 기준을 항목마다 확인 → `finish_step`(결과물 위치·기준별 근거·쓴 도구) 또는 `fail_step`
  7. 계획에 없는 결정은 `ask_user`, 계획이 틀려 보이면 `propose_change` — 어느 쪽이든 **스스로 바꾸지 않고 멈춘다**
  8. 승인·검토 대기 단계는 사용자가 앱에서 누를 때까지 기다린다. 단계에 없는 위험한 일(배포·삭제·외부 전송)은 하지 않는다
- `planText.ts`가 단계마다 이 지시를 붙인 글을 만들어, 도구 이름이 Claude에게 정확히 전달되게 한다.
- **한계(사용자에게도 안내)**: ThoughtFlow는 Claude에게 "이 도구를 쓰라"고 **지시**할 뿐 강제하지는 못한다.
  또 Claude 앱마다 쓸 수 있는 것이 다르다:

  | | 스킬 | 슬래시 명령어 | 커넥터 | 서브 에이전트 |
  |---|---|---|---|---|
  | **Claude Code** (터미널·데스크톱 앱의 Code) | ✓ | ✓ | ✓ (MCP) | ✓ |
  | Claude 데스크톱/웹 채팅 | ✓ | ✗ | ✓ | ✗ |
  | ChatGPT 플러그인 | ✗ | ✗ | 자체 | ✗ |

  → **계획 진행은 Claude Code를 기본 대상**으로 하고, 채팅 앱에서는 쓸 수 없는 도구가 있는 단계를 "Claude Code에서 진행" 으로 표시한다.

---

## 7. Claude Code 연결 (새로 필요한 부분)

지금은 Claude 데스크톱(확장/설정 파일)과 ChatGPT·Claude 웹(인터넷 주소)만 연결한다. Claude Code를 추가한다.

- ✦ AI 창에 **Claude Code** 섹션:
  - **Claude Code에 등록**: `claude mcp add` 와 같은 일을 하는 설정 (사용자 범위 `~/.claude.json` 또는 작업 폴더의 `.mcp.json`)을
    이미 있는 방식(ThoughtFlow.exe + `ELECTRON_RUN_AS_NODE`, Node 설치 불필요)으로 써 넣음. 연결 점검에 Claude Code 항목 추가.
  - 등록 명령 복사 (직접 하고 싶은 사람용)
- 계획 창의 **Claude로 진행하기**:
  - 작업 폴더에서 실행할 명령 복사: `claude "ThoughtFlow의 '<계획 이름>' 계획을 run_plan 방식으로 진행해줘"`
  - (선택, 나중 단계) **앱에서 바로 실행**: 작업 폴더에서 Claude Code를 새 터미널로 띄우기. 앱이 Claude를 몰래 돌리지는 않는다 —
    사용자가 누를 때만, 보이는 터미널로.
- (선택) 계획을 Claude Code가 읽을 수 있는 파일로 내보내기: 작업 폴더에 `.claude/thoughtflow-plan.md` (MCP 없이도 진행 가능하게).

---

## 8. 단계별 진행 계획

| 단계 | 버전 | 내용 | 확인 |
|---|---|---|---|
| **1. 모델** | v0.11 | StepInfo·WorkflowMeta, 파일 형식 v4 + 예전 파일 읽기, docOps, `src/workflow/graph·transitions·resources` | 단위 테스트: 위상 정렬, ready 계산, 순환, 상태 규칙, v3→v4 |
| **2. 화면** | v0.11 | StepProps(계획 블록 설정), 보드 상태 표시·ready 강조, 진행률, 계획 창(목록·설정·점검) | e2e: 블록 만들기·도구 고르기·상태 바꾸기·Undo·다시 열기 |
| **3. 카탈로그** | v0.12 | electron/catalog.ts, ResourcePicker 자동 완성, 직접 입력, "확인 안 됨" 표시 | 단위: SKILL.md·agents 앞부분 읽기 / e2e: 가짜 ~/.claude 폴더로 목록 |
| **4. MCP 진행 도구** | v0.12 | get_plan·next_steps·start/finish/fail/log_step·request_approval·ask_user·propose_change·get_catalog·report_capabilities, 권한, run_plan 프롬프트, 지시문 | e2e: 실제 MCP 클라이언트로 3단계 계획을 끝까지 진행 / 순서 어김·결과물 누락·기준 실패·계획 수정 시도가 거부되는지 / 질문→답→이어서 진행 / 검토 대기 |
| **5. Claude Code 연결** | v0.13 | Claude Code 등록·점검, "Claude로 진행하기" 명령 복사, 계획 파일 내보내기 | e2e: 가짜 홈 폴더에 등록 → 등록된 명령으로 실제 연결 (phase24 방식) |
| **6. 계획 대비 결과·템플릿** | v0.13 | 계획 대비 결과 보기(결과물·기준·도구 비교), 계획 잠금·버전, 수정 제안 받아들이기, 템플릿 저장·불러오기 | e2e: 제안 받아들이면 버전이 오르고 기록에 남음 / 도구가 다르면 ⚠ |
| **7. 다듬기** | v0.14 | 실패 경로 Route(`when: failed`), 앱에서 Claude Code 실행(선택), 문서·도움말 | 문서·사용 설명서·릴리스 노트 |

각 단계마다 지금처럼: 단위 테스트 + e2e(Windows CI) + 설치 파일과 같은 앱으로 시작 확인 → 배포.

---

## 9. 바뀌는 파일 한눈에

```
src/model/types.ts            StepInfo, StepResources, WorkflowMeta 추가
src/model/docOps.ts           단계 연산 (Undo 한 칸)
src/persistence/fileFormat.ts 형식 v4, 예전 파일 읽기
src/workflow/                 (새) graph, transitions, resources, planText, templates
src/components/StepProps.tsx  (새) 계획 블록 설정
src/components/ResourcePicker.tsx (새) 도구 칩·자동 완성 (TagInput 재사용)
src/components/WorkflowPanel.tsx  (새) 계획 창
src/components/BoxView.tsx    상태 띠·도구 아이콘·ready 강조
src/components/TitleBar.tsx   진행률, 계획 창 버튼
src/ai/protocol.ts            새 도구 이름·권한
src/ai/boardOps.ts            계획 읽기·상태 바꾸기
src/ai/aiBridge.ts            새 요청 처리, 승인 대기 알림
mcp/server.ts                 새 도구, run_plan 프롬프트, 지시문
electron/catalog.ts           (새) 스킬·명령어·에이전트·커넥터 찾기
electron/claudeCode.ts        (새) Claude Code 등록·점검
electron/ai.ts, preload.ts    IPC 추가
tests/workflow*.test.ts, e2e/phase27~31.mjs
```

---

## 10. 정한 것 · 남은 질문

정한 것 (목표: "내가 적고 설계한 계획대로 Claude가 만들어 낸다"):
- 계획은 사람만 고친다. Claude는 상태·결과·질문·수정 제안만 (3번 질문 → **상태·결과만**)
- 기본은 한 번에 한 단계씩, 순서대로 (5번 질문 → **하나씩**, 계획 창에서 늘릴 수 있음)
- 단계마다 만들 것·완료 기준·참고 자료를 적고, 결과를 계획과 나란히 비교한다

남은 질문:
1. **주로 어떤 Claude로 진행하나요?** Claude Code(추천: 파일을 실제로 만들고 스킬·명령어·커넥터·서브 에이전트 모두 가능) / Claude 데스크톱 채팅
2. **모든 Box가 단계인가요, 고른 Box만인가요?** (계획: 고른 Box만 — 생각과 계획을 섞어 쓸 수 있게)
3. **앱이 Claude Code를 직접 띄우는 기능**이 필요한가요, 명령 복사로 충분한가요?
