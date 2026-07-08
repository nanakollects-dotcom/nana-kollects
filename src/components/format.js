export const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export const number = new Intl.NumberFormat("en-PH");

export function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return currency.format(Number(value || 0));
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value || 0).toFixed(1)}%`;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
