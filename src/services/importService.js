import { IMPORT_LABELS, IMPORT_TYPES, templateRows } from "../core/imports.js";
import { normalizeCostInput } from "../core/costs.js";
import {
  addSupabaseCapitalEntry,
  addSupabaseCollection,
  addSupabaseExpense,
  addSupabaseInventoryItem,
  getStore,
  PAYMENT_STATUSES,
  saveSupabaseInventoryItem,
  saveSupabaseSale,
  setSupabaseInventoryStatus,
  STATUSES,
} from "./repository.js";
import { downloadCsv } from "./storage.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const todayName = () => new Date().toISOString().slice(0, 10);

function findCollection(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;
  return (getStore().collections || []).find(
    (collection) => collection.name.toLowerCase() === cleanName.toLowerCase(),
  );
}

async function ensureCollection(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return "";

  const existing = findCollection(cleanName);
  if (existing) return existing.name;

  await addSupabaseCollection({
    name: cleanName,
    createdAt: new Date().toISOString(),
  });

  return cleanName;
}

async function importCollections(rows) {
  let imported = 0;

  for (const row of rows) {
    await addSupabaseCollection({
      name: row.data.name,
      createdAt: row.data.createdDate || new Date().toISOString(),
      description: row.data.description || "",
    });
    imported += 1;
  }

  return { imported, createdCollections: imported, skipped: 0 };
}

async function importInventory(rows) {
  let imported = 0;
  let createdCollections = 0;

  for (const row of rows) {
    const beforeCollection = findCollection(row.data.collection);
    const collectionId = await ensureCollection(row.data.collection);
    if (collectionId && !beforeCollection) createdCollections += 1;

    await addSupabaseInventoryItem({
      sku: row.data.sku || "",
      name: row.data.name,
      cost: normalizeCostInput(row.data.cost),
      price: money(row.data.price),
      collectionId,
      createdAt: row.data.dateAdded || new Date().toISOString(),
      notes: row.data.notes || "",
    });

    imported += 1;
  }

  return { imported, createdCollections, skipped: 0 };
}

async function importExpenses(rows) {
  let imported = 0;

  for (const row of rows) {
    const detailParts = [
      row.data.details,
      row.data.sku || row.data.itemName ? `${row.data.sku || ""}${row.data.sku && row.data.itemName ? " - " : ""}${row.data.itemName || ""}` : "",
    ].filter(Boolean);

    await addSupabaseExpense({
      date: row.data.expenseDate || new Date().toISOString(),
      category: row.data.category,
      amount: money(row.data.amount),
      details: detailParts.join(" | "),
    });
    imported += 1;
  }

  return { imported, createdCollections: 0, skipped: 0 };
}

async function importCapital(rows) {
  let imported = 0;

  for (const row of rows) {
    await addSupabaseCapitalEntry({
      date: row.data.recordDate || new Date().toISOString(),
      type: row.data.type,
      amount: money(row.data.amount),
      notes: row.data.details || "",
    });
    imported += 1;
  }

  return { imported, createdCollections: 0, skipped: 0 };
}

async function importSales(rows) {
  let imported = 0;

  for (const row of rows) {
    const store = getStore();
    const item = store.inventory.find((entry) =>
      row.data.itemId
        ? entry.id === row.data.itemId
        : entry.sku === row.data.sku || entry.name.toLowerCase() === row.data.itemName.toLowerCase(),
    );

    if (!item || item.status === STATUSES.SOLD || store.sales.some((sale) => sale.itemId === item.id)) continue;

    const cost = row.data.cost === null ? normalizeCostInput(item.cost) : normalizeCostInput(row.data.cost);
    const price = money(row.data.salePrice);
    const saleDate = row.data.saleDate || new Date().toISOString();
    const paymentStatus = row.data.paymentStatus || PAYMENT_STATUSES.PAID;
    const platform = row.data.platform || "Other";

    await saveSupabaseInventoryItem(item.id, {
      ...item,
      cost,
      price,
      createdAt: item.createdAt,
      collectionId: item.collectionId,
    });
    await setSupabaseInventoryStatus(item.id, STATUSES.SOLD, paymentStatus, platform);

    const createdSale = getStore().sales.find((sale) => sale.itemId === item.id);
    if (createdSale) {
      await saveSupabaseSale(createdSale.id, {
        price,
        cost,
        date: saleDate,
        platform,
        paymentStatus,
      });
    }

    imported += 1;
  }

  return { imported, createdCollections: 0, skipped: rows.length - imported };
}

const importers = {
  [IMPORT_TYPES.COLLECTIONS]: importCollections,
  [IMPORT_TYPES.INVENTORY]: importInventory,
  [IMPORT_TYPES.EXPENSES]: importExpenses,
  [IMPORT_TYPES.CAPITAL]: importCapital,
  [IMPORT_TYPES.SALES]: importSales,
};

export function downloadImportTemplate(type) {
  const label = IMPORT_LABELS[type]?.toLowerCase();
  if (!label) throw new Error("Choose a valid template type.");
  downloadCsv(`nana-kollects-${label}-template-${todayName()}.csv`, templateRows(type));
}

export async function confirmCsvImport(preview) {
  if (!preview?.readyRows?.length) throw new Error("There are no valid rows to import.");

  const importer = importers[preview.type];
  if (!importer) throw new Error("Choose a valid import type.");

  const result = await importer(preview.readyRows);
  const label = IMPORT_LABELS[preview.type];

  return {
    imported: result.imported,
    skipped: preview.invalidRows + result.skipped,
    createdCollections: result.createdCollections,
    errors: preview.invalidRows,
    warnings: preview.warningRows,
    message: `Imported ${result.imported} ${label.toLowerCase()} row${result.imported === 1 ? "" : "s"} from CSV`,
  };
}
