import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { createPaymentRequestDocumentModel } from "../src/core/paymentRequestDocuments.js";
import { getSafeUserError } from "../src/services/errorService.js";
import { getPaymentRequestImagePlan, MAX_PAYMENT_REQUEST_IMAGE_ITEMS } from "../src/services/paymentRequestImage.js";
import { createPaymentRequestPdf } from "../src/services/paymentRequestPdf.js";

const paymentConfig = {
  gcashAccountName: "Configured GCash Account",
  gcashMobileNumber: "09000000000",
  gotymeAccountName: "Configured GoTyme Account",
  gotymeQrImage: "/payment/gotyme-instapay-qr.png",
};

function requestWithItems(count, options = {}) {
  const items = Array.from({ length: count }, (_, index) => ({
    inventoryItemId: `snapshot-${index + 1}`,
    sku: options.longSku ? `NK-${String(index + 1).padStart(3, "0")}-SERIALIZED-REFERENCE-THAT-WRAPS` : `NK-${String(index + 1).padStart(3, "0")}`,
    itemName: options.longName
      ? `A deliberately long immutable product snapshot number ${index + 1} that must wrap without clipping or overlap in customer documents`
      : `Snapshot Product ${index + 1}`,
    unitPrice: options.largeCurrency ? 9_999_999.99 - index : 100 + index,
    quantity: 1,
    lineTotal: options.largeCurrency ? 9_999_999.99 - index : 100 + index,
    collectionId: index % 2 ? "Spring" : "Archive",
  }));
  const merchandiseSubtotal = Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
  const discount = options.discount ?? Math.min(25, merchandiseSubtotal);
  const shippingFee = options.shippingFee ?? 50;
  return {
    id: "request-header-not-for-output",
    requestNumber: "PR-DOCUMENT-CONTROLLED",
    customerName: "Controlled Customer Snapshot",
    customerContact: "09000000000",
    shippingAddress: "A controlled local-only shipping address with enough text to verify wrapping behavior",
    shippingMode: options.shippingMode || "fee_now",
    shippingFee,
    courier: "J&T",
    discount,
    merchandiseSubtotal,
    totalAmount: Math.round((merchandiseSubtotal - discount + (options.shippingMode === "to_follow" || options.shippingMode === "pickup" ? 0 : shippingFee)) * 100) / 100,
    status: "Pending",
    issuedAt: "2026-07-16",
    validUntil: "2026-07-20",
    paymentMethod: "",
    paymentConfig,
    items,
  };
}

test("document model supports canonical, deterministic, duplicate-free, and legacy snapshots", () => {
  const canonical = requestWithItems(2);
  canonical.items = [canonical.items[1], canonical.items[0], { ...canonical.items[0] }];
  canonical.merchandiseSubtotal = 201;
  canonical.totalAmount = 226;
  const model = createPaymentRequestDocumentModel(canonical);
  assert.deepEqual(model.items.map((item) => item.sku), ["NK-001", "NK-002"]);
  assert.equal(model.itemCount, 2);
  assert.equal(model.merchandiseSubtotal, 201);
  assert.equal(model.grandTotal, 226);
  assert.equal("inventoryItemId" in model.items[0], false, "internal identifiers are excluded from the view model");

  const legacy = createPaymentRequestDocumentModel({
    itemId: "legacy-internal-id",
    sku: "NK-LEGACY",
    itemName: "Legacy Snapshot",
    itemPrice: 125,
    merchandiseSubtotal: 125,
    shippingFee: 0,
    discount: 0,
    totalAmount: 125,
    shippingMode: "fee_now",
  });
  assert.equal(legacy.itemCount, 1);
  assert.equal(legacy.items[0].itemName, "Legacy Snapshot");
});

test("document model rejects missing, malformed, non-snapshot, and inconsistent financial data safely", () => {
  assert.throws(() => createPaymentRequestDocumentModel({ totalAmount: 0 }), /has no items/i);
  const malformed = requestWithItems(1);
  malformed.items[0].lineTotal = "not-a-number";
  assert.throws(() => createPaymentRequestDocumentModel(malformed), /item snapshots are invalid/i);
  const inconsistent = requestWithItems(2);
  inconsistent.totalAmount += 1;
  assert.throws(() => createPaymentRequestDocumentModel(inconsistent), /totals are invalid/i);
  const snapshotOnly = requestWithItems(1);
  snapshotOnly.inventory = [{ id: "snapshot-1", price: 1 }];
  assert.equal(createPaymentRequestDocumentModel(snapshotOnly).items[0].unitPrice, 100);
});

test("image plan includes every supported item and safely redirects oversized requests to PDF", () => {
  assert.equal(MAX_PAYMENT_REQUEST_IMAGE_ITEMS, 10);
  for (const count of [1, 2, 10]) {
    const plan = getPaymentRequestImagePlan(requestWithItems(count, { longName: true, longSku: true }));
    assert.equal(plan.rows.length, count);
    assert.ok(plan.rows.every((row) => row.nameLines.length >= 2 && row.height >= 104));
  }
  assert.throws(() => getPaymentRequestImagePlan(requestWithItems(11)), /download the pdf instead/i);
  assert.equal(
    getSafeUserError(new Error("This Payment Request has too many items for one image. Download the PDF instead."), "document"),
    "This Payment Request is too large for one image. Download the PDF instead.",
  );
});

test("PDF generates complete paginated documents for 1 through 50 items", async () => {
  const originalFetch = globalThis.fetch;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  globalThis.fetch = async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  try {
    let previousPages = 0;
    for (const count of [1, 2, 10, 25, 50]) {
      const bytes = await createPaymentRequestPdf(requestWithItems(count, {
        longName: true,
        longSku: true,
        largeCurrency: count === 2,
        shippingFee: count === 1 ? 0 : 50,
      }), paymentConfig);
      const pdf = await PDFDocument.load(bytes);
      assert.ok(bytes.length > 1_000);
      assert.ok(pdf.getPageCount() >= previousPages);
      previousPages = pdf.getPageCount();
    }
    assert.ok(previousPages > 1, "50 items must paginate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("document failures normalize without exposing underlying exceptions", async () => {
  await assert.rejects(createPaymentRequestPdf(requestWithItems(1), {}), /configure gcash details/i);
  assert.equal(
    getSafeUserError(new Error("private backend detail should never surface"), "document"),
    "We couldn't prepare this document. Please try again.",
  );
});
