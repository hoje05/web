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
