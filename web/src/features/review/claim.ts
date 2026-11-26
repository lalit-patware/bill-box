/** Claim helper: complaint text (no invented phone numbers) + one-PDF "claim pack". */

export interface ClaimInput {
  vendor: string | null;
  billDate: string | null;
  billNo: string | null;
  total: number | null;
  product: string | null;
  serial: string | null;
  warrantyUntil: string | null;
}

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function complaintText(c: ClaimInput, issue = '[describe the problem]'): string {
  const lines = [
    'Subject: Warranty service request',
    '',
    'Hello,',
    '',
    `I bought ${c.product ?? 'this product'}${c.vendor ? ` from ${c.vendor}` : ''}${c.billDate ? ` on ${fmt(c.billDate)}` : ''}.`,
    `Problem: ${issue}`,
    '',
    'Details:',
  ];
  if (c.billNo) lines.push(`- Bill / invoice no: ${c.billNo}`);
  if (c.billDate) lines.push(`- Purchase date: ${fmt(c.billDate)}`);
  if (c.total != null) lines.push(`- Amount paid: ₹${c.total}`);
  if (c.serial) lines.push(`- Serial / IMEI: ${c.serial}`);
  if (c.warrantyUntil) lines.push(`- Warranty valid until: ${fmt(c.warrantyUntil)}`);
  lines.push('', 'A copy of the bill is attached. Please register a service request and share the ticket number.', '', 'Thank you');
  return lines.join('\n');
}

/** Search link for the brand's official service number (we never guess numbers). */
export function serviceSearchUrl(brandOrProduct: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${brandOrProduct} official customer care number India`)}`;
}

/** Combine page images (JPEG) and PDFs into one PDF with a summary first page. */
export async function buildClaimPack(
  summary: string[],
  pages: { bytes: Uint8Array; type: 'jpg' | 'pdf' }[],
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([595, 842]); // A4
  let y = 790;
  for (const [i, line] of summary.entries()) {
    // Standard fonts are WinAnsi only: drop characters they can't draw (₹, Devanagari).
    const safe = line.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7E -ÿ]/g, '?');
    first.drawText(safe, { x: 48, y, size: i === 0 ? 18 : 11, font });
    y -= i === 0 ? 30 : 18;
  }
  for (const p of pages) {
    if (p.type === 'pdf') {
      const src = await PDFDocument.load(p.bytes, { ignoreEncryption: true });
      const copied = await doc.copyPages(src, src.getPageIndices());
      copied.forEach((pg) => doc.addPage(pg));
    } else {
      const img = await doc.embedJpg(p.bytes);
      const scale = Math.min(555 / img.width, 802 / img.height, 1);
      const page = doc.addPage([595, 842]);
      page.drawImage(img, {
        x: (595 - img.width * scale) / 2,
        y: (842 - img.height * scale) / 2,
        width: img.width * scale,
        height: img.height * scale,
      });
    }
  }
  return doc.save();
}
