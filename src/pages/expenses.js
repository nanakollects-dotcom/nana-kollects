import { getExpenseSummary } from "../core/financials.js";
import { isWithinRange } from "../core/filters.js";
import { addSupabaseExpense, EXPENSE_CATEGORIES, removeSupabaseExpense, saveSupabaseExpense } from "../services/repository.js";
import { bindForm, countMetric, emptyState, metricGrid, modal, moneyMetric, pageHeader } from "../components/ui.js";
import { formatDate, formatMoney } from "../components/format.js";
import { getSafeUserError } from "../services/errorService.js";

let editingExpenseId = null;
let isExpenseModalOpen = false;

export function resetExpensesPageState() {
  editingExpenseId = null;
  isExpenseModalOpen = false;
}

const toDateInput = (value) => new Date(value).toISOString().slice(0, 10);
const todayDateInput = () => new Date().toISOString().slice(0, 10);
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);
function expenseDetails(expense, store) {
  const details = expense.details?.trim();

  if (expense.category === "Write-Off") {
    const sku = details?.match(/NK-\d+/)?.[0];
    if (sku) {
      const item = store.inventory.find((entry) => entry.sku === sku);
      if (item) return `${escapeText(sku)} - ${escapeText(item.name)}`;
      if (details && details !== sku) return escapeText(details);
      return `${escapeText(sku)} - Item no longer exists`;
    }
    return "No item details";
  }

  return escapeText(details || "No details");
}

function expenseForm(store) {
  const editingExpense = store.expenses.find((expense) => expense.id === editingExpenseId);
  const title = editingExpense ? "Edit Expense" : "Add Expense";
  return modal(
    title,
    `
      <form class="form-panel modal-form" id="expense-form">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="icon-btn" type="button" data-close-expense="true">Close</button>
        </div>
        <input type="hidden" name="id" value="${editingExpenseId || ""}" />
        <label>Date<input type="date" name="date" /></label>
        <label>Category
          <select name="category">
            ${EXPENSE_CATEGORIES.map((category) => `<option>${category}</option>`).join("")}
          </select>
        </label>
        <label>Amount<input type="number" name="amount" min="0.01" step="0.01" required /></label>
        <label>Details / Notes<textarea name="details" rows="3" placeholder="Optional note or item detail"></textarea></label>
        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="${editingExpense ? "Updating..." : "Adding..."}">Save Expense</button>
          <button class="icon-btn" type="button" data-close-expense="true">Cancel</button>
        </div>
      </form>
    `,
  );
}

export function renderExpensesPage(store, filters = {}) {
  const summary = getExpenseSummary(store, filters);
  const expenses = store.expenses.filter((expense) => isWithinRange(expense.date, filters));
  const rows = expenses
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(
      (expense) => `
        <tr>
          <td>${formatDate(expense.date)}</td>
          <td><span class="pill">${expense.category}</span></td>
          <td>${expenseDetails(expense, store)}</td>
          <td>${formatMoney(expense.amount)}</td>
          <td class="actions-cell">
            <button class="table-action" data-edit-expense="${expense.id}">Edit</button>
            <button class="table-action danger" data-delete-expense="${expense.id}">Delete</button>
          </td>
        </tr>
      `,
    )
    .join("");
  const mobileCards = expenses
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(
      (expense) => `
        <article class="record-card">
          <div class="record-card-head ${expense.category === "Write-Off" ? "writeoff-card-head" : ""}">
            <div>
              <strong>${expense.category}</strong>
              <span>${formatDate(expense.date)}</span>
            </div>
            <strong>${formatMoney(expense.amount)}</strong>
          </div>
          <div class="record-grid">
            <div><span>Item / Details</span><strong>${expenseDetails(expense, store)}</strong></div>
          </div>
          <div class="record-actions">
            <button class="table-action" data-edit-expense="${expense.id}">Edit</button>
            <button class="table-action danger" data-delete-expense="${expense.id}">Delete</button>
          </div>
        </article>
      `,
    )
    .join("");

  return `
    ${pageHeader("Expenses", `${expenses.length} expense records`, `<button class="primary-btn page-action" type="button" data-open-expense="true">+ Add Expense</button>`)}

    ${metricGrid([
      moneyMetric("Total Expenses", summary.totalExpenses, "warn"),
      moneyMetric("Inventory Loss", summary.writeOffExpenses, "danger"),
      moneyMetric("Operating Expenses", summary.operatingExpenses),
      countMetric("Records", summary.records),
    ])}

    <div class="panel table-panel">
      ${
        expenses.length
          ? `<div class="mobile-records">${mobileCards}</div><div class="table-wrap desktop-table"><table><thead><tr><th>Date</th><th>Category</th><th>Item / Details</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : emptyState("No expenses yet", "Add packaging, shipping, marketing, supplies, write-offs, or other costs to keep profit accurate.")
      }
    </div>
    ${isExpenseModalOpen ? expenseForm(store) : ""}
  `;
}

export function bindExpensesPage(root, store, notify, refresh) {
  const form = root.querySelector("#expense-form");
  const editingExpense = store.expenses.find((expense) => expense.id === editingExpenseId);
  if (form && editingExpense) {
    form.date.value = toDateInput(editingExpense.date);
    form.category.value = editingExpense.category;
    form.amount.value = editingExpense.amount;
    form.details.value = editingExpense.details || "";
  } else if (form) {
    form.date.value = todayDateInput();
  }

  if (form) {
    bindForm(form, async (data) => {
      try {
        if (data.id) {
          await saveSupabaseExpense(data.id, { ...data, date: data.date ? new Date(data.date).toISOString() : undefined });
          notify("Expense updated.");
        } else {
          await addSupabaseExpense({ ...data, date: data.date ? new Date(data.date).toISOString() : undefined });
          notify("Expense saved.");
        }
        editingExpenseId = null;
        isExpenseModalOpen = false;
        refresh();
      } catch (error) {
        notify(getSafeUserError(error, "save"), true);
        return false;
      }
    });
  }

  root.onclick = async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.busy === "true") return;
    const originalButtonText = button.textContent;

    if (button.dataset.openExpense) {
      editingExpenseId = null;
      isExpenseModalOpen = true;
      refresh();
    }
    if (button.dataset.editExpense) {
      editingExpenseId = button.dataset.editExpense;
      isExpenseModalOpen = true;
      refresh();
    }
    if (button.dataset.closeExpense) {
      editingExpenseId = null;
      isExpenseModalOpen = false;
      refresh();
    }
    if (button.dataset.deleteExpense) {
      const confirmed = confirm("Delete this expense record? This cannot be undone.");
      if (!confirmed) return;

      try {
        button.dataset.busy = "true";
        button.disabled = true;
        button.textContent = "Deleting...";
        await removeSupabaseExpense(button.dataset.deleteExpense);
        if (editingExpenseId === button.dataset.deleteExpense) {
          editingExpenseId = null;
          isExpenseModalOpen = false;
        }
        notify("Expense deleted.");
        refresh();
      } catch (error) {
        notify(getSafeUserError(error, "save"), true);
      } finally {
        button.dataset.busy = "false";
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  };
}
