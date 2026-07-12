import { formatMoney } from "../components/format.js";
import { displayCourier, isPaymentConfigurationComplete, SHIPPING_MODES } from "../core/paymentRequests.js";

const PAGE = { width: 595.28, height: 841.89 };

const cleanText = (value) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
const pdfMoney = (value) => formatMoney(value).replace(/[^0-9.,-]+/g, "PHP ").trim();
const dateLabel = (value) => value
  ? new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value))
  : "";

async function imageBytes(imageSource) {
  const source = String(imageSource || "");
  if (source.startsWith("data:image/")) {
    const [header, payload] = source.split(",");
    if (!header || !payload) throw new Error("Configure a valid GoTyme QR image.");
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { bytes, mime: header.toLowerCase() };
  }

  const response = await fetch(source);
  if (!response.ok) throw new Error("Configure a valid GoTyme QR image.");
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime: response.headers.get("content-type") || source.toLowerCase(),
  };
}

export async function createPaymentRequestPdf(request, config) {
  if (!isPaymentConfigurationComplete(config)) {
    throw new Error("Configure GCash details and the GoTyme QR before downloading.");
  }

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const colors = {
    ink: rgb(0.12, 0.12, 0.14),
    muted: rgb(0.38, 0.39, 0.43),
    line: rgb(0.86, 0.86, 0.88),
    accent: rgb(0.88, 0.48, 0.63),
    pale: rgb(0.98, 0.95, 0.96),
  };
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const margin = 42;
  const contentWidth = PAGE.width - margin * 2;
  let y = PAGE.height - 42;

  const drawText = (value, x, drawY, size = 9, font = regular, color = colors.ink, options = {}) => {
    page.drawText(cleanText(value), { x, y: drawY, size, font, color, ...options });
  };
  const drawRight = (value, rightX, drawY, size = 9, font = regular, color = colors.ink) => {
    const label = cleanText(value);
    page.drawText(label, { x: rightX - font.widthOfTextAtSize(label, size), y: drawY, size, font, color });
  };
  const rule = (drawY = y) => page.drawLine({
    start: { x: margin, y: drawY },
    end: { x: PAGE.width - margin, y: drawY },
    thickness: 0.7,
    color: colors.line,
  });
  const sectionTitle = (title, x, drawY) => drawText(title.toUpperCase(), x, drawY, 8, bold, colors.muted);
  const detail = (label, value, x, drawY, width = 190) => {
    if (!value) return drawY;
    drawText(label, x, drawY, 7.5, regular, colors.muted);
    drawText(value, x, drawY - 12, 9, bold, colors.ink, { maxWidth: width });
    return drawY - 29;
  };
  const totalRow = (label, value, drawY) => {
    drawText(label, PAGE.width - margin - 190, drawY, 8.5, regular, colors.muted);
    drawRight(value, PAGE.width - margin, drawY, 9.5, bold, colors.ink);
  };
  const drawCentered = (value, centerX, drawY, size = 9, font = regular, color = colors.ink) => {
    const label = cleanText(value);
    page.drawText(label, { x: centerX - font.widthOfTextAtSize(label, size) / 2, y: drawY, size, font, color });
  };
  const wrapLines = (value, maxChars = 94) => {
    const words = cleanText(value).split(" ").filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  };

  drawText("Nana Kollects", margin, y, 22, bold);
  drawText("Hot Picks. Limited Pieces.", margin, y - 15, 8, regular, colors.muted);
  drawText(`Payment Request No. ${request.requestNumber}`, margin, y - 31, 10, bold, colors.accent);

  y -= 48;
  rule(y);

  y -= 22;
  const columnGap = 28;
  const columnWidth = (contentWidth - columnGap) / 2;
  sectionTitle("Customer", margin, y);
  sectionTitle("Request Details", margin + columnWidth + columnGap, y);
  page.drawLine({
    start: { x: margin, y: y - 7 },
    end: { x: margin + columnWidth, y: y - 7 },
    thickness: 0.5,
    color: colors.line,
  });
  page.drawLine({
    start: { x: margin + columnWidth + columnGap, y: y - 7 },
    end: { x: margin + contentWidth, y: y - 7 },
    thickness: 0.5,
    color: colors.line,
  });
  let leftY = y - 20;
  let rightY = y - 20;
  leftY = detail("Customer Name", request.customerName, margin, leftY, columnWidth);
  if (request.customerContact) leftY = detail("Mobile Number", request.customerContact, margin, leftY, columnWidth);
  if (request.shippingAddress) leftY = detail("Shipping Address", request.shippingAddress, margin, leftY, columnWidth);
  const courierLabel = request.shippingMode === SHIPPING_MODES.PICKUP ? "" : displayCourier(request.courier);
  if (courierLabel) leftY = detail("Courier", courierLabel, margin, leftY, columnWidth);
  rightY = detail("Date Issued", dateLabel(request.issuedAt), margin + columnWidth + columnGap, rightY, columnWidth);
  rightY = detail("Payment Status", request.status, margin + columnWidth + columnGap, rightY, columnWidth);
  if (request.validUntil) rightY = detail("Valid Until", dateLabel(request.validUntil), margin + columnWidth + columnGap, rightY, columnWidth);
  y = Math.min(leftY, rightY) - 6;
  rule(y);

  y -= 18;
  sectionTitle("Order Details", margin, y);
  y -= 18;
  const tableTop = y;
  page.drawLine({
    start: { x: margin, y: tableTop - 22 },
    end: { x: PAGE.width - margin, y: tableTop - 22 },
    thickness: 0.7,
    color: colors.line,
  });
  drawText("Item", margin + 10, tableTop - 12, 8, bold, colors.muted);
  drawText("Qty", margin + 300, tableTop - 12, 8, bold, colors.muted);
  drawRight("Price", margin + 410, tableTop - 12, 8, bold, colors.muted);
  drawRight("Amount", PAGE.width - margin - 10, tableTop - 12, 8, bold, colors.muted);
  y = tableTop - 38;
  drawText(request.itemName, margin + 10, y, 9.5, bold, colors.ink, { maxWidth: 270 });
  drawText("1", margin + 303, y, 9.5, regular, colors.ink);
  drawRight(pdfMoney(request.itemPrice), margin + 410, y, 9.5, regular, colors.ink);
  drawRight(pdfMoney(request.itemPrice), PAGE.width - margin - 10, y, 9.5, bold, colors.ink);
  y -= 18;
  rule(y);

  y -= 18;
  const totalStart = y;
  totalRow("Subtotal", pdfMoney(request.itemPrice), totalStart);
  let totalsY = totalStart - 15;
  if (request.shippingMode === SHIPPING_MODES.TO_FOLLOW) {
    totalRow("Shipping Fee", "To follow", totalsY);
    totalsY -= 15;
  }
  if (request.shippingMode === SHIPPING_MODES.FEE_NOW && request.shippingFee > 0) {
    totalRow("Shipping Fee", pdfMoney(request.shippingFee), totalsY);
    totalsY -= 15;
  }

  if (request.discount > 0) {
    totalRow("Discount", `-${pdfMoney(request.discount)}`, totalsY);
    totalsY -= 15;
  }
  totalsY -= 8;
  const totalBarY = totalsY - 22;
  page.drawLine({
    start: { x: margin, y: totalBarY + 26 },
    end: { x: PAGE.width - margin, y: totalBarY + 26 },
    thickness: 0.7,
    color: colors.line,
  });
  drawText(request.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "Amount Due Now" : "Total Amount Due", margin, totalBarY + 9, 10.8, bold, colors.ink);
  drawRight(pdfMoney(request.totalAmount), PAGE.width - margin, totalBarY + 7, 14.5, bold, colors.ink);
  y = totalBarY - 8;
  rule(y);

  y -= 16;
  sectionTitle("Payment Options", margin, y);
  y -= 8;
  const optionTop = y;
  const optionWidth = (contentWidth - 16) / 2;
  const optionHeight = 132;
  page.drawRectangle({ x: margin, y: optionTop - optionHeight, width: optionWidth, height: optionHeight, borderColor: colors.line, borderWidth: 0.7 });
  page.drawRectangle({ x: margin + optionWidth + 16, y: optionTop - optionHeight, width: optionWidth, height: optionHeight, borderColor: colors.line, borderWidth: 0.7 });

  const paymentQrSize = 110;
  const paymentQrY = optionTop - 122;
  const paymentDetailsY = optionTop - 38;
  const gcashQrSource = (config.gcashQrImage || "/payment/gcash-qr.png").replace("/payment/gcash-qr.jpg", "/payment/gcash-qr.png");
  const gcashQrData = await imageBytes(gcashQrSource);
  const gcashQr = gcashQrData.mime.includes("png")
    ? await document.embedPng(gcashQrData.bytes)
    : await document.embedJpg(gcashQrData.bytes);
  const gcashQrScale = Math.min(paymentQrSize / gcashQr.width, paymentQrSize / gcashQr.height);
  const gcashQrWidth = gcashQr.width * gcashQrScale;
  const gcashQrHeight = gcashQr.height * gcashQrScale;
  page.drawImage(gcashQr, {
    x: margin + 12,
    y: paymentQrY,
    width: gcashQrWidth,
    height: gcashQrHeight,
  });
  const gcashDetailsX = margin + 12 + paymentQrSize + 10;
  const gcashDetailsWidth = optionWidth - paymentQrSize - 34;
  drawText("Account Name", gcashDetailsX, paymentDetailsY, 7.5, regular, colors.muted);
  drawText(config.gcashAccountName, gcashDetailsX, paymentDetailsY - 14, 8.2, bold, colors.ink, { maxWidth: gcashDetailsWidth });
  drawText("GCash No.", gcashDetailsX, paymentDetailsY - 38, 7.5, regular, colors.muted);
  drawText(config.gcashMobileNumber, gcashDetailsX, paymentDetailsY - 52, 8.2, bold, colors.ink, { maxWidth: gcashDetailsWidth });

  const goTymeX = margin + optionWidth + 28;
  const goTymeQrSource = String(config.gotymeQrImage || "/payment/gotyme-instapay-qr.png").replace("/payment/gotyme-instapay-qr.jpg", "/payment/gotyme-instapay-qr.png");
  const qrData = await imageBytes(goTymeQrSource);
  const qr = qrData.mime.includes("png")
    ? await document.embedPng(qrData.bytes)
    : await document.embedJpg(qrData.bytes);
  const qrScale = Math.min(paymentQrSize / qr.width, paymentQrSize / qr.height);
  const qrWidth = qr.width * qrScale;
  const qrHeight = qr.height * qrScale;
  page.drawImage(qr, {
    x: goTymeX,
    y: paymentQrY,
    width: qrWidth,
    height: qrHeight,
  });
  if (config.gotymeAccountName) {
    const goTymeDetailsX = goTymeX + paymentQrSize + 10;
    const goTymeDetailsWidth = optionWidth - paymentQrSize - 34;
    drawText("Account Name", goTymeDetailsX, paymentDetailsY, 7.5, regular, colors.muted);
    drawText(config.gotymeAccountName, goTymeDetailsX, paymentDetailsY - 14, 8.2, bold, colors.ink, { maxWidth: goTymeDetailsWidth });
    drawText("Acc No.", goTymeDetailsX, paymentDetailsY - 38, 7.5, regular, colors.muted);
    drawText("0144 5161 1994", goTymeDetailsX, paymentDetailsY - 52, 8.2, bold, colors.ink, { maxWidth: goTymeDetailsWidth });
  }

  y = optionTop - optionHeight - 10;
  const reminderParagraphs = [
    "Unpaid reservations without cancellation notice may be released, declined for future orders, and may be included in Nana Kollects' buyer advisory posts in accordance with our shop policies.",
    "By paying, you acknowledge that you have read our FAQs and shop policies posted in our pinned posts and highlights.",
  ].map((line) => wrapLines(line, 110));
  const reminderHeight = 27 + reminderParagraphs.reduce((height, lines) => height + lines.length * 9, 0) + 10;
  page.drawRectangle({
    x: margin,
    y: y - reminderHeight,
    width: contentWidth,
    height: reminderHeight,
    color: colors.pale,
    borderColor: colors.line,
    borderWidth: 0.7,
  });
  drawText("PAYMENT REMINDERS", margin + 12, y - 15, 8, bold, colors.muted);
  let reminderY = y - 31;
  reminderParagraphs.forEach((lines, index) => {
    lines.forEach((line) => {
      drawText(line, margin + 12, reminderY, 7.5, regular, colors.muted);
      reminderY -= 9;
    });
    if (index < reminderParagraphs.length - 1) reminderY -= 6;
  });
  y -= reminderHeight + 10;
  if (request.customerNote) {
    drawText("Note", margin, y, 8.2, bold, colors.ink);
    y -= 12;
    wrapLines(request.customerNote, 104).forEach((line) => {
      drawText(line, margin, y, 8, regular, colors.muted);
      y -= 11;
    });
    y -= 2;
  }

  page.drawLine({
    start: { x: margin, y: 55 },
    end: { x: PAGE.width - margin, y: 55 },
    thickness: 0.7,
    color: colors.line,
  });
  drawCentered("We hope you love your piece. Thank you for shopping with Nana Kollects!", PAGE.width / 2, 35, 8.5, regular, colors.muted);

  return document.save();
}

export function downloadPaymentRequestPdf(bytes, requestNumber) {
  const safeNumber = String(requestNumber || "Payment-Request").replace(/[^A-Za-z0-9-]/g, "-");
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Nana-Kollects-Payment-Request-${safeNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
