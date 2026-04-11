import { getApiKey } from "@/lib/auth";

type Options = {
  auth?: boolean;
};

function authHeaders() {
  const key = getApiKey();
  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;
  return headers;
}

export async function apiGet<T = any>(path: string, options: Options = {}) {
  const auth = options.auth ?? true;
  const res = await fetch(path, {
    method: "GET",
    headers: auth ? authHeaders() : {},
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiPost<T = any>(path: string, body: any) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiPut<T = any>(path: string, body: any) {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiPatch<T = any>(path: string, body: any) {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiDelete<T = any>(path: string) {
  const res = await fetch(path, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}
