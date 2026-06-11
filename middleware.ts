/**
 * Edge Middleware: 公開 API（/api/*）への DoS 緩和レート制限。
 *
 * 設計: docs/tasks/20260612_0628_悪意あるユーザー対策_DoS設計.md（L2）
 *
 * - IP 単位のトークンバケット。/api/search/* は全件スキャンで重いため低め、
 *   単発取得系（recipients/project-details 等）は高めの上限。
 * - ストアは現状「インスタンス内メモリ」（ベストエフォート）。サーバレスの
 *   isolate ごとに独立するため厳密ではないが、無設定で即時に乱用を緩和できる。
 *   分散環境で正確に効かせる場合は consumeToken() を Vercel KV / Upstash 等の
 *   共有ストアに差し替える（下記 RateLimitStore の seam）。
 * - 超過時は 429 + Retry-After を返す。
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: '/api/:path*',
};

interface BucketConfig {
  /** バケット容量（バースト許容数） */
  capacity: number;
  /** 1ミリ秒あたりの補充トークン数 */
  refillPerMs: number;
}

// 基準値: 検索1リクエスト ≈ 25ms（調査記録）。出発点の閾値。
const SEARCH_LIMIT: BucketConfig = {
  capacity: 20, // burst 20
  refillPerMs: 60 / 60_000, // 60 req/min
};
const FETCH_LIMIT: BucketConfig = {
  capacity: 40, // burst 40
  refillPerMs: 120 / 60_000, // 120 req/min
};

function limitForPath(pathname: string): BucketConfig {
  return pathname.startsWith('/api/search/') ? SEARCH_LIMIT : FETCH_LIMIT;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * レート制限ストアの抽象。現状はインスタンス内メモリ実装。
 * 分散環境では同インターフェースを Vercel KV / Upstash で実装し差し替える。
 */
interface RateLimitStore {
  /** 1トークン消費を試みる。成功なら allowed=true、失敗なら retryAfterMs を返す */
  consume(key: string, cfg: BucketConfig, now: number): { allowed: boolean; retryAfterMs: number };
}

class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, BucketState>();
  // メモリ無制限増殖の抑制。超過時は最古を間引く。
  private readonly maxEntries = 50_000;

  consume(key: string, cfg: BucketConfig, now: number) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: cfg.capacity, lastRefill: now };
      this.evictIfNeeded();
      this.buckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      if (elapsed > 0) {
        bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillPerMs);
        bucket.lastRefill = now;
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    // 1トークン貯まるまでの待ち時間
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / cfg.refillPerMs);
    return { allowed: false, retryAfterMs };
  }

  private evictIfNeeded() {
    if (this.buckets.size < this.maxEntries) return;
    // Map は挿入順を保持。先頭（最古）から1割を削除。
    const drop = Math.ceil(this.maxEntries * 0.1);
    let i = 0;
    for (const k of this.buckets.keys()) {
      if (i++ >= drop) break;
      this.buckets.delete(k);
    }
  }
}

// モジュールスコープに保持（edge isolate のウォーム間で再利用）。
const store: RateLimitStore = new MemoryRateLimitStore();

function clientKey(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const cfg = limitForPath(pathname);
  const now = Date.now();
  const key = `${clientKey(req)}:${pathname.startsWith('/api/search/') ? 'search' : 'fetch'}`;

  const { allowed, retryAfterMs } = store.consume(key, cfg, now);
  if (allowed) return NextResponse.next();

  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'Cache-Control': 'no-store',
      },
    },
  );
}
