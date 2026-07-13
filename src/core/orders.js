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

export const ORDER_SOURCE_TYPES = {
  PAYMENT_REQUEST: "payment_request",
};

export const FULFILLMENT_METHODS = {
  SHIPMENT: "shipment",
  LOCAL_DELIVERY: "local_delivery",
  PICKUP: "pickup",
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
