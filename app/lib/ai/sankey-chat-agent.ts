/**
 * サンキーAIチャットのエージェントループ。
 *
 * ユーザーの自然言語要求を SankeyQuery（フィルタ条件）に翻訳する。LLM は tool calling で
 * run_sankey_query / search_projects / search_recipients を反復実行して条件を検証・調整し、
 * submit_result で確定する。確定クエリはサーバー側で再度 resolveSankeyQuery を通すため、
 * AI の生出力がそのままクライアントへ返ることはない。
 *
 * レイヤー規約: LLM 呼び出し（外部HTTP）は LlmCaller として API 層から注入される。
 * このファイル自体は fetch・NextResponse・React を含まない（ツール実行は既存 lib への委譲のみ）。
 */
import type { GraphData } from '@/types/sankey-svg';
import type { SankeyQuery } from '@/types/sankey-query';
import type { SankeyChatMessage, SankeyChatContext, SankeyChatResult } from '@/types/sankey-ai-chat';
import {
  resolveSankeyQuery,
  buildFilterExcludedIds,
  summarizeFilteredGraph,
  SANKEY_QUERY_DEFAULTS,
  TOP_PROJECT_MAX,
  TOP_RECIPIENT_MAX,
} from '@/app/lib/sankey-query';
import { searchProjects } from '@/app/lib/search/project-search';
import { searchRecipients } from '@/app/lib/search/recipient-search';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { loadQualityScores, getQualityScore, toQualityScoreProjection } from '@/app/lib/api/quality-scores-loader';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { loadRecipientIndex, resolveRecipient } from '@/app/lib/api/recipient-index-loader';
import { getProjectDetail } from '@/app/lib/api/project-details-loader';
import { loadSubcontracts } from '@/app/lib/api/subcontracts-loader';

// ── OpenAI 互換の LLM メッセージ・ツール型（OpenRouter の chat.completions と1対1） ──

export interface LlmToolCall {
  id: string;
  type?: 'function';
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** LLM 1往復。API 層が OpenRouter への fetch を包んで注入する */
export type LlmCaller = (messages: LlmMessage[], tools: LlmToolDef[]) => Promise<LlmMessage>;

export interface SankeyChatAgentResult {
  message: string;
  result?: SankeyChatResult;
  /** 次に聞ける質問の提案（最大3件）。submit_result 経由のみ（テキスト回答モードは対象外） */
  suggestions?: string[];
  toolCalls: number;
}

/** LLM 呼び出しの往復上限（1往復で複数ツールが並列に呼ばれうる。深掘りツール追加により探索が長引きうるため6→8） */
const MAX_LLM_ROUNDS = 8;
/** ツール実行回数の上限（1リクエストあたりのコスト上限を構造的に抑える。深掘りモード（search→detail→...）は往復が増えるため8→10） */
const MAX_TOOL_CALLS = 10;
/** 検索ツールが返す最大件数 */
const SEARCH_LIMIT = 10;
/** get_quality_scores に渡せる pid の上限件数 */
const QUALITY_SCORES_PID_LIMIT = 10;
/** get_recipient_detail / get_subcontract_chain が返す上位件数 */
const DETAIL_TOP_LIMIT = 10;
/** ツール応答の目安上限文字数（JSON.stringify後）。超過時は配列を段階的に間引く */
const RESPONSE_CHAR_LIMIT = 4000;
/** テキストフィールド（目的・概要等）の切り詰め文字数 */
const TEXT_FIELD_LIMIT = 600;
/** interpretation（解釈宣言）の切り詰め文字数 */
const INTERPRETATION_LIMIT = 200;
/** suggestions（深掘り提案チップ）1件あたりの切り詰め文字数 */
const SUGGESTION_LIMIT = 60;
/** suggestions の最大件数 */
const SUGGESTIONS_MAX = 3;

const GIVE_UP_MESSAGE =
  'ご要望をフィルタ条件として解釈できませんでした。「再エネ関連で予算100億円以上」「経済産業省の事業だけ」のように、事業名・支出先名・府省庁・金額範囲を含めて具体的にお試しください。';

// ── ツール定義（JSON Schema） ──

/** SankeyQuery の JSON Schema（LLM のツール引数用。types/sankey-query.ts と対応） */
const SANKEY_QUERY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    year: { type: 'string', enum: ['2024', '2025'], description: '対象年度。通常は現在表示中の年度を維持する' },
    filter: {
      type: 'object',
      description: 'どの事業・支出先を残すか（条件は AND 結合）',
      properties: {
        projectName: {
          type: 'object',
          description: '事業名フィルタ',
          properties: {
            query: { type: 'string', description: '検索文字列。regex=false なら大文字小文字無視の部分一致' },
            regex: { type: 'boolean', description: 'true なら正規表現（フラグi、128文字以内）。OR 条件は正規表現の | で表す' },
          },
          required: ['query'],
        },
        recipientName: {
          type: 'object',
          description: '支出先名フィルタ（構造は projectName と同じ）',
          properties: {
            query: { type: 'string' },
            regex: { type: 'boolean' },
          },
          required: ['query'],
        },
        ministries: {
          type: 'array',
          items: { type: 'string' },
          description: '府省庁名の完全一致リスト（いずれかに一致すれば残す）。実在する名称のみ有効',
        },
        budget: {
          type: 'object',
          description: '事業予算額の範囲（1円単位。例: 100億円 = 10000000000）',
          properties: {
            min: { type: ['number', 'null'] },
            max: { type: ['number', 'null'] },
          },
        },
        spending: {
          type: 'object',
          description: '支出先の受領額の範囲（1円単位）',
          properties: {
            min: { type: ['number', 'null'] },
            max: { type: ['number', 'null'] },
          },
        },
        accountCategories: {
          type: 'array',
          items: { type: 'string', enum: ['general', 'special', 'both', 'none'] },
          description: '含める会計区分（general=一般会計, special=特別会計, both=両方, none=区分情報なし）。省略=フィルタなし',
        },
      },
    },
    view: {
      type: 'object',
      description: 'どう見せるか（表示件数など）。ユーザーが明示しない限り省略してよい',
      properties: {
        topProject: { type: 'number', description: `事業の表示件数（1〜${TOP_PROJECT_MAX}、既定${SANKEY_QUERY_DEFAULTS.topProject}）` },
        topRecipient: { type: 'number', description: `支出先の表示件数（1〜${TOP_RECIPIENT_MAX}、既定${SANKEY_QUERY_DEFAULTS.topRecipient}）` },
        projectSortBy: { type: 'string', enum: ['budget', 'spending'], description: '事業の並び順（既定 budget）' },
        showAggProject: { type: 'boolean', description: '「その他の事業」集約ノードを表示するか（既定 true）' },
        showAggRecipient: { type: 'boolean', description: '「その他の支出先」集約ノードを表示するか（既定 true）' },
      },
    },
  },
};

const TOOLS: LlmToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'run_sankey_query',
      description:
        'SankeyQuery を実行し、マッチした事業・支出先の件数・金額・上位10件を返す。submit_result の前に必ず実行して、絞り込みの過不足（0件・多すぎ）を確認すること。',
      parameters: {
        type: 'object',
        properties: { query: SANKEY_QUERY_SCHEMA },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_projects',
      description:
        '事業名のキーワード検索（正規化部分一致）。フィルタが0件のときや、ユーザーの語彙が実際の事業名とどう対応するか調べるときに使う。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '検索キーワード' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_recipients',
      description:
        '支出先名のキーワード検索（表記ゆれを含む正規化部分一致）。支出先フィルタの語彙探索に使う。サンキー図の支出先ノード名とは表記が微妙に異なる場合があるため、フィルタには部分一致で緩めに指定するとよい。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '検索キーワード' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_detail',
      description:
        '事業の詳細（品質スコア・予算執行額・目的/現状課題/概要等のレビューシート記載内容）をpid指定で取得する。ユーザーが事業名で聞いてきた場合は先に search_projects でpidを特定すること。',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'string', description: 'search_projects / search_recipients が返す事業ID' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_quality_scores',
      description:
        `複数事業の品質スコア（軸別評価・総合値）をまとめて取得する。比較・ランキング的な質問に使う。pidsは最大${QUALITY_SCORES_PID_LIMIT}件。`,
      parameters: {
        type: 'object',
        properties: {
          pids: {
            type: 'array',
            items: { type: 'string' },
            description: `事業IDの配列（最大${QUALITY_SCORES_PID_LIMIT}件）`,
          },
        },
        required: ['pids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recipient_detail',
      description:
        '支出先の詳細（直接受領額・再委託受領額・府省庁別内訳・関与事業の上位）をkey指定で取得する。keyは search_recipients が返す corporateNumber、または名称ベースのキーを使う。',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'search_recipients が返す corporateNumber、または支出先名' } },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_subcontract_chain',
      description:
        '事業内の再委託構造（支出元→支出先の連鎖）を要約する。ブロック数・最大深度・再委託総額・金額上位の連鎖を返す。「この事業は再委託しているか」「委託の階層は深いか」といった質問に使う。',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'string', description: 'search_projects が返す事業ID' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_result',
      description:
        '検証済みの最終フィルタ条件を確定する。run_sankey_query で結果を確認してから呼ぶこと。message にはユーザー向けの短い説明（何をどう絞ったか・何件マッチしたか）を日本語で書く。',
      parameters: {
        type: 'object',
        properties: {
          query: SANKEY_QUERY_SCHEMA,
          message: { type: 'string', description: 'ユーザー向けの説明文（日本語）' },
          interpretation: {
            type: 'string',
            description:
              '曖昧語を解釈して条件化した場合のみ指定する1文（200字以内）。書式例:「『子育て』を事業名に『子育て|こども|保育』を含む事業と解釈しました」。曖昧語がない明確な要求では省略する',
          },
          suggestions: {
            type: 'array',
            items: { type: 'string' },
            description:
              `次に聞ける質問の提案（最大${SUGGESTIONS_MAX}件、各${SUGGESTION_LIMIT}字以内）。現在のツール（get_project_detail 等）で実際に答えられる問いのみ。ユーザーがそのまま送信できる短い日本語の質問文にする（例:「この中で品質スコアが低いのは?」「最大の事業の支出先は?」「再委託はある?」）。未実装機能（年度比較等）や図の適用と無関係な提案は禁止`,
          },
        },
        required: ['query', 'message'],
      },
    },
  },
];

// ── システムプロンプト ──

function buildSystemPrompt(year: SupportedYear, currentQuery: SankeyQuery | undefined, ministryNames: string[]): string {
  const lines = [
    'あなたは「まるみえRSシステム」（日本の行政事業レビューの予算・支出データをサンキー図で可視化するサイト）のフィルタ設定アシスタントです。',
    'ユーザーの自然言語の要求を SankeyQuery（フィルタ条件）に翻訳し、ツールで検証してから submit_result で確定します。',
    '',
    '## データの前提',
    `- 対象年度: ${year}（事業年度${year}のデータは予算年度${Number(year) - 1}の執行実績）`,
    '- 対象は行政事業レビュー対象事業のみ（国の全予算の約27%。国債費・地方交付税等は含まない）',
    '- 全金額は1円単位（「100億円」= 10000000000、「1兆円」= 1000000000000）',
    '- 「その他」= 支出先名が文字通り「その他」と報告された支出。「その他の支出先」= 表示件数制限による集約ノード。両者は別物',
    `- filter.ministries は完全一致。実在する府省庁名: ${ministryNames.join('、')}`,
    '',
    '## 手順',
    'このアシスタントには2つのモードがある。要求の性質を見てどちらかを選ぶ:',
    '',
    '### A. フィルタ要求（図の表示条件を変えたい）',
    '1. 要求を SankeyQuery に翻訳し run_sankey_query で実行する',
    '2. 結果を確認する: 0件なら条件を緩める（正規表現 | で類義語を足す、金額条件を外す等）。search_projects / search_recipients で実際の語彙を調べてもよい。多すぎるなら金額下限などで絞る',
    '3. 妥当な結果になったら submit_result で確定する（message に何をどう絞って何件マッチしたかを書く）',
    '- 表示件数や並び順の要望（「上位5件だけ」等）は view で表現できる。ユーザーが言及しない限り view は省略する',
    '',
    '### B. データへの質問（金額・内訳・品質スコア・再委託構造等を知りたい）',
    '- get_project_detail / get_quality_scores / get_recipient_detail / get_subcontract_chain で調べ、結果をテキストで日本語回答する。submit_result は呼ばない（図の条件は変わらない）',
    '- 数値・事実は必ずツール応答から転記する。ツールで確認していない数値を推測で書かない',
    '- pid はユーザーには分からない前提。事業名から聞かれたら、まず search_projects でpidを特定してから深掘りツールを呼ぶ。支出先も同様に search_recipients でキーを特定する',
    '- 品質スコアについて回答する際の語彙規律: スコアは「事業レビューシートに書かれた説明の質（支出先の特定可能性・使途の説明性・成果設計の明確さ等）」を評価したものであり、事業そのものの善悪・要不要・無駄の有無を判定するものではない。「この事業は無駄」のような断定はせず、「レビューシートの記載としては〜」のように表現する',
    '- ツール実行に失敗した・データが見つからない場合はその旨を正直に伝える（存在しないふりをしない）',
    '',
    '### 共通',
    '- 要求がこのデータのフィルタ条件にもデータ質問にも該当しない場合（雑談・データにない切り口等）は、ツールを呼ばずに、解釈できなかった旨と指定できる条件・質問の例を日本語のテキストで返す',
    '- **フィルタで表現できない絞り込み条件に注意**: SankeyQuery のフィルタは事業名・支出先名・府省庁・金額範囲・会計区分のみ。「再委託がある事業だけ」「品質スコアが低い事業だけ」「使途が広報の事業だけ」のような条件はフィルタとして表現できない。この場合はツールで試行錯誤せず、フィルタにできない旨と代替（個別事業なら get_subcontract_chain 等で調べられること）をすぐテキストで案内する',
    '- 条件が曖昧でも合理的な解釈が1つ選べるなら聞き返さずに進める（フィルタはユーザーが適用前に件数を確認できる）',
    '- 応答はすべて日本語で書く',
    '',
    '## 解釈宣言（submit_result の interpretation）',
    '「子育て」「大型」「〜っぽい」のような曖昧語をAIが解釈して条件化した場合は、submit_result の interpretation に',
    '「『子育て』を事業名に『子育て|こども|保育』を含む事業と解釈しました」のような形式で必ず宣言し、ユーザーが解釈のズレを確認・修正できるようにする。',
    '曖昧語を含まない明確な要求（府省庁名・金額範囲・具体的な事業名等がそのまま条件になる場合）では interpretation は省略してよい。',
    '',
    '## 深掘り提案（submit_result の suggestions）',
    'suggestions には、現在のツール（get_project_detail / get_quality_scores / get_recipient_detail / get_subcontract_chain）で実際に答えられる問いのみを、',
    'ユーザーがそのまま送信できる短い日本語の質問文として最大3件挙げる（例:「この中で品質スコアが低いのは?」「最大の事業の支出先は?」「再委託はある?」）。',
    '図の適用と無関係な提案や、このアシスタントが答えられない提案（年度比較等の未実装機能）は挙げないこと。',
  ];
  const compactQuery = currentQuery ? compactValue(currentQuery) : undefined;
  if (compactQuery !== undefined) {
    lines.push(
      '',
      '## 現在ページに適用中の条件',
      '「今の条件に追加して」「さらに絞って」のような差分指示はこの条件をベースに組み立てる:',
      JSON.stringify(compactQuery),
    );
  }
  return lines.join('\n');
}

/**
 * プロンプト埋め込み用に null / undefined / 空オブジェクト・空配列を再帰的に除去する。
 * URL復元由来の currentQuery は未指定フィールドを null で持つことがあり（例: view.pin の
 * projectId: null）、null を含む JSON をシステムプロンプトに埋め込むと一部プロバイダ
 * （hy3:free/Novita）で応答生成が壊れる事象が再現したため、意味のある値だけを渡す。
 */
function compactValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter(v => v !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, compactValue(v)] as const)
      .filter(([, v]) => v !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

// ── ツール実行 ──

function parseToolArgs(raw: string): { args?: Record<string, unknown>; error?: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'ツール引数はJSONオブジェクトで指定してください' };
    }
    return { args: parsed as Record<string, unknown> };
  } catch (e) {
    return { error: `ツール引数のJSONが不正です: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** クエリを検証・実行してサマリを返す。errors があれば summary は付かない */
function executeQuery(input: SankeyQuery, defaultYear: SupportedYear): {
  errors?: string[];
  result?: SankeyChatResult;
} {
  const withYear: SankeyQuery = { ...input, year: input.year ?? defaultYear };
  const { query, errors } = resolveSankeyQuery(withYear);
  if (errors.length > 0) return { errors };
  const graph: GraphData = loadSankeyGraph(query.year);
  const excludedIds = buildFilterExcludedIds(graph.nodes, graph.edges, query.filter, [query.view.pin.projectId]);
  const summary = summarizeFilteredGraph(graph.nodes, graph.edges, excludedIds);
  return { result: { query, summary } };
}

/** 長文フィールドを既定文字数で切り詰める（末尾に「…」） */
function clampText(s: string | null | undefined, limit: number = TEXT_FIELD_LIMIT): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  return t.length <= limit ? t : `${t.slice(0, limit)}…`;
}

/** submit_result の interpretation を検証・クランプする（未指定・空文字は undefined） */
function clampInterpretation(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.length <= INTERPRETATION_LIMIT ? t : `${t.slice(0, INTERPRETATION_LIMIT)}…`;
}

/** submit_result の suggestions を検証・クランプする（string以外・空文字は除去、最大3件・各60字） */
function clampSuggestions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => (s.length <= SUGGESTION_LIMIT ? s : `${s.slice(0, SUGGESTION_LIMIT)}…`))
    .slice(0, SUGGESTIONS_MAX);
  return items.length > 0 ? items : undefined;
}

/**
 * JSON.stringify後の文字数が目安上限を超える場合、指定した配列フィールドを
 * 半分ずつ間引いて再試行する安全策（テキスト側は既に clampText 済みの前提）。
 */
function clampPayload<T extends Record<string, unknown>>(payload: T, arrayKeys: (keyof T)[]): T {
  let current = payload;
  for (let i = 0; i < 5; i++) {
    if (JSON.stringify(current).length <= RESPONSE_CHAR_LIMIT) return current;
    let shrunk = false;
    for (const key of arrayKeys) {
      const arr = current[key];
      if (Array.isArray(arr) && arr.length > 1) {
        current = { ...current, [key]: arr.slice(0, Math.max(1, Math.ceil(arr.length / 2))) };
        shrunk = true;
        break;
      }
    }
    if (!shrunk) break;
  }
  return current;
}

function executeGetProjectDetail(year: SupportedYear, pid: string): unknown {
  const score = getQualityScore(year, pid);
  const detail = getProjectDetail(year, pid);
  if (!score && !detail) {
    return { error: `pid=${pid} の事業が見つかりません`, hint: 'search_projects で事業名からpidを特定してください' };
  }
  return {
    pid,
    name: score?.name ?? detail?.projectName ?? null,
    ministry: score?.ministry ?? detail?.ministry ?? null,
    bureau: score?.bureau ?? detail?.bureau ?? null,
    budgetAmount: score?.budgetAmount ?? null,
    execAmount: score?.execAmount ?? null,
    spendTotal: score?.spendTotal ?? null,
    totalScore: score?.totalScore ?? null,
    category: detail?.category ?? null,
    startYear: detail?.startYear ?? null,
    endYear: detail?.endYear ?? null,
    majorExpense: detail?.majorExpense ?? null,
    implementationMethods: detail?.implementationMethods ?? null,
    purpose: clampText(detail?.purpose),
    currentIssues: clampText(detail?.currentIssues),
    overview: clampText(detail?.overview),
  };
}

function executeGetQualityScores(year: SupportedYear, pidsRaw: unknown): unknown {
  if (!Array.isArray(pidsRaw) || pidsRaw.length === 0) {
    return { error: 'pids（事業IDの配列）を指定してください' };
  }
  const pids = pidsRaw.filter((p): p is string => typeof p === 'string');
  const truncated = pids.length > QUALITY_SCORES_PID_LIMIT;
  const targets = pids.slice(0, QUALITY_SCORES_PID_LIMIT);
  const items = targets.map(pid => {
    const score = getQualityScore(year, pid);
    return score ? toQualityScoreProjection(score) : { pid, error: '見つかりません' };
  });
  const payload: { items: unknown[]; notice?: string } = { items };
  if (truncated) {
    payload.notice = `pidsは最大${QUALITY_SCORES_PID_LIMIT}件です。先頭${QUALITY_SCORES_PID_LIMIT}件のみ処理しました`;
  }
  return clampPayload(payload, ['items']);
}

function executeGetRecipientDetail(year: SupportedYear, key: string): unknown {
  const entry = resolveRecipient(year, key);
  if (!entry) {
    return { error: `key=${key} の支出先が見つかりません`, hint: 'search_recipients で名称からキー（corporateNumber等）を特定してください' };
  }
  const topAppearances = [...entry.appearances]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, DETAIL_TOP_LIMIT)
    .map(a => ({
      pid: a.pid,
      projectName: a.projectName,
      ministry: a.ministry,
      blockId: a.blockId,
      originKind: a.originKind,
      amount: a.amount,
    }));
  return clampPayload(
    {
      key: entry.key,
      name: entry.name,
      corporateNumber: entry.corporateNumber,
      totals: entry.totals,
      byMinistry: entry.byMinistry,
      appearanceCount: entry.appearances.length,
      topAppearances,
    },
    ['byMinistry', 'topAppearances'],
  );
}

function executeGetSubcontractChain(year: SupportedYear, pid: string): unknown {
  const index = loadSubcontracts(year);
  const graph = index?.[pid];
  if (!graph) {
    return {
      error: `pid=${pid} の再委託データが見つかりません`,
      hint: '再委託の記載がない事業（直接支出のみ）の可能性があります。search_projects でpidを確認してください',
    };
  }
  const blockMap = new Map(graph.blocks.map(b => [b.blockId, b]));
  // 再委託総額: 同一支出先が複数ブロックに出現しうるため（既知の注意事項）find ではなく filter+reduce で合算する
  const subcontractTotal = graph.blocks
    .filter(b => b.originKind === 'subcontract')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const topChains = graph.flows
    .map(flow => {
      const sourceBlock = flow.sourceBlock ? blockMap.get(flow.sourceBlock) : null;
      const targetBlock = blockMap.get(flow.targetBlock);
      return {
        from: sourceBlock?.blockName ?? '(事業本体)',
        to: targetBlock?.blockName ?? flow.targetBlock,
        amount: targetBlock?.totalAmount ?? 0,
        origin: flow.origin,
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, DETAIL_TOP_LIMIT);
  return clampPayload(
    {
      pid,
      projectName: graph.projectName,
      totalBlockCount: graph.totalBlockCount,
      directBlockCount: graph.directBlockCount,
      maxDepth: graph.maxDepth,
      totalRecipientCount: graph.totalRecipientCount,
      subcontractTotal,
      hasSeparateOrigin: graph.hasSeparateOrigin,
      topChains,
    },
    ['topChains'],
  );
}

function executeSearchProjects(year: SupportedYear, q: string): unknown {
  const { items: allItems } = loadQualityScores(year);
  const { totalHits, items } = searchProjects(allItems, q, { limit: SEARCH_LIMIT, offset: 0, sortBy: 'budget' });
  return {
    totalHits,
    items: items.map(({ item: i }) => ({
      pid: i.pid,
      name: i.name,
      ministry: i.ministry,
      budgetAmount: i.budgetAmount,
      spendTotal: i.spendTotal,
    })),
  };
}

function executeSearchRecipients(year: SupportedYear, q: string): unknown {
  const index = loadRecipientIndex(year);
  const { totalHits, items } = searchRecipients(index.recipients, q, SEARCH_LIMIT);
  return {
    totalHits,
    items: items.map(e => ({
      name: e.name,
      corporateNumber: e.corporateNumber,
      directAmount: e.totals.directAmount,
      subcontractAmount: e.totals.subcontractAmount,
    })),
  };
}

// ── エージェントループ本体 ──

export async function runSankeyChatAgent(
  chatMessages: SankeyChatMessage[],
  context: SankeyChatContext,
  callLlm: LlmCaller,
): Promise<SankeyChatAgentResult> {
  const year: SupportedYear = context.year ?? SANKEY_QUERY_DEFAULTS.year;
  const graph = loadSankeyGraph(year);
  const ministryNames = [...new Set(
    graph.nodes.filter(n => n.type === 'ministry' && !n.aggregated).map(n => n.name),
  )].sort();

  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(year, context.currentQuery, ministryNames) },
    ...chatMessages.map((m): LlmMessage => ({ role: m.role, content: m.content })),
  ];

  let toolCalls = 0;
  for (let round = 0; round < MAX_LLM_ROUNDS; round++) {
    const assistant = await callLlm(messages, TOOLS);
    messages.push(assistant);
    const calls = assistant.tool_calls ?? [];

    // ツールなしのテキスト応答 = 聞き返し or 解釈不能の返答として終了
    if (calls.length === 0) {
      const text = (assistant.content ?? '').trim();
      return { message: text || GIVE_UP_MESSAGE, toolCalls };
    }

    for (const call of calls) {
      toolCalls++;
      let payload: unknown;

      if (toolCalls > MAX_TOOL_CALLS) {
        payload = { error: 'ツール呼び出し回数の上限に達しました。これ以上の検証はできません。現時点で確定できないならテキストでその旨を返答してください' };
      } else {
        const { args, error } = parseToolArgs(call.function.arguments || '{}');
        if (error || !args) {
          payload = { error: error ?? 'ツール引数を解釈できませんでした' };
        } else {
          switch (call.function.name) {
            case 'run_sankey_query': {
              const { errors, result } = executeQuery((args.query ?? args) as SankeyQuery, year);
              payload = errors
                ? { errors }
                : { appliedQuery: result!.query, summary: result!.summary };
              break;
            }
            case 'search_projects':
            case 'search_recipients': {
              const q = typeof args.q === 'string' ? args.q.trim() : '';
              if (!q) {
                payload = { error: 'q（検索キーワード）を指定してください' };
              } else if (call.function.name === 'search_projects') {
                payload = executeSearchProjects(year, q);
              } else {
                payload = executeSearchRecipients(year, q);
              }
              break;
            }
            case 'get_project_detail': {
              const pid = typeof args.pid === 'string' ? args.pid.trim() : '';
              payload = pid ? executeGetProjectDetail(year, pid) : { error: 'pid（事業ID）を指定してください' };
              break;
            }
            case 'get_quality_scores': {
              payload = executeGetQualityScores(year, args.pids);
              break;
            }
            case 'get_recipient_detail': {
              const key = typeof args.key === 'string' ? args.key.trim() : '';
              payload = key ? executeGetRecipientDetail(year, key) : { error: 'key（支出先キー）を指定してください' };
              break;
            }
            case 'get_subcontract_chain': {
              const pid = typeof args.pid === 'string' ? args.pid.trim() : '';
              payload = pid ? executeGetSubcontractChain(year, pid) : { error: 'pid（事業ID）を指定してください' };
              break;
            }
            case 'submit_result': {
              const { errors, result } = executeQuery((args.query ?? {}) as SankeyQuery, year);
              if (errors) {
                payload = { errors, hint: 'クエリを修正して run_sankey_query で再検証してから submit_result してください' };
                break;
              }
              const message = typeof args.message === 'string' && args.message.trim()
                ? args.message.trim()
                : `${result!.summary.projects.count}事業がマッチしました。`;
              const interpretation = clampInterpretation(args.interpretation);
              const suggestions = clampSuggestions(args.suggestions);
              return {
                message,
                result: interpretation ? { ...result!, interpretation } : result!,
                ...(suggestions ? { suggestions } : {}),
                toolCalls,
              };
            }
            default:
              payload = { error: `未知のツールです: ${call.function.name}` };
          }
        }
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) });
    }
  }

  // 往復上限まで確定しなかった: ユーザー決定事項により「解釈できなかった」旨の返信で終える
  return { message: GIVE_UP_MESSAGE, toolCalls };
}
