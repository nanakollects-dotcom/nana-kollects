import {
  cancelPaymentRequest,
  markPaymentRequestPaid,
} from "../services/repository.js";
import { bindForm, emptyState, modal, pageHeader } from "../components/ui.js";
import { formatDate, formatMoney } from "../components/format.js";
import {
  displayCourier,
  PAYMENT_METHODS,
  SHIPPING_MODES,
} from "../core/paymentRequests.js";
import { createPaymentRequestDocumentModel } from "../core/paymentRequestDocuments.js";
import { createPaymentRequestPdf, downloadPaymentRequestPdf } from "../services/paymentRequestPdf.js";
import { createPaymentRequestImage, sharePaymentRequestImage } from "../services/paymentRequestImage.js";
import { getSafeUserError } from "../services/errorService.js";

const STATUS_OPTIONS = ["Pending", "Paid", "Cancelled"];
const SORT_OPTIONS = {
  newest: "Newest first",
  oldest: "Oldest first",
  highest: "Highest amount",
  lowest: "Lowest amount",
};

let searchTerm = "";
let statusFilter = "all";
let sortMode = "newest";
let paidRequestId = null;
let focusedRequestId = null;
const expandedRequestIds = new Set();

const escapeText = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const requestStatusClass = (status) => {
  if (status === "Paid") return "green-pill";
  if (status === "Cancelled") return "gray-pill";
  return "yellow-pill";
};

const requestDateValue = (request) => {
  const value = new Date(request.issuedAt || request.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

const uniqueRequests = (requests = []) => {
  const seen = new Set();
  return requests.filter((request) => {
    const key = request.id || `request:${request.requestNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function resetPaymentRequestsPageState() {
  searchTerm = "";
  statusFilter = "all";
  sortMode = "newest";
  paidRequestId = null;
  focusedRequestId = null;
  expandedRequestIds.clear();
}

export function setPaymentRequestFocus(requestId) {
  focusedRequestId = requestId || null;
  if (focusedRequestId) expandedRequestIds.add(focusedRequestId);
}

export function setPaymentRequestSearch(value) {
  searchTerm = String(value || "");
}

export function setPaymentRequestStatusFilter(value) {
  statusFilter = value || "all";
}

export function setPaymentRequestSort(value) {
  sortMode = SORT_OPTIONS[value] ? value : "newest";
}

export function getVisiblePaymentRequests(store) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return uniqueRequests(store.paymentRequests || [])
    .filter((request) => {
      if (statusFilter !== "all" && request.status !== statusFilter) return false;
      if (!normalizedSearch) return true;
      const childText = (request.items || [])
        .map((item) => `${item.sku || ""} ${item.itemName || ""}`)
        .join(" ");
      return `${request.requestNumber || ""} ${request.customerName || ""} ${childText}`
        .toLowerCase()
        .includes(normalizedSearch);
    })
    .slice()
    .sort((first, second) => {
      if (sortMode === "oldest") return requestDateValue(first) - requestDateValue(second);
      if (sortMode === "highest") return Number(second.totalAmount || 0) - Number(first.totalAmount || 0);
      if (sortMode === "lowest") return Number(first.totalAmount || 0) - Number(second.totalAmount || 0);
      return requestDateValue(second) - requestDateValue(first);
    });
}

function requestDocumentModel(request) {
  try {
    return createPaymentRequestDocumentModel(request);
  } catch {
    return null;
  }
}

function renderRequestDetails(request, documentModel) {
  if (!documentModel) {
    return `<p class="payment-request-detail-unavailable" role="status">Payment Request details are unavailable. Refresh and try again.</p>`;
  }

  const items = documentModel.items || [];
  return `
    <dl class="payment-request-snapshot-meta">
      <div><dt>Customer</dt><dd>${escapeText(documentModel.customerName)}</dd></div>
      ${documentModel.customerContact ? `<div><dt>Contact</dt><dd>${escapeText(documentModel.customerContact)}</dd></div>` : ""}
      <div><dt>Issue Date</dt><dd>${formatDate(documentModel.issuedAt)}</dd></div>
      <div><dt>Status</dt><dd>${escapeText(documentModel.status)}</dd></div>
      <div><dt>Payment</dt><dd>${escapeText(documentModel.paymentMethod || "GCash / GoTyme")}</dd></div>
      <div><dt>Payment Accounts</dt><dd>${escapeText([documentModel.paymentConfig.gcashAccountName, documentModel.paymentConfig.gotymeAccountName].filter(Boolean).join(" / ") || "Unavailable")}</dd></div>
      <div><dt>Shipping Method</dt><dd>${escapeText(documentModel.shippingMethod)}</dd></div>
      <div><dt>Courier</dt><dd>${escapeText(displayCourier(documentModel.courier) || (documentModel.shippingMode === SHIPPING_MODES.PICKUP ? "Pickup" : "Unavailable"))}</dd></div>
      <div class="full-span"><dt>Shipping Address</dt><dd>${escapeText(documentModel.shippingAddress || "Unavailable")}</dd></div>
    </dl>
    <div class="payment-request-snapshot-table-wrap">
      <table class="payment-request-snapshot-table">
        <thead><tr><th>SKU</th><th>Item</th><th>Qty</th><th class="money-cell">Unit Price</th><th class="money-cell">Line Total</th></tr></thead>
        <tbody>${items.map((item) => `
          <tr class="payment-request-snapshot-item">
            <td class="mono" data-label="SKU">${escapeText(item.sku || "Unavailable")}</td>
            <td data-label="Item"><strong>${escapeText(item.itemName)}</strong></td>
            <td data-label="Quantity">${item.quantity}</td>
            <td class="money-cell" data-label="Unit Price">${formatMoney(item.unitPrice)}</td>
            <td class="money-cell" data-label="Line Total"><strong>${formatMoney(item.lineTotal)}</strong></td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
    <dl class="payment-request-snapshot-totals">
      <div><dt>Merchandise Subtotal</dt><dd>${formatMoney(documentModel.merchandiseSubtotal)}</dd></div>
      <div><dt>Discount</dt><dd>${documentModel.discount ? `-${formatMoney(documentModel.discount)}` : formatMoney(0)}</dd></div>
      <div><dt>Shipping</dt><dd>${documentModel.shippingMode === SHIPPING_MODES.TO_FOLLOW ? "To follow" : documentModel.shippingMode === SHIPPING_MODES.PICKUP ? "Pickup" : formatMoney(documentModel.shippingFee)}</dd></div>
      <div><dt>Grand Total</dt><dd>${formatMoney(documentModel.grandTotal)}</dd></div>
    </dl>
  `;
}

function renderRequestCard(request) {
  const documentModel = requestDocumentModel(request);
  const items = documentModel?.items || request.items || [];
  const firstItem = items[0] || {};
  const moreCount = Math.max(0, items.length - 1);
  const itemSummary = `${firstItem.itemName || "Item details unavailable"}${moreCount ? ` +${moreCount} more` : ""}`;
  const open = expandedRequestIds.has(request.id);

  return `
    <article class="payment-request-card" data-payment-request-card="${escapeText(request.id)}">
      <div class="payment-request-card-head">
        <div>
          <span class="payment-request-card-label">Payment Request</span>
          <h2>${escapeText(request.requestNumber)}</h2>
          <p>${escapeText(itemSummary)}</p>
        </div>
        <span class="pill ${requestStatusClass(request.status)}">${escapeText(request.status)}</span>
      </div>
      <dl class="payment-request-card-summary">
        <div><dt>Customer</dt><dd>${escapeText(request.customerName || "Unavailable")}</dd></div>
        <div><dt>Items</dt><dd>${items.length} item${items.length === 1 ? "" : "s"}</dd></div>
        <div><dt>Total</dt><dd>${formatMoney(request.totalAmount)}</dd></div>
        <div><dt>Date</dt><dd>${formatDate(request.issuedAt || request.createdAt)}</dd></div>
      </dl>
      <div class="payment-request-card-actions" role="group" aria-label="Actions for ${escapeText(request.requestNumber)}">
        <button class="table-action primary-action" type="button" data-download-image-request="${escapeText(request.id)}" aria-label="Share or save image for ${escapeText(request.requestNumber)}">Share / Save Image</button>
        <button class="table-action" type="button" data-download-request="${escapeText(request.id)}" aria-label="Download PDF for ${escapeText(request.requestNumber)}">Download PDF</button>
        ${request.status === "Pending" ? `
          <button class="table-action primary-action" type="button" data-paid-request="${escapeText(request.id)}" aria-label="Mark ${escapeText(request.requestNumber)} paid">Mark Paid</button>
          <button class="table-action danger" type="button" data-cancel-request="${escapeText(request.id)}" aria-label="Cancel ${escapeText(request.requestNumber)}">Cancel</button>
        ` : ""}
      </div>
      <details class="payment-request-snapshot-details" data-payment-request-details="${escapeText(request.id)}" ${open ? "open" : ""}>
        <summary aria-label="View details for ${escapeText(request.requestNumber)}">View Details</summary>
        <div class="payment-request-details-body">
          ${renderRequestDetails(request, documentModel)}
        </div>
      </details>
    </article>
  `;
}

export function renderPaymentRequestResults(store) {
  const allRequests = uniqueRequests(store.paymentRequests || []);
  const requests = getVisiblePaymentRequests(store);

  if (!allRequests.length) {
    return `
      <section class="panel payment-request-results" data-payment-request-results="true">
        ${emptyState("No payment requests yet.", "Create one from the Inventory page after selecting an item.")}
      </section>
    `;
  }

  if (!requests.length) {
    return `
      <section class="panel payment-request-results" data-payment-request-results="true">
        ${emptyState(
          "No matching payment requests.",
          statusFilter === "all" ? "Try a different search." : `No requests match the ${statusFilter} status and current search.`,
        )}
      </section>
    `;
  }

  return `
    <section class="payment-request-list" data-payment-request-results="true" aria-label="Payment Request results">
      ${requests.map(renderRequestCard).join("")}
    </section>
  `;
}

function paidRequestForm(store) {
  const request = (store.paymentRequests || []).find((entry) => entry.id === paidRequestId);
  if (!request) return "";
  return modal(
    "Confirm Payment",
    `
      <form class="form-panel modal-form" id="payment-paid-form">
        <div class="modal-header">
          <div>
            <h2>Confirm Payment</h2>
            <p>${escapeText(request.requestNumber)}</p>
          </div>
          <button class="icon-btn" type="button" data-close-paid-request>Close</button>
        </div>
        <section class="modal-section">
          <label>Payment Method
            <select name="paymentMethod" required>
              <option value="">Choose method</option>
              ${PAYMENT_METHODS.map((method) => `<option value="${method}">${method}</option>`).join("")}
            </select>
          </label>
          <p class="modal-copy">This finalizes the full ${request.items?.length || 1}-item transaction at ${formatMoney(request.totalAmount)}.</p>
        </section>
        <div class="button-row">
          <button class="primary-btn" type="submit" data-saving-text="Confirming...">Mark Paid</button>
          <button class="secondary-btn" type="button" data-close-paid-request>Cancel</button>
        </div>
      </form>
    `,
  );
}

export function renderPaymentRequestsPage(store) {
  const requestCount = uniqueRequests(store.paymentRequests || []).length;
  return `
    ${pageHeader(
      "Payment Requests",
      `${requestCount} saved request${requestCount === 1 ? "" : "s"}`,
      `<button class="primary-btn page-action" type="button" data-payment-request-inventory>Create from Inventory</button>`,
    )}
    <div class="toolbar payment-requests-toolbar">
      <label class="search-field">
        Search payment requests
        <input id="payment-request-search" value="${escapeText(searchTerm)}" placeholder="Reference, customer, item, or SKU..." />
      </label>
      <label>
        Status
        <select id="payment-request-status-filter">
          <option value="all" ${statusFilter === "all" ? "selected" : ""}>All Statuses</option>
          ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${statusFilter === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </label>
      <label>
        Sort
        <select id="payment-request-sort">
          ${Object.entries(SORT_OPTIONS).map(([value, label]) => `<option value="${value}" ${sortMode === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    </div>
    ${renderPaymentRequestResults(store)}
    ${paidRequestId ? paidRequestForm(store) : ""}
  `;
}

function bindDetailState(root) {
  root.querySelectorAll("[data-payment-request-details]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) expandedRequestIds.add(details.dataset.paymentRequestDetails);
      else expandedRequestIds.delete(details.dataset.paymentRequestDetails);
    });
  });
}

export function bindPaymentRequestsPage(root, store, notify, refresh) {
  const paidForm = root.querySelector("#payment-paid-form");
  bindDetailState(root);

  if (paidForm) {
    bindForm(paidForm, async (data) => {
      try {
        await markPaymentRequestPaid(paidRequestId, data.paymentMethod);
        paidRequestId = null;
        notify("Payment confirmed and sale recorded.");
        refresh();
      } catch (error) {
        notify(getSafeUserError(error, "payment_request"), true);
        return false;
      }
    });
  }

  const updateResults = () => {
    const results = root.querySelector("[data-payment-request-results]");
    if (!results) return;
    results.outerHTML = renderPaymentRequestResults(store);
    bindDetailState(root);
  };

  root.querySelector("#payment-request-search")?.addEventListener("input", (event) => {
    searchTerm = event.target.value;
    updateResults();
  });

  root.querySelector("#payment-request-status-filter")?.addEventListener("change", (event) => {
    statusFilter = event.target.value;
    updateResults();
  });

  root.querySelector("#payment-request-sort")?.addEventListener("change", (event) => {
    sortMode = event.target.value;
    updateResults();
  });

  if (focusedRequestId) {
    const requestId = focusedRequestId;
    focusedRequestId = null;
    requestAnimationFrame(() => {
      root.querySelector(`[data-payment-request-details="${CSS.escape(requestId)}"] > summary`)?.focus();
    });
  }

  root.onkeydown = (event) => {
    const summary = event.target.closest("[data-payment-request-details] > summary");
    if (!summary || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const details = summary.parentElement;
    details.open = !details.open;
  };

  root.onclick = async (event) => {
    const button = event.target.closest("button");
    if (!button || button.dataset.busy === "true") return;

    if (button.hasAttribute("data-payment-request-inventory")) {
      window.dispatchEvent(new CustomEvent("app:navigate", { detail: { page: "inventory" } }));
      return;
    }

    if (button.dataset.paidRequest) {
      paidRequestId = button.dataset.paidRequest;
      expandedRequestIds.add(paidRequestId);
      refresh();
      return;
    }

    if (button.hasAttribute("data-close-paid-request")) {
      paidRequestId = null;
      refresh();
      return;
    }

    const originalText = button.textContent;
    const isDocumentAction = Boolean(button.dataset.downloadRequest || button.dataset.downloadImageRequest);
    try {
      if (button.dataset.downloadRequest) {
        button.dataset.busy = "true";
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Preparing PDF...";
        const request = (store.paymentRequests || []).find((entry) => entry.id === button.dataset.downloadRequest);
        if (!request) throw new Error("Payment request not found.");
        const bytes = await createPaymentRequestPdf(request, {
          ...request.paymentConfig,
          gotymeQrImage: store.paymentConfig?.gotymeQrImage,
        });
        downloadPaymentRequestPdf(bytes, request.requestNumber);
        notify("Payment Request PDF downloaded.");
      }

      if (button.dataset.downloadImageRequest) {
        button.dataset.busy = "true";
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Preparing Image...";
        const request = (store.paymentRequests || []).find((entry) => entry.id === button.dataset.downloadImageRequest);
        if (!request) throw new Error("Payment request not found.");
        const blob = await createPaymentRequestImage(request, {
          ...request.paymentConfig,
          gotymeQrImage: store.paymentConfig?.gotymeQrImage,
        });
        const result = await sharePaymentRequestImage(blob, request.requestNumber);
        if (result === "opened" || result === "mobile-download") {
          notify("Image created. Use your browser's Share or Save Image option.");
        } else if (result !== "cancelled") {
          notify("Payment Request image ready.");
        }
      }

      if (button.dataset.cancelRequest) {
        if (!confirm("Cancel this entire payment request and release all linked items?")) return;
        button.dataset.busy = "true";
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Cancelling...";
        await cancelPaymentRequest(button.dataset.cancelRequest);
        notify("Payment Request cancelled. Linked items released.");
        refresh();
      }
    } catch (error) {
      notify(getSafeUserError(error, isDocumentAction ? "document" : "payment_request"), true);
    } finally {
      if (button.dataset.busy === "true") {
        button.dataset.busy = "false";
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = originalText;
      }
    }
  };
}
