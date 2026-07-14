import Papa from 'papaparse';

export interface CsvResult {
  headers: string[];
  rows: string[][];
  encoding: string;
  /** 列名の数より値が多かった行数。余分な値は表に載らないため、黙って捨てずに画面で知らせる */
  rowsWithExtraValues: number;
}

/** 利用者にそのまま見せる日本語メッセージを持つエラー（20_RULES §3-3: 何が起きたか+次に何をすべきか） */
export class CsvError extends Error {}

// 文字コードはUTF-8既定。置換文字(U+FFFD)が出たらShift_JISと比較して少ない方を採用する
// （ツール1号の知見: GoogleフォームのCSVはUTF-8、Excelで保存し直したCSVはShift_JISが多い）
function decodeBuffer(buf: ArrayBuffer): { text: string; encoding: string } {
  const countBad = (s: string) => (s.match(/�/g) ?? []).length;
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (countBad(utf8) === 0) return { text: utf8, encoding: 'UTF-8' };
  const sjis = new TextDecoder('shift_jis').decode(buf);
  return countBad(sjis) < countBad(utf8)
    ? { text: sjis, encoding: 'Shift_JIS' }
    : { text: utf8, encoding: 'UTF-8' };
}

export async function parseCsvFile(file: File): Promise<CsvResult> {
  if (file.size === 0) {
    throw new CsvError('ファイルが空です。回答データの入ったCSVファイルを入れてください。');
  }
  // フォーム回答CSVの現実的な上限。超えたら黙って処理せず理由を伝える
  if (file.size > 20 * 1024 * 1024) {
    throw new CsvError(
      'ファイルが大きすぎます（上限20MB）。フォームの回答CSVで通常この大きさにはならないため、ファイルの中身をご確認ください。'
    );
  }

  const decoded = decodeBuffer(await file.arrayBuffer());
  const encoding = decoded.encoding;
  // 先頭のBOMは列名に紛れ込むと自動推測を外すため落とす（TextDecoderが残した場合の保険）
  const text = decoded.text.replace(/^﻿/, '');

  // header:false で位置ベースに読む。header:true は同名の列があると値が後勝ちで壊れるため、
  // 同じ質問文が重複しうるフォームCSVでは位置で引く方が安全
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const table = result.data.filter((r) => Array.isArray(r) && r.length > 0);
  if (table.length === 0) {
    throw new CsvError(
      '1行目に列名が見つかりませんでした。「1行目=列名、2行目以降=回答」の形式のCSVを入れてください。'
    );
  }
  // 1行目=列名。空の列名は「列N」で補い、セレクト表示が空にならないようにする
  const headers = table[0].map((h, i) => {
    const t = String(h ?? '').trim();
    return t !== '' ? t : `列${i + 1}`;
  });
  // 2行目以降。列数が揃わない行は空文字で埋める（位置ずれ防止）。
  // 逆に列名より値が多い行は余分な値が表に載らないため、件数を数えて呼び出し元で警告する
  let rowsWithExtraValues = 0;
  const rows = table.slice(1).map((r) => {
    if (r.length > headers.length) rowsWithExtraValues++;
    return headers.map((_, i) => String(r[i] ?? ''));
  });
  if (rows.length === 0) {
    throw new CsvError('回答データが0件でした。2行目以降に回答が入っているCSVを入れてください。');
  }

  return { headers, rows, encoding, rowsWithExtraValues };
}
