import { MATCH_METHOD_META, type V2MatchMethod } from '@/app/lib/v2-public-linkage';

const CLASS_NAME: Record<V2MatchMethod, string> = {
  'exact-name-key':
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
  'supplemental-exact':
    'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300',
  mixed:
    'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300',
};

export function MatchMethodBadge({ method }: { method: V2MatchMethod }) {
  const meta = MATCH_METHOD_META[method];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${CLASS_NAME[method]}`}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}
