import { db } from "./db";
import { enqueueMutation } from "./sync";

// Marker on synthetic responses + echoed bodies for mutations accepted
// into the offline outbox (replayed by the sync engine in step 5).
export const OFFLINE_QUEUED_MARKER = "__offlineQueued";

export function isQueuedResponse(data: any): boolean {
  return !!data && data[OFFLINE_QUEUED_MARKER] === true;
}

// Synthetic 200 echoing the request body so mutation onSuccess handlers
// run normally (no error toasts anywhere). Consumers that REPLACE cache
// with the response must merge instead — see ReportEditor saveMutation.
function queuedResponse(body: string | undefined): Response {
  let echo: any = { [OFFLINE_QUEUED_MARKER]: true };
  try {
    if (body) echo = { ...JSON.parse(body), [OFFLINE_QUEUED_MARKER]: true };
  } catch {
    // non-JSON body (shouldn't happen — all mutations send JSON)
  }
  return new Response(JSON.stringify(echo), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Offline-Queued": "1",
    },
  });
}

// Thrown when a request can't reach the network and there's nothing usable
// cached. Callers (mutations, auth) surface this as "you're offline".
export class OfflineError extends Error {
  readonly isOffline = true;
  constructor(url: string) {
    super(`You're offline — ${url} isn't available offline yet.`);
    this.name = "OfflineError";
  }
}

export function isOfflineError(err: unknown): err is OfflineError {
  return err instanceof OfflineError || (err as any)?.isOffline === true;
}

// Never cache these: auth responses carry session identity (leaking another
// user's cached auth on a shared iPad would be a security hole), and login
// must always hit the network.
function isCacheableUrl(url: string): boolean {
  return url.includes("/api/") && !url.includes("/api/auth");
}

function cachedResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Offline-Cache": "hit",
    },
  });
}

// Drop-in replacement for fetch() used by api.ts and the React Query
// default queryFn. Online behavior is unchanged; the response is cloned
// into IndexedDB for GETs. Offline (or a failed fetch while flaky):
// serve the cached GET, or throw OfflineError. Successful mutations bust
// the whole GET cache so the next read refetches fresh data.
export async function offlineFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const cacheable = method === "GET" && isCacheableUrl(url);

  if (!navigator.onLine) {
    console.log("[offline] offline, method=", method, url);
    if (cacheable) {
      const hit = await db.apiCache.get(url).catch(() => undefined);
      if (hit) return cachedResponse(hit.data);
      throw new OfflineError(url);
    }
    // Mutation while offline → outbox it, pretend success (replayed later).
    // Auth calls are never queued — login must really happen online.
    if (url.includes("/api/auth")) throw new OfflineError(url);
    const rawBody =
      init?.body && typeof init.body === "string" ? init.body : undefined;
    console.log("[offline] queueing mutation", method, url);
    await enqueueMutation(method, url, rawBody);
    console.log("[offline] queued OK", method, url);
    return queuedResponse(rawBody);
  }

  try {
    // Dead networks (WiFi off but socket half-open, captive portals) can
    // hang fetch for minutes. Abort generously — 45s covers even slow
    // photo uploads post-compression — and treat it as flaky: queued.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok && cacheable) {
      res
        .clone()
        .json()
        .then((data) => db.apiCache.put({ url, data, cachedAt: Date.now() }))
        .catch(() => {});
    }
    if (method !== "GET" && res.ok && url.includes("/api/")) {
      // Mutation succeeded — cached reads may now be stale.
      db.apiCache.clear().catch(() => {});
    }
    return res;
  } catch {
    if (cacheable) {
      const hit = await db.apiCache.get(url).catch(() => undefined);
      if (hit) return cachedResponse(hit.data);
      throw new OfflineError(url);
    }
    // Flaky network (online flag lied): same outbox treatment.
    if (url.includes("/api/auth")) throw new OfflineError(url);
    const rawBody =
      init?.body && typeof init.body === "string" ? init.body : undefined;
    await enqueueMutation(method, url, rawBody).catch(() => {});
    return queuedResponse(rawBody);
  }
}

// Reactive online flag for banners / disabling offline-hostile actions.
export function subscribeOnlineStatus(
  cb: (online: boolean) => void,
): () => void {
  const onOnline = () => cb(true);
  const onOffline = () => cb(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
