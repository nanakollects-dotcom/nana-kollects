import { formatMoney } from "../components/format.js";
import { isPaymentConfigurationComplete, SHIPPING_MODES } from "../core/paymentRequests.js";

const PAGE = { width: 595.28, height: 841.89 };

const cleanText = (value) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ").trim();
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
  const margin = 48;
  let y = PAGE.height - 48;

  const text = (value, x, size = 10, font = regular, color = colors.ink) => {
    page.drawText(cleanText(value), { x, y, size, font, color });
  };
  const rule = () => page.drawLine({
    start: { x: margin, y },
    end: { x: PAGE.width - margin, y },
    thickness: 0.7,
    color: colors.line,
  });
  const section = (title) => {
    y -= 22;
    text(title.toUpperCase(), margin, 9, bold, colors.muted);
    y -= 12;
  };
  const pair = (label, value, x = margin, valueX = 180) => {
    text(label, x, 9, regular, colors.muted);
    text(value, valueX, 10, bold);
    y -= 17;
  };

  text("NANA KOLLECTS", margin, 20, bold);
  page.drawText("HOT PICKS. LIMITED PIECES.", {
    x: margin,
    y: y - 14,
    size: 8,
    font: regular,
    color: colors.muted,
  });
  page.drawText("PAYMENT REQUEST", {
    x: PAGE.width - margin - bold.widthOfTextAtSize("PAYMENT REQUEST", 15),
    y,
    size: 15,
    font: bold,
    color: colors.ink,
  });
  y -= 34;
  text(request.requestNumber, margin, 11, bold, colors.accent);
  y -= 16;
  rule();

  section("Request Details");
  pair("Date Issued", dateLabel(request.issuedAt));
  pair("Payment Status", request.status);
  if (request.validUntil) pair("Valid Until", dateLabel(request.validUntil));

  section("Customer");
  pair("Customer Name", request.customerName);
  pair("Customer Contact", request.customerContact);
  if (request.shippingAddress) pair("Shipping Address", request.shippingAddress);

  section("Order Details");
  pair("Item", request.itemName);
  pair("Quantity", "1");
  pair("Item Price", pdfMoney(request.itemPrice));

  section("Totals");
  pair("Subtotal", pdfMoney(request.itemPrice));
  if (request.shippingMode === SHIPPING_MODES.TO_FOLLOW) pair("Shipping Fee", "To follow");
  if (request.shippingMode === SHIPPING_MODES.FEE_NOW && request.shippingFee > 0) pair("Shipping Fee", pdfMoney(request.shippingFee));
  if (request.courier && request.shippingMode !== SHIPPING_MODES.PICKUP) pair("Courier", request.courier);
  if (request.discount > 0) pair("Discount", `- ${pdfMoney(request.discount)}`);
  y -= 2;
  page.drawRectangle({
    x: margin,
    y: y - 30,
    width: PAGE.width - margin * 2,
    height: 42,
    color: colors.pale,
  });
  text(request.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "AMOUNT DUE NOW" : "TOTAL AMOUNT DUE", margin + 14, 10, bold);
  const total = pdfMoney(request.totalAmount);
  page.drawText(total, {
    x: PAGE.width - margin - 14 - bold.widthOfTextAtSize(total, 16),
    y: y - 2,
    size: 16,
    font: bold,
    color: colors.ink,
  });
  y -= 50;

  section("Payment Options");
  const optionTop = y - 12;
  const optionWidth = (PAGE.width - margin * 2 - 18) / 2;
  page.drawRectangle({ x: margin, y: optionTop - 118, width: optionWidth, height: 128, borderColor: colors.line, borderWidth: 0.7 });
  page.drawRectangle({ x: margin + optionWidth + 18, y: optionTop - 118, width: optionWidth, height: 128, borderColor: colors.line, borderWidth: 0.7 });

  y = optionTop - 12;
  text("GCASH", margin + 14, 11, bold);
  y -= 24;
  text("Account Name", margin + 14, 8, regular, colors.muted);
  y -= 14;
  text(config.gcashAccountName, margin + 14, 10, bold);
  y -= 22;
  text("Mobile Number", margin + 14, 8, regular, colors.muted);
  y -= 14;
  text(config.gcashMobileNumber, margin + 14, 10, bold);

  const goTymeX = margin + optionWidth + 32;
  y = optionTop - 12;
  text("GOTYME / INSTAPAY QR", goTymeX, 11, bold);
  const qrData = await imageBytes(config.gotymeQrImage);
  const qr = qrData.mime.includes("png")
    ? await document.embedPng(qrData.bytes)
    : await document.embedJpg(qrData.bytes);
  const qrSize = 74;
  const qrScale = Math.min(qrSize / qr.width, qrSize / qr.height);
  const qrWidth = qr.width * qrScale;
  const qrHeight = qr.height * qrScale;
  page.drawImage(qr, {
    x: goTymeX + (qrSize - qrWidth) / 2,
    y: optionTop - 104 + (qrSize - qrHeight) / 2,
    width: qrWidth,
    height: qrHeight,
  });
  if (config.gotymeAccountName) {
    page.drawText(cleanText(config.gotymeAccountName), {
      x: goTymeX + qrSize + 10,
      y: optionTop - 62,
      size: 9,
      font: bold,
      color: colors.ink,
      maxWidth: optionWidth - qrSize - 38,
    });
  }

  y = optionTop - 142;
  pair("Payment Reference", request.requestNumber);
  y -= 3;
  text("After payment, please send your payment confirmation or transaction reference to Nana Kollects.", margin, 9, regular, colors.muted);
  y -= 15;

  if (request.customerNote) {
    y -= 19;
    text("Note", margin, 9, bold);
    y -= 14;
    text(request.customerNote, margin, 9, regular, colors.muted);
  }

  page.drawLine({
    start: { x: margin, y: 55 },
    end: { x: PAGE.width - margin, y: 55 },
    thickness: 0.7,
    color: colors.line,
  });
  page.drawText("Thank you for shopping with Nana Kollects.", {
    x: margin,
    y: 35,
    size: 9,
    font: regular,
    color: colors.muted,
  });

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
