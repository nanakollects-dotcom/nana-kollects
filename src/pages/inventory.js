import { getInventoryAgeDays, getInventoryMarginPercent, getInventoryProfitPotential } from "../core/calculations.js";
import { isCostPending } from "../core/costs.js";
import {
  addSupabaseInventoryItem,
  removeSupabaseInventoryItem,
  saveSupabaseInventoryItem,
  setSupabaseInventoryStatus,
  PAYMENT_STATUSES,
  PLATFORMS,
  STATUSES,
} from "../services/repository.js";
import { bindForm, emptyState, modal, pageHeader } from "../components/ui.js";
import { formatMoney } from "../components/format.js";

let editingId = null;
let isModalOpen = false;
let searchTerm = "";
let statusFilter = "all";
let collectionFilter = "all";
let ageFilter = "all";
let costFilter = "all";
let inventoryDraft = null;

const escapeText = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const collectionOptions = (store) =>
  [
    ...new Set([
      ...(store.collections || []).map((collection) => collection.name),
      ...store.inventory.map((item) => item.collectionId).filter(Boolean),
    ]),
  ].sort();

const statusClass = (status) => {
  if (status === STATUSES.AVAILABLE) return "green-pill";
  if (status === STATUSES.RESERVED) return "yellow-pill";
  if (status === STATUSES.SOLD) return "info-pill";
  if (status === STATUSES.ARCHIVED) return "gray-pill";
  return "muted-pill";
};

const formatAge = (item) => {
  const days = getInventoryAgeDays(item);
  if (days < 1) return "New";
  return `${days} ${days === 1 ? "day" : "days"}`;
};

const ageClass = (item) => getInventoryAgeDays(item) >= 30 ? "warning-action" : "";

const matchesAgeFilter = (item) => {
  const days = getInventoryAgeDays(item);

  if (ageFilter === "new") return days < 30;
  if (ageFilter === "30") return days >= 30;
  if (ageFilter === "60") return days >= 60;
  if (ageFilter === "90") return days >= 90;
  return true;
};

const matchesCostFilter = (item) => {
  if (costFilter === "pending") return isCostPending(item);
  if (costFilter === "recorded") return !isCostPending(item);
  return true;
};

const missingValue = "&mdash;";
const costPendingIndicator = `<small class="cost-pending-label">Cost Pending</small>`;
const formatCost = (item) => isCostPending(item) ? `${missingValue}${costPendingIndicator}` : formatMoney(item.cost);
const formatOptionalMoney = (value) => value === null || value === undefined ? missingValue : formatMoney(value);
const formatOptionalPercent = (value) => value === null || value === undefined ? missingValue : `${value.toFixed(1)}%`;

const toDateInput = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
};

const canRunStatusAction = (current, next) => {
  if (current === next) return false;
  if (current === STATUSES.AVAILABLE) return [STATUSES.RESERVED, STATUSES.SOLD, STATUSES.WRITTEN_OFF, STATUSES.ARCHIVED].includes(next);
  if (current === STATUSES.RESERVED) return [STATUSES.AVAILABLE, STATUSES.SOLD, STATUSES.WRITTEN_OFF, STATUSES.ARCHIVED].includes(next);
  if (current === STATUSES.SOLD) return [STATUSES.AVAILABLE, STATUSES.ARCHIVED].includes(next);
  if (current === STATUSES.WRITTEN_OFF) return [STATUSES.AVAILABLE, STATUSES.ARCHIVED].includes(next);
  if (current === STATUSES.ARCHIVED) return [STATUSES.AVAILABLE, STATUSES.RESERVED].includes(next);
  return false;
};

const actionDisabled = (current, next) => canRunStatusAction(current, next) ? "" : "disabled";

const skuSortValue = (sku) => {
  const match = String(sku || "").match(/^NK-(\d+)$/i);
  return match ? Number(match[1]) : null;
};

const sortBySkuDescending = (a, b) => {
  const firstSkuNumber = skuSortValue(a.sku);
  const secondSkuNumber = skuSortValue(b.sku);

  if (firstSkuNumber !== null && secondSkuNumber !== null && firstSkuNumber !== secondSkuNumber) {
    return secondSkuNumber - firstSkuNumber;
  }

  if (firstSkuNumber !== null) return -1;
  if (secondSkuNumber !== null) return 1;

  const firstCreatedAt = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const secondCreatedAt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (firstCreatedAt !== secondCreatedAt) return secondCreatedAt - firstCreatedAt;

  return String(a.sku || "").localeCompare(String(b.sku || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export function setInventoryCollectionFilter(collectionName) {
  collectionFilter = collectionName || "all";
  searchTerm = "";
  statusFilter = "all";
  ageFilter = "all";
  costFilter = "all";
  inventoryDraft = null;
}

export function setInventoryViewItem(itemId) {
  inventoryDraft = null;
  editingId = itemId || null;
  isModalOpen = Boolean(itemId);
}

const readInventoryDraft = (root) => {
  const form = root.querySelector("#inventory-form");
  if (!form) return null;

  const fieldValue = (name) => form.elements[name]?.value;

  return {
    id: fieldValue("id") || editingId || "",
    sku: fieldValue("sku"),
    name: fieldValue("name"),
    collectionId: fieldValue("collectionId"),
    cost: fieldValue("cost"),
    price: fieldValue("price"),
    status: fieldValue("status"),
    createdAt: fieldValue("createdAt"),
    notes: fieldValue("notes"),
    platform: root.querySelector("#inventory-action-platform")?.value,
    payment: root.querySelector("#inventory-action-payment")?.value,
  };
};

const applyInventoryDraft = (root) => {
  const form = root.querySelector("#inventory-form");
  if (!form || !inventoryDraft) return;
  if (inventoryDraft.id && inventoryDraft.id !== editingId) return;

  const setField = (name, value) => {
    if (value === undefined || !form.elements[name]) return;
    form.elements[name].value = value;
  };

  setField("sku", inventoryDraft.sku);
  setField("name", inventoryDraft.name);
  setField("collectionId", inventoryDraft.collectionId);
  setField("cost", inventoryDraft.cost);
  setField("price", inventoryDraft.price);
  setField("status", inventoryDraft.status);
  setField("createdAt", inventoryDraft.createdAt);
  setField("notes", inventoryDraft.notes);

  const platformSelect = root.querySelector("#inventory-action-platform");
  const paymentSelect = root.querySelector("#inventory-action-payment");
  if (platformSelect && inventoryDraft.platform !== undefined) platformSelect.value = inventoryDraft.platform;
  if (paymentSelect && inventoryDraft.payment !== undefined) paymentSelect.value = inventoryDraft.payment;
};

function inventoryForm(store) {
  const editingItem = store.inventory.find((item) => item.id === editingId);
  const soldLocked = editingItem?.status === STATUSES.SOLD;
  const locked = Boolean(editingItem?.locked) && !soldLocked;
  const soldReadOnly = Boolean(editingItem?.locked) && soldLocked;
  const title = editingItem ? "Edit Item" : "Add Item";
  const collections = collectionOptions(store);
  const canSubmit = (!locked || soldReadOnly) && collections.length > 0;
  const itemStatus = editingItem?.status || STATUSES.AVAILABLE;

  return `
    ${modal(
      title,
      `
        <form class="form-panel modal-form inventory-modal-form ${editingItem ? "" : "inventory-add-form"}" id="inventory-form">
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="icon-btn" type="button" data-close-modal="inventory">Close</button>
          </div>

          <input type="hidden" name="id" value="${editingId || ""}" />

          <section class="modal-section">
            <h3>Basic Information</h3>
          ${
  editingItem
    ? `
      <label>
        SKU
        <input name="sku" required ${locked || soldReadOnly ? "disabled" : ""} />
      </label>
    `
    : `
      <div class="modal-copy">
        SKU will be auto-generated when saved.
      </div>
    `
}

          <label>
            Name
            <input name="name" required ${locked || soldReadOnly ? "disabled" : ""} />
          </label>

          <label>
            Collection
            <select name="collectionId" required ${locked || soldReadOnly || !collections.length ? "disabled" : ""}>
              <option value="">Choose collection</option>
              ${collections
                .map((name) => `<option value="${escapeText(name)}">${escapeText(name)}</option>`)
                .join("")}
            </select>
          </label>

          ${
            collections.length
              ? ""
              : `<p class="modal-copy">Create a collection first before adding inventory.</p>`
          }
          </section>

          <section class="modal-section">
            <h3>Financial Information</h3>
            <div class="form-row">
              <label>
                Cost
                <input type="number" name="cost" min="0" step="0.01" ${locked ? "disabled" : ""} />
                <small class="cost-pending-label" data-cost-pending-indicator hidden>Cost Pending</small>
              </label>

              <label>
                Price
                <input type="number" name="price" min="0" step="0.01" required ${locked ? "disabled" : ""} />
              </label>
            </div>
          </section>

          <section class="modal-section">
            <h3>Inventory Information</h3>
            ${
              editingItem
                ? ""
                : `
                  <label>
                    Status
                    <select name="status" ${locked || soldReadOnly ? "disabled" : ""}>
                      <option>${STATUSES.AVAILABLE}</option>
                      <option>${STATUSES.RESERVED}</option>
                      <option ${itemStatus === STATUSES.SOLD ? "" : "disabled"}>${STATUSES.SOLD}</option>
                      <option ${itemStatus === STATUSES.WRITTEN_OFF ? "" : "disabled"}>${STATUSES.WRITTEN_OFF}</option>
                      <option ${itemStatus === STATUSES.ARCHIVED ? "" : "disabled"}>${STATUSES.ARCHIVED}</option>
                    </select>
                  </label>
                `
            }

            <label>
              Date Added
              <input type="date" name="createdAt" required ${locked || soldReadOnly ? "disabled" : ""} />
            </label>

            <label>
              Notes
              <textarea name="notes" rows="3" ${locked || soldReadOnly ? "disabled" : ""} placeholder="Optional item notes"></textarea>
            </label>
          </section>

          ${
            editingItem
              ? `
                <section class="modal-section inventory-action-panel">
                  <h3>Inventory Actions</h3>
                  <p class="modal-copy">Use these actions to manage sale state, archive, write off, or delete this item.</p>

                  <div class="form-row">
                    <label>
                      Sold Platform
                      <select id="inventory-action-platform">
                        <option value="">Choose platform</option>
                        ${PLATFORMS.map((platform) => `<option>${platform}</option>`).join("")}
                      </select>
                    </label>

                    <label>
                      Payment
                      <select id="inventory-action-payment">
                        <option>${PAYMENT_STATUSES.PAID}</option>
                        <option>${PAYMENT_STATUSES.PENDING}</option>
                      </select>
                    </label>
                  </div>

                  <div class="inventory-action-grid">
                    <button class="table-action" type="button" data-status-action="${STATUSES.AVAILABLE}" data-item-id="${editingItem.id}" ${actionDisabled(itemStatus, STATUSES.AVAILABLE)}>Mark Available</button>
                    <button class="table-action primary-action" type="button" data-status-action="${STATUSES.SOLD}" data-item-id="${editingItem.id}" ${actionDisabled(itemStatus, STATUSES.SOLD)}>Mark Sold</button>
                    <button class="table-action" type="button" data-status-action="${STATUSES.RESERVED}" data-item-id="${editingItem.id}" ${actionDisabled(itemStatus, STATUSES.RESERVED)}>Mark Reserved</button>
                    <button class="table-action warning-action" type="button" data-status-action="${STATUSES.WRITTEN_OFF}" data-item-id="${editingItem.id}" ${actionDisabled(itemStatus, STATUSES.WRITTEN_OFF)}>Mark Written Off</button>
                    <button class="table-action" type="button" data-status-action="${STATUSES.ARCHIVED}" data-item-id="${editingItem.id}" ${actionDisabled(itemStatus, STATUSES.ARCHIVED)}>Archive Item</button>
                    <button class="table-action danger" type="button" data-delete="${editingItem.id}">Delete Item</button>
                  </div>
                </section>
              `
              : ""
          }

          <div class="button-row">
            ${
              canSubmit
                ? `<button class="primary-btn" type="submit" data-saving-text="${editingId ? "Updating..." : "Adding..."}">${editingId ? "Save Item" : "Add Item"}</button>`
                : ""
            }

            <button class="icon-btn" type="button" data-close-modal="inventory">
              ${locked ? "Done" : "Cancel"}
            </button>
          </div>
        </form>
      `,
      "inventory-modal-panel",
    )}
  `;
}

function filteredInventory(store) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const inventory = statusFilter === STATUSES.ARCHIVED
    ? store.inventory.filter((item) => item.status === STATUSES.ARCHIVED)
    : store.inventory.filter((item) => item.status !== STATUSES.ARCHIVED);

  return inventory
    .filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        `${item.sku} ${item.name} ${item.collectionId} ${item.status}`.toLowerCase().includes(normalizedSearch);

      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesCollection =
        collectionFilter === "all" || (item.collectionId || "Unassigned") === collectionFilter;
      const matchesAge = matchesAgeFilter(item);
      const matchesCost = matchesCostFilter(item);

      return matchesSearch && matchesStatus && matchesCollection && matchesAge && matchesCost;
    })
    .slice()
    .sort(sortBySkuDescending);
}

function renderInventoryResults(store) {
  const visibleInventory = filteredInventory(store);

  const rows = visibleInventory
    .map((item) => {
      const profitPotential = getInventoryProfitPotential(item);
      const margin = getInventoryMarginPercent(item);

      return `
        <tr>
          <td><span class="mono">${escapeText(item.sku)}</span></td>
          <td><strong>${escapeText(item.name)}</strong></td>
          <td>${escapeText(item.collectionId)}</td>
          <td class="money-cell">${formatCost(item)}</td>
          <td class="money-cell">${formatMoney(item.price)}</td>
          <td><span class="pill ${statusClass(item.status)}">${item.status}</span></td>
          <td class="money-cell ${profitPotential === null ? "" : "profit-cell"}">${formatOptionalMoney(profitPotential)}</td>
          <td class="percent-cell">${formatOptionalPercent(margin)}</td>
          <td class="${ageClass(item)}">${formatAge(item)}</td>

          <td class="actions-cell">
            <button class="table-action primary-action" data-edit="${item.id}" title="Edit">
              Edit
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  const mobileCards = visibleInventory
    .map((item) => {
      const profitPotential = getInventoryProfitPotential(item);
      const margin = getInventoryMarginPercent(item);

      return `
        <article class="record-card">
          <div class="record-card-head">
            <div>
              <strong>${escapeText(item.name)}</strong>
              <span class="mono">${escapeText(item.sku)}</span>
            </div>

            <span class="pill ${statusClass(item.status)}">${item.status}</span>
          </div>

          <div class="record-grid">
            <div><span>Collection</span><strong>${escapeText(item.collectionId)}</strong></div>
            <div><span>Cost</span><strong>${formatCost(item)}</strong></div>
            <div><span>Price</span><strong>${formatMoney(item.price)}</strong></div>
            <div><span>Profit Potential</span><strong class="${profitPotential === null ? "" : "profit-cell"}">${formatOptionalMoney(profitPotential)}</strong></div>
            <div><span>Margin</span><strong>${formatOptionalPercent(margin)}</strong></div>
            <div><span>Age</span><strong class="${ageClass(item)}">${formatAge(item)}</strong></div>
          </div>

          <div class="record-actions">
            <button class="table-action primary-action" data-edit="${item.id}">
              Edit
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <div class="panel table-panel" data-inventory-results="true">
      ${
        visibleInventory.length
          ? `
            <div class="mobile-records">${mobileCards}</div>

            <div class="table-wrap desktop-table">
              <table class="inventory-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Collection</th>
                    <th class="money-cell">Cost</th>
                    <th class="money-cell">Price</th>
                    <th>Status</th>
                    <th class="money-cell">Profit Potential</th>
                    <th class="percent-cell">Margin</th>
                    <th>Age</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>${rows}</tbody>
              </table>
            </div>
          `
          : store.inventory.length
            ? emptyState("No matching items found.", "Try a different keyword or clear filters.")
            : emptyState("No inventory yet", "Add your first item to start tracking stock, cost, price, and profit.")
      }
    </div>
  `;
}

export function renderInventoryPage(store) {
  const collections = collectionOptions(store);
  const inventory = statusFilter === STATUSES.ARCHIVED
    ? store.inventory.filter((item) => item.status === STATUSES.ARCHIVED)
    : store.inventory.filter((item) => item.status !== STATUSES.ARCHIVED);

  return `
    ${pageHeader(
      "Inventory",
      `${inventory.length} total items`,
      `<button class="primary-btn page-action" type="button" data-open-inventory="true">+ Add Item</button>`,
    )}

    <div class="toolbar">
      <label class="search-field">
        Search items
        <input id="inventory-search" value="${escapeText(searchTerm)}" placeholder="Search items..." />
      </label>

      <label>
        Status
        <select id="inventory-status-filter">
          <option value="all">All Status</option>
          ${Object.values(STATUSES)
            .map(
              (status) =>
                `<option value="${status}" ${statusFilter === status ? "selected" : ""}>${status}</option>`,
            )
            .join("")}
        </select>
      </label>

      <label>
        Age
        <select id="inventory-age-filter">
          <option value="all" ${ageFilter === "all" ? "selected" : ""}>All Ages</option>
          <option value="new" ${ageFilter === "new" ? "selected" : ""}>New</option>
          <option value="30" ${ageFilter === "30" ? "selected" : ""}>30+ Days</option>
          <option value="60" ${ageFilter === "60" ? "selected" : ""}>60+ Days</option>
          <option value="90" ${ageFilter === "90" ? "selected" : ""}>90+ Days</option>
        </select>
      </label>

      <label>
        Cost
        <select id="inventory-cost-filter">
          <option value="all" ${costFilter === "all" ? "selected" : ""}>All Costs</option>
          <option value="recorded" ${costFilter === "recorded" ? "selected" : ""}>Cost Recorded</option>
          <option value="pending" ${costFilter === "pending" ? "selected" : ""}>Cost Pending</option>
        </select>
      </label>

      <label>
        Collection
        <select id="inventory-collection-filter">
          <option value="all">All Collections</option>
          ${collections
            .map(
              (name) =>
                `<option value="${escapeText(name)}" ${collectionFilter === name ? "selected" : ""}>${escapeText(name)}</option>`,
            )
            .join("")}
        </select>
      </label>
    </div>

    ${renderInventoryResults(store)}

    ${isModalOpen ? inventoryForm(store) : ""}
  `;
}

export function bindInventoryPage(root, store, notify, refresh) {
  const form = root.querySelector("#inventory-form");
  const editingItem = store.inventory.find((item) => item.id === editingId);

  if (form && editingItem) {
    form.sku.value = editingItem.sku;
    form.name.value = editingItem.name;
    form.collectionId.value = editingItem.collectionId;
    form.cost.value = isCostPending(editingItem) ? "" : editingItem.cost;
    form.price.value = editingItem.price;
    if (form.status) form.status.value = editingItem.status;
    form.createdAt.value = toDateInput(editingItem.createdAt);
    form.notes.value = editingItem.notes || "";
    const platformSelect = root.querySelector("#inventory-action-platform");
    const paymentSelect = root.querySelector("#inventory-action-payment");
    if (platformSelect) platformSelect.value = editingItem.platform || "";
    if (paymentSelect) paymentSelect.value = editingItem.paymentStatus || PAYMENT_STATUSES.PAID;
    applyInventoryDraft(root);
  } else if (form) {
    form.createdAt.value = toDateInput(new Date());
  }

  if (form) {
    bindForm(form, async (data) => {
      try {
        if (editingItem) {
          data = {
            id: editingItem.id,
            sku: editingItem.sku,
            name: editingItem.name,
            collectionId: editingItem.collectionId,
            cost: editingItem.cost,
            status: editingItem.status,
            createdAt: editingItem.createdAt,
            notes: editingItem.notes || "",
            ...data,
            price: form.elements.price.value,
          };
        } else {
          data.cost = form.elements.cost.value;
          data.price = form.elements.price.value;
        }

        if (data.id) {
          await saveSupabaseInventoryItem(data.id, data);
          notify("Item updated.");
        } else {
          await addSupabaseInventoryItem(data);
          notify("Inventory added and purchase recorded.");
        }

        editingId = null;
        isModalOpen = false;
        inventoryDraft = null;
        refresh();
      } catch (error) {
        notify(error.message, true);
        return false;
      }
    });
  }

  root.querySelector("#inventory-search")?.addEventListener("input", (event) => {
    searchTerm = event.target.value;
    const results = root.querySelector("[data-inventory-results]");
    if (results) {
      results.outerHTML = renderInventoryResults(store);
    }
  });

  root.querySelector("#inventory-status-filter")?.addEventListener("change", (event) => {
    statusFilter = event.target.value;
    refresh();
  });

  root.querySelector("#inventory-collection-filter")?.addEventListener("change", (event) => {
    collectionFilter = event.target.value;
    refresh();
  });

  root.querySelector("#inventory-age-filter")?.addEventListener("change", (event) => {
    ageFilter = event.target.value;
    refresh();
  });

  root.querySelector("#inventory-cost-filter")?.addEventListener("change", (event) => {
    costFilter = event.target.value;
    refresh();
  });

  const costInput = form?.elements.cost;
  const costPendingIndicator = root.querySelector("[data-cost-pending-indicator]");
  const updateCostPendingIndicator = () => {
    if (costPendingIndicator) costPendingIndicator.hidden = String(costInput?.value || "").trim() !== "";
  };
  costInput?.addEventListener("input", updateCostPendingIndicator);
  updateCostPendingIndicator();

  root.onclick = async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.busy === "true") return;
    const originalButtonText = button.textContent;

    try {
      if (button.dataset.openInventory) {
        inventoryDraft = null;
        editingId = null;
        isModalOpen = true;
        refresh();
      }

      if (button.dataset.closeModal) {
        inventoryDraft = null;
        editingId = null;
        isModalOpen = false;
        refresh();
      }

      if (button.dataset.edit) {
        inventoryDraft = null;
        editingId = button.dataset.edit;
        isModalOpen = true;
        refresh();
      }

      if (button.dataset.delete) {
        const item = store.inventory.find((entry) => entry.id === button.dataset.delete);
        const hasHistory = Boolean(
          item &&
          (
            store.sales.some((sale) => sale.itemId === item.id) ||
            store.purchases.some((purchase) => purchase.itemId === item.id) ||
            store.expenses.some((expense) => expense.category === "Write-Off" && String(expense.details || "").startsWith(item.sku)) ||
            [STATUSES.SOLD, STATUSES.WRITTEN_OFF, STATUSES.ARCHIVED].includes(item.status)
          )
        );
        const message = hasHistory
          ? "This action permanently removes historical records and cannot be undone.\n\nArchive is safer for business history. Delete anyway?"
          : "Delete this item permanently?\n\nThis action cannot be undone.";

        if (!confirm(message)) return;
        if (hasHistory && !confirm("Final confirmation: permanently delete this item and related records?")) return;

        button.dataset.busy = "true";
        button.disabled = true;
        button.textContent = "Deleting...";
        await removeSupabaseInventoryItem(button.dataset.delete);
        editingId = null;
        isModalOpen = false;
        inventoryDraft = null;
        notify("Item deleted.");
        refresh();
      }

      if (button.dataset.statusAction) {
        inventoryDraft = readInventoryDraft(root);
        const nextStatus = button.dataset.statusAction;
        const itemId = button.dataset.itemId;
        const platform = root.querySelector("#inventory-action-platform")?.value || "";
        const payment = root.querySelector("#inventory-action-payment")?.value || PAYMENT_STATUSES.PAID;

        if (nextStatus === STATUSES.SOLD && !platform) {
          notify("Choose a platform before marking sold.", true);
          return;
        }

        if (nextStatus === STATUSES.AVAILABLE && editingItem?.status === STATUSES.SOLD && !confirm("Change this sold item back to Available and remove its sale record?")) return;
        if (nextStatus === STATUSES.WRITTEN_OFF && !confirm("Write off this item as an expense?")) return;
        if (nextStatus === STATUSES.ARCHIVED && !confirm("Archive this item? It will be hidden from active inventory.")) return;

        const progressText = nextStatus === STATUSES.SOLD
          ? "Selling..."
          : nextStatus === STATUSES.AVAILABLE && editingItem?.status === STATUSES.SOLD
            ? "Reversing..."
            : nextStatus === STATUSES.WRITTEN_OFF
              ? "Writing off..."
              : nextStatus === STATUSES.ARCHIVED
                ? "Archiving..."
                : "Updating...";

        button.dataset.busy = "true";
        button.disabled = true;
        button.textContent = progressText;
        await setSupabaseInventoryStatus(itemId, nextStatus, payment, platform);

        notify(`Item marked ${nextStatus}.`);
        refresh();
      }
    } catch (error) {
      notify(error.message, true);
    } finally {
      if (button.dataset.busy === "true") {
        button.dataset.busy = "false";
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  };
}
