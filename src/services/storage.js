const STORAGE_KEY = "nana-kollects-business-tracker:v1";
const BACKUP_APP_ID = "nana-kollects-business-tracker";
const BACKUP_VERSION = 1;
const CAPITAL_ADDED = "Capital Added";
const CAPITAL_WITHDRAWAL = "Withdrawal";

let activeStore = null;

export const emptyStore = () => ({
  inventory: [],
  sales: [],
  expenses: [],
  capital: [],
  purchases: [],
  logs: [],
  collections: [],
  paymentRequests: [],
  paymentConfig: {
    gcashAccountName: "",
    gcashMobileNumber: "",
    gotymeAccountName: "",
    gotymeQrImage: "",
  },
  meta: {
    lastSkuNumber: 0,
  },
});

function createFallbackId(prefix) {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${suffix}`;
}

function normalizeCapitalType(type) {
  const cleanType = String(type || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (
    cleanType === "capitaladded" ||
    cleanType === "added" ||
    cleanType === "addcapital" ||
    cleanType === "capital" ||
    cleanType === "deposit"
  ) return CAPITAL_ADDED;
  if (cleanType === "withdrawal" || cleanType === "withdraw" || cleanType === "cashout") return CAPITAL_WITHDRAWAL;
  return type === CAPITAL_WITHDRAWAL ? CAPITAL_WITHDRAWAL : CAPITAL_ADDED;
}

function normalizeCapitalEntry(entry) {
  const date = entry.date || entry.createdAt || new Date().toISOString();
  const notes = String(entry.notes ?? entry.details ?? "").trim();

  return {
    ...entry,
    id: entry.id || createFallbackId("capital"),
    type: normalizeCapitalType(entry.type),
    amount: Math.round(Number(entry.amount || 0) * 100) / 100,
    date,
    notes,
    details: notes,
    createdAt: entry.createdAt || date,
    updatedAt: entry.updatedAt || entry.createdAt || date,
  };
}

export function normalizeStore(rawStore = {}) {
  const capitalSource = Array.isArray(rawStore.capital)
    ? rawStore.capital
    : Array.isArray(rawStore.capitalRecords)
      ? rawStore.capitalRecords
      : [];
  const inventory = Array.isArray(rawStore.inventory) ? rawStore.inventory : [];
  const lastInventorySkuNumber = inventory
    .map((item) => item.sku)
    .filter((sku) => /^NK-\d+$/.test(String(sku || "")))
    .map((sku) => Number(String(sku).replace("NK-", "")))
    .reduce((max, number) => Math.max(max, number), 0);
  const meta = {
    ...(rawStore.meta || {}),
    lastSkuNumber: Math.max(Number(rawStore.meta?.lastSkuNumber || 0), lastInventorySkuNumber),
  };

  return {
    ...emptyStore(),
    ...rawStore,
    capital: capitalSource.map(normalizeCapitalEntry),
    inventory,
    meta,
  };
}

export function loadStore() {
  return activeStore ? structuredClone(activeStore) : emptyStore();
}

export function replaceStore(nextStore) {
  const cleanStore = normalizeStore(nextStore);
  activeStore = cleanStore;
  // Supabase is the source of truth; localStorage is only a browser-side cache/export fallback.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanStore));
  window.dispatchEvent(new CustomEvent("store:changed", { detail: cleanStore }));
  return cleanStore;
}

export function exportStoreBackup() {
  const store = loadStore();

  const backup = {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: store,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `nana-kollects-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export function importStoreBackup(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Choose a backup file."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);

        if (parsed.app !== BACKUP_APP_ID || !parsed.data) {
          throw new Error("Invalid backup file.");
        }

        resolve(normalizeStore(parsed.data));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Could not read backup file."));
    };

    reader.readAsText(file);
  });
}

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export function exportSalesCsv() {
  const store = loadStore();
  const date = new Date().toISOString().slice(0, 10);

  const rows = [
    [
      "Item",
      "SKU",
      "Sold Price",
      "Cost",
      "Profit",
      "Date",
      "Platform",
      "Payment Status",
    ],
    ...store.sales.map((sale) => [
      sale.itemName,
      sale.sku,
      sale.price,
      sale.cost,
      sale.profit,
      sale.date,
      sale.platform,
      sale.paymentStatus,
    ]),
  ];

  downloadCsv(`nana-kollects-sales-${date}.csv`, rows);
}

export function exportInventoryCsv() {
  const store = loadStore();
  const date = new Date().toISOString().slice(0, 10);

  const rows = [
    [
      "Item",
      "SKU",
      "Cost",
      "Price",
      "Status",
      "Collection",
      "Created At",
      "Sold At",
      "Platform",
      "Payment Status",
    ],
    ...store.inventory.map((item) => [
      item.name,
      item.sku,
      item.cost,
      item.price,
      item.status,
      item.collectionId,
      item.createdAt,
      item.soldAt,
      item.platform,
      item.paymentStatus,
    ]),
  ];

  downloadCsv(`nana-kollects-inventory-${date}.csv`, rows);
}

export function exportExpensesCsv() {
  const store = loadStore();
  const date = new Date().toISOString().slice(0, 10);

  const rows = [
    ["Date", "Category", "Amount", "Details"],
    ...store.expenses.map((expense) => [
      expense.date,
      expense.category,
      expense.amount,
      expense.details,
    ]),
  ];

  downloadCsv(`nana-kollects-expenses-${date}.csv`, rows);
}

export function exportCapitalCsv() {
  const store = loadStore();
  const date = new Date().toISOString().slice(0, 10);

  const rows = [
    ["Date", "Type", "Notes", "Amount"],
    ...store.capital.map((entry) => [
      entry.date,
      entry.type,
      entry.notes ?? entry.details,
      entry.amount,
    ]),
  ];

  downloadCsv(`nana-kollects-capital-${date}.csv`, rows);
}
