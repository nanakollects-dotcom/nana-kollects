export const ORDER_STATUSES = {
  READY_TO_PACK: "ready_to_pack",
  PACKING: "packing",
  PACKED: "packed",
  SHIPPED: "shipped",
  COMPLETED: "completed",
};

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUSES.READY_TO_PACK]: "Ready to Pack",
  [ORDER_STATUSES.PACKING]: "Packing",
  [ORDER_STATUSES.PACKED]: "Packed",
  [ORDER_STATUSES.SHIPPED]: "Shipped",
  [ORDER_STATUSES.COMPLETED]: "Completed",
};

export const ORDER_STATUS_CLASSES = {
  [ORDER_STATUSES.READY_TO_PACK]: "yellow-pill",
  [ORDER_STATUSES.PACKING]: "info-pill",
  [ORDER_STATUSES.PACKED]: "green-pill",
  [ORDER_STATUSES.SHIPPED]: "gray-pill",
  [ORDER_STATUSES.COMPLETED]: "muted-pill",
};

export const ORDER_SOURCE_TYPES = {
  PAYMENT_REQUEST: "payment_request",
};

export const FULFILLMENT_METHODS = {
  SHIPMENT: "shipment",
  LOCAL_DELIVERY: "local_delivery",
  PICKUP: "pickup",
};

export const FULFILLMENT_METHOD_LABELS = {
  [FULFILLMENT_METHODS.SHIPMENT]: "Shipment",
  [FULFILLMENT_METHODS.LOCAL_DELIVERY]: "Local Delivery",
  [FULFILLMENT_METHODS.PICKUP]: "Pickup",
};

export const ORDER_QUEUE_FILTERS = {
  ALL: "all",
  NEEDS_ACTION: "needs_action",
};

export const ORDER_SORTS = {
  PRIORITY: "priority",
  OLDEST: "oldest",
  NEWEST: "newest",
  CUSTOMER: "customer",
  STATUS: "status",
};

export const ORDER_CURRENCY = "PHP";

export function isOrderStatus(value) {
  return Object.values(ORDER_STATUSES).includes(value);
}

export const ORDER_VALIDATION_MESSAGES = {
  ORDER_NOT_FOUND: "Order not found.",
  ITEM_NOT_FOUND: "Order Item not found.",
  CHECKLIST_INCOMPLETE: "Check every required Order Item before continuing.",
  REOPEN_BEFORE_EDITING: "Reopen the Packed Order before changing its checklist.",
  SHIPPING_ADDRESS_REQUIRED: "Shipping address is required before shipping.",
  COURIER_REQUIRED: "Courier is required before shipping.",
  TRACKING_REQUIRED: "Enter a tracking number or an explicit no-tracking reason.",
  PICKUP_CANNOT_SHIP: "Pickup Orders cannot be marked Shipped.",
  COMPLETED_IS_FINAL: "Completed Orders cannot be changed.",
};

export function canTransitionOrder(fromStatus, toStatus, fulfillmentMethod = FULFILLMENT_METHODS.SHIPMENT) {
  if (fromStatus === toStatus) return true;
  if (fromStatus === ORDER_STATUSES.READY_TO_PACK) return toStatus === ORDER_STATUSES.PACKING;
  if (fromStatus === ORDER_STATUSES.PACKING) {
    return [ORDER_STATUSES.READY_TO_PACK, ORDER_STATUSES.PACKED].includes(toStatus);
  }
  if (fromStatus === ORDER_STATUSES.PACKED) {
    if (toStatus === ORDER_STATUSES.PACKING) return true;
    if (fulfillmentMethod === FULFILLMENT_METHODS.PICKUP) return toStatus === ORDER_STATUSES.COMPLETED;
    return toStatus === ORDER_STATUSES.SHIPPED;
  }
  if (fromStatus === ORDER_STATUSES.SHIPPED) {
    return fulfillmentMethod !== FULFILLMENT_METHODS.PICKUP && toStatus === ORDER_STATUSES.COMPLETED;
  }
  return false;
}

export function getOrderChecklistProgress(items = []) {
  const requiredItems = items.filter((item) => item.packingRequired !== false);
  const checked = requiredItems.filter((item) => Boolean(item.checkedAt)).length;
  const total = requiredItems.length;

  return {
    checked,
    total,
    remaining: Math.max(total - checked, 0),
    complete: total > 0 && checked === total,
    percent: total ? Math.round((checked / total) * 100) : 0,
  };
}

const NEEDS_ACTION_STATUSES = [
  ORDER_STATUSES.READY_TO_PACK,
  ORDER_STATUSES.PACKING,
  ORDER_STATUSES.PACKED,
];

const STATUS_PRIORITY = {
  [ORDER_STATUSES.READY_TO_PACK]: 0,
  [ORDER_STATUSES.PACKING]: 1,
  [ORDER_STATUSES.PACKED]: 2,
  [ORDER_STATUSES.SHIPPED]: 3,
  [ORDER_STATUSES.COMPLETED]: 4,
};

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSameLocalDay(value, comparison = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === comparison.getFullYear()
    && date.getMonth() === comparison.getMonth()
    && date.getDate() === comparison.getDate();
}

export function orderNeedsAction(order = {}) {
  return NEEDS_ACTION_STATUSES.includes(order.fulfillmentStatus);
}

export function getOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || "Unknown";
}

export function getOrderStatusClass(status) {
  return ORDER_STATUS_CLASSES[status] || "gray-pill";
}

export function getFulfillmentMethodLabel(method) {
  return FULFILLMENT_METHOD_LABELS[method] || "Unknown";
}

export function getOrderNextActionLabel(order = {}) {
  if (order.fulfillmentStatus === ORDER_STATUSES.READY_TO_PACK) return "Start Packing";
  if (order.fulfillmentStatus === ORDER_STATUSES.PACKING) return "Continue Packing";
  if (order.fulfillmentStatus === ORDER_STATUSES.PACKED) {
    return order.fulfillmentMethod === FULFILLMENT_METHODS.PICKUP ? "Complete Handoff" : "Mark as Shipped";
  }
  if (order.fulfillmentStatus === ORDER_STATUSES.SHIPPED) return "Mark Completed";
  return "View Order";
}

export function formatOrderWaitingTime(createdAt, now = new Date()) {
  const elapsed = Math.max(now.getTime() - timestamp(createdAt), 0);
  const hours = Math.floor(elapsed / (60 * 60 * 1000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function getOrderItemCount(items = []) {
  return items.reduce((total, item) => total + Math.max(Number(item.quantity) || 1, 1), 0);
}

export function getOrderQueueMetrics(orders = [], now = new Date()) {
  return {
    readyToPack: orders.filter((order) => order.fulfillmentStatus === ORDER_STATUSES.READY_TO_PACK).length,
    packing: orders.filter((order) => order.fulfillmentStatus === ORDER_STATUSES.PACKING).length,
    packed: orders.filter((order) => order.fulfillmentStatus === ORDER_STATUSES.PACKED).length,
    shippedToday: orders.filter((order) => isSameLocalDay(order.shippedAt, now)).length,
    completedToday: orders.filter((order) => isSameLocalDay(order.completedAt, now)).length,
  };
}

export function filterOrders(orders = [], orderItems = [], options = {}) {
  const search = String(options.search || "").trim().toLowerCase();
  const status = options.status || ORDER_QUEUE_FILTERS.NEEDS_ACTION;
  const method = options.method || ORDER_QUEUE_FILTERS.ALL;
  const itemTextByOrder = new Map();

  for (const item of orderItems) {
    const current = itemTextByOrder.get(item.orderId) || "";
    itemTextByOrder.set(item.orderId, `${current} ${item.itemName || ""} ${item.sku || ""}`.toLowerCase());
  }

  return orders.filter((order) => {
    const searchable = [
      order.orderNumber,
      order.customerName,
      order.customerContact,
      order.courier,
      order.trackingNumber,
      itemTextByOrder.get(order.id),
    ].join(" ").toLowerCase();
    const createdAt = timestamp(order.createdAt);
    const matchesPeriod = (!options.startDate || createdAt >= timestamp(options.startDate))
      && (!options.endDate || createdAt <= timestamp(options.endDate));
    const matchesStatus = status === ORDER_QUEUE_FILTERS.ALL
      || (status === ORDER_QUEUE_FILTERS.NEEDS_ACTION ? orderNeedsAction(order) : order.fulfillmentStatus === status);
    const matchesMethod = method === ORDER_QUEUE_FILTERS.ALL || order.fulfillmentMethod === method;
    const matchesMetric = options.metricFilter === "shipped_today"
      ? isSameLocalDay(order.shippedAt, options.now || new Date())
      : options.metricFilter === "completed_today"
        ? isSameLocalDay(order.completedAt, options.now || new Date())
        : true;

    return (!search || searchable.includes(search)) && matchesStatus && matchesMethod && matchesPeriod && matchesMetric;
  });
}

export function sortOrders(orders = [], sort = ORDER_SORTS.PRIORITY) {
  const byCreated = (a, b) => timestamp(a.createdAt) - timestamp(b.createdAt);
  const byNewest = (a, b) => timestamp(b.createdAt) - timestamp(a.createdAt);
  const copy = orders.slice();

  if (sort === ORDER_SORTS.OLDEST) return copy.sort(byCreated);
  if (sort === ORDER_SORTS.NEWEST) return copy.sort(byNewest);
  if (sort === ORDER_SORTS.CUSTOMER) {
    return copy.sort((a, b) => String(a.customerName || "").localeCompare(String(b.customerName || ""), undefined, { sensitivity: "base" }) || byCreated(a, b));
  }
  if (sort === ORDER_SORTS.STATUS) {
    return copy.sort((a, b) => (STATUS_PRIORITY[a.fulfillmentStatus] ?? 99) - (STATUS_PRIORITY[b.fulfillmentStatus] ?? 99) || byCreated(a, b));
  }

  return copy.sort((a, b) => {
    const aNeedsAction = orderNeedsAction(a);
    const bNeedsAction = orderNeedsAction(b);
    if (aNeedsAction !== bNeedsAction) return aNeedsAction ? -1 : 1;
    if (aNeedsAction) return (STATUS_PRIORITY[a.fulfillmentStatus] ?? 99) - (STATUS_PRIORITY[b.fulfillmentStatus] ?? 99) || byCreated(a, b);
    return byNewest(a, b);
  });
}

export function validateOrderShipping(order = {}, input = {}) {
  const errors = {};
  const trackingNumber = String(input.trackingNumber || "").trim();
  const noTrackingReason = String(input.noTrackingReason || "").trim();

  if (order.fulfillmentMethod === FULFILLMENT_METHODS.PICKUP) {
    errors.fulfillmentMethod = ORDER_VALIDATION_MESSAGES.PICKUP_CANNOT_SHIP;
  }
  if (!String(order.shippingAddress || "").trim()) {
    errors.shippingAddress = ORDER_VALIDATION_MESSAGES.SHIPPING_ADDRESS_REQUIRED;
  }
  if (!String(input.courier || "").trim()) errors.courier = ORDER_VALIDATION_MESSAGES.COURIER_REQUIRED;
  if (!input.shippedAt) errors.shippedAt = "Shipped date and time are required.";
  if (!trackingNumber && !noTrackingReason) errors.tracking = ORDER_VALIDATION_MESSAGES.TRACKING_REQUIRED;
  if (trackingNumber && noTrackingReason) errors.tracking = "Use either tracking or a no-tracking reason, not both.";

  return errors;
}
