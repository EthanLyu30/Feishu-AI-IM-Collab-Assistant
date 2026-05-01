const proxyHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Lark-Request-Timestamp,X-Lark-Request-Nonce,X-Lark-Signature",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && shouldProxy(url)) {
      return new Response(null, { status: 204, headers: proxyHeaders });
    }

    if (url.pathname === "/edge/health") {
      const upstream = getUpstream(env);
      return json({
        ok: true,
        mode: "cloudflare-pages-advanced-worker",
        upstreamConfigured: Boolean(upstream),
        upstreamHost: upstream?.host ?? null
      });
    }

    if (url.pathname === "/edge/config") {
      const upstream = getUpstream(env);
      return json({
        apiBaseUrl: upstream ? `${url.origin}` : "",
        wsUrl: upstream ? `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/ws` : "",
        upstreamConfigured: Boolean(upstream)
      });
    }

    if (shouldProxy(url)) {
      return proxyToAgent(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function proxyToAgent(request, env) {
  const upstream = getUpstream(env);
  if (!upstream) {
    return json(
      {
        ok: false,
        error: "UPSTREAM_API_BASE_URL is not configured for this Cloudflare Pages deployment."
      },
      503
    );
  }

  const targetUrl = buildTargetUrl(request.url, upstream);
  const proxyRequest = new Request(targetUrl, request);
  proxyRequest.headers.set("X-Agent-Pilot-Relay", "cloudflare-pages");

  const response = await fetch(proxyRequest);
  if (isWebSocket(request)) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(proxyHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function shouldProxy(url) {
  return (
    url.pathname === "/health" ||
    url.pathname === "/ws" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws/")
  );
}

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
      ...proxyHeaders
    }
  });
}
