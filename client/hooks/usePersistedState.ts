'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * 状態をlocalStorageで永続化する汎用フック（useTopNSettingsと同じ方針: 初回マウント時に
 * 読み込み、更新のたびに書き込む）。SSR時はデフォルト値のまま描画し、マウント後に
 * localStorageの値があれば差し替える（初回レンダーとの不一致はハイドレーション後の
 * 1回だけなので実害は小さい）。
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(defaultValue);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setState(JSON.parse(raw) as T);
    } catch {
      // 壊れた値・アクセス不可（プライベートモード等）は無視してデフォルト値のまま
    }
    // key変更時の再読み込みは想定しない（呼び出し側は固定キーで使う）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPersisted: Dispatch<SetStateAction<T>> = value => {
    setState(prev => {
      const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 保存できなくても致命的ではないので無視
      }
      return next;
    });
  };

  return [state, setPersisted];
}
