// .eml（メール下書き）を手組みのMIME文字列で生成する（phase4-plan §3で構造確定）。
// 自動送信は機能ごと作らない（要件Won't①）。生成するのはあくまで「下書きファイル」。
// 既知の非対称: Outlook/Thunderbird/Apple Mailは下書きで開けるが、GmailのWeb版は
// .emlを直接開けない → 本文コピーの両建ては Phase 5-3 で対応。

export interface EmlInput {
  to: string;
  subject: string;
  body: string;
  pdfBlob: Blob;
  pdfFilename: string;
}

// btoa に巨大なバイナリ文字列を一括で渡すとスタックを壊すため、チャンクで変換する
function encodeBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// MIMEのbase64本文は76文字で折り返す（RFC 2045）
function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

// 件名など非ASCIIヘッダは RFC 2047 のBエンコーディングで包む
function encodeHeaderWord(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${encodeBase64(new TextEncoder().encode(s))}?=`;
}

export async function buildEmlBlob(input: EmlInput): Promise<Blob> {
  const boundary = `----=_tool2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const bodyB64 = wrap76(encodeBase64(new TextEncoder().encode(input.body)));
  const pdfB64 = wrap76(encodeBase64(new Uint8Array(await input.pdfBlob.arrayBuffer())));

  // 日本語ファイル名は RFC 2231 の filename* で渡し、非対応クライアント用にASCII版も併記する
  const asciiName = input.pdfFilename.replace(/[^\x20-\x7E]/g, '_');
  const rfc2231Name = encodeURIComponent(input.pdfFilename);

  const lines = [
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    bodyB64,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${asciiName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${asciiName}"; filename*=UTF-8''${rfc2231Name}`,
    '',
    pdfB64,
    `--${boundary}--`,
    '',
  ];
  // X-Unsent: 1 はOutlookに「未送信の下書き」として開かせるためのヘッダ
  return new Blob([lines.join('\r\n')], { type: 'message/rfc822' });
}
