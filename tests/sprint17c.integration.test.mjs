import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

import {
  calculatePaymentRequestTotal,
  normalizePaymentRequestItemsInput,
} from "../src/core/paymentRequests.js";
import {
  deriveLegacySales,
  normalizePaymentRequests,
  normalizeSaleHeaders,
  paymentRequestIncludesItem,
} from "../src/core/transactions.js";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const paymentHeader = {
  id: "request-1",
  request_number: "PR-001",
  customer_name: "Controlled Customer",
  customer_contact: "09170000000",
  merchandise_subtotal_snapshot: 30,
  discount_snapshot: 5,
  shipping_fee_snapshot: 10,
  total_amount: 35,
  shipping_mode: "fee_now",
  status: "Pending",
};

test("Payment Request mapping attaches unique deterministic children without duplicating headers", () => {
  const requests = normalizePaymentRequests([paymentHeader], [
    { id: "child-b", payment_request_id: "request-1", inventory_item_id: "item-b", sku_snapshot: "B", item_name_snapshot: "Second", unit_price_snapshot: 20, line_total_snapshot: 20 },
    { id: "child-a", payment_request_id: "request-1", inventory_item_id: "item-a", sku_snapshot: "A", item_name_snapshot: "First", unit_price_snapshot: 10, line_total_snapshot: 10 },
    { id: "duplicate", payment_request_id: "request-1", inventory_item_id: "item-a", sku_snapshot: "A", item_name_snapshot: "Duplicate", unit_price_snapshot: 10, line_total_snapshot: 10 },
  ], [
    { id: "reservation-a", payment_request_id: "request-1", inventory_item_id: "item-a" },
    { id: "reservation-b", payment_request_id: "request-1", inventory_item_id: "item-b" },
  ]);

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].items.map((item) => item.inventoryItemId), ["item-a", "item-b"]);
  assert.equal(requests[0].reservationState, "reserved");
  assert.equal(requests[0].merchandiseSubtotal, 30);
});

test("Pending item matching covers every multi-item child, excludes unrelated items, and supports legacy rows", () => {
  const [request] = normalizePaymentRequests([paymentHeader], [
    { id: "child-a", payment_request_id: "request-1", inventory_item_id: "item-a", unit_price_snapshot: 10 },
    { id: "child-b", payment_request_id: "request-1", inventory_item_id: "item-b", unit_price_snapshot: 20 },
  ]);
  assert.equal(paymentRequestIncludesItem(request, "item-a"), true);
  assert.equal(paymentRequestIncludesItem(request, "item-b"), true);
  assert.equal(paymentRequestIncludesItem(request, "item-c"), false);
  assert.equal(paymentRequestIncludesItem({ itemId: "legacy-item", items: [] }, "legacy-item"), true);
});

test("legacy Payment Request fallback creates one child without changing header count", () => {
  const requests = normalizePaymentRequests([{
    ...paymentHeader,
    inventory_item_id: "legacy-item",
    item_name_snapshot: "Legacy",
    item_price: 25,
    merchandise_subtotal_snapshot: null,
    total_amount: 25,
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].items.length, 1);
  assert.equal(requests[0].items[0].legacyFallback, true);
  assert.equal(requests[0].itemId, "legacy-item");
});

test("Sale headers remain canonical while the legacy Sales view exposes item rows", async () => {
  const headers = normalizeSaleHeaders([{
    id: "sale-1",
    source_payment_request_id: "request-1",
    merchandise_subtotal_snapshot: 250,
    discount_snapshot: 25,
    shipping_fee_snapshot: 25,
    total_paid_snapshot: 250,
    aggregate_cogs_snapshot: 150,
    aggregate_profit_snapshot: 75,
    sale_price: 225,
    payment_status: "Paid",
    platform: "Direct Customer",
    sale_date: "2026-07-16",
  }], [
    { id: "sale-item-b", sale_id: "sale-1", inventory_item_id: "item-b", unit_cost_snapshot: 90, unit_price_snapshot: 150, line_subtotal_snapshot: 150, allocated_discount_snapshot: 15, net_item_revenue_snapshot: 135, profit_snapshot: 45 },
    { id: "sale-item-a", sale_id: "sale-1", inventory_item_id: "item-a", unit_cost_snapshot: 60, unit_price_snapshot: 100, line_subtotal_snapshot: 100, allocated_discount_snapshot: 10, net_item_revenue_snapshot: 90, profit_snapshot: 30 },
  ]);
  const sales = deriveLegacySales(headers);
  const store = { saleHeaders: headers, sales };
  const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const financials = await server.ssrLoadModule("/src/core/financials.js?sprint17c=financials");

  try {
    assert.equal(headers.length, 1);
    assert.equal(sales.length, 2);
    assert.equal(financials.getRevenue(store), 225);
    assert.equal(financials.getSalesCollected(store), 250);
    assert.equal(financials.getCOGS(store), 150);
    assert.equal(financials.getGrossProfit(store), 75);
    assert.equal(financials.getFinancialSalesCount(store), 1);
    assert.equal(financials.getSoldItemsCount(store), 2);
  } finally {
    await server.close();
  }
});

test("Payment Request calculations support one and many serialized items", () => {
  assert.deepEqual(normalizePaymentRequestItemsInput({ itemId: "one", itemPrice: 12.34 }), [
    { inventoryItemId: "one", unitPrice: 12.34, quantity: 1, lineTotal: 12.34 },
  ]);
  assert.deepEqual(calculatePaymentRequestTotal([
    { inventoryItemId: "one", unitPrice: 10.01 },
    { inventoryItemId: "two", unitPrice: 20.02 },
  ], 5, 3, "fee_now"), {
    itemPrice: 30.03,
    merchandiseSubtotal: 30.03,
    shippingFee: 5,
    discount: 3,
    total: 32.03,
  });
  assert.throws(() => normalizePaymentRequestItemsInput({ items: [] }), /Choose at least one item/);
  assert.throws(() => normalizePaymentRequestItemsInput({ items: Array.from({ length: 51 }, (_, index) => ({ inventoryItemId: `item-${index}`, unitPrice: 1 })) }), /no more than 50/);
  assert.throws(() => normalizePaymentRequestItemsInput({ items: [{ inventoryItemId: "same", unitPrice: 1 }, { inventoryItemId: "same", unitPrice: 2 }] }), /only once/);
  assert.throws(() => normalizePaymentRequestItemsInput({ items: [{ inventoryItemId: "bad", unitPrice: -1 }] }), /cannot be negative/);
});

test("Supabase loading fetches child collections once and builds canonical headers", async () => {
  globalThis.__sprint17cLoad = {
    calls: [],
    tables: {
      collections: [{ id: "collection-a", name: "Collection A" }, { id: "collection-b", name: "Collection B" }],
      inventory_items: [], expenses: [], capital_records: [], inventory_purchases: [], activity_logs: [], settings: [],
      orders: [], order_items: [], order_fulfillment_events: [],
      payment_requests: [paymentHeader],
      payment_request_items: [
        { id: "request-item-b", payment_request_id: "request-1", inventory_item_id: "item-b", sku_snapshot: "B", item_name_snapshot: "Second", unit_price_snapshot: 20, line_total_snapshot: 20 },
        { id: "request-item-a", payment_request_id: "request-1", inventory_item_id: "item-a", sku_snapshot: "A", item_name_snapshot: "First", unit_price_snapshot: 10, line_total_snapshot: 10 },
      ],
      inventory_reservations: [
        { id: "reservation-a", payment_request_id: "request-1", inventory_item_id: "item-a" },
        { id: "reservation-b", payment_request_id: "request-1", inventory_item_id: "item-b" },
      ],
      sales: [{ id: "sale-1", sale_price: 30, merchandise_subtotal_snapshot: 30, total_paid_snapshot: 30, aggregate_cogs_snapshot: 15, aggregate_profit_snapshot: 15, payment_status: "Paid", platform: "Direct Customer", sale_date: "2026-07-16" }],
      sale_items: [
        { id: "sale-item-a", sale_id: "sale-1", inventory_item_id: "item-a", collection_id: "collection-a", sku_snapshot: "A", item_name_snapshot: "First", unit_cost_snapshot: 5, unit_price_snapshot: 10, line_subtotal_snapshot: 10, net_item_revenue_snapshot: 10, profit_snapshot: 5 },
        { id: "sale-item-b", sale_id: "sale-1", inventory_item_id: "item-b", collection_id: "collection-b", sku_snapshot: "B", item_name_snapshot: "Second", unit_cost_snapshot: 10, unit_price_snapshot: 20, line_subtotal_snapshot: 20, net_item_revenue_snapshot: 20, profit_snapshot: 10 },
      ],
    },
  };
  const virtualClient = "\0sprint17c-load-client";
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "sprint17c-load-client",
      enforce: "pre",
      resolveId(source) {
        if (source === "./supabaseClient.js") return virtualClient;
        return null;
      },
      load(id) {
        if (id !== virtualClient) return null;
        return `
          class Query {
            constructor(table) { this.table = table; }
            select() { return this; } eq() { return this; } order() { return this; } limit() { return this; }
            then(resolve) {
              globalThis.__sprint17cLoad.calls.push(this.table);
              resolve({ data: globalThis.__sprint17cLoad.tables[this.table] || [], error: null });
            }
          }
          export const supabase = {
            auth: { getUser: async () => ({ data: { user: { id: "controlled-user" } }, error: null }) },
            from: (table) => new Query(table),
          };
        `;
      },
    }],
  });

  try {
    const service = await server.ssrLoadModule("/src/services/supabaseStorage.js?sprint17c=load");
    const store = await service.loadSupabaseStore();
    assert.equal(store.paymentRequests.length, 1);
    assert.deepEqual(store.paymentRequests[0].items.map((item) => item.inventoryItemId), ["item-a", "item-b"]);
    assert.equal(store.saleHeaders.length, 1);
    assert.equal(store.saleHeaders[0].items.length, 2);
    assert.equal(store.sales.length, 2);
    for (const table of ["payment_request_items", "inventory_reservations", "sale_items"]) {
      assert.equal(globalThis.__sprint17cLoad.calls.filter((value) => value === table).length, 1);
    }
  } finally {
    await server.close();
    delete globalThis.__sprint17cLoad;
  }
});

test("Supabase service uses the Sprint 17B RPCs and exact multi-item argument shape", async () => {
  globalThis.__sprint17cRpc = { calls: [] };
  const virtualClient = "\0sprint17c-supabase-client";
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "sprint17c-rpc-client",
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
              globalThis.__sprint17cRpc.calls.push({ name, args });
              if (name === "create_payment_request_v2") return { data: { payment_request: { id: "created-request" } }, error: null };
              return { data: { ok: true }, error: null };
            },
          };
        `;
      },
    }],
  });

  try {
    const service = await server.ssrLoadModule("/src/services/supabaseStorage.js?sprint17c=rpc");
    const base = {
      customerName: "Controlled Customer",
      customerContact: "09170000000",
      validUntil: "2099-01-01",
      shippingMode: "pickup",
      discount: 0,
      paymentConfig: {},
    };
    const created = await service.createSupabasePaymentRequest({ ...base, itemId: "item-one", itemPrice: 10 });
    assert.equal(created.id, "created-request");
    await service.createSupabasePaymentRequest({ ...base, items: [
      { inventoryItemId: "item-one", unitPrice: 10 },
      { inventoryItemId: "item-two", unitPrice: 20 },
    ] });
    await service.cancelSupabasePaymentRequest("request-1");
    await service.markSupabasePaymentRequestPaid("request-1", "GCash");

    assert.deepEqual(globalThis.__sprint17cRpc.calls.map((call) => call.name), [
      "create_payment_request_v2",
      "create_payment_request_v2",
      "cancel_multi_item_payment_request_v1",
      "mark_multi_item_payment_request_paid_v1",
    ]);
    assert.deepEqual(globalThis.__sprint17cRpc.calls[0].args.p_items, [
      { inventory_item_id: "item-one", unit_price: 10 },
    ]);
    assert.deepEqual(globalThis.__sprint17cRpc.calls[1].args.p_items, [
      { inventory_item_id: "item-one", unit_price: 10 },
      { inventory_item_id: "item-two", unit_price: 20 },
    ]);
  } finally {
    await server.close();
    delete globalThis.__sprint17cRpc;
  }
});

test("Payment mutations preserve success on refresh failure and never repeat an RPC", async () => {
  globalThis.__sprint17cRepository = { mutations: 0, refreshes: 0, failMutation: false };
  const virtualStorage = "\0sprint17c-storage";
  const virtualOrders = "\0sprint17c-orders";
  const virtualSupabaseStorage = "\0sprint17c-supabase-storage";
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "sprint17c-repository-recovery",
      enforce: "pre",
      resolveId(source, importer) {
        const clean = importer?.split("?")[0].replaceAll("\\", "/");
        if (!clean?.endsWith("/src/services/repository.js")) return null;
        if (source === "./storage.js") return virtualStorage;
        if (source === "./orderService.js") return virtualOrders;
        if (source === "./supabaseStorage.js") return virtualSupabaseStorage;
        return null;
      },
      load(id) {
        if (id === virtualStorage) return `
          export const getAuthenticatedStoreGeneration = () => 1;
          export const loadStore = () => ({});
          export const replaceStore = (value) => value;
        `;
        if (id === virtualOrders) return `
          export const loadSupabaseOrders = async () => ({ orders: [], orderItems: [], orderEvents: [] });
          export const markSupabaseOrderCompleted = async () => {};
          export const markSupabaseOrderPacked = async () => {};
          export const markSupabaseOrderShipped = async () => {};
          export const reopenSupabaseOrderPacking = async () => {};
          export const setSupabaseOrderItemPacked = async () => {};
          export const startSupabaseOrderPacking = async () => {};
        `;
        if (id === virtualSupabaseStorage) return `
          export const loadSupabaseStore = async () => { globalThis.__sprint17cRepository.refreshes += 1; throw new Error("private refresh response"); };
          const mutate = async () => {
            globalThis.__sprint17cRepository.mutations += 1;
            if (globalThis.__sprint17cRepository.failMutation) throw new Error("fetch failed: private ambiguous response");
            return { id: "request-1" };
          };
          export const createSupabasePaymentRequest = mutate;
          export const markSupabasePaymentRequestPaid = mutate;
          export const cancelSupabasePaymentRequest = mutate;
          export const createSupabaseCollection = async () => ({}); export const updateSupabaseCollection = async () => ({});
          export const archiveSupabaseCollection = async () => ({}); export const deleteSupabaseCollection = async () => ({});
          export const createSupabaseInventoryItem = async () => ({}); export const updateSupabaseInventoryItem = async () => ({});
          export const changeSupabaseInventoryStatus = async () => ({}); export const deleteSupabaseInventoryItem = async () => ({});
          export const updateSupabaseSale = async () => ({}); export const createSupabaseExpense = async () => ({});
          export const updateSupabaseExpense = async () => ({}); export const deleteSupabaseExpense = async () => ({});
          export const createSupabaseCapitalEntry = async () => ({}); export const updateSupabaseCapitalEntry = async () => ({});
          export const replaceSupabaseStoreFromBackup = async () => ({}); export const saveSupabasePaymentConfig = async () => ({});
        `;
        return null;
      },
    }],
  });

  try {
    const repository = await server.ssrLoadModule("/src/services/repository.js?sprint17c=recovery");
    const operations = [
      [() => repository.addPaymentRequest({}), /payment request was created/i],
      [() => repository.cancelPaymentRequest("request-1"), /payment request was cancelled/i],
      [() => repository.markPaymentRequestPaid("request-1", "GCash"), /payment was saved/i],
    ];
    for (const [operation, message] of operations) {
      await assert.rejects(operation(), (error) => {
        assert.equal(error.mutationSucceeded, true);
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /private/i);
        return true;
      });
    }
    assert.equal(globalThis.__sprint17cRepository.mutations, 3);
    assert.equal(globalThis.__sprint17cRepository.refreshes, 3);

    globalThis.__sprint17cRepository.failMutation = true;
    await assert.rejects(repository.markPaymentRequestPaid("request-1", "GCash"), (error) => {
      assert.equal(error.mutationSucceeded, undefined);
      assert.match(error.message, /check your internet connection/i);
      assert.doesNotMatch(error.message, /private|ambiguous/i);
      return true;
    });
    assert.equal(globalThis.__sprint17cRepository.mutations, 4);
    assert.equal(globalThis.__sprint17cRepository.refreshes, 3);
  } finally {
    await server.close();
    delete globalThis.__sprint17cRepository;
  }
});
