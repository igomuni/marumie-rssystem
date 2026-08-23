import { expect, test } from '@playwright/test';

/** 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 */
const COLUMNS = ['total', 'ministry', 'organization', 'subAccount', 'section', 'item'];

test.describe('mof-hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mof-hierarchy');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
  });

  test('renders the six-column hierarchy without collapsing empty columns', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await expect(page.getByTestId('hierarchy-canvas')).toBeVisible();

    // 値を持たない列は素通りさせるだけで畳まない。6列すべてにノードが立つ
    const columns = await page
      .getByTestId('hierarchy-node')
      .evaluateAll(els => [...new Set(els.map(el => el.getAttribute('data-column')))]);
    expect(columns.sort()).toEqual([...COLUMNS].sort());

    expect(pageErrors).toEqual([]);
  });

  test('selecting a node is kept in the URL and can be undone with the back button', async ({ page }) => {
    await expect(page).not.toHaveURL(/sel=/);

    await page.getByTestId('hierarchy-node').first().click();
    await expect(page).toHaveURL(/sel=/);

    // 選択は「辿った操作」なので履歴に積む。1回の戻るで1つ前に戻れること
    await page.goBack();
    await expect(page).not.toHaveURL(/sel=/);
  });

  test('switching the budget type reloads the graph', async ({ page }) => {
    const select = page.getByLabel('予算種別');
    const options = await select.locator('option').allTextContents();
    test.skip(options.length < 2, '当該年度に予算種別が1つしかない');

    const current = await select.inputValue();
    const next = options.find(o => o !== current);
    expect(next).toBeTruthy();

    // 「ノードが0でない」だけだと、取得が走らなくても通ってしまう。
    // 選択・URL・図の中身の3つが揃って変わったことを見る
    const before = await page
      .getByTestId('hierarchy-node')
      .evaluateAll(els => els.map(el => el.textContent).join('|'));

    await select.selectOption(next!);

    await expect(select).toHaveValue(next!);
    await expect(page).toHaveURL(new RegExp(`bt=${encodeURIComponent(next!)}`));
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          page
            .getByTestId('hierarchy-node')
            .evaluateAll(els => els.map(el => el.textContent).join('|')),
        { timeout: 30_000 }
      )
      .not.toBe(before);
  });

  test('label font size can be enlarged without labels overlapping', async ({ page }) => {
    const label = page.getByTestId('hierarchy-label').first();
    const before = await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize));

    await page.getByLabel('表示設定').click();
    await page.getByLabel('文字サイズ').selectOption('16');

    await expect
      .poll(() => label.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))
      .toBeGreaterThan(before);

    // 大きくしてもラベル同士が重ならない。重なりは描画側が検出して印を出す
    await expect(page.getByTestId('hierarchy-label-overlap')).toHaveCount(0);
  });

  test('labels do not overlap at the default font size', async ({ page }) => {
    await expect(page.getByTestId('hierarchy-label-overlap')).toHaveCount(0);
  });

  test('label density can be switched between major nodes and all nodes', async ({ page }) => {
    const labels = page.getByTestId('hierarchy-label');
    await page.getByLabel('表示設定').click();
    const density = page.getByLabel('ラベル表示');

    await density.selectOption('major');
    const few = await labels.count();
    expect(few).toBeGreaterThan(0);

    await density.selectOption('all');
    await expect.poll(() => labels.count()).toBeGreaterThan(few);

    // 間引いても、名前が出ていないノード自体は消えない
    const nodes = await page.getByTestId('hierarchy-node').count();
    await density.selectOption('major');
    await expect(page.getByTestId('hierarchy-node')).toHaveCount(nodes);

    // major は1行分の場所を確保せず値どおりに詰めるので、
    // 出したラベルが重なっていないことを別に確かめる
    await expect(page.getByTestId('hierarchy-label-overlap')).toHaveCount(0);
  });

  test('the search box stays operable and is not covered by the controls', async ({ page }) => {
    // 浮かせた部品どうしが重なると、見えているのに押せないという形で壊れる。
    // 「見える」だけでは足りないので、実際に打って絞り込めるところまで見る
    const input = page.getByPlaceholder(/検索/);
    await input.click();
    await page.keyboard.type('厚生');

    await expect(input).toHaveValue('厚生');
    const results = page.getByRole('button').filter({ hasText: '厚生' });
    await expect(results.first()).toBeVisible({ timeout: 10_000 });

    await results.first().click();
    await expect(page).toHaveURL(/sel=/);
  });

  test('floating controls do not overlap each other', async ({ page }) => {
    // 検索ボックスだけを守っても、次に足した部品が別の何かを覆う。
    // 図の上に浮かせている部品どうしが重なっていないことを面で確かめる
    await expect(page.getByLabel('表示設定')).toBeVisible();

    const boxes = await page.evaluate(() => {
      const targets = [
        ['検索', 'input[type="search"]'],
        ['表示数パネル', 'select[aria-label="表示位置の対象"]'],
        ['予算種別', 'select[aria-label="予算種別"]'],
        ['表示設定', '[aria-label="表示設定"]'],
        ['年度', 'select[aria-label="年度"]'],
      ] as const;
      return targets.flatMap(([name, sel]) => {
        const el = document.querySelector(sel);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ name, left: r.left, right: r.right, top: r.top, bottom: r.bottom }];
      });
    });
    expect(boxes.length).toBe(5);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `${a.name} と ${b.name} が重なっている`).toBe(false);
      }
    }
  });

  test('changing TopN refetches and shrinks the column', async ({ page }) => {
    // 予算種別と同じ経路（buildUrl の変化）で取り直す。
    // 年度が確定したあとの取り直しが効かないと、ここも黙って無反応になる。
    //
    // TopN は列全体の表示件数の上限なので、減らせばその列のノードが減る。
    const itemNodes = () =>
      page
        .getByTestId('hierarchy-node')
        .evaluateAll(els => els.filter(el => el.getAttribute('data-column') === 'item').length);

    const before = await itemNodes();
    expect(before).toBeGreaterThan(10);

    // スライダーの数値をクリックして直接入力する
    await page.getByLabel('事項の表示数を直接入力').click();
    await page.getByLabel('事項の表示数(数値)').fill('8');
    await page.getByLabel('事項の表示数(数値)').press('Enter');

    // 表示は画面で選んだ値を即座に映す（応答を待って古い値に戻らない）
    await expect(page.getByLabel('事項の表示数', { exact: true })).toHaveValue('8');
    await expect(page).toHaveURL(/tit=8/);
    // 上位8件＋集約1件
    await expect.poll(itemNodes, { timeout: 30_000 }).toBe(9);
  });

  test('TopN controls stay usable while the graph reloads', async ({ page }) => {
    // 読み込み中に触れないと、続けて2つの列を絞れない
    await page.getByLabel('事項の表示数を減らす', { exact: true }).click();
    // 応答を待たずに別の列を動かす
    await page.getByLabel('項の表示数を減らす', { exact: true }).click();

    await expect(page.getByLabel('事項の表示数', { exact: true })).toHaveValue('39');
    await expect(page.getByLabel('項の表示数', { exact: true })).toHaveValue('39');
    await expect(page).toHaveURL(/tse=39/);
    await expect(page).toHaveURL(/tit=39/);
  });

  test('aggregate nodes are named by count and unit, not その他', async ({ page }) => {
    // /sankey-svg の「5,744事業」と同じ作法。「その他」だと何件が図の外に
    // あるのか読めない
    const names = await page
      .getByTestId('hierarchy-node')
      .evaluateAll(els => els.map(el => el.querySelector('text')?.textContent ?? ''));

    const aggregates = names.filter(n => /^[\d,]+(所管|組織|勘定|項|事項) \(/.test(n));
    expect(aggregates.length).toBeGreaterThan(0);
    expect(names.filter(n => n.startsWith('その他'))).toHaveLength(0);
  });

  test('the open settings panel fits on screen and clears the search box', async ({ page }) => {
    // TopN を全列ぶん並べたことで縦に伸びた。畳んだ状態だけ見ても足りない
    await page.getByLabel('表示設定').click();

    const fits = await page.evaluate(() => {
      const panel = document
        .querySelector('[aria-label="文字サイズ"]')!
        .closest('div.absolute')!
        .getBoundingClientRect();
      const search = document.querySelector('input[type="search"]')!.getBoundingClientRect();
      return {
        inside:
          panel.top >= 0 &&
          panel.left >= 0 &&
          panel.bottom <= window.innerHeight &&
          panel.right <= window.innerWidth,
        overlapsSearch:
          search.left < panel.right &&
          panel.left < search.right &&
          search.top < panel.bottom &&
          panel.top < search.bottom,
      };
    });

    expect(fits.inside).toBe(true);
    expect(fits.overlapsSearch).toBe(false);
  });

  test('the offset window pages through ranks below TopN', async ({ page }) => {
    // TopN だけだと上位しか見られず、41位以降は集約に消えたまま辿れない
    const itemNames = () =>
      page
        .getByTestId('hierarchy-node')
        .evaluateAll(els =>
          els
            .filter(el => el.getAttribute('data-column') === 'item')
            .map(el => (el.querySelector('text')?.textContent ?? '').split(' (')[0])
        );

    await page.goto('/mof-hierarchy?tit=5');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('表示位置の対象').selectOption('item');
    const first = await itemNames();

    await page.getByLabel('事項の表示位置を次へ', { exact: true }).click();

    // 表示は待たずに切り替わる（1ページ＝TopN件ぶん送る）
    await expect(page.getByLabel('事項の開始位置を直接入力')).toHaveText('6');
    await expect(page).toHaveURL(/oit=5/);
    await expect.poll(itemNames, { timeout: 30_000 }).not.toEqual(first);
  });

  test('the offset control is inert for a column that fits entirely', async ({ page }) => {
    // ずらす先が無い列では動かせないことを示す。押せてしまうと
    // 「押したのに何も起きない」になる
    await page.goto('/mof-hierarchy?tmi=200');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('表示位置の対象').selectOption('ministry');
    await expect(page.getByLabel('所管の開始位置', { exact: true })).toBeDisabled();

    // 収まりきらない列に切り替えれば動かせる
    await page.getByLabel('表示位置の対象').selectOption('item');
    await expect(page.getByLabel('事項の開始位置', { exact: true })).toBeEnabled();
  });

  test('the TopN panel can be collapsed without losing the offset row', async ({ page }) => {
    // 図を広く見たいときに畳める。畳んでも表示位置は動かせる
    // （/sankey-svg の TopN パネルと同じ作法）
    await expect(page.getByLabel('事項の表示数', { exact: true })).toBeVisible();

    await page.getByLabel('表示数 を隠す').click();

    await expect(page.getByLabel('事項の表示数', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('表示位置の対象')).toBeVisible();

    await page.getByLabel('表示数 を表示').click();
    await expect(page.getByLabel('事項の表示数', { exact: true })).toBeVisible();
  });

  test('TopN above 40 is not silently capped', async ({ page }) => {
    // API 側が 40 で切っていた。スライダーは 300 まで動くのに
    // 40 を超えた分が黙って落ちていた
    const itemNodes = () =>
      page
        .getByTestId('hierarchy-node')
        .evaluateAll(els => els.filter(el => el.getAttribute('data-column') === 'item').length);

    await page.goto('/mof-hierarchy?tit=40');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    const at40 = await itemNodes();

    await page.goto('/mof-hierarchy?tit=100');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(itemNodes, { timeout: 30_000 }).toBeGreaterThan(at40);
  });

  test('the canvas grows taller than the viewport and pans freely', async ({ page }) => {
    // 表示数を増やすと図は縦に伸びる。可動域を図の内側に閉じると
    // 見たい場所へ寄せられなくなるので、パンは制限しない（/sankey-svg と同じ）
    await page.goto('/mof-hierarchy?tit=100');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });

    const canvas = page.getByTestId('hierarchy-canvas');
    const height = await canvas.evaluate(el => Number(el.getAttribute('height')));
    expect(height).toBeGreaterThan(await page.evaluate(() => window.innerHeight));

    const top = () => canvas.evaluate(el => Math.round(el.getBoundingClientRect().top));
    expect(await top()).toBe(0);

    // 下方向へ。可動域を閉じているとここが 0 のまま動かない
    await page.mouse.move(700, 400);
    await page.mouse.down();
    await page.mouse.move(700, 600, { steps: 10 });
    await page.mouse.up();
    await expect.poll(top).toBeGreaterThan(100);

    // 行き過ぎても戻せる
    await page.getByTitle('全体を表示').click();
    await expect.poll(top).toBe(0);
  });

  test('holding 次へ keeps paging past the first page', async ({ page }) => {
    // useRepeatPress は pointerdown 時点の関数を setInterval で呼び直す。
    // その関数が当時の開始位置を握っていると、押し続けても同じ位置を
    // 何度も指定するだけで先へ進まない
    await page.goto('/mof-hierarchy?tit=10');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('表示位置の対象').selectOption('item');

    const start = page.getByLabel('事項の開始位置を直接入力');
    await expect(start).toHaveText('1');

    const next = page.getByLabel('事項の表示位置を次へ', { exact: true });
    const box = (await next.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 400ms で連続実行に入り、150ms 間隔で送られる
    await page.waitForTimeout(1200);
    await page.mouse.up();

    // 1ページ（10件）ぶんしか進まないなら 11 のまま
    await expect
      .poll(async () => Number((await start.textContent()) ?? '0'), { timeout: 10_000 })
      .toBeGreaterThan(11);
  });

  test('the aggregate breakdown renders without duplicate React keys', async ({ page }) => {
    // 事項名は項をまたいで重複する。実データでも集約の上位8件に
    // 同名が2件入る（国債整理基金特別会計へ繰入れに必要な経費）
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/mof-hierarchy?tse=8&tit=8');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });

    // 事項列の集約ノードを選ぶと、詳細パネルに内訳が並ぶ
    const aggregate = page
      .getByTestId('hierarchy-node')
      .filter({ hasText: /^[\d,]+事項 \(/ })
      .first();
    await aggregate.click();

    await expect(page.getByText('内訳（金額の大きい順）')).toBeVisible();
    expect(consoleErrors.filter(t => /same key|duplicate key/i.test(t))).toEqual([]);
  });

  test('hovering a node highlights its whole ancestor chain, not just direct links', async ({ page }) => {
    // /sankey-svg はホバーで上流〜下流の連なり全体を明るくする。
    // 直接つながる隣のノードだけを明るくすると、2列以上離れた祖先が
    // 薄暗いままになり「この事項はどの所管か」が見た目から追えない
    const opacities = async () =>
      page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[data-testid="hierarchy-node"]')];
        const item = nodes.find(n => n.getAttribute('data-column') === 'item')!;
        const rect = item.getBoundingClientRect();
        const ministries = nodes.filter(n => n.getAttribute('data-column') === 'ministry');
        return {
          itemCenter: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          ministryOpacities: ministries.map(
            n => Number(getComputedStyle(n.querySelector('rect')!).opacity)
          ),
        };
      });

    const { itemCenter } = await opacities();
    await page.mouse.move(itemCenter.x, itemCenter.y);
    await page.waitForTimeout(150);

    const { ministryOpacities } = await opacities();
    // 直接つながる祖先（1件）は明るいまま、他の所管は薄暗くなる
    expect(ministryOpacities.filter(o => o === 1).length).toBe(1);
    expect(ministryOpacities.some(o => o < 1)).toBe(true);
  });

  test('hovering still highlights within a focus-filtered view', async ({ page }) => {
    // 絞り込み中（選択時に関連のみ表示=ON）でも、その中でさらにホバーの筋を
    // 強調するはずだった。related（選択の関連集合）で offHover を無効化して
    // いたため、選択中は常に dim=false になりホバーが一切効かなくなっていた
    const ministry = page.locator('[data-testid="hierarchy-node"][data-column="ministry"]').first();
    await ministry.click();
    await page.getByLabel('表示設定').click();
    await page.getByLabel('選択時に関連のみ表示').check();
    await page.waitForTimeout(200);

    const orgOpacities = () =>
      page.evaluate(() => {
        const orgs = [...document.querySelectorAll('[data-testid="hierarchy-node"][data-column="organization"]')];
        return orgs.map(n => Number(getComputedStyle(n.querySelector('rect')!).opacity));
      });
    const before = await orgOpacities();
    test.skip(before.length < 2, 'この所管の組織が1件しかない');

    const target = page.locator('[data-testid="hierarchy-node"][data-column="organization"]').first();
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    const after = await orgOpacities();
    // ホバーした1件は明るいまま、絞り込み内の他の組織は薄暗くなる
    expect(after[0]).toBe(1);
    expect(after.some(o => o < 1)).toBe(true);
  });

  test('the minimap shows the current viewport and can jump to a clicked spot', async ({ page }) => {
    // パンを制限していないので、表示数を増やすと迷子になりやすい。
    // /sankey-svg と同じミニマップで、全体の中の現在位置を把握しつつ飛べるようにする
    await page.goto('/mof-hierarchy?tit=100');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('canvas')).toHaveCount(0);
    await page.getByTitle('ミニマップを表示').click();
    const minimap = page.locator('canvas');
    await expect(minimap).toBeVisible();

    const top = () =>
      page.getByTestId('hierarchy-canvas').evaluate(el => Math.round(el.getBoundingClientRect().top));
    const before = await top();

    const box = (await minimap.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.9);

    await expect.poll(top).not.toBe(before);

    await page.getByTitle('ミニマップを隠す').click();
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('search results can be chosen with the keyboard', async ({ page }) => {
    // マウスでしか候補を選べないと、キーボードだけでは検索が完結しない
    await page.getByPlaceholder(/検索/).fill('財務');
    const results = page.getByTestId('hierarchy-search-result');
    await expect(results.first()).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/sel=/);
  });

  test('hovering a link (ribbon) shows a tooltip with the flow amount', async ({ page }) => {
    // ノードだけでなく帯にもホバーできないと、太さの差から金額を確かめる
    // 手段が無い（/sankey-svg は帯にホバーすると source → target と金額を出す）
    const link = page.getByTestId('hierarchy-link').first();
    await expect(link).toBeAttached();
    const box = (await link.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByTestId('hierarchy-link-tooltip')).toBeVisible({ timeout: 5_000 });
  });

  test('zoom percentage can be typed directly', async ({ page }) => {
    // /sankey-svg はズーム率をクリックして数値入力できる。
    // ここではボタンの連打でしか目的の倍率に合わせられなかった
    await page.getByTitle('クリックしてズーム率を入力').click();
    await page.getByLabel('ズーム率(数値)').fill('250');
    await page.getByLabel('ズーム率(数値)').press('Enter');

    await expect(page.getByTitle('クリックしてズーム率を入力')).toHaveText('250%');
  });

  test('selecting a node docks a resizable, collapsible side panel like /sankey-svg', async ({ page }) => {
    // 左下に浮かせた小さなカードではなく、/sankey-svg と同じ左ドックの
    // サイドパネルにする。折りたたみタブと幅リサイズを持つ
    await page.getByTestId('hierarchy-node').first().click();

    const panel = page.getByTestId('hierarchy-side-panel');
    await expect(panel).toBeVisible();
    const openBox = (await panel.boundingBox())!;
    // ドック: 左端に張り付き、高さは画面いっぱい
    expect(openBox.x).toBeCloseTo(0, 0);
    expect(openBox.height).toBeGreaterThan(600);

    // 折りたたみ: タブで隠せて、選択自体は保たれる
    await page.getByTitle('パネルを折りたたむ').click();
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(/sel=/);

    await page.getByTitle('パネルを展開').click();
    await expect(panel).toBeVisible();
  });

  test('the side panel pushes the search box aside instead of overlapping it', async ({ page }) => {
    // /sankey-svg は選択中は検索ボックスをパネル幅ぶん右へ退避させる
    const search = page.getByPlaceholder(/検索/);
    const before = (await search.boundingBox())!;

    await page.getByTestId('hierarchy-node').first().click();
    await expect(page.getByTestId('hierarchy-side-panel')).toBeVisible();

    const after = (await search.boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x);
  });

  test('the panel header shows a type badge colored like the node, and 集約 for aggregate nodes', async ({ page }) => {
    // /sankey-svg のバッジ表示に合わせる。表示数を絞って集約ノードを
    // 画面の低い位置（ズーム操作クラスタの裏）に追いやらないようにする
    await page.goto('/mof-hierarchy?tit=5');
    await expect(page.getByTestId('hierarchy-node').first()).toBeVisible({ timeout: 30_000 });
    const aggregate = page
      .getByTestId('hierarchy-node')
      .filter({ hasText: /^[\d,]+事項 \(/ })
      .first();
    await aggregate.click();

    const panel = page.getByTestId('hierarchy-side-panel');
    await expect(panel.getByText('集約')).toBeVisible();
  });

  test('clicking floating controls does not clear the selection', async ({ page }) => {
    // 浮かせた部品（ズームボタン等）は data-pan-disabled 付きなのに、
    // 背景クリックでの選択解除がそれを見ずに発火し、押すたびに選択が消えていた
    await page.getByTestId('hierarchy-node').first().click();
    await expect(page).toHaveURL(/sel=/);

    await page.getByTitle('拡大').click();
    await expect(page).toHaveURL(/sel=/);
  });

  test('選択時に関連のみ表示 defaults to off, matching /sankey-svg', async ({ page }) => {
    // ONが既定だと選択のたびに図が絞り込まれ、隣接の事項を見比べる
    // 探索の邪魔になる。/sankey-svg も既定OFF。
    // 根ノードを選ぶと全ノードが関連になり違いが見えないので、末端の事項で確かめる
    const item = page.locator('[data-testid="hierarchy-node"][data-column="item"]').first();
    await item.click();
    await expect(page).not.toHaveURL(/fr=1/);

    const before = await page.getByTestId('hierarchy-node').count();
    await page.getByLabel('表示設定').click();
    await page.getByLabel('選択時に関連のみ表示').check();
    await expect(page).toHaveURL(/fr=1/);
    await expect.poll(() => page.getByTestId('hierarchy-node').count()).toBeLessThan(before);
  });

  test('the side panel drills down through descendant columns via tabs, like /sankey-svg', async ({ page }) => {
    // /sankey-svg のサイドパネルはタブ（省庁/事業/支出先）で下の階層を辿れる。
    // 静的な内訳だけでは選び直すたびに図をクリックし直す必要があった
    const ministry = page.locator('[data-testid="hierarchy-node"][data-column="ministry"]').first();
    await ministry.click();
    const ministrySel = new URL(page.url()).searchParams.get('sel');

    const panel = page.getByTestId('hierarchy-side-panel');
    const orgTab = panel.getByRole('tab', { name: /組織/ });
    await expect(orgTab).toBeVisible();

    // 別のタブに切り替えると中身が変わる
    const itemTab = panel.getByRole('tab', { name: /事項/ });
    await itemTab.click();
    await expect(panel.getByRole('tabpanel')).toBeVisible();

    // タブの中の項目を押すと、その子ノードへ選択が移る。
    // panel ヘッダーは名前のみ（金額を含まない）を表示するので、
    // svg ラベル（金額付き）とは比較せず、選択の実体である URL の sel で確かめる
    const firstEntry = panel.getByRole('tabpanel').getByRole('button').first();
    const entryName = await firstEntry.textContent();
    await firstEntry.click();

    await expect.poll(() => new URL(page.url()).searchParams.get('sel')).not.toBe(ministrySel);
    expect(entryName?.length).toBeGreaterThan(0);
  });

  test('the side panel fully expands descendants instead of showing an aggregate row', async ({ page }) => {
    // /sankey-svg のサイドパネルは常にフルデータを見るので、図で集約されている
    // 分もタブでは個々の実ノードとして展開される。集約ノード（41組織 のような
    // 「N件+単位」の行）は一切出ない
    const total = page.locator('[data-testid="hierarchy-node"][data-column="total"]').first();
    await total.click();
    const panel = page.getByTestId('hierarchy-side-panel');
    await panel.getByRole('tab', { name: /^組織/ }).click();

    const orgTab = panel.getByRole('tab', { name: /^組織/ });
    // 図では TopN で41件（うち集約1件）に絞られるが、パネルは全件を展開する
    await expect(orgTab).toHaveText(/組織\/特会\(114\)/);

    const rows = await panel.getByRole('tabpanel').getByRole('button').allTextContents();
    expect(rows).toHaveLength(114);
    expect(rows.some(r => /^[\d,]+組織/.test(r))).toBe(false);
  });

  test('selecting a fully-expanded node outside the diagram TopN still works', async ({ page }) => {
    // 図のTopNから外れた実ノードをタブから選んでも、パネルは詳細を表示できる。
    // 図には出ていない旨も伝える（座標が無いのでハイライト・自動スクロールはできない）
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    const total = page.locator('[data-testid="hierarchy-node"][data-column="total"]').first();
    await total.click();
    const panel = page.getByTestId('hierarchy-side-panel');
    await panel.getByRole('tab', { name: /^組織/ }).click();

    // 図のTopN（40）より後ろの行を選ぶ
    const target = panel.getByRole('tabpanel').getByRole('button').nth(41);
    const name = (await target.textContent())?.split(/\d/)[0];
    await target.click();

    await expect(page).toHaveURL(/sel=/);
    await expect(panel).toContainText('表示数の上限から溢れているため図には出ていません');
    if (name) await expect(panel).toContainText(name);
    expect(errors).toEqual([]);
  });

  test('the side panel and its toggle tab are absent until a node is selected', async ({ page }) => {
    // /sankey-svg は選択が無いとき SidePanelChrome ごとマウントしない。
    // トグルタブだけが理由なく残っていると、押しても何も起きない部品になる
    await expect(page.getByTestId('hierarchy-side-panel')).toHaveCount(0);
    await expect(page.getByTitle('パネルを展開')).toHaveCount(0);
    await expect(page.getByTitle('パネルを折りたたむ')).toHaveCount(0);

    await page.getByTestId('hierarchy-node').first().click();
    await expect(page.getByTestId('hierarchy-side-panel')).toBeVisible();
  });

  test('scrolling the side panel list does not pan or zoom the diagram', async ({ page }) => {
    // パネルの一覧の上でホイールすると、その下の図までズーム・パンしていた。
    // 一覧のスクロールは一覧だけで完結させる
    const total = page.locator('[data-testid="hierarchy-node"][data-column="total"]').first();
    await total.click();
    const panel = page.getByTestId('hierarchy-side-panel');
    await panel.getByRole('tab', { name: /^事項/ }).click();

    const canvasTop = () =>
      page.getByTestId('hierarchy-canvas').evaluate(el => (el as SVGSVGElement).style.top);
    const before = await canvasTop();

    const box = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);

    await expect(await canvasTop()).toBe(before);

    // 一覧自体はスクロールできる
    const scrollTop = await panel
      .getByRole('tabpanel')
      .evaluate(el => el.closest('.overflow-y-auto')?.scrollTop ?? 0);
    expect(scrollTop).toBeGreaterThan(0);
  });

  test('the tab bar stays fixed while only the row list scrolls', async ({ page }) => {
    // タブと一覧が1つのスクロール領域にまとまっていると、長い一覧を
    // スクロールするたびにタブごと流れて見えなくなってしまう
    const total = page.locator('[data-testid="hierarchy-node"][data-column="total"]').first();
    await total.click();
    const panel = page.getByTestId('hierarchy-side-panel');
    const tab = panel.getByRole('tab', { name: /^事項/ });
    await tab.click();

    const tabTopBefore = (await tab.boundingBox())!.y;

    const box = (await panel.getByRole('tabpanel').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(200);

    const scrollTop = await panel
      .getByRole('tabpanel')
      .evaluate(el => el.closest('.overflow-y-auto')?.scrollTop ?? 0);
    expect(scrollTop).toBeGreaterThan(0);

    const tabTopAfter = (await tab.boundingBox())!.y;
    expect(tabTopAfter).toBe(tabTopBefore);
  });

  test('Escape while editing the zoom percentage cancels the edit without clearing the selection', async ({ page }) => {
    // Escape は本来「入力の取り消し」のはずが、確定と同じ扱いで blur() されて
    // 値が適用され、さらに window の Escape ハンドラにまで伝播して選択も
    // 消えていた（Escapeを押しただけでズーム値が変わり、選択も解けてしまう）
    await page.getByTestId('hierarchy-node').first().click();
    await expect(page).toHaveURL(/sel=/);

    await page.getByTitle('クリックしてズーム率を入力').click();
    await page.getByLabel('ズーム率(数値)').fill('250');
    await page.getByLabel('ズーム率(数値)').press('Escape');

    // 編集前の100%のまま（適用されない）
    await expect(page.getByTitle('クリックしてズーム率を入力')).toHaveText('100%');
    // 選択も消えない
    await expect(page).toHaveURL(/sel=/);
  });
});
