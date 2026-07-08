import { CAPITAL_TYPES, PAYMENT_STATUSES, STATUSES } from "../services/repository.js";
import { getCash, getSlowMovingInventory } from "./calculations.js";
import { countPendingCosts, hasKnownCost, knownCostOrZero } from "./costs.js";
import { isWithinRange } from "./filters.js";

const toMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const sortMetric = (value) => value === null || value === undefined ? Number.NEGATIVE_INFINITY : Number(value);
const inRange = (items, filters = {}) =>
  items.filter((item) => isWithinRange(item.date || item.createdAt || item.soldAt, filters));
const activeInventory = (item) => item.status === STATUSES.AVAILABLE || item.status === STATUSES.RESERVED;
const cashExpense = (expense) => expense.category !== "Write-Off";

const ageInDays = (value, asOf = new Date()) => {
  if (!value) return 0;
  const date = new Date(value);
  const end = new Date(asOf);
  if (Number.isNaN(date.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end - date) / 86400000));
};

export function getCollectionHealth(collection, asOf = new Date()) {
  const costPendingCount = Number(collection.costPendingCount || 0);
  const capitalSpent = Number(collection.capitalSpent ?? collection.totalInventoryCost ?? 0);
  const salesCollected = Number(collection.salesCollected || 0);
  const soldItems = Number(collection.soldStock ?? collection.soldCount ?? 0);
  const totalItems = Number(collection.itemsCount ?? soldItems + Number(collection.itemsLeft ?? collection.remainingCount ?? 0));
  const capitalRecovery = costPendingCount ? null : capitalSpent > 0 ? toMoney((salesCollected / capitalSpent) * 100) : 0;
  const sellThrough = totalItems > 0 ? toMoney((soldItems / totalItems) * 100) : 0;
  const ageDays = ageInDays(collection.createdAt, asOf);

  if (capitalRecovery !== null && (capitalRecovery >= 100 || (capitalRecovery >= 70 && sellThrough >= 50))) {
    return {
      label: "Healthy",
      tone: "good",
      className: "green-pill",
      capitalRecovery,
      sellThrough,
      ageDays,
    };
  }

  if (
    capitalRecovery !== null &&
    (
      (ageDays >= 30 && capitalRecovery < 50 && sellThrough < 30) ||
      (ageDays >= 45 && capitalRecovery < 70 && sellThrough < 40)
    )
  ) {
    return {
      label: "At Risk",
      tone: "warn",
      className: "yellow-pill",
      capitalRecovery,
      sellThrough,
      ageDays,
    };
  }

  return {
    label: "Needs Attention",
    tone: "warn",
    className: "info-pill",
    capitalRecovery,
    sellThrough,
    ageDays,
    costPendingCount,
    partial: costPendingCount > 0,
  };
}

export function getRevenue(store, filters = {}) {
  return toMoney(inRange(store.sales, filters).reduce((sum, sale) => sum + Number(sale.price || 0), 0));
}

export function getCOGS(store, filters = {}) {
  return toMoney(inRange(store.sales, filters).reduce((sum, sale) => sum + knownCostOrZero(sale.cost), 0));
}

export function getGrossProfit(store, filters = {}) {
  if (getSalesCostPendingCount(store, filters)) return null;
  return toMoney(getRevenue(store, filters) - getCOGS(store, filters));
}

export function getTotalExpenses(store, filters = {}) {
  return toMoney(inRange(store.expenses, filters).reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
}

export function getNetProfit(store, filters = {}) {
  return getGrossProfit(store, filters);
}

export function getInventoryValue(store) {
  return toMoney(
    store.inventory
      .filter((item) => item.status === STATUSES.AVAILABLE || item.status === STATUSES.RESERVED)
      .reduce((sum, item) => sum + knownCostOrZero(item.cost), 0),
  );
}

export function getCapitalDeployed(store) {
  return getTotalInventoryCost(store);
}

export function getCapitalInInventory(store) {
  return getCapitalDeployed(store);
}

export function getTotalInventoryCost(store) {
  return toMoney(
    store.inventory
      .reduce((sum, item) => sum + knownCostOrZero(item.cost), 0),
  );
}

export function getSalesCollected(store, filters = {}) {
  return toMoney(
    inRange(store.sales, filters)
      .filter((sale) => sale.paymentStatus === PAYMENT_STATUSES.PAID)
      .reduce((sum, sale) => sum + Number(sale.price || 0), 0),
  );
}

export function getExpectedSalesLeft(store) {
  return toMoney(
    store.inventory
      .filter(activeInventory)
      .reduce((sum, item) => sum + Number(item.price || 0), 0),
  );
}

export function getExpectedProfitLeft(store) {
  return toMoney(
    store.inventory
      .filter(activeInventory)
      .filter((item) => hasKnownCost(item.cost))
      .reduce((sum, item) => sum + Number(item.price || 0) - knownCostOrZero(item.cost), 0),
  );
}

export function getCostPendingCount(store) {
  return countPendingCosts(store.inventory);
}

export function getSalesCostPendingCount(store, filters = {}) {
  return countPendingCosts(inRange(store.sales, filters));
}

export function getCapitalRecoverySummary(store, filters = {}) {
  const costPendingCount = getCostPendingCount(store);
  const totalInventoryCost = getTotalInventoryCost(store);
  const salesCollected = getSalesCollected(store, filters);
  const recoveryRate = costPendingCount ? null : totalInventoryCost ? toMoney((salesCollected / totalInventoryCost) * 100) : 0;

  return {
    totalInventoryCost,
    salesCollected,
    recoveryRate,
    remainingCostToRecover: costPendingCount ? null : toMoney(Math.max(totalInventoryCost - salesCollected, 0)),
    costPendingCount,
  };
}

export function getCapitalAdded(store) {
  return toMoney(
    store.capital
      .filter((entry) => entry.type === CAPITAL_TYPES.ADDED)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
  );
}

export function getWithdrawals(store) {
  return toMoney(
    store.capital
      .filter((entry) => entry.type === CAPITAL_TYPES.WITHDRAWAL)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
  );
}

export function getCashAvailable(store) {
  return toMoney(getCash(store));
}

export function getCurrentCapital(store) {
  return getCashAvailable(store);
}

export function getROI(store, filters = {}) {
  const capital = getCapitalAdded(store);
  const profit = getGrossProfit(store, filters);
  if (!capital) return 0;
  if (profit === null) return null;
  return toMoney((profit / capital) * 100);
}

export function getAvailableItemsCount(store) {
  return store.inventory.filter((item) => item.status === STATUSES.AVAILABLE).length;
}

export function getSoldItemsCount(store, filters = {}) {
  return getFinancialSalesCount(store, filters);
}

export function getFinancialSalesCount(store, filters = {}) {
  return inRange(store.sales, filters).length;
}

export function getReservedItemsCount(store) {
  return store.inventory.filter((item) => item.status === STATUSES.RESERVED).length;
}

export function getWrittenOffItemsCount(store) {
  return store.inventory.filter((item) => item.status === STATUSES.WRITTEN_OFF).length;
}

export function getPlatformStats(store, filters = {}) {
  return inRange(store.sales, filters).reduce((acc, sale) => {
    const platform = sale.platform || "Unknown";

    if (!acc[platform]) {
      acc[platform] = {
        orders: 0,
        revenue: 0,
        profit: 0,
        costPendingCount: 0,
      };
    }

    acc[platform].orders += 1;
    acc[platform].revenue = toMoney(acc[platform].revenue + Number(sale.price || 0));
    if (hasKnownCost(sale.cost) && sale.profit !== null && sale.profit !== undefined && acc[platform].costPendingCount === 0) {
      acc[platform].profit = toMoney(acc[platform].profit + Number(sale.profit || 0));
    } else {
      acc[platform].costPendingCount += 1;
      acc[platform].profit = null;
    }

    return acc;
  }, {});
}

export function getBestPlatform(store, filters = {}) {
  const stats = getPlatformStats(store, filters);
  const entries = Object.entries(stats);

  if (!entries.length) return null;

  const [platform, data] = entries.sort((a, b) => b[1].revenue - a[1].revenue)[0];
  const totalRevenue = getRevenue(store, filters);

  return {
    platform,
    revenue: data.revenue,
    profit: data.profit,
    orders: data.orders,
    costPendingCount: data.costPendingCount,
    revenueShare: totalRevenue ? toMoney((data.revenue / totalRevenue) * 100) : 0,
    averageProfitPerSale: data.orders && data.profit !== null ? toMoney(data.profit / data.orders) : null,
  };
}

export function getPlatformRows(store, filters = {}) {
  const stats = getPlatformStats(store, filters);
  const totalRevenue = getRevenue(store, filters);

  return Object.entries(stats)
    .map(([platform, data]) => ({
      platform,
      ...data,
      revenueShare: totalRevenue ? toMoney((data.revenue / totalRevenue) * 100) : 0,
      averageProfitPerSale: data.orders && data.profit !== null ? toMoney(data.profit / data.orders) : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function getCollectionBusinessMetrics(store, filters = {}) {
  const names = [
    ...new Set([
      ...(store.collections || []).map((collection) => collection.name),
      ...store.inventory.map((item) => item.collectionId || "Unassigned"),
    ]),
  ];

  return names.map((name) => {
    const collectionRecord = (store.collections || []).find((collection) => collection.name === name);
    const items = store.inventory.filter((item) => (item.collectionId || "Unassigned") === name);
    const countedItems = items;
    const activeItems = countedItems.filter(activeInventory);
    const itemIds = new Set(items.map((item) => item.id));
    const sales = inRange(store.sales, filters).filter((sale) => itemIds.has(sale.itemId));
    const recordedRevenue = toMoney(sales.reduce((sum, sale) => sum + Number(sale.price || 0), 0));
    const salesCollected = toMoney(
      sales
        .filter((sale) => sale.paymentStatus === PAYMENT_STATUSES.PAID)
        .reduce((sum, sale) => sum + Number(sale.price || 0), 0),
    );
    const costPendingCount = countPendingCosts(countedItems);
    const soldCostPendingCount = countPendingCosts(sales);
    const recordedCost = toMoney(sales.reduce((sum, sale) => sum + knownCostOrZero(sale.cost), 0));
    const totalInventoryCost = toMoney(countedItems.reduce((sum, item) => sum + knownCostOrZero(item.cost), 0));
    const inventoryLeftValue = toMoney(activeItems.reduce((sum, item) => sum + Number(item.price || 0), 0));
    const inventoryCostLeft = toMoney(activeItems.reduce((sum, item) => sum + knownCostOrZero(item.cost), 0));
    const expectedProfitLeft = toMoney(activeItems
      .filter((item) => hasKnownCost(item.cost))
      .reduce((sum, item) => sum + Number(item.price || 0) - knownCostOrZero(item.cost), 0));
    const expectedFinalRevenue = toMoney(recordedRevenue + inventoryLeftValue);
    const expectedGrossProfit = costPendingCount ? null : toMoney(expectedFinalRevenue - totalInventoryCost);
    const soldStock = countedItems.filter((item) => item.status === STATUSES.SOLD).length;
    const itemsLeft = activeItems.length;
    const sellThroughBase = soldStock + itemsLeft;
    const earliestItemDate = items
      .map((item) => item.createdAt)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];

    const metrics = {
      id: collectionRecord?.id || "",
      name,
      createdAt: collectionRecord?.createdAt || earliestItemDate || "",
      description: collectionRecord?.description || "",
      itemsCount: countedItems.length,
      totalInventoryCost,
      capitalSpent: totalInventoryCost,
      salesCollected,
      recordedRevenue,
      recordedProfit: soldCostPendingCount ? null : toMoney(recordedRevenue - recordedCost),
      inventoryLeftValue,
      inventoryCostLeft,
      expectedSalesLeft: inventoryLeftValue,
      expectedProfitLeft,
      expectedFinalRevenue,
      expectedGrossProfit,
      costPendingCount,
      soldCostPendingCount,
      recoveryRate: costPendingCount ? null : totalInventoryCost ? toMoney((salesCollected / totalInventoryCost) * 100) : 0,
      remainingCostToRecover: costPendingCount ? null : toMoney(Math.max(totalInventoryCost - salesCollected, 0)),
      soldStock,
      soldCount: soldStock,
      itemsLeft,
      remainingCount: itemsLeft,
      sellThrough: sellThroughBase ? toMoney((soldStock / sellThroughBase) * 100) : 0,
    };
    const health = getCollectionHealth(metrics);

    return {
      ...metrics,
      ageDays: health.ageDays,
      health,
      status: health.label,
      statusTone: health.tone,
      statusClassName: health.className,
    };
  });
}

export function getCollectionRankings(store, filters = {}) {
  return getCollectionBusinessMetrics(store, filters)
    .filter((collection) => collection.itemsCount > 0)
    .sort((a, b) => {
      if (b.recoveryRate !== a.recoveryRate) return sortMetric(b.recoveryRate) - sortMetric(a.recoveryRate);
      return sortMetric(b.expectedGrossProfit) - sortMetric(a.expectedGrossProfit);
    });
}

export function getAttentionNeeded(store, filters = {}) {
  const alerts = [];
  const collections = getCollectionBusinessMetrics(store, filters);

  collections.forEach((collection) => {
    if (!collection.totalInventoryCost) return;
    if (!collection.salesCollected && collection.itemsLeft) {
      alerts.push({
        tone: "warn",
        message: `${collection.name} has no paid sales yet. Prioritize first sales to recover capital.`,
      });
      return;
    }
    if (collection.recoveryRate !== null && collection.recoveryRate < 50 && collection.remainingCostToRecover > 0) {
      alerts.push({
        tone: "warn",
        message: `${collection.name} recovery is still low at ${collection.recoveryRate}%. Focus on selling remaining inventory before buying another collection.`,
      });
    }
    if (collection.inventoryLeftValue > 0 && collection.itemsLeft >= 5) {
      alerts.push({
        tone: "info",
        message: `${collection.name} still has ${collection.itemsLeft} item${collection.itemsLeft === 1 ? "" : "s"} left. Consider posting, discounting, bundling, or pushing this collection.`,
      });
    }
  });

  return alerts.slice(0, 5);
}

export function getBusinessStatus(store, filters = {}) {
  const recovery = getCapitalRecoverySummary(store, filters);
  const profit = getGrossProfit(store, filters);
  const cash = getCashAvailable(store);
  const capital = getCapitalAdded(store);
  const itemsLeft = store.inventory.filter(activeInventory).length;
  const slowMovingCount = getSlowMovingInventory(store, 30, Number.POSITIVE_INFINITY).length;
  const costPendingCount = getCostPendingCount(store);

  if (profit < 0 || (capital > 0 && cash < 0) || (recovery.recoveryRate !== null && recovery.recoveryRate < 30) || slowMovingCount >= 8) {
    return {
      label: "At Risk",
      tone: "danger",
      recoveryRate: recovery.recoveryRate,
      itemsLeft,
      focus: "Review pricing, recovery, and slow stock.",
    };
  }

  if (!costPendingCount && recovery.recoveryRate >= 70 && profit >= 0 && slowMovingCount <= 2) {
    return {
      label: "Healthy",
      tone: "good",
      recoveryRate: recovery.recoveryRate,
      itemsLeft,
      focus: "Collection is performing well.",
    };
  }

  if ((recovery.recoveryRate !== null && recovery.recoveryRate < 70) || slowMovingCount > 2 || costPendingCount) {
    return {
      label: "Needs Attention",
      tone: "warn",
      recoveryRate: recovery.recoveryRate,
      itemsLeft,
      focus: "Sell current inventory before buying another collection.",
    };
  }

  return {
    label: slowMovingCount || costPendingCount ? "Needs Attention" : "Healthy",
    tone: slowMovingCount || costPendingCount ? "warn" : "good",
    recoveryRate: recovery.recoveryRate,
    itemsLeft,
    focus: costPendingCount ? `${costPendingCount} item cost${costPendingCount === 1 ? " is" : "s are"} pending.` : slowMovingCount ? "Push slow-moving items with posts, discounts, or bundles." : "Keep selling and tracking cash.",
  };
}

export function getCollectionSnapshot(store, filters = {}) {
  const collections = getCollectionBusinessMetrics(store, filters).filter((collection) => collection.itemsCount > 0);

  if (!collections.length) {
    return {
      needsFocus: null,
      best: null,
    };
  }

  const needsFocus = collections
    .slice()
    .sort((a, b) => {
      if (a.recoveryRate !== b.recoveryRate) return sortMetric(a.recoveryRate) - sortMetric(b.recoveryRate);
      return b.itemsLeft - a.itemsLeft;
    })[0];

  const best = collections
    .slice()
    .sort((a, b) => {
      if (b.recoveryRate !== a.recoveryRate) return sortMetric(b.recoveryRate) - sortMetric(a.recoveryRate);
      return sortMetric(b.expectedGrossProfit) - sortMetric(a.expectedGrossProfit);
    })[0];

  return { needsFocus, best };
}

export function getCurrentCollectionSnapshot(store, filters = {}) {
  const collections = getCollectionBusinessMetrics(store, filters)
    .filter((collection) => collection.itemsCount > 0)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const current = collections[0] || null;

  if (!current) return null;

  return {
    ...current,
    status: current.status,
    statusTone: current.statusTone,
  };
}

export function getActionCenterItems(store, filters = {}) {
  const actions = [];
  const current = getCurrentCollectionSnapshot(store, filters);
  const bestPlatform = getBestPlatform(store, filters);

  if (current?.totalInventoryCost) {
    if (current.costPendingCount) {
      actions.push(`Record ${current.costPendingCount} pending cost${current.costPendingCount === 1 ? "" : "s"} in ${current.name} before relying on profit or recovery.`);
    } else {
      const targetRecoveryAmount = toMoney(current.totalInventoryCost * 0.7);
      const amountToTarget = toMoney(Math.max(targetRecoveryAmount - current.salesCollected, 0));

      if (amountToTarget > 0) {
        actions.push(`Sell more inventory to recover ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(amountToTarget)} more of your inventory cost.`);
      }

      if (current.recoveryRate !== null && current.recoveryRate < 70) {
        actions.push("Avoid buying another collection until more inventory cost is recovered.");
      }
    }

    if (current.itemsLeft > 0) {
      actions.push(`Sell or promote ${current.itemsLeft} remaining item${current.itemsLeft === 1 ? "" : "s"}.`);
    }
  }

  if (bestPlatform?.platform) {
    actions.push(`Push ${bestPlatform.platform} because it brings the most sales collected.`);
  }

  return actions.slice(0, 3);
}

export function getBusinessMoneyFlow(store) {
  const capitalAdded = getCapitalAdded(store);
  const inventoryPurchases = toMoney(store.purchases.reduce((sum, purchase) => sum + knownCostOrZero(purchase.cost), 0));
  const salesCollected = getSalesCollected(store, { startDate: null, endDate: null });
  const expenses = toMoney(store.expenses.filter(cashExpense).reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
  const withdrawals = getWithdrawals(store);
  const currentCash = getCashAvailable(store);

  return {
    capitalAdded,
    inventoryPurchases,
    salesCollected,
    expenses,
    withdrawals,
    currentCash,
  };
}

function collectionChartRows(store, filters = {}) {
  return getCollectionBusinessMetrics(store, filters)
    .filter((collection) => collection.itemsCount > 0)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

export function getCollectionSalesChartData(store, filters = {}) {
  return collectionChartRows(store, filters).map((collection) => ({
    label: collection.name,
    value: collection.salesCollected,
  }));
}

export function getCollectionRecoveryChartData(store, filters = {}) {
  return collectionChartRows(store, filters).map((collection) => ({
    label: collection.name,
    value: collection.recoveryRate,
  }));
}

export function getCollectionProjectedProfitChartData(store, filters = {}) {
  return collectionChartRows(store, filters).map((collection) => ({
    label: collection.name,
    value: collection.expectedGrossProfit,
  }));
}

export function getPlatformSalesChartData(store, filters = {}) {
  return getPlatformRows(store, filters).map((platform) => ({
    label: platform.platform,
    value: platform.revenue,
    share: platform.revenueShare,
  }));
}

export function getTopProfitItem(store, filters = {}) {
  const sales = inRange(store.sales, filters);
  if (!sales.length) return null;

  const topSale = sales
    .filter((sale) => sale.profit !== null && sale.profit !== undefined)
    .slice()
    .sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0))[0];

  if (!topSale) return null;

  return {
    itemId: topSale.itemId,
    itemName: topSale.itemName,
    sku: topSale.sku,
    profit: topSale.profit,
    platform: topSale.platform || "Unknown",
    date: topSale.date,
  };
}

export function getMonthlyPerformance(store, filters = {}) {
  const salesRecordsCount = getFinancialSalesCount(store, filters);
  const profit = getGrossProfit(store, filters);
  return {
    revenue: getRevenue(store, filters),
    cogs: getCOGS(store, filters),
    expenses: getTotalExpenses(store, filters),
    grossProfit: profit,
    netProfit: profit,
    profit,
    costPendingCount: getSalesCostPendingCount(store, filters),
    roi: getROI(store, filters),
    salesRecordsCount,
    soldItemsCount: salesRecordsCount,
  };
}

export function getHeroInsights(store, filters = {}) {
  const revenue = getRevenue(store, filters);
  const orders = getFinancialSalesCount(store, filters);
  const profit = getGrossProfit(store, filters);
  const bestPlatform = getBestPlatform(store, filters);
  const capital = getCapitalAdded(store);
  const cash = getCashAvailable(store);
  const deployed = getCapitalDeployed(store);
  const cashShare = capital ? toMoney((cash / capital) * 100) : 0;
  const cashDifference = toMoney(cash - capital);

  return {
    cash: !capital
      ? "Add capital to start tracking cash movement"
      : cash > capital
        ? `Cash is ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(cashDifference)} above capital after paid sales`
        : `${cashShare}% of capital remains as cash after purchases and expenses`,
    profit: profit === null ? "Profit is pending until item costs are recorded" : profit ? "Profit from sold items after item costs" : "No profit recorded this period",
    revenue: orders ? `${orders} sale${orders === 1 ? "" : "s"} this period` : "No sales this period",
    platform: bestPlatform ? `${bestPlatform.platform} is leading this period` : "No platform leader yet",
  };
}

export function getPaidRevenue(store, filters = {}) {
  return toMoney(
    inRange(store.sales, filters)
      .filter((sale) => sale.paymentStatus === PAYMENT_STATUSES.PAID)
      .reduce((sum, sale) => sum + Number(sale.price || 0), 0),
  );
}

export function getSalesSummary(store, filters = {}) {
  const orders = getFinancialSalesCount(store, filters);
  const revenue = getRevenue(store, filters);
  const profit = getGrossProfit(store, filters);

  return {
    revenue,
    profit,
    costPendingCount: getSalesCostPendingCount(store, filters),
    orders,
    averageOrderValue: orders ? toMoney(revenue / orders) : 0,
    profitMargin: revenue && profit !== null ? toMoney((profit / revenue) * 100) : null,
  };
}

export function getCapitalUtilization(store) {
  const capital = getCapitalAdded(store);
  if (!capital) return 0;
  return toMoney((getCapitalDeployed(store) / capital) * 100);
}

export function getExpenseSummary(store, filters = {}) {
  const expenses = inRange(store.expenses, filters);
  const totalExpenses = getTotalExpenses(store, filters);
  const writeOffExpenses = toMoney(
    expenses
      .filter((expense) => expense.category === "Write-Off")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
  );

  return {
    totalExpenses,
    writeOffExpenses,
    operatingExpenses: toMoney(totalExpenses - writeOffExpenses),
    records: expenses.length,
  };
}

export function getCapitalHistorySummary(store, filters = {}) {
  const entries = inRange(store.capital, filters)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const addedEntries = entries.filter((entry) => entry.type === CAPITAL_TYPES.ADDED);
  const withdrawalEntries = entries.filter((entry) => entry.type === CAPITAL_TYPES.WITHDRAWAL);
  const addedTotal = addedEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  return {
    entries: entries.length,
    lastAdded: addedEntries[0]?.date || null,
    lastWithdrawal: withdrawalEntries[0]?.date || null,
    averageCapitalAdded: addedEntries.length ? toMoney(addedTotal / addedEntries.length) : 0,
  };
}
