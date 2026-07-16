const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const numberOrNull = (value) => value === null || value === undefined ? null : money(value);
const textCompare = (first, second) => String(first || "").localeCompare(String(second || ""));

function uniqueSorted(rows, keyFor) {
  const sorted = rows.slice().sort((first, second) =>
    textCompare(first.inventoryItemId, second.inventoryItemId) || textCompare(first.id, second.id));
  const seen = new Set();
  return sorted.filter((row) => {
    const key = keyFor(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
    return groups;
  }, new Map());
}

export function normalizePaymentRequestItemRows(rows = []) {
  const mapped = rows.map((row) => ({
    id: row.id,
    paymentRequestId: row.payment_request_id ?? row.paymentRequestId,
    inventoryItemId: row.inventory_item_id ?? row.inventoryItemId,
    sku: row.sku_snapshot ?? row.sku ?? "",
    itemName: row.item_name_snapshot ?? row.itemName ?? "",
    unitPrice: money(row.unit_price_snapshot ?? row.unitPrice),
    quantity: Number(row.quantity || 1),
    lineTotal: money(row.line_total_snapshot ?? row.lineTotal ?? row.unit_price_snapshot ?? row.unitPrice),
    createdAt: row.created_at ?? row.createdAt ?? null,
  }));
  return uniqueSorted(mapped, (row) => `${row.paymentRequestId}|${row.inventoryItemId}`);
}

export function normalizePaymentRequests(headers = [], childRows = [], reservationRows = []) {
  const itemsByRequest = groupBy(normalizePaymentRequestItemRows(childRows), "paymentRequestId");
  const reservationsByRequest = groupBy(reservationRows.map((row) => ({
    id: row.id,
    paymentRequestId: row.payment_request_id ?? row.paymentRequestId,
    inventoryItemId: row.inventory_item_id ?? row.inventoryItemId,
    createdAt: row.created_at ?? row.createdAt ?? null,
  })), "paymentRequestId");

  return headers.map((request) => {
    let items = itemsByRequest.get(request.id) || [];
    if (!items.length && request.inventory_item_id) {
      items = [{
        id: `legacy:${request.id}:${request.inventory_item_id}`,
        paymentRequestId: request.id,
        inventoryItemId: request.inventory_item_id,
        sku: request.sku_snapshot || "",
        itemName: request.item_name_snapshot || "",
        unitPrice: money(request.item_price),
        quantity: 1,
        lineTotal: money(request.item_price),
        createdAt: request.created_at || null,
        legacyFallback: true,
      }];
    }
    const reservations = reservationsByRequest.get(request.id) || [];
    const merchandiseSubtotal = money(
      request.merchandise_subtotal_snapshot ?? items.reduce((sum, item) => sum + item.lineTotal, 0) ?? request.item_price,
    );
    const firstItem = items[0] || null;

    return {
      id: request.id,
      requestNumber: request.request_number,
      customerName: request.customer_name,
      customerContact: request.customer_contact,
      shippingAddress: request.shipping_address || "",
      items,
      merchandiseSubtotal,
      discount: money(request.discount_snapshot ?? request.discount),
      shippingFee: money(request.shipping_fee_snapshot ?? request.shipping_fee),
      totalAmount: money(request.total_amount),
      shippingMode: request.shipping_mode,
      courier: request.courier || "",
      status: request.status,
      reservationState: request.status === "Pending"
        ? reservations.length === items.length && items.length ? "reserved" : "incomplete"
        : "released",
      reservationItemIds: reservations.map((reservation) => reservation.inventoryItemId),
      issuedAt: request.issued_at,
      paidAt: request.paid_at || null,
      cancelledAt: request.cancelled_at || null,
      validUntil: request.valid_until,
      customerNote: request.customer_note || "",
      paymentConfig: request.payment_config_snapshot || {},
      paymentMethod: request.payment_method || "",
      createdAt: request.created_at,
      updatedAt: request.updated_at,
      // Temporary one-item compatibility fields for the unchanged UI and documents.
      itemId: firstItem?.inventoryItemId || request.inventory_item_id || "",
      itemName: firstItem?.itemName || request.item_name_snapshot || "",
      itemPrice: merchandiseSubtotal,
    };
  });
}

export function paymentRequestIncludesItem(request, inventoryItemId) {
  if (!request || !inventoryItemId) return false;
  return (request.items || []).some((item) => item.inventoryItemId === inventoryItemId)
    || request.itemId === inventoryItemId;
}

export function normalizeSaleItemRows(rows = [], collectionIdFor = (value) => value || "") {
  const mapped = rows.map((row) => ({
    id: row.id,
    saleId: row.sale_id ?? row.saleId,
    inventoryItemId: row.inventory_item_id ?? row.inventoryItemId,
    collectionId: collectionIdFor(row.collection_id ?? row.collectionId),
    sku: row.sku_snapshot ?? row.sku ?? "",
    itemName: row.item_name_snapshot ?? row.itemName ?? "",
    unitCost: numberOrNull(row.unit_cost_snapshot ?? row.unitCost),
    unitPrice: money(row.unit_price_snapshot ?? row.unitPrice),
    quantity: Number(row.quantity || 1),
    lineSubtotal: money(row.line_subtotal_snapshot ?? row.lineSubtotal ?? row.unit_price_snapshot ?? row.unitPrice),
    allocatedDiscount: money(row.allocated_discount_snapshot ?? row.allocatedDiscount),
    netItemRevenue: money(row.net_item_revenue_snapshot ?? row.netItemRevenue),
    profit: numberOrNull(row.profit_snapshot ?? row.profit),
    createdAt: row.created_at ?? row.createdAt ?? null,
  }));
  return uniqueSorted(mapped, (row) => `${row.saleId}|${row.inventoryItemId}`);
}

export function normalizeSaleHeaders(headers = [], childRows = [], collectionIdFor = (value) => value || "") {
  const itemsBySale = groupBy(normalizeSaleItemRows(childRows, collectionIdFor), "saleId");
  return headers.map((sale) => {
    let items = itemsBySale.get(sale.id) || [];
    if (!items.length && sale.inventory_item_id) {
      const unitPrice = money(sale.sale_price);
      const unitCost = numberOrNull(sale.cost_snapshot);
      items = [{
        id: `legacy:${sale.id}:${sale.inventory_item_id}`,
        saleId: sale.id,
        inventoryItemId: sale.inventory_item_id,
        collectionId: collectionIdFor(sale.collection_id),
        sku: sale.sku_snapshot || "",
        itemName: sale.item_name_snapshot || "",
        unitCost,
        unitPrice,
        quantity: 1,
        lineSubtotal: unitPrice,
        allocatedDiscount: 0,
        netItemRevenue: unitPrice,
        profit: numberOrNull(sale.profit_snapshot),
        createdAt: sale.created_at || null,
        legacyFallback: true,
      }];
    }
    const merchandiseSubtotal = money(sale.merchandise_subtotal_snapshot ?? sale.sale_price);
    const discount = money(sale.discount_snapshot);
    const shippingCollected = money(sale.shipping_fee_snapshot);
    const merchandiseRevenue = money(sale.sale_price ?? merchandiseSubtotal - discount);
    const aggregateCogs = numberOrNull(sale.aggregate_cogs_snapshot ?? sale.cost_snapshot);
    const aggregateProfit = numberOrNull(sale.aggregate_profit_snapshot ?? sale.profit_snapshot);
    const firstItem = items[0] || null;

    return {
      id: sale.id,
      sourcePaymentRequestId: sale.source_payment_request_id || null,
      customerName: sale.customer_name_snapshot || "",
      customerContact: sale.customer_contact_snapshot || "",
      shippingAddress: sale.shipping_address_snapshot || "",
      items,
      merchandiseSubtotal,
      discount,
      shippingCollected,
      totalPaid: money(sale.total_paid_snapshot ?? sale.sale_price),
      aggregateCogs,
      aggregateProfit,
      merchandiseRevenue,
      paymentMethod: sale.payment_method_snapshot || "",
      paymentStatus: sale.payment_status,
      platform: sale.platform,
      date: sale.sale_timestamp || sale.sale_date,
      notes: sale.notes || "",
      voidedAt: sale.voided_at,
      createdAt: sale.created_at,
      updatedAt: sale.updated_at,
      // Legacy-compatible first-item fields; canonical calculations use header snapshots.
      itemId: firstItem?.inventoryItemId || sale.inventory_item_id || "",
      collectionId: firstItem?.collectionId || collectionIdFor(sale.collection_id),
      sku: firstItem?.sku || sale.sku_snapshot || "",
      itemName: firstItem?.itemName || sale.item_name_snapshot || "",
      cost: aggregateCogs,
      price: merchandiseRevenue,
      profit: aggregateProfit,
    };
  });
}

export function deriveLegacySales(saleHeaders = []) {
  return saleHeaders.flatMap((sale) => sale.items.map((item) => ({
    id: sale.id,
    saleHeaderId: sale.id,
    sourcePaymentRequestId: sale.sourcePaymentRequestId,
    itemId: item.inventoryItemId,
    collectionId: item.collectionId,
    sku: item.sku,
    itemName: item.itemName,
    cost: item.unitCost,
    price: item.netItemRevenue,
    profit: item.profit,
    platform: sale.platform,
    paymentStatus: sale.paymentStatus,
    date: sale.date,
    notes: sale.notes,
    voidedAt: sale.voidedAt,
    headerTotalPaid: sale.totalPaid,
  })));
}
