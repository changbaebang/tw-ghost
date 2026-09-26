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

- 설정 형태로 유효성을 추론하지 않는다. [eslint-plugin-tailwindcss](https://github.com/francoismassart/eslint-plugin-tailwindcss)
  (`no-custom-classname`) 와 [eslint-plugin-better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss)
  (`no-unknown-classes`) 는 그렇게 한다. tw-ghost 는 CLI 와 자체 ESLint 규칙(`tw-ghost/no-ghost-class`, *ESLint*
  참고) 모두 실제 CSS 출력으로 판정한다. CLI 는 Biome / oxlint 팀을 위해 린터 독립적으로 남는다.
- 런타임에 동적으로 조립되는 클래스(`` `text-${size}` ``)는 찾지 못한다. Tailwind 도 못 보는 클래스라
  이미 프로덕션에서 깨져 있는 것이지, 이 리포트에서만 빠지는 것이 아니다.
- Tailwind v4(CSS-first 설정, `tailwind.config.js` 없음)와 3.3 미만의 Tailwind 는 지원하지 않는다. 그건 별도의 major 라인이며, 1.x 는 Tailwind 3.3–3.4 에 머문다.
  발견한 버전을 명시한 메시지와 함께 종료 코드 2 로 끝난다 (*요구 사항 & 호환성* 참고).
- "unknown" 클래스(커스텀 CSS, 일반 단어, 오타)는 기본적으로 보고하지 않는다 — 유틸리티 모양인
  것(오타, 죽은 토큰)은 `--unknown`, 원시 목록 전체는 `--unknown-all` 참고.

## 설치 & 사용

```sh
# tailwind.config.* 가 있는 디렉터리에서 실행 (위로 올라가며 자동 탐지)
npx tw-ghost

# 설정 파일과 glob 을 명시
npx tw-ghost "src/**/*.{ts,tsx}" --config apps/web/tailwind.config.ts

# CI: 기계가 읽을 수 있는 출력, 레거시 접두사 제외, 오타·미지 variant 후보도 나열
npx tw-ghost --json --ignore "^legacy-" --unknown

# 모노레포: 현재 디렉터리 아래의 모든 tailwind.config.* 를 한 번에, JSON 문서 하나로
npx tw-ghost --all-configs --json
```

### 시작하기: `tw-ghost init`

```sh
npx tw-ghost init            # 아래 파일들을 만든다
npx tw-ghost init --dry-run  # 무엇을 만들지만 출력하고 아무것도 쓰지 않는다
```

`init` 은 한 번 스캔한 뒤 tw-ghost 를 계속 돌리는 데 필요한 것을 만들어 준다:

| 파일 | 조건 |
| --- | --- |
| `.github/workflows/tw-ghost.yml` | 항상. 설치 단계와 실행 명령은 패키지 매니저(`packageManager`, 없으면 lockfile: pnpm / yarn / npm / bun)에 맞춰지고, 분석 단계는 `--no-sarif` 가 없으면 SARIF 를 업로드한다 |
| `tw-ghost.fixes.json` | 스캔에서 유령 클래스를 찾았을 때만. `--fix-map-init` 과 같은 초안이며 *유령 클래스 고치기* 로 바로 이어진다 |

**덮어쓰지 않는다**: 이미 있는 파일은 `exists` 로 보고하고 그대로 둔다. 설정을 바꾼 뒤 다시 실행해도
안전하다. 아무것도 설치하지 않고, 커밋하지 않으며, 스캔에서 유령을 찾아도 종료 코드는 `0` 이다 —
빌드를 실패시키는 것은 워크플로의 일이지 스캐폴더의 일이 아니다. `tailwind.config.*` 가 아직 없으면
워크플로만 만들고 이유를 출력한다. 플래그: `--dry-run`, `--no-sarif`, `--no-fix-map`,
`--workflow <name>`, `--config <path>`, `--json`.

### CI

GitHub Actions 스텝에서 `--format github` 을 주면 유령 발생 위치마다 PR 인라인 주석이 달린다
(종료 코드는 다른 형식과 같으므로 스텝은 여전히 실패한다):

```yaml
- run: npx tw-ghost --format github
```

각 줄은 workflow command 이며 발생 위치당 하나다. `file=` 은 `GITHUB_WORKSPACE` 기준 상대 경로다
(파일이 그 밖에 있거나 변수가 없으면 현재 디렉터리 기준):

```
::error file=src/App.tsx,line=7,col=21,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-l, text-m
```

`unknown` / `unknownVariant` 는 `--unknown` 을 줄 때만, 제목 `tw-ghost (unknown)` 의 `::warning`
으로 출력된다. workflow-command 규격대로 모든 메시지에서 `%`·CR·LF 를, `file=` 에서는 추가로
`,` / `:` 를 이스케이프한다. 한 줄 요약(`tw-ghost: 5 ghost classes, 8 occurrences`)은 주석이 되지
않도록 stderr 로 나간다.

GitHub 은 체크 UI 에 **스텝당 레벨(error / warning / notice)별 10개, job 당 50개** 의 주석만
보여준다. 나머지는 로그에는 남지만 인라인으로 표시되지 않는다
([`actions/toolkit` 에 문서화된 제한](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md#limitations)).
`--max-annotations`(기본 `50`)로 출력 수를 제한하며, 잘린 경우 마지막에
`::notice::tw-ghost: K more annotations omitted` 를 출력해 잘렸음을 보이게 한다. `--json` 은
변경 없이 도구 연동용 형식으로 남는다.

#### Code Scanning (SARIF)

주석은 체크 실행과 함께 사라진다. `--format sarif` 는
[`github/codeql-action/upload-sarif`](https://github.com/github/codeql-action) 에 바로 올릴 수 있는
[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) 로그를 stdout 으로
출력한다. 그러면 유령은 주석이 아니라 **code scanning 경고**가 된다 — *Security* 탭에 쌓이고, PR 에
인라인으로 뜨고, 추적된다(코드가 이동해도 같은 경고로 남고, 클래스를 고치면 닫힌다).

```yaml
permissions:
  contents: read
  security-events: write # 결과 업로드에 필요

jobs:
  tw-ghost:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx tw-ghost --format sarif > tw-ghost.sarif
      - if: always() # 유령이 있으면 종료 코드 1 이지만 결과는 올린다
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: tw-ghost.sarif
          category: tw-ghost
```

종료 코드는 그대로이므로 유령이 있으면 job 은 여전히 실패한다. 그래도 경고가 올라가게 하는 것이
`if: always()` 다. (종료 코드 `2` 인 설정 오류면 stdout 에 아무것도 쓰지 않으므로 업로드 스텝이 빈
파일에서 실패한다 — 그게 원하는 신호다.)

로그는 이런 모양이다(result 하나만 남겨 줄임):

```jsonc
{
  "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "tw-ghost",
          "version": "0.5.0",
          "semanticVersion": "0.5.0",
          "informationUri": "https://github.com/changbaebang/tw-ghost#readme",
          "rules": [
            {
              "id": "ghost-class",
              "name": "GhostClass",
              "shortDescription": { "text": "Tailwind class that produces no CSS in this config" },
              "fullDescription": { "text": "The class is a valid stock Tailwind utility, but …" },
              "help": { "text": "Replace the class with one …", "markdown": "**A class that …**" },
              "defaultConfiguration": { "level": "error" },
              "properties": { "tags": ["tailwindcss", "dead-code"] }
            }
          ]
        }
      },
      "columnKind": "utf16CodeUnits",
      "results": [
        {
          "ruleId": "ghost-class",
          "ruleIndex": 0,
          "level": "error",
          "message": {
            "text": "text-sm produces no CSS in this Tailwind config (stock Tailwind: font-size: 0.875rem; line-height: 1.25rem) — try: text-l, text-m, text-s (+1 more)"
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "src/App.tsx", "uriBaseId": "%SRCROOT%" },
                "region": { "startLine": 7, "startColumn": 21, "endColumn": 28 }
              }
            }
          ],
        }
      ]
    }
  ]
}
```

- **발생 위치마다 `result` 하나, 상한 없음.** SARIF 는 스스로 묶고 페이징하는 뷰어가 읽으므로 맞출
  표시 상한이 없다. `--max-annotations` 는 무시하고 `--max-locations` 는 *전부*로 강제한다. 올리는
  쪽에서는 GitHub 이
  [run 당 상위 5,000 건](https://docs.github.com/en/code-security/code-scanning/troubleshooting-sarif-uploads/results-exceed-limit)만
  남긴다(최대 25,000). 그 자르기는 tw-ghost 가 아니라 GitHub 의 것이다.
- **`message.text`** 에는 클래스, 기본 Tailwind 였다면 나왔을 선언, 그리고 대체 후보 최대 3개가
  들어간다(나머지는 `(+N more)` 로 센다).
- **`region`** 은 1-based 이고 클래스 길이만큼만 덮는다. `endColumn` 은 `startColumn` + 클래스 길이,
  단위는 UTF-16 코드 유닛(`columnKind`)이다.
- **`artifactLocation.uri`** 는 POSIX 구분자이며 세그먼트 단위로 퍼센트 인코딩된다(공백 → `%20`,
  `#` → `%23`). `uriBaseId` 는 `"%SRCROOT%"`. 파일이 `GITHUB_WORKSPACE` 아래면 그 기준, 아니면
  현재 디렉터리 기준 — `--format github` 의 `file=` 과 같은 규칙이다. 빌드 머신의 절대 경로는
  로그에 들어가지 않는다.
  cwd 폴백 때문에, `content` glob 이 스캔 디렉터리 위로 올라가고 workspace 가 그 파일을 덮지 않으면
  `../` 경로가 나온다 — Windows 에서 다른 드라이브나 UNC 공유의 파일은 올라갈 공통 루트가 없어
  `D:/…`·`//server/…` 절대 경로로 그대로 나온다. **어느 쪽이든 result 는 남기고, tw-ghost 는 run 마다 한 번 stderr 로 경고한다**
  (`N SARIF results in M files point outside the scanned root (e.g. …)`). 남기는 이유는 그 유령이
  진짜라서다 — 빼면 체크는 붉은데 보여줄 alert 이 없다. 경고하는 이유는 code scanning 이 `../` uri 를
  저장소 파일에 대응시킬 수 없고, `upload-sarif` 가 그 경로에 있는 무엇이든으로 지문을 계산할 수 있기
  때문이다(아래 참고). 경고는 종료 코드를 바꾸지 않는다. 저장소 밖 파일은 애초에 표현할 수 없고, 저장소 안 파일이라면 저장소
  루트에서 실행하거나 `GITHUB_WORKSPACE` 를 설정하면 경로가 저장소 기준이 되고 경고도 사라진다.
- **`partialFingerprints` 를 넣지 않는다.** code scanning 이 읽는 partial fingerprint 는
  [`primaryLocationLineHash`](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support#result-object)
  하나뿐이고, `upload-sarif` 가 그 키가 없는 result 마다 체크아웃된 소스에서 그것을 계산한다.
  tw-ghost 자체 키를 넣으면 로그에 실려 가지만 GitHub 은 읽지 않는다 — action 이 지원 키를 붙이는
  것을 막지는 않지만, 아무도 지키지 않는 추적 보장처럼 읽힌다. 그래서 아무것도 넣지 않는다.
  지문 계산이 의존하는 것은 **action 이 파일로 되돌릴 수 있는 `uri`** 다. action 의
  `resolveUriToFile` 은 `uriBaseId` 를 보지 않고, 퍼센트 인코딩을 디코딩한 뒤 상대 경로를 소스 루트에
  붙인다. 즉 저장소 기준 URI 가 동작하는 이유는 저장소 기준이라서이고 `%SRCROOT%` 덕이 아니다(그쪽은
  표시용이다). 스캔 루트 아래 파일에 대해 내보낸 모든 `uri` 가 그 방식으로 풀리는지 테스트가
  단정한다. 위의 `../` 경로는 이 계약 밖이다: action 은 *절대* 경로만 소스 루트 밖인지 검사하므로
  `../x` 를 그대로 붙여 거기 있는 파일 — 이웃 패키지의 파일일 수도 있다 — 을 잡고, code scanning 은
  어차피 그 파일의 저장소 경로를 모른다.
  실제 업로드로 측정했다. 한 파일에 `ghost-class` finding 13개(한 줄에 5개, 바이트 동일한 줄에 6개,
  나머지 2개)를 넣어 서로 다른 `primaryLocationLineHash` 가 9개인 로그를 올렸더니 **13개 finding 이
  13개 alert** 이 됐다 — alert 은 result 단위이므로 한 줄에 유령이 여럿이어도 뭉개지지 않는다. 그리고
  블록 전체를 수정 없이 5줄 아래로 밀었을 때 **13개 alert 번호가 전부 유지**되고 새로 열린 것도,
  은퇴한 것도 없었다.
- **규칙은 그 실행이 낼 수 있는 것만 선언한다.** `ghost-class`(레벨 `error`)는 항상,
  `unknown-utility-like` 와 `unknown-variant`(둘 다 레벨 `note` 라 경고 심각도를 올리지 않는다)는
  `--unknown` 일 때만 선언되고, 그때만 결과도 나온다. 스키마상 쓰지 않는 규칙을 선언해도 되지만,
  선언하지 않는 편이 그 실행의 어휘를 정직하게 보여준다.

**설정이 여러 개면 run 도 여러 개.** `--all-configs`(또는 `--config` 반복)는 **설정마다 run 하나**를
만들고, 각 run 은 자기 `tool.driver.rules` 와 `tw-ghost/<설정 경로>` 형태의 `automationDetails.id` 를
갖는다. 같은 클래스가 한 설정에서는 유령이고 다른 설정에서는 멀쩡한 것이 정상이라, 하나의 run 으로
합치면 그 판정을 설명하는 유일한 정보를 버리게 된다. code scanning 은 run 을 따로 보여주므로 이
구분이 그대로 남는다. `uri` 는 각 설정 폴더가 아니라 저장소 루트 기준이라, 두 앱이 함께 잡은 공용
패키지가 양쪽에서 같은 파일을 가리킨다. 로드에 실패한 설정은 run 이 되지 않는다 — 이미 stderr 에
찍혔고 이미 종료 코드 `2` 를 만든다. 세 가지 주의:

- **id 는 설정이 몇 개 성공했는지, 몇 개 발견됐는지에 따라 달라지지 않는다.** 판단 기준은 *요청*이다 —
  `--all-configs`, glob, 반복 `--config` 는 하나만 매치돼도 설정별 id 를 받는다. code scanning 은 이
  id 로 분석을 식별하므로, 개수로 정하면 형제 설정이 깨지거나 삭제된 순간 살아남은 설정이 개명되고
  GitHub 은 그것을 다른 분석으로 읽는다 — 바뀐 적 없는 설정의 alert 을 은퇴시키고 새로 연다. 스캔을
  가장 못 믿을 때 정확히 그렇게 된다.
- **단일 설정 요청**(경로 하나짜리 `--config`, 또는 자동 탐지)은 `automationDetails` 를 **넣지 않는다**.
  그래야 `upload-sarif` 의 `category:` 가 그 run 의 이름이 된다. 이건 action 이 빈 자리를 채우는 것이고
  덮어쓰는 게 아니다 — `automationDetails` 가 없을 때만 설정하므로 위의 설정별 id 는 업로드 후에도
  그대로 남는다.
- GitHub 은 [SARIF 파일 하나당 run 20개](https://docs.github.com/en/code-security/code-scanning/troubleshooting-sarif-uploads/results-exceed-limit)까지만
  받는다. Tailwind 설정이 20개를 넘는 저장소는 업로드를 나눠야 한다(설정을 묶어 여러 번 실행하고
  업로드마다 다른 `category:` 를 준다).

**불완전한 스캔은 baseline 이 되어선 안 된다.** 종료 코드 `1` 은 유령을 찾았고 스캔은 끝났다는
뜻이라 그 로그는 완전하고, 업로드하는 것이 이 잡의 목적이다. `2` 는 tw-ghost 가 끝내지 못했다는
뜻이다 — 설정 하나가 로드에 실패했고 그 run 은 아예 없다. 그 로그를 올리면 빠진 설정의 alert 이
고쳐진 것처럼 은퇴한다. 그래서 `tw-ghost init` 이 쓰는 워크플로는 `if: always()` 대신 종료 코드로
업로드를 막는다:

```yaml
- id: scan
  shell: bash
  run: |
    code=0
    npx tw-ghost@<워크플로를 쓴 버전> --format sarif > tw-ghost.sarif || code=$?
    echo "code=$code" >> "$GITHUB_OUTPUT"
    exit "$code"
- if: ${{ !cancelled() && (steps.scan.outputs.code == '0' || steps.scan.outputs.code == '1') }}
  uses: github/codeql-action/upload-sarif@<sha>
  with:
    sarif_file: tw-ghost.sarif
    category: tw-ghost
```

`|| code=$?` 는 `bash -e` 가 코드를 기록하기 전에 중단하는 것을 막고, `exit "$code"` 가 그것을 다시
올려 유령이 여전히 체크를 실패시키게 한다. 게이트는 업로드해도 되는 코드를 열거하므로 예상 못 한
코드는 업로드하지 않는다 — 그리고 "끝내지 못했다"에 tw-ghost 가 쓰는 코드는 예상치 못한 예외까지
포함해 `2` 하나뿐이라 더 열거할 것이 없다. `shell: bash` 를 명시한 이유는 여러 줄 스크립트이기
때문이다: 생성되는 `runs-on` 은 `ubuntu-latest` 지만 `windows-latest` 로 바꾸면 기본 셸이
PowerShell 이 된다.

stdout 은 파일로 넘어가므로 한 줄 요약
(`tw-ghost: 5 ghost classes, 8 occurrences → 8 SARIF results in 1 run`)은 stderr 로 나간다.

Node ≥ 22 과 대상 프로젝트에 설치된 `tailwindcss` 3.3–3.4 (peer dependency) 가 필요하다.
`postcss` ^8 은 *선택적* peer 다: 설정 파일 옆에 `postcss` 가 설치되어 있으면 그것을 쓰고, 없으면
`tailwindcss` 자신이 의존하는 `postcss` 로 대체하므로 `tailwindcss` 만 설치되어 있어도 충분하다.
내 환경에 맞는지 확실하지 않다면 `npx tw-ghost --env` 를 실행한다 — 해석한 결과를 출력하거나,
정확한 이유와 함께 실패한다(종료 코드 2).

### ESLint

같은 판정을 에디터에서, 타이핑하는 동안. tw-ghost 는 ESLint 플러그인을 서브패스로 함께 배포한다 — 추가
패키지 없음, ESLint 자체에 대한 의존성 없음 (ESLint ≥ 9, flat config):

```js
// eslint.config.js
import twGhost from 'tw-ghost/eslint';

export default [
  // …기존 설정…
  twGhost.configs.recommended, // `tw-ghost/no-ghost-class` 규칙을 "error" 로
];
```

```jsx
<div className="text-sm p-3" />
//              ~~~~~~~ `text-sm` produces no CSS in this Tailwind config
//                      (stock Tailwind would set font-size: 0.875rem; line-height: 1.25rem).
```

규칙이 보는 것: `className` / `class` 속성 안의 문자열 리터럴과 템플릿 리터럴 텍스트(`cond ? 'a' : 'b'`,
`cond && 'a'`, 배열, `{ 'a': cond }` 의 키 포함), 그리고 `clsx`, `cx`, `cn`, `classnames`, `cva`, `tv`,
`twMerge`, `twJoin` 의 인자(`callees` 옵션). 동적인 조각(`` `text-${size}` ``)은 Tailwind 자신이 그러듯
건너뛴다. 각 클래스는 프로젝트의 `tailwindcss` JIT 엔진으로 동기 판정한다 — 설정은 `tailwind.config.*`
하나당 한 번 로드하고(린트 대상 파일에서 위로 올라가며 찾거나 `config` 로 지정), mtime 이 바뀌면 다시 로드한다.

옵션 (모두 선택):

| 옵션 | 기본값 | 의미 |
| --- | --- | --- |
| `config` | 파일 위의 가장 가까운 `tailwind.config.*` | 설정 파일 경로 (ESLint cwd 기준). |
| `callees` | `clsx, cx, cn, classnames, classNames, cva, tv, twMerge, twJoin` | 문자열 인자가 클래스인 함수들. |
| `attributes` | `className, class` | 스캔할 JSX 속성. |
| `ignore` | `[]` | 정규식; 일치하는 클래스는 건너뛴다. |
| `reportUnknownVariant` | `false` | `unknown-variant`(이 설정이 모르는 변형 아래의 유효한 유틸리티)도 보고. |
| `reportUnknown` | `false` | 어디에서도 CSS 를 만들지 않는 유틸리티 모양 클래스(오타)도 보고. 잡음이 많으니 CLI 의 `--unknown` 을 권장. |

설정 문제는 린트 실행을 죽이지 않고 파일당 한 번 린트 메시지로 보고한다(`tw-ghost could not load the
Tailwind config: …`, `tw-ghost found no tailwind.config.*…`). 발견을 한꺼번에 고치는 길은 CLI 의 `--fix-map`
이다. 대체 클래스는 디자인 결정이라 규칙에는 autofix 가 없다(*유령 클래스 고치기* 참고).

**`eslint-plugin-tailwindcss` 와의 차이.** 그 플러그인은 설정 객체로 유효성을 추론한다. 이 규칙은 Tailwind
엔진에 "이 클래스가 내 설정과 기본 Tailwind 에서 *CSS 를 만드는가*"를 묻기 때문에, 교체된 스케일(`sm` 이 없는
`fontSize`)은 발견이고 커스텀 플러그인 유틸리티는 발견이 아니다. Biome / oxlint 사용자는 CLI 를 그대로 쓴다.
거기엔 붙을 플러그인 API 가 없다.

### 모노레포

`--config` 가 없으면 tw-ghost 는 현재 디렉터리에서 위로 올라가며 **가장 가까운** `tailwind.config.*`
하나만 로드한다 — 트리 안의 모든 설정을 스스로 찾아 돌지는 않는다. 여러 앱을 한 번에 검사하려면
직접 지정하거나 찾게 한다:

```sh
# 저장소 루트에서 권장: cwd 아래의 모든 tailwind.config.{ts,js,cjs,mjs}
npx tw-ghost --all-configs

# 또는 명시적으로: --config 는 반복 가능하고 glob 을 받는다
npx tw-ghost --config 'apps/*/tailwind.config.ts' --config packages/ui/tailwind.config.js
```

- 각 설정은 **독립적으로, 자기 디렉터리 기준으로** 분석된다: `content` glob 은 단일 실행과 똑같이
  설정 파일 기준으로 해석되고, 그 설정이 속한 `tailwindcss` 설치본이 판정한다. 위치 인자 glob 을
  주면 cwd 기준으로 해석되어 **모든** 설정에 적용된다.
- 사람이 읽는 출력은 설정마다 `== apps/web/tailwind.config.ts (N files, K ghosts)` 헤더와 그 설정의
  리포트를 출력한 뒤 `total:` 한 줄로 끝난다. `--json` 은 *출력 예시* 에 있는 다중 설정 문서로
  바뀌고, `--env` 는 설정마다 블록을 하나씩 출력한다.
- **설정 간 중복 제거는 없다.** 여러 설정이 포함하는 공용 파일(`packages/ui/src/Button.tsx`)은
  각 설정이 따로 스캔하고, 두 설정 모두에서 유령인 클래스는 양쪽에 다 나온다 — 그것이 목적이다.
  같은 `text-sm` 이 `apps/web` 에서는 살아 있고 `apps/admin` 에서는 죽어 있을 수 있다.
- 종료 코드는 **어느 하나라도** 유령이 있으면 `1`(`--fail-on` 적용), **어느 하나라도** 로드·스캔에
  실패하면 `2` — 실패한 설정은 `{ config, error }` 로 보고되고 나머지는 계속 분석되며, stderr 에
  몇 개가 실패했는지 찍힌다. `--all-configs` 가 아무것도 찾지 못해도 `2` 이며 탐색한 디렉터리를
  알려 준다. `node_modules`, `dist`, `.next`, `build`, `out`, `coverage` 는 건너뛴다.
- 앱들이 확장하려고만 두는 베이스 설정(`content` 에 맞는 파일 없음)은 *No files matched* /
  *Nothing to scan* 으로 실패한다. `--allow-empty` 를 주거나 명시적 `--config` 목록에서 빼면 된다.

## 요구 사항 & 호환성

tw-ghost 는 **대상 프로젝트에 설치된 `tailwindcss`** 를 공개 진입점 `loadConfig` / `resolveConfig`
와 PostCSS 로 구동한다. 아래 내용은 모두 거기서 따라 나온다.

### 무엇이 안정적인가

tw-ghost 는 1.0 을 향해 가고 있고, 1.0 의 뜻은 하나다: **이 표면은 major 버전 없이 깨지지 않는다.**

- CLI: 문서화된 모든 플래그와 그 의미, 종료 코드 `0` / `1` / `2`.
- `--json`: 키는 minor 에서 추가될 수 있고, major 가 아니면 삭제되거나 타입이 바뀌지 않는다.
- `--format sarif`: 위에 문서화된 run/result 모양의 유효한 SARIF 2.1.0, `automationDetails.id` 의 도출
  규칙, 생성 워크플로의 업로드 게이트 계약.
- `--format github`: occurrence 당 `::error` 하나, `GITHUB_WORKSPACE` 기준 상대 경로의 `file=`.
- ESLint 룰 `tw-ghost/no-ghost-class` 와 그 옵션.
- **이 문서에 적힌 대로의** 프로그래매틱 API — *프로그래매틱 API* 절 전체, 각 절에서 이름을 밝힌
  init·SARIF·fix-map 함수들, `createLiveClassifier`. 여기 문서화되지 않은 심볼은 내부용이며 이 계약 밖이다:
  어느 릴리스에서든 바뀔 수 있다.

**폐기.** 안정 표면에서 무언가를 빼려면 먼저 폐기 표시를 한다 — 가능한 곳엔 런타임 경고, 여기와
CHANGELOG 에 메모 — 그리고 최소 한 minor 릴리스 뒤 major 에서 제거한다.

**Tailwind 라인.** 1.x 라인은 Tailwind CSS 3.3–3.4 다. Tailwind v4 에는 `tailwind.config.*` 가 없어
"생성해서 비교" 하는 코어를 다른 API 위에 다시 세워야 한다. 그렇게 된다면 그건 새 major 라인이고,
1.x 의 minor 가 아니다.

### 지원 매트릭스

| 영역 | 상태 | 비고 |
| --- | --- | --- |
| Tailwind CSS 3.3.x – 3.4.x | ✅ 지원 | 3.3.0 과 3.4.19 로 검증 (픽스처는 3.4.x 사용). 이후의 3.x 도 받아들인다. |
| Tailwind CSS 3.0 – 3.2 | ❌ 종료 코드 2 | 3.3.0 이전에는 `tailwindcss/loadConfig` 가 없다. 메시지: `found 3.2.7, need >=3.3.0`. |
| Tailwind CSS 4.x | ❌ 종료 코드 2 | CSS-first, JS 설정 없음, 생성 모델이 다르다. tw-ghost 는 v3 전용이다. |
| Tailwind CSS ≤ 2.x | ❌ 종료 코드 2 | tw-ghost 가 필요로 하는 진입점이 아직 없던 시절이다. |
| Node.js | ≥ 22 | CI 는 Linux 와 Windows 모두에서 22 와 24 를 실행한다. Node 20 은 2026-04-30 에 EOL 이 되어 지원하지 않는다. Node ≥ 22.12 에서 CommonJS 패키지 안의 `.ts` 설정은 Tailwind 로더가 넘겨받기 전에 *Node* 가 `Warning: Failed to load the ES module` 한 줄을 출력한다 — 무해하다. |
| 설정 파일 | `tailwind.config.{ts,js,cjs,mjs}` | cwd 에서 위로 올라가며 자동 탐지하거나 `--config`. CJS `module.exports`, ESM `export default`, TypeScript(`satisfies Config`, `import type`)를 Tailwind 자체의 jiti 기반 로더로 읽는다. 설정 안의 `import.meta` 는 Tailwind ≥ 3.4.2 (또는 Node ≥ 22.12) 가 필요하다. **함수**를 export 하는 설정은 거부한다 (Tailwind v3 도 지원하지 않는다). |
| `content` | 배열 또는 `{ files, relative, transform, extract }` | **문자열 glob 만** 스캔하며 설정 파일 디렉터리 기준으로 해석한다. `{ raw }` 항목은 무시. `transform` / `extract` 는 **적용하지 않는다**(경고). `relative: true` 는 tw-ghost 에 아무 변화가 없다 — 원래 그렇게 해석한다. |
| 설정 기능 | `presets`, `plugins`(`addUtilities` / `addComponents` / `addVariant` / `matchUtilities`), `prefix`, `separator`, `important`(불리언 또는 셀렉터), `darkMode`, `safelist`(문자열과 `{ pattern }`), `corePlugins`(객체 또는 배열), `theme` 교체 / `extend`, 함수형 테마 섹션(`({ theme }) => …`) | 설정을 해석하고 실행하는 것이 내 Tailwind 이므로 전부 반영된다. tw-ghost 는 아무것도 재구현하지 않는다. 플러그인이 추가한 클래스에는 `prefix` 가 붙고(Tailwind 동작), 테마에서 죽은 클래스는 safelist 에 넣어도 여전히 유령이다 — safelist 는 후보를 추가할 뿐 CSS 를 만들어 내지 못한다. |
| 프레임워크 | 무관 | Next, Vite, CRA, Astro, SvelteKit, Nuxt, Remix … tw-ghost 는 설정을 읽고 파일을 스캔할 뿐 빌드에 끼어들지 않는다. |
| 모노레포 | ✅ | 루트에서 `--config packages/web/tailwind.config.ts` 가 동작하고, 워크스페이스 패키지에서 `require()` 한 preset 은 설정 파일 기준으로 해석된다. `tailwindcss` 는 **설정 파일 디렉터리에서 위로** 해석한다(루트에 호이스팅된 설치도 괜찮다). 그 탐색이 닿지 않으면(엄격한 레이아웃, `node_modules` 없는 폴더의 설정) `--tailwind <dir>` 을 넘긴다. |
| 패키지 매니저 | npm / pnpm / yarn | 위의 Tailwind 해석 외에는 무관하다. |
| `postcss` | 선택적 peer | 설정에서 해석되면 프로젝트의 `postcss`, 아니면 `tailwindcss` 가 의존하는 것(`tailwindcss` 만 닿는 레이아웃으로 검증). |
| CSS 의 `@config` (Tailwind ≥ 3.2) | 읽지 않음 | tw-ghost 는 설정 **파일**이 필요하다. `@config` 가 가리키는 파일을 `--config` 로 지정한다. |
| Linux / macOS | ✅ 지원 | CI 는 `ubuntu-latest` 에서 실행하고, 개발은 macOS 에서 한다. |
| Windows | ✅ 지원 | CI 가 `windows-latest` × Node 22 / 24 에서 전체 스위트를 돌린다(lint, typecheck, build, 테스트, `npm pack` — Linux 와 같은 작업). glob 은 어느 구분자든 받는다 — glob 엔진이 `\` 를 이스케이프로 읽기 때문에 `src\**\*.tsx` 는 POSIX 형태로 바꾼다 — 보고 경로는 항상 `/` 로 정규화해 플랫폼간 어노테이션이 같다. `--fix-map --write` 는 줄마다 원래 줄바꿈을 그대로 유지하므로 CRLF/LF 가 섞인 파일을 통째로 다시 쓰지 않고, UTF-8 BOM 은 보존하며 컬럼 수에 넣지 않는다. **주의:** `--config` 와 위치 인자 glob 에 `\` 를 써도 되지만, `!negation` 은 PowerShell 에서 따옴표로 묶어야 하고, 리터럴 `[` · `(` 를 포함하는 패턴은 Windows 에서 `\` 로 이스케이프할 수 없다(거기서 `\` 는 구분자다) — 더 넓은 glob 과 `--ignore` 를 쓴다. |

### 스캔하는 것 / 하지 않는 것

- **스캔:** `content` 문자열 glob(또는 위치 인자 glob)에 걸리는 모든 파일을 원문 그대로, 한 줄씩,
  Tailwind 자체 기본 extractor 로 읽는다. extractor 가 언어를 가리지 않으므로 `.tsx`, `.vue`,
  `.svelte`, `.astro`, `.mdx`, `.html`, `.css` … 어떤 파일 종류든 동작한다. `clsx()`, `cva()`,
  `tv()`, 템플릿 리터럴 안의 문자열 리터럴도 Tailwind 가 보는 그대로 — 텍스트로 — 본다.
- **`@apply` 는 CSS 로 판정하지 않는다.** glob 에 걸린 `.css` 파일은 텍스트로 스캔하므로 `@apply`
  뒤의 클래스명도 여느 토큰처럼 후보가 되지만, tw-ghost 는 CSS 를 파싱하거나 `@apply` 의미를
  이해하지 않는다 (Tailwind 자체가 죽은 클래스를 `@apply` 하면 빌드를 실패시키므로, 통과하는
  빌드에서 이것이 유령인 경우는 드물다).
- **보지 못하는 것:** 런타임에 조립되는 클래스명(`` `text-${size}` ``, 문자열 연결) — Tailwind 도
  못 본다; `content.transform` / `content.extract` 만이 만들어 내는 클래스; glob 에 걸리지 않는
  파일의 모든 것. Svelte 의 `class:z-20={…}` 지시자는 `class:z-20` 토큰으로 추출되어 기본
  유틸리티로 판정되므로, 죽은 `z-20` 은 그 표기로 보고된다.

### 실패하는 방식

아래 조건은 모두 종료 코드 **2** 로 끝나고, stdout 에는 아무것도 쓰지 않으며, stderr 에
`tw-ghost:` 로 시작하는 한 줄을 출력한다 — 잘못 설정된 실행이 "유령 0 개" 로 CI 를 통과할 수 없다.

| 조건 | 메시지 시작 |
| --- | --- |
| 모르는 플래그 / 잘못된 값 | `tw-ghost: Unknown option …` / `tw-ghost: --max-locations must be …` / `tw-ghost: --fail-on must be …` |
| 설정 파일 없음 | `tw-ghost: No tailwind.config.{ts,js,cjs,mjs} found walking up from <cwd>. Pass --config <path>.` |
| `--config` 경로 없음 | `tw-ghost: Config file not found: <path>` |
| `tailwindcss` 해석 불가 | `tw-ghost: Could not resolve "tailwindcss" from <dir>. Resolution starts at the config file's directory …` (`--tailwind <dir>` 제안) |
| `--tailwind` 디렉터리 없음 | `tw-ghost: --tailwind directory not found: <dir>` |
| Tailwind 4.x | `tw-ghost: Unsupported Tailwind CSS version: found 4.1.14, tw-ghost supports 3.3.x – 3.4.x only. Tailwind v4 is CSS-first … tw-ghost is v3-only.` |
| Tailwind ≤ 2.x | `tw-ghost: Unsupported Tailwind CSS version: found 2.2.19, tw-ghost supports 3.3.x – 3.4.x only. … upgrade to tailwindcss 3.3.0 or newer.` |
| Tailwind 3.0 – 3.2 | `tw-ghost: Unsupported Tailwind CSS version: found 3.2.7, need >=3.3.0. "tailwindcss/loadConfig" … was added in 3.3.0` |
| `loadConfig` / `resolveConfig` 가 없는 3.3+ 설치 | `tw-ghost: tailwindcss <ver> at <dir> does not provide "tailwindcss/loadConfig" and "tailwindcss/resolveConfig"` |
| 설정이 throw / `require()` 실패 | `tw-ghost: Failed to load <config>: <원인 메시지>` (스택 트레이스 없음) |
| 설정이 함수를 export | `tw-ghost: <config> exports a function. Tailwind v3 expects a plain config object …` |
| 설정이 null / 원시값을 export | `tw-ghost: <config> did not export a config object (got …)` |
| `resolveConfig` 가 throw | `tw-ghost: Failed to resolve <config> with tailwindcss/resolveConfig: …` |
| 문자열 `content` glob 도 위치 인자 glob 도 없음 | `tw-ghost: Nothing to scan: pass file globs on the command line or add string globs to the config's "content" (or pass --allow-empty).` |
| glob 에 걸린 파일 0 개 | `tw-ghost: No files matched "<globs>" (resolved from <dir>). …` |
| 잘못된 `--ignore` 정규식 | `tw-ghost: Invalid --ignore pattern …` |

경고는 종료 코드를 **바꾸지 않는다**. 각각 stderr 에 `tw-ghost: warning: …` 으로 한 번 출력되고
`report.warnings`(`--json`)에도 실린다:

| 경고 | 언제 |
| --- | --- |
| `content.transform/content.extract are not applied; …` | 설정에 `content.transform` 이나 `content.extract` 가 있을 때. transform 만이 만들어 내는 클래스는 보이지 않고, transform 이 지웠을 클래스는 여전히 판정된다. |
| `tailwindcss/lib/lib/defaultExtractor could not be loaded …; using tw-ghost's bundled copy` | Tailwind 내부 extractor 경로가 없을 때. 리포트의 `extractor` 가 `bundled` 가 된다. |

### `--env`: 버그 리포트에 붙여 넣을 것

```
$ npx tw-ghost --env
tw-ghost     0.1.0
node         v22.11.0 (darwin-arm64)
cwd          /work/acme-web
config       /work/acme-web/tailwind.config.ts
tailwindcss  3.4.19  /work/acme-web/node_modules/tailwindcss
postcss      8.5.6  /work/acme-web/node_modules/postcss
extractor    project
content      2 globs (resolved from /work/acme-web)
               ./src/**/*.{ts,tsx}
               ./app/**/*.{ts,tsx}
content opts relative=false transform=false extract=false
prefix       ""
separator    ":"
important    false
darkMode     "class"
```

`--env` 는 일반 실행과 같은 사전 점검(설정 탐지, `--config`, `--tailwind`)을 거치고 실패하면 같은
메시지로 종료 코드 2 를 내므로, 내 프로젝트가 지원되는지 확인하는 가장 빠른 방법이기도 하다.
`--env --json` 은 같은 데이터를 `warnings` 를 포함한 JSON 으로 출력한다.

## CLI 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `[globs...]` | 설정의 `content` glob | 스캔할 파일. 위치 인자 glob 은 현재 디렉터리 기준으로 해석되며 설정의 `content` 목록을 대체한다. |
| `-c, --config <path>` | cwd 에서 위로 탐색 | 로드할 `tailwind.config.{ts,js,cjs,mjs}`. 반복 가능하고 glob 을 받는다(`'apps/*/tailwind.config.ts'`, `node_modules` 제외). 아무것도 맞지 않는 glob 은 종료 코드 `2`. 설정이 둘 이상이면 다중 설정 출력(*모노레포* 참고). |
| `--all-configs` | off | cwd 아래의 모든 `tailwind.config.{ts,js,cjs,mjs}` 를 분석(`node_modules`, `dist`, `.next`, `build`, `out`, `coverage` 제외). 하나도 없으면 종료 코드 `2`. `--config` 와 함께 쓸 수 있다. |
| `--tailwind <dir>` | 설정 파일 디렉터리 | `tailwindcss`(와 `postcss`)를 설정 파일 디렉터리 대신 이 디렉터리에서 해석. 설정 폴더에서 설치본에 닿지 못하는 레이아웃용. 설정 파일 자체는 여전히 제 위치에서 로드된다. |
| `--env` | 꺼짐 | 해석한 환경(설정, `tailwindcss` 버전 + 경로, `postcss`, extractor, content glob, 경고)을 출력하고 0 으로 종료 — 또는 사전 점검 오류와 함께 2 로 종료. `--json` 과 조합 가능. |
| `--format <human\|json\|github\|sarif>` | `human` | 출력 형식. `github` 는 유령 **발생 위치마다** `::error` [workflow-command 주석](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-error-message) 한 줄을 출력한다(모든 위치, `--max-locations` 무시) 그리고 stderr 에 한 줄 요약. `sarif` 는 GitHub Code Scanning 용 [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) 로그를 출력한다 — 발생 위치마다 `result` 하나, 상한 없음. 둘 다 *CI* 참고. |
| `--json` | 꺼짐 | `--format json` 의 별칭: stdout 에 기계가 읽을 수 있는 리포트 출력. 변경 없음. |
| `--max-annotations <n>` | `50` | `github` 전용: 이 수만큼 주석을 출력하고 나머지는 `::notice::tw-ghost: K more annotations omitted` 한 줄로 접는다. `0` = 전부. `sarif` 는 무시한다(SARIF 에는 표시 상한이 없다). |
| `--unknown` | 꺼짐 | **유틸리티 모양** unknown 도 나열 — 기본 Tailwind 에서도 프로젝트에서도 CSS 가 안 나오지만 접두사가 Tailwind 유틸리티이고 값이 그 유틸리티가 받을 법한 모양인 클래스(`text-mm`, `px-13`, `rounded-xll`; 오타와 죽은 토큰). 등장 횟수, 그다음 이름순 정렬. 여기에 유틸리티는 동작하지만 variant 체인을 이 설정이 모르는 클래스(`unknownVariant`)도. 루트만 같은 식별자(`my-page`, `no-op`, `bottom-start`)는 보이지 않는다. |
| `--unknown-all` | 꺼짐 | `--unknown` 과 함께: 유틸리티 모양 부분집합 대신 원시 unknown 토큰 전부를 나열 (extractor 가 본 모든 단어·식별자·URL — 실제 앱에서는 수만 줄). 정렬은 같다. |
| `--max-locations <n>` | `3` | 클래스당 유지할 위치 수. `0` = 전부. 0 이상의 정수만 허용 (`3abc` 는 종료 코드 2 로 거부). |
| `--ignore <regex>` | – | 이름이 일치하는 클래스를 건너뜀. 반복 지정 가능. |
| `--allow-empty` | 꺼짐 | 일치하는 파일이 없거나 스캔할 설정이 없을 때 빈 리포트로 `0` 종료. 없으면 종료 코드 `2` 이므로 glob 오타가 CI 를 조용히 통과할 수 없다. |
| `--fail-on <ghost\|none>` | `ghost` | 종료 코드를 `1` 로 만드는 조건. |
| `--no-suggestions` | 꺼짐 | 대체 클래스 탐색 생략 (테마가 아주 클 때 더 빠름). |
| `--fix-map-init <file>` | – | 현재 유령 클래스로 **수정 맵 초안**을 쓰고 exit 0: 키는 bare 유틸리티(변형 제거) 하나당 하나, 값은 단일 제안·후보 목록·`null` 중 하나. 이미 있는 파일은 덮어쓰지 않는다. |
| `--fix-map <file>` | – | 수정 맵 적용(*유령 클래스 고치기* 참고): 매핑된 유령의 모든 출현을 교체 또는 제거하고 변형·`!`·`-` 는 그대로 옮긴다. `--write` 가 없으면 **dry run**. 매핑되지 않은 유령이 남으면 exit 1 (`--fail-on none` 이면 0). |
| `--write` | 꺼짐 | `--fix-map` 과 함께: 바뀐 파일을 실제로 쓴다. |
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

`--json` (모양은 **minor** 릴리스 간에 안정적이다: 키는 minor 에서 추가될 수 있고, major 가 아니면 삭제되거나 타입이 바뀌지 않는다):

```json
{
  "version": "0.1.0",
  "configPath": "/work/acme-web/tailwind.config.ts",
  "tailwindVersion": "3.4.17",
  "extractor": "project",
  "warnings": [],
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

`unknown` 과 `unknownVariant` 배열은 `--unknown` 을 줄 때만 채워진다. `unknown` 은 유틸리티 모양
부분집합(`summary.unknownUtilityLike` 개)을 담고, `--unknown-all` 을 함께 주면 원시 unknown 전부
(`summary.unknown` 개)를 담는다. 둘 다 `count` 내림차순, 그다음 `class` 순으로 정렬된다. summary 의
두 카운터는 어느 쪽이든 같으므로, 소비자는 `unknown.length` 로 어느 목록을 받았는지 알 수 있다.

**설정이 여러 개일 때** (`--all-configs`, 또는 둘 이상의 파일로 해석되는 `--config`): 문서는
`{ version, configs, summary, durationMs }` 가 된다. `configs[]` 의 각 항목은 `{ config, …report }`
— `config` 는 cwd 기준 상대 경로, 나머지는 위의 단일 설정 리포트에서 `version` 만 뺀 것 — 이거나,
실패한 설정이면 `{ config, error }` 다. `summary` 는 설정별 summary 를 합산하고 `configs`(항목 수),
`failed`, `filesScanned`, `candidateCount` 를 더한다. 설정이 정확히 **하나**면 어떻게 지정했든
(`--config a`, 파일 하나에 맞는 glob, 하나만 찾은 `--all-configs`) 출력은 위의 단일 설정 문서와
바이트 단위로 같다.

```json
{
  "version": "0.5.0",
  "configs": [
    {
      "config": "apps/admin/tailwind.config.js",
      "configPath": "/work/acme/apps/admin/tailwind.config.js",
      "tailwindVersion": "3.4.17",
      "extractor": "project",
      "warnings": [],
      "filesScanned": 2,
      "candidateCount": 27,
      "summary": { "ok": 4, "ghost": 2, "unknown": 21, "unknownVariant": 0, "unknownUtilityLike": 0 },
      "ghosts": [ … ],
      "unknown": [],
      "unknownVariant": [],
      "durationMs": 86
    },
    { "config": "apps/legacy/tailwind.config.js", "error": "Failed to load /work/acme/apps/legacy/tailwind.config.js: …" },
    { "config": "apps/web/tailwind.config.ts", … }
  ],
  "summary": {
    "configs": 3,
    "failed": 1,
    "filesScanned": 4,
    "candidateCount": 54,
    "ok": 8,
    "ghost": 4,
    "unknown": 42,
    "unknownVariant": 0,
    "unknownUtilityLike": 0
  },
  "durationMs": 270
}
```

## 유령 클래스 고치기

tw-ghost 는 대체 클래스를 스스로 추측하지 않는다. `text-sm` 이 어떤 디자인 시스템에서는 `text-l` 이고 다른
곳에서는 `text-m` 인데, 그건 문자열 매칭이 아니라 디자인 결정이다. 대신 그 결정을 팀이 한 번 만들고 앱마다
재사용하는 작은 JSON 파일로 바꾼다.

```sh
# 1. 현재 유령 클래스로 맵 초안 만들기
npx tw-ghost --fix-map-init fixes.json
```

```jsonc
// fixes.json (초안): 키는 bare 유틸리티 — 변형·"!"·"-" 는 도구가 처리한다
{
  "rounded":  ["rounded-0", "rounded-2", "rounded-4", "rounded-8"],   // 후보 여러 개: 하나 고르기
  "text-sm":  ["text-l", "text-m", "text-s"],
  "z-10":     "z-content-1",                                          // 제안이 정확히 하나
  "min-w-px": null                                                    // 후보 없음: null = 제거
}
```

모든 배열을 문자열 하나(또는 클래스를 지우려면 `null`)로 줄인 뒤:

```sh
# 2. 무엇이 바뀔지 보기 (아무것도 쓰지 않음)
npx tw-ghost --fix-map fixes.json

# 3. 적용
npx tw-ghost --fix-map fixes.json --write
```

수정기가 지키는 규칙:

- **토큰 단위로만.** `text-sm` 은 `md:text-sm`(이건 자기 bare 유틸리티로 따로 처리), `legacy-text-sm`,
  `text-sm/50` 안에서 건드리지 않고, `p-3` 은 `p-30`, `p-3.5`, `!p-3` 안에서 건드리지 않는다.
- **변형·`!`·`-` 는 그대로 옮긴다.** `{ "mt-3": "mt-4" }` 는 `lg:!-mt-3` 을 `lg:!-mt-4` 로 만든다. 커스텀
  `separator` 도 존중한다.
- **제거는 공백 하나를 같이 먹는다.** `class="a z-10 b"` → `class="a b"`; 혼자 있던 클래스는 `""` 가 된다 —
  dry run 에서 그런 곳을 확인할 것.
- **아무것도 추론하지 않는다.** 맵에 없는 유령은 유령으로 남는다: 실행은 여전히 exit 1 이고 *unmapped* 에
  나열된다. 아무것도 매칭하지 않는 맵 항목은 *unused* 에 나열된다.
- **매핑된 유령이 있는 파일만 연다**, 그리고 매칭이 있는 줄만 다시 쓴다. 줄 끝(LF / CRLF)은 유지된다.
- 수정기는 문법 트리가 아니라 **텍스트**를 고친다. 클래스 문자열·템플릿 리터럴·`clsx`/`cva` 호출에는 안전하지만,
  주석이나 클래스 목록이 아닌 문자열 안의 같은 토큰도 바꾼다. dry run 이 모든 편집을 `file:line:col` 로 보여
  주니 `--write` 전에 읽을 것.

`--json` 과 `--fix-map` 을 함께 쓰면 `{ "fix": { "write", "edits", "files", "unused", "unmapped" } }` 를 출력한다.

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| `0` | 유령 클래스 없음 (또는 `--fail-on none`), 또는 `--allow-empty` 를 준 빈 스캔. |
| `1` | 유령 클래스가 하나 이상 발견됨. |
| `2` | 사용법 또는 설정 오류: 잘못된 플래그·값(예: 정수가 아닌 `--max-locations`), 설정 파일 없음, 설정 로드 실패 또는 함수 export, `tailwindcss` 를 찾을 수 없음, 지원하지 않는 Tailwind 버전(4.x, ≤ 2.x, 3.0–3.2), **glob 에 일치하는 파일 없음 / 스캔할 것 없음** (`--allow-empty` 가 없을 때). 설정이 여러 개일 때: 아무것도 맞지 않는 `--config` glob 이나 `--all-configs`, 또는 **어느 하나라도** 실패한 설정(나머지는 계속 보고된다). 메시지를 포함한 전체 목록은 *실패하는 방식* 참고. |

| `1` | 유령 클래스가 하나 이상 발견됨; `--fix-map` 에서는 매핑되지 않은 유령이 하나 이상 남음. |
| `2` | 사용법 또는 설정 오류: 잘못된 플래그·값(예: 정수가 아닌 `--max-locations`), 설정 파일 없음, 설정 로드 실패 또는 함수 export, `tailwindcss` 를 찾을 수 없음, 지원하지 않는 Tailwind 버전(4.x, ≤ 2.x, 3.0–3.2), **glob 에 일치하는 파일 없음 / 스캔할 것 없음** (`--allow-empty` 가 없을 때). 메시지를 포함한 전체 목록은 *실패하는 방식* 참고. |

## 프로그래밍 API

```ts
import { analyze, formatHuman } from 'tw-ghost';

const report = await analyze({
  cwd: process.cwd(),          // 자동 탐지·glob·상대 경로의 기준 디렉터리
  config: 'tailwind.config.ts', // 선택
  globs: ['src/**/*.tsx'],      // 선택, 기본은 설정의 content glob
  ignore: [/^legacy-/],
  unknown: false,
  unknownAll: false,            // unknown 과 함께: 유틸리티 모양 부분집합 대신 원시 목록
  allowEmpty: false,            // true → TwGhostConfigError 대신 빈 리포트
  maxLocations: 3,
  suggestions: true,
  tailwind: undefined,          // 선택, --tailwind <dir> 과 동일
});

for (const warning of report.warnings) console.warn(warning);
console.log(formatHuman(report, { color: false }));
process.exitCode = report.ghosts.length > 0 ? 1 : 0;
```

`analyze()` 는 종료 코드 2 에 해당하는 상황에서 `TwGhostConfigError` 를 던진다.

설정 여러 개를 한 번에 — CLI 가 `--all-configs` / 반복된 `--config` 에서 하는 일:

```ts
import { analyzeMany, formatHumanMany, isConfigFailure, resolveConfigPaths } from 'tw-ghost';

const configs = await resolveConfigPaths({ cwd, all: true }); // 또는 { configs: ['apps/*/tailwind.config.ts'] }
const multi = await analyzeMany(configs, { cwd, ignore: [/^legacy-/] }); // analyze() 와 같은 옵션, `config` 만 제외
for (const entry of multi.configs) {
  if (isConfigFailure(entry)) console.error(entry.config, entry.error); // 이 설정은 실패, 나머지는 실행됨
}
console.log(formatHumanMany(multi, { color: false }));
process.exitCode = multi.summary.failed > 0 ? 2 : multi.summary.ghost > 0 ? 1 : 0;
```

`analyzeMany()` 는 설정 하나가 잘못됐다고 던지지 않고 `{ config, error }` 로 기록한 뒤 넘어간다.
반면 `resolveConfigPaths()` 는 glob 이 아무것도 맞지 않거나 탐색 결과가 없으면 `TwGhostConfigError`
를 던진다. `analyze()` 는 그대로다.
`describeEnvironment({ cwd, config, tailwind })` 는 `--env` 가 출력하는 내용을 반환한다. 하위 구성 요소도
export 된다: `loadProject`, `findConfig`, `assertSupportedTailwind`, `classify`, `splitVariants`, `looksUtilityLike`,
`scanContent`, `unescapeCssIdentifier`, `stockConfigFrom`, `collectClasses`, `changedThemeKeys`.
ESM(`import`) 과 CommonJS(`require`) 빌드 모두 각자의 타입 정의와 함께 제공된다 (`import` 는
`dist/index.d.ts`, `require` 는 `dist/index.d.cts`, `exports` 조건별로 선택).

기능별 함수도 export 된다. 각각은 위의 해당 절에서 설명한다:

- **포매터** — `formatHuman` / `formatHumanMany`, `formatGithub`(`--format github` 가 찍는 것),
  `formatSarif` / `formatSarifMany`(`--format sarif` 가 찍는 것, 둘 다 `{ log, summary, warnings }` 반환).
- **fix map** — `draftFixMap`, `parseFixMap`, `applyFixMap` 과 파일 단위 순수 함수 `applyFixMapToText`,
  `formatFix` — `--fix-map-init` / `--fix-map` 이 하는 일.
- **스캐폴딩** — `init`, `renderWorkflow`, `detectPackageInfo`, `formatInit` — `tw-ghost init` 이 하는 일.
- **실시간 판정** — `createLiveClassifier`, ESLint 룰의 엔진.
- `buildUtilityVocabulary`, `looksUtilityLike` 가 입력으로 받는 것.

**그것이 표면의 전부다.** 이 문서에 이름이 나오지 않는 런타임 값은 내부용이다: `tw-ghost` 에서 export 되지 않고
어느 릴리스에서든 바뀔 수 있다. export 되는 *타입*은 여기 하나씩 적지 않는다 — 각각은 위 값들의 시그니처에서
닿을 수 있다 — 하지만 그 집합도 동결된다: `test/public-api.test.ts` 가 TypeScript 가 보는 `src/index.ts` 의 값과
타입을 모두 고정하고, export 되는 값이 전부 이 문서에 이름이 나오는지 검사한다. 두 집합의 변경은 모두 CHANGELOG
한 줄이 된다.

## 동작 원리

1. **프로젝트의 Tailwind 를 로드한다.** `tailwindcss`, `tailwindcss/loadConfig` (`.ts` 는 jiti 가
   처리), `tailwindcss/resolveConfig`, `postcss` 를 `createRequire(configPath)` (또는 `--tailwind <dir>`)
   로 해석하므로 실제 빌드가 쓰는 버전이 그대로 판정한다. 3.3–3.4 범위 밖의 버전은 아무것도
   로드하기 전에 종료 코드 2 (*요구 사항 & 호환성* 참고).
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
- **사전 점검은 크게 실패하고, 성능 저하는 경고한다.** 비교 자체를 무의미하게 만드는 것(지원하지
  않는 Tailwind, 닿지 않는 설치본, 로드할 수 없는 설정)은 무엇을 발견했는지 명시한 메시지와 함께
  종료 코드 2 다. tw-ghost 가 *우회해서* 실행은 할 수 있지만 재현하지는 못하는 것(`content.transform`
  / `extract`, 번들 extractor 대체)은 stderr 한 줄 경고와 `report.warnings` 로 알리지, 조용한
  차이로 남기지 않는다.
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
  스캔하고 실행당 한 번 경고를 출력한다. transform 이 소스에 문자 그대로 없는 클래스명을 *만들어
  내면* 그것은 보이지 않고(미탐), 텍스트를 *제거하면* 실제 빌드가 보지 못하는 클래스를 보고할 수 있다.
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
- **unknown 목록 휴리스틱.** `--unknown` 은 그럴듯한 variant 체인과 프로젝트 `prefix` 를 떼어 낸
  뒤, 클래스 모양이고(소문자·숫자·`-` `.` `/` `%`, `${` 구멍 없는 균형 잡힌 `[...]`; `px-16)`
  이나 `text-black,` 같은 구두점 꼬리 없음), `data-`/`aria-`/URL 스킴으로 시작하지 않고, `-` 나
  separator 로 끝나지 않으며(`max-h-${x}` 같은 템플릿 리터럴 조각), **접두사**가 값을 받는 코어
  유틸리티(`text`, `min-h`, `rounded-tl`, … — 가장 긴 것 우선)이거나 생성된 CSS 가 존재를 증명한
  루트(커스텀 플러그인)이고, **값**이 그 유틸리티가 받을 법한 모양일 때만 후보를 남긴다: 숫자 /
  분수 / `[임의값]`, 범용 키워드(`auto`, `full`, `none`, `px`, `screen`, …), 그 유틸리티가 읽는
  테마 섹션의 키(project *와* stock — `text` 는 `fontSize` + `textColor`), 그 유틸리티의 키워드
  (`flex-col`, `justify-between`), 생성된 CSS 에서 관측된 값, 이들 중 하나와 편집 거리 1
  (`xll` → `xl`, `mm` → `m`), 또는 중첩 키의 머리(`red-500` 이 있을 때 `red`). `/modifier` 는
  숫자, 임의값, `opacity` / `lineHeight` 키여야 한다. 그 외는 일반 단어와 함께 걸러진다 — 값이
  실제 값과 전혀 가깝지 않은 죽은 토큰(`danger*` 색이 없을 때의 `text-danger`, `items-between`,
  올바르게 쓰인 적 없는 플러그인의 `pb-safe`), 접두사만 있는 것(`max-h`, `space-y`), 접두사 자체의
  오타(`tetx-sm`)도 포함해서. 모호한 경우는 오탐을 줄이는 쪽으로 정했고, `--unknown-all` 이 탈출구다.

### `--unknown` 에 남는 잡음

큰 실제 앱에서 측정했을 때 유틸리티 모양 필터를 여전히 통과하는 것들 (원시 unknown ≈93,000 →
20 개 나열, 그중 대략 2/3 가 진짜 오타·죽은 토큰):

- **클래스가 아닌 숫자 값.** `bg-0.png` 에셋 옆의 `bg-0`, 산문이나 테스트 데이터의 `content-1`,
  `to-1`, `z-1`: Tailwind 접두사 뒤의 숫자는 항상 받아들인다. 죽은 스케일 키(`mt-15`, `gap-125`)가
  정확히 그 모양이기 때문이다.
- **죽은 디자인 토큰 이름.** 토큰이 개명·삭제된 뒤의 `hover:bg-surface-secondary`,
  `fill-on-color-pressed`: 제대로 나열되지만 고칠 곳은 보통 클래스가 아니라 테마다.
- **엉뚱한 유틸리티에 붙은 범용 키워드.** `peer-focus:ring-full`, `content-auto`: `full` / `auto`
  는 모든 접두사에서 받아들인다.
- **인라인 CSS 와 산문**은 `unknownVariant` 에만 닿고(`display:flex`, *오탐* 참고) 유틸리티 모양
  목록에는 오지 않는다 — 다만 주석 속 문장에 붙은 클래스(`px-16),`)는 보고되는 대신 모양 검사에서
  떨어지므로, 그런 것은 원시 목록(`--unknown-all`)에서 찾아야 한다.

## 로드맵

- 파일 단위 `// tw-ghost-ignore` 주석.
- 경로 범위를 지정한 `--fix-map` (공유 맵으로 모노레포의 앱 하나만 고치기).
- CSS 파일 내 `@apply` 의 제대로 된 처리 (지금은 glob 에 포함되면 일반 텍스트로 스캔된다).
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
`no-content`, `content-transform`) 에 있고, 각각 저장소의 dev `tailwindcss` 3.4.x 를 해석하는
`tailwind.config.*` 를 가진다. 버전 사전 점검 테스트(`test/preflight.test.ts`)는 대신 가짜
`node_modules/tailwindcss/package.json` 을 가진 임시 프로젝트를 만들어 쓴다.

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
