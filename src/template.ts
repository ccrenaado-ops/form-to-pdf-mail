// 雛形（Phase 5-2で3種化: 汎用 / 診断風 / シンプル）
//
// ★セキュリティの要（phase4-plan §4 / acceptance v1.1 C項目）:
//   CSV由来の値は必ず textContent 経由で挿入する。innerHTML に生値を連結しない。
//   回答に <script> や <img onerror> が含まれても、文字列として表示されるだけにする。
//   innerHTML を使ってよいのは「CSV値を一切含まない静的な骨格」だけ。

export type TemplateId = 'generic' | 'diagnostic' | 'simple';

// UIの様式セレクトを組み立てる一覧（配列の順＝画面での表示順）。
export const TEMPLATES: { id: TemplateId; label: string; note: string }[] = [
  { id: 'generic', label: '汎用（全項目を一覧）', note: 'ご回答の全項目を表で並べた標準レポートです。' },
  { id: 'diagnostic', label: '診断風（読み物）', note: 'クリーム地に明朝で組んだ、所見票ふうの落ち着いた誌面です。' },
  { id: 'simple', label: 'シンプル（1枚）', note: '宛名とご回答項目だけの、軽い1枚です。' },
];

function formatDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 宛名（氏名列があれば「○○ 様」、なければ「ご回答者様」）
function honorific(row: string[], nameIdx: number): string {
  const name = nameIdx >= 0 ? (row[nameIdx] ?? '').trim() : '';
  return name !== '' ? `${name} 様` : 'ご回答者様';
}

// 回答項目のうち、宛名/宛先に既出の氏名列・宛先メール列を除いた (設問, 回答) の組を返す。
// 診断風・シンプルはこの一覧を本文に使う（氏名の重複表示と、生メールアドレスの本文露出を避ける）。
function answerEntries(
  headers: string[],
  row: string[],
  nameIdx: number,
  emailIdx: number
): { label: string; value: string }[] {
  const entries: { label: string; value: string }[] = [];
  headers.forEach((header, i) => {
    if (i === nameIdx || i === emailIdx) return;
    entries.push({ label: header, value: (row[i] ?? '').trim() });
  });
  return entries;
}

/**
 * 汎用雛形。全項目を表で列挙する（骨組みからの挙動を変えない＝後方互換）。
 */
function buildGeneric(headers: string[], row: string[], nameIdx: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'report';
  // 静的な骨格のみ。CSV値はこの文字列に絶対に入れない
  root.innerHTML = `
    <div class="r-head">
      <p class="r-eyebrow">ANSWER REPORT</p>
      <h1>回答レポート</h1>
      <p class="r-date"></p>
    </div>
    <p class="r-name"></p>
    <p class="r-lead">ご回答いただいた内容を、以下のとおりお預かりしました。</p>
    <table class="r-table"><tbody></tbody></table>
    <p class="r-foot">本レポートは、お預かりした回答内容をもとに自動作成されています。</p>
  `;

  (root.querySelector('.r-date') as HTMLElement).textContent = `発行日: ${formatDate(new Date())}`;
  (root.querySelector('.r-name') as HTMLElement).textContent = honorific(row, nameIdx);

  const tbody = root.querySelector('tbody') as HTMLTableSectionElement;
  headers.forEach((header, i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = header;
    const td = document.createElement('td');
    td.textContent = row[i] ?? '';
    tr.append(th, td);
    tbody.appendChild(tr);
  });

  return root;
}

/**
 * 診断風雛形。クリーム地＋明朝の誌面に、回答を「所見ブロック」として縦に組む。
 * S0/S1診断への転用が骨子（要件§7・手札= library/01-資料/B-warm-magazine v2）。
 * ★AIが評点・講評を創作しない（PRINCIPLES §3-11）。回答値をそのまま所見欄に転記するだけ。
 * ★回答が空欄の項目はブロックを作らない（枠だけ作らない＝PRINCIPLES §3-19）。
 */
function buildDiagnostic(
  headers: string[],
  row: string[],
  nameIdx: number,
  emailIdx: number
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'report report-diag';
  root.innerHTML = `
    <div class="rd-head">
      <p class="rd-eyebrow">DIAGNOSTIC REPORT</p>
      <h1>ご回答内容のまとめ</h1>
      <p class="rd-date"></p>
    </div>
    <p class="rd-name"></p>
    <p class="rd-lead">このたびはご回答いただき、ありがとうございました。いただいたご回答を、以下のとおり整理いたしました。</p>
    <div class="rd-body"></div>
    <p class="rd-foot">本レポートは、お預かりしたご回答内容を整理して自動作成したものです。</p>
  `;

  (root.querySelector('.rd-date') as HTMLElement).textContent = `発行日: ${formatDate(new Date())}`;
  (root.querySelector('.rd-name') as HTMLElement).textContent = honorific(row, nameIdx);

  const body = root.querySelector('.rd-body') as HTMLElement;
  const entries = answerEntries(headers, row, nameIdx, emailIdx).filter((e) => e.value !== '');
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rd-empty';
    empty.textContent = 'ご回答項目がありません。CSVの列の対応をご確認ください。';
    body.appendChild(empty);
  } else {
    entries.forEach((e) => {
      const item = document.createElement('section');
      item.className = 'rd-item';
      const h = document.createElement('h2');
      h.textContent = e.label;
      const p = document.createElement('p');
      p.textContent = e.value;
      item.append(h, p);
      body.appendChild(item);
    });
  }

  return root;
}

/**
 * シンプル雛形。宛名＋回答項目だけの軽い1枚（宛先/氏名列は除外）。
 * 空欄の項目は出さない（枠だけ作らない＝PRINCIPLES §3-19）。
 */
function buildSimple(
  headers: string[],
  row: string[],
  nameIdx: number,
  emailIdx: number
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'report report-simple';
  root.innerHTML = `
    <div class="rs-head">
      <h1>ご回答内容</h1>
      <p class="rs-date"></p>
    </div>
    <p class="rs-name"></p>
    <dl class="rs-list"></dl>
    <p class="rs-foot">お預かりしたご回答内容です。</p>
  `;

  (root.querySelector('.rs-date') as HTMLElement).textContent = formatDate(new Date());
  (root.querySelector('.rs-name') as HTMLElement).textContent = honorific(row, nameIdx);

  const list = root.querySelector('.rs-list') as HTMLElement;
  const entries = answerEntries(headers, row, nameIdx, emailIdx).filter((e) => e.value !== '');
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rs-empty';
    empty.textContent = 'ご回答項目がありません。CSVの列の対応をご確認ください。';
    list.replaceWith(empty);
  } else {
    entries.forEach((e) => {
      const dt = document.createElement('dt');
      dt.textContent = e.label;
      const dd = document.createElement('dd');
      dd.textContent = e.value;
      list.append(dt, dd);
    });
  }

  return root;
}

/**
 * 様式IDに応じてレポートDOMを組み立てて返す（プレビュー=PDFの元DOM）。
 * どの様式でもルートに .report クラスを付ける（PDF生成が .report を目印に拾うため）。
 */
export function buildReport(
  templateId: TemplateId,
  headers: string[],
  row: string[],
  nameIdx: number,
  emailIdx: number
): HTMLElement {
  switch (templateId) {
    case 'diagnostic':
      return buildDiagnostic(headers, row, nameIdx, emailIdx);
    case 'simple':
      return buildSimple(headers, row, nameIdx, emailIdx);
    case 'generic':
    default:
      return buildGeneric(headers, row, nameIdx);
  }
}
