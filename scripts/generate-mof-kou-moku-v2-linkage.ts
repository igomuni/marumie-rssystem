/** Pipeline V2の公開済みリンクを、/mof-kou-moku 用の軽量UI projectionへ展開する。 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import type {
  MOFBudgetType,
  MOFKouMokuData,
  MOFKouMokuItem,
} from "@/types/mof-kou-moku";
import type { V2MatchMethod } from "@/app/lib/v2-public-linkage";
import type {
  MofKouMokuV2IdentityProject,
  MofKouMokuV2IdentityRelation,
  MofKouMokuV2IdentitySource,
  MofKouMokuV2LinkGroup,
  MofKouMokuV2LinkageProduct,
  MofKouMokuV2Project,
} from "@/types/mof-kou-moku-v2-linkage";
import type {
  MofRsProjectLinkGroup,
  RsBudgetItemRecordV2,
  RsBudgetSummaryRecord,
} from "@/scripts/pipeline-v2/types";
import { readJsonl } from "@/scripts/pipeline-v2/lib/jsonl";
import { aggregateRsProjectAmounts } from "@/app/lib/mof-kou-moku-v2-linkage";

type Root = {
  publishSchemaVersion: number;
  links: { reviewYear: number; fiscalYear: number }[];
};
type Link = {
  linkId: string;
  phase: "initial" | "supplement";
  revision: number | null;
  matchMethod: V2MatchMethod;
  sectionIds: string[];
  projectIds: string[];
  mofAmountYen: number;
  rsAmountYen: number;
  differenceYen: number;
};
type DetailLink = Link & { reviewYear: number; itemIds: string[] };
type Detail = { rsLinks?: DetailLink[] };

/**
 * public/data/v2/links/review-{ry}-fy{fy}/settlement.json.gz（Phase B3a、
 * lib/settlement-publish.tsが生成するshapeと同一）。決算identityの唯一のauthority。
 * ここでは表示用に読むだけで、独自の決算candidate探索は一切行わない。
 */
type PublishedSettlementResolutionMethod = "exact-item-key" | "unique-name-fallback";
type PublishedSettlementSource = {
  linkId: string;
  budgetItemId: string;
  resolutionMethod: PublishedSettlementResolutionMethod;
};
type PublishedSettlementIdentity = {
  settlementItemId: string;
  settlementSectionId: string;
  accountType: string;
  projectIds: string[];
  sources: PublishedSettlementSource[];
  amounts: {
    budgetAppropriationYen: number | null;
    currentBudgetYen: number | null;
    spentYen: number | null;
    carryoverOutYen: number | null;
    unusedYen: number | null;
  };
};
type PublishedSettlementProduct = {
  schemaVersion: number;
  publishSchemaVersion: number;
  reviewYear: number;
  fiscalYear: number;
  dataStatus: "artifact_missing" | "no_settlement_rows" | "available";
  identities: PublishedSettlementIdentity[];
};
const read = <T>(p: string) => JSON.parse(fs.readFileSync(p, "utf-8")) as T;
const readGz = <T>(p: string) =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf-8")) as T;
const norm = (v: string | null | undefined) =>
  (v ?? "").normalize("NFKC").replace(/\s+/g, "");
function itemKey(i: MOFKouMokuItem) {
  const section =
    i.accountType === "general"
      ? [
          i.accountType,
          i.ministry,
          i.organization,
          i.sectionCode,
          i.sectionName,
        ]
      : i.accountType === "special"
        ? [
            i.accountType,
            i.ministry,
            i.specialAccount,
            i.subAccount,
            i.sectionCode,
            i.sectionName,
          ]
        : [i.accountType, i.agency, i.subAccount, i.sectionCode, i.sectionName];
  return [...section, i.subItemCode, i.subItemName].map(norm).join("|");
}
function budgetType(
  phase: Link["phase"],
  revision: number | null,
): MOFBudgetType | null {
  return phase === "initial"
    ? "当初予算"
    : revision === null
      ? null
      : (`補正予算（第${revision}号）` as MOFBudgetType);
}
function sourceSortKey(source: MofKouMokuV2IdentitySource): string {
  return `${source.phase === "initial" ? "0" : "1"}:${String(source.revision ?? 0).padStart(4, "0")}:${source.linkId}`;
}
function projectBreakdown(
  link: MofRsProjectLinkGroup,
  rows: Map<string, RsBudgetItemRecordV2>,
) {
  const matchedRows: RsBudgetItemRecordV2[] = [];
  const counts = new Map<string, number>();
  for (const recordId of link.rsRecordIds) {
    const row = rows.get(recordId);
    if (!row)
      throw new Error(
        `RS normalized record not found: linkId=${link.linkId} recordId=${recordId}`,
      );
    matchedRows.push(row);
    const id = String(row.projectId);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const amounts = aggregateRsProjectAmounts(matchedRows);
  const actual = [...amounts.keys()].sort();
  const expected = [...link.projectIds].map(String).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`projectIds mismatch: linkId=${link.linkId}`);
  const total = [...amounts.values()].reduce((sum, value) => sum + value, 0);
  if (total !== link.rsAmountYen)
    throw new Error(
      `project amount sum mismatch: linkId=${link.linkId} breakdown=${total} group=${link.rsAmountYen}`,
    );
  return { amounts, counts, recordCount: link.rsRecordIds.length };
}
function build(reviewYear: number, fiscalYear: number) {
  const rootDir = path.resolve(process.cwd(), "public/data/v2");
  const legacy = read<MOFKouMokuData>(
    path.resolve(process.cwd(), `public/data/mof-kou-moku-${fiscalYear}.json`),
  );
  const rows = new Map<string, MOFKouMokuItem[]>();
  for (const item of legacy.items) {
    const k = `${itemKey(item)}\x1f${item.budgetType}`;
    rows.set(k, [...(rows.get(k) ?? []), item]);
  }
  const standalone = readGz<{ links: Link[] }>(
    path.join(
      rootDir,
      "links",
      `review-${reviewYear}-fy${fiscalYear}`,
      "links.json.gz",
    ),
  );
  const settlement = readGz<PublishedSettlementProduct>(
    path.join(
      rootDir,
      "links",
      `review-${reviewYear}-fy${fiscalYear}`,
      "settlement.json.gz",
    ),
  );
  if (settlement.reviewYear !== reviewYear || settlement.fiscalYear !== fiscalYear)
    throw new Error(
      `settlement.json.gz year mismatch: expected review-${reviewYear}-fy${fiscalYear}, got review-${settlement.reviewYear}-fy${settlement.fiscalYear}`,
    );
  const expected = new Set(standalone.links.map((x) => x.linkId));
  const byShard = new Map<string, Set<string>>();
  for (const l of standalone.links)
    for (const id of l.sectionIds) {
      const shard = id.startsWith("mofsec_") ? id.slice(7, 9) : id.slice(0, 2);
      const ids = byShard.get(shard) ?? new Set<string>();
      ids.add(id);
      byShard.set(shard, ids);
    }
  const links = new Map<string, DetailLink>();
  for (const [shard, ids] of byShard) {
    const bundle = readGz<Record<string, Detail>>(
      path.join(
        rootDir,
        "mof",
        `fy${fiscalYear}`,
        "sections",
        `${shard}.json.gz`,
      ),
    );
    for (const id of ids)
      for (const link of bundle[id]?.rsLinks ?? [])
        if (link.reviewYear === reviewYear && expected.has(link.linkId)) {
          const old = links.get(link.linkId);
          links.set(
            link.linkId,
            old
              ? {
                  ...old,
                  itemIds: [
                    ...new Set([...old.itemIds, ...link.itemIds]),
                  ].sort(),
                }
              : { ...link, itemIds: [...link.itemIds].sort() },
          );
        }
  }
  const rs = readGz<{
    projects: Pick<
      MofKouMokuV2Project,
      "projectId" | "projectName" | "ministry"
    >[];
  }>(path.join(rootDir, "rs", `review-${reviewYear}`, "index.json.gz"));
  const projects = new Map(
    rs.projects.map((p) => [
      String(p.projectId),
      { ...p, projectId: String(p.projectId) },
    ]),
  );
  const derived = readJsonl<MofRsProjectLinkGroup>(
    path.resolve(
      process.cwd(),
      "data/derived/links",
      `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`,
    ),
  );
  const derivedById = new Map(derived.map((link) => [link.linkId, link]));
  const normalized = readJsonl<RsBudgetItemRecordV2>(
    path.resolve(
      process.cwd(),
      "data/normalized/rs",
      `review-${reviewYear}`,
      "budget-items.jsonl",
    ),
  );
  const normalizedById = new Map(normalized.map((row) => [row.recordId, row]));
  const summaries = readJsonl<RsBudgetSummaryRecord>(
    path.resolve(
      process.cwd(),
      "data/normalized/rs",
      `review-${reviewYear}`,
      "budget-summaries.jsonl",
    ),
  );
  const projectBudgetById = new Map<string, number | null>();
  for (const summary of summaries) {
    if (
      summary.scopeLevel === "project_total" &&
      summary.fiscalYear === fiscalYear
    ) {
      projectBudgetById.set(
        String(summary.projectId),
        summary.amounts["計（歳出予算現額合計）"] ?? null,
      );
    }
  }
  const breakdowns = new Map<string, ReturnType<typeof projectBreakdown>>();
  const groups: MofKouMokuV2LinkGroup[] = [];
  let unmatched = 0;
  let ambiguous = 0;
  let multi = 0;
  let breakdownRecords = 0;
  for (const link of links.values()) {
    const type = budgetType(link.phase, link.revision);
    if (!type) continue;
    if (link.itemIds.length > 1) multi++;
    const derivedLink = derivedById.get(link.linkId);
    if (!derivedLink)
      throw new Error(`derived link not found: linkId=${link.linkId}`);
    if (
      derivedLink.rsAmountYen !== link.rsAmountYen ||
      derivedLink.mofAmountYen !== link.mofAmountYen
    )
      throw new Error(`public/derived amount mismatch: linkId=${link.linkId}`);
    let breakdown = breakdowns.get(link.linkId);
    if (!breakdown) {
      breakdown = projectBreakdown(derivedLink, normalizedById);
      breakdowns.set(link.linkId, breakdown);
      breakdownRecords += breakdown.recordCount;
    }
    for (const id of link.itemIds) {
      const candidates = rows.get(`${id}\x1f${type}`) ?? [];
      if (candidates.length !== 1) {
        candidates.length ? ambiguous++ : unmatched++;
        continue;
      }
      const item = candidates[0];
      const expectedMofAmount =
        link.phase === "initial" ? item.amount : item.difference;
      if (expectedMofAmount === null || expectedMofAmount !== link.mofAmountYen) {
        throw new Error(
          `MOF stage amount mismatch: linkId=${link.linkId} item=${item.key} phase=${link.phase} legacy=${expectedMofAmount} projection=${link.mofAmountYen}`,
        );
      }
      const projectRows = link.projectIds.map((raw) => {
        const projectId = String(raw);
        const meta = projects.get(projectId) ?? {
          projectId,
          projectName: projectId,
          ministry: "",
        };
        return {
          ...meta,
          rsAmountYen: breakdown!.amounts.get(projectId) ?? 0,
          rsRecordCount: breakdown!.counts.get(projectId) ?? 0,
          projectBudgetAmountYen: projectBudgetById.get(projectId) ?? null,
        };
      });
      if (
        projectRows.reduce((sum, project) => sum + project.rsAmountYen, 0) !==
        link.rsAmountYen
      )
        throw new Error(
          `projected project sum mismatch: linkId=${link.linkId}`,
        );
      groups.push({
        linkId: link.linkId,
        reviewYear,
        fiscalYear,
        phase: link.phase,
        revision: link.revision,
        matchMethod: link.matchMethod,
        kouMokuKey: item.key,
        itemNaturalKey: id,
        mofBudgetType: type,
        projectIds: [...link.projectIds].map(String),
        projects: projectRows,
        mofAmountYen: link.mofAmountYen,
        rsAmountYen: link.rsAmountYen,
        differenceYen: link.differenceYen,
        spansItems: link.itemIds.length > 1,
      });
    }
  }
  // 決算identityはpublic settlement.json.gz（Phase B2 → schema v3）だけをauthorityとする。
  // ここではlegacy決算行の独自candidate探索は一切行わない。budget側itemNaturalKeyから
  // 決算行を推測することもしない（unique-name-fallbackではbudget項コードと決算項コードが
  // 異なるため、budget itemNaturalKeyでは決算識別子として使えない）。
  const groupByLinkAndItem = new Map<string, MofKouMokuV2LinkGroup>();
  for (const group of groups) {
    const key = `${group.linkId}\x1f${group.itemNaturalKey}`;
    if (groupByLinkAndItem.has(key))
      throw new Error(`duplicate budget projection group for linkId+itemNaturalKey: ${key}`);
    groupByLinkAndItem.set(key, group);
  }

  let settlementProjectionUnmatchedLegacyItemCount = 0;
  let settlementProjectionAmbiguousLegacyItemCount = 0;
  // legacy mof-kou-moku-{fy}.json（V1データセット）側でbudget item+budgetTypeが一意に
  // 解決できず(0件/複数件)、groupByLinkAndItemにその(linkId,budgetItemId)のgroupが無い
  // 稀なケース。PID別evidence自体はderived link + normalized RS行から独立に再構成できる
  // ため、legacy V1側の不完全性を理由にidentity全体をfail-fastしない
  // （fail-fastするのは、その独立再構成すら破綻する＝真の構造的不整合のときだけ）。
  let settlementProjectionLegacyEvidenceGapCount = 0;

  const identityRelations: MofKouMokuV2IdentityRelation[] = settlement.identities
    .map((identity) => {
      // legacy決算行は、あくまで表示用のkouMokuKey（既存/mof-kou-mokuの行キー）を得る
      // ためだけに引く。この対応付けの成否はrelationの有無やprojectIdsには一切影響しない
      // （public identityは必ず1件のrelationになる）。
      const legacyCandidates = rows.get(`${identity.settlementItemId}\x1f決算`) ?? [];
      let kouMokuKey = identity.settlementItemId;
      if (legacyCandidates.length === 1) {
        kouMokuKey = legacyCandidates[0].key;
      } else if (legacyCandidates.length === 0) {
        settlementProjectionUnmatchedLegacyItemCount++;
      } else {
        settlementProjectionAmbiguousLegacyItemCount++;
      }

      const projectAcc = new Map<
        string,
        { projectId: string; projectName: string; ministry: string; sources: Map<string, MofKouMokuV2IdentitySource> }
      >();
      for (const source of identity.sources) {
        const groupKey = `${source.linkId}\x1f${source.budgetItemId}`;
        const group = groupByLinkAndItem.get(groupKey);
        if (group) {
          for (const projectRow of group.projects) {
            const projectId = projectRow.projectId;
            let project = projectAcc.get(projectId);
            if (!project) {
              project = { projectId, projectName: projectRow.projectName, ministry: projectRow.ministry, sources: new Map() };
              projectAcc.set(projectId, project);
            }
            project.sources.set(group.linkId, {
              linkId: group.linkId,
              phase: group.phase,
              revision: group.revision,
              matchMethod: group.matchMethod,
              rsAmountYen: projectRow.rsAmountYen,
              spansItems: group.spansItems,
            });
          }
          continue;
        }
        // legacy V1未解決フォールバック: derived link + normalized RS行から独立にPID別内訳を
        // 再構成する（legacyのbudgetType一致に依存しない）。spansItemsな formal link（複数item）
        // にbudgetItemIdが属する場合はPID別金額をこのitemだけに帰属できないため、それはfail-fast。
        const detailLink = links.get(source.linkId);
        if (!detailLink || !detailLink.itemIds.includes(source.budgetItemId) || detailLink.itemIds.length > 1)
          throw new Error(
            `settlement source has no matching budget evidence: settlementItemId=${identity.settlementItemId} linkId=${source.linkId} budgetItemId=${source.budgetItemId}`,
          );
        const derivedLink = derivedById.get(source.linkId);
        if (!derivedLink)
          throw new Error(`derived link not found for settlement source: linkId=${source.linkId}`);
        let breakdown = breakdowns.get(source.linkId);
        if (!breakdown) {
          breakdown = projectBreakdown(derivedLink, normalizedById);
          breakdowns.set(source.linkId, breakdown);
          breakdownRecords += breakdown.recordCount;
        }
        settlementProjectionLegacyEvidenceGapCount++;
        for (const rawProjectId of detailLink.projectIds) {
          const projectId = String(rawProjectId);
          const meta = projects.get(projectId) ?? { projectId, projectName: projectId, ministry: "" };
          let project = projectAcc.get(projectId);
          if (!project) {
            project = { projectId, projectName: meta.projectName, ministry: meta.ministry, sources: new Map() };
            projectAcc.set(projectId, project);
          }
          project.sources.set(detailLink.linkId, {
            linkId: detailLink.linkId,
            phase: detailLink.phase,
            revision: detailLink.revision,
            matchMethod: detailLink.matchMethod,
            rsAmountYen: breakdown.amounts.get(projectId) ?? 0,
            spansItems: false,
          });
        }
      }
      const reconstructedProjectIds = [...projectAcc.keys()].sort();
      const expectedProjectIds = [...identity.projectIds].map(String).sort();
      if (JSON.stringify(reconstructedProjectIds) !== JSON.stringify(expectedProjectIds))
        throw new Error(
          `settlement identity projectIds mismatch: settlementItemId=${identity.settlementItemId} public=${JSON.stringify(expectedProjectIds)} reconstructed=${JSON.stringify(reconstructedProjectIds)}`,
        );

      const identityProjects: MofKouMokuV2IdentityProject[] = [...projectAcc.values()]
        .map((project) => ({
          projectId: project.projectId,
          projectName: project.projectName,
          ministry: project.ministry,
          sources: [...project.sources.values()].sort((a, b) => sourceSortKey(a).localeCompare(sourceSortKey(b))),
        }))
        .sort((a, b) => (a.projectName || a.projectId).localeCompare(b.projectName || b.projectId, "ja"));

      return {
        relationId: `settlement_identity:${reviewYear}:${fiscalYear}:${identity.settlementItemId}`,
        relationKind: "inherited-from-budget-link" as const,
        reviewYear,
        fiscalYear,
        kouMokuKey,
        itemNaturalKey: identity.settlementItemId,
        projectIds: identityProjects.map((project) => project.projectId).sort(),
        projects: identityProjects,
      };
    })
    .sort((a, b) => a.kouMokuKey.localeCompare(b.kouMokuKey, "ja"));

  const product: MofKouMokuV2LinkageProduct = {
    schemaVersion: 6,
    sourcePublishSchemaVersion: read<Root>(path.join(rootDir, "manifest.json"))
      .publishSchemaVersion,
    generatedAt: new Date().toISOString(),
    reviewYear,
    fiscalYear,
    groups,
    identityRelations,
    diagnostics: {
      sourceLinkGroupCount: standalone.links.length,
      projectedGroupItemCount: groups.length,
      unmatchedItemIdCount: unmatched,
      ambiguousItemIdCount: ambiguous,
      multiItemGroupCount: multi,
      linkedKouMokuCount: new Set(groups.map((g) => g.kouMokuKey)).size,
      linkedProjectCount: new Set(groups.flatMap((g) => g.projectIds)).size,
      projectBreakdownRecordCount: breakdownRecords,
      projectBreakdownCheckedGroupCount: breakdowns.size,
      settlementDataStatus: settlement.dataStatus,
      sourceSettlementRelationCount: settlement.identities.length,
      projectedSettlementRelationCount: identityRelations.length,
      settlementProjectionUnmatchedLegacyItemCount,
      settlementProjectionAmbiguousLegacyItemCount,
      settlementProjectionLegacyEvidenceGapCount,
      settlementIdentityProjectCount: new Set(
        identityRelations.flatMap((r) => r.projectIds),
      ).size,
    },
  };
  if (product.diagnostics.projectedSettlementRelationCount !== product.diagnostics.sourceSettlementRelationCount)
    throw new Error(
      `settlement relation count drift: source=${product.diagnostics.sourceSettlementRelationCount} projected=${product.diagnostics.projectedSettlementRelationCount} (public identityを間引いてはいけない)`,
    );
  const output = path.join(
    rootDir,
    "ui/mof-kou-moku",
    `review-${reviewYear}-fy${fiscalYear}.json.gz`,
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    zlib.gzipSync(JSON.stringify(product), { level: 9 }),
  );
  console.log(
    `review-${reviewYear} × fy${fiscalYear}: groups=${groups.length} items=${product.diagnostics.linkedKouMokuCount} projects=${product.diagnostics.linkedProjectCount} ` +
    `settlement[${settlement.dataStatus}]=${identityRelations.length} settlementProjects=${product.diagnostics.settlementIdentityProjectCount} ` +
    `legacyUnmatched=${settlementProjectionUnmatchedLegacyItemCount} legacyAmbiguous=${settlementProjectionAmbiguousLegacyItemCount} ` +
    `legacyEvidenceGap=${settlementProjectionLegacyEvidenceGapCount}`,
  );
}
const review = process.argv.find((x) => x.startsWith("--review="));
const fy = process.argv.find((x) => x.startsWith("--fy="));
const root = read<Root>(
  path.resolve(process.cwd(), "public/data/v2/manifest.json"),
);
for (const combo of root.links
  .filter((x) => !review || x.reviewYear === Number(review.split("=")[1]))
  .filter((x) => !fy || x.fiscalYear === Number(fy.split("=")[1])))
  build(combo.reviewYear, combo.fiscalYear);
