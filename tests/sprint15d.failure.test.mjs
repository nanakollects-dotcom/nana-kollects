import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

import { createServer } from "vite";

import {
  createSafeUserError,
  getSafeErrorCategory,
  getSafeUserError,
} from "../src/services/errorService.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOSTILE_VALUES = [
  "select * from public.orders",
  "orders_source_payment_request_unique",
  "private_rls_policy",
  "https://private-project.supabase.co",
  "81111111-1111-4111-8111-111111111111",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature",
  "private@example.com",
  "Secret Customer Name",
  "09999999999",
  "private-access-token",
  "private-refresh-token",
  "stack trace at mark_order_packed",
  "private request and response body",
];

let server;

before(async () => {
  server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
});

after(async () => {
  await server?.close();
});

test("mutation success plus refresh failure remains recoverable without repeating mutation", async () => {
  globalThis.__sprint15dRepository = {
    failRefresh: true,
    mutationCount: 0,
    refreshCount: 0,
    replaceCount: 0,
    secret: HOSTILE_VALUES.join(" | "),
  };

  const virtualStorage = "\0sprint15d-storage";
  const virtualOrders = "\0sprint15d-orders";
  const virtualSupabaseStorage = "\0sprint15d-supabase-storage";
  const repositoryServer = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "sprint15d-repository-failures",
      enforce: "pre",
      resolveId(source, importer) {
        const cleanImporter = importer?.split("?")[0].replaceAll("\\", "/");
        if (!cleanImporter?.endsWith("/src/services/repository.js")) return null;
        if (source === "./storage.js") return virtualStorage;
        if (source === "./orderService.js") return virtualOrders;
        if (source === "./supabaseStorage.js") return virtualSupabaseStorage;
        return null;
      },
      load(id) {
        if (id === virtualStorage) return `
          export const getAuthenticatedStoreGeneration = () => 1;
          export const loadStore = () => ({});
          export const replaceStore = (value) => { globalThis.__sprint15dRepository.replaceCount += 1; return value; };
        `;
        if (id === virtualOrders) return `
          const mutate = async () => { globalThis.__sprint15dRepository.mutationCount += 1; };
          export const loadSupabaseOrders = async () => ({ orders: [], orderItems: [], orderEvents: [] });
          export const markSupabaseOrderCompleted = mutate;
          export const markSupabaseOrderPacked = mutate;
          export const markSupabaseOrderShipped = mutate;
          export const reopenSupabaseOrderPacking = mutate;
          export const setSupabaseOrderItemPacked = mutate;
          export const startSupabaseOrderPacking = mutate;
        `;
        if (id === virtualSupabaseStorage) return `
          export const loadSupabaseStore = async () => {
            globalThis.__sprint15dRepository.refreshCount += 1;
            if (globalThis.__sprint15dRepository.failRefresh) throw new Error(globalThis.__sprint15dRepository.secret);
            return { orders: [], orderItems: [], orderEvents: [] };
          };
          export const createSupabaseCollection = async () => ({});
          export const updateSupabaseCollection = async () => ({});
          export const archiveSupabaseCollection = async () => ({});
          export const deleteSupabaseCollection = async () => ({});
          export const createSupabaseInventoryItem = async () => ({});
          export const updateSupabaseInventoryItem = async () => ({});
          export const changeSupabaseInventoryStatus = async () => ({});
          export const deleteSupabaseInventoryItem = async () => ({});
          export const updateSupabaseSale = async () => ({});
          export const createSupabaseExpense = async () => ({});
          export const updateSupabaseExpense = async () => ({});
          export const deleteSupabaseExpense = async () => ({});
          export const createSupabaseCapitalEntry = async () => ({});
          export const updateSupabaseCapitalEntry = async () => ({});
          export const replaceSupabaseStoreFromBackup = async () => ({});
          export const saveSupabasePaymentConfig = async () => ({});
          export const createSupabasePaymentRequest = async () => ({});
          export const markSupabasePaymentRequestPaid = async () => ({});
          export const cancelSupabasePaymentRequest = async () => ({});
        `;
        return null;
      },
    }],
  });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values.join(" "));
  try {
    const repository = await repositoryServer.ssrLoadModule("/src/services/repository.js?sprint15d=refresh");
    await assert.rejects(
      repository.markOrderPacked("controlled-order"),
      (error) => {
        assert.equal(error.name, "SafeUserError");
        assert.equal(error.mutationSucceeded, true);
        assert.equal(
          error.message,
          "The change was saved, but the latest Order data could not be reloaded. Refresh the page to confirm it.",
        );
        return true;
      },
    );
    assert.equal(globalThis.__sprint15dRepository.mutationCount, 1);
    assert.equal(globalThis.__sprint15dRepository.refreshCount, 1);

    globalThis.__sprint15dRepository.failRefresh = false;
    await repository.syncSupabaseStore();
    assert.equal(globalThis.__sprint15dRepository.mutationCount, 1);
    assert.equal(globalThis.__sprint15dRepository.refreshCount, 2);
    assert.equal(globalThis.__sprint15dRepository.replaceCount, 1);

    const output = warnings.join("\n").toLowerCase();
    for (const value of HOSTILE_VALUES) assert.doesNotMatch(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  } finally {
    console.warn = originalWarn;
    await repositoryServer.close();
    delete globalThis.__sprint15dRepository;
  }
});

test("expired sessions clear authenticated state and suppress duplicate loads", async () => {
  class MemoryStorage {
    constructor() { this.values = new Map(); }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
  }

  globalThis.window = new EventTarget();
  globalThis.localStorage = new MemoryStorage();
  const storage = await server.ssrLoadModule("/src/services/storage.js?sprint15d=session");
  const auth = await server.ssrLoadModule("/src/services/authService.js?sprint15d=session");
  storage.replaceStore({ orders: [{ id: "controlled-order" }] });

  let loads = 0;
  let ready = 0;
  let errors = 0;
  const clears = [];
  const coordinator = auth.createAuthStateCoordinator({
    onClear: async (reason) => { clears.push(reason); storage.clearAuthenticatedStore(); },
    onLoad: async () => { loads += 1; },
    onReady: async () => { ready += 1; },
    onError: async () => { errors += 1; },
  });

  await coordinator.handle("INITIAL_SESSION", { user: { id: "controlled-user" }, access_token: HOSTILE_VALUES[9] });
  await coordinator.handle("TOKEN_REFRESHED", { user: { id: "controlled-user" }, refresh_token: HOSTILE_VALUES[10] });
  assert.equal(loads, 1);
  assert.equal(ready, 1);
  assert.equal(errors, 0);

  await coordinator.handle("SIGNED_OUT", null);
  assert.equal(storage.loadStore().orders.length, 0);
  assert.equal(localStorage.values.size, 0);
  assert.deepEqual(clears, ["SIGNED_OUT"]);
  assert.equal(
    auth.safeAuthErrorMessage({ code: "PGRST301", message: `JWT expired ${HOSTILE_VALUES.join(" ")}` }),
    "Your session is no longer valid. Please sign in again.",
  );
});

test("rate-limit variants are consistently safe", () => {
  const variants = [
    { status: 429 },
    { status: "429", message: HOSTILE_VALUES.join(" ") },
    { code: "over_request_rate_limit", message: "rate limit exceeded" },
    new Error("Too many requests"),
  ];
  for (const error of variants) {
    assert.equal(getSafeErrorCategory(error), "rate_limit");
    assert.equal(getSafeUserError(error, "auth"), "Too many attempts. Wait a moment and try again.");
  }
});

test("Payment Request image failures use the fixed safe recovery message", async () => {
  const source = await readFile(new URL("../src/pages/inventory.js", import.meta.url), "utf8");
  const fixedMessage = "Payment Request created, but the image could not be prepared. Try again.";
  assert.match(source, /await createPaymentRequestImage\(/);
  assert.match(source, /catch \{\s*notify\("Payment Request created, but the image could not be prepared\. Try again\."/s);
  assert.doesNotMatch(source, /imageError\.message|notify\([^\n]*error\.message/);

  const notifications = [];
  const notify = (...values) => notifications.push(values);
  try {
    throw new Error(HOSTILE_VALUES.join(" | "));
  } catch {
    notify(fixedMessage, true);
  }
  assert.deepEqual(notifications, [[fixedMessage, true]]);
  for (const value of HOSTILE_VALUES) assert.doesNotMatch(notifications.flat().join(" "), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("rollback failure remains sanitized when both linked updates fail", async () => {
  globalThis.__sprint15dRollback = { inventoryCalls: 0 };
  const virtualClient = "\0sprint15d-rollback-client";
  const rollbackServer = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "sprint15d-rollback-failure",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "./supabaseClient.js" && importer?.replaceAll("\\", "/").includes("/src/services/")) return virtualClient;
        return null;
      },
      load(id) {
        if (id !== virtualClient) return null;
        return `
          const resultFor = (table) => {
            if (table === "inventory_items") {
              globalThis.__sprint15dRollback.inventoryCalls += 1;
              if (globalThis.__sprint15dRollback.inventoryCalls === 1) return { data: { id: "controlled-item", price: 250, cost: 120 }, error: null };
              return { data: null, error: { message: globalThis.__sprint15dRollback.secret } };
            }
            if (table === "sales") return { data: null, error: { message: globalThis.__sprint15dRollback.secret } };
            return { data: null, error: null };
          };
          const builder = (table) => ({
            update() { return this; }, eq() { return this; }, select() { return this; },
            async single() { return resultFor(table); }
          });
          export const supabase = {
            auth: { async getUser() { return { data: { user: { id: "controlled-user" } }, error: null }; } },
            from(table) { return builder(table); }
          };
        `;
      },
    }],
  });
  globalThis.__sprint15dRollback.secret = HOSTILE_VALUES.join(" | ");
  try {
    const storage = await rollbackServer.ssrLoadModule("/src/services/storage.js");
    storage.replaceStore({
      collections: [{ id: "controlled-collection", name: "Controlled" }],
      inventory: [{ id: "controlled-item", collectionId: "controlled-collection", sku: "NK-001", name: "Controlled Item", cost: 100, price: 200, status: "Sold", createdAt: "2026-07-16T00:00:00.000Z" }],
      sales: [{ id: "controlled-sale", itemId: "controlled-item" }],
    });
    const supabaseStorage = await rollbackServer.ssrLoadModule("/src/services/supabaseStorage.js?sprint15d=rollback");
    await assert.rejects(
      supabaseStorage.updateSupabaseInventoryItem("controlled-item", {
        collectionId: "controlled-collection", sku: "NK-001", name: "Controlled Item", cost: 120, price: 250, createdAt: "2026-07-16T00:00:00.000Z",
      }),
      (error) => {
        assert.equal(error.message, "Inventory and linked Sale updates could not be completed safely.");
        const safe = createSafeUserError(error, "save");
        for (const value of HOSTILE_VALUES) assert.doesNotMatch(safe.message, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
        return true;
      },
    );
  } finally {
    await rollbackServer.close();
    delete globalThis.__sprint15dRollback;
  }
});

test("stale lifecycle failures are actionable and UI guards remain intact", async () => {
  const cases = [
    ["Only Ready to Pack Orders can start packing.", "This Order is no longer ready to start packing."],
    ["Only Packing Orders can be marked Packed.", "This Order is no longer eligible to be marked Packed."],
    ["Only Packed Orders can be marked Shipped.", "This Order is no longer eligible to be marked Shipped."],
    ["Only Shipped Orders can be marked Completed.", "This Order is no longer eligible to be marked Completed."],
    ["Only Packed Orders can be reopened for packing.", "This Order is no longer eligible to be reopened for packing."],
  ];
  for (const [raw, safe] of cases) assert.equal(getSafeUserError(new Error(raw), "order_mutation"), safe);

  const ordersPage = await server.ssrLoadModule("/src/pages/orders.js?sprint15d=guards");
  const id = "controlled-order";
  const base = { id, orderNumber: "CONTROLLED-ORDER", customerName: "Controlled", fulfillmentMethod: "shipment", createdAt: "2026-07-16T00:00:00.000Z", packedAt: "2026-07-16T01:00:00.000Z", shippedAt: "2026-07-16T02:00:00.000Z", completedAt: "2026-07-16T03:00:00.000Z" };
  const item = { id: "controlled-item", orderId: id, itemName: "Controlled Item", sku: "NK-001", quantity: 1, packingRequired: true, checkedAt: "2026-07-16T00:30:00.000Z" };
  const storeFor = (fulfillmentStatus) => ({ orders: [{ ...base, fulfillmentStatus }], orderItems: [item], orderEvents: [] });
  assert.doesNotMatch(ordersPage.renderPackingWorkspace(storeFor("packed"), id), /data-mark-order-packed/);
  assert.match(ordersPage.renderShippingWorkspace(storeFor("shipped"), id), /data-mark-order-shipped[^>]*hidden/);
  assert.doesNotMatch(ordersPage.renderCompletionWorkspace(storeFor("completed"), id), /data-mark-order-completed/);
});

test("malformed and hostile errors never throw or expose private values", async () => {
  const circular = {};
  circular.self = circular;
  const hostile = {};
  Object.defineProperties(hostile, {
    message: { get() { throw new Error(HOSTILE_VALUES[0]); } },
    code: { get() { throw new Error(HOSTILE_VALUES[1]); } },
    status: { get() { throw new Error(HOSTILE_VALUES[2]); } },
  });
  const proxy = new Proxy({}, { get() { throw new Error(HOSTILE_VALUES[3]); }, getPrototypeOf() { throw new Error(HOSTILE_VALUES[4]); } });
  const inputs = [null, undefined, "", HOSTILE_VALUES.join(" | "), {}, [], [HOSTILE_VALUES], { nested: { values: HOSTILE_VALUES } }, circular, hostile, proxy, new Error(HOSTILE_VALUES.join(" | ")), { code: "PGRST999", message: HOSTILE_VALUES.join(" | "), details: { records: HOSTILE_VALUES } }];
  const messages = [];
  for (const input of inputs) {
    assert.doesNotThrow(() => getSafeErrorCategory(input));
    assert.doesNotThrow(() => getSafeUserError(input, "save"));
    assert.doesNotThrow(() => createSafeUserError(input, "save"));
    messages.push(getSafeUserError(input, "save"), createSafeUserError(input, "save").message);
  }
  const output = messages.join("\n");
  for (const value of HOSTILE_VALUES) assert.doesNotMatch(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const viteErrors = await server.ssrLoadModule("/src/services/errorService.js?sprint15d=logging");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values.join(" "));
  try {
    for (const input of inputs) viteErrors.logSafeError(HOSTILE_VALUES.join(" "), input);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.length > 0);
  const logOutput = warnings.join("\n");
  for (const value of HOSTILE_VALUES) assert.doesNotMatch(logOutput, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("all pages, populated workspaces, and empty states render", async () => {
  const emptyStore = { inventory: [], sales: [], expenses: [], capital: [], purchases: [], logs: [], collections: [], paymentRequests: [], orders: [], orderItems: [], orderEvents: [], paymentConfig: {}, meta: {} };
  const pages = [["dashboard", "renderDashboardPage"], ["collections", "renderCollectionsPage"], ["inventory", "renderInventoryPage"], ["sales", "renderSalesPage"], ["orders", "renderOrdersPage"], ["expenses", "renderExpensesPage"], ["capital", "renderCapitalPage"]];
  for (const [name, renderer] of pages) {
    const page = await server.ssrLoadModule(`/src/pages/${name}.js?sprint15d=smoke`);
    const html = page[renderer](emptyStore, { startDate: "", endDate: "" });
    assert.ok(typeof html === "string" && html.length > 100);
  }

  const ordersPage = await server.ssrLoadModule("/src/pages/orders.js?sprint15d=populated");
  const id = "controlled-order";
  const store = { ...emptyStore, orders: [{ id, orderNumber: "CONTROLLED-ORDER", fulfillmentStatus: "completed", fulfillmentMethod: "shipment", customerName: "Controlled", customerContact: "00000000000", shippingAddress: "Controlled address", courier: "Controlled courier", trackingNumber: "CONTROLLED", currency: "PHP", subtotal: 100, shippingFee: 0, discount: 0, totalPaid: 100, createdAt: "2026-07-16T00:00:00.000Z", packedAt: "2026-07-16T01:00:00.000Z", shippedAt: "2026-07-16T02:00:00.000Z", completedAt: "2026-07-16T03:00:00.000Z" }], orderItems: [{ id: "controlled-item", orderId: id, sku: "NK-001", itemName: "Controlled", quantity: 1, sellingPrice: 100, packingRequired: true, checkedAt: "2026-07-16T00:30:00.000Z" }], orderEvents: [{ id: "controlled-event", orderId: id, fromStatus: "shipped", toStatus: "completed", createdAt: "2026-07-16T03:00:00.000Z" }] };
  const renderers = ["renderOrderDetailsWorkspace", "renderPackingWorkspace", "renderShippingWorkspace", "renderCompletionWorkspace", "renderPackingSlipWorkspace", "renderOrderSummaryWorkspace", "renderShippingLabelWorkspace"];
  for (const renderer of renderers) assert.match(ordersPage[renderer](store, id), /CONTROLLED-ORDER/);
  assert.match(ordersPage.renderAnalyticsWorkspace(store), /Operations Analytics/);
  assert.match(ordersPage.renderAnalyticsWorkspace(emptyStore), /No Orders in this range/);
});
