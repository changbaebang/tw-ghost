# tw-ghost

**내 Tailwind 설정에서는 CSS 가 전혀 생성되지 않는 클래스를 찾아낸다.**

[English](./README.md)

## 문제

Tailwind v3 는 테마 스케일을 확장(extend)하는 대신 *통째로 교체*할 수 있다:

```ts
// tailwind.config.ts
export default {
  theme: {
    fontSize: { xs: '10px', s: '12px', m: '13px', l: '14px' }, // 기본 sm/base/lg/xl 은 사라짐
    spacing: { 0: '0px', 2: '2px', 4: '4px', 8: '8px' },        // 1 unit = 1px, 짝수 키만
    zIndex: { nav: '200', mask: '1000', popup: '3000' },
  },
};
```

이 순간부터 지워진 키를 쓰던 기본 클래스는 전부 **유령(ghost)** 이 된다. 여전히 정상처럼 보이고,
에디터 플러그인은 자동완성해 주고, 코드 리뷰도 그냥 통과시키지만 — Tailwind 는 아무것도 만들어 내지
않는다. 브라우저는 모르는 클래스를 무시하고, 요소는 상속받은 값으로 렌더링되며, 디자이너가 "여백이
왜 다르죠?" 라고 묻기 전까지 아무도 모른다.

```tsx
// Before: 멀쩡해 보이지만 아무 효과 없음
<p className="text-sm p-3 z-10 tablet:text-sm">…</p>

// tw-ghost 가 알려주는 것
  text-sm  (16 occurrences)
    src/components/Price.tsx:12:20
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   text-s, text-m
  tablet:text-sm  (4 occurrences)
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   tablet:text-s, tablet:text-m
  p-3      (3 occurrences)
    stock: padding: 0.75rem
    try:   p-2, p-4
  z-10     (7 occurrences)
    stock: z-index: 10
    try:   z-nav, z-mask, z-popup

// After
<p className="text-m p-4 z-nav tablet:text-m">…</p>
```

## 하는 일 / 하지 않는 일

**하는 일**

- `tailwind.config.{ts,js,cjs,mjs}` 를 **대상 프로젝트에 설치된 `tailwindcss`** 로 로드한다
  (TypeScript 설정, presets, plugins, `prefix`, `separator`, `important`, `darkMode` 모두 반영).
- 소스 파일에서 클래스 후보를 Tailwind 자체 extractor 로 추출한다.
- CSS 를 두 번 생성한다 — 한 번은 내 설정으로, 한 번은 기본 테마로 — 그리고 **실제로 나온 결과**를
  비교한다. 설정 모양을 보고 추측하지 않는다.
- variant 뒤에 숨은 유령도 잡는다: `md:text-sm`, `dark:md:hover:text-sm` 은 물론, 내 설정에만 있는
  variant 를 쓴 `tablet:text-sm` / `hocus:text-sm` / `[&_svg]:text-sm` 도 — 전체 후보가 어디에서도
  해석되지 않으면 variant 를 뗀 기본 유틸리티로 판정한다.
- 유령 클래스마다 등장 횟수, `file:line:col`, 기본 Tailwind 였다면 만들어졌을 선언, 같은 루트의
  대체 클래스 제안을 보고한다.
- CI 게이트로 동작한다 (발견 시 `exit 1`, 도구 연동용 `--json`, 스캔한 것이 없으면 `exit 2`).

**하지 않는 일**

- ESLint 규칙을 대체하지 않는다. [eslint-plugin-tailwindcss](https://github.com/francoismassart/eslint-plugin-tailwindcss)
  (`no-custom-classname`) 와 [eslint-plugin-better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss)
  (`no-unknown-classes`) 는 타이핑 중에 에디터 피드백을 준다. 두 도구는 ESLint 에 묶여 있고 설정
  형태로 유효성을 추론한다. tw-ghost 는 린터 독립적이고(Biome / oxlint 팀에서도 동작) 실제 CSS 출력으로
  판정한다. 가능하다면 둘 다 쓰는 것이 좋다.
- 런타임에 동적으로 조립되는 클래스(`` `text-${size}` ``)는 찾지 못한다. Tailwind 도 못 보는 클래스라
  이미 프로덕션에서 깨져 있는 것이지, 이 리포트에서만 빠지는 것이 아니다.
- Tailwind v4(CSS-first 설정, `tailwind.config.js` 없음)는 지원하지 않는다. 종료 코드 2 와 안내 메시지로 끝난다.
- "unknown" 클래스(커스텀 CSS, 일반 단어, 오타)는 기본적으로 보고하지 않는다 — `--unknown` 참고.

## 설치 & 사용

```sh
# tailwind.config.* 가 있는 디렉터리에서 실행 (위로 올라가며 자동 탐지)
npx tw-ghost

# 설정 파일과 glob 을 명시
npx tw-ghost "src/**/*.{ts,tsx}" --config apps/web/tailwind.config.ts

# CI: 기계가 읽을 수 있는 출력, 레거시 접두사 제외, 오타·미지 variant 후보도 나열
npx tw-ghost --json --ignore "^legacy-" --unknown
```

Node ≥ 20 과 대상 프로젝트에 설치된 `tailwindcss` ^3.3 (peer dependency) 이 필요하다.
`postcss` ^8 은 *선택적* peer 다: 설정 파일 옆에 `postcss` 가 설치되어 있으면 그것을 쓰고, 없으면
`tailwindcss` 자신이 의존하는 `postcss` 로 대체하므로 `tailwindcss` 만 설치되어 있어도 충분하다.

## CLI 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `[globs...]` | 설정의 `content` glob | 스캔할 파일. 위치 인자 glob 은 현재 디렉터리 기준으로 해석되며 설정의 `content` 목록을 대체한다. |
| `-c, --config <path>` | cwd 에서 위로 탐색 | 로드할 `tailwind.config.{ts,js,cjs,mjs}`. |
| `--json` | 꺼짐 | stdout 에 기계가 읽을 수 있는 리포트 출력. |
| `--unknown` | 꺼짐 | 기본 Tailwind 에서도 프로젝트에서도 CSS 가 안 나오는 유틸리티 모양 클래스(오타 탐지)와, 유틸리티는 동작하지만 variant 체인을 이 설정이 모르는 클래스(`unknownVariant`)도 나열. |
| `--max-locations <n>` | `3` | 클래스당 유지할 위치 수. `0` = 전부. 0 이상의 정수만 허용 (`3abc` 는 종료 코드 2 로 거부). |
| `--ignore <regex>` | – | 이름이 일치하는 클래스를 건너뜀. 반복 지정 가능. |
| `--allow-empty` | 꺼짐 | 일치하는 파일이 없거나 스캔할 설정이 없을 때 빈 리포트로 `0` 종료. 없으면 종료 코드 `2` 이므로 glob 오타가 CI 를 조용히 통과할 수 없다. |
| `--fail-on <ghost\|none>` | `ghost` | 종료 코드를 `1` 로 만드는 조건. |
| `--no-suggestions` | 꺼짐 | 대체 클래스 탐색 생략 (테마가 아주 클 때 더 빠름). |
| `--no-color` | 꺼짐 | ANSI 색상 비활성화 (`NO_COLOR` 도 존중). |
| `-h, --help` / `-v, --version` | | |

## 출력 예시

사람용 (이 저장소의 `replaced-scale` 픽스처):

```
tw-ghost · tailwindcss 3.4.17 · /work/acme-web/tailwind.config.ts
scanned 2 files, 49 candidates (10 ok, 5 ghost, 0 unknown-variant, 34 unknown of which 1 utility-like) in 279ms

✖ 5 ghost classes — valid in stock Tailwind, produce no CSS in this config:

  text-sm  (4 occurrences)
    src/App.tsx:7:21
    src/App.tsx:8:88
    src/App.tsx:11:57
    … and 1 more location
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   text-l, text-m, text-s, text-xs

  -m-3  (1 occurrence)
    src/App.tsx:7:76
    stock: margin: -0.75rem
    try:   -m-2, -m-4, -m-0, -m-8, -m-16, -m-auto

  md:hover:text-sm  (1 occurrence)
    src/App.tsx:7:49
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   md:hover:text-l, md:hover:text-m, md:hover:text-s, md:hover:text-xs

  p-3  (1 occurrence)
    src/App.tsx:7:40
    stock: padding: 0.75rem
    try:   p-2, p-4, p-0, p-8, p-16
```

같은 파일에 `md:hover:text-sm` 도 있지만 `text-sm` 은 **4** 회다: 등장 횟수는 온전한 토큰만 세므로
더 긴 클래스 안에 들어 있는 후보(`md:text-sm`, `legacy-text-sm`, `p-30`, `!p-3`, `-p-3`, `p-3.5`,
`text-sm/50`)는 절대 세지 않는다.

`--json` (형태는 패치 릴리스 간에 안정적이다. 키가 추가될 수는 있어도 제거되지는 않는다):

```json
{
  "version": "0.1.0",
  "configPath": "/work/acme-web/tailwind.config.ts",
  "tailwindVersion": "3.4.17",
  "extractor": "project",
  "filesScanned": 2,
  "candidateCount": 49,
  "summary": { "ok": 10, "ghost": 5, "unknown": 34, "unknownVariant": 0, "unknownUtilityLike": 1 },
  "ghosts": [
    {
      "class": "text-sm",
      "count": 4,
      "locations": [{ "file": "src/App.tsx", "line": 7, "col": 21 }],
      "stockCss": ["font-size: 0.875rem", "line-height: 1.25rem"],
      "suggestions": ["text-l", "text-m", "text-s", "text-xs"]
    }
  ],
  "unknown": [],
  "unknownVariant": [],
  "durationMs": 279
}
```

`summary` 의 `unknown*` 카운터 세 개는 `--unknown` 없이도 항상 채워진다:

- `summary.unknown` — 어디에서도 CSS 가 나오지 않은 모든 후보의 원시 수. 대부분은 소스에 있는 일반
  단어(`import`, `className`, …)라 숫자가 크고 그 자체로는 별 의미가 없다.
- `summary.unknownUtilityLike` — 그중 유틸리티 모양 휴리스틱(*알려진 미탐 원인* 참고)을 통과한
  부분집합. CI 에서 지켜볼 숫자는 이것이며, `--unknown` 이 나열하는 것과 같다.
- `summary.unknownVariant` — 기본 유틸리티는 내 설정에서 동작하지만 variant 체인이 동작하지 않는
  후보(`p-4` 는 멀쩡한데 `bogus:p-4`). 보통 variant 오타다.

`unknown` 과 `unknownVariant` 배열은 `--unknown` 을 줄 때만 채워지며, `unknown` 은 유틸리티 모양
이름만 남긴다.

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| `0` | 유령 클래스 없음 (또는 `--fail-on none`), 또는 `--allow-empty` 를 준 빈 스캔. |
| `1` | 유령 클래스가 하나 이상 발견됨. |
| `2` | 사용법 또는 설정 오류: 잘못된 플래그·값(예: 정수가 아닌 `--max-locations`), 설정 파일 없음, 설정 로드 실패, `tailwindcss` 를 찾을 수 없음, Tailwind v4, **glob 에 일치하는 파일 없음 / 스캔할 것 없음** (`--allow-empty` 가 없을 때). |

## 프로그래밍 API

```ts
import { analyze, formatHuman } from 'tw-ghost';

const report = await analyze({
  cwd: process.cwd(),          // 자동 탐지·glob·상대 경로의 기준 디렉터리
  config: 'tailwind.config.ts', // 선택
  globs: ['src/**/*.tsx'],      // 선택, 기본은 설정의 content glob
  ignore: [/^legacy-/],
  unknown: false,
  allowEmpty: false,            // true → TwGhostConfigError 대신 빈 리포트
  maxLocations: 3,
  suggestions: true,
});

console.log(formatHuman(report, { color: false }));
process.exitCode = report.ghosts.length > 0 ? 1 : 0;
```

`analyze()` 는 종료 코드 2 에 해당하는 상황에서 `TwGhostConfigError` 를 던진다. 하위 구성 요소도
export 된다: `loadProject`, `findConfig`, `classify`, `splitVariants`, `looksUtilityLike`,
`scanContent`, `unescapeCssIdentifier`, `stockConfigFrom`, `collectClasses`, `changedThemeKeys`.
ESM(`import`) 과 CommonJS(`require`) 빌드 모두 각자의 타입 정의와 함께 제공된다 (`import` 는
`dist/index.d.ts`, `require` 는 `dist/index.d.cts`, `exports` 조건별로 선택).

## 동작 원리

1. **프로젝트의 Tailwind 를 로드한다.** `tailwindcss`, `tailwindcss/loadConfig` (`.ts` 는 jiti 가
   처리), `tailwindcss/resolveConfig`, `postcss` 를 `createRequire(configPath)` 로 해석하므로 실제
   빌드가 쓰는 버전이 그대로 판정한다. 메이저 버전이 3 이 아니면 종료 코드 2.
2. **파일을 고른다.** 위치 인자 glob(cwd 기준) 또는 기본값으로 설정 `content` 의 문자열 항목
   (`raw` 객체는 무시). `node_modules`, `dist`, `.next`, `.git` 은 항상 제외하며 `!부정` glob 도 반영한다.
   입력 집합이 파일 0 개로 해석되면 `--allow-empty` 가 없는 한 오류(종료 코드 2)다.
   *설계 선택:* `content` glob 은 프로세스 cwd 가 아니라 **설정 파일이 있는 디렉터리** 기준으로
   해석한다. Tailwind 자체는 `content.relative` 가 없으면 cwd 기준이지만, 거의 모든 프로젝트가
   의도하는 것은 설정 디렉터리 기준이고, 모노레포 루트에서 `--config apps/x/tailwind.config.ts` 를
   실행할 수 있게 해 준다.
3. **후보를 추출한다.** 프로젝트에 설치된 `tailwindcss/lib/lib/defaultExtractor` 로 한 줄씩 추출한다
   (그 내부 경로가 사라지면 번들된 v3 extractor 복사본으로 대체하며, 리포트의 `extractor` 필드가
   어느 쪽이 실행됐는지 알려준다). 후보마다 **온전한 토큰으로** 등장한(앞뒤 문자가 클래스 토큰 문자가
   아닌) 모든 `file:line:col` 을 유지하고, 후보 자체는 전역으로 중복 제거한다.
4. **CSS 를 두 번 생성한다.** PostCSS 에 입력 `@tailwind components; @tailwind utilities;` 와
   `content: [{ raw: candidates.join('\n'), extension: 'html' }]` 를 넘긴다:
   - **project 실행** — 로드된 설정 그대로 (theme, presets, plugins, safelist, `corePlugins`, …);
   - **stock 실행** — 기본 테마 위에 `prefix` / `separator` / `important` / `darkMode` 만 올리되
     **`theme.screens` 는 기본 screens 와 내 screens 를 병합**한 것, plugins, presets, safelist 는
     없음. 그래서 `tablet:text-sm`(커스텀 breakpoint)은 stock 실행에서 바로 해석되고, `screens` 를
     `2xl` 없이 교체한 뒤의 `2xl:p-4` 도 마찬가지다 — 기본 Tailwind 는 내고 내 설정은 안 내니 CSS
     출력 기준으로 유령이다.
   두 실행 모두 variant 가 붙은 모든 후보의 **기본 유틸리티**(`hocus:text-sm` → `text-sm`)도 함께
   받아서 5 단계가 그것으로 대체 판정할 수 있게 한다.
   모든 rule 의 selector 를 `postcss-selector-parser` 로 파싱하고, 클래스 노드를 언이스케이프
   (`md\:hover\:text-sm` → `md:hover:text-sm`, `\2c ` → `,`)한 뒤 집합으로 모으며, 그 rule 의 선언도
   함께 기록한다. Tailwind 자체가 실행 결과가 비어 있을 때마다 찍는
   `warn - No utility classes were detected` 메시지(tw-ghost 에게는 정상 상황)는 이 실행 동안
   stderr 에서 걸러 낸다. 그 외 Tailwind 경고는 그대로 나온다.
5. **분류한다.** 후보마다:
   - project 집합에 있으면 `ok`;
   - stock 집합에만 있으면 **ghost**;
   - 둘 다 없고 variant 체인이 붙어 있으면(설정의 `separator` 로, 괄호 깊이 0 에서만 분리하므로
     `[&_svg]:fill-current` 와 `bg-[url(data:image/png;base64,x)]` 도 올바르게 나뉜다) **기본
     유틸리티**로 판정한다: 유틸리티가 stock 에 있고 project 에 없으면 **ghost**
     (`text-sm` 이 죽었을 때의 `tablet:text-sm`, `hocus:text-sm`, `dark:md:hover:text-sm`);
     유틸리티가 project 에 있으면 `unknown-variant`;
   - 그 외에는 `unknown`.
   체인은 실제 variant 체인처럼 보여야 한다(`md:`, `group-hover/edit:`, `data-[state="open"]:`,
   `supports-[display:grid]:`). `class="tablet:text-sm` 같은 extractor 잡음은 `unknown` 으로 둔다.
6. **대체 클래스를 제안한다** (best effort, `--no-suggestions` 로 끌 수 있음). 유령의 루트(`text`,
   `p`, `z`, …)마다 stock 과 키 집합이 다른 모든 테마 섹션의 키로 `root-<key>` 를 생성하고, 유령의
   stock 출력과 실제 CSS 속성(`--tw-*` 커스텀 속성 제외)을 하나 이상 공유하는 것만 남긴다. 숫자 키는
   유령의 키와의 거리순으로 정렬하고 최대 8 개까지 보여준다. variant(설정된 `separator` 로 분리),
   `!`, 음수 `-` 는 제안에 다시 붙인다.

### 설계 선택

무엇이 보고되는지를 결정하는 판단들을, 내 프로젝트에 맞는지 가늠할 수 있게 있는 그대로 적는다:

- **유령은 설정 모양이 아니라 CSS 출력으로 정의한다.** 기본 Tailwind 는 CSS 를 내는데 내 설정은
  내지 않으면 유령이다 — 이유가 무엇이든(스케일 교체, 키 삭제, core plugin 비활성화, `prefix`).
- **어디에서도 해석되지 않는 variant 클래스는 기본 유틸리티로 판정한다.** stock 실행은 내
  `addVariant('hocus', …)` 플러그인이나 커스텀 screen 을 알 수 없으므로 `hocus:text-sm` 은 그냥 두면
  `unknown` 으로 묻힌다. 기본 유틸리티가 내 설정에서 죽어 있으면 ghost; 살아 있으면
  `unknown-variant`(`--unknown` 일 때만 나열, `summary` 에 별도 집계). 추가로 stock 실행은 기본
  screens 와 project screens 를 병합해 쓰므로 커스텀 breakpoint 는 거기서 해석되고
  (`tablet:text-sm` → ghost), 제거된 기본 breakpoint 도 유령으로 남는다 (`2xl` 이 없는데
  `2xl:p-4` → `unknown-variant` 가 아니라 ghost).
- **variant 는 설정된 `separator`(기본 `:`)로, 괄호 깊이 0 에서만 분리한다.** 분류·제안·`--unknown`
  휴리스틱 모두에 동일하게 적용된다. `separator: '_'` 면 `md_hover_tw-text-sm` 이 유령이고
  `md:hover:tw-text-sm` 은 그냥 모르는 단어다.
- **등장 횟수는 온전한 토큰만 센다.** `text-sm` 은 `md:text-sm`, `legacy-text-sm`, `text-sm/50`
  안에서 세지 않고, `p-3` 은 `p-30`, `!p-3`, `-p-3`, `p-3.5` 안에서 세지 않는다. 횟수가 정렬과
  헤드라인을 결정하므로 정직해야 한다.
- **빈 입력 집합은 통과가 아니라 오류다.** 파일 0 개(또는 문자열 `content` glob 이 없는 설정)는
  무엇을 어디서 찾았는지 알려주는 메시지와 함께 종료 코드 2. 정말 의도한 드문 경우에는
  `--allow-empty` 로 종료 코드 0 을 되돌린다.
- **옵션 파싱은 엄격하다.** `--max-locations` 는 0 이상의 정수여야 한다. `3abc` 는 `3` 으로 읽지 않고 거부한다.
- **Tailwind 의 "No utility classes were detected" 경고는** tw-ghost 자체 생성 실행 동안 **숨긴다.**
  내 빌드와 무관한 메시지이고, 안 숨기면 모든 후보가 유령인 실행마다 나온다. 그 메시지만 거른다.
- **unknown 카운터를 둘 다 보고한다.** `summary.unknown` 은 JSON 형태 안정성을 위해 원시 수를
  유지하고, `summary.unknownUtilityLike` 가 CI 에 의미 있는 숫자다. 둘 다 `--unknown` 이 필요 없다.
- **패키징.** `exports` 가 조건별 타입(`import` → `.d.ts`, `require` → `.d.cts`)을 선언해 CommonJS
  TypeScript 사용자가 ESM 타입을 받지 않게 한다. `bin` 은 `dist/cli.js`. `publishConfig.registry`
  가 공개 npm 레지스트리를 고정해 로컬 `npm publish` 가 실수로 사설 레지스트리에 올라갈 수 없다.
  `postcss` 는 선택적 peer 다.

### 알려진 오탐(false positive) 원인

- **의도적으로 CSS 를 원하지 않지만 기본 Tailwind 에는 존재하는 클래스** — 예: 직접 작성한 CSS 가
  처리하는 `container` 같은 훅 이름. `--ignore` 를 사용한다.
- **`unknownVariant` 에 인라인 CSS 토큰이 섞일 수 있다.** `--unknown` 을 주면 extractor 가
  `style="display:flex"` 속성이나 CSS-in-JS 문자열에서 뽑아낸 `속성:값` 쌍이 살아 있는 유틸리티(`flex`)
  위의 variant 체인(`display:`)처럼 보여 `unknown-variant` 로 나열된다. 유령 목록과 종료 코드에는
  영향이 없고, `--ignore "^(display|position|overflow):"` 로 숨길 수 있다.
- **아예 존재하지 않는 variant 아래의 죽은 유틸리티.** `text-sm` 이 죽어 있으면 `bogus:text-sm` 도
  유령으로 보고된다. 기본 유틸리티 대체 판정은 project 전용 variant 와 오타를 구분할 수 없기 때문이다.
  어느 쪽이든 유틸리티 *자체는* 죽어 있으니 보고는 여전히 유효하지만, 고칠 것은 유틸리티가 아니라
  variant 일 수 있다.
- **설정의 `content.transform` / `content.extract`** 는 적용되지 않는다. tw-ghost 는 파일 원문을
  스캔한다. transform 이 소스에 문자 그대로 없는 클래스명을 *만들어 내면* 그것은 보이지 않고(미탐),
  텍스트를 *제거하면* 실제 빌드가 보지 못하는 클래스를 보고할 수 있다.
- **런타임 상태에 의존하는 테마 값**(드묾)은 두 실행에서 동일하게 해석되므로 문제가 없지만,
  `content` 에 따라 조건부로 유틸리티를 내보내는 플러그인은 다를 수 있다.

### 알려진 미탐(false negative) 원인

- **동적 클래스 조립** (`` `text-${size}` ``, 문자열 연결) — Tailwind 도 tw-ghost 도 볼 수 없다.
- **safelist 에 등록된 클래스**는 project 실행에서 CSS 가 나오므로 `ok` 로 분류된다. safelist
  덕분에만 동작하는 경우라도 마찬가지다.
- **존재가 아니라 값만 다른 클래스.** 테마가 키 `4` 를 *유지*하면서 `1rem` 대신 `4px` 로 매핑했다면
  `p-4` 는 CSS 를 만들어 내므로 정상적으로 `ok` 다 — tw-ghost 는 존재 여부를 검사하지 의도를
  검사하지 않는다.
- **modifier 가 붙은 죽은 유틸리티** (`text-sm/6`, `bg-red-500/50`) 는 두 실행 어디에서도 해석되지
  않고 대체 판정할 variant 체인도 없으므로 ghost 가 아니라 `unknown` 이다. `--unknown` 으로 볼 수 있다.
- **extractor 잡음은 기본 유틸리티로 판정하지 않는다.** `class="tablet:text-sm`(따옴표 포함) 같은
  토큰은 `unknown` 으로 남는다. 그 옆의 진짜 `tablet:text-sm` 은 여전히 보고된다.
- **unknown 목록 휴리스틱.** `--unknown` 은 그럴듯한 variant 체인을 떼어 낸 뒤 유틸리티가
  `/^!?-?[a-z][a-z0-9-]*-[^\s]+$/` (variant 체인 아래에서는 `/^!?-?[a-z][^\s]*$/`) 에 맞고,
  `data-`/`aria-`/URL 스킴으로 시작하지 않고, `-` 나 separator 로 끝나지 않으며(`max-h-${x}` 같은
  템플릿 리터럴 조각), 루트(`text-smm` 의 `text`)가 Tailwind 코어 유틸리티 루트이거나 생성된 CSS 에서
  관측된 루트일 때만 후보를 남긴다. 어디에서도 올바르게 쓰인 적 없는 커스텀 플러그인 유틸리티는
  일반 단어와 함께 걸러진다. 모호한 경우는 오탐을 줄이는 쪽으로 정했다.

## 로드맵

- `--format github` (워크플로 어노테이션) 및 SARIF 출력.
- 파일 단위 `// tw-ghost-ignore` 주석.
- CSS 파일 내 `@apply` 검사 옵션.
- 아주 큰 모노레포를 위한 실행 간 후보 추출 캐시.
- 비교 가능한 "생성 후 비교" 경로가 생기면 Tailwind v4 지원.

## 개발 & 릴리스

```sh
pnpm install
pnpm build        # tsup → dist/ (ESM + CJS 라이브러리, shebang 이 붙은 ESM CLI)
pnpm test         # 먼저 빌드한 뒤 vitest (unit + fixture + CLI e2e)
pnpm lint         # biome check .   (pnpm lint:fix 로 적용)
pnpm typecheck    # tsc --noEmit
pnpm pack:check   # npm pack --dry-run — 타르볼 내용 확인
```

픽스처는 `test/fixtures/` (`replaced-scale`, `prefix`, `clean`, `variants`, `separator`, `count`,
`no-content`) 에 있고, 각각 저장소의 dev `tailwindcss` 3.4.x 를 해석하는 `tailwind.config.*` 를 가진다.

**릴리스:** 배포는 **오직** 태그 → GitHub Actions 흐름으로만 한다. 로컬에서 `npm publish` 를
실행하지 말 것 — `prepublishOnly` 와 `publishConfig.registry` 는 안전망이지 절차가 아니다.
`package.json` 과 `CHANGELOG.md` 의 `version` 을 올리고 커밋한 뒤

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

`Release` GitHub Action (`.github/workflows/release.yml`) 이 설치·빌드·테스트 후 npm **trusted publishing**(GitHub OIDC 신원, 토큰 저장 없음)으로 `https://registry.npmjs.org/` 에 `npm publish --provenance --access public` 을 실행한다.
`v*` 태그는 저장소 ruleset 으로 보호되어 저장소 admin 만 만들 수 있으므로, 협업자의 write 권한으로는
릴리스를 트리거할 수 없다.

## 라이선스

MIT
