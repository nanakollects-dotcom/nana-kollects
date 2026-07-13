import { emptyState, modal, pageHeader } from "../components/ui.js";
import { formatMoney } from "../components/format.js";
import {
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
  ORDER_QUEUE_FILTERS,
  ORDER_SORTS,
  ORDER_STATUSES,
  PACKING_READINESS,
  sortOrders,
} from "../core/orders.js";

let searchTerm = "";
let statusFilter = ORDER_QUEUE_FILTERS.NEEDS_ACTION;
let methodFilter = ORDER_QUEUE_FILTERS.ALL;
let sortMode = ORDER_SORTS.PRIORITY;
let metricFilter = "";
let closeOrderDetailsModal = null;

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
  if (item?.packingRequired === false) return { label: "No packing required", className: "muted-pill" };
  if (item?.packingRequired !== true) return { label: "Packing state unknown", className: "gray-pill" };
  if (item.checkedAt) return { label: "Checked", className: "green-pill" };
  return { label: "Not checked", className: "yellow-pill" };
}

function renderPackingItems(items, available) {
  if (!available) return `<p class="order-details-unavailable">Order Items are unavailable in the current store.</p>`;
  if (!items.length) return `<p class="order-details-unavailable">No Order Items are recorded for this Order.</p>`;

  return `
    <div class="packing-items">
      ${items.map((item) => {
        const quantity = Number(item.quantity);
        const validQuantity = Number.isSafeInteger(quantity) && quantity > 0;
        const state = packingStateForItem(item);
        const checkedTimestamp = item.checkedAt
          ? formatCreatedAt(item.checkedAt)
          : item.packingRequired === true
            ? "Not checked"
            : "Not applicable";
        return `
          <article class="packing-item">
            <div class="packing-item-main">
              <div>
                <strong>${escapeText(displayText(item.itemName, "Item name unavailable"))}</strong>
                <span class="mono">${escapeText(displayText(item.sku, "SKU unavailable"))}</span>
              </div>
              <span class="pill ${state.className}">${escapeText(state.label)}</span>
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
        <p>Packing actions are not yet enabled. This workspace is read-only.</p>
      </section>
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
      <section class="modal-section"><h3>Packing Items</h3>${renderPackingItems(items, itemStoreAvailable)}</section>
      <section class="modal-section packing-readiness"><h3>Packing Readiness</h3><strong>${escapeText(readiness)}</strong><p>Derived from the currently loaded Order Item snapshots. No Order status has been changed.</p></section>
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

function openOrderDetails(root, store, orderId, trigger) {
  closeOrderDetailsModal?.(false);
  let backdrop = null;
  const close = (restoreFocus = true) => {
    document.removeEventListener("keydown", onKeydown);
    backdrop?.remove();
    closeOrderDetailsModal = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(backdrop?.querySelectorAll("button:not([disabled])") || []);
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

  const show = (view, returnFocusToPackingButton = false) => {
    backdrop?.remove();
    const html = view === "packing"
      ? renderPackingWorkspace(store, orderId)
      : renderOrderDetailsWorkspace(store, orderId);
    root.insertAdjacentHTML("beforeend", html);
    const panel = root.querySelector(".order-details-panel");
    backdrop = panel?.closest(".modal-backdrop") || null;
    if (!panel || !backdrop) return;

    panel.querySelector("[data-close-order-details]")?.addEventListener("click", () => close());
    panel.querySelector("[data-open-packing-workspace]")?.addEventListener("click", () => show("packing"));
    panel.querySelector("[data-back-to-order-details]")?.addEventListener("click", () => show("details", true));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });

    const initialFocus = returnFocusToPackingButton
      ? panel.querySelector("[data-open-packing-workspace]")
      : view === "packing"
        ? panel.querySelector("[data-back-to-order-details]")
        : panel.querySelector("[data-close-order-details]");
    initialFocus?.focus();
  };

  document.addEventListener("keydown", onKeydown);
  closeOrderDetailsModal = close;
  show("details");
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

export function bindOrdersPage(root, store, notify, refresh) {
  const bindOrderActions = () => {
    root.querySelectorAll("[data-order-action]").forEach((button) => {
      button.addEventListener("click", () => openOrderDetails(root, store, button.dataset.orderAction, button));
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
}
