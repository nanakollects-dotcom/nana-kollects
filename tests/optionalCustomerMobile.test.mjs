import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createServer } from "vite";

import {
  validatePaymentRequestRequiredFields,
} from "../src/core/paymentRequests.js";
import { createPaymentRequestDocumentModel } from "../src/core/paymentRequestDocuments.js";
import { createPaymentRequestPdf } from "../src/services/paymentRequestPdf.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TODAY = "2026-07-17";
const VALID_UNTIL = "2026-07-18";
const paymentConfig = {
  gcashAccountName: "Configured Account",
  gcashMobileNumber: "09000000000",
  gotymeAccountName: "Configured Account",
  gotymeQrImage: "/payment/gotyme-instapay-qr.png",
};

function request(customerContact = "") {
  return {
    requestNumber: "PR-OPTIONAL-CONTACT",
    customerName: "Controlled Customer",
    customerContact,
    shippingAddress: "",
    shippingMode: "pickup",
    shippingFee: 0,
    discount: 0,
    merchandiseSubtotal: 100,
    totalAmount: 100,
    status: "Pending",
    issuedAt: TODAY,
    validUntil: VALID_UNTIL,
    paymentConfig,
    items: [{
      inventoryItemId: "item-one",
      sku: "NK-001",
      itemName: "Controlled Item",
      unitPrice: 100,
      quantity: 1,
      lineTotal: 100,
    }],
  };
}

test("blank mobile is accepted, customer name stays required, and supplied numbers retain validation", () => {
  const blank = validatePaymentRequestRequiredFields({
    customerName: " Controlled Customer ",
    customerContact: " ",
    validUntil: VALID_UNTIL,
  }, TODAY);
  assert.deepEqual(blank.errors, {});
  assert.equal(blank.values.customerName, "Controlled Customer");
  assert.equal(blank.values.customerContact, "");

  const missingName = validatePaymentRequestRequiredFields({
    customerName: "",
    customerContact: "",
    validUntil: VALID_UNTIL,
  }, TODAY);
  assert.equal(missingName.errors.customerName, "Customer name is required.");
  assert.equal("customerContact" in missingName.errors, false);

  const valid = validatePaymentRequestRequiredFields({
    customerName: "Controlled Customer",
    customerContact: "+639171234567",
    validUntil: VALID_UNTIL,
  }, TODAY);
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.values.customerContact, "09171234567");

  const malformed = validatePaymentRequestRequiredFields({
    customerName: "Controlled Customer",
    customerContact: "not-a-mobile",
    validUntil: VALID_UNTIL,
  }, TODAY);
  assert.equal(malformed.errors.customerContact, "Enter a valid Philippine mobile number.");
});

test("single-item, multi-item, and valid-contact submissions call the creation RPC exactly once each", async () => {
  globalThis.__optionalContactRpc = [];
  const virtualClient = "\0optional-contact-client";
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "optional-contact-rpc-client",
      enforce: "pre",
      resolveId(source) {
        if (source === "./supabaseClient.js") return virtualClient;
        return null;
      },
      load(id) {
        if (id !== virtualClient) return null;
        return `
          export const supabase = {
            auth: { getUser: async () => ({ data: { user: { id: "controlled-user" } }, error: null }) },
            rpc: async (name, args) => {
              globalThis.__optionalContactRpc.push({ name, args });
              return { data: { payment_request: { id: "created-request" } }, error: null };
            },
          };
        `;
      },
    }],
  });

  try {
    const service = await server.ssrLoadModule("/src/services/supabaseStorage.js?optional-contact=rpc");
    const base = {
      customerName: "Controlled Customer",
      customerContact: "",
      validUntil: VALID_UNTIL,
      shippingMode: "pickup",
      discount: 0,
      paymentConfig,
    };
    await service.createSupabasePaymentRequest({ ...base, itemId: "item-one", itemPrice: 100 });
    await service.createSupabasePaymentRequest({
      ...base,
      items: [
        { inventoryItemId: "item-two", unitPrice: 100 },
        { inventoryItemId: "item-three", unitPrice: 125 },
      ],
    });
    await service.createSupabasePaymentRequest({
      ...base,
      customerContact: "09171234567",
      itemId: "item-four",
      itemPrice: 150,
    });

    assert.equal(globalThis.__optionalContactRpc.length, 3);
    assert.ok(globalThis.__optionalContactRpc.every((call) => call.name === "create_payment_request_v2"));
    assert.equal(globalThis.__optionalContactRpc[0].args.p_customer_contact, null);
    assert.equal(globalThis.__optionalContactRpc[1].args.p_customer_contact, null);
    assert.equal(globalThis.__optionalContactRpc[2].args.p_customer_contact, "09171234567");
    assert.equal(globalThis.__optionalContactRpc[0].args.p_items.length, 1);
    assert.equal(globalThis.__optionalContactRpc[1].args.p_items.length, 2);
  } finally {
    await server.close();
    delete globalThis.__optionalContactRpc;
  }
});

test("form, details, and Order rendering handle an absent mobile number without placeholders", async () => {
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const inventoryPage = await server.ssrLoadModule("/src/pages/inventory.js?optional-contact=ui");
    const paymentRequestsPage = await server.ssrLoadModule("/src/pages/paymentRequests.js?optional-contact=ui");
    const ordersPage = await server.ssrLoadModule("/src/pages/orders.js?optional-contact=ui");
    const inventory = [{
      id: "item-one",
      sku: "NK-001",
      name: "Controlled Item",
      collectionId: "Controlled",
      cost: 50,
      price: 100,
      status: "Available",
      createdAt: TODAY,
    }];
    const store = {
      inventory,
      paymentRequests: [],
      paymentConfig,
      collections: [{ id: "collection-one", name: "Controlled" }],
      sales: [],
      purchases: [],
      expenses: [],
    };
    inventoryPage.resetInventoryPageState();
    inventoryPage.setInventoryItemSelected(store, "item-one", true);
    assert.equal(inventoryPage.openInventoryPaymentRequest(store), true);
    const formHtml = inventoryPage.renderInventoryPage(store);
    assert.match(formHtml, /Mobile Number \(Optional\)/);
    assert.match(formHtml, /name="customerContact"[^>]*placeholder="Optional"/);
    assert.doesNotMatch(formHtml, /Mobile number is required/);

    store.paymentRequests = [request("")];
    const detailHtml = paymentRequestsPage.renderPaymentRequestsPage(store);
    assert.doesNotMatch(detailHtml, /<dt>Contact<\/dt>/);

    const orderHtml = ordersPage.renderOrdersPage({
      ...store,
      orders: [{
        id: "order-one",
        orderNumber: "ORD-OPTIONAL-CONTACT",
        fulfillmentStatus: "ready_to_pack",
        fulfillmentMethod: "pickup",
        customerName: "Controlled Customer",
        customerContact: "",
        totalPaid: 100,
        createdAt: TODAY,
      }],
      orderItems: [{
        id: "order-item-one",
        orderId: "order-one",
        itemName: "Controlled Item",
        sku: "NK-001",
        quantity: 1,
        sellingPrice: 100,
        packingRequired: true,
      }],
      orderEvents: [],
    });
    assert.match(orderHtml, /No contact number/);
    assert.doesNotMatch(orderHtml, />undefined<|>null</);
  } finally {
    await server.close();
  }
});

test("image and PDF paths omit an absent mobile row and preserve an existing number", async () => {
  const blankModel = createPaymentRequestDocumentModel(request(""));
  const populatedModel = createPaymentRequestDocumentModel(request("09171234567"));
  assert.equal(blankModel.customerContact, "");
  assert.equal(populatedModel.customerContact, "09171234567");

  const imageSource = await readFile(new URL("../src/services/paymentRequestImage.js", import.meta.url), "utf8");
  const pdfSource = await readFile(new URL("../src/services/paymentRequestPdf.js", import.meta.url), "utf8");
  assert.match(imageSource, /if \(model\.customerContact\)[\s\S]*detail\("Mobile Number"/);
  assert.match(pdfSource, /if \(model\.customerContact\)[\s\S]*detail\("Mobile Number"/);

  const originalFetch = globalThis.fetch;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  globalThis.fetch = async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  try {
    const blankPdf = await createPaymentRequestPdf(request(""), paymentConfig);
    const populatedPdf = await createPaymentRequestPdf(request("09171234567"), paymentConfig);
    assert.ok((await PDFDocument.load(blankPdf)).getPageCount() >= 1);
    assert.ok((await PDFDocument.load(populatedPdf)).getPageCount() >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
