const STORAGE_KEY = "ADMIN_API_KEY";

export function getApiKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(value: string) {
  if (typeof window === "undefined") return;
  if (value && value.trim()) window.localStorage.setItem(STORAGE_KEY, value.trim());
  else window.localStorage.removeItem(STORAGE_KEY);
}

