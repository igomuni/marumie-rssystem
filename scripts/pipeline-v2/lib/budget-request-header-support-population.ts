/**
 * P4（secondary）の population identity。frozen の前研究結果（B4 の cluster relation と T4 の support effect）から cluster を列挙するだけで、
 * feature の構成には使わない。protocol: docs/tasks/20261005_1815_Budget_Request_Header_Support_Provenance_Isolation_Protocol.md
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';

const FRAME_TRANSITION = 'tests/fixtures/budget-request-level-frame-table-eligibility/2024/phaseB-frame-transition.json.gz';

const FRAME_TRANSITION_SHA = '8ac8f21deb22528d1c930663667617112bd6fb92b286a31f6f0b4db7d8c106ab';

/** frozen の frame 遷移 row: [pdf, clusterIndex, xMin, level, memberCount, B 関係, support 数, eligible 数, effect, category, descendants] */
export function p4ClusterKeys(): Set<string> {
  const bytes = fs.readFileSync(FRAME_TRANSITION);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== FRAME_TRANSITION_SHA) throw new Error('frozen frame transition の hash 不一致（STOP）');
  const rows = JSON.parse(zlib.gunzipSync(bytes).toString('utf8')) as unknown[][];
  const keys = new Set<string>();
  for (const r of rows) if (r[1] !== 'new' && r[5] === 'B4_c0_unassigned_only' && r[8] === 'support_maintained') keys.add(`${r[0]}|${r[1]}`);
  return keys;
}
