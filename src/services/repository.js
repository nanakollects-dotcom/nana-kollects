import { getAuthenticatedStoreGeneration, loadStore, replaceStore } from "./storage.js";
import { createSafeUserError, getSafeErrorCategory, getSafeUserError, logSafeError, SafeUserError } from "./errorService.js";
import {
  loadSupabaseOrders,
  markSupabaseOrderCompleted,
  markSupabaseOrderPacked,
  markSupabaseOrderShipped,
  reopenSupabaseOrderPacking,
  setSupabaseOrderItemPacked,
  startSupabaseOrderPacking,
} from "./orderService.js";

import {
  loadSupabaseStore,
  createSupabaseCollection,
  updateSupabaseCollection,
  archiveSupabaseCollection,
  deleteSupabaseCollection,
  createSupabaseInventoryItem,
  updateSupabaseInventoryItem,
  changeSupabaseInventoryStatus,
  deleteSupabaseInventoryItem,
  updateSupabaseSale,
  createSupabaseExpense,
  updateSupabaseExpense,
  deleteSupabaseExpense,
  createSupabaseCapitalEntry,
  updateSupabaseCapitalEntry,
  replaceSupabaseStoreFromBackup,
  saveSupabasePaymentConfig,
  createSupabasePaymentRequest,
  markSupabasePaymentRequestPaid,
  cancelSupabasePaymentRequest,
} from "./supabaseStorage.js";

export const STATUSES = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  SOLD: "Sold",
  WRITTEN_OFF: "Written Off",
  ARCHIVED: "Archived",
};

export const PAYMENT_STATUSES = {
  PAID: "Paid",
  PENDING: "Pending",
};

export const CAPITAL_TYPES = {
  ADDED: "Capital Added",
  WITHDRAWAL: "Withdrawal",
};

export const EXPENSE_CATEGORIES = [
  "Packaging",
  "Shipping",
  "Marketing",
  "Supplies",
  "Write-Off",
  "Operating",
  "Other",
];

export const PLATFORMS = [
  "Facebook",
  "Instagram",
  "TikTok",
  "Direct Customer",
  "Walk-in",
  "Other",
];

export function getStore() {
  return loadStore();
}

export async function getSupabaseStore() {
  return loadSupabaseStore();
}

export async function getSupabaseOrders() {
  return runRepositoryOperation(() => loadSupabaseOrders());
}

async function runOrderOperation(operation) {
  try {
    await operation();
  } catch (error) {
    logSafeError("order_mutation", error);
    throw createSafeUserError(error, "order_mutation");
  }

  try {
    return await syncSupabaseStore();
  } catch (error) {
    logSafeError("order_refresh", error);
    const recoveryError = new SafeUserError(
      getSafeUserError(null, "order_refresh"),
      getSafeErrorCategory(error),
    );
    recoveryError.mutationSucceeded = true;
    throw recoveryError;
  }
}

async function runPaymentRequestOperation(operation, refreshFailureMessage) {
  let mutationResult;
  try {
    mutationResult = await operation();
  } catch (error) {
    logSafeError("payment_request_mutation", error);
    throw createSafeUserError(error, "payment_request");
  }

  try {
    return { mutationResult, store: await syncSupabaseStore() };
  } catch (error) {
    logSafeError("payment_request_refresh", error);
    const recoveryError = new SafeUserError(refreshFailureMessage, getSafeErrorCategory(error));
    recoveryError.mutationSucceeded = true;
    throw recoveryError;
  }
}

export function startOrderPacking(orderId) {
  return runOrderOperation(() => startSupabaseOrderPacking(orderId));
}

export function setOrderItemPacked(orderId, orderItemId, checked) {
  return runOrderOperation(() => setSupabaseOrderItemPacked(orderId, orderItemId, checked));
}

export function markOrderPacked(orderId) {
  return runOrderOperation(() => markSupabaseOrderPacked(orderId));
}

export function reopenOrderPacking(orderId) {
  return runOrderOperation(() => reopenSupabaseOrderPacking(orderId));
}

export function markOrderShipped(orderId, input) {
  return runOrderOperation(() => markSupabaseOrderShipped(orderId, input));
}

export function markOrderCompleted(orderId, input) {
  return runOrderOperation(() => markSupabaseOrderCompleted(orderId, input));
}

export function friendlyErrorMessage(error) {
  return getSafeUserError(error, "save");
}

async function runRepositoryOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    logSafeError("repository_operation", error);
    throw createSafeUserError(error, "save");
  }
}

export async function syncSupabaseStore() {
  const expectedGeneration = getAuthenticatedStoreGeneration();
  return runRepositoryOperation(async () => replaceStore(await loadSupabaseStore(), expectedGeneration));
}

export async function addSupabaseCollection(input) {
  return runRepositoryOperation(async () => {
    await createSupabaseCollection(input);
    return syncSupabaseStore();
  });
}

export async function saveSupabaseCollection(collectionId, input) {
  return runRepositoryOperation(async () => {
    await updateSupabaseCollection(collectionId, input);
    return syncSupabaseStore();
  });
}

export async function addSupabaseInventoryItem(input) {
  return runRepositoryOperation(async () => {
    await createSupabaseInventoryItem(input);
    return syncSupabaseStore();
  });
}

export async function saveSupabaseInventoryItem(itemId, input) {
  return runRepositoryOperation(async () => {
    await updateSupabaseInventoryItem(itemId, input);
    const syncedStore = await syncSupabaseStore();
    const expectedPrice = Math.round(Number(input.price || 0) * 100) / 100;
    const savedItem = syncedStore.inventory.find((item) => item.id === itemId);

    if (!savedItem || Math.round(Number(savedItem.price || 0) * 100) / 100 !== expectedPrice) {
      throw new Error("Item price did not persist. Please refresh and try again.");
    }

    if (savedItem.status === STATUSES.SOLD) {
      const linkedSales = syncedStore.sales.filter((sale) => sale.itemId === itemId);
      const savedSale = linkedSales.length === 1 ? linkedSales[0] : null;

      if (!savedSale || Math.round(Number(savedSale.price || 0) * 100) / 100 !== expectedPrice) {
        throw new Error("Sold item price did not persist to the linked sale. Please refresh and try again.");
      }
    }

    return syncedStore;
  });
}

export async function setSupabaseInventoryStatus(itemId, nextStatus, paymentStatus, platform) {
  return runRepositoryOperation(async () => {
    await changeSupabaseInventoryStatus(itemId, nextStatus, paymentStatus, platform);
    return syncSupabaseStore();
  });
}

export async function savePaymentConfiguration(input) {
  return runRepositoryOperation(async () => {
    await saveSupabasePaymentConfig(input);
    return syncSupabaseStore();
  });
}

export async function addPaymentRequest(input) {
  const { mutationResult: request, store } = await runPaymentRequestOperation(
    () => createSupabasePaymentRequest(input),
    "The Payment Request was created, but the latest data could not be reloaded. Refresh the page to confirm it.",
  );
  return {
    request: store.paymentRequests.find((entry) => entry.id === request.id) || request,
    store,
  };
}

export async function markPaymentRequestPaid(requestId, paymentMethod) {
  const { store } = await runPaymentRequestOperation(
    () => markSupabasePaymentRequestPaid(requestId, paymentMethod),
    "The payment was saved, but the latest data could not be reloaded. Refresh the page to confirm it.",
  );
  return store;
}

export async function cancelPaymentRequest(requestId) {
  const { store } = await runPaymentRequestOperation(
    () => cancelSupabasePaymentRequest(requestId),
    "The Payment Request was cancelled, but the latest data could not be reloaded. Refresh the page to confirm it.",
  );
  return store;
}

export async function removeSupabaseInventoryItem(itemId) {
  return runRepositoryOperation(async () => {
    await deleteSupabaseInventoryItem(itemId);
    return syncSupabaseStore();
  });
}

export async function saveSupabaseSale(saleId, input) {
  return runRepositoryOperation(async () => {
    await updateSupabaseSale(saleId, input);
    return syncSupabaseStore();
  });
}

export async function addSupabaseExpense(input) {
  return runRepositoryOperation(async () => {
    await createSupabaseExpense(input);
    return syncSupabaseStore();
  });
}

export async function saveSupabaseExpense(expenseId, input) {
  return runRepositoryOperation(async () => {
    await updateSupabaseExpense(expenseId, input);
    return syncSupabaseStore();
  });
}

export async function removeSupabaseExpense(expenseId) {
  return runRepositoryOperation(async () => {
    await deleteSupabaseExpense(expenseId);
    return syncSupabaseStore();
  });
}

export async function addSupabaseCapitalEntry(input) {
  return runRepositoryOperation(async () => {
    await createSupabaseCapitalEntry(input);
    return syncSupabaseStore();
  });
}

export async function saveSupabaseCapitalEntry(capitalId, input) {
  return runRepositoryOperation(async () => {
    await updateSupabaseCapitalEntry(capitalId, input);
    return syncSupabaseStore();
  });
}

export async function importSupabaseBackup(store) {
  return runRepositoryOperation(async () => {
    await replaceSupabaseStoreFromBackup(store);
    return syncSupabaseStore();
  });
}

export {
  createSupabaseCollection,
  updateSupabaseCollection,
  archiveSupabaseCollection,
  deleteSupabaseCollection,
};
