// 列の自動推測。推測は外れる前提で、必ず画面で確認・修正させる（要件Must①・
// 宛先取り違えは要件§5「してはいけないこと」の筆頭）

const EMAIL_HEADER_PATTERNS = [/メール/, /e-?mail/i, /アドレス/];
const NAME_HEADER_PATTERNS = [/氏名/, /^名前$/, /お名前/, /姓名/, /^name$/i];
const KANA_PATTERN = /ふりがな|フリガナ|かな|カナ/;

const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function guessEmailColumn(headers: string[], rows: string[][]): number {
  const byHeader = headers.findIndex((h) => EMAIL_HEADER_PATTERNS.some((p) => p.test(h)));
  if (byHeader >= 0) return byHeader;
  // 列名で見つからなければ、先頭行の値がメールアドレス形式の列を探す
  if (rows.length > 0) {
    const byValue = rows[0].findIndex((v) => EMAIL_VALUE_PATTERN.test(v.trim()));
    if (byValue >= 0) return byValue;
  }
  return -1;
}

export function guessNameColumn(headers: string[]): number {
  return headers.findIndex(
    (h) => NAME_HEADER_PATTERNS.some((p) => p.test(h)) && !KANA_PATTERN.test(h)
  );
}

// 選択中のメール列に、メール形式でない値が何件あるかを数える（取り違えの警告用）。
// 空欄は「未回答」として母数から除く（.eml生成時に別途弾く）
export function validateEmailColumn(
  rows: string[][],
  emailIdx: number
): { total: number; invalid: number } {
  if (emailIdx < 0) return { total: 0, invalid: 0 };
  let total = 0;
  let invalid = 0;
  for (const row of rows) {
    const v = (row[emailIdx] ?? '').trim();
    if (v === '') continue;
    total++;
    if (!EMAIL_VALUE_PATTERN.test(v)) invalid++;
  }
  return { total, invalid };
}
