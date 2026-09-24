# ThoughtFlow

Box에 생각·행동·결과를 적고, 방향이 있는 **Route**로 이어서 내 사고의 흐름을 한눈에 보는 Windows 데스크톱 앱입니다.

```
[처음 생각] → [행동] → [결과] → [그래서 든 생각] → [다른 행동] → …
```

![Box를 선택하면 들어온 흐름은 보라, 나간 흐름은 초록](docs/images/flow-highlight.png)

- Box 종류(Thought/Action/Result)를 강제하지 않습니다. 모든 Box는 같은 일반 Box입니다.
- 로그인·클라우드 없이 내 PC의 파일(`.tflow`)에 저장하는 Local-first 앱입니다.

## 실행하기

필요한 것: [Node.js](https://nodejs.org/) 20 이상 (Windows 10/11)

```bash
cd thoughtflow
npm install
npm run dev        # 개발 모드 (코드 수정 시 화면 자동 갱신)
npm start          # 빌드 후 실행
```

### Windows 설치 파일 만들기

```bash
npm run dist       # release/ThoughtFlow-Setup-0.1.0.exe 생성
```

설치하면 `.tflow` 파일을 더블클릭해 바로 열 수 있습니다.
설치 없이 실행 폴더만 필요하면 `npm run dist:dir` → `release/win-unpacked/ThoughtFlow.exe`.

## 사용법

| 하고 싶은 것 | 방법 |
|---|---|
| Box 만들기 | 왼쪽 Toolbar의 **Box**를 Board로 끌어다 놓기 · 빈 곳 **더블클릭** (Box 버튼 클릭 = 화면 중앙에 생성) |
| 글 쓰기 | 새 Box는 바로 입력 상태 · 더블클릭 또는 선택 후 `Enter` · `Enter`는 줄바꿈 · `Esc`/바깥 클릭으로 완료 |
| **다음 생각 잇기** | Box **테두리**에서 끌어내 빈 곳에 놓기 → 새 Box가 생기고 바로 입력 |
| Box끼리 연결 | Box 테두리에서 끌어 다른 Box 위에 놓기 |
| 자유롭게 Route 그리기 | Toolbar **Route**(`R`) → 빈 곳에서 그리기 → 양 끝에 Box 자동 생성 |
| 입력하며 흐름 따라가기 | 편집 중 `Tab` = 다음(나가는) Box, `Shift+Tab` = 이전(들어오는) Box |
| 방향 바꾸기 | Route 가운데의 **화살표 클릭** |
| 흔들린 선 정리 | Route 클릭해 선택 → Toolbar **보정** (`Ctrl+Z`로 원래 선 복원) |
| 흐름 추적 | Box를 클릭하면 들어온 Route는 **보라**, 나간 Route는 **초록**으로 강조 |
| 이동 / 삭제 | Box 본문 드래그 / `Delete` (Box를 지우면 연결된 Route도 삭제) |
| 화면 이동 | 빈 곳 드래그 · 휠 버튼 드래그 · `Space`+드래그 |
| 확대/축소 | 마우스 휠 · `Ctrl +/-/0` · 전체 보기 `Shift+1` |
| 되돌리기 | `Ctrl+Z` / 다시 실행 `Ctrl+Y` 또는 `Ctrl+Shift+Z` |
| 파일 | 새 보드 `Ctrl+N` · 열기 `Ctrl+O` · 저장 `Ctrl+S` · 다른 이름으로 `Ctrl+Shift+S` |

오른쪽 아래 `?` 버튼을 누르면 앱 안에서도 사용법을 볼 수 있습니다.

**보정 전 → 후** (큰 곡선의 의도는 유지하고 손떨림만 제거)

| 보정 전 | 보정 후 |
|---|---|
| ![보정 전](docs/images/correct-before.png) | ![보정 후](docs/images/correct-after.png) |

## 구조

설계 결정(기술 선택, 데이터 모델, 알고리즘, 위험 요소)은 [`docs/DESIGN.md`](docs/DESIGN.md)에 있습니다.

```
electron/        main process (창, 메뉴, 파일 대화상자, 종료 전 저장 확인) + preload API
src/model/       Box/Route 데이터 모델과 순수 함수 연산
src/geometry/    벡터, 사각형, Chord 좌표계, Catmull-Rom → Bezier
src/anchors/     연결 면 선택, Anchor Distribution
src/routing/     Route 생성, 샘플링, RDP 단순화, smoothing, 보정, 렌더링용 기하 계산
src/store/       Zustand 상태 + Undo/Redo
src/interaction/ hit test, pointer 상태 머신, 단축키, 명령
src/persistence/ .tflow 파일 형식(검증 포함), 열기/저장
src/components/  Board, BoxView, RouteView, Toolbar …
```

## 테스트

```bash
npm run typecheck
npm test           # 단위 테스트 (geometry, 보정 알고리즘, anchor, 파일 형식, undo)
npm run e2e        # 실제 Electron 앱을 띄워 마우스/키보드로 조작하는 시나리오
```

Linux(화면 없는 환경)에서는 `xvfb-run -a npm run e2e`로 실행합니다.

## 파일 형식 (`.tflow`)

JSON입니다. Route의 방향은 `sourceNodeId → targetNodeId`로 표현하고, 곡선은 시작/끝 Anchor를 잇는 선분 기준의
상대 좌표(`pathPoints: [u, v]`)로 저장해서 Box를 옮겨도 곡선 형태가 유지됩니다. 자세한 내용은 `src/persistence/fileFormat.ts` 참고.
