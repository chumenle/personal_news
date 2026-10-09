/** Compare against the browser-facing host, not Next.js's normalized loopback URL.
 * Reverse proxies must set NEWS_ORIGIN; forwarded headers are never trusted here.
 */
export function isAllowedOrigin(
  request: { headers: Headers; url: string },
  configuredOrigin = process.env.NEWS_ORIGIN,
): boolean {
  function parseOrigin(value: string | null | undefined) {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  const source = parseOrigin(request.headers.get("origin"));
  if (!source) return false;
  // An explicitly configured public origin stays authoritative, including when invalid.
  if (configuredOrigin !== undefined)
    return source === parseOrigin(configuredOrigin);
  const host = request.headers.get("host");
  if (!host || /[\s,/@\\?#]/.test(host)) return false;
  const protocol = new URL(request.url).protocol;
  return source === parseOrigin(`${protocol}//${host}`);
}
