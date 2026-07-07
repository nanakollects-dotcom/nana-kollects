import {
  getActionCenterItems,
  getBusinessStatus,
  getCapitalAdded,
  getCapitalDeployed,
  getCapitalRecoverySummary,
  getCashAvailable,
  getCOGS,
  getCollectionSalesChartData,
  getExpectedSalesLeft,
  getMonthlyPerformance,
  getNetProfit,
  getPlatformSalesChartData,
  getRevenue,
  getTotalExpenses,
} from "../core/financials.js";
import { buildFullBusinessReportRows } from "../core/reporting.js";
import { IMPORT_LABELS, prepareImportPreview } from "../core/imports.js";
import { getInventoryAgeDays, getInventoryStatusCounts } from "../core/calculations.js";

import {
  countMetric,
  metricGrid,
  moneyMetric,
  pageHeader,
  percentMetric,
} from "../components/ui.js";

import { formatDate, formatMoney, formatPercent } from "../components/format.js";
import { renderImportPreview } from "../components/importPreview.js";

import {
  exportCapitalCsv,
  exportExpensesCsv,
  exportInventoryCsv,
  exportSalesCsv,
  exportStoreBackup,
  downloadCsv,
  importStoreBackup,
} from "../services/storage.js";
import { confirmCsvImport, downloadImportTemplate } from "../services/importService.js";
import { importSupabaseBackup } from "../services/repository.js";

let csvImportPreview = null;
let csvImportResult = null;

const escapeText = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const barWidthClass = (percent) => {
  const clean = Math.max(0, Math.min(100, Number(percent) || 0));
  const bucket = Math.round(clean / 5) * 5;
  return `bar-w-${bucket}`;
};

const platformColors = ["#1e3a5f", "#3b82f6", "#15803d", "#b45309", "#dc2626", "#64748b"];

const activityLabel = (type) =>
  ({
    "capital.created": "Capital added",
    "capital.updated": "Capital edited",
    "inventory.created": "Inventory added",
    "inventory.updated": "Inventory edited",
    "inventory.status": "Inventory status changed",
    "sale.created": "Item sold",
    "sale.updated": "Sale edited",
    "sale.reversed": "Sale reversed",
    "expense.created": "Expense added",
    "expense.updated": "Expense edited",
    "expense.deleted": "Expense deleted",
    "collection.created": "Collection created",
    "collection.updated": "Collection edited",
    "inventory.archived": "Inventory archived",
    "inventory.written_off": "Inventory written off",
    "inventory.deleted": "Inventory deleted",
    "import.inventory": "Inventory CSV import",
    "import.collections": "Collections CSV import",
    "import.sales": "Sales CSV import",
    "import.expenses": "Expenses CSV import",
    "import.capital": "Capital CSV import",
  })[type] || type;

const activityTone = (type) => {
  if (type === "sale.created") return "activity-good";
  if (type === "inventory.created" || type === "sale.updated") return "activity-info";
  if (type === "inventory.written_off" || type === "inventory.deleted" || type === "expense.deleted") return "activity-danger";
  if (type === "expense.created" || type === "sale.reversed") return "activity-warn";
  if (type === "capital.created" || type === "collection.created") return "activity-primary";
  if (type.startsWith("import.")) return "activity-info";
  if (type === "inventory.archived") return "activity-muted";
  return "activity-muted";
};

const activityDetails = (entry) => {
  const details = String(entry.details || "");
  if (details.includes("₱")) return escapeText(details);
  if (entry.type === "capital.created" || entry.type === "capital.updated") {
    return escapeText(details.replace(/(\d+(?:\.\d+)?)/, (amount) => formatMoney(amount)));
  }
  if (entry.type === "expense.created" || entry.type === "expense.updated") {
    return escapeText(details.replace(/(\d+(?:\.\d+)?)/, (amount) => formatMoney(amount)));
  }
  return escapeText(details);
};

function renderBackupPanel() {
  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Backup & Restore</h2>
        <span>Protect your business data</span>
      </div>

      <div class="backup-actions">
        <button class="primary-btn" type="button" data-export-backup>
          Export Backup
        </button>

        <button class="icon-btn" type="button" data-import-backup>
          Import Backup
        </button>

        <input
          id="backup-import-input"
          type="file"
          accept="application/json"
          hidden
        />
      </div>
    </section>
  `;
}

function renderImportExportPanel() {
  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Import / Export Center</h2>
        <span>Migrate spreadsheet data and download reports</span>
      </div>

      <div class="import-center">
        <section class="import-block">
          <h3>Export Existing Data</h3>
          <div class="backup-actions compact-actions">
            <button class="icon-btn" type="button" data-export-sales-csv>Export Sales CSV</button>
            <button class="icon-btn" type="button" data-export-inventory-csv>Export Inventory CSV</button>
            <button class="icon-btn" type="button" data-export-expenses-csv>Export Expenses CSV</button>
            <button class="icon-btn" type="button" data-export-capital-csv>Export Capital CSV</button>
            <button class="primary-btn" type="button" data-export-full-report>Export Full Business Report</button>
          </div>
        </section>

        <section class="import-block">
          <h3>Download CSV Templates</h3>
          <div class="backup-actions compact-actions">
            ${Object.entries(IMPORT_LABELS).map(([type, label]) => `
              <button class="icon-btn" type="button" data-template-type="${type}">Download ${label} Template</button>
            `).join("")}
          </div>
        </section>

        <section class="import-block">
          <h3>Import Old Spreadsheet Data</h3>
          <p class="micro-insight">CSV Import is for migrating spreadsheet data. Backup Import is separate and restores a full app backup. Inventory imports also support legacy headers like Description, Pricing Cost, and Selling Price.</p>

          <div class="import-controls">
            <label>Import Type
              <select id="csv-import-type">
                ${Object.entries(IMPORT_LABELS).map(([type, label]) => `<option value="${type}">${label}</option>`).join("")}
              </select>
            </label>

            <label>CSV File
              <input id="csv-import-input" type="file" accept=".csv,text/csv" />
            </label>
          </div>

          <div class="backup-actions compact-actions">
            <button class="icon-btn" type="button" data-export-backup-before-import>Export Backup First</button>
            <button class="primary-btn" type="button" data-confirm-csv-import ${csvImportPreview?.validRows && !csvImportResult ? "" : "disabled"}>Confirm Import</button>
            <button class="icon-btn" type="button" data-cancel-csv-import ${csvImportPreview ? "" : "disabled"}>Cancel</button>
          </div>

          ${renderImportPreview(csvImportPreview, csvImportResult)}
        </section>
      </div>
    </section>
  `;
}

function renderRecoveryProgress(store) {
  const recovery = getCapitalRecoverySummary(store, { startDate: null, endDate: null });

  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Capital Recovery Progress</h2>
      </div>
      ${metricGrid([
        moneyMetric("Total Inventory Cost", recovery.totalInventoryCost, "focus"),
        moneyMetric("Cash Recovered", recovery.salesCollected, "good"),
        percentMetric("Recovery Rate", recovery.recoveryRate, "focus"),
        moneyMetric("Still To Recover", recovery.remainingCostToRecover, recovery.remainingCostToRecover ? "warn" : "good"),
      ])}
    </section>
  `;
}

function renderOverviewPanel(store, filters, status, profit) {
  return `
    <section class="dashboard-overview-panel">
      <div class="overview-top">
        <button class="overview-money primary-money" type="button" data-card-page="capital">
          <span>Current Cash</span>
          <strong>${formatMoney(getCashAvailable(store))}</strong>
        </button>
        <button class="overview-money ${profit >= 0 ? "positive" : "negative"}" type="button" data-card-page="sales">
          <span>Profit</span>
          <strong>${formatMoney(profit)}</strong>
        </button>
      </div>

      <div class="overview-bottom">
        <div><span>Sales Collected</span><strong class="profit-cell">${formatMoney(getRevenue(store, filters))}</strong></div>
        <div><span>Expenses</span><strong class="warning-action">${formatMoney(getTotalExpenses(store, filters))}</strong></div>
        <div><span>Inventory Value</span><strong>${formatMoney(getExpectedSalesLeft(store))}</strong></div>
        <div><span>Items Left</span><strong>${status.itemsLeft}</strong></div>
      </div>
    </section>
  `;
}

function renderMainCollectionPerformance(store, filters) {
  const rows = getCollectionSalesChartData(store, filters);
  const visibleRows = rows.length > 5
    ? rows.slice().sort((a, b) => Number(b.value || 0) - Number(a.value || 0)).slice(0, 5)
    : rows;
  const topCollection = rows.slice().sort((a, b) => Number(b.value || 0) - Number(a.value || 0))[0];
  const maxValue = Math.max(...visibleRows.map((row) => Math.abs(Number(row.value || 0))), 0);

  return `
    <section class="panel activity-panel chart-panel main-chart-panel">
      <div class="panel-heading">
        <div>
          <h2>Collection Performance</h2>
          <span>Sales collected by collection</span>
        </div>
      </div>
      ${
        rows.length >= 2 && maxValue
          ? `
            ${
              topCollection
                ? `<div class="top-collection-badge"><span>Top Collection</span><strong>${escapeText(topCollection.label)}</strong><em>${formatMoney(topCollection.value)}</em></div>`
                : ""
            }
            <div class="bar-chart-list compact-chart-list">
              ${visibleRows.map((row) => {
                const value = Number(row.value || 0);
                const width = maxValue ? (Math.abs(value) / maxValue) * 100 : 0;
                return `
                  <div class="bar-chart-row">
                    <div class="bar-chart-label">
                      <strong>${escapeText(row.label)}</strong>
                      <strong>${formatMoney(value)}</strong>
                    </div>
                    <div class="bar-chart-track">
                      <span class="${barWidthClass(width)}"></span>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
            ${rows.length > 5 ? `<p class="chart-note">Showing top 5 collections by sales.</p>` : ""}
          `
          : `<div class="empty-state compact-empty"><strong>Add another collection to compare sales.</strong></div>`
      }
    </section>
  `;
}

function renderPlatformDistributionCard(store, filters) {
  const rows = getPlatformSalesChartData(store, filters);
  const totalRevenue = getRevenue(store, filters);
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    const end = Math.min(cursor + Number(row.share || 0), 100);
    cursor = end;
    return `${platformColors[index % platformColors.length]} ${start}% ${end}%`;
  });
  const chartStyle = segments.length
    ? `--platform-chart: conic-gradient(${segments.join(", ")});`
    : "";

  return `
    <section class="panel activity-panel platform-distribution-card">
      <div class="panel-heading">
        <h2>Sales by Platform</h2>
      </div>
      ${
        rows.length && totalRevenue
          ? `
            <div class="platform-donut-layout">
              <div class="platform-donut" style="${chartStyle}" aria-label="Sales by platform">
                <div>
                  <strong>${formatMoney(totalRevenue)}</strong>
                  <span>Sales Collected</span>
                </div>
              </div>

              <div class="platform-legend">
              ${rows.slice(0, 5).map((row, index) => {
                const color = platformColors[index % platformColors.length];
                return `
                  <div class="platform-legend-row">
                    <span class="platform-dot" style="--platform-color: ${color};"></span>
                    <strong>${escapeText(row.label)}</strong>
                    <span>${formatPercent(row.share)}</span>
                    <em>${formatMoney(row.value)}</em>
                  </div>
                `;
              }).join("")}
              </div>
            </div>
          `
          : `<div class="empty-state compact-empty"><strong>No platform sales yet.</strong><span>Sold items with platforms will appear here.</span></div>`
      }
    </section>
  `;
}

function renderActionCenter(store, filters) {
  const actions = getActionCenterItems(store, filters);

  return `
    <section class="panel activity-panel compact-panel">
      <div class="panel-heading">
        <h2>Action Center</h2>
      </div>
      <div class="action-list">
        ${
          actions.length
            ? actions.map((action) => `<div class="action-item">${escapeText(action)}</div>`).join("")
            : `<div class="action-item muted-action">No urgent actions right now.</div>`
        }
      </div>
    </section>
  `;
}

function renderRecentActivity(activities) {
  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Recent Activity</h2>
        <span>Latest 5 updates, all time</span>
      </div>

      ${
        activities
          ? `<div class="table-wrap"><table class="activity-table"><thead><tr><th>Date</th><th>Action</th><th>Amount/Details</th></tr></thead><tbody>${activities}</tbody></table></div>`
          : `<div class="empty-state"><strong>No activity yet</strong><span>New capital, inventory, sales, and expenses will appear here.</span></div>`
      }
    </section>
  `;
}

function renderSlowMovingInventory(items) {
  return `
    <section class="panel activity-panel daily-card">
      <div class="panel-heading">
        <h2>Slow Moving</h2>
      </div>

      ${
        items.length
          ? `
            <div class="insight-card">
              <div class="snapshot-list">
                ${items.map((item) => `
                  <div>
                    <span>${escapeText(item.name)}${item.collectionId ? `<small>${escapeText(item.collectionId)}</small>` : ""}</span>
                    <strong>${item.ageDays} ${item.ageDays === 1 ? "day" : "days"}</strong>
                  </div>
                `).join("")}
              </div>
            </div>
          `
          : `<div class="empty-state"><strong>No slow-moving inventory.</strong><span>All active inventory is still fresh.</span></div>`
      }
    </section>
  `;
}

function renderMonthlyPerformance(performance) {
  const hasData =
    performance.revenue ||
    performance.cogs ||
    performance.expenses ||
    performance.profit ||
    performance.salesRecordsCount;

  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Monthly Performance</h2>
      </div>

      ${
        hasData
          ? metricGrid([
              moneyMetric("Sales Collected", performance.revenue, "good"),
              moneyMetric("COGS", performance.cogs),
              moneyMetric("Expenses", performance.expenses, "warn"),
              moneyMetric("Profit", performance.profit, performance.profit >= 0 ? "good" : "danger"),
              percentMetric("ROI", performance.roi, "focus"),
              countMetric("Sales", performance.salesRecordsCount),
            ])
          : `<div class="empty-state"><strong>No performance data for this period yet.</strong><span>Add sales or expenses to see this period's results.</span></div>`
      }
    </section>
  `;
}

function renderBusinessSnapshot(store, filters) {
  const statusCounts = getInventoryStatusCounts(store.inventory);

  return `
    <section class="analytics-snapshot-grid">
      <section class="panel activity-panel snapshot-card">
        <div class="panel-heading">
          <h2>Financial Snapshot</h2>
        </div>
        <div class="snapshot-list">
          <div><span>Capital Added</span><strong>${formatMoney(getCapitalAdded(store))}</strong></div>
          <div><span>COGS</span><strong>${formatMoney(getCOGS(store, filters))}</strong></div>
          <div><span>Sales Value of Active Inventory</span><strong>${formatMoney(getExpectedSalesLeft(store))}</strong></div>
          <div><span>Inventory Capital</span><strong>${formatMoney(getCapitalDeployed(store))}</strong></div>
        </div>
      </section>

      <section class="panel activity-panel snapshot-card">
        <div class="panel-heading">
          <h2>Inventory Snapshot</h2>
        </div>
        <div class="snapshot-list">
          <div><span>Available</span><strong>${statusCounts.available}</strong></div>
          <div><span>Sold Stock</span><strong>${statusCounts.sold}</strong></div>
          <div><span>Written Off</span><strong>${statusCounts.writtenOff}</strong></div>
          <div><span>Archived</span><strong>${statusCounts.archived}</strong></div>
        </div>
      </section>
    </section>
  `;
}

function disclosure(title, body, className = "") {
  return `
    <details class="dashboard-disclosure ${className}" data-mobile-collapsible>
      <summary>${title}</summary>
      ${body}
    </details>
  `;
}

export function renderDashboardPage(store, filters) {
  const slowMoving = store.inventory
    .filter((item) => item.status === "Available" || item.status === "Reserved")
    .map((item) => ({ ...item, ageDays: getInventoryAgeDays(item) }))
    .filter((item) => item.ageDays >= 61)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 5);
  const performance = getMonthlyPerformance(store, filters);
  const profit = getNetProfit(store, filters);
  const businessStatus = getBusinessStatus(store, filters);

  const activities = store.logs
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(
      (entry) => `
        <tr>
          <td>${formatDate(entry.date)}</td>
          <td><span class="activity-badge ${activityTone(entry.type)}">${activityLabel(entry.type)}</span></td>
          <td>${activityDetails(entry)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    ${pageHeader("Dashboard", "Business command center")}

    ${renderOverviewPanel(store, filters, businessStatus, profit)}

    <section class="dashboard-collection-grid">
      ${renderMainCollectionPerformance(store, filters)}
      ${renderPlatformDistributionCard(store, filters)}
    </section>

    <section class="dashboard-health-grid">
      ${renderSlowMovingInventory(slowMoving)}
      ${renderActionCenter(store, filters)}
    </section>

    ${renderRecentActivity(activities)}

    ${disclosure("Analytics", `
      ${renderMonthlyPerformance(performance)}
      ${renderRecoveryProgress(store)}
      ${renderBusinessSnapshot(store, filters)}
    `, "analytics-disclosure")}

    ${disclosure("Management", `
      ${renderImportExportPanel()}
      ${renderBackupPanel()}
    `)}
  `;
}

export function bindDashboardPage(root, store, notify, refresh) {
  const importInput = root.querySelector("#backup-import-input");
  root.querySelectorAll("[data-mobile-collapsible]").forEach((section) => {
    section.open = false;
  });

  root.querySelector("[data-export-backup]")?.addEventListener("click", () => {
    exportStoreBackup();
    notify("Backup exported.");
  });

  root.querySelector("[data-import-backup]")?.addEventListener("click", () => {
    importInput?.click();
  });

  importInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const confirmed = confirm(
      "Importing this backup will replace your current business data. Continue?",
    );

    if (!confirmed) {
      event.target.value = "";
      return;
    }

    try {
      const backupStore = await importStoreBackup(file);
      await importSupabaseBackup(backupStore);
      notify("Backup imported.");
      event.target.value = "";
      refresh();
    } catch (error) {
      notify(error.message, true);
      event.target.value = "";
    }
  });

  root.querySelector("[data-export-sales-csv]")?.addEventListener("click", () => {
    exportSalesCsv();
    notify("Sales CSV exported.");
  });

  root.querySelector("[data-export-inventory-csv]")?.addEventListener("click", () => {
    exportInventoryCsv();
    notify("Inventory CSV exported.");
  });

  root.querySelector("[data-export-expenses-csv]")?.addEventListener("click", () => {
    exportExpensesCsv();
    notify("Expenses CSV exported.");
  });

  root.querySelector("[data-export-capital-csv]")?.addEventListener("click", () => {
    exportCapitalCsv();
    notify("Capital CSV exported.");
  });

  root.querySelector("[data-export-full-report]")?.addEventListener("click", () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`nana-kollects-full-business-report-${date}.csv`, buildFullBusinessReportRows(store));
    notify("Full business report exported.");
  });

  root.querySelectorAll("[data-template-type]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        downloadImportTemplate(button.dataset.templateType);
        notify("CSV template downloaded.");
      } catch (error) {
        notify(error.message, true);
      }
    });
  });

  root.querySelector("[data-export-backup-before-import]")?.addEventListener("click", () => {
    exportStoreBackup();
    notify("Backup exported. You can continue the CSV import preview.");
  });

  const csvInput = root.querySelector("#csv-import-input");
  csvInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const type = root.querySelector("#csv-import-type")?.value;

    csvImportResult = null;

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      csvImportPreview = null;
      event.target.value = "";
      notify("Please upload a CSV file. You can export Excel or Google Sheets as CSV first.", true);
      refresh();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        csvImportPreview = prepareImportPreview(type, reader.result, store);
        notify("CSV preview ready.");
        refresh();
      } catch (error) {
        csvImportPreview = null;
        notify(error.message, true);
        refresh();
      }
    };
    reader.onerror = () => {
      csvImportPreview = null;
      notify("Could not read CSV file.", true);
      refresh();
    };
    reader.readAsText(file);
  });

  root.querySelector("[data-confirm-csv-import]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Importing...";

    try {
      csvImportResult = await confirmCsvImport(csvImportPreview);
      notify("CSV import complete. Export a backup to protect the migrated data.");
      refresh();
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  root.querySelector("[data-cancel-csv-import]")?.addEventListener("click", () => {
    csvImportPreview = null;
    csvImportResult = null;
    notify("CSV import canceled.");
    refresh();
  });

  root.querySelectorAll("[data-card-page]").forEach((button) => {
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("app:navigate", { detail: { page: button.dataset.cardPage } }));
    });
  });

}
