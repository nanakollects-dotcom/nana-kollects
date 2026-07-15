import { syncSupabaseStore } from "./services/repository.js";
import { clearAuthenticatedStore } from "./services/storage.js";

import { getDateRange } from "./core/filters.js";
import { getStore } from "./services/repository.js";
import { createAuthStateCoordinator, getCurrentUser, safeAuthErrorMessage, signIn, signUp, signOut, subscribeToAuthState } from "./services/authService.js";

import { renderDashboardPage, bindDashboardPage, resetDashboardPageState } from "./pages/dashboard.js";
import {
  renderInventoryPage,
  bindInventoryPage,
  resetInventoryPageState,
  setInventoryCollectionFilter,
  setInventoryViewItem,
} from "./pages/inventory.js";
import { renderCapitalPage, bindCapitalPage, resetCapitalPageState } from "./pages/capital.js";
import { renderSalesPage, bindSalesPage, resetSalesPageState } from "./pages/sales.js";
import { renderOrdersPage, bindOrdersPage, resetOrdersPageState } from "./pages/orders.js";
import { renderCollectionsPage, bindCollectionsPage, resetCollectionsPageState } from "./pages/collections.js";
import { renderExpensesPage, bindExpensesPage, resetExpensesPageState } from "./pages/expenses.js";

const pages = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", render: renderDashboardPage, bind: bindDashboardPage },
  { id: "collections", label: "Collections", icon: "collections", render: renderCollectionsPage, bind: bindCollectionsPage },
  { id: "inventory", label: "Inventory", icon: "inventory", render: renderInventoryPage, bind: bindInventoryPage },
  { id: "sales", label: "Sales", icon: "sales", render: renderSalesPage, bind: bindSalesPage },
  { id: "orders", label: "Orders", icon: "orders", render: renderOrdersPage, bind: bindOrdersPage },
  { id: "expenses", label: "Expenses", icon: "expenses", render: renderExpensesPage, bind: bindExpensesPage },
  { id: "capital", label: "Capital", icon: "capital", render: renderCapitalPage, bind: bindCapitalPage },
];

const authScreen = document.querySelector("#auth-screen");
const appShellWrapper = document.querySelector("#app-shell-wrapper");
const authForm = document.querySelector("#auth-form");
const signupBtn = document.querySelector("#signup-btn");
const authEmail = document.querySelector("#auth-email");
const authPassword = document.querySelector("#auth-password");
const authMessage = document.querySelector("#auth-message");
const signoutBtn = document.querySelector("#signout-btn");

const nav = document.querySelector("#nav");
const view = document.querySelector("#app-view");
const timeFilter = document.querySelector("#time-filter");
const customRange = document.querySelector("#custom-range");
const customStart = document.querySelector("#custom-start");
const customEnd = document.querySelector("#custom-end");
const customApply = document.querySelector("#custom-apply");
const pageActionSlot = document.querySelector("#page-action-slot");
const main = document.querySelector(".main");
const topbar = document.querySelector(".topbar");
const toast = document.querySelector("#toast");
const menuToggle = document.querySelector("#menu-toggle");
const navOverlay = document.querySelector("#nav-overlay");

let activePage = "dashboard";
let pendingOpen = "";
let customDateRange = {
  startDate: "",
  endDate: "",
};
let pendingCustomDateRange = {
  startDate: "",
  endDate: "",
};
let toastTimer = null;
let unsubscribeAuthState = null;

function notify(message, isError = false) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message || "";
  authMessage.classList.toggle("error", isError);
  authMessage.classList.toggle("show", Boolean(message));
}

async function withButtonBusy(button, busyText, action) {
  if (button.dataset.busy === "true") return;
  const originalText = button.textContent;
  button.dataset.busy = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = busyText;

  try {
    return await action();
  } finally {
    button.dataset.busy = "false";
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalText;
  }
}

function navIcon(name) {
  const icons = {
    dashboard: `<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>`,
    collections: `<path d="M12 3 4 7l8 4 8-4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/>`,
    inventory: `<path d="M5 7h14v13H5z"/><path d="M8 7V5h8v2"/><path d="M9 11h6"/>`,
    sales: `<text x="12" y="18" text-anchor="middle" font-size="20" font-weight="500" fill="none" stroke="currentColor" stroke-width="1.4">₱</text>`,
    orders: `<path d="M7 4h10l2 4v12H5V8z"/><path d="M5 8h14M9 12h6M9 16h4"/>`,
    expenses: `<path d="M7 4h10v16H7z"/><path d="M9 8h6M9 12h6M9 16h3"/>`,
    capital: `<path d="M4 8h16v10H4z"/><path d="M7 8V6h10v2"/><circle cx="12" cy="13" r="2"/>`,
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.dashboard}</svg>`;
}

function renderNav() {
  nav.innerHTML = pages
    .map(
      (page) => `
        <button class="nav-item ${page.id === activePage ? "active" : ""}" data-page="${page.id}">
          <span class="nav-icon">${navIcon(page.icon)}</span>
          <span>${page.label}</span>
        </button>
      `,
    )
    .join("");
}

function closeMobileNav() {
  document.body.classList.remove("nav-open");
}

function refresh() {
  const store = getStore();
  const page = pages.find((entry) => entry.id === activePage) || pages[0];
  const filters = getDateRange(timeFilter.value, customDateRange);

  document.title = `${page.label} - Nana Kollects Business Tracker`;
  main.dataset.page = page.id;
  customRange.hidden = timeFilter.value !== "custom";

  renderNav();

  if (topbar.parentElement !== main) {
    main.insertBefore(topbar, view);
  }

  view.innerHTML = page.render(store, filters, notify);

  const pageHeader = view.querySelector(".page-header");

  if (pageHeader) {
    pageHeader.after(topbar);
  }

  pageActionSlot.innerHTML = "";

  const pageAction = view.querySelector(".page-action");

  if (pageAction) {
    pageActionSlot.appendChild(pageAction);
  }

  main.onclick = null;

  if (page.bind) {
    page.bind(main, store, notify, refresh);
  }

  if (pendingOpen) {
    const open = pendingOpen;
    pendingOpen = "";
    main.querySelector(`[data-open-${open}="true"]`)?.click();
  }
}

function showApp() {
  authScreen.hidden = true;
  appShellWrapper.hidden = false;
  document.body.classList.add("is-authenticated");
  refresh();
}

function showAuth({ focus = false } = {}) {
  authScreen.hidden = false;
  appShellWrapper.hidden = true;
  document.body.classList.remove("is-authenticated");
  if (focus) authEmail.focus();
}

function resetAuthenticatedUiState({ focus = true } = {}) {
  showAuth();
  resetDashboardPageState();
  resetCollectionsPageState();
  resetInventoryPageState();
  resetSalesPageState();
  resetOrdersPageState();
  resetExpensesPageState();
  resetCapitalPageState();

  activePage = "dashboard";
  pendingOpen = "";
  customDateRange = { startDate: "", endDate: "" };
  pendingCustomDateRange = { startDate: "", endDate: "" };
  timeFilter.value = "all";
  customStart.value = "";
  customEnd.value = "";
  customRange.hidden = true;
  authPassword.value = "";
  closeMobileNav();
  document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.remove());
  if (topbar.parentElement !== main) main.insertBefore(topbar, view);
  view.replaceChildren();
  pageActionSlot.replaceChildren();
  main.onclick = null;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toast.textContent = "";
  toast.classList.remove("show", "error");
  if (focus) authEmail.focus();
}

function clearAuthenticatedState(reason) {
  resetAuthenticatedUiState({ focus: reason !== "initial_session" });
  clearAuthenticatedStore();
}

const authCoordinator = createAuthStateCoordinator({
  onClear: async (reason) => clearAuthenticatedState(reason),
  onLoad: async () => {
    setAuthMessage("Loading business data...");
    await syncSupabaseStore();
  },
  onReady: async () => {
    showApp();
    setAuthMessage("");
  },
  onError: async () => {
    const message = "Could not load business data. Check your connection and try again.";
    setAuthMessage(message, true);
    notify(message, true);
  },
});

async function initAuth() {
  unsubscribeAuthState = subscribeToAuthState((event, session) => authCoordinator.handle(event, session));
  const user = await getCurrentUser();
  await authCoordinator.handle("INITIAL_SESSION", user ? { user } : null);
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    setAuthMessage("Enter email and password first.", true);
    notify("Enter email and password first.", true);
    return;
  }

  await withButtonBusy(authForm.querySelector('button[type="submit"]'), "Signing in...", async () => {
    try {
      setAuthMessage("");
      const data = await signIn(email, password);
      await authCoordinator.handle("SIGNED_IN", data?.session);
      if (!appShellWrapper.hidden) {
        setAuthMessage("Signed in successfully.");
        notify("Signed in successfully.");
      }
    } catch (error) {
      const message = safeAuthErrorMessage(error, "Sign in failed. Please try again.");
      setAuthMessage(message, true);
      notify(message, true);
    }
  });
});

signupBtn.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    setAuthMessage("Enter email and password first.", true);
    notify("Enter email and password first.", true);
    return;
  }

  await withButtonBusy(signupBtn, "Creating...", async () => {
    try {
      setAuthMessage("");
      const data = await signUp(email, password);
      if (data?.session) {
        await authCoordinator.handle("SIGNED_IN", data.session);
        notify("Account created and signed in.");
      } else {
        await authCoordinator.clear("signup_confirmation");
        setAuthMessage("Account created. Check your email to confirm your account.");
        notify("Account created. Check your email to confirm your account.");
      }
    } catch (error) {
      const message = safeAuthErrorMessage(error, "Account creation failed. Please try again.");
      setAuthMessage(message, true);
      notify(message, true);
    }
  });
});

signoutBtn.addEventListener("click", async () => {
  await withButtonBusy(signoutBtn, "Signing out...", async () => {
    const remoteSignOut = signOut();
    await authCoordinator.clear("explicit_signout");
    try {
      await remoteSignOut;
      setAuthMessage("");
      notify("Signed out.");
    } catch {
      const message = "Signed out locally. Remote sign-out could not be confirmed.";
      setAuthMessage(message, true);
      notify(message, true);
    }
  });
});

nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) return;

  activePage = button.dataset.page;
  closeMobileNav();
  refresh();
});

timeFilter.addEventListener("change", () => {
  if (timeFilter.value === "custom") {
    pendingCustomDateRange = { ...customDateRange };
    customStart.value = pendingCustomDateRange.startDate;
    customEnd.value = pendingCustomDateRange.endDate;
  }
  refresh();
});

customStart.addEventListener("change", () => {
  pendingCustomDateRange = { ...pendingCustomDateRange, startDate: customStart.value };
});

customEnd.addEventListener("change", () => {
  pendingCustomDateRange = { ...pendingCustomDateRange, endDate: customEnd.value };
});

customApply.addEventListener("click", () => {
  if (!pendingCustomDateRange.startDate || !pendingCustomDateRange.endDate) {
    notify("Choose both start and end dates.", true);
    return;
  }

  if (new Date(pendingCustomDateRange.startDate) > new Date(pendingCustomDateRange.endDate)) {
    notify("Start date must be before end date.", true);
    return;
  }

  customDateRange = { ...pendingCustomDateRange };
  refresh();
});

window.addEventListener("store:changed", () => {
  if (!appShellWrapper.hidden) refresh();
});

window.addEventListener("inventory:filter-collection", (event) => {
  setInventoryCollectionFilter(event.detail);
  activePage = "inventory";
  closeMobileNav();
  refresh();
});

window.addEventListener("app:navigate", (event) => {
  activePage = event.detail?.page || activePage;

  if (event.detail?.viewItem) {
    setInventoryViewItem(event.detail.viewItem);
  }

  pendingOpen = event.detail?.open || "";

  closeMobileNav();
  refresh();
});

menuToggle.addEventListener("click", () => {
  document.body.classList.add("nav-open");
});

navOverlay.addEventListener("click", closeMobileNav);

window.addEventListener("beforeunload", () => unsubscribeAuthState?.(), { once: true });

initAuth().catch(() => authCoordinator.clear("initial_session"));
