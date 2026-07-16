import { normalizeShippingMode, paymentMoney, SHIPPING_MODE_LABELS, SHIPPING_MODES } from "./paymentRequests.js";

const cleanSnapshotText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const cents = (value) => Math.round(value * 100);

function requiredMoney(value, errorMessage) {
  if (value === null || value === undefined || value === "") throw new Error(errorMessage);
  const amount = paymentMoney(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(errorMessage);
  return amount;
}

function itemSnapshot(item, legacy = false) {
  const unitPrice = requiredMoney(
    item.unitPrice ?? item.unit_price ?? item.itemPrice ?? item.price,
    "Payment Request document item snapshots are invalid.",
  );
  const quantity = Number(item.quantity ?? 1);
  const lineTotal = legacy
    ? unitPrice
    : requiredMoney(item.lineTotal ?? item.line_total, "Payment Request document item snapshots are invalid.");
  const itemName = cleanSnapshotText(item.itemName ?? item.item_name ?? item.name);
  const sku = cleanSnapshotText(item.sku);
  if (!itemName || quantity !== 1 || cents(lineTotal) !== cents(unitPrice * quantity)) {
    throw new Error("Payment Request document item snapshots are invalid.");
  }
  return {
    key: cleanSnapshotText(item.inventoryItemId ?? item.inventory_item_id ?? item.itemId)
      || `${sku}|${itemName}|${unitPrice}|${quantity}`,
    sku,
    itemName,
    quantity: 1,
    unitPrice,
    lineTotal,
  };
}

function canonicalItems(request) {
  const canonical = Array.isArray(request.items) ? request.items : [];
  const source = canonical.length
    ? canonical.map((item) => itemSnapshot(item, false))
    : request.itemName || request.itemId
      ? [itemSnapshot({
          inventoryItemId: request.itemId,
          sku: request.sku,
          itemName: request.itemName,
          unitPrice: request.itemPrice,
          quantity: 1,
        }, true)]
      : [];
  if (!source.length) throw new Error("Payment Request document has no items.");
  if (source.length > 50) throw new Error("Payment Request document has too many items.");

  const unique = new Map();
  source.forEach((item) => {
    if (!unique.has(item.key)) unique.set(item.key, item);
  });
  return [...unique.values()]
    .sort((first, second) => String(first.sku).localeCompare(String(second.sku), undefined, {
      numeric: true,
      sensitivity: "base",
    }) || first.itemName.localeCompare(second.itemName, undefined, { sensitivity: "base" }))
    .map(({ key, ...item }) => Object.freeze(item));
}

export function createPaymentRequestDocumentModel(request = {}) {
  const items = canonicalItems(request);
  const itemTotal = paymentMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const merchandiseSubtotal = requiredMoney(
    request.merchandiseSubtotal ?? request.itemPrice,
    "Payment Request document totals are invalid.",
  );
  const discount = requiredMoney(request.discount ?? 0, "Payment Request document totals are invalid.");
  const shippingFee = requiredMoney(request.shippingFee ?? 0, "Payment Request document totals are invalid.");
  const grandTotal = requiredMoney(request.totalAmount, "Payment Request document totals are invalid.");
  const shippingMode = normalizeShippingMode(request.shippingMode);
  const collectedShipping = shippingMode === SHIPPING_MODES.FEE_NOW ? shippingFee : 0;
  const expectedTotal = paymentMoney(merchandiseSubtotal - discount + collectedShipping);

  if (
    cents(itemTotal) !== cents(merchandiseSubtotal)
    || discount > merchandiseSubtotal
    || cents(expectedTotal) !== cents(grandTotal)
  ) {
    throw new Error("Payment Request document totals are invalid.");
  }

  const paymentConfig = request.paymentConfig && typeof request.paymentConfig === "object"
    ? {
        gcashAccountName: cleanSnapshotText(request.paymentConfig.gcashAccountName),
        gcashMobileNumber: cleanSnapshotText(request.paymentConfig.gcashMobileNumber),
        gotymeAccountName: cleanSnapshotText(request.paymentConfig.gotymeAccountName),
      }
    : { gcashAccountName: "", gcashMobileNumber: "", gotymeAccountName: "" };

  return Object.freeze({
    requestNumber: cleanSnapshotText(request.requestNumber) || "Payment Request",
    customerName: cleanSnapshotText(request.customerName) || "Unavailable",
    customerContact: cleanSnapshotText(request.customerContact),
    shippingAddress: cleanSnapshotText(request.shippingAddress),
    issuedAt: request.issuedAt || request.createdAt || null,
    validUntil: request.validUntil || null,
    status: cleanSnapshotText(request.status) || "Unavailable",
    paymentMethod: cleanSnapshotText(request.paymentMethod),
    paymentConfig: Object.freeze(paymentConfig),
    shippingMode,
    shippingMethod: SHIPPING_MODE_LABELS[shippingMode],
    courier: shippingMode === SHIPPING_MODES.PICKUP ? "" : cleanSnapshotText(request.courier),
    customerNote: cleanSnapshotText(request.customerNote),
    items: Object.freeze(items),
    itemCount: items.length,
    merchandiseSubtotal,
    discount,
    shippingFee,
    collectedShipping,
    grandTotal,
  });
}
