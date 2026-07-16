const SAFE_MESSAGE_BY_EXACT_TEXT = new Map([
  ["choose a valid import type.", "Choose a valid import type."],
  ["choose a valid template type.", "Choose a valid template type."],
  ["csv file is empty.", "CSV file is empty."],
  ["csv must include a header row and at least one data row.", "CSV must include a header row and at least one data row."],
  ["csv header row is missing.", "CSV header row is missing."],
  ["there are no valid rows to import.", "There are no valid rows to import."],
  ["enter valid payment amounts.", "Enter valid payment amounts."],
  ["selling price must be zero or higher.", "Selling price must be zero or higher."],
  ["shipping fee must be zero or higher.", "Shipping fee must be zero or higher."],
  ["discount must be zero or higher.", "Discount must be zero or higher."],
  ["total amount due cannot be negative.", "Total amount due cannot be negative."],
  ["choose at least one item.", "Choose at least one item."],
  ["choose no more than 50 items.", "Choose no more than 50 items."],
  ["choose a valid item list.", "Choose a valid item list."],
  ["enter valid item prices.", "Enter valid item prices."],
  ["item prices cannot be negative.", "Item prices cannot be negative."],
  ["item prices must be higher than zero.", "Enter a selling price higher than zero for every item."],
  ["serialized item quantity must be one.", "Serialized item quantity must be one."],
  ["each item can be selected only once.", "Each item can be selected only once."],
  ["discount must not exceed the merchandise subtotal.", "Discount must not exceed the merchandise subtotal."],
  ["one or more selected items are unavailable.", "One or more selected items are no longer available."],
  ["one or more selected items are already reserved.", "One or more selected items already have a Pending Payment Request."],
  ["only pending payment requests can be cancelled.", "This Payment Request has already been finalized."],
  ["only pending payment requests can be marked paid.", "This Payment Request has already been finalized."],
  ["paid transaction history is incomplete.", "The payment was recorded, but its linked transaction history is incomplete. Refresh before trying again."],
  ["payment request item history is incomplete.", "This Payment Request is incomplete. Refresh before trying again."],
  ["payment request reservation state is incomplete.", "This Payment Request reservation is incomplete. Refresh before trying again."],
  ["one or more reserved items changed state.", "One or more reserved items changed. Refresh before trying again."],
  ["one or more selected items are no longer reserved.", "One or more selected items are no longer reserved. Refresh before trying again."],
  ["one or more selected items were already sold.", "This Payment Request has already been finalized."],
  ["payment request totals do not reconcile.", "This Payment Request has inconsistent totals. Refresh before trying again."],
  ["paid payment request sales cannot be edited.", "Paid Payment Request Sales are read-only."],
  ["collection name is required.", "Collection name is required."],
  ["choose an existing collection.", "Choose an existing collection."],
  ["gcash account name is required.", "GCash account name is required."],
  ["gcash mobile number is required.", "GCash mobile number is required."],
  ["upload a gotyme qr image.", "Upload a GoTyme QR image."],
  ["customer name is required.", "Customer name is required."],
  ["mobile number is required.", "Mobile number is required."],
  ["enter a valid philippine mobile number.", "Enter a valid Philippine mobile number."],
  ["validity date is required.", "Validity date is required."],
  ["validity date cannot be in the past.", "Validity date cannot be in the past."],
  ["choose a valid courier.", "Choose a valid courier."],
  ["item name is required.", "Item name is required."],
  ["sku is required.", "SKU is required."],
  ["sku must be unique.", "An item with this SKU already exists."],
  ["cost must be zero or higher.", "Cost must be zero or higher."],
  ["price must be equal to or higher than cost.", "Price must be equal to or higher than cost."],
  ["date added must be valid.", "Date added must be valid."],
  ["item not found.", "This inventory item is no longer available. Refresh and try again."],
  ["written-off or archived items cannot be edited.", "Written-off or archived items cannot be edited."],
  ["sold price must be zero or higher.", "Sold price must be zero or higher."],
  ["record the item cost before writing it off.", "Record the item cost before writing it off."],
  ["choose a valid platform.", "Choose a valid platform."],
  ["choose a valid payment status.", "Choose a valid payment status."],
  ["date is required.", "Date is required."],
  ["expense amount must be higher than zero.", "Expense amount must be higher than zero."],
  ["choose a valid category.", "Choose a valid category."],
  ["expense not found.", "This Expense is no longer available. Refresh and try again."],
  ["capital amount must be higher than zero.", "Capital amount must be higher than zero."],
  ["choose a valid capital type.", "Choose a valid capital type."],
  ["backup replacement is disabled after orders exist to protect fulfillment history.", "Backup replacement is disabled after Orders exist to protect fulfillment history."],
  ["multi-item transaction backup restore is not supported. keep this backup as a read-only export.", "Multi-item transaction backups can be exported, but hosted restore is not supported yet."],
  ["this item has a pending payment request. mark it paid or cancel the request before changing its inventory status.", "This item has a pending Payment Request. Mark it Paid or cancel it before changing inventory status."],
  ["payment request not found.", "This Payment Request is no longer available. Refresh and try again."],
  ["payment request was not found.", "This Payment Request is no longer available. Refresh and try again."],
  ["only pending requests can be marked paid.", "This Payment Request has already been finalized."],
  ["only pending requests can be cancelled.", "This Payment Request has already been finalized."],
  ["only available items can receive a payment request.", "This item is no longer available for a Payment Request."],
  ["inventory item not found.", "This inventory item is no longer available. Refresh and try again."],
  ["choose a valid shipping mode.", "Choose a valid shipping method."],
  ["choose gcash or gotyme.", "Choose GCash or GoTyme."],
  ["order not found.", "This Order is no longer available. Refresh and try again."],
  ["order item not found.", "This Order Item is no longer available. Refresh and try again."],
  ["only ready to pack orders can start packing.", "This Order is no longer ready to start packing."],
  ["order has no required packing items.", "This Order has no required packing items."],
  ["only packing orders can update the checklist.", "This Order is no longer eligible for checklist changes."],
  ["checklist changes require a packing order.", "This Order is no longer eligible for checklist changes."],
  ["checklist changes require a ready to pack or packing order. reopen a packed order first.", "Reopen the Packed Order before changing its checklist."],
  ["choose whether the order item is packed.", "Choose whether the Order Item is packed."],
  ["this order item does not require packing.", "This Order Item does not require packing."],
  ["check every required order item before continuing.", "Check every required Order Item before continuing."],
  ["check every required order item before marking packed.", "Check every required Order Item before marking Packed."],
  ["only packing orders can be marked packed.", "This Order is no longer eligible to be marked Packed."],
  ["only packed orders can be reopened for packing.", "This Order is no longer eligible to be reopened for packing."],
  ["only packed orders can be marked shipped.", "This Order is no longer eligible to be marked Shipped."],
  ["pickup orders cannot be marked shipped.", "Pickup Orders cannot be marked Shipped."],
  ["shipping address is required before shipping.", "Shipping address is required before shipping."],
  ["courier is required before shipping.", "Courier is required before shipping."],
  ["tracking number is required before shipping.", "Tracking number is required before shipping."],
  ["shipped date and time are required.", "Shipped date and time are required."],
  ["shipped date and time cannot be before packing.", "Shipped date and time cannot be before packing."],
  ["every required order item must be checked before shipping.", "Check every required Order Item before shipping."],
  ["only shipped orders can be marked completed.", "This Order is no longer eligible to be marked Completed."],
  ["completion date and time are required.", "Completion date and time are required."],
  ["completion date and time cannot be before shipping.", "Completion date and time cannot be before shipping."],
  ["this paid payment request has no complete linked order.", "The payment was recorded, but its linked Order is incomplete. Refresh before trying again."],
  ["the requested item is not reserved.", "This Payment Request is no longer eligible to be marked Paid."],
  ["this item already has a sale record.", "This Payment Request has already been finalized."],
  ["item price did not persist. please refresh and try again.", "The item update could not be confirmed. Refresh and try again."],
  ["sold item price did not persist to the linked sale. please refresh and try again.", "The linked Sale update could not be confirmed. Refresh and try again."],
  ["set up gcash details and the gotyme qr before generating a request.", "Set up payment details before generating a Payment Request."],
  ["configure gcash details and the gotyme qr before downloading.", "Configure payment details before downloading."],
  ["configure a valid gotyme qr image.", "Configure a valid GoTyme QR image."],
  ["invalid backup file.", "The selected backup file is not valid."],
  ["could not read backup file.", "The selected backup file could not be read."],
]);

const CONTEXT_FALLBACKS = {
  auth: "Authentication failed. Please try again.",
  load: "We couldn't load your data. Please try again.",
  import: "We couldn't process this import. Review the file and try again.",
  document: "We couldn't prepare this document. Please try again.",
  order_mutation: "We couldn't update this Order. Refresh and try again.",
  order_refresh: "The change was saved, but the latest Order data could not be reloaded. Refresh the page to confirm it.",
  payment_request: "We couldn't update this Payment Request. Refresh and try again.",
  save: "We couldn't save your changes. Please refresh and try again.",
};

const SAFE_LOG_OPERATIONS = new Set([
  "repository_operation",
  "order_mutation",
  "order_refresh",
  "payment_request_mutation",
  "payment_request_refresh",
  "authentication",
  "data_load",
  "document_generation",
  "import_operation",
]);

export class SafeUserError extends Error {
  constructor(message, category = "unknown") {
    super(message);
    this.name = "SafeUserError";
    this.category = category;
  }
}

function safeProperty(error, property) {
  try {
    return error?.[property];
  } catch {
    return undefined;
  }
}

function isSafeUserError(error) {
  try {
    return error instanceof SafeUserError;
  } catch {
    return false;
  }
}

function errorText(error) {
  if (typeof error === "string") return error.trim().toLowerCase();
  const message = safeProperty(error, "message");
  if (typeof message === "string") return message.trim().toLowerCase();
  return "";
}

function errorCode(error) {
  const code = safeProperty(error, "code");
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function errorStatus(error) {
  const status = safeProperty(error, "status");
  if (typeof status === "number" && Number.isFinite(status)) return status;
  if (typeof status === "string" && /^\d+$/.test(status.trim())) return Number(status);
  return null;
}

export function getSafeErrorCategory(error) {
  if (isSafeUserError(error)) return error.category;
  const message = errorText(error);
  const code = errorCode(error);
  const status = errorStatus(error);

  if (message.includes("failed to fetch") || message.includes("fetch failed") || message.includes("network") || message.includes("timeout")) return "network";
  if (message.includes("jwt") || message.includes("session") || message.includes("not authenticated") || message.includes("no authenticated user") || code === "PGRST301") return "session";
  if (message.includes("invalid login credentials") || message.includes("email not confirmed")) return "auth";
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) return "rate_limit";
  if (message.includes("duplicate key") || message.includes("unique constraint") || code === "23505") return "duplicate";
  if (message.includes("row-level security") || message.includes("permission denied") || code === "42501") return "permission";
  if (SAFE_MESSAGE_BY_EXACT_TEXT.has(message)) return "business";
  return "unknown";
}

export function getSafeUserError(error, context = "save") {
  if (isSafeUserError(error)) return error.message;
  const message = errorText(error);
  const category = getSafeErrorCategory(error);
  const fallback = CONTEXT_FALLBACKS[context] || "Something went wrong. Please try again.";

  if (SAFE_MESSAGE_BY_EXACT_TEXT.has(message)) return SAFE_MESSAGE_BY_EXACT_TEXT.get(message);
  if (context === "order_refresh") return fallback;
  if (category === "network") {
    if (context === "load") return "We couldn't load your data. Check your internet connection and try again.";
    if (context === "auth") return "Unable to connect. Check your internet connection and try again.";
    return "Unable to save. Check your internet connection and try again.";
  }
  if (category === "session") return "Your session is no longer valid. Please sign in again.";
  if (category === "auth") {
    if (message.includes("invalid login credentials")) return "Email or password is incorrect.";
    if (message.includes("email not confirmed")) return "Confirm your email before signing in.";
  }
  if (category === "rate_limit") return "Too many attempts. Wait a moment and try again.";
  if (category === "duplicate") {
    if (context === "collection" || message.includes("collection")) return "A collection with this name already exists.";
    if (context === "inventory" || message.includes("sku")) return "An item with this SKU already exists.";
    if (context === "payment_request" || message.includes("pending_item")) return "This item already has a pending Payment Request.";
    return "This record already exists.";
  }
  if (category === "permission") return "You don't have permission to complete this action. Please sign in again.";

  return fallback;
}

export function createSafeUserError(error, context = "save") {
  if (isSafeUserError(error)) return error;
  return new SafeUserError(getSafeUserError(error, context), getSafeErrorCategory(error));
}

export function logSafeError(operation, error) {
  if (!import.meta.env?.DEV) return;
  const safeOperation = SAFE_LOG_OPERATIONS.has(operation) ? operation : "operation";
  console.warn(`[Nana Kollects] ${safeOperation} failed (${getSafeErrorCategory(error)}).`);
}
