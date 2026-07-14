import { supabase } from "./supabaseClient.js";
import { normalizeFulfillmentMethod, normalizeOrderStatus } from "../core/orders.js";

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
    orderNumber: row.order_number || "",
    sourceType: row.source_type,
    sourcePaymentRequestId: row.source_payment_request_id,
    customerName: row.customer_name || "",
    customerContact: row.customer_contact || "",
    shippingAddress: row.shipping_address || "",
    fulfillmentMethod: normalizeFulfillmentMethod(row.fulfillment_method),
    fulfillmentStatus: normalizeOrderStatus(row.fulfillment_status),
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
    quantity: Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0 ? Number(row.quantity) : null,
    packingRequired: typeof row.packing_required === "boolean" ? row.packing_required : null,
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

async function runOrderRpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

export function startSupabaseOrderPacking(orderId) {
  return runOrderRpc("start_order_packing", { p_order_id: orderId });
}

export function setSupabaseOrderItemPacked(orderId, orderItemId, checked) {
  return runOrderRpc("set_order_item_packed", {
    p_order_id: orderId,
    p_order_item_id: orderItemId,
    p_checked: typeof checked === "boolean" ? checked : null,
  });
}

export function markSupabaseOrderPacked(orderId) {
  return runOrderRpc("mark_order_packed", { p_order_id: orderId });
}

export function reopenSupabaseOrderPacking(orderId) {
  return runOrderRpc("reopen_order_packing", { p_order_id: orderId });
}

export function markSupabaseOrderShipped(orderId, input = {}) {
  return runOrderRpc("mark_order_shipped", {
    p_order_id: orderId,
    p_courier: String(input.courier || "").trim(),
    p_tracking_number: String(input.trackingNumber || "").trim(),
    p_no_tracking_reason: String(input.noTrackingReason || "").trim(),
    p_shipped_at: input.shippedAt || null,
    p_shipping_note: String(input.shippingNote || "").trim(),
  });
}

export function markSupabaseOrderCompleted(orderId, input = {}) {
  return runOrderRpc("mark_order_completed", {
    p_order_id: orderId,
    p_completed_at: input.completedAt || null,
    p_note: String(input.note || "").trim(),
  });
}
