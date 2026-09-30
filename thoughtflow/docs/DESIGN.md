# ThoughtFlow — 설계 문서 (MVP)

> Box에 생각·행동·결과를 적고, 방향이 있는 Route로 이어 사고의 흐름을 한눈에 보는 Windows 데스크톱 앱.
> 핵심 원칙: **단순한 조작 · 흐름이 한눈에 보임 · 빠르게 그려도 깔끔한 결과**

---

## 1. Desktop Tech Stack — **Electron + React + TypeScript + Vite**

| 후보 | 장점 | 단점 |
|---|---|---|
| Tauri + React | 설치 파일이 작음(~10MB), 메모리 적음 | Windows에서 빌드하려면 Rust + MSVC Build Tools(수 GB) 필요, 파일 접근에 plugin/capability 설정 필요 |
| **Electron + React** | Node.js만 있으면 개발·빌드 가능, `electron-builder`로 Windows 설치 파일 생성이 단순, Chromium 고정이라 렌더링 차이 없음 | 설치 파일이 큼(~90MB) |

선택 이유
- 이 앱의 난이도는 **Board Interaction**에 있고, 네이티브 기능은 "파일 열기/저장 대화상자" 정도뿐이다. Tauri의 장점(작은 바이너리)이 개발·빌드 복잡도를 넘지 못한다.
- Renderer는 순수 웹 코드(React)이고 OS 접근은 `electron/preload.ts`의 작은 API(`window.thoughtflow`) 하나로만 한다. 나중에 Tauri로 옮기더라도 이 파일과 `src/persistence/fileService.ts`만 바꾸면 된다.
- 상태 관리: **Zustand** (보일러플레이트가 적고, React 밖(pointer handler)에서도 `getState()`로 바로 접근 가능).
- 보안: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. 파일 IO는 main process의 IPC handler에서만 수행.

## 2. Rendering — **SVG(Route) + HTML(Box) 하이브리드, 직접 구현**

```
Board (div, 전체 화면, 점 격자 배경)
 ├─ <svg> Route layer      ← transform: translate(pan) scale(zoom)
 ├─ <div> Box layer        ← 같은 transform
 └─ <svg> Overlay layer    ← 그리는 중인 Route(draft) 미리보기
```

- **Route = SVG `<path>`**: Bezier 곡선, 화살표, Glow(`feGaussianBlur` filter), stroke 스타일을 자연스럽게 표현.
- **Box = HTML `<div>`**: 한글 IME 입력, 줄바꿈, 자동 크기(auto-size), 텍스트 선택이 브라우저 기본 기능으로 해결된다. SVG `foreignObject`나 Canvas 텍스트 입력보다 훨씬 안정적이다.
- React Flow/Konva는 사용하지 않는다. 필요한 것은 Freehand path, Anchor 분배, 방향 반전 같은 **특수한 Edge 동작**인데, 라이브러리를 크게 커스텀하는 것보다 직접 구현하는 편이 단순하다.
- **Hit test는 world 좌표에서 JS로 직접 계산**한다(DOM event target에 의존하지 않음). Box 테두리 band, Route의 넓은 hit area, 화살표 클릭을 줌 배율과 무관한 "화면 px" 기준으로 일관되게 판정할 수 있고, 우선순위 충돌을 한 곳에서 제어할 수 있다.

## 3. Data Model

```ts
type Side = 'top' | 'right' | 'bottom' | 'left'

interface BoxNode {            // 사용자 용어: Box
  id: string
  x: number; y: number         // world 좌표(좌상단)
  width: number; height: number // DOM에서 측정한 실제 크기 (Anchor 계산용)
  text: string
}

interface RouteEdge {          // 사용자 용어: Route
  id: string
  sourceNodeId: string         // 화살표의 출발 Box
  targetNodeId: string         // 화살표의 도착 Box
  sourceAnchor: { side: Side } // 어느 면에 붙는지 (면 위의 위치는 Anchor Distribution이 계산)
  targetAnchor: { side: Side }
  pathPoints: [u: number, v: number][] // 곡선 내부 점 (Chord 좌표계, 아래 설명)
  pathMode: 'straight' | 'freehand' | 'smoothed'  // smoothed = 보정됨
}

interface Doc { nodes: Record<string, BoxNode>; edges: Record<string, RouteEdge> }
interface Viewport { zoom: number; panX: number; panY: number } // screen = world * zoom + pan
```

**방향(direction)은 `source → target` 순서 자체로 표현한다.**
별도 `direction` 필드를 두면 같은 정보가 두 곳에 저장되어 불일치가 생길 수 있으므로 두지 않는다.
- Outgoing(N) = `edge.sourceNodeId === N.id`
- Incoming(N) = `edge.targetNodeId === N.id`
- 방향 반전 = source/target, sourceAnchor/targetAnchor를 서로 바꾸고 pathPoints를 역순·좌표 변환 `(u, v) → (1-u, -v)`. 화면상의 Route 모양은 1px도 바뀌지 않는다.

**Chord 좌표계 (곡선 형태 보존의 핵심)**
곡선 내부 점은 world 좌표가 아니라 "시작 Anchor S → 끝 Anchor E" 선분(chord)에 대한 상대 좌표로 저장한다.

```
d = E - S,  perp(d) = (-d.y, d.x)
world(u, v) = S + u·d + v·perp(d)
```

Box가 움직여 S/E가 바뀌면 곡선 전체가 **닮음 변환(이동·회전·균등 스케일)** 되므로, 사용자가 그린 곡선의 "상대적인 형태"가 그대로 유지된다(요구사항 19). 저장된 데이터에는 world 좌표가 없으므로 Box 이동 시 Edge 데이터를 수정할 필요도 없다.

**Selection / Highlight 색상은 Data에 저장하지 않는다.** 렌더링 단계에서 selection 상태로 계산한다.

## 4. Architecture & Folder Structure

```
thoughtflow/
├─ electron/
│  ├─ main.ts            창 생성, 메뉴, 파일 대화상자 IPC, 종료 전 저장 확인
│  └─ preload.ts         window.thoughtflow API (contextBridge)
├─ src/
│  ├─ main.tsx / App.tsx
│  ├─ model/             types.ts, ids.ts, docOps.ts(순수 함수: 추가/삭제/이동/반전…), graph.ts(incoming/outgoing)
│  ├─ geometry/          vec.ts, rect.ts, chord.ts(Chord 좌표계), curve.ts(Catmull-Rom→Bezier, 샘플링, 길이)
│  ├─ anchors/           sideSelection.ts(면 선택), distribution.ts(Anchor Distribution)
│  ├─ routing/           sampling.ts, simplify.ts(RDP), smooth.ts, correct.ts(보정),
│  │                     createRoute.ts(드래그 결과 → Box/Route 생성), routeGeometry.ts(렌더링용 기하 계산)
│  ├─ store/             store.ts(Zustand: doc, viewport, selection, tool, editing, history), history.ts
│  ├─ viewport/          viewport.ts(screen↔world, zoomAt, fit)
│  ├─ interaction/       hitTest.ts, useBoardInteraction.ts(pointer 상태 머신), useKeyboard.ts, commands.ts
│  ├─ persistence/       fileFormat.ts(JSON 직렬화/검증), fileService.ts(열기/저장/새로 만들기)
│  ├─ components/        Board, BoxView, RouteView, DraftRoute, Toolbar, ZoomControls, highlight.ts
│  └─ styles.css
├─ tests/                vitest 단위 테스트 (geometry/anchors/routing/persistence/store)
├─ e2e/                  Playwright 시나리오 (Vite 화면 + 실제 Electron 실행)
└─ scripts/dev.mjs       Vite dev server + Electron 동시 실행
```

데이터 흐름: `pointer event → interaction(상태 머신) → store action → docOps(순수 함수) → 새 Doc` →
`routeGeometry(doc)`(memo) → `RouteView`/`BoxView` 렌더링.
모든 Route 기능(생성·반전·보정·이동 추종·분배)은 **같은 RouteEdge 모델과 같은 routeGeometry 파이프라인**을 사용한다.

## 5. 핵심 Interaction 구현 방식

Pointer 상태 머신 (`useBoardInteraction`): `idle | panning | movingNode | drawingRoute | pressArrow`
+ Toolbar에서 시작하는 `placingBox`.

Hit test 우선순위 (world 좌표, 거리 기준은 화면 px ÷ zoom):
1. Box 내부 — 테두리에서 9px 이내면 **border**(Route 시작), 아니면 **body**(이동/선택)
2. Route 화살표 (반경 8px — 화살표 크기와 비슷하게 해서 선을 선택하려다 반전되는 실수 방지) → 클릭 시 방향 반전
3. Box 바깥 7px band → **border**
4. Route 선 (중심선에서 7px, 즉 14px 폭의 보이지 않는 hit area) → Route 선택
5. 빈 공간

| 동작 | 결과 |
|---|---|
| Toolbar `Box`를 Board로 drag & drop | 놓은 위치에 Box 생성 → 바로 텍스트 입력 상태 (클릭만 하면 화면 중앙에 생성) |
| 빈 곳 더블클릭 | 그 위치에 Box 생성 → 입력 상태 |
| Box body drag | 이동 (연결된 Route가 실시간으로 따라감, 드래그한 Box는 맨 위로) |
| Box 더블클릭 / 선택 후 Enter | 텍스트 편집 (Enter=줄바꿈, Esc 또는 바깥 클릭=완료, Tab/Shift+Tab=다음/이전 Box로 이동하며 계속 입력) |
| Box **테두리** drag | Route가 커서를 따라 그려짐 → 빈 곳에 놓으면 새 Box 생성 + 입력 상태, 다른 Box 위에 놓으면 연결 |
| `Route` 도구 + 빈 곳 drag | 자유 Route → 양 끝이 빈 곳이면 양쪽에 Box 자동 생성 (끝이 기존 Box면 그 Box에 연결). 흐름상 먼저인 source Box부터 입력 → Tab으로 target |
| 화살표 클릭 | 방향 반전 |
| Route 클릭 | Route 선택 → `보정`, Delete 사용 가능 |
| 빈 곳 drag / 휠 클릭 drag / Space+drag | Pan |
| 마우스 휠 | 커서 위치 기준 Zoom |

새 Box 자동 배치: Route의 마지막 진행 방향을 보고 **진입 면의 중앙이 정확히 놓은 지점**에 오도록 Box를 배치한다(오른쪽으로 끌고 왔으면 새 Box는 놓은 지점의 오른쪽으로 펼쳐짐). 그래서 Route 끝이 사용자가 놓은 위치에서 어긋나지 않는다.

## 6. Freehand Route & 보정 Algorithm

**그리기 (실시간)**
1. `pointermove`(+ `getCoalescedEvents`)로 좌표 수집, **직전 저장점과 화면 3px 이상 떨어진 점만 저장**(distance sampling).
2. 미리보기는 centripetal Catmull-Rom 곡선으로 그림.

**확정 시 (자동 정리 — "Route 자동 보정")**
1. 기존 Box에서 시작/끝나면 Box 내부 구간을 잘라내고 테두리 교차점을 끝점으로 사용 → 교차한 면 = 사용자가 의도한 연결 면.
2. RDP(ε = 화면 0.6px)로 의미 없는 중복점 제거 (모양 변화 없음).
3. **직선 판정**: chord에서 최대 이탈이 `max(화면 8px, chord 길이의 6%)` 이하이면 완전한 직선으로 확정. → 대충 끌어도 직선은 깔끔한 직선이 된다.
4. 나머지 점은 Chord 좌표로 정규화하여 저장(`pathMode: 'freehand'`).

**보정 버튼 (`correct.ts`)** — 입력은 현재 화면에 보이는 world 경로(S … E)
1. **Uniform resample**: 호 길이 기준 등간격(2~6px)으로 다시 샘플링 → 점 밀도 불균일 제거.
2. **Gaussian smoothing**: σ = 경로 길이의 3.5% (6~28px). 양 끝은 점대칭 반사(odd reflection) padding 후 **끝점 고정** → 작은 흔들림·지그재그만 제거되고 큰 곡선(파장이 긴 성분)은 유지.
3. **Ramer–Douglas–Peucker**: ε = 길이의 1.2% (1.5~6px) → 곡선의 핵심 점 3~8개만 남김.
4. 다시 직선 판정(chord 길이 5%) → 직선이면 `straight`.
5. 렌더링은 **centripetal Catmull-Rom → cubic Bezier** (overshoot/cusp가 없는 변형).

sourceNode/targetNode/anchor/방향은 건드리지 않고 `pathPoints`와 `pathMode`만 교체 → 연결이 절대 깨지지 않음. 보정 전 상태는 Undo로 복원.

## 7. Incoming / Outgoing Highlight

렌더링 시 `routeRole(edge, selection)`으로 계산:

| 조건 | role | 표현 |
|---|---|---|
| 선택 없음 | normal | 회색 `#8e949c` |
| 선택 Box가 source | **outgoing** | 초록 `#16a34a` + 약한 초록 Glow |
| 선택 Box가 target | **incoming** | 보라 `#7c3aed` + 약한 보라 Glow |
| 선택 Box와 무관 | dim | 회색, opacity 0.45 (구조는 계속 보임) |
| Route 자체가 선택됨 | selected | 진한 회색, 조금 두껍게 |

Glow = 같은 path를 굵게(stroke 7, opacity 0.3) 그리고 `feGaussianBlur(σ=2.5)`를 적용한 underlay. filter 영역은 Route bbox 기준 `userSpaceOnUse`로 지정한다(기본 objectBoundingBox 단위는 완전한 수평/수직선에서 높이가 0이 되어 glow가 사라진다). 강조된 Route는 마지막에 그려서 다른 선에 가려지지 않게 한다.

**화살표 위치**: 경로 길이의 중앙. 단, Route가 다른 Box 밑을 지나 중앙이 가려지면 중앙에서 가장 가까운 보이는 지점(0.42, 0.58, 0.34 …)으로 옮겨 방향이 항상 보이게 한다.

## 8. Anchor Distribution

1. 각 Route 끝점은 `side`만 저장한다.
2. `(nodeId, side)`별로 끝점을 모은다.
3. 각 끝점의 **진행 방향 점**(곡선이면 경로상 24px 앞의 점, 직선이면 상대 Anchor)을 구하고, 면의 축 방향 좌표(top/bottom → x, left/right → y)로 정렬 → 선이 서로 교차하지 않는 순서.
4. n개면 면 위의 `(i+1)/(n+1)` 위치에 균등 배치: 1개 → 중앙, 2개 → 1/3·2/3, 3개 → 1/4·2/4·3/4.

**면 선택 (`sideSelection.ts`)**
- 생성 시: 곡선이면 경로가 Box 테두리를 **실제로 통과한 면**(사용자 의도), 직선이면 두 Box 사이 간격 규칙(가로 간격 vs 세로 간격이 큰 축).
- Box 이동 중: 직선은 간격 규칙, 곡선은 경로의 시작/끝 접선 방향으로 다시 평가하되 **hysteresis**(다른 축이 30% 이상 우세하거나 방향이 반대가 될 때만 면 변경)로 드래그 중 깜빡임을 막는다.

## 9. 위험 요소 / 예상 문제와 대응

| 위험 | 대응 |
|---|---|
| 테두리 drag(Route) vs body drag(이동) vs Route 클릭 vs 화살표 클릭 충돌 | 중앙 hit test + 명확한 우선순위, 화면 px 기준 band, 작은 Box에서는 band를 Box 크기의 25%로 제한, hover 시 커서/연결점 표시 |
| contentEditable + React 재조정 충돌, **한글 IME 조합 중 Enter/Esc** | 편집용 element는 React children 없이 마운트 시 textContent 주입, 편집 종료 시 key 교체로 재마운트, `isComposing` 검사, 편집 중 전역 단축키 차단 |
| Box 자동 크기 → 측정 → 상태 갱신 루프, Undo와의 상호작용 | ResizeObserver로 0.5px 이상 변할 때만 갱신, 크기 갱신은 history에 넣지 않음, 저장 직후 상태면 saved 기준도 함께 갱신(불필요한 dirty 방지) |
| 곡선 Route가 Box 이동 시 뒤틀림 / chord 길이 0 | Chord 닮음 변환, chord < 1px이면 직선으로 fallback |
| 드래그 중 Anchor 면이 계속 바뀌는 깜빡임 | hysteresis |
| 보정이 의도한 곡선까지 펴버림 / 흔들림을 못 없앰 | σ·ε를 경로 길이에 비례(상·하한 포함) → 줌과 무관하게 같은 결과, 단위 테스트로 검증 |
| Route가 많을 때 성능 | Doc 단위 기하 계산 memo + Route별 캐시(Edge 데이터와 양 끝 Anchor가 같으면 같은 객체 재사용 → 드래그 중 움직이지 않은 Route는 다시 렌더링되지 않음), hit test에 bbox 사전 필터, 강조 Route만 blur filter 사용 |
| Windows 휠 클릭 autoscroll, Ctrl+휠 페이지 확대, pinch zoom | mousedown(button 1) preventDefault, wheel listener `passive:false`, `setVisualZoomLevelLimits(1,1)` |
| 드래그 1회가 Undo 수십 개로 쪼개짐 | 드래그 시작 시 snapshot 보관 → 종료 시 한 번만 history push |
| 저장 안 된 변경 손실 | 창 닫기/새로 만들기/열기 전에 저장 확인 대화상자 |
| 잘못된/손상된 파일 | 로드 시 스키마 검증, 존재하지 않는 Box를 가리키는 Route 제거 |

| 툴바 버튼이 키보드 포커스를 가져가 Space/Enter 단축키와 충돌 | 툴바/줌 버튼은 mousedown에서 포커스를 받지 않음 |
| 한글 입력 모드에서 Ctrl+Z 등 단축키 인식 실패 | 문자 키는 `e.key` 대신 물리 키 `e.code`로 판정 |

## 10. 개발 단계

Phase 1 기본 구조 · Infinite Board · Zoom/Pan → 2 Box → 3 Box↔Box Route · 화살표 · 반전 → 4 테두리 drag로 새 Box → 5 빈 Board에서 Route + 양끝 Box → 6 Freehand · Sampling → 7 단순화 · Smoothing · 보정 → 8 Box 이동 시 곡선 유지 → 9 Anchor Distribution → 10 Highlight · Glow → 11 Undo/Redo → 12 저장/불러오기 → 13 다듬기.
각 Phase 종료 시 `typecheck + 단위 테스트 + Playwright 시나리오`를 통과한 상태로 commit 한다.

### 구현 결과 메모
- 모든 Phase를 순서대로 구현했고, 각 단계마다 `typecheck + vitest + Electron e2e` 통과 후 commit 했다.
- Windows 설치 파일은 Windows에서 `npm run dist`로 만든다. (Linux에서는 NSIS 단계에 wine이 필요해, 개발 환경에서는 `win-unpacked` 앱 폴더 생성까지 확인)

---

## v0.2 — 오른쪽 창 · 탭 · 검색 · 자동 저장 · 검은색 테마

### 데이터
- `BoxNode.note: string` 추가 (Box에 보이는 `text`와 별개로, 오른쪽 창에서 쓰는 긴 메모).
- 파일 형식 `version: 2`. v1 파일은 `note = ''`로 읽는다. v2 파일을 v1 앱이 조용히 잘못 읽지 않도록 버전을 올렸다.

### 오른쪽 창 (SidePanel)
- 상태: `panelOpen`, `panelDismissed`, `tabs`(연 순서), `activeTab`, `panelWidth`.
- **클릭** = 창 열기(+ 탭 추가/전환). 사용자가 **×로 닫으면** `panelDismissed = true` → 이후 클릭으로는 열리지 않고 **더블클릭**으로만 다시 열린다(더블클릭은 메모 입력칸에 커서까지).
  → 창 없이 Board만 보며 작업하고 싶을 때 클릭할 때마다 창이 튀어나오지 않는다.
- 탭 = 창에서 연 Box들(브라우저 탭처럼). 탭 클릭 → 그 Box의 창으로 전환 + Board에서 선택, ×/휠 버튼으로 닫기. 넘치면 휠로 가로 스크롤.
- 창은 화면 오른쪽에 붙어(docked) Board 영역의 오른쪽을 차지한다. Board의 왼쪽 끝(좌표 기준점)은 그대로이므로 창을 열고 닫거나 너비를 바꿔도 **Board 내용이 화면에서 움직이지 않는다**(처음에는 왼쪽 창이었고 pan 보정이 필요했지만, 오른쪽으로 옮기면서 필요 없어졌다). 보고 있는 Box가 창이나 도구 막대에 가려지면 Board 가운데로 옮긴다. 너비는 창의 왼쪽 가장자리를 끌어 조절한다.
- 창 안: 제목(= Box `text`, 실시간 반영), 들어온/나간 흐름 칩(보라/초록, 클릭하면 그 생각으로 이동), 메모.
- **Undo 묶음**: 입력칸에 머무는 동안의 변경은 live로 반영하고, 입력칸을 떠날 때 시작 시점 Doc을 한 번만 기록 → 글자마다 Undo가 쌓이지 않는다.

### 검색 (Ctrl+F)
- 제목·메모에서 대소문자 무시 부분 일치. 결과는 위→아래, 왼→오 순.
- Board: 일치 Box는 노란 테두리, 나머지 Box와 Route는 흐리게. 탭: 일치하는 창에 노란 점.
- 메모 안 키워드 표시: textarea는 글자 일부만 색칠할 수 없어서, 같은 글꼴/줄바꿈의 **하이라이트 층을 textarea 뒤에** 깔고 스크롤을 동기화한다. 두 층의 줄바꿈 폭이 스크롤바 유무로 어긋나지 않도록 `scrollbar-gutter: stable`.
- `Enter` = 현재 결과 열기 → 다시 누르면 다음 결과, `Esc` = 닫기(강조 해제).

### 자동 저장
- Doc이 바뀔 때마다 0.4초 뒤 저장(연속 입력은 하나로 묶임). 파일 쓰기는 한 번에 하나씩, 저장 중 바뀐 내용은 이어서 한 번 더 저장.
- 이름 없는 보드 → main process가 `사용자 폴더/ThoughtFlow/생각 흐름 YYYY-MM-DD HH.MM.tflow` 경로를 만들어 준다. 빈 보드는 파일을 만들지 않는다.
- 마지막 보드 경로를 `userData/settings.json`에 기록 → 다음 실행 때 자동으로 연다(명령행 파일 인자가 우선).
- 창 닫기: main이 닫기를 잠시 막고 renderer에 마지막 저장을 요청 → 저장 성공 후 닫힘(실패하면 그래도 닫을지 묻는다). 기존 "저장하지 않은 변경" 대화상자는 필요 없어져 제거.
- 보안: renderer가 쓸 수 있는 경로는 사용자가 대화상자로 고른 파일, 연 파일, 앱이 만든 기본 경로로 제한(allowlist).
- 테스트는 `THOUGHTFLOW_USER_DATA`, `THOUGHTFLOW_BOARDS_DIR` 환경 변수로 임시 폴더를 쓴다.

### 검은색 테마
- `nativeTheme.themeSource = 'dark'`(메뉴, 대화상자, Windows 제목 표시줄), CSS `color-scheme: dark`.
- 색 토큰: 배경 `#0e0f11`, Box `#1a1b1f`, 기본 Route `#7b818a`, 나간 흐름 `#22c55e`, 들어온 흐름 `#a78bfa`, 검색 `#f5c451`. 어두운 배경에 맞춰 glow 불투명도를 약간 올렸다.

---

## v0.3 — 프로그램 바 · 프로젝트

### 프로그램 바 (TitleBar)
- Windows 기본 제목 표시줄 대신 `frame: false` 창 + 앱 위쪽 38px 막대.
- 왼쪽: 프로젝트 버튼(앱 아이콘) · 프로젝트 이름 · 저장 상태. 오른쪽: `⋯`(기존 파일/편집/보기 메뉴를 그 자리에 팝업) · 최소화 · 최대화/이전 크기 · 닫기(빨간 hover).
- 막대의 빈 곳은 `-webkit-app-region: drag` → 끌면 창 이동, 더블클릭하면 최대화, Aero Snap 등 Windows 기본 동작이 그대로 된다. 버튼만 `no-drag`.
- 최대화 버튼 모양은 main의 `maximize`/`unmaximize` 이벤트로 동기화.
- 닫기 버튼도 `BrowserWindow.close()` 경로를 타므로, 기존 "닫기 전 마지막 저장"이 그대로 적용된다.
- 직접 그린 버튼을 쓴 이유: 검은색 테마와 일관된 모습, 테스트 가능. (대신 Windows 11의 최대화 버튼 hover 시 나오는 스냅 레이아웃 메뉴는 나오지 않는다. 필요하면 `titleBarOverlay`로 바꿀 수 있다.)

### 프로젝트 = 보드 파일
- 프로젝트 하나가 `.tflow` 파일 하나. 기본 위치 `사용자 폴더/ThoughtFlow` (v0.6부터 — `문서`는 OneDrive 동기화·제어된 폴더 액세스 문제로 쓰지 않고, 예전 `문서/ThoughtFlow`의 파일은 처음 실행할 때 복사). 새 프로젝트는 main이 빈 보드 파일을 먼저 만든 뒤(`wx`, 같은 이름이면 번호) 화면을 바꾼다. 목록은 이 폴더의 파일 + 다른 위치에서 열거나 저장했던 파일(`settings.json`의 `recent`), 최근 수정 순.
- **새 프로젝트**: 이름 검사(Windows에서 못 쓰는 문자, 예약어, 중복) → 지금 프로젝트 저장 → 빈 보드를 그 이름으로 바로 저장(목록에 즉시 나타남).
- **전환**: 지금 프로젝트를 강제 저장(화면 위치·탭 포함) → 다른 파일 로드. 보드 사이에 Undo 기록은 섞이지 않는다.
- **프로젝트별 화면 상태**: 파일에 선택 항목 `ui: { tabs, activeTab, panelOpen }`을 함께 저장 → 돌아오면 보던 탭과 오른쪽 창이 그대로. (없는 Box를 가리키는 탭은 읽을 때 걸러낸다)
- **이름 바꾸기**: 파일 이름 변경. 지금 프로젝트라면 먼저 저장하고, 바꾸는 동안 자동 저장을 멈춰 옛 이름의 파일이 다시 생기지 않게 한다.
- **삭제**: 확인 후 `shell.trashItem`(휴지통)으로 옮긴다 — 완전히 지우지 않는다. 지금 프로젝트였다면 새 보드로.
- 쓰기 허용 경로(allowlist)에는 목록에 나온 파일, 새 프로젝트 경로, 이름을 바꾼 경로가 추가된다.

### 프로젝트 창 (ProjectDrawer)
- 프로그램 바 왼쪽 위 버튼 또는 `Ctrl+N`(바로 이름 입력). 왼쪽에서 `transform: translateX` 260ms 애니메이션으로 미끄러져 나오고, 뒤 Board는 어둡게 덮인다(바깥 클릭·Esc로 닫힘, 그 클릭은 Board에 전달되지 않음). 움직임 줄이기 설정(`prefers-reduced-motion`)이면 애니메이션 없이.
- 창이 열려 있는 동안 Board 단축키(Delete, Enter, R, Space)는 쉰다.

---

## v0.4 — 우클릭 삭제 · 항상 자동 보정 · Box 이동 시 자동 재연결

- **우클릭 메뉴**: Box·Route 위에서 우클릭 → 선택되고 "Box 삭제"/"Route 삭제" 메뉴. Box 삭제는 연결된 Route도 함께. Esc·바깥 클릭·창 크기 변경으로 닫힘. 화면 가장자리에서 잘리지 않게 위치 보정. Undo 가능.
- **보정 버튼 제거, 항상 자동 보정**: Route를 그리면 바로 `correctPath`(재샘플링 → Gaussian smoothing → RDP)를 거쳐 저장한다(`pathMode: 'smoothed'`). 거의 곧은 선은 `auto`.
- **새 path mode `auto`**: 두 Box의 연결 면에서 수직으로 뻗어 나가는 cubic Bezier(제어점 거리 = 두 끝점 거리의 42%, 24~180px). 면은 두 Box의 가로/세로 간격으로 고르고(hysteresis 포함), 같은 면의 여러 Route는 기존처럼 균등 분배.
- **Box 이동**: 연결된 Route는 그린 모양(닮음 변환)을 유지하던 방식을 버리고 `auto`로 바뀐다. 처음 바뀔 때는 면을 새로 고르고, 이후 드래그 중에는 hysteresis로 면이 깜빡이지 않게 한다. → Box를 어디로 옮겨도 선이 그 위치에 어울리는 면에 붙어 자연스럽게 이어진다.
- 파일 형식은 그대로(`pathMode`에 `auto` 값 추가, 예전 `straight`/`freehand` 파일도 읽음).

## v0.5 — AI 연결 (방식 A: 구독 계정 그대로, MCP)

사용자가 이미 쓰는 Claude 데스크톱·ChatGPT 계정으로 이 앱을 제어한다. API 키도, 앱 안의 별도 채팅창도 없다.
AI 쪽 대화 화면은 각 서비스의 것을 그대로 쓰고, ThoughtFlow는 **MCP 서버**로 보드를 읽고 고치는 도구를 제공한다.

```
Claude 데스크톱 ─stdio─▶ 확장(.mcpb, mcp/stdio.ts) ─HTTP 127.0.0.1 + 토큰─▶ 로컬 브리지 ─┐
ChatGPT ─HTTPS─▶ cloudflared 빠른 터널 ─▶ /mcp/<비밀 경로> (Streamable HTTP, stateless) ─┼─▶ IPC ─▶ renderer ─▶ store
                                                                         (electron/ai.ts) ┘      (src/ai/aiBridge.ts)
```

### 도구 (mcp/server.ts — 두 경로가 같은 정의를 씀)
| 도구 | 하는 일 |
|---|---|
| `get_board` | 열린 프로젝트를 들여쓰기 흐름(시작 Box → 나가는 Route 순)으로. id·메모·"사용자가 보고 있는 Box" 포함. 순환/합류는 "(위에 나옴)" |
| `read_box` / `search_boxes` | Box 하나의 전체 메모와 앞뒤 흐름 / 제목·메모 검색(모든 단어 포함) |
| `add_flow` | 여러 Box + Route를 한 번에 (= Undo 한 번). routes를 생략하면 순서대로 한 줄, `after`면 기존 Box 뒤에 붙임. 참조가 하나라도 틀리면 아무것도 바꾸지 않음 |
| `update_box` / `connect_boxes` | 제목·메모 고치기(`append_note` 권장) / 기존 Box 잇기 |
| `delete_items` | 설정에서 허용했을 때만 (기본 꺼짐) |
| `focus_box` | 앱 화면에서 그 Box를 선택·가운데·오른쪽 창으로 보여 줌 |
| `list_projects` / `open_project` / `create_project` | 프로젝트 전환·생성 |

서버 `instructions`에 사용 규칙을 적어 둔다: 대화 전에 `get_board`로 보드를 근거로 삼고, 대화에서 나온 생각·결정·행동·결과는 짧은 제목의
Box로 기존 흐름에 이어 붙이며, 사용자의 글은 요청 없이 지우거나 덮어쓰지 않는다. Claude용 프롬프트 두 개(대화 정리하기, 보드 바탕으로 이야기하기)도 제공.
Box는 id로 가리키지만 보드에 하나뿐인 정확한 제목도 받아 준다 (AI가 id를 틀려도 복구되게).

### 자동 배치 (src/ai/layout.ts)
- 흐름은 왼쪽 → 오른쪽. 앞 Box 오른쪽 열(간격 90px)에, 같은 앞 Box의 둘째 자식부터는 아래로(간격 36px). 기존 자식이 있으면 그 아래.
- 뒤 Box에만 이어지면 그 왼쪽 열. 이어진 곳이 없는 새 흐름은 기존 내용 아래(빈 보드면 화면 가운데).
- 겹치면 0, +1, −1, +2 … 칸씩 비켜 빈자리를 찾는다. 크기는 글 길이로 어림(폭 180~300, 한글 14px/영문 7.6px)하고, 그려진 뒤 실제 크기로 측정된다.
- 연결선은 `auto` 모드(v0.4)라 이후 사용자가 Box를 옮겨도 자연스럽게 따라간다.

### 앱 화면 쪽 (src/ai/aiBridge.ts)
- 요청은 하나씩 차례로 처리(프로젝트 전환 중 끼어들기 방지). 보드를 바꾸는 요청 하나 = `commit` 한 번 = Undo 한 번. 자동 저장은 평소대로.
- AI가 만든 Box에는 `origin`("Claude"/"ChatGPT")을 저장하고 테두리 위에 작은 표시. 방금 만든 Box는 2.4초 빛나고, 모두 화면 밖이면 첫 Box로 화면 이동.
- 아래쪽 알림 "Claude: Box 3개와 Route 2개를 추가했습니다." + **되돌리기**(Undo 기록의 맨 위가 그 AI 변경일 때만 — 새 Box 크기 측정은 Doc만 바꾸고 기록은 안 바꾸므로 영향 없음).
- main은 화면이 마지막 보드를 불러온 뒤(`ai:ready`)부터 요청을 넘긴다. 창을 새로 불러오면 다시 준비될 때까지 기다린다.

### 보안
- 로컬 브리지: 127.0.0.1에서만, 실행마다 새 48자 토큰(`bridge.json`, 사용자 데이터 폴더). Host가 정확히 그 주소가 아니거나 Origin 헤더가 있으면(브라우저·DNS rebinding) 거절.
- ChatGPT: 설정에서 켤 때만 열고, 비밀 경로(128비트)가 틀리면 404. "주소 새로 만들기"로 즉시 바꿀 수 있다. 터널을 끄면 공개 주소도 사라진다.
- 모든 요청은 main의 `dispatch`에서 연결 켜짐 여부·도구 이름·지우기 허용을 확인한다.

### Claude 데스크톱 확장
- `scripts/build-electron.mjs`가 `mcp/stdio.ts`를 esbuild로 한 파일(`server/index.js`)로 묶고 `manifest.json`(v0.2)과 함께 `mcpb pack` → `dist-mcp/ThoughtFlow.mcpb`.
  electron-builder `extraResources`로 설치본에 포함. "Claude 데스크톱에 설치" 버튼은 그 파일을 연다(Claude가 설치 창을 띄움).
- 확장은 `%APPDATA%\ThoughtFlow\bridge.json`을 읽어 브리지에 연결한다. 연결이 안 되면(앱 꺼짐) bridge.json에 적힌 실행 명령으로 앱을 켜고 최대 30초 기다린다.
  앱이 끝날 때 bridge.json에서 주소·토큰만 지우고 실행 명령은 남긴다.
- 확장 설치가 안 되는 환경을 위해 "직접 설정": `ThoughtFlow.exe`를 `ELECTRON_RUN_AS_NODE=1`로 실행해 같은 서버 스크립트를 돌린다(Node 설치 불필요).

### ChatGPT
- ChatGPT는 원격 HTTPS MCP만 연결할 수 있어서, 설정에서 켜면 `cloudflared tunnel --url http://127.0.0.1:<포트>` 빠른 터널을 띄우고 출력에서 `https://….trycloudflare.com` 주소를 읽는다.
  cloudflared가 없으면 `winget install --id Cloudflare.cloudflared` 안내. 빠른 터널 주소는 실행할 때마다 바뀌므로 ChatGPT 커넥터 주소도 바꿔야 한다(한계).
- 엔드포인트는 세션 없는 Streamable HTTP + JSON 응답(터널 친화적). 요청마다 MCP 서버 인스턴스를 만든다.

### 빌드 변경
- Electron main/preload를 tsc 대신 **esbuild**로 묶는다(MCP SDK를 main에 넣기 위해, node_modules 배포 없이). `electron/tsconfig.json`은 타입 검사 전용.
