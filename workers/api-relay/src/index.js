const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Lark-Request-Timestamp,X-Lark-Request-Nonce,X-Lark-Signature",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (new URL(request.url).pathname === "/relay/health") {
      return json({
        ok: true,
        upstreamConfigured: Boolean(getUpstream(env)),
        upstreamHost: getUpstream(env)?.host
      });
    }

    const upstream = getUpstream(env);
    if (!upstream) {
      return json(
        {
          ok: false,
          error: "UPSTREAM_API_BASE_URL is not configured for the API relay."
        },
        503
      );
    }

    const targetUrl = buildTargetUrl(request.url, upstream);
    const proxyRequest = new Request(targetUrl, request);
    proxyRequest.headers.set("X-Agent-Pilot-Relay", "cloudflare-worker");

    const response = await fetch(proxyRequest);
    if (isWebSocket(request)) {
      return response;
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};

function getUpstream(env) {
  const value = env.UPSTREAM_API_BASE_URL;
  if (!value || value.includes("replace-with-current-api")) {
    return null;
  }
  return new URL(value.replace(/\/+$/, ""));
}

function buildTargetUrl(requestUrl, upstream) {
  const incoming = new URL(requestUrl);
  const target = new URL(upstream.toString());
  target.pathname = joinPath(upstream.pathname, incoming.pathname);
  target.search = incoming.search;
  return target.toString();
}

function joinPath(basePath, requestPath) {
  const base = basePath.replace(/\/+$/, "");
  const suffix = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return `${base}${suffix}` || "/";
}

function isWebSocket(request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}
