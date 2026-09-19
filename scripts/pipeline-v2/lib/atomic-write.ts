import * as fs from 'fs';

/**
 * 一時ファイルへ書いてからrenameすることで、書き込み中のプロセス中断・ディスクエラーで
 * 中途半端なファイルが最終パスに残らないようにする。中断された書き込みが後続の実行で
 * 「有効なキャッシュ」として誤って扱われるのを防ぐ（download-*.tsのキャッシュ判定は
 * ファイルの存在だけを見るため）。
 */
export function writeFileAtomic(outPath: string, data: Buffer): void {
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, outPath);
  } catch (e) {
    fs.rmSync(tmpPath, { force: true });
    throw e;
  }
}
