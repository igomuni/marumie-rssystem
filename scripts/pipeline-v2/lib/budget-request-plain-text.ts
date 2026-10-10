import * as crypto from 'crypto';

export const sha256 = (data: Buffer | string): string => crypto.createHash('sha256').update(data).digest('hex');

export function deterministicPdfSlug(localPdfPath: string): string {
  const normalized = localPdfPath.replace(/\\/g, '/');
  const relative = normalized.replace(/^data\/download\//, '').replace(/\.pdf$/i, '');
  return relative.replace(/\//g, '__');
}

export function assertUniqueSlugs(paths: string[]): Map<string, string> {
  const owners = new Map<string, string>();
  const slugsByPath = new Map<string, string>();
  for (const pdfPath of paths) {
    const slug = deterministicPdfSlug(pdfPath);
    const previous = owners.get(slug);
    if (previous) throw new Error(`PDF slug collision for ${slug}: ${previous} and ${pdfPath}`);
    owners.set(slug, pdfPath);
    slugsByPath.set(pdfPath, slug);
  }
  return slugsByPath;
}

/** Split byte-exact pdftotext output; only the empty chunk produced by its terminal FF is discarded. */
export function splitAndValidatePdfText(raw: Buffer, pageCount: number, expectedHashes?: string[]): Buffer[] {
  const ffCount = raw.reduce((n, byte) => n + (byte === 0x0c ? 1 : 0), 0);
  if (raw.length === 0 || raw[raw.length - 1] !== 0x0c) throw new Error('page boundary mismatch: output does not end with a form feed');
  if (ffCount !== pageCount) throw new Error(`page boundary mismatch: found ${ffCount} form feeds, expected ${pageCount}`);
  const chunks: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0c) { chunks.push(raw.subarray(start, i)); start = i + 1; }
  }
  // The trailing FF creates one final empty split element; it is not a page.
  if (start !== raw.length) throw new Error('page boundary mismatch: unexpected trailing bytes');
  if (chunks.length !== pageCount) throw new Error(`page boundary mismatch: returned ${chunks.length} pages, expected ${pageCount}`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  chunks.forEach((chunk, i) => {
    decoder.decode(chunk);
    if (expectedHashes && sha256(chunk) !== expectedHashes[i]) throw new Error(`page ${i + 1} SHA-256 mismatch`);
  });
  if (expectedHashes && expectedHashes.length !== pageCount) throw new Error(`frozen page hash count ${expectedHashes.length} does not match page count ${pageCount}`);
  return chunks;
}
