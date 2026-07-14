// 画面配線（状態→DOM）。骨組みは「5ブロックを縦に並べた1枚」で、ウィザード化は Phase 5-4。
import { createInitialState } from './state';
import { parseCsvFile, CsvError } from './csv';
import { guessEmailColumn, guessNameColumn, validateEmailColumn } from './mapping';
import { buildReport, TEMPLATES, type TemplateId } from './template';
import { generatePdfBlob } from './pdf';
import { buildEmlBlob } from './eml';

const state = createInitialState();

// 検収実測（qa-auto）でブラウザ内から状態・生成物Blobを検証するための読み取り用フック。
// データは外部に出ない（このページのJSコンテキスト内で参照できるだけ）
(window as unknown as Record<string, unknown>).__tool2State = state;

// ---- DOM参照 ----
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const drop = $('drop');
const fileInput = $<HTMLInputElement>('fileInput');
const loadMsg = $('loadMsg');
const mapEmail = $<HTMLSelectElement>('mapEmail');
const mapName = $<HTMLSelectElement>('mapName');
const sampleEmail = $('sampleEmail');
const sampleName = $('sampleName');
const mapMsg = $('mapMsg');
const rowArea = $('rowArea');
const rowMsg = $('rowMsg');
const tplSelect = $<HTMLSelectElement>('tplSelect');
const tplNote = $('tplNote');
const previewArea = $('previewArea');
const pdfBtn = $<HTMLButtonElement>('pdfBtn');
const emlBtn = $<HTMLButtonElement>('emlBtn');
const copyBtn = $<HTMLButtonElement>('copyBtn');
const draftMeta = $('draftMeta');
const exportMsg = $('exportMsg');

function setStepEnabled(stepId: string, enabled: boolean): void {
  const el = $(stepId);
  el.classList.toggle('disabled', !enabled);
  // CSSの pointer-events:none はマウスしか止められず、キーボードとスクリーンリーダーは
  // 未達ステップの操作に到達できてしまう（列対応の確認ゲート＝宛先取り違え防止をすり抜ける）。
  // inert はタブ順・支援技術・全入力から subtree ごと外すため、ゲートを実際に閉じられる
  el.toggleAttribute('inert', !enabled);
}

// ステップ見出しの右に現在地を出す（色だけに頼らず「✓／!＋文字」で示す＝app-ui §7）
function setStepStatus(stepId: string, text: string, kind: 'ok' | 'warn' = 'ok'): void {
  const h2 = $(stepId).querySelector('h2') as HTMLElement;
  let badge = h2.querySelector('.status') as HTMLElement | null;
  if (!badge) {
    badge = document.createElement('span');
    h2.appendChild(badge);
  }
  badge.className = kind === 'warn' ? 'status warn' : 'status';
  badge.textContent = text;
}

// 開いたばかりのステップへ視線とフォーカスを移す（次に何をすべきかを迷わせない＝app-ui §3）
function advanceTo(stepId: string): void {
  const el = $(stepId);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const first = el.querySelector<HTMLElement>('select, button, [tabindex]');
  first?.focus({ preventScroll: true });
}

// 数秒かかる処理は必ず「処理中」を画面に出す（app-ui §3 の4状態。無表示で走らせない）
function showBusy(el: HTMLElement, text: string): void {
  el.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'msg-busy';
  p.textContent = text;
  el.appendChild(p);
  el.setAttribute('aria-busy', 'true'); // 支援技術にも処理中を伝える
}

function showMessage(el: HTMLElement, kind: 'ok' | 'err', text: string): void {
  el.removeAttribute('aria-busy');
  el.innerHTML = '';
  const p = document.createElement('div');
  p.className = kind === 'ok' ? 'msg-ok' : 'msg-err';
  p.textContent = text; // 値の挿入は常にtextContent（XSS対策の一貫）
  el.appendChild(p);
}

// ---- STEP 1: CSV投入 ----
async function handleFile(file: File): Promise<void> {
  // 大きなCSVは解析に時間がかかる。無表示のまま待たせない（app-ui §3）
  showBusy(loadMsg, `「${file.name}」を読み込んでいます…`);
  try {
    const result = await parseCsvFile(file);
    state.headers = result.headers;
    state.rows = result.rows;
    state.encoding = result.encoding;
    state.mapping = {
      email: guessEmailColumn(result.headers, result.rows),
      name: guessNameColumn(result.headers),
    };
    state.mappingConfirmed = false;
    state.selectedIndex = -1;
    state.pdfBlob = null;
    state.emlBlob = null;

    showMessage(
      loadMsg,
      'ok',
      `読み込みました: 回答 ${state.rows.length}件・${state.headers.length}列（文字コード: ${state.encoding}）`
    );
    // 列名より値が多い行は、あふれた値がレポートに載らない。黙って捨てずに知らせる（要件§5）
    if (result.rowsWithExtraValues > 0) {
      const warn = document.createElement('div');
      warn.className = 'msg-err';
      warn.textContent =
        `${result.rowsWithExtraValues}件の行で、1行目の列名より値の数が多くなっています。` +
        'あふれた値はレポートに載りません。1行目の列名が足りているかCSVをご確認ください。';
      loadMsg.appendChild(warn);
    }
    renderMappingUi();
    setStepEnabled('step2', true);
    // 後工程は列対応の確認が済むまで開けない（宛先取り違えの構造的防止）
    setStepEnabled('step3', false);
    setStepEnabled('step4', false);
    setStepEnabled('step5', false);
    setStepStatus('step1', '✓ 読込済み');
    ['step2', 'step3', 'step4', 'step5'].forEach((s) => setStepStatus(s, ''));
    rowArea.innerHTML = '';
    previewArea.innerHTML = '';
    exportMsg.innerHTML = '';
    updateDraftMeta();
    updateExportButtons();
    advanceTo('step2');
  } catch (e) {
    const message =
      e instanceof CsvError
        ? e.message
        : 'CSVの読み込みに失敗しました。ファイルが破損していないか確認し、もう一度お試しください。';
    showMessage(loadMsg, 'err', message);
    setStepEnabled('step2', false);
    setStepEnabled('step3', false);
    setStepEnabled('step4', false);
    setStepEnabled('step5', false);
    ['step1', 'step2', 'step3', 'step4', 'step5'].forEach((s) => setStepStatus(s, ''));
  }
}

drop.addEventListener('click', () => fileInput.click());
// キーボードだけでもファイル選択を開けるようにする（app-ui §7 2.1.1・ドロップ領域は role="button"）
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) void handleFile(fileInput.files[0]);
  fileInput.value = ''; // 同じファイルを続けて入れ直せるようにする
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});

// ---- STEP 2: 列の対応 ----
function fillColumnSelect(select: HTMLSelectElement, selectedIdx: number): void {
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '-1';
  none.textContent = '（なし）';
  select.appendChild(none);
  state.headers.forEach((h, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = h;
    select.appendChild(opt);
  });
  select.value = String(selectedIdx);
}

function renderMappingUi(): void {
  fillColumnSelect(mapEmail, state.mapping.email);
  fillColumnSelect(mapName, state.mapping.name);
  updateMappingPreview();
}

// 選択中の列の実値を数件見せる（取り違えに気づけるように＝要件Must①の核）
function sampleValues(colIdx: number, n = 3): string {
  if (colIdx < 0) return '';
  const vals = state.rows.slice(0, n).map((r) => (r[colIdx] ?? '').trim() || '（空欄）');
  const more = state.rows.length > n ? ' …' : '';
  return `例: ${vals.join(' / ')}${more}`;
}

// サンプル値と、宛先メール列の妥当性警告を更新する。列を選び直すたびに呼ぶ
function updateMappingPreview(): void {
  const emailIdx = Number(mapEmail.value);
  const nameIdx = Number(mapName.value);
  sampleEmail.textContent = emailIdx >= 0 ? sampleValues(emailIdx) : '';
  sampleName.textContent =
    nameIdx >= 0 ? sampleValues(nameIdx) : '氏名の列は「なし」でも進めます（宛名は「ご回答者様」になります）。';

  if (emailIdx === -1) {
    showMessage(
      mapMsg,
      'err',
      '宛先メールの列を自動で見つけられませんでした。上の「宛先メール」で列を選んでください（メール列がないCSVでは下書きを作れません）。'
    );
    return;
  }
  // メール形式でない値が混じっていたら、列の選び間違いに気づけるよう警告する（ブロックはしない）
  const { total, invalid } = validateEmailColumn(state.rows, emailIdx);
  if (invalid > 0) {
    showMessage(
      mapMsg,
      'err',
      `選択中の「宛先メール」列に、メールアドレスの形になっていない値が ${invalid}/${total} 件あります。列の選び間違いがないかご確認ください。`
    );
  } else {
    mapMsg.innerHTML = '';
  }
}

// 列を選び直しただけでは反映されない（確定が誤送信防止のゲート）。
// 確定済みのあとに変更した場合は「まだ効いていない」ことを明示し、押し忘れを防ぐ
function onMappingSelectChange(): void {
  updateMappingPreview();
  if (state.mappingConfirmed) {
    setStepStatus('step2', '! 未確定（「この対応で進む」を押してください）', 'warn');
  }
}
mapEmail.addEventListener('change', onMappingSelectChange);
mapName.addEventListener('change', onMappingSelectChange);

// 空セレクトの value は '' で、Number('') は 0（=先頭列）になってしまう。
// -1 との比較だけでは「列が選ばれていない」を取りこぼすため、列indexとして妥当かで判定する
function parseColumnIndex(value: string): number {
  if (value === '') return -1;
  const n = Number(value);
  return Number.isInteger(n) ? n : -1;
}
function isValidColumn(index: number): boolean {
  return index >= 0 && index < state.headers.length;
}

$('mapOk').addEventListener('click', () => {
  // ゲートは見た目でなく状態で守る。前提が未達ならここで必ず止める
  if (state.rows.length === 0) {
    showMessage(
      mapMsg,
      'err',
      'まだ回答CSVが読み込まれていません。STEP 1で回答CSVを入れてから、列の対応を確定してください。'
    );
    return;
  }
  const email = parseColumnIndex(mapEmail.value);
  const name = parseColumnIndex(mapName.value);
  if (!isValidColumn(email)) {
    showMessage(
      mapMsg,
      'err',
      '宛先メールの列が選ばれていません。メール下書きの宛先に使う列を選んでから進んでください。'
    );
    mapEmail.focus(); // 直すべき入力へフォーカスを移す（app-ui §4・§7）
    return;
  }
  state.mapping.email = email;
  state.mapping.name = isValidColumn(name) ? name : -1; // 氏名は「なし」でも進める
  state.mappingConfirmed = true;
  showMessage(mapMsg, 'ok', 'この対応で進みます。下の一覧から相手を1人選んでください。');
  renderRowTable();
  setStepEnabled('step3', true);
  setStepStatus('step2', '✓ 確定');
  // 相手を選んだあとに列対応を直した場合、プレビュー・下書き・PDFを新しい対応で作り直す
  if (state.selectedIndex >= 0) refreshSelection();
  advanceTo('step3');
});

// ---- STEP 3: 1件選択 ----
function renderRowTable(): void {
  rowArea.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['#', '氏名', '宛先メール', ''].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  state.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (i === state.selectedIndex) tr.classList.add('selected');

    const tdNo = document.createElement('td');
    tdNo.className = 'num';
    tdNo.textContent = String(i + 1);
    const tdName = document.createElement('td');
    tdName.textContent = state.mapping.name >= 0 ? row[state.mapping.name] : '（氏名列なし）';
    const tdMail = document.createElement('td');
    tdMail.textContent = row[state.mapping.email] ?? '';
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn sub';
    btn.textContent = i === state.selectedIndex ? '選択中' : 'この人を選ぶ';
    btn.addEventListener('click', () => void selectRow(i));
    tdBtn.appendChild(btn);

    tr.append(tdNo, tdName, tdMail, tdBtn);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  rowArea.appendChild(wrapper);
}

// 選択中の相手にひもづく表示と生成物を、いまの列対応で作り直す。
// 相手を選び直したときだけでなく、列対応を変えて確定し直したときにも必ず通す
// （古い対応のプレビュー・下書き・PDFが残ると、宛先の取り違えに直結する）
function refreshSelection(): void {
  state.pdfBlob = null;
  state.emlBlob = null;
  exportMsg.innerHTML = '';
  renderPreview();
  updateDraftMeta();
  const name = selectedName(); // 誰を選んでいるかを見出しに出す（値はtextContent＝XSS一貫）
  setStepStatus('step3', name !== '' ? `✓ ${name} を選択中` : '✓ 1件を選択中');
  updateExportButtons();
}

async function selectRow(index: number): Promise<void> {
  state.selectedIndex = index;
  rowMsg.innerHTML = '';
  renderRowTable();
  refreshSelection();
  setStepEnabled('step4', true);
  setStepEnabled('step5', true);
  advanceTo('step4');
}

// ---- STEP 4: 様式の選択とプレビュー（プレビュー=PDFの元DOM） ----
// 現在の選択行・様式でプレビューを描き直す。様式変更・行選択の両方から呼ぶ
function renderPreview(): void {
  previewArea.innerHTML = '';
  if (state.selectedIndex < 0) return;
  const report = buildReport(
    state.templateId,
    state.headers,
    state.rows[state.selectedIndex],
    state.mapping.name,
    state.mapping.email
  );
  previewArea.appendChild(report);
}

function fillTemplateSelect(): void {
  tplSelect.innerHTML = '';
  TEMPLATES.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    tplSelect.appendChild(opt);
  });
  tplSelect.value = state.templateId;
  updateTemplateNote();
}

function updateTemplateNote(): void {
  const t = TEMPLATES.find((x) => x.id === state.templateId);
  tplNote.textContent = t ? t.note : '';
}

tplSelect.addEventListener('change', () => {
  state.templateId = tplSelect.value as TemplateId;
  state.pdfBlob = null; // 様式が変われば生成物も作り直す
  state.emlBlob = null;
  exportMsg.innerHTML = '';
  updateTemplateNote();
  renderPreview();
  updateExportButtons();
});

fillTemplateSelect();

// ---- STEP 5: 書き出し ----
function updateExportButtons(): void {
  const ready = state.selectedIndex >= 0;
  pdfBtn.disabled = !ready;
  emlBtn.disabled = !ready;
  copyBtn.disabled = !ready;
}

function selectedName(): string {
  if (state.selectedIndex < 0 || state.mapping.name < 0) return '';
  return (state.rows[state.selectedIndex][state.mapping.name] ?? '').trim();
}

function datestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function ensurePdfBlob(): Promise<Blob> {
  if (state.pdfBlob) return state.pdfBlob;
  const report = previewArea.querySelector('.report') as HTMLElement | null;
  if (!report) throw new Error('プレビューがありません');
  state.pdfBlob = await generatePdfBlob(report);
  return state.pdfBlob;
}

pdfBtn.addEventListener('click', () => {
  void (async () => {
    pdfBtn.disabled = true;
    showBusy(exportMsg, 'PDFを作成しています…（数秒かかります）');
    try {
      const blob = await ensurePdfBlob();
      const name = selectedName() || '回答者';
      downloadBlob(blob, `回答レポート_${name}_${datestamp()}.pdf`);
      showMessage(exportMsg, 'ok', 'PDFをダウンロードしました ✓ 続けてメール下書き（.eml）も作成できます。');
    } catch {
      showMessage(exportMsg, 'err', 'PDFの作成に失敗しました。相手を選び直してから、もう一度お試しください。');
    } finally {
      pdfBtn.disabled = false;
      updateExportButtons();
    }
  })();
});

// 選択中の相手向けメール下書きの文面。.emlと本文コピーで共有し、両者の文面がずれないようにする
function mailDraft(): { to: string; subject: string; body: string; name: string; honorific: string } {
  const row = state.rows[state.selectedIndex];
  const to = (row?.[state.mapping.email] ?? '').trim();
  const name = selectedName();
  const honorific = name !== '' ? `${name} 様` : 'ご回答者様';
  const subject = `【回答レポート】${honorific}`;
  const body = [
    `${honorific}`,
    '',
    'このたびはご回答いただき、ありがとうございました。',
    'ご回答内容をまとめたレポートを添付いたします。',
    '',
    '（このメールはツールで作成した下書きです。内容をご確認のうえ送信してください）',
  ].join('\r\n');
  return { to, subject, body, name, honorific };
}

// Gmail等で手動再構成できるよう、宛先・件名を選択できる文字で見せる（値はtextContent＝XSS一貫）
function updateDraftMeta(): void {
  draftMeta.innerHTML = '';
  document.getElementById('manualBody')?.remove();
  if (state.selectedIndex < 0) return;
  const d = mailDraft();
  const lines: [string, string][] = [
    ['宛先', d.to !== '' ? d.to : '（宛先メールが空欄です。CSVの宛先メール列をご確認ください）'],
    ['件名', d.subject],
  ];
  lines.forEach(([k, v]) => {
    const line = document.createElement('div');
    const ks = document.createElement('span');
    ks.className = 'k';
    ks.textContent = `${k}：`;
    const vs = document.createElement('span');
    vs.className = 'v';
    vs.textContent = v;
    line.append(ks, vs);
    draftMeta.appendChild(line);
  });
}

// クリップボードAPIが使えない環境向け: 本文を選択済みテキストエリアで見せ、手動コピーできるようにする
function showBodyForManualCopy(body: string): void {
  document.getElementById('manualBody')?.remove();
  const ta = document.createElement('textarea');
  ta.id = 'manualBody';
  ta.className = 'manual-body';
  ta.readOnly = true;
  ta.value = body; // valueへの代入はHTMLとして解釈されない（XSS一貫）
  draftMeta.after(ta);
  ta.focus();
  ta.select();
}

emlBtn.addEventListener('click', () => {
  void (async () => {
    emlBtn.disabled = true;
    try {
      const draft = mailDraft();
      if (draft.to === '') {
        showMessage(
          exportMsg,
          'err',
          'この回答の宛先メールが空欄です。別の相手を選ぶか、CSVの宛先メール列を確認してください。'
        );
        return;
      }
      // 下書きの中身はPDFの生成待ちを含むため、必ず処理中を出す（app-ui §3）
      showBusy(exportMsg, 'メール下書き（.eml）を作成しています…（数秒かかります）');
      const pdfBlob = await ensurePdfBlob();
      const pdfFilename = `回答レポート_${draft.name || '回答者'}_${datestamp()}.pdf`;
      const eml = await buildEmlBlob({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        pdfBlob,
        pdfFilename,
      });
      state.emlBlob = eml;
      downloadBlob(eml, `メール下書き_${draft.name || '回答者'}_${datestamp()}.eml`);
      showMessage(
        exportMsg,
        'ok',
        'メール下書き（.eml）をダウンロードしました ✓ メールソフト（Outlook等）で開き、内容を確認してから送信してください。'
      );
    } catch {
      showMessage(exportMsg, 'err', 'メール下書きの作成に失敗しました。相手を選び直してから、もう一度お試しください。');
    } finally {
      emlBtn.disabled = false;
      updateExportButtons();
    }
  })();
});

// 本文コピー（Gmail等Web版メール向け。.emlを直接開けない非対称を拾う＝要件Must③）
copyBtn.addEventListener('click', () => {
  void (async () => {
    if (state.selectedIndex < 0) return;
    const draft = mailDraft();
    try {
      await navigator.clipboard.writeText(draft.body);
      showMessage(
        exportMsg,
        'ok',
        '本文をコピーしました ✓ メール作成画面に貼り付け、上に表示の宛先とPDFを添えてください。'
      );
    } catch {
      // クリップボードが拒否された場合は本文を画面に出して手動コピーへ誘導する
      showBodyForManualCopy(draft.body);
      showMessage(
        exportMsg,
        'err',
        '自動コピーができませんでした。下に表示した本文を選択してコピーしてください。'
      );
    }
  })();
});
