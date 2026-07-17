import { formatMoney } from "../components/format.js";
import { createPaymentRequestDocumentModel } from "../core/paymentRequestDocuments.js";
import { displayCourier, SHIPPING_MODES } from "../core/paymentRequests.js";

const IMAGE_WIDTH = 1080;
const GOTYME_QR_ASSET = "/payment/gotyme-instapay-qr.png?v=20260713";
const MARGIN = 72;
const CONTENT_WIDTH = IMAGE_WIDTH - MARGIN * 2;
const AMOUNT_RIGHT_X = IMAGE_WIDTH - MARGIN - 18;
const SUMMARY_LABEL_RIGHT_X = AMOUNT_RIGHT_X - 170;
export const MAX_PAYMENT_REQUEST_IMAGE_ITEMS = 10;
const COLORS = {
  ink: "#1f2329",
  muted: "#626975",
  line: "#d8dbe0",
  accent: "#e07ba0",
  pale: "#fff5f8",
  white: "#ffffff",
};

const cleanText = (value) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
const xmlText = (value) => cleanText(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const money = (value) => formatMoney(value).replace(/[^0-9.,-]+/g, "PHP ").trim();
const safeNumber = (requestNumber) => String(requestNumber || "Payment-Request").replace(/[^A-Za-z0-9-]/g, "-");
const imageFilename = (requestNumber) => `Nana-Kollects-Payment-Request-${safeNumber(requestNumber)}.png`;

function dateLabel(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function wrapText(value, maxChars) {
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
}

export function getPaymentRequestImagePlan(request = {}) {
  const model = createPaymentRequestDocumentModel(request);
  if (model.itemCount > MAX_PAYMENT_REQUEST_IMAGE_ITEMS) {
    throw new Error("This Payment Request has too many items for one image. Download the PDF instead.");
  }
  const rows = model.items.map((item) => {
    const nameLines = wrapText(item.itemName, 30);
    const skuLines = wrapText(item.sku || "SKU unavailable", 22);
    return {
      ...item,
      nameLines,
      skuLines,
      height: Math.max(104, 34 + skuLines.length * 24 + nameLines.length * 31),
    };
  });
  return Object.freeze({ model, rows: Object.freeze(rows) });
}

function text(value, x, y, size = 24, weight = 400, color = COLORS.ink, extra = "") {
  return `<text x="${x}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${xmlText(value)}</text>`;
}

function rightText(value, x, y, size = 24, weight = 400, color = COLORS.ink) {
  return text(value, x, y, size, weight, color, 'text-anchor="end"');
}

function rule(y) {
  return `<line x1="${MARGIN}" y1="${y}" x2="${IMAGE_WIDTH - MARGIN}" y2="${y}" stroke="${COLORS.line}" stroke-width="1.5" />`;
}

function sectionTitle(value, x, y) {
  return text(String(value).toUpperCase(), x, y, 23, 700, COLORS.muted);
}

function centerText(value, x, y, size = 24, weight = 400, color = COLORS.ink) {
  return text(value, x, y, size, weight, color, 'text-anchor="middle"');
}

function detail(label, value, x, y, width = 360) {
  if (!value) return { svg: "", y };
  const lines = wrapText(value, Math.max(20, Math.floor(width / 13)));
  let svg = text(label, x, y, 21, 400, COLORS.muted);
  let cursor = y + 29;
  lines.forEach((line, index) => {
    svg += text(line, x, cursor, 25, 700, COLORS.ink);
    cursor += index === lines.length - 1 ? 0 : 28;
  });
  return { svg, y: cursor + 31 };
}

function paymentDetail(label, value, x, y, width) {
  const lines = wrapText(value, Math.max(14, Math.floor(width / 11)));
  let svg = text(label, x, y, 21, 400, COLORS.muted);
  let cursor = y + 34;
  lines.forEach((line) => {
    svg += text(line, x, cursor, 22, 700, COLORS.ink);
    cursor += 26;
  });
  return { svg, y: cursor + 22 };
}

function totalRow(label, value, y, strong = false) {
  return rightText(label, SUMMARY_LABEL_RIGHT_X, y, strong ? 28 : 23, strong ? 700 : 400, strong ? COLORS.ink : COLORS.muted)
    + rightText(value, AMOUNT_RIGHT_X, y, strong ? 34 : 26, 700, COLORS.ink);
}

function paymentQrSource(source, fallback) {
  const imageSource = String(source || fallback).trim() || fallback;
  if (imageSource.startsWith("data:image/")) return imageSource;
  return imageSource
    .replace("/payment/gcash-qr.jpg", "/payment/gcash-qr.png")
    .replace("/payment/gotyme-instapay-qr.jpg", "/payment/gotyme-instapay-qr.png");
}

function loadImage(source, label) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${label} QR image. Please check the payment QR asset and try again.`));
    image.src = source;
  });
}

function drawContainedImage(context, image, x, y, width, height) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("Payment QR image loaded without dimensions.");
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

async function svgToPngBlob(svg, overlays = []) {
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not render payment request image."));
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_WIDTH;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.fillStyle = COLORS.white;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    overlays.forEach(({ image: overlayImage, x, y, width, height }) => {
      drawContainedImage(context, overlayImage, x, y, width, height);
    });
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export payment request image."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createPaymentRequestImage(request, config = {}) {
  const plan = getPaymentRequestImagePlan(request);
  const { model } = plan;
  const paymentDetails = {
    gcashAccountName: model.paymentConfig.gcashAccountName || config.gcashAccountName,
    gcashMobileNumber: model.paymentConfig.gcashMobileNumber || config.gcashMobileNumber,
    gotymeAccountName: model.paymentConfig.gotymeAccountName || config.gotymeAccountName,
  };
  const gcashQrSource = paymentQrSource(config.gcashQrImage, "/payment/gcash-qr.png");
  const gotymeQrSource = paymentQrSource(GOTYME_QR_ASSET, GOTYME_QR_ASSET);
  const [gcashQr, gotymeQr] = await Promise.all([
    loadImage(gcashQrSource, "GCash"),
    loadImage(gotymeQrSource, "GoTyme / InstaPay"),
  ]);

  let svg = "";
  let y = 82;

  svg += text("Nana Kollects", MARGIN, y, 52, 800);
  y += 36;
  svg += text("Hot Picks. Limited Pieces.", MARGIN, y, 22, 400, COLORS.muted);
  y += 38;
  svg += text(`Payment Request No. ${model.requestNumber}`, MARGIN, y, 27, 800, COLORS.accent);
  y += 38;
  svg += rule(y);

  y += 58;
  const leftX = MARGIN;
  const rightX = 568;
  svg += sectionTitle("Customer", leftX, y);
  svg += sectionTitle("Request Details", rightX, y);
  let leftY = y + 50;
  let rightY = y + 50;
  let rendered = detail("Customer Name", model.customerName, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;
  if (model.customerContact) {
    rendered = detail("Mobile Number", model.customerContact, leftX, leftY, 410);
    svg += rendered.svg;
    leftY = rendered.y;
  }
  rendered = detail("Shipping Address", model.shippingAddress, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;
  const courierLabel = model.shippingMode === SHIPPING_MODES.PICKUP ? "" : displayCourier(model.courier);
  rendered = detail("Courier", courierLabel, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;

  rendered = detail("Date Issued", dateLabel(model.issuedAt), rightX, rightY, 400);
  svg += rendered.svg;
  rightY = rendered.y;
  rendered = detail("Payment Status", model.status, rightX, rightY, 400);
  svg += rendered.svg;
  rightY = rendered.y;
  rendered = detail("Valid Until", dateLabel(model.validUntil), rightX, rightY, 400);
  svg += rendered.svg;
  rightY = rendered.y;
  y = Math.max(leftY, rightY) + 24;
  svg += rule(y);

  y += 46;
  svg += sectionTitle("Order Details", MARGIN, y);
  y += 38;
  const orderHeaderY = y;
  const orderHeaderDividerY = orderHeaderY + 58;
  svg += `<line x1="${MARGIN}" y1="${orderHeaderDividerY}" x2="${IMAGE_WIDTH - MARGIN}" y2="${orderHeaderDividerY}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  const itemX = MARGIN + 18;
  const quantityX = 590;
  const unitRightX = 800;
  svg += text("Item / SKU", itemX, orderHeaderY + 37, 22, 700, COLORS.muted);
  svg += centerText("Qty", quantityX, orderHeaderY + 37, 22, 700, COLORS.muted);
  svg += rightText("Unit Price", unitRightX, orderHeaderY + 37, 22, 700, COLORS.muted);
  svg += rightText("Line Total", AMOUNT_RIGHT_X, orderHeaderY + 37, 22, 700, COLORS.muted);
  y = orderHeaderDividerY;
  plan.rows.forEach((item) => {
    const rowTop = y + 20;
    const rowCenterY = rowTop + item.height / 2;
    let itemY = rowTop + 27;
    item.skuLines.forEach((line) => {
      svg += text(line, itemX, itemY, 20, 700, COLORS.accent);
      itemY += 24;
    });
    item.nameLines.forEach((line) => {
      svg += text(line, itemX, itemY, 26, 700, COLORS.ink);
      itemY += 31;
    });
    svg += centerText(String(item.quantity), quantityX, rowCenterY + 8, 25, 400, COLORS.ink);
    svg += rightText(money(item.unitPrice), unitRightX, rowCenterY + 8, 24, 600, COLORS.ink);
    svg += rightText(money(item.lineTotal), AMOUNT_RIGHT_X, rowCenterY + 8, 25, 700, COLORS.ink);
    y = rowTop + item.height;
    svg += rule(y);
  });

  y += 36;
  const summaryRows = [["Merchandise Subtotal", money(model.merchandiseSubtotal)]];
  if (model.discount > 0) {
    summaryRows.push(["Discount", `-${money(model.discount)}`]);
  }
  if (model.shippingMode === SHIPPING_MODES.TO_FOLLOW) {
    summaryRows.push(["Shipping", "To follow"]);
  }
  if (model.shippingMode === SHIPPING_MODES.PICKUP) {
    summaryRows.push(["Shipping", "Pickup"]);
  }
  if (model.shippingMode === SHIPPING_MODES.FEE_NOW) {
    summaryRows.push(["Shipping", money(model.shippingFee)]);
  }
  summaryRows.forEach(([label, value]) => {
    svg += totalRow(label, value, y);
    y += 36;
  });
  const totalTopY = y + 16;
  const totalRowHeight = 54;
  const totalBottomY = totalTopY + totalRowHeight;
  svg += `<line x1="${MARGIN}" y1="${totalTopY}" x2="${IMAGE_WIDTH - MARGIN}" y2="${totalTopY}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += text(model.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "Amount Due Now" : "Grand Total", MARGIN, totalTopY + totalRowHeight / 2 + 10, 31, 800, COLORS.ink);
  svg += rightText(money(model.grandTotal), AMOUNT_RIGHT_X, totalTopY + totalRowHeight / 2 + 12, 40, 800, COLORS.ink);
  y = totalBottomY;
  svg += rule(y);

  y += 48;
  svg += sectionTitle("Payment Options", MARGIN, y);
  y += 22;
  const cardY = y;
  const cardWidth = (CONTENT_WIDTH - 30) / 2;
  const cardHeight = 270;
  const qrSize = 184;
  const gcashQrPlacement = { image: gcashQr, x: MARGIN + 26, y: cardY + 42, width: qrSize, height: qrSize };
  const gotymeCardX = MARGIN + cardWidth + 30;
  const gotymeQrPlacement = { image: gotymeQr, x: gotymeCardX + 26, y: cardY + 42, width: qrSize, height: qrSize };
  svg += `<rect x="${MARGIN}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" fill="#ffffff" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += `<rect x="${gotymeCardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" fill="#ffffff" stroke="${COLORS.line}" stroke-width="1.5" />`;
  const gcashTextX = MARGIN + 26 + qrSize + 22;
  const paymentTextWidth = cardWidth - qrSize - 74;
  rendered = paymentDetail("Account Name", paymentDetails.gcashAccountName, gcashTextX, cardY + 82, paymentTextWidth);
  svg += rendered.svg;
  rendered = paymentDetail("GCash No.", paymentDetails.gcashMobileNumber, gcashTextX, rendered.y, paymentTextWidth);
  svg += rendered.svg;

  const gotymeTextX = gotymeCardX + 26 + qrSize + 22;
  rendered = paymentDetail("Account Name", paymentDetails.gotymeAccountName, gotymeTextX, cardY + 78, paymentTextWidth);
  svg += rendered.svg;
  rendered = paymentDetail("Acc No.", "014451611994", gotymeTextX, rendered.y, paymentTextWidth);
  svg += rendered.svg;
  y = cardY + cardHeight + 34;

  const reminderPaddingX = 24;
  const reminderPaddingTop = 34;
  const reminderTitleGap = 34;
  const reminderLineHeight = 27;
  const reminderPaddingBottom = 30;
  const reminderTextWidth = CONTENT_WIDTH - reminderPaddingX * 2;
  const reminderMaxChars = Math.floor(reminderTextWidth / 10.5);
  const reminderLines = wrapText("Unpaid reservations without cancellation notice may be released, declined for future orders, and may be included in Nana Kollects' buyer advisory posts in accordance with our shop policies. By paying, you acknowledge that you have read our FAQs and shop policies posted in our pinned posts and highlights.", reminderMaxChars);
  const reminderHeight = reminderPaddingTop + 23 + reminderTitleGap + reminderLines.length * reminderLineHeight + reminderPaddingBottom;
  svg += `<rect x="${MARGIN}" y="${y}" width="${CONTENT_WIDTH}" height="${reminderHeight}" fill="${COLORS.pale}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += sectionTitle("Payment Reminders", MARGIN + reminderPaddingX, y + reminderPaddingTop);
  let reminderY = y + reminderPaddingTop + reminderTitleGap;
  reminderLines.forEach((line) => {
    svg += text(line, MARGIN + 24, reminderY, 21, 400, COLORS.muted);
    reminderY += 27;
  });
  y += reminderHeight + 96;
  svg += rule(y);
  y += 48;
  svg += centerText("Thank you for taking a little piece of Nana Kollects home with you.", IMAGE_WIDTH / 2, y, 24, 400, COLORS.muted);
  y += 76;

  const svgDocument = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${y}" viewBox="0 0 ${IMAGE_WIDTH} ${y}"><rect width="${IMAGE_WIDTH}" height="${y}" fill="#ffffff" />${svg}</svg>`;
  return svgToPngBlob(svgDocument, [gcashQrPlacement, gotymeQrPlacement]);
}

function downloadOrOpenPaymentRequestImage(blob, requestNumber) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = imageFilename(requestNumber);
  document.body.appendChild(link);
  if ("download" in HTMLAnchorElement.prototype) {
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    return "downloaded";
  }
  window.open(url, "_blank", "noopener");
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "opened";
}

function paymentRequestImageFile(blob, requestNumber) {
  return new File([blob], imageFilename(requestNumber), { type: "image/png" });
}

function isLikelyMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

export async function sharePaymentRequestImage(blob, requestNumber, options = {}) {
  const file = paymentRequestImageFile(blob, requestNumber);
  const canShareFile = Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
  if (canShareFile) {
    try {
      await navigator.share({
        files: [file],
        title: "Nana Kollects Payment Request",
      });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      if (error?.name !== "NotAllowedError") throw error;
      if (options.fallbackOnNotAllowed === false) return "blocked";
    }
  }
  const fallbackResult = downloadOrOpenPaymentRequestImage(blob, requestNumber);
  return fallbackResult === "downloaded" && isLikelyMobileBrowser() ? "mobile-download" : fallbackResult;
}

export function downloadPaymentRequestImage(blob, requestNumber) {
  return downloadOrOpenPaymentRequestImage(blob, requestNumber);
}
