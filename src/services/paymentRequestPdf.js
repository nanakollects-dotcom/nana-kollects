import { formatMoney } from "../components/format.js";
import { createPaymentRequestDocumentModel } from "../core/paymentRequestDocuments.js";
import { displayCourier, isPaymentConfigurationComplete, SHIPPING_MODES } from "../core/paymentRequests.js";

const PAGE = { width: 595.28, height: 841.89 };
const GOTYME_QR_ASSET = "/payment/gotyme-instapay-qr.png?v=20260713";
const cleanText = (value) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
const pdfMoney = (value) => formatMoney(value).replace(/[^0-9.,-]+/g, "PHP ").trim();
const safeNumber = (requestNumber) => String(requestNumber || "Payment-Request").replace(/[^A-Za-z0-9-]/g, "-");
const dateLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" }).format(date);
};

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

export async function createPaymentRequestPdf(request, config = {}) {
  const model = createPaymentRequestDocumentModel(request);
  const paymentDetails = {
    gcashAccountName: model.paymentConfig.gcashAccountName || config.gcashAccountName,
    gcashMobileNumber: model.paymentConfig.gcashMobileNumber || config.gcashMobileNumber,
    gotymeAccountName: model.paymentConfig.gotymeAccountName || config.gotymeAccountName,
    gotymeQrImage: config.gotymeQrImage,
  };
  if (!isPaymentConfigurationComplete(paymentDetails)) {
    throw new Error("Configure GCash details and the GoTyme QR before downloading.");
  }

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const colors = {
    ink: rgb(0.12, 0.12, 0.14),
    muted: rgb(0.38, 0.39, 0.43),
    section: rgb(0.31, 0.32, 0.36),
    line: rgb(0.86, 0.86, 0.88),
    accent: rgb(0.88, 0.48, 0.63),
    pale: rgb(0.98, 0.95, 0.96),
  };
  const margin = 42;
  const contentWidth = PAGE.width - margin * 2;
  const contentBottom = 70;
  let page;
  let y;

  const addPage = (continuation = false) => {
    page = document.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - 42;
    if (continuation) {
      drawText("Nana Kollects", margin, y, 12, bold, colors.ink);
      drawRight(`Payment Request ${model.requestNumber}`, PAGE.width - margin, y, 8, bold, colors.accent);
      y -= 20;
      rule(y);
      y -= 22;
    }
  };
  const drawText = (value, x, drawY, size = 9, font = regular, color = colors.ink, options = {}) => {
    page.drawText(cleanText(value), { x, y: drawY, size, font, color, ...options });
  };
  const drawRight = (value, rightX, drawY, size = 9, font = regular, color = colors.ink) => {
    const label = cleanText(value);
    drawText(label, rightX - font.widthOfTextAtSize(label, size), drawY, size, font, color);
  };
  const drawCentered = (value, centerX, drawY, size = 9, font = regular, color = colors.ink) => {
    const label = cleanText(value);
    drawText(label, centerX - font.widthOfTextAtSize(label, size) / 2, drawY, size, font, color);
  };
  const rule = (drawY = y) => page.drawLine({
    start: { x: margin, y: drawY },
    end: { x: PAGE.width - margin, y: drawY },
    thickness: 0.7,
    color: colors.line,
  });
  const sectionTitle = (title, x, drawY) => drawText(title.toUpperCase(), x, drawY, 8, bold, colors.section);
  const wrapLinesByWidth = (value, maxWidth, size, font = regular) => {
    const lines = [];
    let line = "";
    const pushWord = (word) => {
      if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
      const chunks = [];
      let chunk = "";
      for (const character of word) {
        if (chunk && font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
          chunks.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    };
    cleanText(value).split(" ").filter(Boolean).flatMap(pushWord).forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  const detail = (label, value, x, drawY, width = 190) => {
    if (!value) return drawY;
    drawText(label, x, drawY, 7.2, regular, colors.muted);
    const lines = wrapLinesByWidth(value, width, 8.7, bold);
    lines.forEach((line, index) => drawText(line, x, drawY - 12 - index * 11, 8.7, bold, colors.ink));
    return drawY - (17 + lines.length * 11);
  };
  const embedImage = async (source) => {
    const data = await imageBytes(source);
    return data.mime.includes("png") ? document.embedPng(data.bytes) : document.embedJpg(data.bytes);
  };
  const drawContainedImage = (image, x, drawY, width, height) => {
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: x + (width - drawWidth) / 2,
      y: drawY + (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  };

  const gcashQrSource = (config.gcashQrImage || "/payment/gcash-qr.png").replace("/payment/gcash-qr.jpg", "/payment/gcash-qr.png");
  const [gcashQr, gotymeQr] = await Promise.all([embedImage(gcashQrSource), embedImage(GOTYME_QR_ASSET)]);

  addPage();
  drawText("Nana Kollects", margin, y, 22, bold);
  drawText("Hot Picks. Limited Pieces.", margin, y - 15, 8, regular, colors.muted);
  drawText(`Payment Request No. ${model.requestNumber}`, margin, y - 31, 10, bold, colors.accent);
  y -= 48;
  rule(y);

  y -= 22;
  const columnGap = 28;
  const columnWidth = (contentWidth - columnGap) / 2;
  sectionTitle("Customer and Shipping", margin, y);
  sectionTitle("Request Details", margin + columnWidth + columnGap, y);
  let leftY = y - 22;
  let rightY = y - 22;
  leftY = detail("Customer Name", model.customerName, margin, leftY, columnWidth);
  if (model.customerContact) {
    leftY = detail("Mobile Number", model.customerContact, margin, leftY, columnWidth);
  }
  leftY = detail("Shipping Method", model.shippingMethod, margin, leftY, columnWidth);
  leftY = detail("Shipping Address", model.shippingAddress, margin, leftY, columnWidth);
  leftY = detail("Courier", displayCourier(model.courier), margin, leftY, columnWidth);
  rightY = detail("Date Issued", dateLabel(model.issuedAt), margin + columnWidth + columnGap, rightY, columnWidth);
  rightY = detail("Payment Status", model.status, margin + columnWidth + columnGap, rightY, columnWidth);
  rightY = detail("Payment Method", model.paymentMethod || "GCash / GoTyme", margin + columnWidth + columnGap, rightY, columnWidth);
  rightY = detail("Valid Until", dateLabel(model.validUntil), margin + columnWidth + columnGap, rightY, columnWidth);
  y = Math.min(leftY, rightY) - 5;
  rule(y);

  y -= 18;
  sectionTitle("Payment Options", margin, y);
  y -= 9;
  const optionTop = y;
  const optionWidth = (contentWidth - 14) / 2;
  const optionHeight = 112;
  const qrSize = 82;
  const secondOptionX = margin + optionWidth + 14;
  page.drawRectangle({ x: margin, y: optionTop - optionHeight, width: optionWidth, height: optionHeight, borderColor: colors.line, borderWidth: 0.7 });
  page.drawRectangle({ x: secondOptionX, y: optionTop - optionHeight, width: optionWidth, height: optionHeight, borderColor: colors.line, borderWidth: 0.7 });
  drawContainedImage(gcashQr, margin + 10, optionTop - optionHeight + 15, qrSize, qrSize);
  drawContainedImage(gotymeQr, secondOptionX + 10, optionTop - optionHeight + 15, qrSize, qrSize);
  const paymentCopyWidth = optionWidth - qrSize - 32;
  const gcashCopyX = margin + qrSize + 20;
  const gotymeCopyX = secondOptionX + qrSize + 20;
  drawText("GCash", gcashCopyX, optionTop - 26, 8, bold, colors.accent);
  wrapLinesByWidth(paymentDetails.gcashAccountName, paymentCopyWidth, 7.5, bold).slice(0, 2).forEach((line, index) => drawText(line, gcashCopyX, optionTop - 42 - index * 10, 7.5, bold));
  drawText(paymentDetails.gcashMobileNumber, gcashCopyX, optionTop - 72, 7.2, regular, colors.muted);
  drawText("GoTyme / InstaPay", gotymeCopyX, optionTop - 26, 8, bold, colors.accent);
  wrapLinesByWidth(paymentDetails.gotymeAccountName, paymentCopyWidth, 7.5, bold).slice(0, 2).forEach((line, index) => drawText(line, gotymeCopyX, optionTop - 42 - index * 10, 7.5, bold));
  drawText("Acc No. 014451611994", gotymeCopyX, optionTop - 72, 7.2, regular, colors.muted);
  y = optionTop - optionHeight - 18;

  const tableColumns = {
    itemX: margin + 7,
    itemWidth: 204,
    skuX: margin + 220,
    skuWidth: 70,
    quantityX: margin + 322,
    unitRightX: margin + 415,
    totalRightX: PAGE.width - margin - 7,
  };
  const drawItemsHeader = (continued = false) => {
    sectionTitle(continued ? "Items - Continued" : "Items", margin, y);
    y -= 22;
    drawText("Item", tableColumns.itemX, y, 7.5, bold, colors.muted);
    drawText("SKU", tableColumns.skuX, y, 7.5, bold, colors.muted);
    drawCentered("Qty", tableColumns.quantityX, y, 7.5, bold, colors.muted);
    drawRight("Unit Price", tableColumns.unitRightX, y, 7.5, bold, colors.muted);
    drawRight("Line Total", tableColumns.totalRightX, y, 7.5, bold, colors.muted);
    y -= 11;
    rule(y);
    y -= 14;
  };

  drawItemsHeader(false);
  model.items.forEach((item) => {
    const nameLines = wrapLinesByWidth(item.itemName, tableColumns.itemWidth, 8.5, bold);
    const skuLines = wrapLinesByWidth(item.sku || "Unavailable", tableColumns.skuWidth, 7.8, regular);
    const rowHeight = Math.max(34, Math.max(nameLines.length * 11, skuLines.length * 10) + 15);
    if (y - rowHeight < contentBottom) {
      addPage(true);
      drawItemsHeader(true);
    }
    const rowTop = y;
    nameLines.forEach((line, index) => drawText(line, tableColumns.itemX, rowTop - index * 11, 8.5, bold));
    skuLines.forEach((line, index) => drawText(line, tableColumns.skuX, rowTop - index * 10, 7.8, regular, colors.muted));
    drawCentered(String(item.quantity), tableColumns.quantityX, rowTop, 8.3, regular);
    drawRight(pdfMoney(item.unitPrice), tableColumns.unitRightX, rowTop, 8.3, regular);
    drawRight(pdfMoney(item.lineTotal), tableColumns.totalRightX, rowTop, 8.5, bold);
    y -= rowHeight;
    rule(y + 7);
  });

  if (y - 110 < contentBottom) addPage(true);
  y -= 12;
  sectionTitle("Totals", margin, y);
  y -= 22;
  const totalRow = (label, value, strong = false) => {
    drawRight(label, PAGE.width - margin - 152, y, strong ? 10 : 8.5, strong ? bold : regular, strong ? colors.ink : colors.muted);
    drawRight(value, PAGE.width - margin - 7, y, strong ? 12.5 : 9.5, bold, colors.ink);
    y -= strong ? 23 : 16;
  };
  totalRow("Merchandise Subtotal", pdfMoney(model.merchandiseSubtotal));
  totalRow("Discount", model.discount ? `-${pdfMoney(model.discount)}` : pdfMoney(0));
  totalRow("Shipping", model.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "To follow" : model.shippingMode === SHIPPING_MODES.PICKUP ? "Pickup" : pdfMoney(model.shippingFee));
  rule(y + 7);
  y -= 11;
  totalRow(model.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "Amount Due Now" : "Grand Total", pdfMoney(model.grandTotal), true);

  const reminderText = "Unpaid reservations without cancellation notice may be released, declined for future orders, and may be included in Nana Kollects' buyer advisory posts in accordance with our shop policies. By paying, you acknowledge that you have read our FAQs and shop policies posted in our pinned posts and highlights.";
  const reminderLines = wrapLinesByWidth(reminderText, contentWidth - 24, 7.5, regular);
  const noteLines = model.customerNote ? wrapLinesByWidth(model.customerNote, contentWidth, 8, regular) : [];
  const closingHeight = 45 + reminderLines.length * 10 + (noteLines.length ? 24 + noteLines.length * 11 : 0);
  if (y - closingHeight < contentBottom) addPage(true);
  page.drawRectangle({
    x: margin,
    y: y - 26 - reminderLines.length * 10,
    width: contentWidth,
    height: 30 + reminderLines.length * 10,
    color: colors.pale,
    borderColor: colors.line,
    borderWidth: 0.7,
  });
  drawText("PAYMENT REMINDERS", margin + 12, y - 16, 8, bold, colors.muted);
  reminderLines.forEach((line, index) => drawText(line, margin + 12, y - 32 - index * 10, 7.5, regular, colors.muted));
  y -= 42 + reminderLines.length * 10;
  if (noteLines.length) {
    drawText("CUSTOMER NOTE", margin, y, 8, bold, colors.section);
    y -= 14;
    noteLines.forEach((line) => {
      drawText(line, margin, y, 8, regular, colors.muted);
      y -= 11;
    });
  }

  const pages = document.getPages();
  pages.forEach((currentPage, index) => {
    page = currentPage;
    page.drawLine({
      start: { x: margin, y: 55 },
      end: { x: PAGE.width - margin, y: 55 },
      thickness: 0.7,
      color: colors.line,
    });
    drawText("Nana Kollects", margin, 35, 8.2, bold, colors.muted);
    drawCentered("Thank you for taking a little piece of Nana Kollects home with you.", PAGE.width / 2, 35, 8, regular, colors.muted);
    drawRight(`Page ${index + 1} of ${pages.length}`, PAGE.width - margin, 35, 8, regular, colors.muted);
  });

  return document.save();
}

export function downloadPaymentRequestPdf(bytes, requestNumber) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Nana-Kollects-Payment-Request-${safeNumber(requestNumber)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
