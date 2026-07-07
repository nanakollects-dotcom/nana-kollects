import { getPlatformRows, getSalesSummary } from "../core/financials.js";
import { isWithinRange } from "../core/filters.js";
import { PAYMENT_STATUSES, PLATFORMS, saveSupabaseSale } from "../services/repository.js";
import { bindForm, countMetric, emptyState, metricGrid, modal, moneyMetric, pageHeader } from "../components/ui.js";
import { formatDate, formatMoney } from "../components/format.js";


let editingSaleId = null;
let isSaleModalOpen = false;

const escapeText = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const profitClass = (profit) => {
  if (Number(profit) > 0) return "profit-cell";
  if (Number(profit) < 0) return "profit-loss";
  return "profit-neutral";
};
const todayDateInput = () => new Date().toISOString().slice(0, 10);

function saleEditForm(store) {
  const sale = store.sales.find((entry) => entry.id === editingSaleId);

  return modal(
    "Edit Sale",
    `
      <form class="form-panel modal-form" id="sale-edit-form">
        <div class="modal-header">
          <h2>Edit Sale</h2>
          <button class="icon-btn" type="button" data-close-sale-modal="true">Close</button>
        </div>

        <input type="hidden" name="id" value="${sale?.id || ""}" />

        <label>Sold Price
          <input type="number" name="price" min="0" step="0.01" required value="${sale?.price || 0}" />
        </label>

        <label>Cost / Capital
          <input type="number" name="cost" min="0" step="0.01" required value="${sale?.cost || 0}" />
        </label>

        <label>Date Sold
          <input type="date" name="date" required value="${sale?.date ? sale.date.slice(0, 10) : todayDateInput()}" />
        </label>

        <label>Platform
          <select name="platform" required>
            <option value="">Choose platform</option>
            ${PLATFORMS.map(
              (platform) =>
                `<option value="${escapeText(platform)}" ${sale?.platform === platform ? "selected" : ""}>${escapeText(platform)}</option>`,
            ).join("")}
          </select>
        </label>

        <label>Payment
          <select name="paymentStatus">
            ${Object.values(PAYMENT_STATUSES).map(
              (status) =>
                `<option value="${escapeText(status)}" ${sale?.paymentStatus === status ? "selected" : ""}>${escapeText(status)}</option>`,
            ).join("")}
          </select>
        </label>

        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="Saving...">Save Sale</button>
          <button class="icon-btn" type="button" data-close-sale-modal="true">Cancel</button>
        </div>
      </form>
    `,
  );
}

function renderPlatformSales(store, filters) {
  const rows = getPlatformRows(store, filters);
  const tableRows = rows
    .map((row) => `
      <tr>
        <td><strong>${escapeText(row.platform)}</strong></td>
        <td>${row.orders}</td>
        <td>${formatMoney(row.revenue)}</td>
        <td class="profit-cell">${formatMoney(row.profit)}</td>
        <td>${row.revenueShare}%</td>
      </tr>
    `)
    .join("");
  const cards = rows
    .map((row) => `
      <article class="record-card">
        <div class="record-card-head">
          <strong>${escapeText(row.platform)}</strong>
          <span class="pill info-pill">${row.revenueShare}% share</span>
        </div>
        <div class="record-grid">
          <div><span>Sales</span><strong>${row.orders}</strong></div>
          <div><span>Sales Collected</span><strong>${formatMoney(row.revenue)}</strong></div>
          <div><span>Profit</span><strong class="profit-cell">${formatMoney(row.profit)}</strong></div>
        </div>
      </article>
    `)
    .join("");

  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Sales by Platform</h2>
        <span>Platform mix this period</span>
      </div>
      ${
        rows.length
          ? `<div class="mobile-records">${cards}</div><div class="table-wrap desktop-table"><table><thead><tr><th>Platform</th><th>Sales</th><th>Sales Collected</th><th>Profit</th><th>Share</th></tr></thead><tbody>${tableRows}</tbody></table></div>`
          : emptyState("No platform sales yet for this period", "Mark an item as sold and choose a platform to see platform performance.")
      }
    </section>
  `;
}

export function renderSalesPage(store, filters = {}) {
  const summary = getSalesSummary(store, filters);
  const sortedSales = store.sales
    .filter((sale) => isWithinRange(sale.date, filters))
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const rows = sortedSales
    .map(
      (sale) => `
        <tr>
          <td><strong>${escapeText(sale.itemName)}</strong><span>${escapeText(sale.sku)}</span></td>
          <td>${formatMoney(sale.price)}</td>
          <td>${formatMoney(sale.cost)}</td>
          <td>${formatDate(sale.date)}</td>
          <td><span class="pill muted-pill">${escapeText(sale.platform || "-")}</span></td>
          <td><span class="pill">${escapeText(sale.paymentStatus)}</span></td>
          <td class="profit-cell">${formatMoney(sale.profit)}</td>
          <td><button class="table-action" data-edit-sale="${sale.id}">Edit</button></td>
        </tr>
      `,
    )
    .join("");

  const mobileCards = sortedSales
    .map(
      (sale) => `
        <article class="record-card">
          <div class="record-card-head">
            <div>
              <strong>${escapeText(sale.itemName)}</strong>
              <span>${escapeText(sale.sku)}</span>
            </div>
            <strong class="sales-profit ${profitClass(sale.profit)}">${Number(sale.profit) > 0 ? "+" : ""}${formatMoney(sale.profit)} Profit</strong>
          </div>

          <div class="record-grid">
            <div><span>Sold Price</span><strong>${formatMoney(sale.price)}</strong></div>
            <div><span>Cost</span><strong>${formatMoney(sale.cost)}</strong></div>
            <div><span>Date</span><strong>${formatDate(sale.date)}</strong></div>
            <div><span>Platform</span><strong>${escapeText(sale.platform || "-")}</strong></div>
            <div><span>Payment</span><strong>${escapeText(sale.paymentStatus)}</strong></div>
          </div>

          <div class="record-actions">
            <button class="table-action" data-edit-sale="${sale.id}">Edit Sale</button>
          </div>
        </article>
      `,
    )
    .join("");

  return `
    ${pageHeader("Sales", `${sortedSales.length} sales`, "")}

    ${metricGrid([
      moneyMetric("Sales Collected", summary.revenue, "good"),
      moneyMetric("Profit", summary.profit, summary.profit >= 0 ? "good" : "danger"),
      countMetric("Sales", summary.orders),
      moneyMetric("Average Order Value", summary.averageOrderValue, "focus"),
    ])}

    ${renderPlatformSales(store, filters)}

    <div class="panel table-panel">
      ${
        sortedSales.length
          ? `
            <div class="mobile-records">${mobileCards}</div>
            <div class="table-wrap desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Sold Price</th>
                    <th>Cost</th>
                    <th>Date</th>
                    <th>Platform</th>
                    <th>Payment</th>
                    <th>Profit</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `
          : emptyState("No sales yet", "Mark an inventory item as sold to create your first sale record.")
      }
    </div>

    ${isSaleModalOpen ? saleEditForm(store) : ""}
  `;
}

export function bindSalesPage(root, store, notify, refresh) {
  const form = root.querySelector("#sale-edit-form");

  if (form) {
    bindForm(form, async (data) => {
      try {
        await saveSupabaseSale(data.id, data);
        editingSaleId = null;
        isSaleModalOpen = false;
        notify("Sale updated.");
        refresh();
      } catch (error) {
        notify(error.message, true);
        return false;
      }
    });
  }

  root.onclick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.editSale) {
      editingSaleId = button.dataset.editSale;
      isSaleModalOpen = true;
      refresh();
    }

    if (button.dataset.closeSaleModal) {
      editingSaleId = null;
      isSaleModalOpen = false;
      refresh();
    }
  };
}
