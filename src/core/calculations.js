import { CAPITAL_TYPES, PAYMENT_STATUSES, STATUSES } from "../services/repository.js";
import { isWithinRange } from "./filters.js";

const money = (value) => Number(value || 0);
const activeInventory = (item) => item.status === STATUSES.AVAILABLE || item.status === STATUSES.RESERVED;
const availableInventory = (item) => item.status === STATUSES.AVAILABLE;
const inRange = (items, filters) => items.filter((item) => isWithinRange(item.date || item.createdAt, filters));
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const isValidDate = (value) => Boolean(value) && !Number.isNaN(new Date(value).getTime());
const sameDateTime = (first, second) =>
  isValidDate(first) && isValidDate(second) && new Date(first).getTime() === new Date(second).getTime();

export function getInventoryStatusCounts(inventory = []) {
  return inventory.reduce(
    (counts, item) => {
      if (item.status === STATUSES.AVAILABLE) counts.available += 1;
      if (item.status === STATUSES.RESERVED) counts.reserved += 1;
      if (item.status === STATUSES.SOLD) counts.sold += 1;
      if (item.status === STATUSES.WRITTEN_OFF) counts.writtenOff += 1;
      if (item.status === STATUSES.ARCHIVED) counts.archived += 1;
      counts.total += 1;
      return counts;
    },
    { available: 0, reserved: 0, sold: 0, writtenOff: 0, archived: 0, total: 0 },
  );
}

export function getOperationalSoldItems(inventory = []) {
  return inventory.filter((item) => item.status === STATUSES.SOLD);
}

export function getOperationalSoldItemsCount(store, filters = {}) {
  return store.inventory.filter(
    (item) => item.status === STATUSES.SOLD && isWithinRange(item.soldAt || item.createdAt, filters),
  ).length;
}

export function getActiveInventoryItems(inventory = []) {
  return inventory.filter((item) => item.status !== STATUSES.ARCHIVED);
}

export function getRevenue(store, filters = {}) {
  return inRange(store.sales, filters).reduce((total, sale) => total + money(sale.price), 0);
}

export function getCostOfSoldItems(store, filters = {}) {
  return inRange(store.sales, filters).reduce((total, sale) => total + money(sale.cost), 0);
}

export function getExpenses(store, filters = {}) {
  return inRange(store.expenses, filters).reduce((total, expense) => total + money(expense.amount), 0);
}

export function getProfit(store, filters = {}) {
  return getRevenue(store, filters) - getCostOfSoldItems(store, filters) - getExpenses(store, filters);
}

export function getInventoryCost(store) {
  return store.inventory.filter(availableInventory).reduce((total, item) => total + money(item.cost), 0);
}

export function getInventoryValue(store) {
  return store.inventory.filter(availableInventory).reduce((total, item) => total + money(item.price), 0);
}

export function getInventoryProfitPotential(item) {
  return money(item.price) - money(item.cost);
}

export function getInventoryMarginPercent(item) {
  const price = money(item.price);
  if (!price) return 0;
  return ((price - money(item.cost)) / price) * 100;
}

export function getInventoryAgeDays(item, now = new Date()) {
  const start = new Date(item.createdAt || item.dateAdded || now);
  const end = item.soldAt ? new Date(item.soldAt) : now;
  const diff = Math.max(0, end - start);
  return Math.floor(diff / MS_PER_DAY);
}

export function getSlowMovingInventory(store, thresholdDays = 30, limit = 3) {
  return store.inventory
    .filter(activeInventory)
    .map((item) => ({ ...item, ageDays: getInventoryAgeDays(item) }))
    .filter((item) => item.ageDays >= thresholdDays)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, limit);
}

export function getInventoryAlerts(store, filters = {}) {
  const slowMoving = getSlowMovingInventory(store, 30, Number.POSITIVE_INFINITY);
  const lowMargin = store.inventory
    .filter(activeInventory)
    .filter((item) => getInventoryMarginPercent(item) < 30);
  const writtenOff = store.inventory
    .filter((item) => item.status === STATUSES.WRITTEN_OFF);
  const writtenOffThisPeriod = writtenOff.filter((item) => isWithinRange(item.writtenOffAt || item.createdAt, filters));
  const available = store.inventory.filter(availableInventory);

  return [
    slowMoving.length
      ? {
        tone: "warn",
        message: slowMoving.length === 1
          ? `${slowMoving[0].name} is older than 30 days. Consider posting, discounting, or bundling.`
          : `${slowMoving.slice(0, 3).map((item) => item.name).join(", ")}${slowMoving.length > 3 ? ` and ${slowMoving.length - 3} more` : ""} are older than 30 days. Review slow-moving stock.`,
      }
      : null,
    lowMargin.length
      ? {
        tone: "warn",
        message: lowMargin.length === 1
          ? `${lowMargin[0].name} is below target margin at ${getInventoryMarginPercent(lowMargin[0]).toFixed(1)}%. Review pricing.`
          : `${lowMargin.slice(0, 3).map((item) => item.name).join(", ")}${lowMargin.length > 3 ? ` and ${lowMargin.length - 3} more` : ""} are below target margin. Review pricing.`,
      }
      : null,
    writtenOffThisPeriod.length ? { tone: "danger", message: `${writtenOffThisPeriod.length} item${writtenOffThisPeriod.length === 1 ? " was" : "s were"} written off this period.` } : null,
    !available.length ? { tone: "danger", message: "No available items left." } : null,
  ].filter(Boolean);
}

export function getItemsSold(store, filters = {}) {
  return getOperationalSoldItemsCount(store, filters);
}

export function getItemsAvailable(store) {
  return store.inventory.filter(availableInventory).length;
}

export function getSellThrough(store, filters = {}) {
  const sold = getItemsSold(store, filters);
  const unsold = store.inventory.filter(activeInventory).length;
  const total = sold + unsold;
  return total === 0 ? 0 : (sold / total) * 100;
}

export function getCash(store) {
  const capitalAdded = store.capital
    .filter((entry) => entry.type === CAPITAL_TYPES.ADDED)
    .reduce((total, entry) => total + money(entry.amount), 0);
  const withdrawals = store.capital
    .filter((entry) => entry.type === CAPITAL_TYPES.WITHDRAWAL)
    .reduce((total, entry) => total + money(entry.amount), 0);
  const paidRevenue = store.sales
    .filter((sale) => sale.paymentStatus === PAYMENT_STATUSES.PAID)
    .reduce((total, sale) => total + money(sale.price), 0);
  const inventoryPurchases = store.purchases.reduce((total, purchase) => total + money(purchase.cost), 0);
  const cashExpenses = store.expenses
    .filter((expense) => expense.category !== "Write-Off")
    .reduce((total, expense) => total + money(expense.amount), 0);

  return capitalAdded + paidRevenue - inventoryPurchases - cashExpenses - withdrawals;
}

export function getCapitalTotals(store, filters = {}) {
  return inRange(store.capital, filters).reduce(
    (summary, entry) => {
      if (entry.type === CAPITAL_TYPES.ADDED) summary.totalCapitalAdded += money(entry.amount);
      if (entry.type === CAPITAL_TYPES.WITHDRAWAL) summary.totalWithdrawals += money(entry.amount);
      summary.netCapital = summary.totalCapitalAdded - summary.totalWithdrawals;
      return summary;
    },
    { totalCapitalAdded: 0, totalWithdrawals: 0, netCapital: 0 },
  );
}

export function getCapitalSummary(store, filters = {}, options = { cashScope: "all-time" }) {
  const totals = getCapitalTotals(store, filters);
  return {
    ...totals,
    cash: options.cashScope === "none" ? 0 : getCash(store),
  };
}

export function getCollectionSnapshots(store, filters = {}) {
  const names = [
    ...new Set([
      ...(store.collections || []).map((collection) => collection.name),
      ...store.inventory.map((item) => item.collectionId || "Unassigned"),
    ]),
  ];
  return names.map((name) => {
    const collectionRecord = (store.collections || []).find((collection) => collection.name === name);
    const items = store.inventory.filter((item) => (item.collectionId || "Unassigned") === name);
    const performanceItems = items.filter((item) => item.status !== STATUSES.ARCHIVED);
    const itemIds = new Set(items.map((item) => item.id));
    const sales = inRange(store.sales, filters).filter((sale) => itemIds.has(sale.itemId));
    const activeItems = performanceItems.filter(activeInventory);
    const remainingCount = activeItems.length;
    const soldCount = performanceItems.filter((item) => item.status === STATUSES.SOLD).length;
    const revenue = sales.reduce((total, sale) => total + money(sale.price), 0);
    const cost = sales.reduce((total, sale) => total + money(sale.cost), 0);
    const total = soldCount + remainingCount;
    const inventoryRemainingValue = activeItems.reduce((totalValue, item) => totalValue + money(item.cost), 0);
    const capitalUsed = performanceItems.reduce((totalCost, item) => totalCost + money(item.cost), 0);
    const roi = capitalUsed === 0 ? 0 : ((revenue - cost) / capitalUsed) * 100;
    const earliestItemDate = items
      .map((item) => item.createdAt)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];

    return {
      name,
      createdAt: collectionRecord?.createdAt || earliestItemDate || "",
      itemsCount: performanceItems.length,
      soldCount,
      remainingCount,
      revenue,
      profit: revenue - cost,
      inventoryRemainingValue,
      capitalUsed,
      roi,
      sellThrough: total === 0 ? 0 : (soldCount / total) * 100,
    };
  });
}

export function getBusinessSnapshot(store, filters = {}) {
  return {
    revenue: getRevenue(store, filters),
    profit: getProfit(store, filters),
    expenses: getExpenses(store, filters),
    cash: getCash(store),
    inventoryCost: getInventoryCost(store),
    inventoryValue: getInventoryValue(store),
    itemsSold: getItemsSold(store, filters),
    itemsAvailable: getItemsAvailable(store),
    sellThrough: getSellThrough(store, filters),
  };
}

export function getFinancialIntegrityReport(store) {
  const report = {
    errors: [],
    warnings: [],
    info: [],
    summary: {
      inventoryItems: store.inventory.length,
      purchaseRecords: store.purchases.length,
      salesRecords: store.sales.length,
      expenseRecords: store.expenses.length,
      capitalRecords: store.capital.length,
    },
  };
  const inventoryById = new Map(store.inventory.map((item) => [item.id, item]));
  const salesByItemId = new Map(store.sales.map((sale) => [sale.itemId, sale]));
  const purchasesByItemId = store.purchases.reduce((groups, purchase) => {
    if (!groups.has(purchase.itemId)) groups.set(purchase.itemId, []);
    groups.get(purchase.itemId).push(purchase);
    return groups;
  }, new Map());

  store.inventory.forEach((item) => {
    const purchases = purchasesByItemId.get(item.id) || [];
    if (!isValidDate(item.createdAt)) report.warnings.push(`Inventory item ${item.sku || item.id} has an invalid created date.`);
    if (purchases.length === 0) report.errors.push(`Inventory item ${item.sku || item.id} is missing a purchase record.`);
    if (purchases.length > 1) report.errors.push(`Inventory item ${item.sku || item.id} has duplicate purchase records.`);
    if (purchases.length === 1) {
      const [purchase] = purchases;
      if (money(purchase.cost) !== money(item.cost)) report.errors.push(`Purchase cost does not match item cost for ${item.sku || item.id}.`);
      if (!sameDateTime(purchase.date, item.createdAt)) report.warnings.push(`Purchase date does not match item created date for ${item.sku || item.id}.`);
    }
    if (item.status === STATUSES.SOLD && !salesByItemId.has(item.id)) {
      report.info.push(`Sold inventory item ${item.sku || item.id} has no sales record; this can be valid for legacy inventory imports.`);
    }
  });

  store.purchases.forEach((purchase) => {
    if (!inventoryById.has(purchase.itemId)) report.errors.push(`Purchase record ${purchase.id || "unknown"} points to a missing inventory item.`);
    if (money(purchase.cost) < 0) report.errors.push(`Purchase record ${purchase.id || "unknown"} has an invalid cost.`);
    if (!isValidDate(purchase.date)) report.warnings.push(`Purchase record ${purchase.id || "unknown"} has an invalid date.`);
  });

  store.capital.forEach((entry) => {
    if (![CAPITAL_TYPES.ADDED, CAPITAL_TYPES.WITHDRAWAL].includes(entry.type)) report.errors.push(`Capital record ${entry.id || "unknown"} has an invalid type.`);
    if (money(entry.amount) <= 0) report.errors.push(`Capital record ${entry.id || "unknown"} has an invalid amount.`);
    if (!isValidDate(entry.date)) report.warnings.push(`Capital record ${entry.id || "unknown"} has an invalid date.`);
  });

  store.sales.forEach((sale) => {
    const item = inventoryById.get(sale.itemId);
    if (!item) report.errors.push(`Sale record ${sale.id || "unknown"} points to a missing inventory item.`);
    if (item && item.status !== STATUSES.SOLD) report.errors.push(`Sale record ${sale.id || "unknown"} exists but inventory item ${item.sku || item.id} is not Sold.`);
    if (money(sale.price) < 0) report.errors.push(`Sale record ${sale.id || "unknown"} has an invalid price.`);
    if (money(sale.cost) < 0) report.errors.push(`Sale record ${sale.id || "unknown"} has an invalid cost.`);
    if (!isValidDate(sale.date)) report.warnings.push(`Sale record ${sale.id || "unknown"} has an invalid date.`);
  });

  store.expenses.forEach((expense) => {
    if (money(expense.amount) <= 0) report.errors.push(`Expense record ${expense.id || "unknown"} has an invalid amount.`);
    if (!isValidDate(expense.date)) report.warnings.push(`Expense record ${expense.id || "unknown"} has an invalid date.`);
  });

  return report;
}
