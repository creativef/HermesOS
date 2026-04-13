const STORAGE_KEY = "ADMIN_API_KEY";

export function getApiKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(value: string) {
  if (typeof window === "undefined") return;
  const next = value && value.trim() ? value.trim() : "";
  if (next) window.localStorage.setItem(STORAGE_KEY, next);
  else window.localStorage.removeItem(STORAGE_KEY);

  // Best-effort: sync to httpOnly cookie so SSE can auth without query params.
  fetch("/api/auth/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: next }),
  }).catch(() => {});
}
