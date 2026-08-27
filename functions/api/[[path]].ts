interface Env {
  API_ORIGIN?: string;
}

const fallbackApiOrigin = 'https://icelin-blog-api.1256422744.workers.dev';

function apiPath(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value.join('/') : value || '').replace(/^\/+/, '');
}

function unavailableResponse() {
  return new Response(JSON.stringify({ error: '内容服务暂时不可用，请稍后重试。' }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-icelin-api-proxy': 'pages',
    },
  });
}

export const onRequest: PagesFunction<Env, 'path'> = async ({ request, params, env }) => {
  const path = apiPath(params.path);
  if (!path.startsWith('v1/')) return new Response('Not found', { status: 404 });

  const incoming = new URL(request.url);
  const upstream = new URL(`/${path}`, env.API_ORIGIN || fallbackApiOrigin);
  upstream.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  // The Worker receives this as a trusted same-site subrequest. Removing Origin also
  // keeps preview deployments from failing the production-only CORS allowlist.
  headers.delete('origin');
  headers.set('x-icelin-api-proxy', 'pages');

  try {
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body;
    const response = await fetch(upstream, { method: request.method, headers, body, redirect: 'manual' });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-icelin-api-proxy', 'pages');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch {
    return unavailableResponse();
  }
};
