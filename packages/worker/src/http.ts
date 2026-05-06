/**
 * Small HTTP helpers — JSON responses, error responses, with optional Set-Cookie tunneling.
 */

export function jsonResponse(body: unknown, init: ResponseInit = {}, setCookie?: string): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  setCookie?: string,
): Response {
  return jsonResponse({ error: { code, message } }, { status }, setCookie);
}
