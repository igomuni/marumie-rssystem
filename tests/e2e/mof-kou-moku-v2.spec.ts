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
  await page.getByLabel("RS review").selectOption("2024");
  await expect(page.getByLabel("RS review")).toHaveValue("2024", {
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

  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  let selected = false;
  for (let index = 0; index < (await rows.count()); index++) {
    const row = rows.nth(index);
    if ((await row.locator("td").first().textContent())?.trim() !== "—") {
      await row.click();
      selected = true;
      break;
    }
  }
  expect(selected).toBe(true);

  const relatedTab = page.getByRole("button", { name: /関連RS事業 \([1-9]/ });
  await relatedTab.click();
  await expect(page.getByText("リンク元", { exact: true })).toBeVisible();
  await expect(page.getByText("元リンク根拠", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "決算額とRS予算額の一致や、決算額の事業別配分を示すものではありません。",
    ),
  ).toBeVisible();
  await expect(page.getByText("RS事業額", { exact: true })).toHaveCount(0);
  await expect(page.getByText("RS事業%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("MOF目%", { exact: true })).toHaveCount(0);

  await page.getByLabel("RS review").selectOption("2025");
  await expect(page.getByLabel("RS review")).toHaveValue("2025");
  await expect(page.getByText("V2", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("リンク元", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
