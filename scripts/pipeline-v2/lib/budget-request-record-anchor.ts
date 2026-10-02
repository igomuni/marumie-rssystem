/**
 * RecordAnchorResolver PoC: SemanticRecordCandidate（anchor候補）が「主要明細行らしい」のか「ページ/節の見出しらしい」のかを、
 * 分解されたevidence付きで観測する独立層。候補を除外・変更しない（SemanticRecordResult は読み取るだけ）。
 *
 * ## 原則
 * - unknown > guess / ambiguous > forced classification / evidence > score / repeated structure > isolated coincidence。
 * - 単一のscoreを足し引きしてthresholdで分類しない。各evidenceを独立に（supports・計測値・thresholdつきで）保持し、
 *   classification は evidence の種類の組み合わせから再計算できる。
 * - 特定の文字列（既知の見出しの語・ページ番号・コード値）を覚えない。このモジュールは文字内容（rawText）を一切読まず、
 *   SemanticRecordCandidate の幾何（bbox・金額groupの数と位置・関連構造の数）とページ寸法だけを使う。
 *   文字内容から来るevidence（コードの桁形状・matterの有無）は前段のSemanticRecordCandidate側にあり、ここでは再解釈しない。
 * - 固定座標を使わない: thresholdはページ由来（fontSize中央値・ページ高さに対する比）で、すべてparametersに記録し、
 *   0.8× / 1.0× / 1.25× で感度を診断する（Golden Sampleの正解に合わせて調整しない）。
 *
 * ## evidence
 * detailを支持: three_amount_groups / repeated_amount_columns / family_membership / sign_token_in_amount_region
 * headingを支持: page_relative_top / isolated_layout / lacks_field_structure
 * 中立（観測のみ）: relation_context
 * 単独ではどれも分類を確定しない（金額groupが3つでもdetail確定ではなく、金額が無くてもheading確定ではない）。
 *
 * ## classification（evidenceの種類から再計算できる規則）
 * - detailSatisfied: detail側の異なるevidence種別が2種類以上
 * - headingSatisfied: page_relative_top かつ isolated_layout かつ lacks_field_structure（3種類すべて）
 * - 両方satisfied → blockingなconflictとして `ambiguous`
 * - detailSatisfiedのみ → detail_candidate / headingSatisfiedのみ → heading_candidate
 * - どちらもsatisfiedでない → いずれかのevidenceがあれば `ambiguous`、無ければ `insufficient_evidence`
 * - 反対側のevidenceが（satisfiedでなくても）混在する場合は severity=noted の conflict として記録する（分類は変えない）
 * - stability: thresholdを0.8×/1.25×に振ってclassificationが変わるならstableにしない（SemanticRecordCandidateのambiguityとは別）。
 * heading_candidate は除外を意味しない。
 */
import type { SemanticRecordCandidate, SemanticRecordResult } from './budget-request-semantic-record';
import type { PageMeta } from './budget-request-source-token';

export const RECORD_ANCHOR_SCHEMA = 'budget-request-record-anchor-poc/v1';

export interface RecordAnchorOptions {
  /** 位置の揃い（code左端・matter開始・金額列の右端）の幅 = factor × fontSize中央値 */
  alignmentToleranceFactor: number;
  /** ページ上端からの帯 = topFraction × ページ高さ（候補のbbox上端がこの帯の中なら page_relative_top） */
  topFraction: number;
  /** family_membership がdetailを支持する最小のfamilyサイズ */
  minFamilySize: number;
  sensitivityScales: number[];
}

export const DEFAULT_RECORD_ANCHOR_OPTIONS: RecordAnchorOptions = {
  alignmentToleranceFactor: 0.25,
  topFraction: 0.15,
  minFamilySize: 3,
  sensitivityScales: [0.8, 1.25],
};

export type AnchorEvidenceKind =
  | 'three_amount_groups'
  | 'repeated_amount_columns'
  | 'family_membership'
  | 'sign_token_in_amount_region'
  | 'page_relative_top'
  | 'isolated_layout'
  | 'lacks_field_structure'
  | 'relation_context';

export interface AnchorEvidence {
  kind: AnchorEvidenceKind;
  supports: 'detail' | 'heading' | 'neutral';
  measurement: Record<string, number | boolean>;
  threshold?: Record<string, number>;
}

export interface AnchorConflict {
  severity: 'blocking' | 'noted';
  detailEvidenceKinds: AnchorEvidenceKind[];
  headingEvidenceKinds: AnchorEvidenceKind[];
  note: string;
}

export type AnchorClassification = 'detail_candidate' | 'heading_candidate' | 'ambiguous' | 'insufficient_evidence';

export interface RecordAnchorAssessment {
  assessmentIndex: number;
  /** 参照元: SemanticRecordCandidate.candidateIndex（SourceTokenまでそこから戻れる） */
  semanticCandidateIndex: number;
  classification: AnchorClassification;
  detailEvidence: AnchorEvidence[];
  headingEvidence: AnchorEvidence[];
  neutralEvidence: AnchorEvidence[];
  conflictingEvidence: AnchorConflict[];
  layoutFamilyIndex: number;
  stability: { stable: boolean; reasons: string[] };
  /** SemanticRecordCandidateのstatus（assessmentのstabilityとは別。echoのみ） */
  semanticCandidateStatus: 'candidate' | 'ambiguous';
}

/** 反復するレイアウト（code左端・matter開始の位置が揃う候補の集まり）。semantic typeではない */
export interface AnchorLayoutFamily {
  familyIndex: number;
  semanticCandidateIndexes: number[];
  observations: {
    codeXRange: [number, number];
    matterXRange: [number, number];
    amountColumnPattern?: { candidatesWithThreeGroups: number; rightEdgeRanges: [number, number][]; aligned: boolean };
  };
}

export interface RecordAnchorResult {
  parameters: RecordAnchorOptions & {
    pageHeight: number;
    pageWidth: number;
    referenceFontSize: number;
    alignmentTolerance: number;
    topBand: number;
    familyClustering: 'bins anchored at the smallest code left-edge (width <= alignmentTolerance), then sub-bins by matter start x (same rule); the number of families is not fixed';
    classificationRule: string;
    scoreUsed: false;
    textUsed: false;
  };
  layoutFamilies: AnchorLayoutFamily[];
  anchorAssessments: RecordAnchorAssessment[];
  diagnostics: {
    semanticRecordCandidateCount: number;
    assessmentCount: number;
    classificationCounts: Record<AnchorClassification, number>;
    stable: number;
    unstable: number;
    layoutFamilyCount: number;
    isolatedCandidateCount: number;
    evidenceKindDistribution: Record<string, number>;
    conflictCount: { blocking: number; noted: number };
    sensitivity: { scale: number; assessmentChanged: number; classificationChanged: number; familyChanged: number; layoutFamilyCount: number }[];
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const CLASSIFICATION_RULE =
  'detailSatisfied = >=2 distinct detail evidence kinds; headingSatisfied = page_relative_top AND isolated_layout AND lacks_field_structure; both => ambiguous (blocking conflict); one => that class; neither => ambiguous if any evidence else insufficient_evidence; stability = classification unchanged at the sensitivity scales';

/**
 * evidenceの種類だけから classification を再計算する（scoreを使わない純粋関数）。
 * detailSatisfied = detail側の異なるevidence種別が2種類以上 / headingSatisfied = page_relative_top かつ isolated_layout かつ lacks_field_structure。
 */
export function classifyFromEvidence(
  detailKinds: AnchorEvidenceKind[],
  headingKinds: AnchorEvidenceKind[],
): { classification: AnchorClassification; conflicts: AnchorConflict[] } {
  const d = new Set(detailKinds);
  const h = new Set(headingKinds);
  const detailSatisfied = d.size >= 2;
  const headingSatisfied = h.has('page_relative_top') && h.has('isolated_layout') && h.has('lacks_field_structure');
  const conflicts: AnchorConflict[] = [];
  if (detailSatisfied && headingSatisfied) {
    conflicts.push({ severity: 'blocking', detailEvidenceKinds: [...d], headingEvidenceKinds: [...h], note: 'detail and heading evidence are both sufficient' });
  } else if (d.size > 0 && h.size > 0) {
    conflicts.push({ severity: 'noted', detailEvidenceKinds: [...d], headingEvidenceKinds: [...h], note: 'opposing evidence is present but neither side is sufficient on its own' });
  }
  let classification: AnchorClassification;
  if (detailSatisfied && headingSatisfied) classification = 'ambiguous';
  else if (detailSatisfied) classification = 'detail_candidate';
  else if (headingSatisfied) classification = 'heading_candidate';
  else classification = d.size + h.size > 0 ? 'ambiguous' : 'insufficient_evidence';
  return { classification, conflicts };
}

interface Features {
  codeX: number;
  matterX: number;
  yMin: number;
  groupCount: number;
  rightEdges: number[] | null;
  hasSign: boolean;
  relatedStructureCount: number;
  membershipCount: number;
  unstableRelationRefs: number;
}

function featuresOf(c: SemanticRecordCandidate): Features {
  return {
    codeX: c.observations.code.bbox.xMin,
    matterX: c.observations.matter.bbox.xMin,
    yMin: c.observations.code.bbox.yMin,
    groupCount: c.amountGroups.length,
    rightEdges: c.amountGroups.length === 3 ? c.amountGroups.map(g => g.bbox.xMax) : null,
    hasSign: c.amountGroups.some(g => g.signObservation !== null),
    relatedStructureCount: c.relatedStructures.length,
    membershipCount: c.relatedStructures.filter(r => r.evidenceKind !== 'proximity').length,
    unstableRelationRefs: c.relatedStructures.reduce((n, r) => n + r.unstableRelationIndexes.length, 0),
  };
}

/** 昇順に並べ、最小値を起点に幅 tol 以内を1つのbinにする（連鎖しない） */
function anchoredBins(items: { id: number; value: number }[], tol: number): number[][] {
  const sorted = [...items].sort((a, b) => a.value - b.value || a.id - b.id);
  const bins: { start: number; ids: number[] }[] = [];
  for (const it of sorted) {
    const last = bins[bins.length - 1];
    if (last && it.value - last.start <= tol + 1e-9) last.ids.push(it.id);
    else bins.push({ start: it.value, ids: [it.id] });
  }
  return bins.map(b => b.ids);
}

/** code左端 → matter開始 の順に2段でbin化して family を作る（family数は固定しない） */
function buildFamilies(feats: Features[], tol: number): number[][] {
  const families: number[][] = [];
  for (const byCode of anchoredBins(feats.map((f, id) => ({ id, value: f.codeX })), tol)) {
    for (const byMatter of anchoredBins(byCode.map(id => ({ id, value: feats[id].matterX })), tol)) families.push([...byMatter].sort((a, b) => a - b));
  }
  return families.sort((a, b) => a[0] - b[0]);
}

interface Pass {
  classifications: AnchorClassification[];
  familyOf: number[];
  families: number[][];
  evidence: { detail: AnchorEvidence[]; heading: AnchorEvidence[]; neutral: AnchorEvidence[]; conflicts: AnchorConflict[] }[];
}

function evaluate(cands: SemanticRecordCandidate[], page: PageMeta, ref: number, options: RecordAnchorOptions, scale: number): Pass {
  const feats = cands.map(featuresOf);
  const tol = options.alignmentToleranceFactor * ref * scale;
  const topBand = options.topFraction * page.height * scale;
  const families = buildFamilies(feats, tol);
  const familyOf = new Array<number>(cands.length).fill(-1);
  families.forEach((f, fi) => f.forEach(i => (familyOf[i] = fi)));

  const evidence: Pass['evidence'] = [];
  const classifications: AnchorClassification[] = [];
  feats.forEach((f, i) => {
    const detail: AnchorEvidence[] = [];
    const heading: AnchorEvidence[] = [];
    const neutral: AnchorEvidence[] = [];
    const familySize = families[familyOf[i]].length;

    if (f.groupCount === 3) detail.push({ kind: 'three_amount_groups', supports: 'detail', measurement: { groupCount: 3 } });
    if (f.rightEdges) {
      const aligned = feats.filter((o, j) => j !== i && o.rightEdges && o.rightEdges.every((x, k) => Math.abs(x - f.rightEdges![k]) <= tol)).length;
      if (aligned > 0) detail.push({ kind: 'repeated_amount_columns', supports: 'detail', measurement: { alignedOtherCandidates: aligned }, threshold: { alignmentTolerance: round3(tol) } });
    }
    if (familySize >= options.minFamilySize) {
      detail.push({ kind: 'family_membership', supports: 'detail', measurement: { familySize }, threshold: { minFamilySize: options.minFamilySize, alignmentTolerance: round3(tol) } });
    }
    if (f.hasSign) detail.push({ kind: 'sign_token_in_amount_region', supports: 'detail', measurement: { present: true } });

    if (f.yMin <= topBand) heading.push({ kind: 'page_relative_top', supports: 'heading', measurement: { yMinFraction: round3(f.yMin / page.height) }, threshold: { topFraction: round3(options.topFraction * scale), topBand: round3(topBand) } });
    const sharesAmountColumns = detail.some(e => e.kind === 'repeated_amount_columns');
    if (familySize === 1 && !sharesAmountColumns) heading.push({ kind: 'isolated_layout', supports: 'heading', measurement: { familySize, sharesAmountColumns }, threshold: { alignmentTolerance: round3(tol) } });
    if (f.groupCount !== 3 && !f.hasSign) heading.push({ kind: 'lacks_field_structure', supports: 'heading', measurement: { amountGroupCount: f.groupCount, hasSign: false } });

    neutral.push({
      kind: 'relation_context',
      supports: 'neutral',
      measurement: { relatedStructures: f.relatedStructureCount, membershipStructures: f.membershipCount, unstableRelationRefs: f.unstableRelationRefs },
    });

    const { classification, conflicts } = classifyFromEvidence(
      detail.map(e => e.kind),
      heading.map(e => e.kind),
    );
    classifications.push(classification);
    evidence.push({ detail, heading, neutral, conflicts });
  });
  return { classifications, familyOf, families, evidence };
}

export function assessRecordAnchors(
  page: PageMeta,
  referenceFontSize: number,
  semantic: SemanticRecordResult,
  options: RecordAnchorOptions = DEFAULT_RECORD_ANCHOR_OPTIONS,
): RecordAnchorResult {
  const cands = semantic.semanticRecordCandidates;
  const base = evaluate(cands, page, referenceFontSize, options, 1);
  const others = options.sensitivityScales.map(scale => ({ scale, pass: evaluate(cands, page, referenceFontSize, options, scale) }));
  const familySignature = (p: Pass, i: number) => p.families[p.familyOf[i]].join(',');

  const assessments: RecordAnchorAssessment[] = cands.map((c, i) => {
    const reasons: string[] = [];
    for (const o of others) if (o.pass.classifications[i] !== base.classifications[i]) reasons.push(`classification_changes_at_x${o.scale}`);
    if (base.evidence[i].conflicts.some(x => x.severity === 'blocking')) reasons.push('blocking_conflict');
    return {
      assessmentIndex: i,
      semanticCandidateIndex: c.candidateIndex,
      classification: base.classifications[i],
      detailEvidence: base.evidence[i].detail,
      headingEvidence: base.evidence[i].heading,
      neutralEvidence: base.evidence[i].neutral,
      conflictingEvidence: base.evidence[i].conflicts,
      layoutFamilyIndex: base.familyOf[i],
      stability: { stable: reasons.length === 0, reasons },
      semanticCandidateStatus: c.status,
    };
  });

  const layoutFamilies: AnchorLayoutFamily[] = base.families.map((members, familyIndex) => {
    const feats = members.map(m => featuresOf(cands[m]));
    const three = feats.filter(f => f.rightEdges);
    const ranges = [0, 1, 2].map(k => [Math.min(...three.map(f => f.rightEdges![k])), Math.max(...three.map(f => f.rightEdges![k]))] as [number, number]);
    return {
      familyIndex,
      semanticCandidateIndexes: members.map(m => cands[m].candidateIndex),
      observations: {
        codeXRange: [round3(Math.min(...feats.map(f => f.codeX))), round3(Math.max(...feats.map(f => f.codeX)))],
        matterXRange: [round3(Math.min(...feats.map(f => f.matterX))), round3(Math.max(...feats.map(f => f.matterX)))],
        ...(three.length > 0
          ? {
              amountColumnPattern: {
                candidatesWithThreeGroups: three.length,
                rightEdgeRanges: ranges.map(r => [round3(r[0]), round3(r[1])] as [number, number]),
                aligned: ranges.every(r => r[1] - r[0] <= options.alignmentToleranceFactor * referenceFontSize),
              },
            }
          : {}),
      },
    };
  });

  const count = <T extends string>(xs: T[]) => xs.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const classificationCounts = { detail_candidate: 0, heading_candidate: 0, ambiguous: 0, insufficient_evidence: 0, ...count(assessments.map(a => a.classification)) } as Record<AnchorClassification, number>;
  const allEvidence = assessments.flatMap(a => [...a.detailEvidence, ...a.headingEvidence, ...a.neutralEvidence]);
  const allConflicts = assessments.flatMap(a => a.conflictingEvidence);
  return {
    parameters: {
      ...options,
      pageHeight: page.height,
      pageWidth: page.width,
      referenceFontSize,
      alignmentTolerance: round3(options.alignmentToleranceFactor * referenceFontSize),
      topBand: round3(options.topFraction * page.height),
      familyClustering: 'bins anchored at the smallest code left-edge (width <= alignmentTolerance), then sub-bins by matter start x (same rule); the number of families is not fixed',
      classificationRule: CLASSIFICATION_RULE,
      scoreUsed: false,
      textUsed: false,
    },
    layoutFamilies,
    anchorAssessments: assessments,
    diagnostics: {
      semanticRecordCandidateCount: cands.length,
      assessmentCount: assessments.length,
      classificationCounts,
      stable: assessments.filter(a => a.stability.stable).length,
      unstable: assessments.filter(a => !a.stability.stable).length,
      layoutFamilyCount: layoutFamilies.length,
      isolatedCandidateCount: layoutFamilies.filter(f => f.semanticCandidateIndexes.length === 1).length,
      evidenceKindDistribution: count(allEvidence.map(e => `${e.kind}(${e.supports})`)),
      conflictCount: { blocking: allConflicts.filter(c => c.severity === 'blocking').length, noted: allConflicts.filter(c => c.severity === 'noted').length },
      sensitivity: others.map(o => ({
        scale: o.scale,
        classificationChanged: cands.filter((_, i) => o.pass.classifications[i] !== base.classifications[i]).length,
        familyChanged: cands.filter((_, i) => familySignature(o.pass, i) !== familySignature(base, i)).length,
        assessmentChanged: cands.filter((_, i) => o.pass.classifications[i] !== base.classifications[i] || familySignature(o.pass, i) !== familySignature(base, i)).length,
        layoutFamilyCount: o.pass.families.length,
      })),
    },
  };
}
