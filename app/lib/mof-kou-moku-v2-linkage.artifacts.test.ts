import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { MOFKouMokuData } from "@/types/mof-kou-moku";
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
  const fy2023 = product(2024, 2023);
  const fy2025 = product(2025, 2025);

  it("uses the MOF amount for the corresponding initial or supplement stage", () => {
    for (const [reviewYear, fiscalYear] of [[2024, 2023], [2024, 2024], [2025, 2023], [2025, 2024], [2025, 2025]]) {
      const legacy = JSON.parse(readFileSync(`public/data/mof-kou-moku-${fiscalYear}.json`, "utf-8")) as MOFKouMokuData;
      const items = new Map(legacy.items.map(item => [item.key, item]));
      for (const group of product(reviewYear, fiscalYear).groups.filter(group => !group.spansItems)) {
        const item = items.get(group.kouMokuKey);
        expect(item, `${reviewYear}/${fiscalYear}: ${group.linkId}`).toBeDefined();
        expect(group.mofAmountYen, `${reviewYear}/${fiscalYear}: ${group.linkId}`).toBe(
          group.phase === "initial" ? item!.amount : item!.difference,
        );
      }
    }
  });

  it("keeps the FY2023 Digital Agency supplement as a stage-delta golden case", () => {
    const group = fy2023.groups.find(group => group.linkId === "mofrs_a0b0e40eb7f06f2fe05d");
    expect(group?.mofAmountYen).toBe(4_656_639_000);
    const legacy = JSON.parse(readFileSync("public/data/mof-kou-moku-2023.json", "utf-8")) as MOFKouMokuData;
    const item = legacy.items.find(item => item.key === group?.kouMokuKey);
    expect(item?.amount).toBe(5_983_519_000);
    expect(item?.difference).toBe(4_656_639_000);
    expect(group?.mofAmountYen).not.toBe(item?.amount);
  });

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
    expect(nendo?.mofAmountYen).toBe(12_800_782_000);
    expect(nendo?.rsAmountYen).toBe(484_191_979_000);
    expect(nendo?.projects.find(project => project.projectId === "19958")?.rsAmountYen).toBe(471_391_197_000);
    const jogmec = supplement.find(group => group.projects.some(project => project.projectId === "20976" && project.rsRecordCount === 2));
    expect(jogmec?.mofAmountYen).toBe(1_453_000_000);
    expect(jogmec?.rsAmountYen).toBe(24_365_500_000);
    expect(jogmec?.projects.find(project => project.projectId === "20976")?.rsRecordCount).toBe(2);
    expect(jogmec?.projects.find(project => project.projectId === "20976")?.rsAmountYen).toBe(24_365_500_000);
    const zeroMof = fy2025.groups.find(group => group.projects.some(project => project.projectId === "7560") && group.mofAmountYen === 0);
    expect(zeroMof?.rsAmountYen).toBeGreaterThan(0);
    const negative = supplement.find(group => group.projects.some(project => project.projectId === "4" && project.rsAmountYen === -2_141_074_000));
    expect(negative?.projects.find(project => project.projectId === "4")?.rsAmountYen).toBe(-2_141_074_000);
  });
});
