/**
 * Fallback media proxy.
 *
 * RapidAPI's googlevideo URLs are bound to the API server's egress IP. They
 * serve small bounded ranges but reject open-ended/full requests, so a media
 * element asking for `bytes=0-` gets a 403. The proxy clamps every range to a
 * small chunk and lets the media element continue through Content-Range.
 */
export const MEDIA_CHUNK_SIZE = 1024 * 1024;
const MAX_MEDIA_URL_LENGTH = 8192;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export function isAllowedMediaUrl(value: string): boolean {
  if (!value || value.length > MAX_MEDIA_URL_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host !== "googlevideo.com" && !host.endsWith(".googlevideo.com")) {
    return false;
  }

  if (!url.pathname.endsWith("/videoplayback")) return false;
  return url.searchParams.has("fallback");
}

export function clampMediaRange(range: string | null): string | null {
  if (!range) return `bytes=0-${MEDIA_CHUNK_SIZE - 1}`;

  const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!match) return null;

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0) return null;

  const requestedEnd = match[2]
    ? Number(match[2])
    : start + MEDIA_CHUNK_SIZE - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

  const end = Math.min(requestedEnd, start + MEDIA_CHUNK_SIZE - 1);
  return `bytes=${start}-${end}`;
}

export async function proxyMedia(
  request: Request,
  target: string,
): Promise<Response> {
  const upstreamRange = clampMediaRange(request.headers.get("range"));
  if (!upstreamRange) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": "bytes */*" },
    });
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set("range", upstreamRange);
  upstreamHeaders.set(
    "user-agent",
    request.headers.get("user-agent") || DEFAULT_USER_AGENT,
  );

  const accept = request.headers.get("accept");
  if (accept) upstreamHeaders.set("accept", accept);

  const upstream = await fetch(target, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders,
    redirect: "follow",
    signal: request.signal,
  });

  const headers = new Headers();
  for (const key of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "last-modified",
    "etag",
  ]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("access-control-allow-origin", "*");
  headers.set("vary", "Range");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
