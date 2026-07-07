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
import { loadQualityScores } from '@/app/lib/api/quality-scores-loader';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { loadRecipientIndex } from '@/app/lib/api/recipient-index-loader';

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
  toolCalls: number;
}

/** LLM 呼び出しの往復上限（1往復で複数ツールが並列に呼ばれうる） */
const MAX_LLM_ROUNDS = 6;
/** ツール実行回数の上限（1リクエストあたりのコスト上限を構造的に抑える） */
const MAX_TOOL_CALLS = 8;
/** 検索ツールが返す最大件数 */
const SEARCH_LIMIT = 10;

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
      name: 'submit_result',
      description:
        '検証済みの最終フィルタ条件を確定する。run_sankey_query で結果を確認してから呼ぶこと。message にはユーザー向けの短い説明（何をどう絞ったか・何件マッチしたか）を日本語で書く。',
      parameters: {
        type: 'object',
        properties: {
          query: SANKEY_QUERY_SCHEMA,
          message: { type: 'string', description: 'ユーザー向けの説明文（日本語）' },
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
    '1. 要求を SankeyQuery に翻訳し run_sankey_query で実行する',
    '2. 結果を確認する: 0件なら条件を緩める（正規表現 | で類義語を足す、金額条件を外す等）。search_projects / search_recipients で実際の語彙を調べてもよい。多すぎるなら金額下限などで絞る',
    '3. 妥当な結果になったら submit_result で確定する（message に何をどう絞って何件マッチしたかを書く）',
    '- 表示件数や並び順の要望（「上位5件だけ」等）は view で表現できる。ユーザーが言及しない限り view は省略する',
    '- 要求がこのデータのフィルタ条件として解釈できない場合（雑談・データにない切り口等）は、ツールを呼ばずに、解釈できなかった旨と指定できる条件の例を日本語のテキストで返す',
    '- 条件が曖昧でも合理的な解釈が1つ選べるなら聞き返さずに進める（ユーザーは適用前に件数を確認できる）',
    '- 応答はすべて日本語で書く',
  ];
  if (currentQuery && Object.keys(currentQuery).length > 0) {
    lines.push(
      '',
      '## 現在ページに適用中の条件',
      '「今の条件に追加して」「さらに絞って」のような差分指示はこの条件をベースに組み立てる:',
      JSON.stringify(currentQuery),
    );
  }
  return lines.join('\n');
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

function executeSearchProjects(year: SupportedYear, q: string): unknown {
  const { items: allItems } = loadQualityScores(year);
  const { totalHits, items } = searchProjects(allItems, q, { limit: SEARCH_LIMIT, offset: 0, sortBy: 'budget' });
  return {
    totalHits,
    items: items.map(i => ({
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
            case 'submit_result': {
              const { errors, result } = executeQuery((args.query ?? {}) as SankeyQuery, year);
              if (errors) {
                payload = { errors, hint: 'クエリを修正して run_sankey_query で再検証してから submit_result してください' };
                break;
              }
              const message = typeof args.message === 'string' && args.message.trim()
                ? args.message.trim()
                : `${result!.summary.projects.count}事業がマッチしました。`;
              return { message, result: result!, toolCalls };
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
