export interface Env {
  OPENAI_API_KEY: string;
  RATE_LIMIT: KVNamespace;
}

type Entry = { count: number; expiry: number };
const memory = new Map<string, Entry>();

const WINDOW_MS = 60_000; // 60s
const LIMIT = 30;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Real-IP") ||
      "anon";

    const now = Date.now();
    const key = `rl:${ip}`;

    const entry = memory.get(key);

    if (entry && entry.expiry > now) {
      if (entry.count >= LIMIT) {
        return new Response("Too many requests", {
          status: 429,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Retry-After": "60",
          },
        });
      }
      entry.count++;
    } else {
      memory.set(key, { count: 1, expiry: now + WINDOW_MS });
    }

    ctx.waitUntil(
      env.RATE_LIMIT.put(key, "1", { expirationTtl: 60 }).catch(() => {})
    );

    const bodyClone = request.clone();

    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: bodyClone.body,
        cf: { cacheTtl: 0 },
      }
    );

    const headers = new Headers(openaiRes.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(openaiRes.body, {
      status: openaiRes.status,
      statusText: openaiRes.statusText,
      headers,
    });
  },
};
