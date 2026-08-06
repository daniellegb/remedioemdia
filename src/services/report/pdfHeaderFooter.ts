import { jsPDF } from 'jspdf';

interface HeaderFooterOptions {
  logoDataUrl: string | null;
  reportTitle: string;
}

export const applyHeadersAndFooters = (doc: jsPDF, options: HeaderFooterOptions) => {
  const totalPages = doc.getNumberOfPages();
  const { logoDataUrl, reportTitle } = options;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // 1. HEADER (Every Page)
    const logoWidth = 48;
    const logoHeight = 12;
    const logoX = (210 - logoWidth) / 2;
    let drawnLogo = false;

    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', logoX, 8, logoWidth, logoHeight);
        drawnLogo = true;
      } catch (logoErr) {
        console.error("Error drawing logo in PDF header:", logoErr);
      }
    }

    if (!drawnLogo) {
      // Text fallback for logo title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(46, 124, 195); // Brand Blue
      doc.text("Remédio em Dia", 105, 18, { align: 'center' });
    }

    // Title of the report below the logo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(46, 124, 195); // Brand Blue
    doc.text(reportTitle, 105, 26, { align: 'center' });

    // Thin horizontal separator line using the primary color of the brand
    doc.setDrawColor(46, 124, 195); // Brand Blue
    doc.setLineWidth(0.3);
    doc.line(15, 30, 195, 30);

    // 2. FOOTER (Every Page)
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.2);
    doc.line(15, 280, 195, 280);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text("Remédio em Dia  |  www.remedioemdia.com", 15, 285);
    doc.text(`Página ${i} de ${totalPages}`, 195, 285, { align: 'right' });
  }
};

export const drawInstitutionalFooter = (
  doc: jsPDF,
  currentY: number,
  qrCodeDataUrl: string | null,
  pageHeight: number = 297,
  marginBottom: number = 25
): number => {
  const institutionalHeight = 45;
  if (currentY + institutionalHeight > pageHeight - marginBottom) {
    doc.addPage();
    currentY = 40;
  } else {
    currentY += 6;
  }

  // Add a light separator line before the institutional area
  doc.setDrawColor(108, 200, 176); // Brand Green `#6CC8B0`
  doc.setLineWidth(0.2);
  doc.line(40, currentY, 170, currentY);
  currentY += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(46, 124, 195); // Brand Blue `#2E7CC3`
  doc.text("Gerado pelo Remédio em Dia.", 105, currentY, { align: 'center' });
  currentY += 5;

  // Draw static QR Code linking directly to https://remedioemdia.com
  const qrWidth = 22;
  const qrHeight = 22;
  const qrX = (210 - qrWidth) / 2;
  try {
    if (qrCodeDataUrl) {
      doc.addImage(qrCodeDataUrl, 'PNG', qrX, currentY, qrWidth, qrHeight);
    }
  } catch (err) {
    console.error("Error adding QR code image to PDF", err);
  }
  currentY += qrHeight + 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(80, 80, 80); // Dark Gray `#505050`
  doc.text("www.remedioemdia.com", 105, currentY, { align: 'center' });

  return currentY;
};
