import { describe, expect, it } from "vitest";
import {
  aggregateRsProjectAmounts,
  aggregateV2IdentitySourceAmounts,
  buildV2KouMokuReconciliations,
  selectV2ProjectionGroupsForLinks,
  countV2IdentityProjectsByKouMoku,
  groupV2SettlementIdentityByKey,
} from "./mof-kou-moku-v2-linkage";

describe("aggregateRsProjectAmounts", () => {
  it("preserves signed 2-2 amounts when aggregating by project", () => {
    const actual = aggregateRsProjectAmounts([
      { projectId: "A", budgetAmountYen: 120 },
      { projectId: "A", budgetAmountYen: -20 },
      { projectId: "B", budgetAmountYen: -30 },
    ]);

    expect(actual.get("A")).toBe(100);
    expect(actual.get("B")).toBe(-30);
    expect([...actual.values()].reduce((sum, amount) => sum + amount, 0)).toBe(
      70,
    );
  });
});

describe("selectV2ProjectionGroupsForLinks", () => {
  it("joins by linkId and itemNaturalKey, never by a repeated group amount", () => {
    const group = (linkId: string, itemNaturalKey: string, rsAmountYen: number) => ({
      linkId, reviewYear: 2025, fiscalYear: 2024,
      phase: "initial" as const, revision: null, matchMethod: "exact-name-key" as const,
      kouMokuKey: itemNaturalKey, itemNaturalKey, mofBudgetType: "当初予算" as const,
      projectIds: ["A"], projects: [{ projectId: "A", projectName: "A", ministry: "X", rsAmountYen, rsRecordCount: 2, projectBudgetAmountYen: null }],
      mofAmountYen: 100, rsAmountYen, differenceYen: 100 - rsAmountYen, spansItems: false,
    });
    const actual = selectV2ProjectionGroupsForLinks(
      [group("wanted", "item-a", 60), group("wanted", "item-b", 40), group("other", "item-a", 100)],
      [{ linkId: "wanted", itemIds: ["item-a"] }],
    );
    expect(actual).toHaveLength(1);
    expect(actual[0].projects[0].rsAmountYen).toBe(60);
  });
});

describe("buildV2KouMokuReconciliations", () => {
  const group = (overrides: Record<string, unknown>) => ({
    linkId: "link-1", reviewYear: 2025, fiscalYear: 2024,
    phase: "initial" as const, revision: null, matchMethod: "exact-name-key" as const,
    kouMokuKey: "item-a", itemNaturalKey: "item-a", mofBudgetType: "当初予算" as const,
    projectIds: ["A"], projects: [], mofAmountYen: 100, rsAmountYen: 100,
    differenceYen: 0, spansItems: false, ...overrides,
  });

  it.each([
    [100, 100, 0, 1],
    [100, 120, 20, 1.2],
    [100, 60, -40, 0.6],
    [100, 100, 0, 1],
    [0, 20, 20, null],
  ])("calculates RS−MOF without changing signed amounts", (mof, rs, difference, rate) => {
    const actual = buildV2KouMokuReconciliations([
      group({ mofAmountYen: mof, rsAmountYen: rs }),
    ]).get("item-a")!;
    expect(actual.rsAmountYen).toBe(rs);
    expect(actual.rsMinusMofYen).toBe(difference);
    expect(actual.rsToMofRate).toBe(rate);
  });

  it("keeps same-PID signed breakdown groups distinct from copied group totals", () => {
    const actual = buildV2KouMokuReconciliations([
      group({ linkId: "a", projectIds: ["A"], mofAmountYen: 100, rsAmountYen: 120 }),
      group({ linkId: "b", projectIds: ["A", "B"], mofAmountYen: 0, rsAmountYen: -20 }),
    ]).get("item-a")!;
    expect(actual.rsAmountYen).toBe(100);
    expect(actual.projectIds).toEqual(new Set(["A", "B"]));
  });

  it("does not allocate a multi-item group to either item without evidence", () => {
    const actual = buildV2KouMokuReconciliations([
      group({ kouMokuKey: "item-a", spansItems: true, mofAmountYen: 100, rsAmountYen: 100 }),
    ]);
    expect(actual.size).toBe(0);
  });
});

describe("aggregateV2IdentitySourceAmounts", () => {
  it("keeps explicit zero, missing stages, and signed supplement amounts distinct", () => {
    const actual = aggregateV2IdentitySourceAmounts([
      {
        linkId: "initial",
        phase: "initial",
        revision: null,
        matchMethod: "exact-name-key",
        rsAmountYen: 100,
        spansItems: false,
      },
      {
        linkId: "supplement-1",
        phase: "supplement",
        revision: 1,
        matchMethod: "exact-name-key",
        rsAmountYen: -20,
        spansItems: false,
      },
      {
        linkId: "supplement-2-zero",
        phase: "supplement",
        revision: 2,
        matchMethod: "exact-name-key",
        rsAmountYen: 0,
        spansItems: false,
      },
    ]);

    expect(actual.get("initial")).toBe(100);
    expect(actual.get("supplement-1")).toBe(-20);
    expect(actual.get("supplement-2")).toBe(0);
    expect(actual.has("supplement-3")).toBe(false);
    expect([...actual.values()].reduce((sum, amount) => sum + amount, 0)).toBe(
      80,
    );
  });
});

describe("settlement identity projection helpers", () => {
  it("counts distinct inherited RS projects per settlement kouMokuKey", () => {
    const relations = [
      {
        relationId: "r1",
        relationKind: "inherited-from-budget-link" as const,
        reviewYear: 2025,
        fiscalYear: 2025,
        kouMokuKey: "settlement-key",
        itemNaturalKey: "item-1",
        projectIds: ["100", "200"],
        projects: [],
      },
      {
        relationId: "r2",
        relationKind: "inherited-from-budget-link" as const,
        reviewYear: 2025,
        fiscalYear: 2025,
        kouMokuKey: "settlement-key",
        itemNaturalKey: "item-2",
        projectIds: ["200", "300"],
        projects: [],
      },
    ];

    expect(
      countV2IdentityProjectsByKouMoku(
        groupV2SettlementIdentityByKey(relations),
      ).get("settlement-key"),
    ).toBe(3);
  });
});
