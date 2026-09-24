import { expect, test } from "@playwright/test";

test("loads the FY2025 V2 item projection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/mof-kou-moku");
  await page.getByLabel("年度", { exact: true }).selectOption("2025");
  await expect(page.getByLabel("RS review")).toHaveValue("2025", {
    timeout: 30_000,
  });
  await expect(page.getByText("V2", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test("keeps the legacy RS tab active until the V2 projection payload actually loads (review fix)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  let releaseProjection!: () => void;
  const projectionRequest = new Promise<void>((resolve) => {
    releaseProjection = resolve;
  });
  // FY2025は決算データ自体が無い年度（no_settlement_rows）のため、決算行を持つFY2024
  // ×review-2025のペアで検証する。
  await page.route(
    "**/data/v2/ui/mof-kou-moku/review-2025-fy2024.json.gz",
    async (route) => {
      await projectionRequest;
      await route.continue();
    },
  );

  await page.goto("/mof-kou-moku");
  await page.getByLabel("年度", { exact: true }).selectOption("2024");
  await page.getByLabel("RS review").selectOption("2025");
  await expect(page.getByLabel("RS review")).toHaveValue("2025", {
    timeout: 30_000,
  });
  await expect(page.getByText("V2読込中", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // reviewYearOptionsだけを条件にすると、projectionが未取得でもv2Mode=trueになり、
  // 一覧のRS件数が空のv2RsCountByKeyから引かれて全行「—」になってしまう（review指摘）。
  // projectionが届くまでは、legacy linkageByKey由来の実件数を出し続けるべき
  // （このreviewYear×fiscalYearペアは実際にRSリンクを持つ行が存在する）。
  const tableRows = page.locator("tbody tr");
  await expect(tableRows.first()).toBeVisible();
  // legacy linkageByKey自体も非同期取得のため、初回描画直後は一時的に全行0のことがある。
  // pollingでlegacy件数が実際に反映されるのを待ってから判定する（route delay自体は維持）。
  await expect
    .poll(
      () =>
        tableRows.evaluateAll((rowEls) =>
          rowEls.some(
            (row) =>
              row instanceof HTMLTableRowElement &&
              Number(row.cells[0]?.textContent?.trim()) > 0,
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  releaseProjection();
  await expect(page.getByText("V2", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test("shows exact budget-link identities for an FY2024 settlement item", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/mof-kou-moku");
  await page.getByLabel("年度", { exact: true }).selectOption("2024");
  await page.getByLabel("RS review").selectOption("2025");
  await expect(page.getByLabel("RS review")).toHaveValue("2025", {
    timeout: 30_000,
  });
  await expect(page.getByText("V2", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const filterButton = page.getByRole("button", { name: "フィルタ" });
  if ((await filterButton.getAttribute("aria-expanded")) !== "true")
    await filterButton.click();
  await expect(filterButton).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("予算種別", { exact: true }).click();
  await page.getByRole("checkbox", { name: "決算" }).check();
  await page
    .getByLabel("項名", { exact: true })
    .fill("情報通信技術調達等適正・効率化推進費");
  await page.getByLabel("目名", { exact: true }).fill("情報処理業務庁費");

  const rows = page.locator("tbody tr");
  const digitalAgencyRow = rows.filter({
    has: page.getByText("デジタル庁", { exact: true }),
  });
  await expect(digitalAgencyRow.first()).toBeVisible();
  await digitalAgencyRow.first().click();

  const relatedTab = page.getByRole("button", { name: /関連RS事業 \([1-9]/ });
  await relatedTab.click();
  await expect(page.getByText("リンク元", { exact: true })).toBeVisible();
  await expect(page.getByText("元リンク根拠", { exact: true })).toBeVisible();
  await expect(
    page.locator("thead").getByRole("button", { name: "当初", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("thead").getByRole("button", { name: "補正1", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("thead").getByRole("button", { name: "当初＋補正", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4539.1億円", { exact: true })).toBeVisible();
  await expect(page.getByText("2046.6億円", { exact: true })).toBeVisible();
  await expect(page.getByText("6585.7億円", { exact: true })).toBeVisible();
  await expect(page.getByText("RS事業額", { exact: true })).toHaveCount(0);
  await expect(page.getByText("RS事業%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("MOF目%", { exact: true })).toHaveCount(0);

  await page.getByLabel("RS review").selectOption("2024");
  await expect(page.getByLabel("RS review")).toHaveValue("2024");
  await expect(page.getByText("V2", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("リンク元", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
