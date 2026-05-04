---
name: playwright-debug
description: Use when the user asks to debug or verify UI behavior with Playwright in this repository, create an operation scenario, inspect screen state, reproduce a visual/URL/state bug, or help an LLM agent observe the app through browser automation.
compatibility: Requires npm, npx, Playwright browsers, and the local Next.js app data files. Intended for marumie-rssystem development/debug use, not release repository sync.
allowed-tools: Bash(npm:*) Bash(npx:*) Bash(git:*) Read Edit Grep Glob
---

# Playwright UI Debug

Playwrightを使って、実際のユーザー操作に近い形で画面状態・URL状態・DOM・console errorを観測し、UIの状態ずれを見つける。

## 基本方針

- ユーザーが提示した操作列を、可能な限りそのままE2Eシナリオにする。
- 画面の見た目だけでなく、URL query、選択ID、検索欄、フィルタ、年度、表示ノード数を観測点にする。
- 失敗したら `test-results/**/error-context.md`、screenshot、videoを読む。
- Playwright専用API route、隠し操作UI、production向けデバッグ口は追加しない。
- `data-testid` を追加する場合は、機能名・部品名だけにし、内部IDや機密データを入れない。
- E2E用 `data-testid` は通常production buildで出さず、ローカル開発時または `NEXT_PUBLIC_PLAYWRIGHT=1` 実行時だけ有効にする。
- Playwright関連ファイルはリリース/公開側リポジトリへの同期対象にしない。
- 例示されたシナリオ値、URL、セレクタ、日時はそのまま固定せず、現在のDOM・データ・ローカル時刻で確認してから使う。

## 事前確認

1. 既存のPlaywright設定とテストを確認する。

```bash
rg -n "test:e2e|playwright|NEXT_PUBLIC_PLAYWRIGHT|data-testid" package.json playwright.config.ts tests app
```

2. 既存のUI識別子を優先する。

- `data-testid`
- `aria-label`
- role / accessible name
- URL query
- visible text

3. 対象データが年度を跨いで存在するか確認する。IDは年度で意味が変わることがあるため、必要なら名前・Project IDでも照合する。

## シナリオ作成の型

1. `tests/e2e/<page>.spec.ts` に、ユーザー操作の順番どおりテストを追加する。
2. 操作ごとに最低1つ観測点を置く。
3. 最終状態で以下を確認する。

- 期待URLになっているか
- 検索欄・フィルタ・年度などのUI状態が保持されているか
- `sankey-node` など主要描画要素が0件になっていないか
- 表示中ノードが画面内に残っているか
- `pageerror` が出ていないか

例:

```ts
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));

await page.getByTestId('search-input').fill('検索語');
await page.getByTestId('search-result').first().click();
await expect(page).toHaveURL(/sel=/);
expect(pageErrors).toEqual([]);
```

## 失敗時の見方

1. まずエラー本文と受信URLを見る。
2. `test-results/**/error-context.md` の Page snapshot を読む。
3. screenshot/videoで「ユーザー視点の状態」を確認する。
4. 次のパターンを疑う。

- 年度切替で同じIDが別エンティティを指す。
- URL stateは残っているが、データロード後の意味が変わっている。
- 検索・フィルタ・選択・offsetが互いに上書きしている。
- レイアウト更新後に選択ノードが画面外、または別ノードとして復元されている。

## 修正方針

- まず観測テストを失敗させ、失敗内容から原因を特定する。
- IDがデータ更新や年度で安定しない場合は、Project IDや名前で新データ側へ再解決する。
- URL更新は既存の `pendingHistoryAction` など、ローカルのURL状態管理に合わせる。
- 修正後は対象シナリオ、全E2E、型、lintを確認する。

```bash
npm run test:e2e -- tests/e2e/<file>.spec.ts --project=chromium
npm run test:e2e
npx tsc --noEmit
npm run lint
```

## 報告形式

報告では、単に「テスト追加」ではなく、観測できたことを明記する。

```markdown
### Playwrightで確認できたこと
- 操作シナリオ:
- 見つかった状態ずれ:
- 修正:
- 検証:
```
