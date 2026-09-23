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
    expect(group).toBeDefined();
    if (!group) throw new Error("PID 4 reconciliation group is missing");
    expect(group.mofAmountYen).toBe(453_911_195_000);
    expect(group.rsAmountYen).toBe(454_849_037_000);
    expect(group.rsAmountYen - group.mofAmountYen).toBe(937_842_000);
    expect(group.projects.find(project => project.projectId === "4")?.rsAmountYen).toBe(453_911_195_000);
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

describe("published mof-kou-moku V2 settlement identity (Phase B3b: public settlement.json.gz authority)", () => {
  const review2024fy2024 = product(2024, 2024);
  const review2025fy2024 = product(2025, 2024);
  const fy2023 = product(2024, 2023);
  const review2025fy2025 = product(2025, 2025);

  it("review-2024 x FY2024: identityRelations/distinct projects match the public settlement.json.gz golden", () => {
    expect(review2024fy2024.schemaVersion).toBe(6);
    expect(review2024fy2024.identityRelations).toHaveLength(3907);
    const distinctProjects = new Set(review2024fy2024.identityRelations.flatMap(r => r.projectIds));
    expect(distinctProjects.size).toBe(4754);
    expect(review2024fy2024.diagnostics.settlementDataStatus).toBe("available");
    // public identityは1件も間引かない: sourceとprojectedは必ず一致する
    expect(review2024fy2024.diagnostics.projectedSettlementRelationCount).toBe(
      review2024fy2024.diagnostics.sourceSettlementRelationCount,
    );
  });

  it("review-2025 x FY2024: identityRelations/distinct projects match the public settlement.json.gz golden", () => {
    expect(review2025fy2024.identityRelations).toHaveLength(3900);
    const distinctProjects = new Set(review2025fy2024.identityRelations.flatMap(r => r.projectIds));
    expect(distinctProjects.size).toBe(4618);
  });

  it("FY2023: artifact_missing yields an empty identityRelations projection", () => {
    expect(fy2023.diagnostics.settlementDataStatus).toBe("artifact_missing");
    expect(fy2023.identityRelations).toHaveLength(0);
  });

  it("review-2025 x FY2025: no_settlement_rows yields an empty identityRelations projection", () => {
    expect(review2025fy2025.diagnostics.settlementDataStatus).toBe("no_settlement_rows");
    expect(review2025fy2025.identityRelations).toHaveLength(0);
  });

  it("contains an exact-item-key relation whose evidence sources are attributable to formal budget links", () => {
    const relation = review2024fy2024.identityRelations.find(r =>
      r.itemNaturalKey === "general|デジタル庁|デジタル庁|002|デジタル社会形成推進費|06|諸謝金",
    );
    expect(relation).toBeDefined();
    expect(relation?.projects.every(p => p.sources.length > 0)).toBe(true);
  });

  it("fallback golden case: unique-name-fallback places the UI relation on the settlement-side item, not the budget-side item", () => {
    // 予算側項コード06 → 決算側項コード641（東日本大震災復興特別会計、地域活性化等復興政策費）。
    // budgetItemId(=budget側itemNaturalKey)とrelation.itemNaturalKey(=settlementItemId)は
    // sectionCodeの段階から異なる。relationはsettlement側（項コード641）へ配置されている必要がある。
    const relation = review2024fy2024.identityRelations.find(r =>
      r.itemNaturalKey.includes("|641|地域活性化等復興政策費|14|特定復興再生拠点区域外帰還・居住調査等委託費"),
    );
    expect(relation).toBeDefined();
    if (!relation) throw new Error("fallback golden relation is missing");
    expect(relation.itemNaturalKey).not.toContain("|06|地域活性化等復興政策費");
    expect(relation.projectIds).toContain("5591");
    // source evidence（phase/matchMethod/RS金額）はbudget側のformal linkから正しく復元できている
    const project = relation.projects.find(p => p.projectId === "5591");
    expect(project?.sources.length).toBeGreaterThan(0);
    expect(project?.sources[0].phase).toBe("initial");
  });

  it("legacy V1 evidence-gap fallback golden: 気象庁 世界気象機関等分担金（legacy V1側でbudget item+budgetTypeが曖昧で通常のbudget projection groupが無いケース）でもPID evidenceが独立再構成される", () => {
    expect(review2024fy2024.diagnostics.settlementProjectionLegacyEvidenceGapCount).toBe(2);
    // 発生した場合でも、relation数・project集合はpublic authorityと必ず一致する（fail-fastが機能した証拠）
    expect(review2024fy2024.identityRelations).toHaveLength(3907);

    for (const [itemNaturalKey, linkId, rsAmountYen] of [
      ["general|国土交通省|気象庁|233|観測予報等業務費|16|世界気象機関等分担金", "mofrs_2dffd7a9983d0905606c", 818_548_000],
      ["general|国土交通省|気象庁|233|観測予報等業務費|16|政府開発援助世界気象機関分担金", "mofrs_cab579382ec8a14f3699", 33_766_000],
    ] as const) {
      const relation = review2024fy2024.identityRelations.find(r => r.itemNaturalKey === itemNaturalKey);
      expect(relation, itemNaturalKey).toBeDefined();
      if (!relation) throw new Error(`legacy evidence-gap golden relation is missing: ${itemNaturalKey}`);
      expect(relation.projectIds).toEqual(["4100"]);
      const project = relation.projects.find(p => p.projectId === "4100");
      expect(project?.sources).toHaveLength(1);
      expect(project?.sources[0].linkId).toBe(linkId);
      expect(project?.sources[0].phase).toBe("initial");
      expect(project?.sources[0].rsAmountYen).toBe(rsAmountYen);
    }
  });
});
