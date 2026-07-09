#!/usr/bin/env node
/**
 * AIチャット（POST /api/ai/sankey-chat）の応答品質を反復評価するための開発用ハーネス。
 *
 * scripts/dev/ai-chat-eval-prompts.json の代表シナリオを順に投げ、
 * message / result有無 / toolCalls / レイテンシを記録して markdown テーブルで出力する。
 *
 * Usage:
 *   npm run dev  # 別ターミナルで localhost:3000 を起動しておく（OPENROUTER_API_KEY 必須）
 *   node scripts/dev/ai-chat-eval.mjs [--only <id>] [--out <path>]
 *   BASE_URL=http://localhost:3001 node scripts/dev/ai-chat-eval.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { only: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function runScenario(baseUrl, scenario) {
  const history = [];
  const rows = [];
  for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex++) {
    const userText = scenario.turns[turnIndex];
    history.push({ role: 'user', content: userText });

    const started = Date.now();
    let status = null;
    let body = null;
    let errorText = null;
    try {
      const res = await fetch(`${baseUrl}/api/ai/sankey-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      status = res.status;
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        errorText = text.slice(0, 300);
      }
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = Date.now() - started;

    if (status === 404) {
      throw new Error(
        'API が 404 を返しました（AIチャットが無効な環境の可能性）。' +
          '.env.local の OPENROUTER_API_KEY と SANKEY_AI_CHAT_ENABLED を確認してください。',
      );
    }

    const message = body?.message ?? errorText ?? '(応答なし)';
    const hasResult = Boolean(body?.result);
    const projectCount = body?.result?.summary?.projects?.count;
    const toolCalls = body?.usage?.toolCalls ?? '-';
    const model = body?.usage?.model ?? '-';

    rows.push({
      id: scenario.id,
      model,
      turn: turnIndex + 1,
      userText: truncate(userText, 60),
      message: truncate(message, 200),
      hasResult,
      projectCount: hasResult && typeof projectCount === 'number' ? projectCount : '-',
      toolCalls,
      latencyMs,
      status: status ?? 'ERR',
    });

    if (body?.message) {
      history.push({ role: 'assistant', content: body.message });
    } else {
      // これ以降のターンを送っても意味が薄いので打ち切る
      break;
    }
  }
  return rows;
}

function toMarkdownTable(rows) {
  const header = '| id | model | turn | user | result | count | toolCalls | ms | status | message |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    `| ${escapeCell(r.id)} | ${escapeCell(r.model)} | ${r.turn} | ${escapeCell(r.userText)} | ${r.hasResult ? 'yes' : 'no'} | ${r.projectCount} | ${r.toolCalls} | ${r.latencyMs} | ${r.status} | ${escapeCell(r.message)} |`,
  );
  return [header, sep, ...body].join('\n');
}

async function main() {
  const { only, out } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const promptsPath = path.join(__dirname, 'ai-chat-eval-prompts.json');
  const scenarios = JSON.parse(readFileSync(promptsPath, 'utf-8'));
  const targets = only ? scenarios.filter((s) => s.id === only) : scenarios;

  if (targets.length === 0) {
    console.error(`シナリオが見つかりません: --only ${only}`);
    process.exit(1);
  }

  console.error(`[ai-chat-eval] ${targets.length}件のシナリオを ${baseUrl} に送信します...`);

  const allRows = [];
  for (const scenario of targets) {
    try {
      const rows = await runScenario(baseUrl, scenario);
      allRows.push(...rows);
    } catch (e) {
      console.error(`[ai-chat-eval] シナリオ "${scenario.id}" でエラー: ${e.message}`);
      process.exit(1);
    }
  }

  const table = toMarkdownTable(allRows);
  console.log(table);

  if (out) {
    writeFileSync(out, `${table}\n`, 'utf-8');
    console.error(`[ai-chat-eval] 結果を書き込みました: ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
