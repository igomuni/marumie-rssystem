export async function readData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（${response.status}）。表示用データを再生成してください。`);
  if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮データの読み込みに対応していません。最新版のブラウザで開いてください。');
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  signal.throwIfAborted();
  return data;
}

