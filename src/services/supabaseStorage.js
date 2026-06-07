import { supabase } from "./supabaseClient.js";
import { emptyStore, loadStore, normalizeStore } from "./storage.js";

const STATUSES = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  SOLD: "Sold",
  WRITTEN_OFF: "Written Off",
  ARCHIVED: "Archived",
};

const PAYMENT_STATUSES = {
  PAID: "Paid",
  PENDING: "Pending",
};

const PLATFORMS = [
  "Facebook",
  "Instagram",
  "TikTok",
  "Direct Customer",
  "Walk-in",
  "Other",
];

const EXPENSE_CATEGORIES = [
  "Packaging",
  "Shipping",
  "Marketing",
  "Supplies",
  "Write-Off",
  "Operating",
  "Other",
];

const CAPITAL_TYPES = ["Capital Added", "Withdrawal"];

async function getUserId() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;
  if (!data?.user?.id) throw new Error("No authenticated user found.");

  return data.user.id;
}

function toDateOnly(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatLogMoney(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function currentStore() {
  return loadStore();
}

function highestSkuNumber(store) {
  return (store.inventory || [])
    .map((item) => item.sku)
    .filter((sku) => /^NK-\d+$/.test(String(sku || "")))
    .map((sku) => Number(String(sku).replace("NK-", "")))
    .reduce((max, number) => Math.max(max, number), Number(store.meta?.lastSkuNumber || 0));
}

function nextSku(store) {
  return `NK-${String(highestSkuNumber(store) + 1).padStart(3, "0")}`;
}

function findCollection(store, collectionIdOrName) {
  return (store.collections || []).find(
    (collection) => collection.id === collectionIdOrName || collection.name === collectionIdOrName,
  );
}

function collectionUuidFor(store, collectionIdOrName) {
  const collection = findCollection(store, collectionIdOrName);
  assert(collection, "Choose an existing collection.");
  return collection.id;
}

async function insertActivity(userId, input) {
  const { error } = await supabase.from("activity_logs").insert({
    user_id: userId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    label: input.label,
    details: input.details || input.label,
    amount: input.amount,
  });

  if (error) throw error;
}

async function saveMeta(userId, value) {
  const { error } = await supabase.from("settings").upsert(
    {
      user_id: userId,
      key: "meta",
      value,
    },
    { onConflict: "user_id,key" },
  );

  if (error) throw error;
}

export async function loadSupabaseStore() {
  const userId = await getUserId();

  const [
    collectionsResult,
    inventoryResult,
    salesResult,
    expensesResult,
    capitalResult,
    purchasesResult,
    logsResult,
    settingsResult,
  ] = await Promise.all([
    supabase.from("collections").select("*").eq("user_id", userId),
    supabase.from("inventory_items").select("*").eq("user_id", userId),
    supabase.from("sales").select("*").eq("user_id", userId),
    supabase.from("expenses").select("*").eq("user_id", userId),
    supabase.from("capital_records").select("*").eq("user_id", userId),
    supabase.from("inventory_purchases").select("*").eq("user_id", userId),
    supabase.from("activity_logs").select("*").eq("user_id", userId),
    supabase.from("settings").select("*").eq("user_id", userId),
  ]);

  const results = [
    collectionsResult,
    inventoryResult,
    salesResult,
    expensesResult,
    capitalResult,
    purchasesResult,
    logsResult,
    settingsResult,
  ];

  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;

  const settings = settingsResult.data || [];
  const metaSetting = settings.find((item) => item.key === "meta");
  const collections = (collectionsResult.data || []).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description || "",
    createdAt: item.collection_date || item.created_at,
    updatedAt: item.updated_at,
    archivedAt: item.archived_at,
  }));
  const collectionNameById = new Map(collections.map((collection) => [collection.id, collection.name]));
  const toAppCollectionId = (collectionId) => collectionNameById.get(collectionId) || collectionId || "";

  return {
    ...emptyStore(),

    collections,

    inventory: (inventoryResult.data || []).map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      cost: Number(item.cost || 0),
      price: Number(item.price || 0),
      status: item.status,
      collectionId: toAppCollectionId(item.collection_id),
      createdAt: item.date_added || item.created_at,
      soldAt: item.sold_at,
      writtenOffAt: item.written_off_at,
      archivedAt: item.archived_at,
      paymentStatus: item.payment_status,
      platform: item.platform,
      locked: item.locked,
      notes: item.notes || "",
    })),

    sales: (salesResult.data || []).map((sale) => ({
      id: sale.id,
      itemId: sale.inventory_item_id,
      collectionId: toAppCollectionId(sale.collection_id),
      sku: sale.sku_snapshot,
      itemName: sale.item_name_snapshot,
      cost: Number(sale.cost_snapshot || 0),
      price: Number(sale.sale_price || 0),
      profit: Number(sale.profit_snapshot || 0),
      platform: sale.platform,
      paymentStatus: sale.payment_status,
      date: sale.sale_date,
      notes: sale.notes || "",
      voidedAt: sale.voided_at,
    })),

    expenses: (expensesResult.data || []).map((expense) => ({
      id: expense.id,
      itemId: expense.inventory_item_id,
      collectionId: toAppCollectionId(expense.collection_id),
      category: expense.category,
      amount: Number(expense.amount || 0),
      details: expense.details || "",
      sku: expense.sku_snapshot,
      itemName: expense.item_name_snapshot,
      date: expense.expense_date,
      createdAt: expense.created_at,
      updatedAt: expense.updated_at,
    })),

    capital: (capitalResult.data || []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      amount: Number(entry.amount || 0),
      notes: entry.details || "",
      details: entry.details || "",
      date: entry.record_date,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    })),

    purchases: (purchasesResult.data || []).map((purchase) => ({
      id: purchase.id,
      itemId: purchase.inventory_item_id,
      cost: Number(purchase.cost || 0),
      date: purchase.purchase_date,
      createdAt: purchase.created_at,
      updatedAt: purchase.updated_at,
    })),

    logs: (logsResult.data || []).map((log) => ({
      id: log.id,
      type: log.action,
      referenceId: log.entity_id,
      label: log.label || "",
      details: log.details || log.label || "",
      amount: Number(log.amount || 0),
      date: log.activity_date,
    })),

    meta: {
      lastSkuNumber: Number(metaSetting?.value?.lastSkuNumber || 0),
    },
  };
}

export async function createSupabaseCollection(input) {
  const userId = await getUserId();

  const name = String(input.name || "").trim();
  if (!name) throw new Error("Collection name is required.");

  const payload = {
    user_id: userId,
    name,
    description: String(input.description || "").trim(),
    collection_date: toDateOnly(input.createdAt || input.collectionDate || new Date()),
  };

  const { data, error } = await supabase
    .from("collections")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "collection",
    entityId: data.id,
    action: "collection.created",
    label: `Created collection ${name}`,
    details: `Created collection ${name}`,
  });

  return data;
}

export async function updateSupabaseCollection(collectionId, input) {
  const userId = await getUserId();

  const name = String(input.name || "").trim();
  if (!name) throw new Error("Collection name is required.");

  const payload = {
    name,
    description: String(input.description || "").trim(),
    collection_date: toDateOnly(input.createdAt || input.collectionDate || new Date()),
  };

  const { data, error } = await supabase
    .from("collections")
    .update(payload)
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "collection",
    entityId: data.id,
    action: "collection.updated",
    label: `Updated collection ${name}`,
    details: `Updated collection ${name}`,
  });

  return data;
}

export async function archiveSupabaseCollection(collectionId) {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("collections")
    .update({
      archived_at: new Date().toISOString(),
    })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function deleteSupabaseCollection(collectionId) {
  const userId = await getUserId();

  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("id", collectionId)
    .eq("user_id", userId);

  if (error) throw error;

  return true;
}

export async function createSupabaseInventoryItem(input) {
  const userId = await getUserId();
  const store = currentStore();
  const requestedSku = String(input.sku || "").trim().toUpperCase();
  const sku = requestedSku || nextSku(store);
  const cost = money(input.cost);
  const price = money(input.price);
  const name = String(input.name || "").trim();
  const dateAdded = input.createdAt || input.dateAdded || nowIso();
  const collectionId = collectionUuidFor(store, input.collectionId);

  assert(name, "Item name is required.");
  assert(!(store.inventory || []).some((entry) => entry.sku === sku), "SKU must be unique.");
  assert(cost >= 0, "Cost must be zero or higher.");
  assert(price >= cost, "Price must be equal to or higher than cost.");
  assert(!Number.isNaN(new Date(dateAdded).getTime()), "Date added must be valid.");

  const { data: item, error } = await supabase
    .from("inventory_items")
    .insert({
      user_id: userId,
      collection_id: collectionId,
      sku,
      name,
      cost,
      price,
      status: STATUSES.AVAILABLE,
      date_added: toDateOnly(dateAdded),
      locked: false,
      notes: String(input.notes || "").trim(),
    })
    .select()
    .single();

  if (error) throw error;

  const { error: purchaseError } = await supabase.from("inventory_purchases").insert({
    user_id: userId,
    inventory_item_id: item.id,
    cost,
    purchase_date: toDateOnly(dateAdded),
  });

  if (purchaseError) throw purchaseError;

  await saveMeta(userId, { lastSkuNumber: highestSkuNumber({ ...store, inventory: [...store.inventory, { sku }] }) });
  await insertActivity(userId, {
    entityType: "inventory_item",
    entityId: item.id,
    action: "inventory.created",
    label: `Created item ${sku} - ${name}`,
    details: `Created item ${sku} - ${name}`,
    amount: cost,
  });

  return item;
}

export async function updateSupabaseInventoryItem(itemId, input) {
  const userId = await getUserId();
  const store = currentStore();
  const item = store.inventory.find((entry) => entry.id === itemId);
  assert(item, "Item not found.");
  assert(!item.locked, "Sold or written-off items cannot be edited.");

  const sku = String(input.sku || "").trim().toUpperCase();
  const cost = money(input.cost);
  const price = money(input.price);
  const name = String(input.name || "").trim();
  const dateAdded = input.createdAt || item.createdAt || nowIso();
  const collectionId = collectionUuidFor(store, input.collectionId);

  assert(sku, "SKU is required.");
  assert(!(store.inventory || []).some((entry) => entry.sku === sku && entry.id !== itemId), "SKU must be unique.");
  assert(name, "Item name is required.");
  assert(cost >= 0, "Cost must be zero or higher.");
  assert(price >= cost, "Price must be equal to or higher than cost.");
  assert(!Number.isNaN(new Date(dateAdded).getTime()), "Date added must be valid.");

  const status = input.status && [STATUSES.AVAILABLE, STATUSES.RESERVED].includes(input.status)
    ? input.status
    : item.status;

  const { data, error } = await supabase
    .from("inventory_items")
    .update({
      collection_id: collectionId,
      sku,
      name,
      cost,
      price,
      status,
      date_added: toDateOnly(dateAdded),
      notes: String(input.notes || "").trim(),
    })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  const { error: purchaseError } = await supabase
    .from("inventory_purchases")
    .update({
      cost,
      purchase_date: toDateOnly(dateAdded),
    })
    .eq("inventory_item_id", itemId)
    .eq("user_id", userId);

  if (purchaseError) throw purchaseError;

  await insertActivity(userId, {
    entityType: "inventory_item",
    entityId: itemId,
    action: "inventory.updated",
    label: `Updated item ${sku} - ${name}`,
    details: `Updated item ${sku} - ${name}`,
    amount: cost,
  });

  return data;
}

export async function changeSupabaseInventoryStatus(itemId, nextStatus, paymentStatus = PAYMENT_STATUSES.PAID, platform = "") {
  const userId = await getUserId();
  const store = currentStore();
  const item = store.inventory.find((entry) => entry.id === itemId);
  assert(item, "Item not found.");

  const collectionId = item.collectionId ? collectionUuidFor(store, item.collectionId) : null;

  if (item.status === STATUSES.SOLD && nextStatus === STATUSES.AVAILABLE) {
    const sale = store.sales.find((entry) => entry.itemId === item.id);
    if (sale) {
      const { error: saleError } = await supabase
        .from("sales")
        .delete()
        .eq("id", sale.id)
        .eq("user_id", userId);
      if (saleError) throw saleError;
    }

    const { data, error } = await supabase
      .from("inventory_items")
      .update({
        status: STATUSES.AVAILABLE,
        locked: false,
        sold_at: null,
        payment_status: null,
        platform: null,
      })
      .eq("id", itemId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    await insertActivity(userId, {
      entityType: "sale",
      entityId: sale?.id || item.id,
      action: "sale.reversed",
      label: `Reversed sale for ${item.sku}`,
      details: `Reversed sale for ${item.sku} - ${item.name}`,
      amount: sale?.price,
    });

    return data;
  }

  if (item.status === STATUSES.WRITTEN_OFF && nextStatus === STATUSES.AVAILABLE) {
    const { error: expenseError } = await supabase
      .from("expenses")
      .delete()
      .eq("inventory_item_id", itemId)
      .eq("category", "Write-Off")
      .eq("user_id", userId);
    if (expenseError) throw expenseError;

    const { data, error } = await supabase
      .from("inventory_items")
      .update({
        status: STATUSES.AVAILABLE,
        locked: false,
        written_off_at: null,
      })
      .eq("id", itemId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    await insertActivity(userId, {
      entityType: "inventory_item",
      entityId: itemId,
      action: "inventory.status",
      label: `Restored ${item.sku}`,
      details: `Restored ${item.sku} - ${item.name} to Available`,
    });

    return data;
  }

  if (nextStatus === STATUSES.SOLD) {
    assert(!store.sales.some((sale) => sale.itemId === item.id), "This item already has a sale record.");
    assert(PLATFORMS.includes(platform), "Choose a valid platform.");
    assert(Object.values(PAYMENT_STATUSES).includes(paymentStatus), "Choose a valid payment status.");

    const soldAt = nowIso();
    const { data, error } = await supabase
      .from("inventory_items")
      .update({
        status: STATUSES.SOLD,
        locked: true,
        sold_at: soldAt,
        payment_status: paymentStatus,
        platform,
      })
      .eq("id", itemId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        user_id: userId,
        inventory_item_id: item.id,
        collection_id: collectionId,
        sku_snapshot: item.sku,
        item_name_snapshot: item.name,
        cost_snapshot: item.cost,
        sale_price: item.price,
        platform,
        payment_status: paymentStatus,
        sale_date: toDateOnly(soldAt),
      })
      .select()
      .single();

    if (saleError) throw saleError;

    await insertActivity(userId, {
      entityType: "sale",
      entityId: sale.id,
      action: "sale.created",
      label: `Sold ${item.sku} via ${platform} for ${formatLogMoney(item.price)}`,
      details: `Sold ${item.sku} - ${item.name} via ${platform} for ${formatLogMoney(item.price)}`,
      amount: item.price,
    });

    return data;
  }

  if (nextStatus === STATUSES.WRITTEN_OFF) {
    const writtenOffAt = nowIso();
    const { data, error } = await supabase
      .from("inventory_items")
      .update({
        status: STATUSES.WRITTEN_OFF,
        locked: true,
        written_off_at: writtenOffAt,
      })
      .eq("id", itemId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    const { error: expenseError } = await supabase.from("expenses").insert({
      user_id: userId,
      inventory_item_id: item.id,
      collection_id: collectionId,
      category: "Write-Off",
      amount: item.cost,
      details: `${item.sku} - ${item.name}`,
      sku_snapshot: item.sku,
      item_name_snapshot: item.name,
      expense_date: toDateOnly(writtenOffAt),
    });

    if (expenseError) throw expenseError;

    await insertActivity(userId, {
      entityType: "inventory_item",
      entityId: item.id,
      action: "inventory.written_off",
      label: `Wrote off ${item.sku} - ${item.name}`,
      details: `Wrote off ${item.sku} - ${item.name}`,
      amount: item.cost,
    });

    return data;
  }

  const locked = nextStatus === STATUSES.ARCHIVED ? true : false;
  const { data, error } = await supabase
    .from("inventory_items")
    .update({
      status: nextStatus,
      locked,
      archived_at: nextStatus === STATUSES.ARCHIVED ? nowIso() : null,
    })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "inventory_item",
    entityId: itemId,
    action: nextStatus === STATUSES.ARCHIVED ? "inventory.archived" : "inventory.status",
    label: nextStatus === STATUSES.ARCHIVED ? `Archived ${item.sku} - ${item.name}` : `${item.sku} is ${nextStatus}`,
    details: nextStatus === STATUSES.ARCHIVED ? `Archived ${item.sku} - ${item.name}` : `${item.sku} is ${nextStatus}`,
  });

  return data;
}

export async function deleteSupabaseInventoryItem(itemId) {
  const userId = await getUserId();
  const store = currentStore();
  const item = store.inventory.find((entry) => entry.id === itemId);
  assert(item, "Item not found.");

  const relatedDeletes = await Promise.all([
    supabase.from("sales").delete().eq("inventory_item_id", itemId).eq("user_id", userId),
    supabase.from("inventory_purchases").delete().eq("inventory_item_id", itemId).eq("user_id", userId),
    supabase.from("expenses").delete().eq("inventory_item_id", itemId).eq("user_id", userId),
  ]);

  const failedDelete = relatedDeletes.find((result) => result.error);
  if (failedDelete) throw failedDelete.error;

  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId);

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "inventory_item",
    entityId: itemId,
    action: "inventory.deleted",
    label: `Deleted ${item.sku} - ${item.name}`,
    details: `Deleted ${item.sku} - ${item.name}`,
  });

  return true;
}

export async function updateSupabaseSale(saleId, input) {
  const userId = await getUserId();
  const store = currentStore();
  const sale = store.sales.find((entry) => entry.id === saleId);
  assert(sale, "Sale not found.");

  const item = store.inventory.find((entry) => entry.id === sale.itemId);
  assert(item, "Inventory item not found.");

  const price = money(input.price);
  const cost = money(input.cost);
  assert(price >= 0, "Sold price must be zero or higher.");
  assert(cost >= 0, "Cost must be zero or higher.");
  assert(input.date, "Date is required.");
  assert(PLATFORMS.includes(input.platform), "Choose a valid platform.");
  assert(Object.values(PAYMENT_STATUSES).includes(input.paymentStatus), "Choose a valid payment status.");

  const { data, error } = await supabase
    .from("sales")
    .update({
      sale_price: price,
      cost_snapshot: cost,
      sale_date: toDateOnly(input.date),
      platform: input.platform,
      payment_status: input.paymentStatus,
    })
    .eq("id", saleId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  const { error: itemError } = await supabase
    .from("inventory_items")
    .update({
      price,
      cost,
      sold_at: new Date(input.date).toISOString(),
      platform: input.platform,
      payment_status: input.paymentStatus,
    })
    .eq("id", item.id)
    .eq("user_id", userId);

  if (itemError) throw itemError;

  const { error: purchaseError } = await supabase
    .from("inventory_purchases")
    .update({ cost })
    .eq("inventory_item_id", item.id)
    .eq("user_id", userId);

  if (purchaseError) throw purchaseError;

  await insertActivity(userId, {
    entityType: "sale",
    entityId: saleId,
    action: "sale.updated",
    label: `Updated sale ${sale.sku} for ${formatLogMoney(price)}`,
    details: `Updated sale ${sale.sku} - ${sale.itemName} for ${formatLogMoney(price)}`,
    amount: price,
  });

  return data;
}

export async function createSupabaseExpense(input) {
  const userId = await getUserId();
  const amount = money(input.amount);
  const category = input.category;
  const date = input.date || nowIso();

  assert(amount > 0, "Expense amount must be higher than zero.");
  assert(EXPENSE_CATEGORIES.includes(category), "Choose a valid category.");

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      user_id: userId,
      category,
      amount,
      details: String(input.details || "").trim(),
      expense_date: toDateOnly(date),
    })
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "expense",
    entityId: data.id,
    action: "expense.created",
    label: `Added ${category} expense ${formatLogMoney(amount)}`,
    details: `Added ${category} expense ${formatLogMoney(amount)}`,
    amount,
  });

  return data;
}

export async function updateSupabaseExpense(expenseId, input) {
  const userId = await getUserId();
  const amount = money(input.amount);
  const category = input.category;
  const date = input.date || nowIso();

  assert(amount > 0, "Expense amount must be higher than zero.");
  assert(EXPENSE_CATEGORIES.includes(category), "Choose a valid category.");

  const { data, error } = await supabase
    .from("expenses")
    .update({
      category,
      amount,
      details: String(input.details || "").trim(),
      expense_date: toDateOnly(date),
    })
    .eq("id", expenseId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "expense",
    entityId: expenseId,
    action: "expense.updated",
    label: `Updated ${category} expense ${formatLogMoney(amount)}`,
    details: `Updated ${category} expense ${formatLogMoney(amount)}`,
    amount,
  });

  return data;
}

export async function deleteSupabaseExpense(expenseId) {
  const userId = await getUserId();
  const store = currentStore();
  const expense = store.expenses.find((entry) => entry.id === expenseId);
  assert(expense, "Expense not found.");

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("user_id", userId);

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "expense",
    entityId: expenseId,
    action: "expense.deleted",
    label: `Deleted expense ${formatLogMoney(expense.amount)} - ${expense.category}`,
    details: `Deleted expense ${formatLogMoney(expense.amount)} - ${expense.category}`,
    amount: expense.amount,
  });

  return true;
}

export async function createSupabaseCapitalEntry(input) {
  const userId = await getUserId();
  const amount = money(input.amount);
  const type = input.type;
  const date = input.date || nowIso();
  const details = String(input.notes || input.details || "").trim();

  assert(amount > 0, "Capital amount must be higher than zero.");
  assert(CAPITAL_TYPES.includes(type), "Choose a valid capital type.");

  const { data, error } = await supabase
    .from("capital_records")
    .insert({
      user_id: userId,
      type,
      amount,
      details,
      record_date: toDateOnly(date),
    })
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "capital_record",
    entityId: data.id,
    action: "capital.created",
    label: `Added capital ${formatLogMoney(amount)}`,
    details: `${type} ${formatLogMoney(amount)}${details ? ` - ${details}` : ""}`,
    amount,
  });

  return data;
}

export async function updateSupabaseCapitalEntry(capitalId, input) {
  const userId = await getUserId();
  const amount = money(input.amount);
  const type = input.type;
  const date = input.date || nowIso();
  const details = String(input.notes || input.details || "").trim();

  assert(amount > 0, "Capital amount must be higher than zero.");
  assert(CAPITAL_TYPES.includes(type), "Choose a valid capital type.");

  const { data, error } = await supabase
    .from("capital_records")
    .update({
      type,
      amount,
      details,
      record_date: toDateOnly(date),
    })
    .eq("id", capitalId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;

  await insertActivity(userId, {
    entityType: "capital_record",
    entityId: capitalId,
    action: "capital.updated",
    label: `Updated capital ${formatLogMoney(amount)}`,
    details: `${type} updated ${formatLogMoney(amount)}${details ? ` - ${details}` : ""}`,
    amount,
  });

  return data;
}

export async function replaceSupabaseStoreFromBackup(rawStore) {
  const userId = await getUserId();
  const store = normalizeStore(rawStore);
  const collectionIds = new Map();
  const inventoryIds = new Map();

  const deleteResults = await Promise.all([
    supabase.from("sales").delete().eq("user_id", userId),
    supabase.from("expenses").delete().eq("user_id", userId),
    supabase.from("inventory_purchases").delete().eq("user_id", userId),
    supabase.from("inventory_items").delete().eq("user_id", userId),
    supabase.from("capital_records").delete().eq("user_id", userId),
    supabase.from("activity_logs").delete().eq("user_id", userId),
    supabase.from("settings").delete().eq("user_id", userId),
  ]);

  const failedDelete = deleteResults.find((result) => result.error);
  if (failedDelete) throw failedDelete.error;

  const { error: collectionsDeleteError } = await supabase
    .from("collections")
    .delete()
    .eq("user_id", userId);
  if (collectionsDeleteError) throw collectionsDeleteError;

  for (const collection of store.collections || []) {
    const name = String(collection.name || "").trim();
    if (!name) continue;

    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: userId,
        name,
        description: collection.description || "",
        collection_date: toDateOnly(collection.createdAt || collection.date || nowIso()),
        archived_at: collection.archivedAt || null,
      })
      .select()
      .single();

    if (error) throw error;
    collectionIds.set(collection.id, data.id);
    collectionIds.set(collection.name, data.id);
  }

  for (const item of store.inventory || []) {
    const sku = String(item.sku || "").trim().toUpperCase();
    const name = String(item.name || "").trim();
    if (!sku || !name) continue;

    const { data, error } = await supabase
      .from("inventory_items")
      .insert({
        user_id: userId,
        collection_id: collectionIds.get(item.collectionId) || null,
        sku,
        name,
        cost: money(item.cost),
        price: money(item.price),
        status: item.status || STATUSES.AVAILABLE,
        date_added: toDateOnly(item.createdAt || nowIso()),
        sold_at: item.soldAt || null,
        written_off_at: item.writtenOffAt || null,
        archived_at: item.archivedAt || null,
        payment_status: item.paymentStatus || null,
        platform: item.platform || null,
        locked: Boolean(item.locked),
        notes: item.notes || "",
      })
      .select()
      .single();

    if (error) throw error;
    inventoryIds.set(item.id, data.id);
  }

  for (const purchase of store.purchases || []) {
    const itemId = inventoryIds.get(purchase.itemId);
    if (!itemId) continue;

    const { error } = await supabase.from("inventory_purchases").insert({
      user_id: userId,
      inventory_item_id: itemId,
      cost: money(purchase.cost),
      purchase_date: toDateOnly(purchase.date || purchase.createdAt || nowIso()),
    });

    if (error) throw error;
  }

  for (const sale of store.sales || []) {
    const itemId = inventoryIds.get(sale.itemId);
    const { error } = await supabase.from("sales").insert({
      user_id: userId,
      inventory_item_id: itemId || null,
      collection_id: collectionIds.get(sale.collectionId) || null,
      sku_snapshot: sale.sku || "",
      item_name_snapshot: sale.itemName || "",
      cost_snapshot: money(sale.cost),
      sale_price: money(sale.price),
      platform: sale.platform || "Other",
      payment_status: sale.paymentStatus || PAYMENT_STATUSES.PAID,
      sale_date: toDateOnly(sale.date || nowIso()),
      notes: sale.notes || "",
      voided_at: sale.voidedAt || null,
    });

    if (error) throw error;
  }

  for (const expense of store.expenses || []) {
    const { error } = await supabase.from("expenses").insert({
      user_id: userId,
      inventory_item_id: inventoryIds.get(expense.itemId) || null,
      collection_id: collectionIds.get(expense.collectionId) || null,
      category: expense.category || "Other",
      amount: money(expense.amount),
      details: expense.details || "",
      sku_snapshot: expense.sku || null,
      item_name_snapshot: expense.itemName || null,
      expense_date: toDateOnly(expense.date || nowIso()),
    });

    if (error) throw error;
  }

  for (const entry of store.capital || []) {
    const { error } = await supabase.from("capital_records").insert({
      user_id: userId,
      type: entry.type || "Capital Added",
      amount: money(entry.amount),
      details: entry.notes || entry.details || "",
      record_date: toDateOnly(entry.date || nowIso()),
    });

    if (error) throw error;
  }

  await saveMeta(userId, { lastSkuNumber: highestSkuNumber(store) });
  await insertActivity(userId, {
    entityType: "backup",
    entityId: null,
    action: "backup.imported",
    label: "Imported full backup",
    details: "Imported full backup into Supabase",
  });

  return true;
}
