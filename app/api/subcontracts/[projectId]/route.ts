import { NextRequest, NextResponse } from 'next/server';
import { buildMetadata, API_CACHE_CONTROL, RECIPIENT_NOTES, SUPPORTED_YEARS } from '@/app/lib/api/api-notes';
import { projectLinks, recipientLinks } from '@/app/lib/api/links';
import { buildRecipientKey, isExcludedRecipientName } from '@/app/lib/recipient-key';
import { loadSubcontracts } from '@/app/lib/api/subcontracts-loader';

type SupportedYear = typeof SUPPORTED_YEARS[number];

function isSupportedYear(y: string): y is SupportedYear {
  return (SUPPORTED_YEARS as readonly string[]).includes(y);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const year = request.nextUrl.searchParams.get('year') ?? '2024';

  if (!isSupportedYear(year)) {
    return NextResponse.json({ error: `Unsupported year: ${year}` }, { status: 400 });
  }

  const data = loadSubcontracts(year);
  if (!data) {
    return NextResponse.json({ error: `Data file not found for year ${year}` }, { status: 404 });
  }

  const graph = data[projectId];
  if (!graph) {
    return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
  }

  // 既存フィールドはそのまま、各支出先に逆引きキーと関連リンクを追加
  const body = {
    ...graph,
    metadata: buildMetadata(year, { projectId: graph.projectId }, RECIPIENT_NOTES),
    blocks: graph.blocks.map(block => ({
      ...block,
      recipients: block.recipients.map(r =>
        isExcludedRecipientName(r.name)
          ? r
          : {
              ...r,
              recipientKey: buildRecipientKey(r.name, r.corporateNumber),
              links: recipientLinks(buildRecipientKey(r.name, r.corporateNumber), year),
            }
      ),
    })),
    links: projectLinks(projectId, year),
  };

  return NextResponse.json(body, { headers: { 'Cache-Control': API_CACHE_CONTROL } });
}
