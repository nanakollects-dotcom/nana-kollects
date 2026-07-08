export const hasKnownCost = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return !Number.isNaN(Number(value));
};

export const isCostPending = (itemOrValue) => {
  const value = itemOrValue && typeof itemOrValue === "object" ? itemOrValue.cost : itemOrValue;
  return !hasKnownCost(value);
};

export const normalizeCostInput = (value) => {
  if (!hasKnownCost(value)) return null;
  return Math.round(Number(value) * 100) / 100;
};

export const costValue = (value) => normalizeCostInput(value);

export const knownCostOrZero = (value) => hasKnownCost(value) ? normalizeCostInput(value) : 0;

export const countPendingCosts = (items = []) => items.filter(isCostPending).length;
