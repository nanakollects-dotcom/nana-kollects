import { supabase } from "./supabaseClient.js";

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data?.user || null;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  return data;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (!error) return;

  // Best-effort local invalidation prevents a failed remote request from restoring this session on refresh.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  throw new Error("Sign out could not be completed.");
}

export function safeAuthErrorMessage(error, fallback = "Authentication failed. Please try again.") {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (message.includes("email not confirmed")) return "Confirm your email before signing in.";
  if (message.includes("failed to fetch") || message.includes("network") || message.includes("timeout")) {
    return "Unable to connect. Check your internet connection and try again.";
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many attempts. Wait a moment and try again.";
  }

  return fallback;
}

export function subscribeToAuthState(handler) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    queueMicrotask(() => Promise.resolve(handler(event, session)).catch(() => undefined));
  });

  return () => data.subscription.unsubscribe();
}

export function createAuthStateCoordinator({ onClear, onLoad, onReady, onError }) {
  let currentUserId = null;
  let generation = 0;
  let activeLoad = null;

  const clear = async (reason = "signed_out") => {
    generation += 1;
    currentUserId = null;
    activeLoad = null;
    await onClear(reason);
  };

  const handle = async (event, session) => {
    const userId = String(session?.user?.id || "").trim();
    const invalid = ["SIGNED_OUT", "USER_DELETED"].includes(event) || !userId;

    if (invalid) {
      await clear(event || "invalid_session");
      return;
    }

    if (currentUserId === userId) return activeLoad;
    if (currentUserId && currentUserId !== userId) await clear("user_changed");

    currentUserId = userId;
    const loadGeneration = ++generation;
    const load = (async () => {
      try {
        await onLoad(userId);
        if (generation === loadGeneration && currentUserId === userId) await onReady(userId);
      } catch {
        if (generation === loadGeneration && currentUserId === userId) {
          await clear("load_failed");
          await onError();
        }
      }
    })();

    activeLoad = load;
    await load;
    if (activeLoad === load) activeLoad = null;
  };

  return { clear, handle };
}
