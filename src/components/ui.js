import { formatMoney, formatPercent } from "./format.js";

const iconMap = {
  cash: ["Cash Available", "Current Cash Available", "Net Capital", "Current Cash", "Cash Recovered", "Still To Recover"],
  profit: ["Profit", "Top Profit Item", "Expected Profit Left"],
  revenue: ["Revenue", "Average Order Value", "Avg Order Value", "Sales Potential Left", "Potential Sales"],
  platform: ["Best Platform"],
  expense: ["Expenses", "Total Expenses", "Write-Off Expenses", "Write-Offs", "Inventory Loss", "Operating Expenses"],
  inventory: ["Sales Value of Active Inventory", "Capital In Inventory", "Inventory Capital", "Total Inventory Cost", "Available Items", "Reserved Items", "Written Off"],
  orders: ["Orders", "Sales Records", "Recorded Sales", "Sales", "Records"],
  capital: ["Total Capital Added", "Total Withdrawals", "Withdrawals", "Capital Added", "COGS"],
  percent: ["ROI", "Sell Through %", "Collection ROI", "Profit Margin", "Capital Utilization", "Recovery Rate"],
};

function metricIcon(label) {
  const type = Object.entries(iconMap).find(([, labels]) => labels.includes(label))?.[0] || "default";
  const paths = {
    cash: `<path d="M5 7h14v10H5z"/><path d="M8 7V5h8v2"/><circle cx="12" cy="12" r="2"/>`,
    profit: `<path d="M4 16l5-5 3 3 8-8"/><path d="M15 6h5v5"/>`,
    revenue: `<path d="M6 4h12v16l-3-2-3 2-3-2-3 2z"/><path d="M9 9h6M9 13h6"/>`,
    platform: `<path d="M8 5h8v3a4 4 0 0 1-8 0z"/><path d="M6 5h2v3H6a2 2 0 0 1 0-4h2M16 5h2a2 2 0 0 1 0 4h-2V5z"/><path d="M12 12v4M9 20h6M10 16h4"/>`,
    expense: `<path d="M7 4h10v16H7z"/><path d="M9 8h6M9 12h6M9 16h3"/>`,
    inventory: `<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/>`,
    orders: `<path d="M6 6h15l-2 8H8z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>`,
    capital: `<path d="M4 9h16"/><path d="M6 9V6h12v3M7 9v11M17 9v11M4 20h16"/>`,
    percent: `<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>`,
    default: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`,
  };

  return `<svg class="metric-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[type]}</svg>`;
}

export function card(label, value, tone = "", insight = "", actionPage = "") {
  const tag = actionPage ? "button" : "article";
  const attrs = actionPage ? `type="button" data-card-page="${actionPage}"` : "";
  return `
    <${tag} class="metric-card ${tone} ${actionPage ? "metric-nav" : ""}" ${attrs}>
      <span>${metricIcon(label)}${label}</span>
      <strong>${value}</strong>
      ${insight ? `<small>${insight}</small>` : ""}
    </${tag}>
  `;
}

export function emptyState(title, detail) {
  return `
    <div class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8l8-4 8 4-8 4z"/>
        <path d="M4 8v8l8 4 8-4V8"/>
        <path d="M12 12v8"/>
      </svg>
      <strong>${title}</strong>
      <span>${detail}</span>
    </div>
  `;
}

export function alertList(alerts, emptyTitle, emptyDetail) {
  return `
    <div class="alert-list">
      ${
        alerts.length
          ? alerts.map((alert) => `<div class="alert-row alert-${alert.tone}">${alert.message}</div>`).join("")
          : emptyState(emptyTitle, emptyDetail)
      }
    </div>
  `;
}

export function metricGrid(metrics) {
  return `<div class="metric-grid">${metrics.map((metric) => card(metric.label, metric.value, metric.tone || "", metric.insight || "")).join("")}</div>`;
}

export function moneyMetric(label, value, tone = "") {
  return { label, value: formatMoney(value), tone };
}

export function countMetric(label, value, tone = "") {
  return { label, value: String(value), tone };
}

export function percentMetric(label, value, tone = "") {
  return { label, value: formatPercent(value), tone };
}

export function pageHeader(title, subtitle, action = "") {
  return `
    <div class="page-header">
      <div>
        <h1>${title}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : ""}
      </div>
      ${action}
    </div>
  `;
}

export function modal(title, body, panelClass = "") {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel ${panelClass}" role="dialog" aria-modal="true" aria-label="${title}">
        ${body}
      </section>
    </div>
  `;
}

export function bindForm(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.saving === "true") return;

    const data = Object.fromEntries(new FormData(form).entries());
    const buttons = Array.from(form.querySelectorAll("button"));
    const submitButton = form.querySelector('button[type="submit"]');
    const originalSubmitText = submitButton?.textContent || "";
    const savingText = submitButton?.dataset.savingText || "Saving...";

    form.dataset.saving = "true";
    buttons.forEach((button) => {
      button.disabled = true;
    });
    if (submitButton) submitButton.textContent = savingText;

    try {
      const result = await handler(data);
      if (result !== false && !data.id) form.reset();
    } finally {
      form.dataset.saving = "false";
      buttons.forEach((button) => {
        button.disabled = false;
      });
      if (submitButton) submitButton.textContent = originalSubmitText;
    }
  });
}
