import type { CSSProperties, ReactNode } from 'react';
import { SEMANTIC_PROJECT_DEEP } from '@/app/lib/semantic-colors';

/**
 * 意味タグの共有プリミティブ。メインSankey（/sankey-svg）と再委託ビュー（/subcontracts）で
 * 同じ意味には同じ見た目のピルを出すために使う。配色は semantic-colors.ts に対応する。
 *
 * - project: 事業（濃緑ソリッド＋白文字。ヘッダの識別タグ）
 * - direct / subcontract / separate-origin: 意味色のソフト配色（淡い背景＋濃い文字）
 * - neutral: 非意味（移替・参考・集計など）はグレー
 *
 * 色単独判別に依存させないため、必ず label に意味語（直接/再委託/別財源 等）を含めること。
 */
export type TagKind = 'project' | 'direct' | 'subcontract' | 'separate-origin' | 'neutral';

const SOFT: Record<Exclude<TagKind, 'project'>, { bg: string; fg: string }> = {
  direct: { bg: '#f9dddd', fg: '#b33434' },
  subcontract: { bg: '#faedcf', fg: '#a06c14' },
  'separate-origin': { bg: '#ece5f5', fg: '#5b4483' },
  neutral: { bg: '#f1f5f9', fg: '#475569' },
};

/** kind に対応する {bg, fg} を返す（SVG など span を使えない場所向け）。 */
export function tagChipColors(kind: TagKind): { bg: string; fg: string } {
  return kind === 'project' ? { bg: SEMANTIC_PROJECT_DEEP, fg: '#fff' } : SOFT[kind];
}

export function TagChip({
  kind,
  children,
  fontSize = 10,
  style,
}: {
  kind: TagKind;
  children: ReactNode;
  /** 呼び出し側のフォントスケールに合わせる（既定10px） */
  fontSize?: number;
  style?: CSSProperties;
}) {
  const { bg, fg } = tagChipColors(kind);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        fontWeight: 700,
        padding: '1px 7px',
        fontSize,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        background: bg,
        color: fg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
