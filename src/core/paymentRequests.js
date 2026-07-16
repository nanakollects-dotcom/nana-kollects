export const PAYMENT_REQUEST_STATUSES = {
  PENDING: "Pending",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const PAYMENT_METHODS = ["GCash", "GoTyme"];

export const SHIPPING_MODES = {
  FEE_NOW: "fee_now",
  TO_FOLLOW: "to_follow",
  PICKUP: "pickup",
};

export const SHIPPING_MODE_LABELS = {
  [SHIPPING_MODES.FEE_NOW]: "Include shipping fee",
  [SHIPPING_MODES.TO_FOLLOW]: "Shipping fee to follow",
  [SHIPPING_MODES.PICKUP]: "No shipping / pickup",
};

export const COURIER_OPTIONS = ["J&T", "GoGo Xpress", "Lalamove", "Other"];
export function displayCourier(value) {
  const courier = String(value || "").trim();
  const legacy = {
    "To follow": "To be confirmed",
    "Courier to follow": "To be confirmed",
    "J&T": "J&T Express",
    "Other courier": "Other",
  };
  return legacy[courier] || courier;
}

export function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizePhilippineMobile(value) {
  const mobile = String(value || "").replace(/[\s-]+/g, "").trim();
  if (/^09\d{9}$/.test(mobile)) return mobile;
  if (/^\+639\d{9}$/.test(mobile)) return `0${mobile.slice(3)}`;
  if (/^639\d{9}$/.test(mobile)) return `0${mobile.slice(2)}`;
  return "";
}

export function validatePaymentRequestRequiredFields(input = {}, today = localDateInputValue()) {
  const customerName = String(input.customerName || "").trim();
  const rawMobile = String(input.customerContact || "");
  const compactMobile = rawMobile.replace(/[\s-]+/g, "").trim();
  const customerContact = normalizePhilippineMobile(rawMobile);
  const validUntil = String(input.validUntil || "").trim();
  const errors = {};

  if (!customerName) errors.customerName = "Customer name is required.";
  if (!compactMobile) {
    errors.customerContact = "Mobile number is required.";
  } else if (!customerContact) {
    errors.customerContact = "Enter a valid Philippine mobile number.";
  }
  if (!validUntil) {
    errors.validUntil = "Validity date is required.";
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < today) {
    errors.validUntil = "Validity date cannot be in the past.";
  }

  return {
    errors,
    values: {
      customerName,
      customerContact,
      validUntil,
    },
  };
}
export const DEFAULT_PAYMENT_CONFIG = {
  gcashAccountName: "Ma. Christine Albaladejo",
  gcashMobileNumber: "09615030112",
  gotymeAccountName: "Ma. Christine Albaladejo",
  gotymeQrImage: "/payment/gotyme-instapay-qr.png",
};

export function paymentMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

export function normalizePaymentRequestItemsInput(input = {}) {
  const source = Array.isArray(input.items)
    ? input.items
    : input.itemId
      ? [{ inventoryItemId: input.itemId, unitPrice: input.itemPrice }]
      : [];

  if (!source.length) throw new Error("Choose at least one item.");
  if (source.length > 50) throw new Error("Choose no more than 50 items.");

  const seen = new Set();
  return source.map((item) => {
    const inventoryItemId = String(item.inventoryItemId ?? item.inventory_item_id ?? item.itemId ?? "").trim();
    const unitPrice = paymentMoney(item.unitPrice ?? item.unit_price ?? item.itemPrice ?? item.price);
    const quantity = Number(item.quantity ?? 1);
    if (!inventoryItemId) throw new Error("Choose a valid item list.");
    if (!Number.isFinite(unitPrice)) throw new Error("Enter valid item prices.");
    if (unitPrice < 0) throw new Error("Item prices cannot be negative.");
    if (quantity !== 1) throw new Error("Serialized item quantity must be one.");
    if (seen.has(inventoryItemId)) throw new Error("Each item can be selected only once.");
    seen.add(inventoryItemId);
    return {
      inventoryItemId,
      unitPrice,
      quantity: 1,
      lineTotal: unitPrice,
    };
  });
}

export function normalizeShippingMode(value) {
  return Object.values(SHIPPING_MODES).includes(value) ? value : SHIPPING_MODES.FEE_NOW;
}

export function calculatePaymentRequestTotal(itemPrice, shippingFee = 0, discount = 0, shippingMode = SHIPPING_MODES.FEE_NOW) {
  const mode = normalizeShippingMode(shippingMode);
  const price = Array.isArray(itemPrice)
    ? paymentMoney(normalizePaymentRequestItemsInput({ items: itemPrice }).reduce((sum, item) => sum + item.lineTotal, 0))
    : paymentMoney(itemPrice);
  const shipping = mode === SHIPPING_MODES.FEE_NOW ? paymentMoney(shippingFee || 0) : 0;
  const discountAmount = paymentMoney(discount || 0);

  if (![price, shipping, discountAmount].every(Number.isFinite)) {
    throw new Error("Enter valid payment amounts.");
  }
  if (price < 0) throw new Error("Selling price must be zero or higher.");
  if (shipping < 0) throw new Error("Shipping fee must be zero or higher.");
  if (discountAmount < 0) throw new Error("Discount must be zero or higher.");
  if (discountAmount > price) throw new Error("Discount must not exceed the merchandise subtotal.");

  const total = paymentMoney(price + shipping - discountAmount);
  if (total < 0) throw new Error("Total amount due cannot be negative.");

  return {
    itemPrice: price,
    merchandiseSubtotal: price,
    shippingFee: shipping,
    discount: discountAmount,
    total,
  };
}

export function isPaymentConfigurationComplete(config = {}) {
  const qrImage = String(config.gotymeQrImage || "").trim();
  return Boolean(
    String(config.gcashAccountName || "").trim() &&
    String(config.gcashMobileNumber || "").trim() &&
    (qrImage.startsWith("data:image/") || qrImage.startsWith("/payment/")),
  );
}
