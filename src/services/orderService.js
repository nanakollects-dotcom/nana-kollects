import { supabase } from "./supabaseClient.js";
import { FULFILLMENT_METHODS, isOrderStatus, ORDER_STATUSES } from "../core/orders.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

async function resolveUserId(userId) {
  if (userId) return userId;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user?.id) throw new Error("No authenticated user found.");
  return data.user.id;
}

function normalizeOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    sourceType: row.source_type,
    sourcePaymentRequestId: row.source_payment_request_id,
    customerName: row.customer_name,
    customerContact: row.customer_contact || "",
    shippingAddress: row.shipping_address || "",
    fulfillmentMethod: Object.values(FULFILLMENT_METHODS).includes(row.fulfillment_method)
      ? row.fulfillment_method
      : FULFILLMENT_METHODS.SHIPMENT,
    fulfillmentStatus: isOrderStatus(row.fulfillment_status)
      ? row.fulfillment_status
      : ORDER_STATUSES.READY_TO_PACK,
    currency: row.currency,
    subtotal: money(row.subtotal_snapshot),
    shippingFee: money(row.shipping_fee_snapshot),
    discount: money(row.discount_snapshot),
    totalPaid: money(row.total_paid_snapshot),
    paymentConfirmedAt: row.payment_confirmed_at,
    courier: row.courier || "",
    trackingNumber: row.tracking_number || "",
    trackingNotApplicableReason: row.tracking_not_applicable_reason || "",
    shippingNote: row.shipping_note || "",
    packedAt: row.packed_at,
    shippedAt: row.shipped_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeOrderItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    saleId: row.sale_id,
    itemId: row.inventory_item_id,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    sellingPrice: money(row.selling_price_snapshot),
    quantity: Number(row.quantity),
    packingRequired: row.packing_required,
    checkedAt: row.checked_at,
    checkedBy: row.checked_by,
    createdAt: row.created_at,
  };
}

function normalizeOrderEvent(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    note: row.note || "",
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

export async function loadSupabaseOrders(userId) {
  const ownerId = await resolveUserId(userId);
  const [ordersResult, itemsResult, eventsResult] = await Promise.all([
    supabase.from("orders").select("*").eq("user_id", ownerId).order("created_at", { ascending: false }),
    supabase.from("order_items").select("*").eq("user_id", ownerId).order("created_at", { ascending: true }),
    supabase.from("order_fulfillment_events").select("*").eq("user_id", ownerId).order("created_at", { ascending: true }),
  ]);

  const failed = [ordersResult, itemsResult, eventsResult].find((result) => result.error);
  if (failed) throw failed.error;

  return {
    orders: (ordersResult.data || []).map(normalizeOrder),
    orderItems: (itemsResult.data || []).map(normalizeOrderItem),
    orderEvents: (eventsResult.data || []).map(normalizeOrderEvent),
  };
}
