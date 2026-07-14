import html2pdf from 'html2pdf.js';

// プレビューに表示している「そのDOMノード」を渡してPDF Blobを得る（プレビュー=PDFの元。
// phase4-plan §3 案A=raster確定。超長文でページ空白になる既知の制限は1回答=1ページ想定で影響なし）
export async function generatePdfBlob(reportEl: HTMLElement): Promise<Blob> {
  return html2pdf()
    .set({
      margin: [10, 10, 12, 10],
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    })
    .from(reportEl)
    .outputPdf('blob');
}
