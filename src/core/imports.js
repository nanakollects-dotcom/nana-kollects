import { CAPITAL_TYPES, EXPENSE_CATEGORIES, PAYMENT_STATUSES, PLATFORMS, STATUSES } from "../services/repository.js";

const todayIso = () => new Date().toISOString();
const clean = (value) => String(value ?? "").trim();
const keyFor = (value) => clean(value).toLowerCase().replace(/[\s_-]+/g, "");
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const inventorySummaryLabels = new Set([
  "cashonhand",
  "cash",
  "cashbalance",
  "openingcash",
  "openingbalance",
  "initialcapital",
  "startingcapital",
  "totalitemcost",
  "totalcost",
  "totalmarkedup",
  "totalmarkup",
  "totalsales",
  "totalrevenue",
  "sales",
  "revenue",
]);

export const IMPORT_TYPES = {
  INVENTORY: "inventory",
  COLLECTIONS: "collections",
  SALES: "sales",
  EXPENSES: "expenses",
  CAPITAL: "capital",
};

export const IMPORT_LABELS = {
  [IMPORT_TYPES.INVENTORY]: "Inventory",
  [IMPORT_TYPES.COLLECTIONS]: "Collections",
  [IMPORT_TYPES.SALES]: "Sales",
  [IMPORT_TYPES.EXPENSES]: "Expenses",
  [IMPORT_TYPES.CAPITAL]: "Capital",
};

export const TEMPLATE_HEADERS = {
  [IMPORT_TYPES.INVENTORY]: ["sku", "name", "collection", "cost", "price", "status", "date_added", "notes"],
  [IMPORT_TYPES.COLLECTIONS]: ["name", "description", "created_date"],
  [IMPORT_TYPES.SALES]: ["sku", "item_name", "collection", "sale_price", "cost", "platform", "payment_status", "sale_date", "notes"],
  [IMPORT_TYPES.EXPENSES]: ["category", "amount", "details", "expense_date", "sku", "item_name"],
  [IMPORT_TYPES.CAPITAL]: ["type", "amount", "details", "record_date"],
};

const aliases = {
  [IMPORT_TYPES.INVENTORY]: {
    sku: ["sku"],
    name: [
      "name",
      "item",
      "item_name",
      "item name",
      "product",
      "product_name",
      "product name",
      "description",
      "item_description",
      "item description",
      "desc",
    ],
    collection: ["collection", "drop", "batch", "collection_name"],
    cost: [
      "cost",
      "pricing_cost",
      "pricing cost",
      "purchase_cost",
      "purchase cost",
      "buying_price",
      "buying price",
      "item_cost",
      "item cost",
      "capital",
      "base_cost",
      "base cost",
    ],
    price: [
      "price",
      "selling_price",
      "selling price",
      "sale_price",
      "sale price",
      "retail_price",
      "retail price",
      "list_price",
      "list price",
      "marked_price",
      "marked price",
    ],
    status: ["status", "item_status", "item status", "inventory_status", "inventory status"],
    dateAdded: ["date_added", "date", "created_at", "added_on"],
    notes: ["notes", "note", "details", "remarks", "comment", "comments"],
  },
  [IMPORT_TYPES.COLLECTIONS]: {
    name: ["name", "collection", "collection_name", "drop"],
    description: ["description", "notes", "details"],
    createdDate: ["created_date", "created_at", "date"],
  },
  [IMPORT_TYPES.EXPENSES]: {
    category: ["category", "type", "expense_type"],
    amount: ["amount", "cost", "value", "expense_amount"],
    details: ["details", "notes", "description"],
    expenseDate: ["expense_date", "date", "created_at"],
    sku: ["sku", "item_sku"],
    itemName: ["item_name", "item", "name", "product"],
  },
  [IMPORT_TYPES.CAPITAL]: {
    type: ["type", "capital_type", "transaction_type"],
    amount: ["amount", "value"],
    details: ["details", "notes", "description"],
    recordDate: ["record_date", "date", "created_at"],
  },
  [IMPORT_TYPES.SALES]: {
    sku: ["sku", "item_sku"],
    itemName: ["item_name", "item", "name", "product"],
    collection: ["collection", "drop", "batch", "collection_name"],
    salePrice: ["sale_price", "sold_price", "price", "amount", "revenue"],
    cost: ["cost", "item_cost"],
    platform: ["platform", "channel", "sold_on"],
    paymentStatus: ["payment_status", "payment", "paid_status"],
    saleDate: ["sale_date", "date", "sold_date"],
    notes: ["notes", "details", "description"],
  },
};

const statusMap = {
  available: STATUSES.AVAILABLE,
  reserved: STATUSES.RESERVED,
  sold: STATUSES.SOLD,
  writtenoff: STATUSES.WRITTEN_OFF,
  writeoff: STATUSES.WRITTEN_OFF,
  archived: STATUSES.ARCHIVED,
};

const platformMap = {
  fb: "Facebook",
  facebook: "Facebook",
  ig: "Instagram",
  instagram: "Instagram",
  tiktok: "TikTok",
  direct: "Direct Customer",
  directcustomer: "Direct Customer",
  walkin: "Walk-in",
  other: "Other",
};

const paymentMap = {
  paid: PAYMENT_STATUSES.PAID,
  pending: PAYMENT_STATUSES.PENDING,
};

const expenseCategoryMap = {
  packaging: "Packaging",
  shipping: "Shipping",
  marketing: "Marketing",
  ads: "Marketing",
  supplies: "Supplies",
  writeoff: "Write-Off",
  operating: "Operating",
  other: "Other",
};

const capitalTypeMap = {
  capitaladded: CAPITAL_TYPES.ADDED,
  capital: CAPITAL_TYPES.ADDED,
  added: CAPITAL_TYPES.ADDED,
  deposit: CAPITAL_TYPES.ADDED,
  withdrawal: CAPITAL_TYPES.WITHDRAWAL,
  withdraw: CAPITAL_TYPES.WITHDRAWAL,
  cashout: CAPITAL_TYPES.WITHDRAWAL,
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => clean(value))) rows.push(row);
  return rows;
}

function headerLookup(headers, type) {
  const normalizedHeaders = headers.map(keyFor);
  const config = aliases[type] || {};

  return Object.fromEntries(
    Object.entries(config).map(([field, names]) => {
      const candidates = names.map(keyFor);
      const index = normalizedHeaders.findIndex((header) => candidates.includes(header));
      return [field, index];
    }),
  );
}

function legacyInventoryNotices(headers, type) {
  if (type !== IMPORT_TYPES.INVENTORY) return [];
  const normalizedHeaders = new Set(headers.map(keyFor));
  const hasDescription = normalizedHeaders.has("description");
  const hasPricingCost = normalizedHeaders.has("pricingcost");
  const hasSellingPrice = normalizedHeaders.has("sellingprice");

  return hasDescription && hasPricingCost && hasSellingPrice
    ? ["Legacy inventory headers detected. Description was mapped to item name, Pricing Cost to cost, and Selling Price to price."]
    : [];
}

function readValue(row, lookup, field) {
  const index = lookup[field];
  return index >= 0 ? clean(row[index]) : "";
}

function parseNumberValue(value, label, errors) {
  if (!clean(value)) return null;
  const normalized = clean(value).replace(/[₱,\s]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    errors.push(`${label} must be a valid number.`);
    return null;
  }
  return money(parsed);
}

function parseDateValue(value, label, errors) {
  if (!clean(value)) return todayIso();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${label} must be a valid date.`);
    return "";
  }
  return parsed.toISOString();
}

function normalizeStatus(value, errors) {
  if (!clean(value)) return STATUSES.AVAILABLE;
  const status = statusMap[keyFor(value)];
  if (!status) errors.push("Status is not valid.");
  return status || "";
}

function normalizePlatform(value, errors) {
  const platform = platformMap[keyFor(value)];
  if (!platform) errors.push("Platform is not valid.");
  return platform || "";
}

function normalizePayment(value, errors) {
  if (!clean(value)) return PAYMENT_STATUSES.PAID;
  const payment = paymentMap[keyFor(value)];
  if (!payment) errors.push("Payment status is not valid.");
  return payment || "";
}

function normalizeExpenseCategory(value, errors) {
  if (!clean(value)) {
    errors.push("Category is required.");
    return "";
  }
  const category = expenseCategoryMap[keyFor(value)] || (EXPENSE_CATEGORIES.includes(value) ? value : "");
  if (!category) errors.push("Category is not valid.");
  return category;
}

function normalizeCapitalType(value, errors) {
  if (!clean(value)) {
    errors.push("Capital type is required.");
    return "";
  }
  const type = capitalTypeMap[keyFor(value)] || (Object.values(CAPITAL_TYPES).includes(value) ? value : "");
  if (!type) errors.push("Capital type is not valid.");
  return type;
}

const normalizeSku = (value) => clean(value).toUpperCase();

function rowState(rowNumber, data, warnings, errors) {
  return {
    rowNumber,
    data,
    warnings,
    errors,
    status: errors.length ? "error" : warnings.length ? "warning" : "ready",
  };
}

function existingCollectionNames(store) {
  return new Set((store.collections || []).map((collection) => collection.name.toLowerCase()));
}

function inventoryDuplicateKey(item) {
  return `${clean(item.name).toLowerCase()}|${clean(item.collectionId).toLowerCase()}|${item.cost === null ? "pending" : money(item.cost)}|${money(item.price)}`;
}

function validateInventory(row, lookup, rowNumber, store, batch) {
  const errors = [];
  const warnings = [];
  const sku = normalizeSku(readValue(row, lookup, "sku"));
  const name = readValue(row, lookup, "name");
  const collection = readValue(row, lookup, "collection");
  const cost = parseNumberValue(readValue(row, lookup, "cost"), "Cost", errors);
  const price = parseNumberValue(readValue(row, lookup, "price"), "Price", errors) ?? 0;
  const status = normalizeStatus(readValue(row, lookup, "status"), errors);
  const dateAdded = parseDateValue(readValue(row, lookup, "dateAdded"), "Date added", errors);
  const notes = readValue(row, lookup, "notes");

  if (inventorySummaryLabels.has(keyFor(name))) {
    batch.summaryRows += 1;
    errors.push("Spreadsheet summary totals were ignored. Import capital, sales, or expenses separately for accurate financial history.");
  }

  if (!name) errors.push("Name is required.");
  if (cost !== null && price < cost) warnings.push("Price is lower than cost.");
  if (sku && store.inventory.some((item) => item.sku === sku)) errors.push("Duplicate SKU already exists.");
  if (sku && batch.skus.has(sku)) errors.push("Duplicate SKU appears in this CSV.");
  if (sku) batch.skus.add(sku);

  const collectionNames = existingCollectionNames(store);
  if (collection && !collectionNames.has(collection.toLowerCase())) {
    batch.collections.add(collection);
    warnings.push(`Collection "${collection}" will be created.`);
  }

  const possibleKey = inventoryDuplicateKey({ name, collectionId: collection, cost, price });
  if (!sku && batch.items.has(possibleKey)) warnings.push("Possible duplicate item appears in this CSV.");
  if (!sku && store.inventory.some((item) => inventoryDuplicateKey(item) === possibleKey)) warnings.push("Possible duplicate item already exists.");
  batch.items.add(possibleKey);
  if (status === STATUSES.SOLD) warnings.push("Sold inventory rows will count as sold stock and sell-through, but will not create sales revenue unless imported through Sales CSV.");
  if (status === STATUSES.WRITTEN_OFF) warnings.push("Written Off imports inventory status only. Import expenses separately for financial history.");

  return rowState(rowNumber, { name, sku, collection, cost, price, status, dateAdded, notes }, warnings, errors);
}

function validateCollection(row, lookup, rowNumber, store, batch) {
  const errors = [];
  const warnings = [];
  const name = readValue(row, lookup, "name");
  const description = readValue(row, lookup, "description");
  const createdDate = parseDateValue(readValue(row, lookup, "createdDate"), "Created date", errors);
  const existing = existingCollectionNames(store);
  const key = name.toLowerCase();

  if (!name) errors.push("Name is required.");
  if (name && existing.has(key)) errors.push("Duplicate collection already exists.");
  if (name && batch.collections.has(key)) errors.push("Duplicate collection appears in this CSV.");
  if (name) batch.collections.add(key);

  return rowState(rowNumber, { name, description, createdDate }, warnings, errors);
}

function validateExpense(row, lookup, rowNumber) {
  const errors = [];
  const warnings = [];
  const category = normalizeExpenseCategory(readValue(row, lookup, "category"), errors);
  const amount = parseNumberValue(readValue(row, lookup, "amount"), "Amount", errors);
  const details = readValue(row, lookup, "details");
  const expenseDate = parseDateValue(readValue(row, lookup, "expenseDate"), "Expense date", errors);
  const sku = normalizeSku(readValue(row, lookup, "sku"));
  const itemName = readValue(row, lookup, "itemName");

  if (amount === null) errors.push("Amount is required.");
  if (category === "Operating") warnings.push("Operating is accepted for import, but the current app UI does not list it yet.");
  if (category === "Write-Off" && (sku || itemName)) warnings.push("Write-Off details will be stored as text only; inventory status will not change.");

  return rowState(rowNumber, { category, amount: amount ?? 0, details, expenseDate, sku, itemName }, warnings, errors);
}

function validateCapital(row, lookup, rowNumber) {
  const errors = [];
  const warnings = [];
  const type = normalizeCapitalType(readValue(row, lookup, "type"), errors);
  const amount = parseNumberValue(readValue(row, lookup, "amount"), "Amount", errors);
  const details = readValue(row, lookup, "details");
  const recordDate = parseDateValue(readValue(row, lookup, "recordDate"), "Record date", errors);

  if (amount === null) errors.push("Amount is required.");
  return rowState(rowNumber, { type, amount: amount ?? 0, details, recordDate }, warnings, errors);
}

function validateSale(row, lookup, rowNumber, store, batch) {
  const errors = [];
  const warnings = [];
  const sku = normalizeSku(readValue(row, lookup, "sku"));
  const itemName = readValue(row, lookup, "itemName");
  const collection = readValue(row, lookup, "collection");
  const salePrice = parseNumberValue(readValue(row, lookup, "salePrice"), "Sale price", errors);
  const explicitCost = parseNumberValue(readValue(row, lookup, "cost"), "Cost", errors);
  const platform = normalizePlatform(readValue(row, lookup, "platform"), errors);
  const paymentStatus = normalizePayment(readValue(row, lookup, "paymentStatus"), errors);
  const saleDate = readValue(row, lookup, "saleDate")
    ? parseDateValue(readValue(row, lookup, "saleDate"), "Sale date", errors)
    : "";
  const notes = readValue(row, lookup, "notes");

  if (salePrice === null) errors.push("Sale price is required.");
  if (!saleDate) errors.push("Sale date is required.");
  if (!sku && !itemName) errors.push("SKU or item name is required.");

  const item = sku
    ? store.inventory.find((entry) => entry.sku === sku)
    : store.inventory.find((entry) => entry.name.toLowerCase() === itemName.toLowerCase());

  if (!item) {
    errors.push("No matching inventory item found for SKU/item.");
  } else {
    if (item.status === STATUSES.SOLD) errors.push("Matching inventory item is already Sold.");
    if (store.sales.some((sale) => sale.itemId === item.id)) errors.push("Matching inventory item already has a sale record.");
  }

  const duplicateKey = `${sku || itemName.toLowerCase()}|${saleDate}|${salePrice}`;
  if (batch.sales.has(duplicateKey)) warnings.push("Possible duplicate sale appears in this CSV.");
  if (store.sales.some((sale) =>
    `${sale.sku || sale.itemName?.toLowerCase()}|${sale.date}|${money(sale.price)}` === duplicateKey
  )) warnings.push("Possible duplicate sale already exists.");
  batch.sales.add(duplicateKey);

  return rowState(rowNumber, {
    sku,
    itemName,
    collection,
    salePrice: salePrice ?? 0,
    cost: explicitCost,
    platform,
    paymentStatus,
    saleDate,
    notes,
    itemId: item?.id || "",
  }, warnings, errors);
}

const validators = {
  [IMPORT_TYPES.INVENTORY]: validateInventory,
  [IMPORT_TYPES.COLLECTIONS]: validateCollection,
  [IMPORT_TYPES.EXPENSES]: validateExpense,
  [IMPORT_TYPES.CAPITAL]: validateCapital,
  [IMPORT_TYPES.SALES]: validateSale,
};

export function prepareImportPreview(type, csvText, store) {
  if (!Object.values(IMPORT_TYPES).includes(type)) throw new Error("Choose a valid import type.");
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error("CSV file is empty.");
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one data row.");

  const [headers, ...dataRows] = rows;
  if (!headers.some((header) => clean(header))) throw new Error("CSV header row is missing.");

  const lookup = headerLookup(headers, type);
  const validator = validators[type];
  const batch = { skus: new Set(), items: new Set(), collections: new Set(), sales: new Set(), summaryRows: 0 };
  const parsedRows = dataRows.map((row, index) => validator(row, lookup, index + 2, store, batch));
  const validRows = parsedRows.filter((row) => row.status !== "error");
  const invalidRows = parsedRows.filter((row) => row.status === "error");
  const warningRows = parsedRows.filter((row) => row.status === "warning");

  return {
    id: `preview_${Date.now()}`,
    type,
    notices: [
      ...legacyInventoryNotices(headers, type),
      ...(batch.summaryRows
        ? ["Spreadsheet summary totals were ignored. Import capital, sales, or expenses separately for accurate financial history."]
        : []),
    ],
    totalRows: parsedRows.length,
    validRows: validRows.length,
    warningRows: warningRows.length,
    invalidRows: invalidRows.length,
    rows: parsedRows,
    readyRows: validRows,
    newCollections: Array.from(batch.collections),
  };
}

export function templateRows(type) {
  const headers = TEMPLATE_HEADERS[type];
  if (!headers) throw new Error("Choose a valid template type.");
  return [headers];
}
