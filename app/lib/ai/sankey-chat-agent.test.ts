import { describe, it, expect, vi } from 'vitest';

// runSankeyChatAgent calls loadSankeyGraph(year) directly (module-level import, not injected),
// so we mock the loader module to avoid touching public/data/*.json fixtures. All three scenarios
// below only ever reach loadSankeyGraph (via the initial ministryNames lookup and/or
// executeQuery/run_sankey_query/submit_result), so this single mock is sufficient — the other
// loaders (quality-scores, recipient-index, project-details, subcontracts, highlights) are never
// invoked because the mocked LLM never calls search_projects/get_project_detail/etc.
// vi.mock factories are hoisted above imports, so the fixture must be built with vi.hoisted().
const fixtureGraph = vi.hoisted(() => ({
  metadata: {
    totalBudget: 0,
    totalSpending: 0,
    directSpending: 0,
    indirectSpending: 0,
    ministryCount: 1,
    projectCount: 0,
    recipientCount: 0,
  },
  nodes: [
    { id: 'ministry-A省', name: 'A省', type: 'ministry', value: 0 },
  ],
  edges: [],
}));

vi.mock('@/app/lib/api/sankey-graph-loader', () => ({
  loadSankeyGraph: vi.fn(() => fixtureGraph),
}));

const { runSankeyChatAgent } = await import('@/app/lib/ai/sankey-chat-agent');
// Mirrors the unexported MAX_TOOL_CALLS constant in sankey-chat-agent.ts. Per the task spec we
// must not export internal helpers just to test them, so this is duplicated here deliberately.
const MAX_TOOL_CALLS_FOR_TEST = 10;

import type { LlmCaller, LlmMessage } from '@/app/lib/ai/sankey-chat-agent';

describe('runSankeyChatAgent', () => {
  it('(a) a plain-text response with no tool_calls ends the run immediately', async () => {
    const callLlm: LlmCaller = vi.fn(async (): Promise<LlmMessage> => ({
      role: 'assistant',
      content: 'これはフィルタ条件ではなく雑談的な質問ですね。',
    }));

    const result = await runSankeyChatAgent([{ role: 'user', content: 'こんにちは' }], { year: '2024' }, callLlm);

    expect(result.message).toBe('これはフィルタ条件ではなく雑談的な質問ですね。');
    expect(result.result).toBeUndefined();
    expect(result.toolCalls).toBe(0);
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('(b) a submit_result tool call finalizes the run with a query + summary', async () => {
    const callLlm: LlmCaller = vi.fn(async (): Promise<LlmMessage> => ({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'submit_result',
            arguments: JSON.stringify({ query: { year: '2024' }, message: 'デジタル庁の事業に絞り込みました。' }),
          },
        },
      ],
    }));

    const result = await runSankeyChatAgent([{ role: 'user', content: 'デジタル庁だけ見せて' }], { year: '2024' }, callLlm);

    expect(result.message).toBe('デジタル庁の事業に絞り込みました。');
    expect(result.result).toBeDefined();
    expect(result.result?.query.year).toBe('2024');
    expect(result.result?.summary).toBeDefined();
    expect(result.toolCalls).toBe(1);
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('(c) exceeding the tool-call budget yields an error payload for the overflow calls and the run eventually gives up', async () => {
    let round = 0;
    const callLlm: LlmCaller = vi.fn(async (): Promise<LlmMessage> => {
      round++;
      if (round === 1) {
        // Emit more tool calls in a single round than MAX_TOOL_CALLS (10) allows.
        return {
          role: 'assistant',
          content: null,
          tool_calls: Array.from({ length: MAX_TOOL_CALLS_FOR_TEST + 2 }, (_, i) => ({
            id: `call-${i}`,
            type: 'function' as const,
            function: { name: 'run_sankey_query', arguments: JSON.stringify({ query: {} }) },
          })),
        };
      }
      // Subsequent round: end with plain text so the loop terminates deterministically.
      return { role: 'assistant', content: '今回はここまでにします。' };
    });

    const result = await runSankeyChatAgent([{ role: 'user', content: '絞り込んで' }], { year: '2024' }, callLlm);

    expect(result.toolCalls).toBe(MAX_TOOL_CALLS_FOR_TEST + 2);
    expect(result.message).toBe('今回はここまでにします。');
    // Verify at least one overflow call actually received the budget-exceeded error payload
    // by inspecting the tool messages fed back to the LLM on the second round.
    const secondRoundCallArgs = (callLlm as ReturnType<typeof vi.fn>).mock.calls[1][0] as LlmMessage[];
    const toolMessages = secondRoundCallArgs.filter(m => m.role === 'tool');
    expect(toolMessages).toHaveLength(MAX_TOOL_CALLS_FOR_TEST + 2);
    const overflowPayloads = toolMessages.slice(MAX_TOOL_CALLS_FOR_TEST).map(m => JSON.parse(m.content ?? '{}'));
    for (const payload of overflowPayloads) {
      expect(payload.error).toMatch(/上限/);
    }
  });
});
