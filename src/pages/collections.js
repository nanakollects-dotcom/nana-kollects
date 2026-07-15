import { addSupabaseCollection, saveSupabaseCollection } from "../services/repository.js";
import { getCollectionBusinessMetrics } from "../core/financials.js";
import { bindForm, emptyState, modal, pageHeader } from "../components/ui.js";
import { formatDate, formatMoney, formatPercent } from "../components/format.js";
import { getSafeUserError } from "../services/errorService.js";

let isCollectionModalOpen = false;
let editingCollectionId = null;

export function resetCollectionsPageState() {
  isCollectionModalOpen = false;
  editingCollectionId = null;
}

const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[char]);
const toDateInput = (value) => new Date(value).toISOString().slice(0, 10);
const todayDateInput = () => new Date().toISOString().slice(0, 10);
const profitClass = (value) => value === null || value === undefined ? "" : value >= 0 ? "profit-cell" : "profit-loss";
const logicalCollectionNumber = (name) => {
  const match = String(name || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
};

const sortNewestCollectionFirst = (a, b) => {
  const firstDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const secondDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;

  if (firstDate || secondDate) return secondDate - firstDate;
  return logicalCollectionNumber(b.name) - logicalCollectionNumber(a.name);
};

function collectionForm(store) {
  const editingCollection = (store.collections || []).find((collection) => collection.id === editingCollectionId);
  const title = editingCollection ? "Edit Collection" : "New Collection";

  return modal(
    title,
    `
      <form class="form-panel modal-form" id="collection-form">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="icon-btn" type="button" data-close-collection="true">Close</button>
        </div>
        <input type="hidden" name="id" value="${editingCollectionId || ""}" />
        <label>Name<input name="name" required placeholder="June Drop" /></label>
        <label>Created Date<input type="date" name="createdAt" required /></label>
        <label>Description<textarea name="description" rows="3" placeholder="Optional collection note"></textarea></label>
        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="${editingCollection ? "Updating..." : "Creating..."}">${editingCollection ? "Save Collection" : "Create Collection"}</button>
          <button class="icon-btn" type="button" data-close-collection="true">Cancel</button>
        </div>
      </form>
    `,
  );
}

export function renderCollectionsPage(store, filters) {
  const collections = getCollectionBusinessMetrics(store, filters).slice().sort(sortNewestCollectionFirst);
  const cards = collections
    .map((collection) => {
      const partialNote = collection.costPendingCount
        ? `<small class="cost-pending-label">Partial · ${collection.costPendingCount} cost${collection.costPendingCount === 1 ? "" : "s"} pending</small>`
        : "";

      return `
        <article class="collection-card">
          <div class="collection-card-header">
            <div>
              <h2>${escapeText(collection.name)}</h2>
              <span>${collection.createdAt ? `Created: ${formatDate(collection.createdAt)}` : "Created date unavailable"}</span>
            </div>
            <span class="pill ${collection.statusClassName}">${collection.status}</span>
          </div>

          <div class="collection-hero-stats">
            <div>
              <span>Profit Collected</span>
              <strong class="${profitClass(collection.recordedProfit)}">${formatMoney(collection.recordedProfit)}</strong>
              ${collection.soldCostPendingCount ? `<small class="cost-pending-label">Partial · ${collection.soldCostPendingCount} sold cost${collection.soldCostPendingCount === 1 ? "" : "s"} pending</small>` : ""}
            </div>
            <div>
              <span>Projected Profit</span>
              <strong class="${profitClass(collection.expectedGrossProfit)}">${formatMoney(collection.expectedGrossProfit)}</strong>
              ${partialNote}
            </div>
          </div>

          <div class="collection-money-grid">
            <div><span>Sales Collected</span><strong class="profit-cell">${formatMoney(collection.salesCollected)}</strong></div>
            <div><span>Capital Spent</span><strong>${formatMoney(collection.totalInventoryCost)}</strong>${partialNote}</div>
            <div><span>Inventory Left Value</span><strong>${formatMoney(collection.inventoryLeftValue)}</strong></div>
            <div><span>Expected Revenue</span><strong>${formatMoney(collection.expectedFinalRevenue)}</strong></div>
          </div>

          <div class="collection-stats">
            <div><strong>${collection.itemsLeft}</strong><span>Items Left</span></div>
            <div><strong>${collection.soldStock}</strong><span>Sold</span></div>
            <div><strong>${formatMoney(collection.inventoryLeftValue)}</strong><span>Inventory Left</span></div>
            <div><strong>${formatPercent(collection.sellThrough)}</strong><span>Sell-through</span></div>
          </div>

          <div class="progress-track"><span style="width: ${collection.sellThrough}%"></span></div>

          <div class="record-actions">
            <button class="table-action primary-action" type="button" data-view-collection="${escapeText(collection.name)}">View Items</button>
            ${collection.id ? `<button class="table-action" type="button" data-edit-collection="${escapeText(collection.id)}">Edit</button>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  return `
    ${pageHeader("Collections", "Manage your monthly drops", `<button class="primary-btn page-action" type="button" data-open-collection="true">+ New Collection</button>`)}
    ${
      collections.length
        ? `<div class="collection-grid">${cards}</div>`
        : emptyState("No collections yet", "Create your first drop to organize inventory and track collection performance.")
    }
    ${isCollectionModalOpen ? collectionForm(store) : ""}
  `;
}

export function bindCollectionsPage(root, store, notify, refresh) {
  const form = root.querySelector("#collection-form");
  const editingCollection = (store.collections || []).find((collection) => collection.id === editingCollectionId);

  if (form && editingCollection) {
    form.name.value = editingCollection.name;
    form.createdAt.value = toDateInput(editingCollection.createdAt || new Date());
    form.description.value = editingCollection.description || "";
  } else if (form) {
    form.createdAt.value = todayDateInput();
  }

  if (form) {
    bindForm(form, async (data) => {
      try {
        const payload = {
          ...data,
          createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : undefined,
        };

        if (data.id) {
          await saveSupabaseCollection(data.id, payload);
          notify("Collection updated.");
        } else {
          await addSupabaseCollection(payload);
          notify("Collection created.");
        }

        editingCollectionId = null;
        isCollectionModalOpen = false;
        refresh();
      } catch (error) {
        notify(getSafeUserError(error, "collection"), true);
        return false;
      }
    });
  }

  root.onclick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.openCollection) {
      editingCollectionId = null;
      isCollectionModalOpen = true;
      refresh();
    }
    if (button.dataset.editCollection) {
      editingCollectionId = button.dataset.editCollection;
      isCollectionModalOpen = true;
      refresh();
    }
    if (button.dataset.closeCollection) {
      editingCollectionId = null;
      isCollectionModalOpen = false;
      refresh();
    }
    if (button.dataset.viewCollection) {
      window.dispatchEvent(new CustomEvent("inventory:filter-collection", { detail: button.dataset.viewCollection }));
    }
  };
}
