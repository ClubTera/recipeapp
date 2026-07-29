/* eslint-disable no-undef */
/**
 * Service Worker（設計書 7.4 / 8章）
 *
 * 1スコープにつき Service Worker は1つしか登録できないため、
 * 「オフライン閲覧のキャッシュ」と「Push の受信」をこの1本にまとめている。
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const MAX_IMAGE_ENTRIES = 120;

const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // 1つでも失敗すると全部落ちるので、個別に入れる
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![SHELL_CACHE, IMAGE_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Supabase API / Realtime は絶対にキャッシュしない（古いデータを掴む事故を防ぐ）
  if (url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) return;

  // 画像は cache-first。キッチンで電波が弱くても、見たレシピの写真が残る。
  if (request.destination === "image") {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ページは network-first。オフラインならキャッシュを返す。
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      cache.put(request, response.clone());
      trimCache(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
    }
    return response;
  } catch (err) {
    return cached ?? Response.error();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) ?? (await cache.match("/"));
    if (cached) return cached;
    throw err;
  }
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

// ── Push ─────────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "家族のレシピ", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "家族のレシピ", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge.png", // Android の白抜きモノクロアイコン
      tag: data.tag, // 同一タグは上書きされ、通知トレイに積み上がらない
      renotify: Boolean(data.tag),
      data: { path: data.link_path || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // 既に開いているタブがあればそれをフォーカスして遷移。なければ新規に開く。
      const client = list.find((c) => c.url.includes(self.location.origin));
      if (client) {
        client.navigate(path);
        return client.focus();
      }
      return clients.openWindow(path);
    }),
  );
});
