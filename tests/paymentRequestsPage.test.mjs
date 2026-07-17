import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let server;
let page;
let inventoryPage;

const paymentConfig = {
  gcashAccountName: "Configured Account",
  gcashMobileNumber: "09000000000",
  gotymeAccountName: "Configured Account",
  gotymeQrImage: "/payment/gotyme-instapay-qr.png",
};

function request(id, status, customerName, issuedAt, amount, itemNames = ["Controlled Item"]) {
  const items = itemNames.map((itemName, index) => ({
    id: `${id}-item-${index}`,
    inventoryItemId: `${id}-inventory-${index}`,
    sku: `NK-${id.toUpperCase()}-${index + 1}`,
    itemName,
    unitPrice: amount / itemNames.length,
    quantity: 1,
    lineTotal: amount / itemNames.length,
  }));
  return {
    id,
    requestNumber: `PR-${id.toUpperCase()}`,
    customerName,
    customerContact: "09171234567",
    shippingAddress: "Controlled local-only address",
    shippingMode: "fee_now",
    shippingFee: 0,
    courier: "J&T",
    discount: 0,
    merchandiseSubtotal: amount,
    totalAmount: amount,
    status,
    issuedAt,
    validUntil: "2026-07-30",
    paymentConfig,
    items,
  };
}

function storeFor(paymentRequests = []) {
  return {
    inventory: [],
    paymentRequests,
    paymentConfig,
    collections: [],
    sales: [],
    purchases: [],
    expenses: [],
  };
}

before(async () => {
  server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  page = await server.ssrLoadModule("/src/pages/paymentRequests.js?dedicated-workspace");
  inventoryPage = await server.ssrLoadModule("/src/pages/inventory.js?dedicated-workspace");
});

beforeEach(() => {
  page.resetPaymentRequestsPageState();
  inventoryPage.resetInventoryPageState();
});

after(async () => {
  await server?.close();
});

test("dedicated page renders direct controls, empty state, and accessible labels", () => {
  const emptyHtml = page.renderPaymentRequestsPage(storeFor());
  assert.match(emptyHtml, /<h1>Payment Requests<\/h1>/);
  assert.match(emptyHtml, /0 saved requests/);
  assert.match(emptyHtml, /Search payment requests/);
  assert.match(emptyHtml, /All Statuses/);
  assert.match(emptyHtml, /Newest first/);
  assert.match(emptyHtml, /No payment requests yet\./);
  assert.match(emptyHtml, /Create one from the Inventory page after selecting an item\./);
  assert.match(emptyHtml, /data-payment-request-inventory/);
});

test("search matches reference, customer, child item, and SKU without duplicate headers", () => {
  const requests = [
    request("one", "Pending", "Alpha Customer", "2026-07-10", 100, ["First Product"]),
    request("two", "Paid", "Beta Customer", "2026-07-11", 200, ["Second Product", "Long Child Product"]),
    request("three", "Cancelled", "Gamma Customer", "2026-07-12", 300, ["Third Product"]),
  ];
  const store = storeFor([...requests, requests[1]]);

  page.setPaymentRequestSearch("pr-two");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["two"]);
  page.setPaymentRequestSearch("beta customer");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["two"]);
  page.setPaymentRequestSearch("long child");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["two"]);
  page.setPaymentRequestSearch("nk-two-2");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["two"]);

  const html = page.renderPaymentRequestsPage(store);
  assert.equal((html.match(/<h2>PR-TWO<\/h2>/g) || []).length, 1);
});

test("canonical status filters and sort controls use request headers only", () => {
  const store = storeFor([
    request("one", "Pending", "Alpha", "2026-07-10", 100),
    request("two", "Paid", "Beta", "2026-07-12", 300),
    request("three", "Cancelled", "Gamma", "2026-07-11", 200),
  ]);

  for (const status of ["Pending", "Paid", "Cancelled"]) {
    page.resetPaymentRequestsPageState();
    page.setPaymentRequestStatusFilter(status);
    assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.status), [status]);
  }

  page.resetPaymentRequestsPageState();
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["two", "three", "one"]);
  page.setPaymentRequestSort("oldest");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["one", "three", "two"]);
  page.setPaymentRequestSort("highest");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["two", "three", "one"]);
  page.setPaymentRequestSort("lowest");
  assert.deepEqual(page.getVisiblePaymentRequests(store).map((entry) => entry.id), ["one", "three", "two"]);
});

test("multi-item summaries, immutable details, and conditional actions render once per request", () => {
  const pending = request("pending", "Pending", "Controlled Customer", "2026-07-12", 600, [
    "First Product",
    "Second Product",
    "Third Product",
  ]);
  const paid = request("paid", "Paid", "Paid Customer", "2026-07-11", 200);
  const cancelled = request("cancelled", "Cancelled", "Cancelled Customer", "2026-07-10", 100);
  const html = page.renderPaymentRequestsPage(storeFor([pending, paid, cancelled]));

  assert.match(html, /First Product \+2 more/);
  assert.match(html, /3 items/);
  assert.equal((html.match(/data-payment-request-card="pending"/g) || []).length, 1);
  assert.equal((html.match(/data-payment-request-details="pending"/g) || []).length, 1);
  assert.equal((html.match(/class="payment-request-snapshot-item"/g) || []).length, 5);
  assert.match(html, /Merchandise Subtotal/);
  assert.match(html, /Grand Total/);
  assert.match(html, /Shipping Address/);
  assert.match(html, /Share \/ Save Image/);
  assert.match(html, /Download PDF/);
  assert.equal((html.match(/data-paid-request=/g) || []).length, 1);
  assert.equal((html.match(/data-cancel-request=/g) || []).length, 1);
  assert.match(html, /aria-label="Mark PR-PENDING paid"/);
  assert.match(html, /aria-label="Cancel PR-PENDING"/);
  assert.match(html, /<details[^>]*data-payment-request-details="pending"/);
  assert.match(html, /<summary aria-label="View details for PR-PENDING">View Details<\/summary>/);
});

test("Inventory keeps checkout but no longer renders the full Payment Request list", () => {
  const savedRequest = request("saved", "Pending", "Controlled Customer", "2026-07-12", 100);
  const store = storeFor([savedRequest]);
  store.inventory = [{
    id: "available-item",
    sku: "NK-AVAILABLE",
    name: "Available Item",
    collectionId: "Controlled",
    cost: 50,
    price: 100,
    status: "Available",
    createdAt: "2026-07-12",
  }];
  inventoryPage.setInventoryItemSelected(store, "available-item", true);
  const html = inventoryPage.renderInventoryPage(store);
  assert.match(html, /<h1>Inventory<\/h1>/);
  assert.match(html, /Create Payment Request/);
  assert.match(html, /Payment Details/);
  assert.doesNotMatch(html, /payment-request-list/);
  assert.doesNotMatch(html, /PR-SAVED/);
});

test("navigation, refresh routing, creation handoff, and store-only data access stay explicit", async () => {
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const inventorySource = await readFile(new URL("../src/pages/inventory.js", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../src/pages/paymentRequests.js", import.meta.url), "utf8");

  const inventoryPosition = appSource.indexOf('id: "inventory"');
  const paymentPosition = appSource.indexOf('id: "payment-requests"');
  const salesPosition = appSource.indexOf('id: "sales"');
  assert.ok(inventoryPosition < paymentPosition && paymentPosition < salesPosition);
  assert.match(appSource, /pageFromHash/);
  assert.match(appSource, /window\.addEventListener\("hashchange"/);
  assert.match(appSource, /aria-current="page"/);
  assert.match(appSource, /setPaymentRequestFocus/);
  assert.match(inventorySource, /data-view-payment-request/);
  assert.match(inventorySource, /page: "payment-requests", paymentRequestId: requestId/);
  assert.doesNotMatch(pageSource, /syncSupabaseStore|loadSupabase|from "\.\.\/services\/supabase|fetch\(/);
  assert.match(pageSource, /markPaymentRequestPaid/);
  assert.match(pageSource, /cancelPaymentRequest/);
  assert.match(pageSource, /aria-busy/);
});
