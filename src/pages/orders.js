import { emptyState, modal, pageHeader } from "../components/ui.js";
import { formatMoney } from "../components/format.js";
import { markOrderCompleted, markOrderPacked, markOrderShipped, setOrderItemPacked, startOrderPacking } from "../services/repository.js";
import {
  canMarkOrderCompleted,
  canMarkOrderPacked,
  canMarkOrderShipped,
  canStartOrderPacking,
  canToggleOrderPackingItem,
  filterOrders,
  formatOrderWaitingTime,
  FULFILLMENT_METHODS,
  getFulfillmentMethodLabel,
  getOrderChecklistProgress,
  getOrderItemCount,
  getPackingWorkspaceState,
  getOrderProgressLabel,
  getOrderQueueMetrics,
  getOrderStatusClass,
  getOrderStatusLabel,
  getPackingItemState,
  ORDER_QUEUE_FILTERS,
  ORDER_SORTS,
  ORDER_STATUSES,
  PACKING_ITEM_STATES,
  PACKING_READINESS,
  sortOrders,
  validateOrderShipping,
} from "../core/orders.js";

let searchTerm = "";
let statusFilter = ORDER_QUEUE_FILTERS.NEEDS_ACTION;
let methodFilter = ORDER_QUEUE_FILTERS.ALL;
let sortMode = ORDER_SORTS.PRIORITY;
let metricFilter = "";
let closeOrderDetailsModal = null;
let activeOrderWorkspace = null;
const pendingStartOrderIds = new Set();
const pendingPackingItemIds = new Set();
const pendingMarkPackedOrderIds = new Set();
const pendingMarkShippedOrderIds = new Set();
const pendingMarkCompletedOrderIds = new Set();
const packingFeedbackByOrder = new Map();
const shippingFeedbackByOrder = new Map();
const completionFeedbackByOrder = new Map();
const shippingDraftByOrder = new Map();

const defaultPackingActions = {
  markOrderCompleted,
  markOrderPacked,
  markOrderShipped,
  setOrderItemPacked,
  startOrderPacking,
};

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function formatCreatedAt(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function displayText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatItemCount(count) {
  if (count === null) return "Item count unavailable";
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function itemsForOrder(store, orderId) {
  if (!orderId || !Array.isArray(store.orderItems)) return [];
  return store.orderItems.filter((item) => item.orderId === orderId);
}

function itemPreview(items) {
  const names = items.map((item) => String(item.itemName || "").trim()).filter(Boolean);
  if (!names.length) return "Item details unavailable";
  return `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2} more` : ""}`;
}

function renderProgress(progress) {
  const label = getOrderProgressLabel(progress);
  return `
    <div class="order-progress" aria-label="${escapeText(label)}">
      <span><i style="width: ${progress.percent}%"></i></span>
      <small>${escapeText(label)}</small>
    </div>
  `;
}

function renderAction(order) {
  const label = "View Order";
  return `<button class="table-action primary-action order-next-action" type="button" data-order-action="${escapeText(order.id || "unknown-order")}" aria-label="${escapeText(`${label} for ${displayText(order.orderNumber, "order with unavailable reference")}`)}">${escapeText(label)}</button>`;
}

function renderDetailValue(label, value, fallback = "Not available") {
  return `
    <div class="order-detail-value">
      <span>${escapeText(label)}</span>
      <strong>${escapeText(displayText(value, fallback))}</strong>
    </div>
  `;
}

function renderOrderDetailItems(items, available) {
  if (!available) {
    return `<p class="order-details-unavailable">Order Items are unavailable in the current store.</p>`;
  }
  if (!items.length) {
    return `<p class="order-details-unavailable">No Order Items are recorded for this Order.</p>`;
  }

  return `
    <div class="order-detail-items">
      ${items.map((item) => {
        const quantity = Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0
          ? Number(item.quantity)
          : null;
        const packingState = item.packingRequired === false
          ? "Packing not required"
          : item.checkedAt
            ? `Checked ${formatCreatedAt(item.checkedAt)}`
            : "Not checked";
        return `
          <article class="order-detail-item">
            <div>
              <strong>${escapeText(displayText(item.itemName, "Item name unavailable"))}</strong>
              <span class="mono">${escapeText(displayText(item.sku, "SKU unavailable"))}</span>
            </div>
            <div class="order-detail-item-summary">
              <span>${escapeText(quantity === null ? "Quantity unavailable" : `Qty ${quantity}`)}</span>
              <strong>${escapeText(formatMoney(item.sellingPrice))}</strong>
            </div>
            <small>${escapeText(packingState)}</small>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderOrderTimeline(events, available) {
  if (!available) {
    return `<p class="order-details-unavailable">Fulfillment Events are unavailable in the current store.</p>`;
  }
  if (!events.length) {
    return `<p class="order-details-unavailable">No fulfillment events are recorded for this Order.</p>`;
  }

  const orderedEvents = [...events].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return (Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime)
      - (Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime);
  });

  return `
    <ol class="order-timeline">
      ${orderedEvents.map((event) => {
        const fromStatus = event.fromStatus ? getOrderStatusLabel(event.fromStatus) : "Order created";
        const toStatus = getOrderStatusLabel(event.toStatus);
        const packingRelated = [event.fromStatus, event.toStatus].some((status) => [
          ORDER_STATUSES.READY_TO_PACK,
          ORDER_STATUSES.PACKING,
          ORDER_STATUSES.PACKED,
        ].includes(status));
        return `
          <li class="${packingRelated ? "packing-related-event" : ""}">
            <span aria-hidden="true"></span>
            <div>
              <strong>${escapeText(`${fromStatus} → ${toStatus}`)}</strong>
              <time>${escapeText(formatCreatedAt(event.createdAt))}</time>
              ${String(event.note || "").trim() ? `<p>${escapeText(event.note)}</p>` : ""}
            </div>
          </li>
        `;
      }).join("")}
    </ol>
  `;
}

const PACKING_READINESS_LABELS = {
  [PACKING_READINESS.NOT_STARTED]: "Not started",
  [PACKING_READINESS.IN_PROGRESS]: "In progress",
  [PACKING_READINESS.READY]: "Ready to mark packed",
  [PACKING_READINESS.NOT_REQUIRED]: "No packing required",
  [PACKING_READINESS.UNAVAILABLE]: "Unavailable",
};

function packingMetric(label, value) {
  return `
    <div class="packing-metric">
      <span>${escapeText(label)}</span>
      <strong>${escapeText(value === null ? "Unavailable" : value)}</strong>
    </div>
  `;
}

function packingStateForItem(item) {
  const state = getPackingItemState(item);
  if (state === PACKING_ITEM_STATES.NOT_REQUIRED) return { state, label: "No packing required", className: "muted-pill" };
  if (state === PACKING_ITEM_STATES.UNAVAILABLE) return { state, label: "Unavailable", className: "gray-pill" };
  if (state === PACKING_ITEM_STATES.CHECKED) return { state, label: "Checked", className: "green-pill" };
  return { state, label: "Unchecked", className: "yellow-pill" };
}

function renderPackingFeedback(orderId) {
  const feedback = packingFeedbackByOrder.get(orderId);
  if (!feedback) return "";
  const role = feedback.tone === "error" || feedback.tone === "recovery" ? "alert" : "status";
  return `<div class="packing-feedback packing-feedback-${feedback.tone}" role="${role}" aria-live="polite">${escapeText(feedback.message)}</div>`;
}

function shippingDraft(order) {
  if (!shippingDraftByOrder.has(order.id)) {
    shippingDraftByOrder.set(order.id, {
      courier: String(order.courier || ""),
      trackingNumber: String(order.trackingNumber || ""),
      shippingNote: String(order.shippingNote || ""),
    });
  }
  return shippingDraftByOrder.get(order.id);
}

function renderShippingFeedback(orderId) {
  const feedback = shippingFeedbackByOrder.get(orderId);
  if (!feedback) return "";
  const role = feedback.tone === "error" || feedback.tone === "recovery" ? "alert" : "status";
  return `<div class="packing-feedback packing-feedback-${feedback.tone}" role="${role}" aria-live="polite">${escapeText(feedback.message)}</div>`;
}

export function renderShippingWorkspace(store = {}, orderId = "") {
  const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
  if (!order) {
    return modal(
      "Shipping Workspace",
      `<div class="shipping-workspace"><div class="modal-header order-details-header packing-header"><button class="icon-btn" type="button" data-back-to-order-details>Back</button><div><h2>Shipping Workspace</h2><p>Order reference unavailable</p></div><button class="icon-btn" type="button" data-close-order-details>Close</button></div><section class="modal-section">${emptyState("Order not found", "This Order is no longer available in the loaded store.")}</section></div>`,
      "order-details-panel shipping-workspace-panel",
    );
  }

  const reference = displayText(order.orderNumber, "Order reference unavailable");
  const draft = shippingDraft(order);
  const pending = pendingMarkShippedOrderIds.has(order.id);
  const editable = order.fulfillmentStatus === ORDER_STATUSES.PACKED && order.fulfillmentMethod !== FULFILLMENT_METHODS.PICKUP;
  const validationInput = { ...draft, shippedAt: new Date().toISOString() };
  const errors = validateOrderShipping(order, validationInput);
  const ready = canMarkOrderShipped(order, validationInput);
  const eventsAvailable = Array.isArray(store.orderEvents);
  const events = eventsAvailable ? store.orderEvents.filter((event) => event.orderId === order.id) : [];
  const inputDisabled = !editable || pending ? "disabled" : "";
  const readiness = order.fulfillmentStatus === ORDER_STATUSES.SHIPPED
    ? "Shipment confirmed"
    : ready
      ? "Ready to ship"
      : "Shipping information required";
  const actionCopy = order.fulfillmentStatus === ORDER_STATUSES.SHIPPED
    ? "This shipment is confirmed and the saved details are read-only."
    : editable
      ? "Enter the carrier details exactly as they should appear in fulfillment records."
      : "Shipping actions are unavailable for this Order status or fulfillment method.";

  return modal(
    `Shipping Workspace: ${escapeText(reference)}`,
    `<div class="shipping-workspace">
      <div class="modal-header order-details-header packing-header">
        <button class="icon-btn" type="button" data-back-to-order-details>Back</button>
        <div><h2>Shipping Workspace</h2><p class="mono">${escapeText(reference)}</p></div>
        <button class="icon-btn" type="button" data-close-order-details>Close</button>
      </div>
      <section class="packing-hero" aria-label="Shipping workspace summary">
        <div><strong>${escapeText(displayText(order.customerName, "Customer unavailable"))}</strong><span class="pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeText(getOrderStatusLabel(order.fulfillmentStatus))}</span></div>
        <div><span>${escapeText(getFulfillmentMethodLabel(order.fulfillmentMethod))}</span><strong>Packed ${escapeText(formatCreatedAt(order.packedAt))}</strong></div>
        <p>${escapeText(actionCopy)}</p>
      </section>
      ${renderShippingFeedback(order.id)}
      <section class="modal-section">
        <div class="order-details-section-heading"><h3>Shipment Information</h3><strong data-shipping-readiness>${escapeText(readiness)}</strong></div>
        <div class="shipping-form" data-shipping-form aria-busy="${pending}">
          <label>Courier
            <input data-shipping-field="courier" value="${escapeText(draft.courier)}" maxlength="160" ${inputDisabled} aria-label="Courier for ${escapeText(reference)}" aria-describedby="shipping-courier-error" />
            <small id="shipping-courier-error" data-shipping-error="courier">${escapeText(errors.courier || "")}</small>
          </label>
          <label>Tracking Number
            <input data-shipping-field="trackingNumber" value="${escapeText(draft.trackingNumber)}" maxlength="240" ${inputDisabled} aria-label="Tracking Number for ${escapeText(reference)}" aria-describedby="shipping-tracking-error" />
            <small id="shipping-tracking-error" data-shipping-error="tracking">${escapeText(errors.tracking || "")}</small>
          </label>
          <label class="shipping-note-field">Shipping Notes
            <textarea data-shipping-field="shippingNote" maxlength="2000" rows="4" ${inputDisabled} aria-label="Shipping Notes for ${escapeText(reference)}">${escapeText(draft.shippingNote)}</textarea>
            <small>Optional handling or fulfillment context.</small>
          </label>
        </div>
      </section>
      <div class="packing-start-action shipping-submit-action">
        <button class="primary-btn" type="button" data-mark-order-shipped ${pending ? "disabled" : ""} ${pending ? 'aria-busy="true"' : ""} ${!ready && !pending ? "hidden" : ""} aria-label="${escapeText(`${pending ? "Marking Shipped" : "Mark Shipped"} for ${reference}`)}">${pending ? "Marking Shipped..." : "Mark Shipped"}</button>
      </div>
      <section class="modal-section"><h3>Shipping Readiness</h3><p data-shipping-readiness-copy>${escapeText(readiness)}. Courier and tracking number are required.</p></section>
      <section class="modal-section"><h3>Shipment Context</h3><div class="order-detail-grid">
        ${renderDetailValue("Shipping address", order.shippingAddress, "Address unavailable")}
        ${renderDetailValue("Packed", formatCreatedAt(order.packedAt))}
        ${renderDetailValue("Shipped", formatCreatedAt(order.shippedAt))}
        ${renderDetailValue("Saved courier", order.courier, "Not assigned")}
        ${renderDetailValue("Saved tracking number", order.trackingNumber, "Not assigned")}
        ${renderLatestEvent(events, eventsAvailable)}
      </div></section>
      <section class="modal-section"><h3>Fulfillment Timeline</h3>${renderOrderTimeline(events, eventsAvailable)}</section>
    </div>`,
    "order-details-panel shipping-workspace-panel",
  );
}

function renderCompletionFeedback(orderId) {
  const feedback = completionFeedbackByOrder.get(orderId);
  if (!feedback) return "";
  const role = feedback.tone === "error" || feedback.tone === "recovery" ? "alert" : "status";
  return `<div class="packing-feedback packing-feedback-${feedback.tone}" role="${role}" aria-live="polite">${escapeText(feedback.message)}</div>`;
}

export function renderCompletionWorkspace(store = {}, orderId = "") {
  const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
  if (!order) {
    return modal(
      "Complete Order",
      `<div class="completion-workspace"><div class="modal-header order-details-header packing-header"><button class="icon-btn" type="button" data-back-to-order-details>Back</button><div><h2>Complete Order</h2><p>Order reference unavailable</p></div><button class="icon-btn" type="button" data-close-order-details>Close</button></div><section class="modal-section">${emptyState("Order not found", "This Order is no longer available in the loaded store.")}</section></div>`,
      "order-details-panel completion-workspace-panel",
    );
  }

  const reference = displayText(order.orderNumber, "Order reference unavailable");
  const pending = pendingMarkCompletedOrderIds.has(order.id);
  const eligible = canMarkOrderCompleted(order, { completedAt: new Date().toISOString() });
  const completed = order.fulfillmentStatus === ORDER_STATUSES.COMPLETED;
  const eventsAvailable = Array.isArray(store.orderEvents);
  const events = eventsAvailable ? store.orderEvents.filter((event) => event.orderId === order.id) : [];
  const stateCopy = completed
    ? "This Order is permanently completed. Fulfillment history remains read-only."
    : eligible
      ? "Confirm that fulfillment is finished before permanently completing this Order."
      : "Completion is unavailable until the Order has been shipped.";

  return modal(
    `Complete Order: ${escapeText(reference)}`,
    `<div class="completion-workspace">
      <div class="modal-header order-details-header packing-header">
        <button class="icon-btn" type="button" data-back-to-order-details>Back</button>
        <div><h2>Complete Order</h2><p class="mono">${escapeText(reference)}</p></div>
        <button class="icon-btn" type="button" data-close-order-details>Close</button>
      </div>
      <section class="packing-hero" aria-label="Completion workspace summary">
        <div><strong>${escapeText(displayText(order.customerName, "Customer unavailable"))}</strong><span class="pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeText(getOrderStatusLabel(order.fulfillmentStatus))}</span></div>
        <div><span>${escapeText(getFulfillmentMethodLabel(order.fulfillmentMethod))}</span><strong>Shipped ${escapeText(formatCreatedAt(order.shippedAt))}</strong></div>
        <p>${escapeText(stateCopy)}</p>
      </section>
      ${renderCompletionFeedback(order.id)}
      <section class="modal-section">
        <div class="order-details-section-heading"><h3>Finalization</h3><strong>${escapeText(completed ? "Completed" : eligible ? "Ready to complete" : "Not eligible")}</strong></div>
        <p>${escapeText(completed ? "No further fulfillment actions are available." : "Mark Completed is final and cannot be undone from this workspace.")}</p>
      </section>
      ${eligible || pending ? `<div class="packing-start-action completion-submit-action">
        <button class="primary-btn" type="button" data-mark-order-completed ${pending ? "disabled" : ""} ${pending ? 'aria-busy="true"' : ""} aria-label="${escapeText(`${pending ? "Marking Completed" : "Mark Completed"} for ${reference}`)}">${pending ? "Marking Completed..." : "Mark Completed"}</button>
      </div>` : ""}
      <section class="modal-section"><h3>Fulfillment Record</h3><div class="order-detail-grid">
        ${renderDetailValue("Shipped", formatCreatedAt(order.shippedAt))}
        ${renderDetailValue("Completed", formatCreatedAt(order.completedAt))}
        ${renderDetailValue("Courier", order.courier, "Not assigned")}
        ${renderDetailValue("Tracking number", order.trackingNumber, "Not assigned")}
        ${renderLatestEvent(events, eventsAvailable)}
      </div></section>
      <section class="modal-section"><h3>Fulfillment Timeline</h3>${renderOrderTimeline(events, eventsAvailable)}</section>
    </div>`,
    "order-details-panel completion-workspace-panel",
  );
}

function renderPackingItems(order, items, available, reference) {
  if (!available) return `<p class="order-details-unavailable">Order Items are unavailable in the current store.</p>`;
  if (!items.length) return `<p class="order-details-unavailable">No Order Items are recorded for this Order.</p>`;

  return `
    <div class="packing-items">
      ${items.map((item) => {
        const quantity = Number(item.quantity);
        const validQuantity = Number.isSafeInteger(quantity) && quantity > 0;
        const state = packingStateForItem(item);
        const saving = pendingPackingItemIds.has(item.id);
        const markingPacked = pendingMarkPackedOrderIds.has(order.id);
        const interactive = canToggleOrderPackingItem(order, item);
        const checked = state.state === PACKING_ITEM_STATES.CHECKED;
        const itemName = displayText(item.itemName, "Item name unavailable");
        const checkedTimestamp = checked
          ? formatCreatedAt(item.checkedAt)
          : item.packingRequired === true
            ? state.state === PACKING_ITEM_STATES.UNAVAILABLE ? "Unavailable" : "Not checked"
            : "Not applicable";
        const controlLabel = `${checked ? "Uncheck" : "Check"} ${itemName}, quantity ${validQuantity ? quantity : "unavailable"}, for ${reference}`;
        return `
          <article class="packing-item ${saving || markingPacked ? "is-saving" : ""}" ${saving || markingPacked ? 'aria-busy="true"' : ""}>
            <div class="packing-item-main">
              <div>
                <strong>${escapeText(itemName)}</strong>
                <span class="mono">${escapeText(displayText(item.sku, "SKU unavailable"))}</span>
              </div>
              ${interactive ? `
                <label class="packing-check-control">
                  <input type="checkbox" data-packing-item-toggle="${escapeText(item.id)}" ${checked ? "checked" : ""} ${saving || markingPacked ? "disabled" : ""} aria-label="${escapeText(controlLabel)}" />
                  <span>${escapeText(saving ? "Saving..." : markingPacked ? "Finalizing..." : state.label)}</span>
                </label>
              ` : `<span class="pill ${state.className}">${escapeText(state.label)}</span>`}
            </div>
            <div class="packing-item-meta">
              <span>Quantity <strong>${escapeText(validQuantity ? quantity : "Unavailable")}</strong></span>
              <span>Checked <strong>${escapeText(checkedTimestamp)}</strong></span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function packingWarnings(order, items, itemStoreAvailable, summary) {
  const warnings = [];
  if (!itemStoreAvailable) warnings.push("Related Order Items are unavailable in the current store.");
  else if (!items.length) warnings.push("This Order has no related items.");
  if (summary.invalidQuantityCount) warnings.push(`${summary.invalidQuantityCount} ${summary.invalidQuantityCount === 1 ? "item has" : "items have"} a missing or invalid quantity.`);
  if (summary.malformedPackingStateCount) warnings.push(`${summary.malformedPackingStateCount} ${summary.malformedPackingStateCount === 1 ? "item has" : "items have"} an unknown packing-required state.`);
  if (summary.uncheckedRequiredCount) warnings.push(`${summary.uncheckedRequiredCount} required ${summary.uncheckedRequiredCount === 1 ? "item remains" : "items remain"} unchecked.`);
  if (!Object.values(ORDER_STATUSES).includes(String(order.fulfillmentStatus || ""))) warnings.push("The fulfillment status is unknown.");
  if (!Object.values(FULFILLMENT_METHODS).includes(String(order.fulfillmentMethod || ""))) warnings.push("The fulfillment method is unknown.");
  const status = String(order.fulfillmentStatus || "");
  if ([ORDER_STATUSES.PACKED, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.COMPLETED].includes(status)) {
    warnings.push(`This Order is already ${getOrderStatusLabel(status).toLowerCase()}; this workspace remains read-only.`);
  }
  return warnings;
}

function renderLatestEvent(events, available) {
  if (!available) return renderDetailValue("Latest fulfillment event", "", "Unavailable");
  const latest = [...events].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return (Number.isNaN(bTime) ? -1 : bTime) - (Number.isNaN(aTime) ? -1 : aTime);
  })[0];
  if (!latest) return renderDetailValue("Latest fulfillment event", "", "No events recorded");
  const transition = `${latest.fromStatus ? getOrderStatusLabel(latest.fromStatus) : "Order created"} → ${getOrderStatusLabel(latest.toStatus)}`;
  return renderDetailValue("Latest fulfillment event", `${transition} · ${formatCreatedAt(latest.createdAt)}`);
}

export function renderPackingWorkspace(store = {}, orderId = "") {
  const orders = Array.isArray(store.orders) ? store.orders : [];
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) {
    return modal(
      "Packing Workspace",
      `<div class="packing-workspace"><div class="modal-header order-details-header"><button class="icon-btn" type="button" data-back-to-order-details>Back</button><div><h2>Packing Workspace</h2><p>Order reference unavailable</p></div><button class="icon-btn" type="button" data-close-order-details>Close</button></div><section class="modal-section">${emptyState("Order not found", "This Order is no longer available in the loaded store.")}</section></div>`,
      "order-details-panel packing-workspace-panel",
    );
  }

  const itemStoreAvailable = Array.isArray(store.orderItems);
  const eventStoreAvailable = Array.isArray(store.orderEvents);
  const items = itemStoreAvailable ? store.orderItems.filter((item) => item.orderId === order.id) : [];
  const events = eventStoreAvailable ? store.orderEvents.filter((event) => event.orderId === order.id) : [];
  const summary = getPackingWorkspaceState(items, itemStoreAvailable);
  const warnings = packingWarnings(order, items, itemStoreAvailable, summary);
  const reference = displayText(order.orderNumber, "Order reference unavailable");
  const readiness = PACKING_READINESS_LABELS[summary.readiness] || PACKING_READINESS_LABELS[PACKING_READINESS.UNAVAILABLE];
  const methodLabel = getFulfillmentMethodLabel(order.fulfillmentMethod);
  const progressPercent = summary.percent ?? 0;
  const startEligible = canStartOrderPacking(order, items, itemStoreAvailable);
  const startPending = pendingStartOrderIds.has(order.id);
  const markPackedEligible = canMarkOrderPacked(order, items, itemStoreAvailable);
  const markPackedPending = pendingMarkPackedOrderIds.has(order.id);
  const checklistPending = items.some((item) => pendingPackingItemIds.has(item.id));
  const status = String(order.fulfillmentStatus || "");
  const actionCopy = status === ORDER_STATUSES.PACKING
    ? "Checklist changes save to this Order and refresh from the server."
    : startEligible
      ? "Start packing when you are ready to work through the required checklist."
      : status === ORDER_STATUSES.READY_TO_PACK
        ? "Packing cannot start until the required Order Items are available."
        : "Packing actions are unavailable for this Order status.";
  const startAction = startEligible ? `
    <div class="packing-start-action">
      <button class="primary-btn" type="button" data-start-order-packing ${startPending ? "disabled" : ""} aria-label="${escapeText(`${startPending ? "Starting packing" : "Start Packing"} for ${reference}`)}">
        ${startPending ? "Starting packing..." : "Start Packing"}
      </button>
    </div>
  ` : "";
  const markPackedAction = markPackedEligible ? `
    <div class="packing-start-action packing-complete-action">
      <button class="primary-btn" type="button" data-mark-order-packed ${markPackedPending || checklistPending ? "disabled" : ""} ${markPackedPending ? 'aria-busy="true"' : ""} aria-label="${escapeText(`${markPackedPending ? "Marking Packed" : "Mark Packed"} for ${reference}`)}">
        ${markPackedPending ? "Marking Packed..." : "Mark Packed"}
      </button>
    </div>
  ` : "";

  return modal(
    `Packing Workspace: ${escapeText(reference)}`,
    `<div class="packing-workspace">
      <div class="modal-header order-details-header packing-header">
        <button class="icon-btn" type="button" data-back-to-order-details>Back</button>
        <div><h2>Packing Workspace</h2><p class="mono">${escapeText(reference)}</p></div>
        <button class="icon-btn" type="button" data-close-order-details>Close</button>
      </div>
      <section class="packing-hero" aria-label="Packing workspace summary">
        <div><strong>${escapeText(displayText(order.customerName, "Customer unavailable"))}</strong><span class="pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeText(getOrderStatusLabel(order.fulfillmentStatus))}</span></div>
        <div><span>${escapeText(methodLabel)}</span><strong>${escapeText(formatOrderWaitingTime(order.createdAt))}</strong></div>
        <p>${escapeText(actionCopy)}</p>
      </section>
      ${renderPackingFeedback(order.id)}
      ${startAction}
      <section class="modal-section">
        <div class="order-details-section-heading"><h3>Packing Summary</h3><strong>${escapeText(readiness)}</strong></div>
        <div class="packing-summary-grid">
          ${packingMetric("Required items", summary.requiredItems)}
          ${packingMetric("Required quantity", summary.requiredQuantity)}
          ${packingMetric("Checked items", summary.checkedItems)}
          ${packingMetric("Checked quantity", summary.checkedQuantity)}
          ${packingMetric("Remaining items", summary.remainingItems)}
          ${packingMetric("Packing progress", summary.percent === null ? null : `${summary.percent}%`)}
        </div>
        <div class="packing-progress" aria-label="${escapeText(summary.percent === null ? "Packing progress unavailable" : `Packing progress ${summary.percent}%`)}"><span><i style="width: ${progressPercent}%"></i></span></div>
      </section>
      <section class="modal-section"><h3>Packing Items</h3>${renderPackingItems(order, items, itemStoreAvailable, reference)}</section>
      <section class="modal-section packing-readiness"><h3>Packing Readiness</h3><strong>${escapeText(readiness)}</strong><p>Calculated from persisted checklist values after store reconciliation.</p></section>
      ${markPackedAction}
      <section class="modal-section"><h3>Exceptions and Attention</h3>${warnings.length ? `<ul class="packing-warnings">${warnings.map((warning) => `<li>${escapeText(warning)}</li>`).join("")}</ul>` : `<p class="packing-clear">No packing exceptions were detected in the loaded data.</p>`}</section>
      <section class="modal-section"><h3>Order Context</h3><div class="order-detail-grid">
        ${renderDetailValue("Customer contact", order.customerContact, "No contact number")}
        ${renderDetailValue(methodLabel === "Pickup" ? "Pickup address" : "Shipping address", order.shippingAddress, "Address unavailable")}
        ${renderDetailValue("Total paid", formatMoney(order.totalPaid))}
        ${renderDetailValue("Payment confirmed", formatCreatedAt(order.paymentConfirmedAt))}
        ${renderDetailValue("Courier", order.courier, "Not assigned")}
        ${renderDetailValue("Tracking number", order.trackingNumber, "Not assigned")}
        ${renderLatestEvent(events, eventStoreAvailable)}
      </div></section>
      <section class="modal-section"><h3>Fulfillment Timeline</h3>${renderOrderTimeline(events, eventStoreAvailable)}</section>
    </div>`,
    "order-details-panel packing-workspace-panel",
  );
}

export function renderOrderDetailsWorkspace(store = {}, orderId = "") {
  const orders = Array.isArray(store.orders) ? store.orders : [];
  const order = orders.find((entry) => entry.id === orderId);
  const itemStoreAvailable = Array.isArray(store.orderItems);
  const eventStoreAvailable = Array.isArray(store.orderEvents);
  const items = itemStoreAvailable ? store.orderItems.filter((item) => item.orderId === orderId) : [];
  const events = eventStoreAvailable ? store.orderEvents.filter((event) => event.orderId === orderId) : [];

  if (!order) {
    return modal(
      "Order Details",
      `<div class="order-details-workspace">
        <div class="modal-header order-details-header">
          <div><h2>Order Details</h2><p>Order reference unavailable</p></div>
          <button class="icon-btn" type="button" data-close-order-details>Close</button>
        </div>
        <section class="modal-section">${emptyState("Order not found", "This Order is no longer available in the loaded store.")}</section>
      </div>`,
      "order-details-panel",
    );
  }

  const reference = displayText(order.orderNumber, "Order reference unavailable");
  const progress = getOrderChecklistProgress(items);
  const statusLabel = getOrderStatusLabel(order.fulfillmentStatus);
  const methodLabel = getFulfillmentMethodLabel(order.fulfillmentMethod);
  const shippingWorkspaceAvailable = order.fulfillmentMethod !== FULFILLMENT_METHODS.PICKUP
    && [ORDER_STATUSES.PACKED, ORDER_STATUSES.SHIPPED].includes(order.fulfillmentStatus);
  const completionWorkspaceAvailable = [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.COMPLETED].includes(order.fulfillmentStatus);

  return modal(
    `Order Details: ${escapeText(reference)}`,
    `<div class="order-details-workspace">
      <div class="modal-header order-details-header">
        <div>
          <h2>Order Details</h2>
          <p class="mono">${escapeText(reference)}</p>
        </div>
        <button class="icon-btn" type="button" data-close-order-details>Close</button>
      </div>

      <section class="order-details-hero" aria-label="Order summary">
        <div>
          <span class="pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeText(statusLabel)}</span>
          <strong>${escapeText(methodLabel)}</strong>
        </div>
        <div>
          <span>Created ${escapeText(formatCreatedAt(order.createdAt))}</span>
          <strong>${escapeText(formatOrderWaitingTime(order.createdAt))}</strong>
        </div>
      </section>

      <div class="order-details-actions">
        <button class="primary-btn" type="button" data-open-packing-workspace>View Packing Workspace</button>
        ${shippingWorkspaceAvailable ? `<button class="primary-btn" type="button" data-open-shipping-workspace>View Shipping Workspace</button>` : ""}
        ${completionWorkspaceAvailable ? `<button class="primary-btn" type="button" data-open-completion-workspace>View Completion Workspace</button>` : ""}
      </div>

      <section class="modal-section">
        <h3>Customer</h3>
        <div class="order-detail-grid">
          ${renderDetailValue("Name", order.customerName, "Customer unavailable")}
          ${renderDetailValue("Contact", order.customerContact, "No contact number")}
          ${renderDetailValue("Shipping address", order.shippingAddress, methodLabel === "Pickup" ? "Pickup — no shipping address" : "No shipping address")}
        </div>
      </section>

      <section class="modal-section">
        <div class="order-details-section-heading">
          <h3>Items</h3>
          <strong>${escapeText(itemStoreAvailable ? formatItemCount(getOrderItemCount(items)) : "Item count unavailable")}</strong>
        </div>
        ${renderOrderDetailItems(items, itemStoreAvailable)}
        ${itemStoreAvailable ? renderProgress(progress) : ""}
      </section>

      <section class="modal-section">
        <div class="order-details-section-heading">
          <div>
            <h3>Payment Snapshot</h3>
            <p>Immutable values captured when payment was confirmed.</p>
          </div>
          <strong>${escapeText(displayText(order.currency, "PHP"))}</strong>
        </div>
        <div class="order-detail-money-grid">
          ${renderDetailValue("Subtotal", formatMoney(order.subtotal))}
          ${renderDetailValue("Shipping fee", formatMoney(order.shippingFee))}
          ${renderDetailValue("Discount", formatMoney(order.discount))}
          ${renderDetailValue("Total paid", formatMoney(order.totalPaid))}
        </div>
        ${renderDetailValue("Payment confirmed", formatCreatedAt(order.paymentConfirmedAt))}
      </section>

      <section class="modal-section">
        <h3>Fulfillment</h3>
        <div class="order-detail-grid">
          ${renderDetailValue("Packed", formatCreatedAt(order.packedAt))}
          ${renderDetailValue("Shipped", formatCreatedAt(order.shippedAt))}
          ${renderDetailValue("Completed", formatCreatedAt(order.completedAt))}
          ${renderDetailValue("Courier", order.courier, "Not assigned")}
          ${renderDetailValue("Tracking number", order.trackingNumber, "Not assigned")}
          ${renderDetailValue("No-tracking reason", order.trackingNotApplicableReason, "Not applicable")}
          ${renderDetailValue("Shipping note", order.shippingNote, "No shipping note")}
        </div>
      </section>

      <section class="modal-section">
        <h3>Fulfillment Timeline</h3>
        ${renderOrderTimeline(events, eventStoreAvailable)}
      </section>
    </div>`,
    "order-details-panel",
  );
}

function findOrderTrigger(root, orderId) {
  return Array.from(root.querySelectorAll("[data-order-action]"))
    .find((button) => button.dataset.orderAction === orderId) || null;
}

function packingFailureFeedback(error) {
  if (error?.mutationSucceeded) {
    return {
      tone: "recovery",
      message: "The change was saved, but refreshed Order data is unavailable. Refresh the page to confirm it before trying again.",
    };
  }
  return {
    tone: "error",
    message: "Unable to update this Order. Refresh and try again.",
  };
}

function openOrderDetails(root, store, orderId, trigger, notify, refresh, packingActions = defaultPackingActions, initialView = "details") {
  const resuming = activeOrderWorkspace?.orderId === orderId;
  closeOrderDetailsModal?.(false, resuming);
  activeOrderWorkspace = {
    orderId,
    view: initialView,
    focus: resuming ? activeOrderWorkspace?.focus || null : null,
  };
  let backdrop = null;
  const close = (restoreFocus = true, preserveSession = false) => {
    document.removeEventListener("keydown", onKeydown);
    backdrop?.remove();
    if (closeOrderDetailsModal === close) closeOrderDetailsModal = null;
    if (!preserveSession) {
      activeOrderWorkspace = null;
      packingFeedbackByOrder.delete(orderId);
      shippingFeedbackByOrder.delete(orderId);
      completionFeedbackByOrder.delete(orderId);
      shippingDraftByOrder.delete(orderId);
    }
    const focusTarget = trigger?.isConnected ? trigger : findOrderTrigger(root, orderId);
    if (restoreFocus && focusTarget?.isConnected) focusTarget.focus();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(backdrop?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const show = (view, returnFocusTo = "") => {
    if (activeOrderWorkspace?.orderId === orderId) activeOrderWorkspace.view = view;
    backdrop?.remove();
    const html = view === "packing"
      ? renderPackingWorkspace(store, orderId)
      : view === "shipping"
        ? renderShippingWorkspace(store, orderId)
        : view === "completion"
          ? renderCompletionWorkspace(store, orderId)
          : renderOrderDetailsWorkspace(store, orderId);
    root.insertAdjacentHTML("beforeend", html);
    const panel = root.querySelector(".order-details-panel");
    backdrop = panel?.closest(".modal-backdrop") || null;
    if (!panel || !backdrop) return;

    panel.querySelector("[data-close-order-details]")?.addEventListener("click", () => close());
    panel.querySelector("[data-open-packing-workspace]")?.addEventListener("click", () => show("packing"));
    panel.querySelector("[data-open-shipping-workspace]")?.addEventListener("click", () => show("shipping"));
    panel.querySelector("[data-open-completion-workspace]")?.addEventListener("click", () => show("completion"));
    panel.querySelector("[data-back-to-order-details]")?.addEventListener("click", () => show("details", view));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });

    panel.querySelector("[data-start-order-packing]")?.addEventListener("click", async () => {
      const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
      const itemsAvailable = Array.isArray(store.orderItems);
      const items = itemsAvailable ? store.orderItems.filter((item) => item.orderId === orderId) : [];
      if (pendingStartOrderIds.has(orderId) || !canStartOrderPacking(order, items, itemsAvailable)) return;

      pendingStartOrderIds.add(orderId);
      if (activeOrderWorkspace?.orderId === orderId) activeOrderWorkspace.focus = { kind: "start" };
      packingFeedbackByOrder.set(orderId, { tone: "pending", message: "Starting packing..." });
      show("packing");

      try {
        const syncedStore = await packingActions.startOrderPacking(orderId);
        const savedOrder = Array.isArray(syncedStore?.orders)
          ? syncedStore.orders.find((entry) => entry.id === orderId)
          : null;
        if (savedOrder?.fulfillmentStatus !== ORDER_STATUSES.PACKING) {
          packingFeedbackByOrder.set(orderId, {
            tone: "recovery",
            message: "Packing may have started, but the persisted status could not be confirmed. Refresh the page before trying again.",
          });
          notify("Packing status needs confirmation. Refresh the page.", true);
        } else {
          packingFeedbackByOrder.set(orderId, { tone: "success", message: "Packing started. The persisted checklist is now available." });
          notify("Packing started.");
        }
      } catch (error) {
        const feedback = packingFailureFeedback(error);
        packingFeedbackByOrder.set(orderId, feedback);
        notify(feedback.message, true);
      } finally {
        pendingStartOrderIds.delete(orderId);
        if (closeOrderDetailsModal === close && !backdrop?.isConnected) close(false);
        if (activeOrderWorkspace?.orderId !== orderId) packingFeedbackByOrder.delete(orderId);
        refresh();
      }
    });

    panel.querySelector("[data-mark-order-packed]")?.addEventListener("click", async () => {
      const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
      const itemsAvailable = Array.isArray(store.orderItems);
      const items = itemsAvailable ? store.orderItems.filter((item) => item.orderId === orderId) : [];
      const checklistPending = items.some((item) => pendingPackingItemIds.has(item.id));
      if (pendingMarkPackedOrderIds.has(orderId) || checklistPending || !canMarkOrderPacked(order, items, itemsAvailable)) return;

      const previousEventIds = new Set(
        (Array.isArray(store.orderEvents) ? store.orderEvents : [])
          .filter((event) => event.orderId === orderId)
          .map((event) => event.id),
      );
      pendingMarkPackedOrderIds.add(orderId);
      if (activeOrderWorkspace?.orderId === orderId) activeOrderWorkspace.focus = { kind: "mark-packed" };
      packingFeedbackByOrder.set(orderId, { tone: "pending", message: "Marking this Order Packed..." });
      show("packing");

      try {
        const syncedStore = await packingActions.markOrderPacked(orderId);
        const savedOrder = Array.isArray(syncedStore?.orders)
          ? syncedStore.orders.find((entry) => entry.id === orderId)
          : null;
        const newPackedEvents = Array.isArray(syncedStore?.orderEvents)
          ? syncedStore.orderEvents.filter((event) => (
            event.orderId === orderId
            && event.fromStatus === ORDER_STATUSES.PACKING
            && event.toStatus === ORDER_STATUSES.PACKED
            && !previousEventIds.has(event.id)
          ))
          : [];
        const packedAt = new Date(savedOrder?.packedAt || "");
        if (savedOrder?.fulfillmentStatus !== ORDER_STATUSES.PACKED
          || Number.isNaN(packedAt.getTime())
          || newPackedEvents.length !== 1) {
          packingFeedbackByOrder.set(orderId, {
            tone: "recovery",
            message: "The Packed transition may have saved, but the persisted lifecycle state could not be confirmed. Refresh the page before trying again.",
          });
          notify("Packed status needs confirmation. Refresh the page.", true);
        } else {
          packingFeedbackByOrder.set(orderId, { tone: "success", message: "Order marked Packed and confirmed." });
          notify("Order marked Packed.");
        }
      } catch (error) {
        const feedback = packingFailureFeedback(error);
        packingFeedbackByOrder.set(orderId, feedback);
        notify(feedback.message, true);
      } finally {
        pendingMarkPackedOrderIds.delete(orderId);
        if (closeOrderDetailsModal === close && !backdrop?.isConnected) close(false);
        if (activeOrderWorkspace?.orderId !== orderId) packingFeedbackByOrder.delete(orderId);
        refresh();
      }
    });

    const syncShippingFormState = () => {
      const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
      const form = panel.querySelector("[data-shipping-form]");
      if (!order || !form) return;
      const draft = {
        courier: form.querySelector('[data-shipping-field="courier"]')?.value || "",
        trackingNumber: form.querySelector('[data-shipping-field="trackingNumber"]')?.value || "",
        shippingNote: form.querySelector('[data-shipping-field="shippingNote"]')?.value || "",
      };
      shippingDraftByOrder.set(orderId, draft);
      const input = { ...draft, shippedAt: new Date().toISOString() };
      const errors = validateOrderShipping(order, input);
      const ready = canMarkOrderShipped(order, input);
      const markButton = panel.querySelector("[data-mark-order-shipped]");
      if (markButton && !pendingMarkShippedOrderIds.has(orderId)) {
        markButton.hidden = !ready;
        markButton.disabled = !ready;
      }
      const readiness = ready ? "Ready to ship" : "Shipping information required";
      const readinessLabel = panel.querySelector("[data-shipping-readiness]");
      const readinessCopy = panel.querySelector("[data-shipping-readiness-copy]");
      if (readinessLabel) readinessLabel.textContent = readiness;
      if (readinessCopy) readinessCopy.textContent = `${readiness}. Courier and tracking number are required.`;
      const courierError = panel.querySelector('[data-shipping-error="courier"]');
      const trackingError = panel.querySelector('[data-shipping-error="tracking"]');
      if (courierError) courierError.textContent = errors.courier || "";
      if (trackingError) trackingError.textContent = errors.tracking || "";
    };

    panel.querySelectorAll("[data-shipping-field]").forEach((field) => {
      field.addEventListener("input", syncShippingFormState);
    });

    panel.querySelector("[data-mark-order-shipped]")?.addEventListener("click", async () => {
      const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
      const draft = shippingDraftByOrder.get(orderId) || shippingDraft(order || {});
      const input = {
        courier: String(draft.courier || "").trim(),
        trackingNumber: String(draft.trackingNumber || "").trim(),
        noTrackingReason: "",
        shippedAt: new Date().toISOString(),
        shippingNote: String(draft.shippingNote || "").trim(),
      };
      if (pendingMarkShippedOrderIds.has(orderId) || !canMarkOrderShipped(order, input)) {
        syncShippingFormState();
        return;
      }

      const previousEventIds = new Set(
        (Array.isArray(store.orderEvents) ? store.orderEvents : [])
          .filter((event) => event.orderId === orderId)
          .map((event) => event.id),
      );
      pendingMarkShippedOrderIds.add(orderId);
      if (activeOrderWorkspace?.orderId === orderId) activeOrderWorkspace.focus = { kind: "mark-shipped" };
      shippingFeedbackByOrder.set(orderId, { tone: "pending", message: "Marking this Order Shipped..." });
      show("shipping");

      try {
        const syncedStore = await packingActions.markOrderShipped(orderId, input);
        const savedOrder = Array.isArray(syncedStore?.orders)
          ? syncedStore.orders.find((entry) => entry.id === orderId)
          : null;
        const newShippedEvents = Array.isArray(syncedStore?.orderEvents)
          ? syncedStore.orderEvents.filter((event) => (
            event.orderId === orderId
            && event.fromStatus === ORDER_STATUSES.PACKED
            && event.toStatus === ORDER_STATUSES.SHIPPED
            && !previousEventIds.has(event.id)
          ))
          : [];
        const shippedAt = new Date(savedOrder?.shippedAt || "");
        const persisted = savedOrder?.fulfillmentStatus === ORDER_STATUSES.SHIPPED
          && !Number.isNaN(shippedAt.getTime())
          && String(savedOrder?.courier || "").trim() === input.courier
          && String(savedOrder?.trackingNumber || "").trim() === input.trackingNumber
          && String(savedOrder?.shippingNote || "").trim() === input.shippingNote
          && newShippedEvents.length === 1;
        if (!persisted) {
          shippingFeedbackByOrder.set(orderId, {
            tone: "recovery",
            message: "The Shipped transition may have saved, but the persisted shipment could not be confirmed. Refresh the page before trying again.",
          });
          notify("Shipped status needs confirmation. Refresh the page.", true);
        } else {
          shippingDraftByOrder.set(orderId, {
            courier: savedOrder.courier,
            trackingNumber: savedOrder.trackingNumber,
            shippingNote: savedOrder.shippingNote,
          });
          shippingFeedbackByOrder.set(orderId, { tone: "success", message: "Order marked Shipped and confirmed." });
          notify("Order marked Shipped.");
        }
      } catch (error) {
        const feedback = packingFailureFeedback(error);
        shippingFeedbackByOrder.set(orderId, feedback);
        notify(feedback.message, true);
      } finally {
        pendingMarkShippedOrderIds.delete(orderId);
        if (closeOrderDetailsModal === close && !backdrop?.isConnected) close(false);
        if (activeOrderWorkspace?.orderId !== orderId) shippingFeedbackByOrder.delete(orderId);
        refresh();
      }
    });

    panel.querySelector("[data-mark-order-completed]")?.addEventListener("click", async () => {
      const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
      const input = { completedAt: new Date().toISOString(), note: "" };
      if (pendingMarkCompletedOrderIds.has(orderId) || !canMarkOrderCompleted(order, input)) return;

      const previousEventIds = new Set(
        (Array.isArray(store.orderEvents) ? store.orderEvents : [])
          .filter((event) => event.orderId === orderId)
          .map((event) => event.id),
      );
      pendingMarkCompletedOrderIds.add(orderId);
      if (activeOrderWorkspace?.orderId === orderId) activeOrderWorkspace.focus = { kind: "mark-completed" };
      completionFeedbackByOrder.set(orderId, { tone: "pending", message: "Marking this Order Completed..." });
      show("completion");

      try {
        const syncedStore = await packingActions.markOrderCompleted(orderId, input);
        const savedOrder = Array.isArray(syncedStore?.orders)
          ? syncedStore.orders.find((entry) => entry.id === orderId)
          : null;
        const newCompletedEvents = Array.isArray(syncedStore?.orderEvents)
          ? syncedStore.orderEvents.filter((event) => (
            event.orderId === orderId
            && event.fromStatus === ORDER_STATUSES.SHIPPED
            && event.toStatus === ORDER_STATUSES.COMPLETED
            && !previousEventIds.has(event.id)
          ))
          : [];
        const completedAt = new Date(savedOrder?.completedAt || "");
        const persisted = savedOrder?.fulfillmentStatus === ORDER_STATUSES.COMPLETED
          && !Number.isNaN(completedAt.getTime())
          && newCompletedEvents.length === 1;
        if (!persisted) {
          completionFeedbackByOrder.set(orderId, {
            tone: "recovery",
            message: "The Completed transition may have saved, but the persisted lifecycle state could not be confirmed. Refresh the page before trying again.",
          });
          notify("Completed status needs confirmation. Refresh the page.", true);
        } else {
          completionFeedbackByOrder.set(orderId, { tone: "success", message: "Order marked Completed and confirmed." });
          notify("Order marked Completed.");
        }
      } catch (error) {
        const feedback = packingFailureFeedback(error);
        completionFeedbackByOrder.set(orderId, feedback);
        notify(feedback.message, true);
      } finally {
        pendingMarkCompletedOrderIds.delete(orderId);
        if (closeOrderDetailsModal === close && !backdrop?.isConnected) close(false);
        if (activeOrderWorkspace?.orderId !== orderId) completionFeedbackByOrder.delete(orderId);
        refresh();
      }
    });

    panel.querySelectorAll("[data-packing-item-toggle]").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const itemId = checkbox.dataset.packingItemToggle;
        const order = Array.isArray(store.orders) ? store.orders.find((entry) => entry.id === orderId) : null;
        const item = Array.isArray(store.orderItems) ? store.orderItems.find((entry) => entry.id === itemId) : null;
        if (pendingMarkPackedOrderIds.has(orderId) || pendingPackingItemIds.has(itemId) || !canToggleOrderPackingItem(order, item)) {
          show("packing");
          return;
        }

        const checked = checkbox.checked;
        pendingPackingItemIds.add(itemId);
        if (activeOrderWorkspace?.orderId === orderId) activeOrderWorkspace.focus = { kind: "item", itemId };
        packingFeedbackByOrder.set(orderId, { tone: "pending", message: "Saving checklist item..." });
        show("packing");

        try {
          const syncedStore = await packingActions.setOrderItemPacked(orderId, itemId, checked);
          const savedOrder = Array.isArray(syncedStore?.orders)
            ? syncedStore.orders.find((entry) => entry.id === orderId)
            : null;
          const savedItem = Array.isArray(syncedStore?.orderItems)
            ? syncedStore.orderItems.find((entry) => entry.id === itemId && entry.orderId === orderId)
            : null;
          const persistedChecked = getPackingItemState(savedItem) === PACKING_ITEM_STATES.CHECKED;
          if (savedOrder?.fulfillmentStatus !== ORDER_STATUSES.PACKING || !savedItem || persistedChecked !== checked) {
            packingFeedbackByOrder.set(orderId, {
              tone: "recovery",
              message: "The checklist change may have saved, but the persisted state could not be confirmed. Refresh the page before trying again.",
            });
            notify("Checklist state needs confirmation. Refresh the page.", true);
          } else {
            packingFeedbackByOrder.set(orderId, { tone: "success", message: "Checklist item saved and confirmed." });
            notify("Checklist item saved.");
          }
        } catch (error) {
          const feedback = packingFailureFeedback(error);
          packingFeedbackByOrder.set(orderId, feedback);
          notify(feedback.message, true);
        } finally {
          pendingPackingItemIds.delete(itemId);
          if (closeOrderDetailsModal === close && !backdrop?.isConnected) close(false);
          if (activeOrderWorkspace?.orderId !== orderId) packingFeedbackByOrder.delete(orderId);
          refresh();
        }
      });
    });

    const rememberedFocus = activeOrderWorkspace?.orderId === orderId ? activeOrderWorkspace.focus : null;
    const rememberedItem = rememberedFocus?.kind === "item"
      ? Array.from(panel.querySelectorAll("[data-packing-item-toggle]")).find((control) => control.dataset.packingItemToggle === rememberedFocus.itemId)
      : null;
    const initialFocus = rememberedItem
      || (rememberedFocus?.kind === "start" ? panel.querySelector("[data-start-order-packing]") || panel.querySelector("[data-packing-item-toggle]") : null)
      || (rememberedFocus?.kind === "mark-packed" ? panel.querySelector("[data-mark-order-packed]") || panel.querySelector("[data-back-to-order-details]") : null)
      || (rememberedFocus?.kind === "mark-shipped" ? panel.querySelector("[data-mark-order-shipped]") || panel.querySelector("[data-back-to-order-details]") : null)
      || (rememberedFocus?.kind === "mark-completed" ? panel.querySelector("[data-mark-order-completed]") || panel.querySelector("[data-back-to-order-details]") : null)
      || (returnFocusTo === "packing"
        ? panel.querySelector("[data-open-packing-workspace]")
        : returnFocusTo === "shipping"
          ? panel.querySelector("[data-open-shipping-workspace]")
          : returnFocusTo === "completion"
            ? panel.querySelector("[data-open-completion-workspace]")
            : ["packing", "shipping", "completion"].includes(view)
              ? panel.querySelector("[data-back-to-order-details]")
              : panel.querySelector("[data-close-order-details]"));
    initialFocus?.focus();
  };

  document.addEventListener("keydown", onKeydown);
  closeOrderDetailsModal = close;
  show(initialView);
}

function emptyOrdersState(allOrders, visibleOrders) {
  if (visibleOrders.length) return "";
  if (!allOrders.length) return emptyState("No Orders yet", "Paid Payment Requests will appear here as fulfillment Orders.");
  if (searchTerm.trim()) return emptyState("No search results", "Try a different order number, customer, item, courier, or tracking number.");
  if (statusFilter === ORDER_QUEUE_FILTERS.NEEDS_ACTION) {
    return emptyState("No active Orders", "There are no Orders waiting to be packed or shipped.");
  }
  if (statusFilter !== ORDER_QUEUE_FILTERS.ALL) {
    return emptyState("No Orders in this status", "Choose another status or view all Orders.");
  }
  return emptyState("No matching Orders", "Clear a filter to see more Orders.");
}

function renderOrderResults(store) {
  const allOrders = Array.isArray(store.orders) ? store.orders : [];
  const allItems = Array.isArray(store.orderItems) ? store.orderItems : [];
  const visibleOrders = sortOrders(filterOrders(allOrders, allItems, {
    search: searchTerm,
    status: statusFilter,
    method: methodFilter,
    metricFilter,
  }), sortMode);

  const rows = visibleOrders.map((order) => {
    const items = itemsForOrder(store, order.id);
    const progress = getOrderChecklistProgress(items);
    const itemCount = getOrderItemCount(items);
    const orderReference = displayText(order.orderNumber, "Order reference unavailable");
    return `
      <tr>
        <td><strong class="mono">${escapeText(orderReference)}</strong><span>${escapeText(formatCreatedAt(order.createdAt))}</span></td>
        <td><strong>${escapeText(displayText(order.customerName, "Customer unavailable"))}</strong><span>${escapeText(displayText(order.customerContact, "No contact number"))}</span></td>
        <td><strong>${escapeText(formatItemCount(itemCount))}</strong><span>${escapeText(itemPreview(items))}</span></td>
        <td>${escapeText(getFulfillmentMethodLabel(order.fulfillmentMethod))}</td>
        <td>${renderProgress(progress)}</td>
        <td><span class="pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeText(getOrderStatusLabel(order.fulfillmentStatus))}</span></td>
        <td><strong>${escapeText(formatOrderWaitingTime(order.createdAt))}</strong></td>
        <td>${renderAction(order)}</td>
      </tr>
    `;
  }).join("");

  const cards = visibleOrders.map((order) => {
    const items = itemsForOrder(store, order.id);
    const progress = getOrderChecklistProgress(items);
    const itemCount = getOrderItemCount(items);
    const orderReference = displayText(order.orderNumber, "Order reference unavailable");
    return `
      <article class="record-card order-card">
        <div class="record-card-head">
          <div>
            <strong class="mono">${escapeText(orderReference)}</strong>
            <span>${escapeText(displayText(order.customerName, "Customer unavailable"))}</span>
          </div>
          <strong class="order-waiting">${escapeText(formatOrderWaitingTime(order.createdAt))}</strong>
        </div>
        <span class="pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeText(getOrderStatusLabel(order.fulfillmentStatus))}</span>
        <div class="record-grid">
          <div><span>Items</span><strong>${escapeText(formatItemCount(itemCount))}</strong></div>
          <div><span>Method</span><strong>${escapeText(getFulfillmentMethodLabel(order.fulfillmentMethod))}</strong></div>
        </div>
        ${renderProgress(progress)}
        <div class="record-actions">${renderAction(order)}</div>
      </article>
    `;
  }).join("");

  return `
    <div class="panel table-panel orders-results" data-orders-results="true">
      ${visibleOrders.length ? `
        <div class="mobile-records">${cards}</div>
        <div class="table-wrap desktop-table">
          <table class="orders-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Method</th><th>Progress</th><th>Status</th><th>Waiting</th><th>Next Action</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : emptyOrdersState(allOrders, visibleOrders)}
    </div>
  `;
}

function metricCard(label, value, status, metric = "") {
  const active = statusFilter === status && metricFilter === metric;
  return `
    <button class="metric-card metric-nav order-metric ${active ? "focus" : ""}" type="button" data-order-metric-status="${status}" data-order-metric-filter="${metric}" aria-pressed="${active}" aria-label="${escapeText(`${label}: ${value}. Filter Orders`)}">
      <span>${escapeText(label)}</span><strong>${value}</strong>
    </button>
  `;
}

export function renderOrdersPage(store = {}) {
  if (store.ordersLoading) {
    return `${pageHeader("Orders", "Pack, ship, and complete paid customer orders.")}<div class="panel orders-system-state" aria-busy="true">${emptyState("Loading Orders", "Your fulfillment queue is being synchronized.")}</div>`;
  }
  if (store.ordersLoadFailed) {
    return `${pageHeader("Orders", "Pack, ship, and complete paid customer orders.")}<div class="panel orders-system-state">${emptyState("Orders could not be loaded", "Refresh the app and try again.")}</div>`;
  }

  const orders = Array.isArray(store.orders) ? store.orders : [];
  const metrics = getOrderQueueMetrics(orders);

  return `
    ${pageHeader("Orders", "Pack, ship, and complete paid customer orders.")}
    <div class="metric-grid order-metric-grid">
      ${metricCard("Ready to Pack", metrics.readyToPack, ORDER_STATUSES.READY_TO_PACK)}
      ${metricCard("Packing", metrics.packing, ORDER_STATUSES.PACKING)}
      ${metricCard("Packed", metrics.packed, ORDER_STATUSES.PACKED)}
      ${metricCard("Shipped Today", metrics.shippedToday, ORDER_QUEUE_FILTERS.ALL, "shipped_today")}
      ${metricCard("Completed Today", metrics.completedToday, ORDER_QUEUE_FILTERS.ALL, "completed_today")}
    </div>
    <div class="toolbar orders-toolbar">
      <label class="search-field">Search Orders<input id="orders-search" value="${escapeText(searchTerm)}" placeholder="Search Orders..." /></label>
      <label>Status<select id="orders-status-filter">
        <option value="needs_action" ${statusFilter === ORDER_QUEUE_FILTERS.NEEDS_ACTION ? "selected" : ""}>Needs Action</option>
        <option value="all" ${statusFilter === ORDER_QUEUE_FILTERS.ALL ? "selected" : ""}>All Statuses</option>
        ${Object.values(ORDER_STATUSES).map((status) => `<option value="${status}" ${statusFilter === status ? "selected" : ""}>${getOrderStatusLabel(status)}</option>`).join("")}
      </select></label>
      <label>Fulfillment<select id="orders-method-filter">
        <option value="all" ${methodFilter === ORDER_QUEUE_FILTERS.ALL ? "selected" : ""}>All Methods</option>
        ${Object.values(FULFILLMENT_METHODS).map((method) => `<option value="${method}" ${methodFilter === method ? "selected" : ""}>${getFulfillmentMethodLabel(method)}</option>`).join("")}
      </select></label>
      <label>Sort<select id="orders-sort">
        <option value="priority" ${sortMode === ORDER_SORTS.PRIORITY ? "selected" : ""}>Needs attention</option>
        <option value="oldest" ${sortMode === ORDER_SORTS.OLDEST ? "selected" : ""}>Oldest first</option>
        <option value="newest" ${sortMode === ORDER_SORTS.NEWEST ? "selected" : ""}>Newest first</option>
        <option value="customer" ${sortMode === ORDER_SORTS.CUSTOMER ? "selected" : ""}>Customer name</option>
        <option value="status" ${sortMode === ORDER_SORTS.STATUS ? "selected" : ""}>Status</option>
      </select></label>
    </div>
    ${renderOrderResults(store)}
  `;
}

export function bindOrdersPage(root, store, notify, refresh, packingActions = defaultPackingActions) {
  const bindOrderActions = () => {
    root.querySelectorAll("[data-order-action]").forEach((button) => {
      button.addEventListener("click", () => openOrderDetails(root, store, button.dataset.orderAction, button, notify, refresh, packingActions));
    });
  };

  root.querySelector("#orders-search")?.addEventListener("input", (event) => {
    searchTerm = event.target.value;
    const results = root.querySelector("[data-orders-results]");
    if (results) {
      results.outerHTML = renderOrderResults(store);
      bindOrderActions();
    }
  });

  root.querySelector("#orders-status-filter")?.addEventListener("change", (event) => {
    statusFilter = event.target.value;
    metricFilter = "";
    refresh();
  });
  root.querySelector("#orders-method-filter")?.addEventListener("change", (event) => {
    methodFilter = event.target.value;
    refresh();
  });
  root.querySelector("#orders-sort")?.addEventListener("change", (event) => {
    sortMode = event.target.value;
    refresh();
  });

  root.querySelectorAll("[data-order-metric-status]").forEach((button) => {
    button.addEventListener("click", () => {
      statusFilter = button.dataset.orderMetricStatus;
      metricFilter = button.dataset.orderMetricFilter || "";
      sortMode = ORDER_SORTS.PRIORITY;
      refresh();
    });
  });

  bindOrderActions();

  if (activeOrderWorkspace) {
    const { orderId, view } = activeOrderWorkspace;
    openOrderDetails(root, store, orderId, findOrderTrigger(root, orderId), notify, refresh, packingActions, view);
  }
}
