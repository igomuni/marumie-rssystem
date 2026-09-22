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
