export function getDashboardApiWsUrl(path = "/api/v1/ws") {
  // Optional override for deployments where dashboard-api isn't on :4000.
  const explicit = process.env.NEXT_PUBLIC_DASHBOARD_API_WS_URL;
  if (explicit && explicit.trim()) return explicit.replace(/\/$/, "") + path;

  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const port = "4000";
  return `${proto}://${host}:${port}${path}`;
}

