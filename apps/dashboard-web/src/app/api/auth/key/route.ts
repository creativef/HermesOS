import { NextRequest } from "next/server";

const COOKIE_NAME = "hermesos_api_key";

export async function POST(req: NextRequest) {
  let apiKey = "";
  try {
    const body = await req.json();
    apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  } catch {}

  const secure = req.nextUrl.protocol === "https:";
  const res = new Response(JSON.stringify({ ok: true, hasKey: Boolean(apiKey) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  if (apiKey) {
    res.headers.append(
      "set-cookie",
      `${COOKIE_NAME}=${encodeURIComponent(apiKey)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30};${
        secure ? " Secure;" : ""
      }`
    );
  } else {
    res.headers.append("set-cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;`);
  }

  return res;
}

export async function DELETE(req: NextRequest) {
  const secure = req.nextUrl.protocol === "https:";
  const res = new Response(JSON.stringify({ ok: true, hasKey: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  res.headers.append("set-cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure ? " Secure;" : ""}`);
  return res;
}

