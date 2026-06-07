import { getCapitalSummary } from "../core/calculations.js";
import { getBusinessMoneyFlow, getCapitalDeployed, getCapitalHistorySummary, getCapitalUtilization } from "../core/financials.js";
import { isWithinRange } from "../core/filters.js";
import { addSupabaseCapitalEntry, CAPITAL_TYPES, saveSupabaseCapitalEntry } from "../services/repository.js";
import { bindForm, emptyState, metricGrid, modal, moneyMetric, pageHeader, percentMetric } from "../components/ui.js";
import { formatDate, formatMoney } from "../components/format.js";

let editingCapitalId = null;
let isCapitalModalOpen = false;

const toDateInput = (value) => new Date(value).toISOString().slice(0, 10);
const todayDateInput = () => new Date().toISOString().slice(0, 10);
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);
const capitalDetails = (entry) => escapeText((entry.notes || entry.details || "").trim() || "No details");

function financialSetupWarning(store) {
  const summary = getCapitalSummary(store, { startDate: null, endDate: null });
  const deployed = getCapitalDeployed(store);

  if (summary.totalCapitalAdded > 0 || deployed <= 0) return "";

  return `
    <section class="panel activity-panel">
      <div class="alert-list">
        <div class="alert-row alert-warn">You have inventory costs but no capital record yet. Add starting capital to calculate cash available accurately.</div>
      </div>
    </section>
  `;
}

function capitalForm(store) {
  const editingCapital = store.capital.find((entry) => entry.id === editingCapitalId);
  const title = editingCapital ? "Edit Capital" : "Add Capital";
  return modal(
    title,
    `
      <form class="form-panel modal-form" id="capital-form">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="icon-btn" type="button" data-close-capital="true">Close</button>
        </div>
        <input type="hidden" name="id" value="${editingCapitalId || ""}" />
        <label>Date<input type="date" name="date" /></label>
        <label>Type
          <select name="type">
            <option>${CAPITAL_TYPES.ADDED}</option>
            <option>${CAPITAL_TYPES.WITHDRAWAL}</option>
          </select>
        </label>
        <label>Amount<input type="number" name="amount" min="0.01" step="0.01" required /></label>
        <label>Details / Notes<textarea name="notes" rows="3" placeholder="Starting capital, withdrawal reason, or note"></textarea></label>
        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="${editingCapital ? "Updating..." : "Adding..."}">Save Entry</button>
          <button class="icon-btn" type="button" data-close-capital="true">Cancel</button>
        </div>
      </form>
    `,
  );
}

export function renderCapitalPage(store, filters = {}) {
  const allTimeFilters = { startDate: null, endDate: null };
  const summary = getCapitalSummary(store, allTimeFilters);
  const history = getCapitalHistorySummary(store, filters);
  const moneyFlow = getBusinessMoneyFlow(store);
  const capital = store.capital.filter((entry) => isWithinRange(entry.date, filters));
  const hasCapitalAllTime = store.capital.length > 0;
  const rows = capital
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(
      (entry) => `
        <tr>
          <td>${formatDate(entry.date)}</td>
          <td><span class="pill">${entry.type}</span></td>
          <td>${capitalDetails(entry)}</td>
          <td>${formatMoney(entry.amount)}</td>
          <td class="actions-cell"><button class="table-action" data-edit-capital="${entry.id}">Edit</button></td>
        </tr>
      `,
    )
    .join("");
  const mobileCards = capital
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(
      (entry) => `
        <article class="record-card">
          <div class="record-card-head">
            <div>
              <strong>${entry.type}</strong>
              <span>${formatDate(entry.date)}</span>
            </div>
            <strong>${formatMoney(entry.amount)}</strong>
          </div>
          <div class="record-grid">
            <div><span>Details</span><strong>${capitalDetails(entry)}</strong></div>
          </div>
          <div class="record-actions">
            <button class="table-action" data-edit-capital="${entry.id}">Edit</button>
          </div>
        </article>
      `,
    )
    .join("");

  return `
    ${pageHeader("Capital", `${capital.length} capital records in selected period`, `<button class="primary-btn page-action" type="button" data-open-capital="true">+ Add Capital</button>`)}
    <section class="panel activity-panel capital-group-panel">
      <div class="panel-heading">
        <h2>Capital Health</h2>
      </div>
      ${metricGrid([
        moneyMetric("Current Cash", summary.cash, "focus cash-hero"),
        moneyMetric("Inventory Capital", getCapitalDeployed(store), "focus"),
        moneyMetric("Capital Added", summary.totalCapitalAdded, "good"),
      ])}
    </section>
    <section class="panel activity-panel capital-group-panel">
      <div class="panel-heading">
        <h2>Capital Usage</h2>
      </div>
      ${metricGrid([
        moneyMetric("Withdrawals", summary.totalWithdrawals, "warn"),
        moneyMetric("Net Capital", summary.netCapital, "focus"),
        percentMetric("Capital Utilization", getCapitalUtilization(store), "focus"),
      ])}
    </section>
    <section class="panel activity-panel">
      <div class="alert-list">
        <div class="alert-row alert-info">Capital metrics reflect overall business health. Transaction history follows the selected period.</div>
      </div>
    </section>
    <section class="panel activity-panel money-flow-panel">
      <div class="panel-heading">
        <h2>Business Money Flow</h2>
      </div>
      <div class="money-flow-list">
        <div><span>Starting Capital</span><strong>${formatMoney(moneyFlow.capitalAdded)}</strong></div>
        <div><span>Inventory Purchases</span><strong class="profit-loss">-${formatMoney(moneyFlow.inventoryPurchases)}</strong></div>
        <div><span>Sales Collected</span><strong class="profit-cell">+${formatMoney(moneyFlow.salesCollected)}</strong></div>
        <div><span>Expenses</span><strong class="profit-loss">-${formatMoney(moneyFlow.expenses)}</strong></div>
        ${moneyFlow.withdrawals ? `<div><span>Withdrawals</span><strong class="profit-loss">-${formatMoney(moneyFlow.withdrawals)}</strong></div>` : ""}
        <div class="money-flow-total"><span>Current Cash</span><strong>${formatMoney(moneyFlow.currentCash)}</strong></div>
      </div>
    </section>
    <details class="dashboard-disclosure">
      <summary>How this is calculated</summary>
      <section class="panel activity-panel">
        <div class="alert-list">
          <div class="alert-row alert-info">Cash Available = Capital + Paid Sales - Inventory Purchases - Expenses - Withdrawals.</div>
          <div class="alert-row alert-info">Inventory Capital = cost of active unsold stock.</div>
        </div>
      </section>
    </details>
    ${financialSetupWarning(store)}
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Capital History</h2>
        <span>Selected period</span>
      </div>
      <div class="snapshot-grid">
        <div class="snapshot-list">
          <div><span>Capital Entries</span><strong>${history.entries}</strong></div>
          <div><span>Last Added</span><strong>${history.lastAdded ? formatDate(history.lastAdded) : "None"}</strong></div>
        </div>
        <div class="snapshot-list">
          <div><span>Last Withdrawal</span><strong>${history.lastWithdrawal ? formatDate(history.lastWithdrawal) : "None"}</strong></div>
          <div><span>Avg Capital Added</span><strong>${formatMoney(history.averageCapitalAdded)}</strong></div>
        </div>
      </div>
    </section>
    <div class="panel table-panel">
      ${
        capital.length
          ? `<div class="mobile-records">${mobileCards}</div><div class="table-wrap desktop-table"><table><thead><tr><th>Date</th><th>Type</th><th>Details / Notes</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : hasCapitalAllTime
            ? emptyState("No capital records for this period", "Switch the period to All Time to see older capital records.")
            : emptyState("No capital records yet", "Add your starting capital to calculate cash available and ROI.")
      }
    </div>
    ${isCapitalModalOpen ? capitalForm(store) : ""}
  `;
}

export function bindCapitalPage(root, store, notify, refresh) {
  const form = root.querySelector("#capital-form");
  const editingCapital = store.capital.find((entry) => entry.id === editingCapitalId);
  if (form && editingCapital) {
    form.date.value = toDateInput(editingCapital.date);
    form.type.value = editingCapital.type;
    form.amount.value = editingCapital.amount;
    form.notes.value = editingCapital.notes || editingCapital.details || "";
  } else if (form) {
    form.date.value = todayDateInput();
  }

  if (form) {
    bindForm(form, async (data) => {
      try {
        if (data.id) {
          await saveSupabaseCapitalEntry(data.id, { ...data, date: data.date ? new Date(data.date).toISOString() : undefined });
          notify("Capital entry updated.");
        } else {
          await addSupabaseCapitalEntry({ ...data, date: data.date ? new Date(data.date).toISOString() : undefined });
          notify("Capital entry saved.");
        }
        editingCapitalId = null;
        isCapitalModalOpen = false;
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
    if (button.dataset.openCapital) {
      editingCapitalId = null;
      isCapitalModalOpen = true;
      refresh();
    }
    if (button.dataset.editCapital) {
      editingCapitalId = button.dataset.editCapital;
      isCapitalModalOpen = true;
      refresh();
    }
    if (button.dataset.closeCapital) {
      editingCapitalId = null;
      isCapitalModalOpen = false;
      refresh();
    }
  };
}
