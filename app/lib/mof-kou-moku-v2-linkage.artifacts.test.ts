import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { MofKouMokuV2LinkageProduct } from "@/types/mof-kou-moku-v2-linkage";

function product(reviewYear: number, fiscalYear: number) {
  return JSON.parse(
    gunzipSync(
      readFileSync(`public/data/v2/ui/mof-kou-moku/review-${reviewYear}-fy${fiscalYear}.json.gz`),
    ).toString(),
  ) as MofKouMokuV2LinkageProduct;
}

describe("published mof-kou-moku V2 reconciliation artifacts", () => {
  const fy2024 = product(2025, 2024);

  it("preserves the FY2024 PID 4 reconciliation evidence", () => {
    const group = fy2024.groups.find(group =>
      group.phase === "initial" && group.kouMokuKey.includes("情報処理業務庁費") && group.projects.some(project => project.projectId === "4"),
    );
    expect(group?.mofAmountYen).toBe(453_911_195_000);
    expect(group?.rsAmountYen).toBe(454_849_037_000);
    expect(group?.rsAmountYen! - group?.mofAmountYen!).toBe(937_842_000);
    expect(group?.projects.find(project => project.projectId === "4")?.rsAmountYen).toBe(453_911_195_000);
  });

  it("preserves NEDO/JOGMEC mismatch, multi-row, zero-MOF, and negative evidence", () => {
    const supplement = fy2024.groups.filter(group => group.phase === "supplement");
    const nendo = supplement.find(group => group.projects.some(project => project.projectId === "19958"));
    expect(nendo).toBeDefined();
    expect(nendo!.rsAmountYen).toBeGreaterThan(nendo!.mofAmountYen);
    const jogmec = supplement.find(group => group.projects.some(project => project.projectId === "20976" && project.rsRecordCount === 2));
    expect(jogmec?.projects.find(project => project.projectId === "20976")?.rsRecordCount).toBe(2);
    expect(fy2024.groups.some(group => group.mofAmountYen === 0 && group.rsAmountYen > 0)).toBe(true);
    expect(fy2024.groups.some(group => group.projects.some(project => project.rsAmountYen < 0))).toBe(true);
  });
});
