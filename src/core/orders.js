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

export function normalizeOrderStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isOrderStatus(normalized) ? normalized : "";
}

export function normalizeFulfillmentMethod(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return Object.values(FULFILLMENT_METHODS).includes(normalized) ? normalized : "";
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
  const safeItems = Array.isArray(items) ? items : [];
  const shapeKnown = safeItems.length > 0 && safeItems.every((item) => {
    const quantity = Number(item.quantity);
    return typeof item.packingRequired === "boolean"
      && Number.isSafeInteger(quantity)
      && quantity > 0;
  });
  const requiredItems = shapeKnown ? safeItems.filter((item) => item.packingRequired) : [];
  const total = shapeKnown ? requiredItems.reduce((sum, item) => sum + Number(item.quantity), 0) : null;
  const checked = shapeKnown
    ? requiredItems.filter((item) => Boolean(item.checkedAt)).reduce((sum, item) => sum + Number(item.quantity), 0)
    : null;

  return {
    checked,
    total,
    remaining: shapeKnown ? Math.max(total - checked, 0) : null,
    complete: shapeKnown && total > 0 && checked === total,
    percent: shapeKnown && total ? Math.round((checked / total) * 100) : 0,
    available: shapeKnown,
  };
}

export function getOrderProgressLabel(progress = {}) {
  if (!progress.available) return "Packing progress unavailable";
  if (!progress.total) return "No packing items";
  return `${progress.checked} of ${progress.total} packed`;
}

export const PACKING_READINESS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  READY: "ready",
  NOT_REQUIRED: "not_required",
  UNAVAILABLE: "unavailable",
};

export const PACKING_ITEM_STATES = {
  UNCHECKED: "unchecked",
  CHECKED: "checked",
  NOT_REQUIRED: "not_required",
  UNAVAILABLE: "unavailable",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderEntityId(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

export function getPackingItemState(item = {}) {
  if (typeof item.packingRequired !== "boolean") return PACKING_ITEM_STATES.UNAVAILABLE;
  if (item.packingRequired === false) return PACKING_ITEM_STATES.NOT_REQUIRED;

  const hasCheckedAt = Boolean(String(item.checkedAt || "").trim());
  const hasCheckedBy = Boolean(String(item.checkedBy || "").trim());
  if (hasCheckedAt !== hasCheckedBy) return PACKING_ITEM_STATES.UNAVAILABLE;
  return hasCheckedAt ? PACKING_ITEM_STATES.CHECKED : PACKING_ITEM_STATES.UNCHECKED;
}

export function canStartOrderPacking(order, items, collectionAvailable = Array.isArray(items)) {
  if (!order || !isOrderEntityId(order.id)) return false;
  if (normalizeOrderStatus(order.fulfillmentStatus) !== ORDER_STATUSES.READY_TO_PACK) return false;
  if (!collectionAvailable || !Array.isArray(items)) return false;
  return items.some((item) => item?.orderId === order.id && item?.packingRequired === true);
}

export function canToggleOrderPackingItem(order, item) {
  if (!order || !item) return false;
  if (!isOrderEntityId(order.id) || !isOrderEntityId(item.id)) return false;
  if (normalizeOrderStatus(order.fulfillmentStatus) !== ORDER_STATUSES.PACKING) return false;
  if (item.orderId !== order.id || item.packingRequired !== true) return false;
  return getPackingItemState(item) !== PACKING_ITEM_STATES.UNAVAILABLE;
}

export function getPackingWorkspaceState(items, collectionAvailable = Array.isArray(items)) {
  if (!collectionAvailable || !Array.isArray(items)) {
    return {
      available: false,
      requiredItems: null,
      requiredQuantity: null,
      checkedItems: null,
      checkedQuantity: null,
      remainingItems: null,
      percent: null,
      readiness: PACKING_READINESS.UNAVAILABLE,
      invalidQuantityCount: 0,
      malformedPackingStateCount: 0,
      uncheckedRequiredCount: 0,
    };
  }

  const required = items.filter((item) => item?.packingRequired === true);
  const invalidQuantityCount = items.filter((item) => {
    const quantity = Number(item?.quantity);
    return !Number.isSafeInteger(quantity) || quantity <= 0;
  }).length;
  const malformedPackingStateCount = items.filter((item) => (
    typeof item?.packingRequired !== "boolean"
    || getPackingItemState(item) === PACKING_ITEM_STATES.UNAVAILABLE
  )).length;
  const checked = required.filter((item) => getPackingItemState(item) === PACKING_ITEM_STATES.CHECKED);
  const quantitiesAvailable = required.every((item) => {
    const quantity = Number(item.quantity);
    return Number.isSafeInteger(quantity) && quantity > 0;
  });
  const requiredQuantity = quantitiesAvailable
    ? required.reduce((sum, item) => sum + Number(item.quantity), 0)
    : null;
  const checkedQuantity = quantitiesAvailable
    ? checked.reduce((sum, item) => sum + Number(item.quantity), 0)
    : null;
  const shapeAvailable = items.length > 0 && malformedPackingStateCount === 0;
  const noPackingRequired = shapeAvailable && required.length === 0;
  const readiness = !shapeAvailable || !quantitiesAvailable
    ? PACKING_READINESS.UNAVAILABLE
    : noPackingRequired
      ? PACKING_READINESS.NOT_REQUIRED
      : checked.length === 0
        ? PACKING_READINESS.NOT_STARTED
        : checked.length === required.length
          ? PACKING_READINESS.READY
          : PACKING_READINESS.IN_PROGRESS;

  return {
    available: shapeAvailable && quantitiesAvailable,
    requiredItems: shapeAvailable ? required.length : null,
    requiredQuantity,
    checkedItems: shapeAvailable ? checked.length : null,
    checkedQuantity,
    remainingItems: shapeAvailable ? Math.max(required.length - checked.length, 0) : null,
    percent: quantitiesAvailable && requiredQuantity
      ? Math.round((checkedQuantity / requiredQuantity) * 100)
      : noPackingRequired
        ? 100
        : null,
    readiness,
    invalidQuantityCount,
    malformedPackingStateCount,
    uncheckedRequiredCount: required.length - checked.length,
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
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isSameLocalDay(value, comparison = new Date()) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  if (comparison === null || comparison === undefined || String(comparison).trim() === "") return false;
  const date = new Date(value);
  const comparisonDate = comparison instanceof Date ? comparison : new Date(comparison);
  if (Number.isNaN(date.getTime()) || Number.isNaN(comparisonDate.getTime())) return false;
  return date.getFullYear() === comparisonDate.getFullYear()
    && date.getMonth() === comparisonDate.getMonth()
    && date.getDate() === comparisonDate.getDate();
}

export function orderNeedsAction(order = {}) {
  return NEEDS_ACTION_STATUSES.includes(normalizeOrderStatus(order.fulfillmentStatus));
}

export function getOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[normalizeOrderStatus(status)] || "Status unavailable";
}

export function getOrderStatusClass(status) {
  return ORDER_STATUS_CLASSES[normalizeOrderStatus(status)] || "gray-pill";
}

export function getFulfillmentMethodLabel(method) {
  return FULFILLMENT_METHOD_LABELS[normalizeFulfillmentMethod(method)] || "Method unavailable";
}

export function getOrderNextActionLabel(order = {}) {
  const status = normalizeOrderStatus(order.fulfillmentStatus);
  const method = normalizeFulfillmentMethod(order.fulfillmentMethod);
  if (status === ORDER_STATUSES.READY_TO_PACK) return "Start Packing";
  if (status === ORDER_STATUSES.PACKING) return "Continue Packing";
  if (status === ORDER_STATUSES.PACKED) {
    if (method === FULFILLMENT_METHODS.PICKUP) return "Complete Handoff";
    if ([FULFILLMENT_METHODS.SHIPMENT, FULFILLMENT_METHODS.LOCAL_DELIVERY].includes(method)) return "Mark as Shipped";
    return "View Order";
  }
  if (status === ORDER_STATUSES.SHIPPED) return "Mark Completed";
  return "View Order";
}

export function formatOrderWaitingTime(createdAt, now = new Date()) {
  const createdTimestamp = timestamp(createdAt);
  const nowTimestamp = timestamp(now);
  if (createdTimestamp === null || nowTimestamp === null) return "Waiting unavailable";
  const elapsed = Math.max(nowTimestamp - createdTimestamp, 0);
  const hours = Math.floor(elapsed / (60 * 60 * 1000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function getOrderItemCount(items = []) {
  if (!Array.isArray(items) || !items.length) return null;
  const quantities = items.map((item) => Number(item.quantity));
  if (quantities.some((quantity) => !Number.isSafeInteger(quantity) || quantity <= 0)) return null;
  return quantities.reduce((total, quantity) => total + quantity, 0);
}

export function getOrderQueueMetrics(orders = [], now = new Date()) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  return {
    readyToPack: safeOrders.filter((order) => normalizeOrderStatus(order.fulfillmentStatus) === ORDER_STATUSES.READY_TO_PACK).length,
    packing: safeOrders.filter((order) => normalizeOrderStatus(order.fulfillmentStatus) === ORDER_STATUSES.PACKING).length,
    packed: safeOrders.filter((order) => normalizeOrderStatus(order.fulfillmentStatus) === ORDER_STATUSES.PACKED).length,
    shippedToday: safeOrders.filter((order) => isSameLocalDay(order.shippedAt, now)).length,
    completedToday: safeOrders.filter((order) => isSameLocalDay(order.completedAt, now)).length,
  };
}

export function filterOrders(orders = [], orderItems = [], options = {}) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeItems = Array.isArray(orderItems) ? orderItems : [];
  const search = String(options.search || "").trim().toLowerCase();
  const status = options.status || ORDER_QUEUE_FILTERS.NEEDS_ACTION;
  const method = options.method || ORDER_QUEUE_FILTERS.ALL;
  const itemTextByOrder = new Map();

  for (const item of safeItems) {
    const current = itemTextByOrder.get(item.orderId) || "";
    itemTextByOrder.set(item.orderId, `${current} ${item.itemName || ""} ${item.sku || ""}`.toLowerCase());
  }

  return safeOrders.filter((order) => {
    const searchable = [
      order.orderNumber,
      order.customerName,
      order.customerContact,
      order.courier,
      order.trackingNumber,
      itemTextByOrder.get(order.id),
    ].join(" ").toLowerCase();
    const createdAt = timestamp(order.createdAt);
    const startDate = timestamp(options.startDate);
    const endDate = timestamp(options.endDate);
    const matchesPeriod = startDate === null && endDate === null
      ? true
      : createdAt !== null && (startDate === null || createdAt >= startDate) && (endDate === null || createdAt <= endDate);
    const normalizedStatus = normalizeOrderStatus(order.fulfillmentStatus);
    const normalizedMethod = normalizeFulfillmentMethod(order.fulfillmentMethod);
    const matchesStatus = status === ORDER_QUEUE_FILTERS.ALL
      || (status === ORDER_QUEUE_FILTERS.NEEDS_ACTION ? orderNeedsAction(order) : normalizedStatus === normalizeOrderStatus(status));
    const matchesMethod = method === ORDER_QUEUE_FILTERS.ALL || normalizedMethod === normalizeFulfillmentMethod(method);
    const matchesMetric = options.metricFilter === "shipped_today"
      ? isSameLocalDay(order.shippedAt, options.now || new Date())
      : options.metricFilter === "completed_today"
        ? isSameLocalDay(order.completedAt, options.now || new Date())
        : true;

    return (!search || searchable.includes(search)) && matchesStatus && matchesMethod && matchesPeriod && matchesMetric;
  });
}

export function sortOrders(orders = [], sort = ORDER_SORTS.PRIORITY) {
  const byIdentity = (a, b) => String(a.orderNumber || a.id || "").localeCompare(String(b.orderNumber || b.id || ""), undefined, { numeric: true, sensitivity: "base" });
  const byDate = (a, b, direction) => {
    const aTimestamp = timestamp(a.createdAt);
    const bTimestamp = timestamp(b.createdAt);
    if (aTimestamp === null && bTimestamp === null) return byIdentity(a, b);
    if (aTimestamp === null) return 1;
    if (bTimestamp === null) return -1;
    return direction * (aTimestamp - bTimestamp) || byIdentity(a, b);
  };
  const byCreated = (a, b) => byDate(a, b, 1);
  const byNewest = (a, b) => byDate(a, b, -1);
  const copy = Array.isArray(orders) ? orders.slice() : [];

  if (sort === ORDER_SORTS.OLDEST) return copy.sort(byCreated);
  if (sort === ORDER_SORTS.NEWEST) return copy.sort(byNewest);
  if (sort === ORDER_SORTS.CUSTOMER) {
    return copy.sort((a, b) => {
      const aName = String(a.customerName || "").trim();
      const bName = String(b.customerName || "").trim();
      if (!aName && !bName) return byCreated(a, b);
      if (!aName) return 1;
      if (!bName) return -1;
      return aName.localeCompare(bName, undefined, { sensitivity: "base" }) || byCreated(a, b);
    });
  }
  if (sort === ORDER_SORTS.STATUS) {
    return copy.sort((a, b) => (STATUS_PRIORITY[normalizeOrderStatus(a.fulfillmentStatus)] ?? 99) - (STATUS_PRIORITY[normalizeOrderStatus(b.fulfillmentStatus)] ?? 99) || byCreated(a, b));
  }

  return copy.sort((a, b) => {
    const aNeedsAction = orderNeedsAction(a);
    const bNeedsAction = orderNeedsAction(b);
    if (aNeedsAction !== bNeedsAction) return aNeedsAction ? -1 : 1;
    if (aNeedsAction) return (STATUS_PRIORITY[normalizeOrderStatus(a.fulfillmentStatus)] ?? 99) - (STATUS_PRIORITY[normalizeOrderStatus(b.fulfillmentStatus)] ?? 99) || byCreated(a, b);
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
