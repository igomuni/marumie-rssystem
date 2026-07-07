import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { runSankeyChatAgent, type LlmMessage, type LlmToolDef } from '@/app/lib/ai/sankey-chat-agent';
import { serverErrorResponse } from '@/app/lib/api/api-notes';
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TOTAL_CHARS,
  type SankeyChatContext,
  type SankeyChatMessage,
  type SankeyChatRequest,
  type SankeyChatResponse,
} from '@/types/sankey-ai-chat';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** 品質スコア（scripts/score-project-quality-ai.py）と同じ既定モデル */
const DEFAULT_MODEL = 'google/gemini-3.5-flash';
/** LLM 1呼び出しのタイムアウト */
const LLM_TIMEOUT_MS = 30_000;

/** OpenRouter 側の失敗（HTTPエラー・タイムアウト・応答形式不正）。502 に丸める */
class LlmUpstreamError extends Error {}

/**
 * ローカル実験フェーズの本番抑制ガード（/api/sankey/query の isQueryApiEnabled と同型）。
 * LLM 呼び出しは従量課金のため、公開時はレートリミット等と入れ替えるまで Vercel 上では
 * 機能・理由を一切明かさない素の 404 を返す。判定は偽装不能な環境変数で行う。
 * 加えて OPENROUTER_API_KEY が無い環境では常に無効（キーなしでは機能しないため）。
 */
function isAiChatEnabled(): boolean {
  if (!process.env.OPENROUTER_API_KEY) return false;
  if (process.env.SANKEY_AI_CHAT_ENABLED === '1') return true;
  if (process.env.VERCEL === '1') return false; // Vercel 上は既定で無効
  return process.env.NODE_ENV !== 'production'; // ローカルでも production ビルドは既定無効
}

function chatModel(): string {
  return process.env.SANKEY_AI_CHAT_MODEL || DEFAULT_MODEL;
}

/** チャットパネルの表示可否をクライアントが判定するための疎通エンドポイント */
export async function GET() {
  if (!isAiChatEnabled()) notFound();
  return NextResponse.json({ enabled: true, model: chatModel() });
}

function validateMessages(input: unknown): { messages?: SankeyChatMessage[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'messages は1件以上の配列で指定してください' };
  }
  if (input.length > MAX_CHAT_MESSAGES) {
    return { error: `messages は直近${MAX_CHAT_MESSAGES}件以内で送信してください（受領件数: ${input.length}）` };
  }
  const messages: SankeyChatMessage[] = [];
  let totalChars = 0;
  for (const m of input) {
    const role = (m as SankeyChatMessage)?.role;
    const content = (m as SankeyChatMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return { error: 'messages の各要素は { role: "user" | "assistant", content: string } で指定してください' };
    }
    totalChars += content.length;
    messages.push({ role, content });
  }
  if (totalChars > MAX_CHAT_TOTAL_CHARS) {
    return { error: `messages の合計文字数が上限（${MAX_CHAT_TOTAL_CHARS}字）を超えています` };
  }
  if (messages[messages.length - 1].role !== 'user') {
    return { error: 'messages の末尾は user メッセージにしてください' };
  }
  return { messages };
}

function validateContext(input: unknown): SankeyChatContext {
  const context: SankeyChatContext = {};
  if (input === null || typeof input !== 'object') return context;
  const raw = input as SankeyChatContext;
  if (raw.year === '2024' || raw.year === '2025') context.year = raw.year;
  if (raw.currentQuery !== null && typeof raw.currentQuery === 'object' && !Array.isArray(raw.currentQuery)) {
    context.currentQuery = raw.currentQuery;
  }
  return context;
}

export async function POST(req: Request) {
  if (!isAiChatEnabled()) notFound();
  try {
    let body: SankeyChatRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'リクエストボディのJSONが不正です' }, { status: 400 });
    }

    const { messages, error } = validateMessages(body?.messages);
    if (error || !messages) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const context = validateContext(body?.context);

    const model = chatModel();
    const apiKey = process.env.OPENROUTER_API_KEY!;
    const callLlm = async (llmMessages: LlmMessage[], tools: LlmToolDef[]): Promise<LlmMessage> => {
      let res: Response;
      try {
        res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: llmMessages,
            tools,
            tool_choice: 'auto',
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });
      } catch (e) {
        throw new LlmUpstreamError(`OpenRouter への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 500);
        throw new LlmUpstreamError(`OpenRouter HTTP ${res.status}: ${detail}`);
      }
      const data = await res.json().catch(() => null) as { choices?: { message?: LlmMessage }[] } | null;
      const message = data?.choices?.[0]?.message;
      if (!message) throw new LlmUpstreamError('OpenRouter 応答に choices[0].message がありません');
      return message;
    };

    let agentResult;
    try {
      agentResult = await runSankeyChatAgent(messages, context, callLlm);
    } catch (e) {
      if (e instanceof LlmUpstreamError || (e instanceof Error && e.name === 'TimeoutError')) {
        console.error('[ai/sankey-chat] upstream error:', e);
        return NextResponse.json(
          { error: 'AIが応答できませんでした。時間をおいて再度お試しください' },
          { status: 502 },
        );
      }
      throw e;
    }

    const response: SankeyChatResponse = {
      message: agentResult.message,
      ...(agentResult.result ? { result: agentResult.result } : {}),
      usage: { model, toolCalls: agentResult.toolCalls },
    };
    // チャット応答はキャッシュ不可
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverErrorResponse('ai/sankey-chat', e);
  }
}
