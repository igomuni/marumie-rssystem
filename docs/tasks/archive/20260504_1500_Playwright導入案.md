# Playwright導入案

## 目的

`/sankey-svg` を中心に、ズーム・Pan・検索・フィルタ・年度切替などの画面操作回帰を人手確認だけに依存しないようにする。

もう一つの主目的は、デバッグ時にLLM agentがローカル画面の表示状態を取得しやすくすること。スクリーンショット、DOM状態、console error、ネットワーク失敗、操作後の表示位置などをPlaywright経由で確認できるようにし、LLM agentの「見えていない画面を推測で直す」状況を減らす。

今回の位置づけは「別PRでPlaywrightを導入するための最小構成案」。既存機能の大きな改修とは分け、まずは安定して回せるE2Eの足場を作る。

導入対象は開発用リポジトリ `/marumie-rssystem` に限定する。リリース/公開側の `rs-vis` へは原則として取り込まない。

## 結論

Playwrightは導入する価値が高い。特にこのリポジトリでは、以下のような「ビルドは通るが画面操作で壊れる」問題を捕まえやすくなる。

- `/sankey-svg` の初期表示が空白になっていないか
- ズーム・Pan・全体表示・次へ/前へ操作で図が画面外へ飛ばないか
- 検索、年度切替、TopN/offset、関連ノード表示の基本操作が破綻していないか
- 主要ページがデータ取得エラーやHydrationエラーなしに開けるか
- 将来的にスクリーンショット差分でレイアウト崩れを検知できるか

ただし、初回からビジュアルリグレッションを厳密にやりすぎると、サンキー図の描画・フォント・CI環境差分で不安定になりやすい。最初は「ページが開く」「主要UIが操作できる」「図が非空で表示される」「極端な画面外Panが起きない」を優先する。

また、Playwrightはローカルデバッグ・CI検証のための開発依存に留める。本番アプリのランタイム、公開API、デプロイ成果物にはPlaywright向けの制御口を持ち込まない。

`rs-vis` への同期対象からは、Playwright関連ファイルとテスト専用属性追加を除外する方針にする。

## 前提

- アプリは Next.js 15 / App Router。
- npmスクリプトは `dev`, `build`, `start`, `lint` がある。
- 既存のテストランナーはほぼ未導入。
- `package-lock.json` があるため、導入は npm 前提。
- `.gz` データは `npm run build` の `prebuild` で展開される。
- 最新Playwrightは Node.js 20/22/24 系が前提。現READMEの「Node.js 18以上」は見直し候補。

## リポジトリ分離方針

Playwrightは `/marumie-rssystem` 専用の開発補助として扱う。

- `rs-vis` へは `@playwright/test`、`playwright.config.ts`、`tests/e2e/`、Playwright用CI設定を取り込まない。
- `rs-vis` の `package.json` / lockfile にPlaywright依存を追加しない。
- `rs-vis` のDeploy pipelineにPlaywright installやE2E実行を追加しない。
- `rs-vis` 側の本番HTMLに、テスト目的だけの `data-testid` 追加を持ち込まない。
- `/marumie-rssystem` 側でも通常のproduction buildではE2E用 `data-testid` を出力しない。
- `sync-rs-vis` 時は、Playwright導入PRの差分を同期対象から除外する。

例外として、`data-testid` ではなく通常のアクセシビリティ改善、ユーザーに意味のあるARIAラベル、UIの安定化修正などは、機能改善として `rs-vis` に同期してよい。ただしPlaywrightを動かすためだけの変更は同期しない。

## セキュリティと本番影響の方針

Playwright導入は、本番環境に影響しない構成にする。

- `@playwright/test` は `devDependencies` のみに入れる。
- `playwright.config.ts` と `tests/e2e/` はテスト実行時だけ使う。
- Next.jsアプリ側にPlaywright専用API routeやデバッグ用公開エンドポイントを追加しない。
- 本番ビルド時にPlaywright browserをインストールしない。
- Deployジョブでは `npm run test:e2e` を実行しない。実行する場合もDeployとは別ジョブにする。
- CIでE2Eを走らせる場合、対象URLはCI内で起動したローカルサーバーまたは明示的に指定したPreview環境に限定する。
- 認証情報、Cookie、localStorage、スクリーンショット、trace、videoをGit管理しない。
- `playwright-report/`, `test-results/` は `.gitignore` に入れる。
- LLM agent用の画面観測は `localhost` の開発サーバーに対してのみ行う。

この方針なら、Deploy側の主な影響は `package-lock.json` とdev依存の増加だけに抑えられる。本番ランタイムにはPlaywrightもブラウザバイナリも不要。

### 避けるべき実装

- `NEXT_PUBLIC_ENABLE_DEBUG=true` のような公開環境でも有効になり得るデバッグフラグ
- 本番画面にテスト用の隠しボタンや操作APIを追加すること
- `/api/debug/*` のような内部状態を返すAPI
- Playwright traceやスクリーンショットを永続公開すること
- Deploy pipelineにPlaywright browser installを混ぜること

`data-testid` は画面上の権限や内部情報を増やさない属性なので許容する。ただし、機密データや内部IDをそのまま埋め込む用途には使わない。通常のproduction buildでは出力せず、ローカル開発時または `NEXT_PUBLIC_PLAYWRIGHT=1` を付けたPlaywright実行時だけ有効にする。

## 導入PRの範囲

### 入れるもの

- `@playwright/test`
- `playwright.config.ts`
- `tests/e2e/` 配下の最小E2E
- `package.json` のテスト用スクリプト
- 必要なら `.gitignore` へレポート・一時成果物を追加
- READMEの「開発・ビルド」または「テスト」欄に最小コマンドを追記

### 入れないもの

- 既存画面の大規模なアクセシビリティ属性追加
- Playwright専用の公開デバッグAPI
- 本番環境で有効になるデバッグUI
- 厳密なスクリーンショット差分テスト
- 全ページ網羅テスト
- CI必須化
- Playwright導入と同時のUI修正

## 推奨ファイル構成

```text
playwright.config.ts
tests/
  e2e/
    smoke.spec.ts
    sankey-svg.spec.ts
```

将来的に増えたら以下のように分ける。

```text
tests/
  e2e/
    smoke/
    sankey-svg/
    entities/
  fixtures/
  utils/
```

## package.json追加案

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

`@playwright/test` は `npm install -D @playwright/test@latest` で導入し、`package.json` と `package-lock.json` には解決された具体バージョンを固定する。`latest` や `^latest` のような曖昧な指定はコミットしない。

## playwright.config.ts案

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: process.env.CI
      ? 'npm run build && npm run start'
      : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

### この設定にする理由

- ローカルでは `npm run dev` を自動起動し、既存サーバーがあれば再利用する。
- CIでは `build + start` に寄せ、より本番に近い状態で確認する。
- 初期は Chromium だけにして、実行時間と不安定要因を抑える。
- CIの `workers: 1` で、重い可視化ページの並列実行による揺れを避ける。

## 初期テストケース案

### 1. smoke.spec.ts

主要ページが最低限開けることを確認する。

- `/`
- `/sankey-svg`
- `/entities`
- `/quality`
- `/subcontracts`

確認内容:

- HTTPエラー相当の表示が出ない
- `pageerror` が出ない
- 主要見出しまたはページ固有UIが見える

### 2. sankey-svg.spec.ts

前回の文脈に近い回帰検知を優先する。

#### 初期表示

- `/sankey-svg` を開く
- SVGが表示される
- ノードまたはリンク要素が存在する
- 表示領域が空白ではない

#### 次へ/前へ

- 支出先offsetの「次へ」をクリック
- 図の主要要素が画面内に残る
- 「全体表示」を押すと復帰できる
- 「前へ」で戻れる

#### ズーム

- ズームイン/アウトを操作
- SVG内のノード数が0にならない
- 画面外へ極端に飛ばない

#### 関連ノードのみ表示

- 事業ノードまたは支出先ノードをクリック
- 関連ノード表示を切り替える
- 図が非空のまま表示される

#### 年度切替

- 2024/2025を切り替える
- データロード後に図が表示される

## セレクタ方針

Playwrightを安定させるには、UI側に最小限の `data-testid` を足すのがよい。

候補:

- `sankey-svg-root`
- `sankey-svg-canvas`
- `sankey-node`
- `sankey-link`
- `recipient-offset-next`
- `recipient-offset-prev`
- `reset-viewport`
- `zoom-in`
- `zoom-out`
- `focus-related-toggle`
- `year-select`

ただし導入PRでは、テストに必要な最小限だけ追加する。既存DOM構造に依存した brittle なテストは避ける。

`data-testid` は通常のproduction buildでは出力しない。ただしPlaywright実行時にはHTMLへ出るため、以下を守る。

- 値は機能名・部品名に留める。
- project id、法人番号、内部集計キーなどのデータ値を含めない。
- 非公開状態や権限情報を推測できる名前にしない。
- テストのためだけにクリック可能な隠し要素を増やさない。

LLM agentが状態把握しやすいようにする場合も、まずは既存DOM、スクリーンショット、console log、network response、アクセシブルなラベルを使う。追加する識別子は `data-testid` までに留める。

## スクリーンショットテストの扱い

初回PRでは見送る。

理由:

- サンキー図はデータ量・フォント・ブラウザ環境で微妙に揺れやすい
- CIのLinuxフォント差分で失敗しやすい
- まずは「壊れていない」ことを安定して検知するほうが価値が高い

第2段階で、以下の限定条件なら導入可能。

- `/sankey-svg` の初期表示のみ
- Chromiumのみ
- しきい値を緩める
- スクリーンショット対象をページ全体ではなくSVG領域に限定する

## CI導入案

初回PRではローカル実行可能にするだけでもよい。CIまで入れるなら `.github/workflows/playwright.yml` を追加する。

```yaml
name: Playwright

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v5
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

ただし、CI必須化は次PR以降が安全。最初はローカルでテストが安定することを確認してからでよい。

Deployとは分離する。GitHub Actionsで走らせる場合も、VercelなどのDeployジョブとは別のE2Eジョブにし、失敗時にデプロイ成果物へ影響しない運用から始める。

## 導入手順

1. `npm install -D @playwright/test@latest`
2. `npx playwright install chromium`
3. `playwright.config.ts` を追加
4. `tests/e2e/smoke.spec.ts` を追加
5. `tests/e2e/sankey-svg.spec.ts` を追加
6. 必要最小限の `data-testid` を `/sankey-svg` に追加
7. `npm run test:e2e` でローカル確認
8. READMEに実行方法を追記
9. 必要なら次PRでGitHub Actions化

## リスクと対策

| リスク | 対策 |
| --- | --- |
| Node.js 18環境で最新Playwrightが動かない | README/CIをNode.js 22へ寄せる |
| `/sankey-svg` が重くタイムアウトする | 初期テストはChromiumのみ、タイムアウトを長めにする |
| DOM構造変更でテストが壊れる | `data-testid` を安定契約として使う |
| スクリーンショット差分が不安定 | 初回は非空・位置・操作確認に留める |
| `npm run dev` と `npm run build && npm run start` で挙動差が出る | ローカルはdev、CIはbuild/startで役割を分ける |
| 大容量データ展開がCIで失敗する | `prebuild` と `.gz` 管理を前提にし、CIログで失敗箇所を見える化する |
| 本番にデバッグ口が残る | Playwright専用APIや本番デバッグUIを追加しない |
| trace/video/screenshotに情報が残る | Git管理せず、CI artifactの保持期間を短くする |
| DeployがE2E失敗で止まる | 初期はDeployジョブと分離し、必須チェック化を後回しにする |

## PR分割案

### PR 1: Playwright最小導入

- Playwright依存追加
- config追加
- smoke + `/sankey-svg` 基本E2E
- README追記
- CIは任意、入れても必須化しない

### PR 2: `/sankey-svg` 回帰テスト拡充

- offset、zoom、関連ノード、年度切替のケース追加
- 必要な `data-testid` の整理
- 直近で問題になったPan系の再現テスト追加

### PR 3: CI安定化・スクリーンショット検討

- GitHub Actions必須化
- HTML report artifact
- 限定的なスクリーンショット比較

## 採用判断

採用でよい。

最初のゴールは「UIの正しさを完全保証する」ではなく、「壊れたときにすぐ分かる足場を作る」こと。特に `/sankey-svg` は状態・描画・操作が複雑なので、Playwrightの投資対効果が高い。

次に実装するなら、PR 1として `@playwright/test`、`playwright.config.ts`、`smoke.spec.ts`、`sankey-svg.spec.ts` の最小構成から始めるのがよい。

## 参考

- Playwright Installation: https://playwright.dev/docs/intro
- Playwright Web Server: https://playwright.dev/docs/test-webserver
- Playwright Continuous Integration: https://playwright.dev/docs/ci
