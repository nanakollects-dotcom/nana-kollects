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
  PICKUP: "pickup",
};

export const ORDER_CURRENCY = "PHP";

export function isOrderStatus(value) {
  return Object.values(ORDER_STATUSES).includes(value);
}
