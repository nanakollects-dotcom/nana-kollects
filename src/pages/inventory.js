import { getInventoryAgeDays, getInventoryMarginPercent, getInventoryProfitPotential } from "../core/calculations.js";
import { isCostPending } from "../core/costs.js";
import {
  addSupabaseInventoryItem,
  removeSupabaseInventoryItem,
  saveSupabaseInventoryItem,
  setSupabaseInventoryStatus,
  addPaymentRequest,
  cancelPaymentRequest,
  markPaymentRequestPaid,
  savePaymentConfiguration,
  PAYMENT_STATUSES,
  PLATFORMS,
  STATUSES,
} from "../services/repository.js";
import { bindForm, emptyState, modal, pageHeader } from "../components/ui.js";
import { formatMoney } from "../components/format.js";
import { calculatePaymentRequestTotal, COURIER_OPTIONS, displayCourier, isPaymentConfigurationComplete, localDateInputValue, PAYMENT_METHODS, SHIPPING_MODE_LABELS, SHIPPING_MODES, validatePaymentRequestRequiredFields } from "../core/paymentRequests.js";
import { createPaymentRequestPdf, downloadPaymentRequestPdf } from "../services/paymentRequestPdf.js";
import { createPaymentRequestImage, downloadPaymentRequestImage } from "../services/paymentRequestImage.js";

let editingId = null;
let isModalOpen = false;
let searchTerm = "";
let statusFilter = "all";
let collectionFilter = "all";
let ageFilter = "all";
let costFilter = "all";
let inventoryDraft = null;
let paymentRequestItemId = null;
let paymentConfigOpen = false;
let paidRequestId = null;

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

const pendingPaymentRequestMessage = "This item has a pending payment request. Mark it Paid or Cancel the request before changing its inventory status.";
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

const hasPendingPaymentRequest = (store, itemId) => (store.paymentRequests || []).some(
  (request) => request.itemId === itemId && request.status === "Pending",
);

const requestStatusClass = (status) => {
  if (status === "Paid") return "green-pill";
  if (status === "Cancelled") return "gray-pill";
  return "yellow-pill";
};

const readImageAsDataUrl = (file) => new Promise((resolve, reject) => {
  if (!file) {
    reject(new Error("Upload a GoTyme QR image."));
    return;
  }
  if (!String(file.type || "").startsWith("image/")) {
    reject(new Error("GoTyme QR must be an image."));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(new Error("Could not read the GoTyme QR image."));
  reader.readAsDataURL(file);
});

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
  const pendingRequest = editingItem
    ? (store.paymentRequests || []).find((request) => request.itemId === editingItem.id && request.status === "Pending")
    : null;

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
                <small class="modal-copy">Leave blank if purchase cost is not yet known.</small>
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
            pendingRequest
              ? `
                <section class="modal-section payment-request-action-panel payment-request-status-card">
                  <h3>Payment Request</h3>
                  <div class="payment-request-inline-details">
                    <div><span>Status</span><strong>${escapeText(pendingRequest.status)}</strong></div>
                    <div><span>Request No</span><strong>${escapeText(pendingRequest.requestNumber)}</strong></div>
                  </div>
                  <div class="request-actions">
                    <button class="table-action" type="button" data-download-request="${pendingRequest.id}">Download PDF</button>
                    <button class="table-action" type="button" data-download-image-request="${pendingRequest.id}">Save as Image</button>
                    <button class="table-action primary-action" type="button" data-paid-request="${pendingRequest.id}">Mark Paid</button>
                    <button class="table-action danger" type="button" data-cancel-request="${pendingRequest.id}">Cancel Payment Request</button>
                  </div>
                  <p class="modal-copy payment-request-helper">This item is reserved while this payment request is pending.</p>
                </section>
              `
              : ""
          }

          ${
            editingItem && itemStatus === STATUSES.AVAILABLE && !pendingRequest
              ? `
                <section class="modal-section payment-request-action-panel">
                  <h3>Payment Request</h3>
                  <button class="table-action primary-action" type="button" data-create-request="${editingItem.id}">Create Payment Request</button>
                </section>
              `
              : ""
          }

          ${
            editingItem
              ? pendingRequest
                ? `
                  <section class="modal-section inventory-action-panel inventory-action-locked-panel">
                    <h3>Inventory Actions</h3>
                    <p class="modal-copy">Inventory actions are locked while a payment request is pending. Mark the request as Paid or Cancel it first.</p>
                  </section>
                `
                : `
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

function paymentRequestForm(store) {
  const item = store.inventory.find((entry) => entry.id === paymentRequestItemId);
  if (!item) return "";

  return modal(
    "Create Payment Request",
    `
      <form class="form-panel modal-form payment-request-form" id="payment-request-form" novalidate>
        <div class="modal-header">
          <div>
            <h2>Create Payment Request</h2>
            <p>${escapeText(item.sku)} &middot; ${escapeText(item.name)}</p>
          </div>
          <button class="icon-btn" type="button" data-close-payment-request>Close</button>
        </div>

        <section class="modal-section payment-request-section">
          <h3>Customer</h3>
          <div class="payment-request-field-grid">
            <label>Customer Name<input name="customerName" /><small class="payment-request-field-error" data-payment-request-error="customerName" hidden></small></label>
            <label>Mobile Number<input name="customerContact" inputmode="tel" autocomplete="tel" /><small class="payment-request-field-error" data-payment-request-error="customerContact" hidden></small></label>
            <label class="full-span">Shipping Address<textarea name="shippingAddress" rows="2" placeholder="Optional"></textarea></label>
          </div>
        </section>

        <section class="modal-section payment-request-section">
          <h3>Order</h3>
          <div class="payment-request-field-grid">
            <label>Item Name<input value="${escapeText(item.name)}" readonly /></label>
            <label>Selling Price<input type="number" name="itemPrice" min="0" step="0.01" value="${item.price}" required /></label>
            <label>Shipping Fee
              <select name="shippingMode">
                <option value="${SHIPPING_MODES.FEE_NOW}">${SHIPPING_MODE_LABELS[SHIPPING_MODES.FEE_NOW]}</option>
                <option value="${SHIPPING_MODES.TO_FOLLOW}">${SHIPPING_MODE_LABELS[SHIPPING_MODES.TO_FOLLOW]}</option>
                <option value="${SHIPPING_MODES.PICKUP}">${SHIPPING_MODE_LABELS[SHIPPING_MODES.PICKUP]}</option>
              </select>
            </label>
            <label data-courier-field>Courier
              <select name="courier">
                <option value="">Select courier</option>
                ${COURIER_OPTIONS.map((courier) => `<option value="${escapeText(courier)}">${escapeText(displayCourier(courier))}</option>`).join("")}
              </select>
            </label>
            <label data-shipping-fee-field>Shipping Fee<input type="number" name="shippingFee" min="0" step="0.01" value="0" /></label>
            <label>Discount<input type="number" name="discount" min="0" step="0.01" value="0" /></label>
            <label>Valid Until<input type="date" name="validUntil" min="${localDateInputValue()}" /><small class="payment-request-field-error" data-payment-request-error="validUntil" hidden></small></label>
            <label data-custom-courier-field hidden>Custom Courier<input name="customCourier" placeholder="Courier name" /></label>
            <label class="full-span">Customer-facing Note<textarea name="customerNote" rows="2" placeholder="Optional"></textarea></label>
          </div>
        </section>

        <section class="modal-section payment-request-summary payment-request-section">
          <h3>Summary</h3>
          <div><span>Subtotal</span><strong data-request-subtotal>${formatMoney(item.price)}</strong></div>
          <div data-request-shipping-row hidden><span data-request-shipping-label>Shipping Fee</span><strong data-request-shipping>${formatMoney(0)}</strong></div>
          <div data-request-courier-row hidden><span>Courier</span><strong data-request-courier></strong></div>
          <div data-request-discount-row hidden><span>Discount</span><strong data-request-discount>${formatMoney(0)}</strong></div>
          <div class="request-total"><span data-request-total-label>Total Amount Due</span><strong data-request-total>${formatMoney(item.price)}</strong></div>
        </section>

        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="Generating...">Generate Payment Request</button>
          <button class="secondary-btn" type="button" data-close-payment-request>Cancel</button>
        </div>
      </form>
    `,
    "payment-request-modal-panel",
  );
}

function paymentConfigForm(store) {
  const config = store.paymentConfig || {};
  return modal(
    "Payment Details",
    `
      <form class="form-panel modal-form payment-config-form" id="payment-config-form">
        <div class="modal-header">
          <h2>Payment Details</h2>
          <button class="icon-btn" type="button" data-close-payment-config>Close</button>
        </div>
        <section class="modal-section">
          <h3>GCash</h3>
          <div class="form-row">
            <label>Account Name<input name="gcashAccountName" value="${escapeText(config.gcashAccountName)}" required /></label>
            <label>Mobile Number<input name="gcashMobileNumber" value="${escapeText(config.gcashMobileNumber)}" required /></label>
          </div>
        </section>
        <section class="modal-section">
          <h3>GoTyme</h3>
          <label>Account Name<input name="gotymeAccountName" value="${escapeText(config.gotymeAccountName)}" /></label>
          <label>QR Image<input type="file" name="gotymeQrImage" accept="image/png,image/jpeg" ${config.gotymeQrImage ? "" : "required"} /></label>
          ${config.gotymeQrImage ? `<p class="modal-copy">A GoTyme QR image is configured. Upload a new image only to replace it.</p>` : ""}
        </section>
        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="Saving...">Save Payment Details</button>
          <button class="secondary-btn" type="button" data-close-payment-config>Cancel</button>
        </div>
      </form>
    `,
  );
}

function paidRequestForm(store) {
  const request = store.paymentRequests.find((entry) => entry.id === paidRequestId);
  if (!request) return "";
  return modal(
    "Confirm Payment",
    `
      <form class="form-panel modal-form" id="payment-paid-form">
        <div class="modal-header">
          <div>
            <h2>Confirm Payment</h2>
            <p>${escapeText(request.requestNumber)}</p>
          </div>
          <button class="icon-btn" type="button" data-close-paid-request>Close</button>
        </div>
        <section class="modal-section">
          <label>Payment Method
            <select name="paymentMethod" required>
              <option value="">Choose method</option>
              ${PAYMENT_METHODS.map((method) => `<option value="${method}">${method}</option>`).join("")}
            </select>
          </label>
          <p class="modal-copy">This finalizes the existing sale at ${formatMoney(request.itemPrice)}.</p>
        </section>
        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="Confirming...">Mark Paid</button>
          <button class="secondary-btn" type="button" data-close-paid-request>Cancel</button>
        </div>
      </form>
    `,
  );
}

function renderPaymentRequests(store) {
  const requests = store.paymentRequests || [];
  const rows = requests.map((request) => `
    <tr>
      <td><strong>${escapeText(request.requestNumber)}</strong><small>${escapeText(request.itemName)}</small></td>
      <td>${escapeText(request.customerName)}</td>
      <td class="money-cell">${formatMoney(request.totalAmount)}</td>
      <td><span class="pill ${requestStatusClass(request.status)}">${request.status}</span></td>
      <td class="actions-cell request-actions">
        <button class="table-action" type="button" data-download-request="${request.id}">Download PDF</button>
        <button class="table-action" type="button" data-download-image-request="${request.id}">Save as Image</button>
        ${request.status === "Pending" ? `
          <button class="table-action primary-action" type="button" data-paid-request="${request.id}">Mark Paid</button>
          <button class="table-action danger" type="button" data-cancel-request="${request.id}">Cancel</button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  return `
    <section class="panel payment-requests-panel">
      <div class="section-heading">
        <div>
          <h2>Payment Requests</h2>
          <p>${requests.length} saved request${requests.length === 1 ? "" : "s"}</p>
        </div>
        <button class="secondary-btn" type="button" data-open-payment-config>
          ${isPaymentConfigurationComplete(store.paymentConfig) ? "Payment Details" : "Set Up Payment Details"}
        </button>
      </div>
      ${requests.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Request</th><th>Customer</th><th class="money-cell">Amount</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : emptyState("No payment requests yet", "Create one from an Available inventory item.")}
    </section>
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

    ${renderPaymentRequests(store)}

    ${isModalOpen ? inventoryForm(store) : ""}
    ${paymentRequestItemId ? paymentRequestForm(store) : ""}
    ${paymentConfigOpen ? paymentConfigForm(store) : ""}
    ${paidRequestId ? paidRequestForm(store) : ""}
  `;
}

export function bindInventoryPage(root, store, notify, refresh) {
  const form = root.querySelector("#inventory-form");
  const paymentForm = root.querySelector("#payment-request-form");
  const configForm = root.querySelector("#payment-config-form");
  const paidForm = root.querySelector("#payment-paid-form");
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

  if (paymentForm) {
    const today = localDateInputValue();
    if (paymentForm.elements.validUntil) paymentForm.elements.validUntil.min = today;

    const showPaymentRequestValidation = (validation, focusFirst = false) => {
      let firstInvalid = null;
      ["customerName", "customerContact", "validUntil"].forEach((name) => {
        const field = paymentForm.elements[name];
        const message = validation.errors[name] || "";
        const error = paymentForm.querySelector(`[data-payment-request-error="${name}"]`);
        if (field) field.setAttribute("aria-invalid", message ? "true" : "false");
        if (error) {
          error.textContent = message;
          error.hidden = !message;
        }
        if (message && !firstInvalid) firstInvalid = field;
      });
      if (focusFirst && firstInvalid) firstInvalid.focus();
      return !Object.keys(validation.errors).length;
    };

    const validatePaymentRequestForm = (focusFirst = false) => {
      const validation = validatePaymentRequestRequiredFields(
        {
          customerName: paymentForm.elements.customerName.value,
          customerContact: paymentForm.elements.customerContact.value,
          validUntil: paymentForm.elements.validUntil.value,
        },
        today,
      );
      showPaymentRequestValidation(validation, focusFirst);
      return validation;
    };

    ["customerName", "customerContact", "validUntil"].forEach((name) => {
      paymentForm.elements[name]?.addEventListener("input", () => validatePaymentRequestForm(false));
      paymentForm.elements[name]?.addEventListener("change", () => validatePaymentRequestForm(false));
    });

    const updateSummary = () => {
      try {
        const shippingMode = paymentForm.elements.shippingMode.value;
        const amounts = calculatePaymentRequestTotal(
          paymentForm.elements.itemPrice.value,
          paymentForm.elements.shippingFee.value,
          paymentForm.elements.discount.value,
          shippingMode,
        );
        const courier = paymentForm.elements.courier.value === "Other"
          ? paymentForm.elements.customCourier.value.trim() || "Other"
          : paymentForm.elements.courier.value;
        const shippingFeeField = root.querySelector("[data-shipping-fee-field]");
        const customCourierField = root.querySelector("[data-custom-courier-field]");
        const courierField = root.querySelector("[data-courier-field]");
        const isFeeNow = shippingMode === SHIPPING_MODES.FEE_NOW;
        const isToFollow = shippingMode === SHIPPING_MODES.TO_FOLLOW;

        if (shippingFeeField) shippingFeeField.hidden = !isFeeNow;
        if (courierField) courierField.hidden = shippingMode === SHIPPING_MODES.PICKUP;
        if (customCourierField) customCourierField.hidden = paymentForm.elements.courier.value !== "Other" || shippingMode === SHIPPING_MODES.PICKUP;
        root.querySelector("[data-request-subtotal]").textContent = formatMoney(amounts.itemPrice);
        root.querySelector("[data-request-shipping-label]").textContent = shippingMode === SHIPPING_MODES.PICKUP ? "Shipping" : "Shipping Fee";
        root.querySelector("[data-request-shipping]").textContent = shippingMode === SHIPPING_MODES.PICKUP ? SHIPPING_MODE_LABELS[SHIPPING_MODES.PICKUP] : isToFollow ? "To follow" : formatMoney(amounts.shippingFee);
        const courierLabel = displayCourier(courier);
        root.querySelector("[data-request-courier]").textContent = courierLabel;
        root.querySelector("[data-request-discount]").textContent = `- ${formatMoney(amounts.discount)}`;
        root.querySelector("[data-request-total-label]").textContent = isToFollow ? "Amount Due Now" : "Total Amount Due";
        root.querySelector("[data-request-total]").textContent = formatMoney(amounts.total);
        root.querySelector("[data-request-shipping-row]").hidden = isFeeNow && amounts.shippingFee === 0;
        root.querySelector("[data-request-courier-row]").hidden = shippingMode === SHIPPING_MODES.PICKUP || !courierLabel;
        root.querySelector("[data-request-discount-row]").hidden = amounts.discount === 0;
      } catch {
        root.querySelector("[data-request-total]").textContent = "--";
      }
    };
    ["itemPrice", "shippingFee", "discount", "shippingMode", "courier", "customCourier"].forEach((name) => {
      paymentForm.elements[name]?.addEventListener("input", updateSummary);
      paymentForm.elements[name]?.addEventListener("change", updateSummary);
    });
    updateSummary();

    bindForm(paymentForm, async (data) => {
      try {
        const requiredFields = validatePaymentRequestForm(true);
        if (Object.keys(requiredFields.errors).length) return false;
        data = {
          ...data,
          ...requiredFields.values,
        };
        paymentForm.elements.customerName.value = data.customerName;
        paymentForm.elements.customerContact.value = data.customerContact;
        paymentForm.elements.validUntil.value = data.validUntil;

        if (!isPaymentConfigurationComplete(store.paymentConfig)) {
          throw new Error("Set up GCash details and the GoTyme QR before generating a request.");
        }
        const amounts = calculatePaymentRequestTotal(data.itemPrice, data.shippingFee, data.discount, data.shippingMode);
        const result = await addPaymentRequest({
          ...data,
          itemId: paymentRequestItemId,
          paymentConfig: store.paymentConfig,
          ...amounts,
        });
        const bytes = await createPaymentRequestPdf(result.request, {
          ...result.request.paymentConfig,
          gotymeQrImage: result.store.paymentConfig.gotymeQrImage,
        });
        downloadPaymentRequestPdf(bytes, result.request.requestNumber);
        paymentRequestItemId = null;
        notify(`${result.request.requestNumber} created. Item reserved.`);
        refresh();
      } catch (error) {
        notify(error.message, true);
        return false;
      }
    });
  }

  if (configForm) {
    bindForm(configForm, async (data) => {
      try {
        const file = configForm.elements.gotymeQrImage.files?.[0];
        const gotymeQrImage = file
          ? await readImageAsDataUrl(file)
          : store.paymentConfig?.gotymeQrImage;
        await savePaymentConfiguration({ ...data, gotymeQrImage });
        paymentConfigOpen = false;
        notify("Payment details saved.");
        refresh();
      } catch (error) {
        notify(error.message, true);
        return false;
      }
    });
  }

  if (paidForm) {
    bindForm(paidForm, async (data) => {
      try {
        await markPaymentRequestPaid(paidRequestId, data.paymentMethod);
        paidRequestId = null;
        notify("Payment confirmed and sale recorded.");
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

      if (button.dataset.createRequest) {
        if (!isPaymentConfigurationComplete(store.paymentConfig)) {
          paymentConfigOpen = true;
          notify("Set up payment details before creating a request.", true);
        } else {
          paymentRequestItemId = button.dataset.createRequest;
          editingId = null;
          isModalOpen = false;
          inventoryDraft = null;
        }
        refresh();
      }

      if (button.hasAttribute("data-open-payment-config")) {
        paymentConfigOpen = true;
        refresh();
      }

      if (button.hasAttribute("data-close-payment-config")) {
        paymentConfigOpen = false;
        refresh();
      }

      if (button.hasAttribute("data-close-payment-request")) {
        paymentRequestItemId = null;
        refresh();
      }

      if (button.dataset.downloadRequest) {
        const request = store.paymentRequests.find((entry) => entry.id === button.dataset.downloadRequest);
        if (!request) throw new Error("Payment request not found.");
        const bytes = await createPaymentRequestPdf(request, {
          ...request.paymentConfig,
          gotymeQrImage: store.paymentConfig.gotymeQrImage,
        });
        downloadPaymentRequestPdf(bytes, request.requestNumber);
        notify("Payment Request PDF downloaded.");
      }

      if (button.dataset.downloadImageRequest) {
        const request = store.paymentRequests.find((entry) => entry.id === button.dataset.downloadImageRequest);
        if (!request) throw new Error("Payment request not found.");
        const blob = await createPaymentRequestImage(request, {
          ...request.paymentConfig,
          gotymeQrImage: store.paymentConfig.gotymeQrImage,
        });
        downloadPaymentRequestImage(blob, request.requestNumber);
        notify("Payment Request image saved.");
      }

      if (button.dataset.paidRequest) {
        paidRequestId = button.dataset.paidRequest;
        refresh();
      }

      if (button.hasAttribute("data-close-paid-request")) {
        paidRequestId = null;
        refresh();
      }

      if (button.dataset.cancelRequest) {
        if (!confirm("Cancel this payment request and make the item available again?")) return;
        await cancelPaymentRequest(button.dataset.cancelRequest);
        notify("Payment Request cancelled. Item released.");
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
        if (hasPendingPaymentRequest(store, button.dataset.delete)) {
          notify(pendingPaymentRequestMessage, true);
          return;
        }
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

        if (hasPendingPaymentRequest(store, itemId)) {
          notify(pendingPaymentRequestMessage, true);
          return;
        }

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
