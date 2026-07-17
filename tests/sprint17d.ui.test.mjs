import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { calculatePaymentRequestTotal, SHIPPING_MODES } from "../src/core/paymentRequests.js";
import { getSafeUserError } from "../src/services/errorService.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let server;
let inventoryPage;
let paymentRequestsPage;

before(async () => {
  server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  inventoryPage = await server.ssrLoadModule("/src/pages/inventory.js?sprint17d=ui");
  paymentRequestsPage = await server.ssrLoadModule("/src/pages/paymentRequests.js?sprint17d=ui");
});

after(async () => {
  await server?.close();
});

const item = (index, status = "Available") => ({
  id: `item-${index}`,
  sku: `NK-${String(index).padStart(3, "0")}`,
  name: `Inventory Item ${index}`,
  collectionId: index % 2 ? "Spring" : "Archive",
  cost: 25,
  price: 100 + index,
  status,
  createdAt: "2026-07-01T00:00:00.000Z",
});

const paymentConfig = {
  gcashAccountName: "Configured Account",
  gcashMobileNumber: "09000000000",
  gotymeAccountName: "Configured Account",
  gotymeQrImage: "/payment/gotyme-instapay-qr.png",
};

function storeFor(inventory, paymentRequests = []) {
  return {
    inventory,
    paymentRequests,
    paymentConfig,
    collections: [{ id: "collection-1", name: "Spring" }, { id: "collection-2", name: "Archive" }],
    sales: [],
    purchases: [],
    expenses: [],
  };
}

function requestWithItems(count) {
  const items = Array.from({ length: count }, (_, index) => ({
    inventoryItemId: `item-${index + 1}`,
    sku: `NK-${String(index + 1).padStart(3, "0")}`,
    itemName: `Product ${index + 1}`,
    unitPrice: 100 + index,
    quantity: 1,
    lineTotal: 100 + index,
  }));
  const subtotal = items.reduce((sum, entry) => sum + entry.lineTotal, 0);
  return {
    id: "request-header",
    requestNumber: "PR-CONTROLLED",
    customerName: "Controlled Customer",
    customerContact: "09000000000",
    shippingAddress: "A controlled test address used only in memory",
    shippingMode: "fee_now",
    shippingFee: 50,
    courier: "J&T",
    discount: 25,
    merchandiseSubtotal: subtotal,
    totalAmount: subtotal + 25,
    status: "Pending",
    issuedAt: "2026-07-16",
    validUntil: "2026-07-20",
    items,
  };
}

test("Inventory selection supports one, many, deselect, clear, rerender, and reset", () => {
  inventoryPage.resetInventoryPageState();
  const store = storeFor([item(1), item(2), item(3)]);
  assert.deepEqual(inventoryPage.setInventoryItemSelected(store, "item-1", true), { ok: true });
  assert.deepEqual(inventoryPage.setInventoryItemSelected(store, "item-2", true), { ok: true });
  assert.equal(inventoryPage.getInventorySelection(store).count, 2);
  assert.equal(inventoryPage.getInventorySelection(store).subtotal, 203);

  inventoryPage.setInventoryCollectionFilter("Spring");
  assert.equal(inventoryPage.getInventorySelection(store).count, 2, "filter rerenders must not lose selection");
  assert.match(inventoryPage.renderInventoryPage(store), /2 items selected/);

  store.inventory.reverse();
  const sortedHtml = inventoryPage.renderInventoryPage(store);
  assert.ok(sortedHtml.indexOf("NK-003") < sortedHtml.indexOf("NK-001"), "the existing SKU sort remains deterministic");
  assert.equal(inventoryPage.getInventorySelection(store).count, 2, "sorting must not lose selection");

  inventoryPage.setInventoryItemSelected(store, "item-1", false);
  assert.deepEqual(inventoryPage.getInventorySelection(store).ids, ["item-2"]);
  inventoryPage.clearInventorySelection();
  assert.equal(inventoryPage.getInventorySelection(store).count, 0);
  inventoryPage.setInventoryItemSelected(store, "item-3", true);
  inventoryPage.resetInventoryPageState();
  assert.equal(inventoryPage.getInventorySelection(store).count, 0, "logout/reset must clear selection");
});

test("Inventory selection rejects unavailable items and a 51st serialized item", () => {
  inventoryPage.resetInventoryPageState();
  const inventory = Array.from({ length: 52 }, (_, index) => item(index + 1));
  inventory.push(item(60, "Reserved"), item(61, "Sold"), item(62, "Archived"));
  const store = storeFor(inventory, [{ id: "pending", status: "Pending", items: [{ inventoryItemId: "item-52" }] }]);

  for (let index = 1; index <= 50; index += 1) {
    assert.equal(inventoryPage.setInventoryItemSelected(store, `item-${index}`, true).ok, true);
  }
  assert.equal(inventoryPage.setInventoryItemSelected(store, "item-51", true).ok, false);
  assert.equal(inventoryPage.setInventoryItemSelected(store, "item-52", true).ok, false);
  assert.equal(inventoryPage.setInventoryItemSelected(store, "item-60", true).ok, false);
  assert.equal(inventoryPage.setInventoryItemSelected(store, "item-61", true).ok, false);
  assert.equal(inventoryPage.setInventoryItemSelected(store, "item-62", true).ok, false);
  assert.equal(inventoryPage.getInventorySelection(store).count, 50);
});

test("Inventory desktop and mobile markup expose accessible selection without changing Edit", () => {
  inventoryPage.resetInventoryPageState();
  const store = storeFor([item(1), item(2, "Reserved")]);
  inventoryPage.setInventoryItemSelected(store, "item-1", true);
  const html = inventoryPage.renderInventoryPage(store);
  assert.match(html, /<th class="inventory-select-cell">Select<\/th>/);
  assert.match(html, /aria-label="Select Inventory Item 1" checked/);
  assert.match(html, /Selected for Payment Request/);
  assert.match(html, /Unavailable for selection/);
  assert.match(html, /data-edit="item-1"/);
  assert.match(html, /Create Payment Request/);
});

test("Payment Request checkout and dedicated workspace render every item once without duplicating headers", () => {
  inventoryPage.resetInventoryPageState();
  paymentRequestsPage.resetPaymentRequestsPageState();
  const savedRequest = requestWithItems(2);
  savedRequest.status = "Paid";
  const store = storeFor([item(1), item(2)], [savedRequest]);
  inventoryPage.setInventoryItemSelected(store, "item-1", true);
  inventoryPage.setInventoryItemSelected(store, "item-2", true);
  assert.equal(inventoryPage.openInventoryPaymentRequest(store), true);
  const html = inventoryPage.renderInventoryPage(store);
  assert.equal((html.match(/data-request-item-row=/g) || []).length, 2);
  assert.match(html, /data-line-price="item-1"/);
  assert.match(html, /min="0.01"/);
  assert.match(html, /data-remove-selected-item="item-2"/);
  assert.match(html, /Merchandise Subtotal/);
  assert.doesNotMatch(html, /payment-request-list/, "Inventory must not render the saved request workspace");

  const workspaceHtml = paymentRequestsPage.renderPaymentRequestsPage(store);
  assert.equal((workspaceHtml.match(/<h2>PR-CONTROLLED<\/h2>/g) || []).length, 1, "one request header must render once");
  assert.match(workspaceHtml, /Product 1 \+1 more/);
  assert.match(workspaceHtml, /2 items/);
  assert.equal((workspaceHtml.match(/class="payment-request-snapshot-item"/g) || []).length, 2, "every snapshot item renders once");
  assert.match(workspaceHtml, /View Details/);
  assert.match(workspaceHtml, /Merchandise Subtotal/);
  assert.match(workspaceHtml, /Discount/);
  assert.match(workspaceHtml, /Shipping/);
});

test("Multi-item totals and safe price validation remain deterministic", () => {
  const totals = calculatePaymentRequestTotal(
    [
      { inventoryItemId: "item-1", unitPrice: 400, quantity: 1 },
      { inventoryItemId: "item-2", unitPrice: 375, quantity: 1 },
    ],
    50,
    25,
    SHIPPING_MODES.FEE_NOW,
  );
  assert.deepEqual(totals, {
    itemPrice: 775,
    merchandiseSubtotal: 775,
    shippingFee: 50,
    discount: 25,
    total: 800,
  });
  assert.equal(
    getSafeUserError(new Error("Item prices must be higher than zero."), "payment_request"),
    "Enter a selling price higher than zero for every item.",
  );
});
