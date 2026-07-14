// アプリ状態（design.md §3: サーバ保存なし・ブラウザ内メモリのみ・リロードで消える）
// 状態管理ライブラリは入れない方針（phase4-plan §2）。1オブジェクトに集約する。

import type { TemplateId } from './template';

export interface ColumnMapping {
  /** 宛先メール列のindex（-1 = 未設定。設定されるまで次の工程へ進めない） */
  email: number;
  /** 氏名列のindex（-1 = 未設定。氏名なしでも進める＝宛名は「ご回答者様」になる） */
  name: number;
}

export interface AppState {
  headers: string[];
  rows: string[][];
  /** 実際に採用した文字コード（画面表示用。UTF-8 / Shift_JIS） */
  encoding: string;
  mapping: ColumnMapping;
  mappingConfirmed: boolean;
  /** 選択中の回答行（-1 = 未選択） */
  selectedIndex: number;
  /** レポートの様式（汎用/診断風/シンプル。Phase 5-2で追加。既定=汎用） */
  templateId: TemplateId;
  pdfBlob: Blob | null;
  emlBlob: Blob | null;
}

export function createInitialState(): AppState {
  return {
    headers: [],
    rows: [],
    encoding: '',
    mapping: { email: -1, name: -1 },
    mappingConfirmed: false,
    selectedIndex: -1,
    templateId: 'generic',
    pdfBlob: null,
    emlBlob: null,
  };
}
