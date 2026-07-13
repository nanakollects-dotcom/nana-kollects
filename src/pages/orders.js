import { emptyState, pageHeader } from "../components/ui.js";
import {
  filterOrders,
  formatOrderWaitingTime,
  FULFILLMENT_METHODS,
  getFulfillmentMethodLabel,
  getOrderChecklistProgress,
  getOrderItemCount,
  getOrderNextActionLabel,
  getOrderProgressLabel,
  getOrderQueueMetrics,
  getOrderStatusClass,
  getOrderStatusLabel,
  ORDER_QUEUE_FILTERS,
  ORDER_SORTS,
  ORDER_STATUSES,
  sortOrders,
} from "../core/orders.js";

let searchTerm = "";
let statusFilter = ORDER_QUEUE_FILTERS.NEEDS_ACTION;
let methodFilter = ORDER_QUEUE_FILTERS.ALL;
let sortMode = ORDER_SORTS.PRIORITY;
let metricFilter = "";

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
  const label = getOrderNextActionLabel(order);
  return `<button class="table-action primary-action order-next-action" type="button" data-order-action="${escapeText(order.id || "unknown-order")}" aria-label="${escapeText(`${label} for ${displayText(order.orderNumber, "order with unavailable reference")}`)}">${escapeText(label)}</button>`;
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
      button.addEventListener("click", () => notify("Order Details will be added next."));
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
