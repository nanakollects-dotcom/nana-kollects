import { formatMoney } from "../components/format.js";
import { displayCourier, SHIPPING_MODES } from "../core/paymentRequests.js";

const IMAGE_WIDTH = 1080;
const MARGIN = 72;
const CONTENT_WIDTH = IMAGE_WIDTH - MARGIN * 2;
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
  return rightText(label, IMAGE_WIDTH - MARGIN - 230, y, strong ? 28 : 23, strong ? 700 : 400, strong ? COLORS.ink : COLORS.muted)
    + rightText(value, IMAGE_WIDTH - MARGIN, y, strong ? 34 : 26, 700, COLORS.ink);
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
  const gcashQrSource = paymentQrSource(config.gcashQrImage, "/payment/gcash-qr.png");
  const gotymeQrSource = paymentQrSource(config.gotymeQrImage, "/payment/gotyme-instapay-qr.png");
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
  svg += text(`Payment Request No. ${request.requestNumber}`, MARGIN, y, 27, 800, COLORS.accent);
  y += 38;
  svg += rule(y);

  y += 58;
  const leftX = MARGIN;
  const rightX = 568;
  svg += sectionTitle("Customer", leftX, y);
  svg += sectionTitle("Request Details", rightX, y);
  svg += `<line x1="${leftX}" y1="${y + 16}" x2="${leftX + 410}" y2="${y + 16}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += `<line x1="${rightX}" y1="${y + 16}" x2="${rightX + 400}" y2="${y + 16}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  let leftY = y + 46;
  let rightY = y + 46;
  let rendered = detail("Customer Name", request.customerName, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;
  rendered = detail("Mobile Number", request.customerContact, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;
  rendered = detail("Shipping Address", request.shippingAddress, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;
  const courierLabel = request.shippingMode === SHIPPING_MODES.PICKUP ? "" : displayCourier(request.courier);
  rendered = detail("Courier", courierLabel, leftX, leftY, 410);
  svg += rendered.svg;
  leftY = rendered.y;

  rendered = detail("Date Issued", dateLabel(request.issuedAt), rightX, rightY, 400);
  svg += rendered.svg;
  rightY = rendered.y;
  rendered = detail("Payment Status", request.status, rightX, rightY, 400);
  svg += rendered.svg;
  rightY = rendered.y;
  rendered = detail("Valid Until", dateLabel(request.validUntil), rightX, rightY, 400);
  svg += rendered.svg;
  rightY = rendered.y;
  y = Math.max(leftY, rightY) + 24;
  svg += rule(y);

  y += 46;
  svg += sectionTitle("Order Details", MARGIN, y);
  y += 38;
  svg += `<line x1="${MARGIN}" y1="${y + 58}" x2="${IMAGE_WIDTH - MARGIN}" y2="${y + 58}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += text("Item", MARGIN + 18, y + 37, 22, 700, COLORS.muted);
  svg += centerText("Qty", 650, y + 37, 22, 700, COLORS.muted);
  svg += rightText("Amount", IMAGE_WIDTH - MARGIN - 18, y + 37, 22, 700, COLORS.muted);
  y += 86;
  const itemRowY = y;
  svg += text(request.itemName, MARGIN + 18, itemRowY, 28, 700, COLORS.ink);
  svg += centerText("1", 650, itemRowY, 28, 400, COLORS.ink);
  svg += rightText(money(request.itemPrice), IMAGE_WIDTH - MARGIN - 18, itemRowY, 28, 700, COLORS.ink);
  y += 46;
  svg += rule(y);

  y += 36;
  svg += totalRow("Subtotal", money(request.itemPrice), y);
  y += 36;
  if (request.shippingMode === SHIPPING_MODES.TO_FOLLOW) {
    svg += totalRow("Shipping Fee", "To follow", y);
    y += 36;
  }
  if (request.shippingMode === SHIPPING_MODES.FEE_NOW && request.shippingFee > 0) {
    svg += totalRow("Shipping Fee", money(request.shippingFee), y);
    y += 36;
  }
  if (request.discount > 0) {
    svg += totalRow("Discount", `-${money(request.discount)}`, y);
    y += 36;
  }
  y += 16;
  const totalBarY = y;
  svg += `<line x1="${MARGIN}" y1="${totalBarY - 22}" x2="${IMAGE_WIDTH - MARGIN}" y2="${totalBarY - 22}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += text(request.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "Amount Due Now" : "Total Amount Due", MARGIN, totalBarY + 14, 31, 800, COLORS.ink);
  svg += rightText(money(request.totalAmount), IMAGE_WIDTH - MARGIN, totalBarY + 16, 40, 800, COLORS.ink);
  y += 54;
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
  rendered = paymentDetail("Account Name", config.gcashAccountName, gcashTextX, cardY + 82, paymentTextWidth);
  svg += rendered.svg;
  rendered = paymentDetail("GCash No.", config.gcashMobileNumber, gcashTextX, rendered.y, paymentTextWidth);
  svg += rendered.svg;

  const gotymeTextX = gotymeCardX + 26 + qrSize + 22;
  rendered = paymentDetail("Account Name", config.gotymeAccountName, gotymeTextX, cardY + 78, paymentTextWidth);
  svg += rendered.svg;
  rendered = paymentDetail("Acc No.", "014451611994", gotymeTextX, rendered.y, paymentTextWidth);
  svg += rendered.svg;
  y = cardY + cardHeight + 34;

  const reminderLines = wrapText("Unpaid reservations without cancellation notice may be released, declined for future orders, and may be included in Nana Kollects' buyer advisory posts in accordance with our shop policies. By paying, you acknowledge that you have read our FAQs and shop policies posted in our pinned posts and highlights.", 96);
  const reminderHeight = 74 + reminderLines.length * 27 + 22;
  svg += `<rect x="${MARGIN}" y="${y}" width="${CONTENT_WIDTH}" height="${reminderHeight}" fill="${COLORS.pale}" stroke="${COLORS.line}" stroke-width="1.5" />`;
  svg += sectionTitle("Payment Reminders", MARGIN + 24, y + 42);
  let reminderY = y + 78;
  reminderLines.forEach((line) => {
    svg += text(line, MARGIN + 24, reminderY, 21, 400, COLORS.muted);
    reminderY += 27;
  });
  y += reminderHeight + 96;
  svg += rule(y);
  y += 48;
  svg += centerText("We hope you love your piece. Thank you for shopping with Nana Kollects!", IMAGE_WIDTH / 2, y, 24, 400, COLORS.muted);
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
