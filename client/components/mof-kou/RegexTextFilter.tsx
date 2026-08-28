'use client';

/** 文字列列の検索フィルタ。既定は部分一致、`.*` トグルで正規表現に切り替えられる */

export interface RegexTextFilterProps {
  label: string;
  note?: string;
  value: string;
  onChange: (value: string) => void;
  useRegex: boolean;
  onToggleRegex: (useRegex: boolean) => void;
  placeholder?: string;
}

export function RegexTextFilter({ label, note, value, onChange, useRegex, onToggleRegex, placeholder }: RegexTextFilterProps) {
  const invalid = useRegex && value !== '' && !isValidRegex(value);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-neutral-500" title={note}>
          {label}
        </span>
        <button
          type="button"
          onClick={() => onToggleRegex(!useRegex)}
          aria-pressed={useRegex}
          title="正規表現で検索"
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
            useRegex
              ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
              : 'border border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
          }`}
        >
          .*
        </button>
      </div>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        className={`w-full rounded border bg-white px-2 py-1 text-xs dark:bg-neutral-900 ${
          invalid ? 'border-red-400' : 'border-neutral-300 dark:border-neutral-700'
        }`}
      />
      {invalid && <p className="text-[10px] text-red-500">正規表現が不正です</p>}
    </div>
  );
}

export function isValidRegex(pattern: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** 文字列フィルタのマッチ判定（正規表現が不正なときは何もマッチさせない） */
export function textMatches(haystack: string, needle: string, useRegex: boolean): boolean {
  if (!needle) return true;
  if (!useRegex) return haystack.includes(needle);
  if (!isValidRegex(needle)) return false;
  return new RegExp(needle).test(haystack);
}
