export const PAYMENT_REQUEST_STATUSES = {
  PENDING: "Pending",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const PAYMENT_METHODS = ["GCash", "GoTyme"];

export function paymentMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

export function calculatePaymentRequestTotal(itemPrice, shippingFee = 0, discount = 0) {
  const price = paymentMoney(itemPrice);
  const shipping = paymentMoney(shippingFee || 0);
  const discountAmount = paymentMoney(discount || 0);

  if (![price, shipping, discountAmount].every(Number.isFinite)) {
    throw new Error("Enter valid payment amounts.");
  }
  if (price < 0) throw new Error("Selling price must be zero or higher.");
  if (shipping < 0) throw new Error("Shipping fee must be zero or higher.");
  if (discountAmount < 0) throw new Error("Discount must be zero or higher.");

  const total = paymentMoney(price + shipping - discountAmount);
  if (total < 0) throw new Error("Total amount due cannot be negative.");

  return {
    itemPrice: price,
    shippingFee: shipping,
    discount: discountAmount,
    total,
  };
}

export function isPaymentConfigurationComplete(config = {}) {
  return Boolean(
    String(config.gcashAccountName || "").trim() &&
    String(config.gcashMobileNumber || "").trim() &&
    String(config.gotymeQrImage || "").startsWith("data:image/"),
  );
}
