import { NextRequest } from "next/server";

const COOKIE_NAME = "hermesos_api_key";

function getBaseUrl() {
  const base = (process.env.DASHBOARD_API_URL || "http://dashboard-api:4000").replace(/\/$/, "");
  return base;
}

function hopByHopHeader(name: string) {
  const n = name.toLowerCase();
  return n === "connection" || n === "keep-alive" || n === "transfer-encoding" || n === "upgrade";
}

async function proxy(req: NextRequest) {
  const base = getBaseUrl();
  const upstreamUrl = new URL(`${base}${req.nextUrl.pathname}${req.nextUrl.search}`);

  const headers = new Headers(req.headers);
  headers.delete("host");
  // Prefer cookie-based auth so EventSource/SSE works without query-string API keys.
  const apiKeyFromCookie = req.cookies.get(COOKIE_NAME)?.value ? decodeURIComponent(req.cookies.get(COOKIE_NAME)!.value) : "";
  if (apiKeyFromCookie && !headers.get("x-api-key")) headers.set("x-api-key", apiKeyFromCookie);
  // Never forward browser cookies upstream.
  headers.delete("cookie");

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  const upstream = await fetch(upstreamUrl.toString(), { method, headers, body });

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (hopByHopHeader(key)) return;
    outHeaders.set(key, value);
  });

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export async function GET(req: NextRequest) {
  return proxy(req);
}
export async function POST(req: NextRequest) {
  return proxy(req);
}
export async function PUT(req: NextRequest) {
  return proxy(req);
}
export async function PATCH(req: NextRequest) {
  return proxy(req);
}
export async function DELETE(req: NextRequest) {
  return proxy(req);
}
