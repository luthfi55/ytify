import { Config, Context } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

export interface IPRecord {
  lastSeen: number;
  totalViolations: number;
  /** Bucket state; absent on records written before the bucket existed. */
  tokens?: number;
  tokensAt?: number;
}

// Burst allowance per client IP: a fresh visitor may resolve a handful of
// videos back to back (home-feed seeds, then a play) and is otherwise
// rate-limited to one request every IP_REFILL_MS.
const IP_BURST_CAPACITY = 8;
const IP_REFILL_MS = 10000;

export interface RapidAPIState {
  keys: Array<{
    remaining: number;
    resetsat: number;
  }>;
  ips: Record<string, IPRecord>;
}

// 🛡️ The Heavy Offender Wall - Kicked out before any database or API interaction
const HARD_BANNED_SUBNETS = [
  "27.121.6.",
  "27.121.41.",
  "41.224.2.11",
  "50.86.10.234",
  "103.161.250.10",
  "117.199.197.6",
  "124.6.140.178",
  "159.18.195.32",
  "162.158.179.",
  "162.159.98.",
  "163.116.174.",
  "170.80.97.251",
  "172.68.211.",
  "172.68.225.",
  "172.71.215.",
  "173.235.97.34",
  "184.174.140.",
  "190.107.19.",
  "190.217.64.",
  "203.28.67.",
  "210.14.11.",
  "212.175.130.20"
];

function getClientIp(request: Request, context: Context): string {
  // Netlify-set values are authoritative: a client can send its own
  // X-Forwarded-For and would otherwise spoof the ban list and the quota
  // bucket (or frame another IP).
  const netlifyIp =
    request.headers.get("x-nf-client-connection-ip") || context.ip;
  if (netlifyIp) return netlifyIp;

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const hops = xForwardedFor.split(",").map((hop) => hop.trim()).filter(Boolean);
    // The rightmost entry is the hop our own edge appended.
    if (hops.length) return hops[hops.length - 1];
  }

  return "unknown";
}

async function getRapidAPIState() {
  const store = getStore("rapidapi");
  try {
    const state = (await store.get("data", { type: "json" })) as RapidAPIState | null;

    if (state?.ips) {
      let stateModified = false;
      const now = Date.now();
      const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
      const ipKeys = Object.keys(state.ips);

      for (const ip of ipKeys) {
        const record = state.ips[ip];
        const timePassed = now - record.lastSeen;
        const periodsPassed = Math.floor(timePassed / SIX_HOURS_MS);

        if (periodsPassed > 0) {
          const newViolations = Math.max(0, record.totalViolations - periodsPassed);

          if (newViolations === 0) {
            delete state.ips[ip];
            stateModified = true;
          } else if (newViolations !== record.totalViolations) {
            state.ips[ip].totalViolations = newViolations;
            // Advance lastSeen by the exact number of 6-hour blocks processed to keep remainder time intact for the next cycle.
            state.ips[ip].lastSeen = record.lastSeen + (periodsPassed * SIX_HOURS_MS);
            stateModified = true;
          }
        }
      }

      if (stateModified) {
        // Run in background, don't await so we don't block the critical path
        store.setJSON("data", state).catch(e => console.error("Failed to persist decayed state:", e));
      }
    }

    return state;
  } catch (e) {
    return null;
  }
}

function selectBestKey(state: RapidAPIState | null, allKeys: string[]): { key: string; index: number } {
  const now = Date.now();

  const available = allKeys.map((k, idx) => {
    const entry = state?.keys[idx];
    if (!entry) return { key: k, index: idx, remaining: 500, resetsat: 0 };
    if (now > entry.resetsat) return { key: k, index: idx, remaining: 500, resetsat: 0 };
    return { key: k, index: idx, remaining: entry.remaining, resetsat: entry.resetsat };
  });

  available.sort((a, b) => b.remaining - a.remaining || a.resetsat - b.resetsat);
  return { key: available[0].key, index: available[0].index };
}

/**
 * Debts one token from the client IP's burst bucket.
 *
 * The previous rule rejected every request from an IP that had resolved
 * anything in the last 20 seconds, which made normal playback impossible: the
 * home feed resolves a few seed videos in parallel on load, so the user's own
 * play request was already inside the cooldown window and came back 403.
 */
export function takeIpToken(
  state: RapidAPIState | null,
  ip: string,
  now: number,
): { allowed: boolean; record: IPRecord; retryAfter: number } {
  const existing = state?.ips?.[ip];
  const violations =
    existing && typeof existing === 'object' ? existing.totalViolations || 0 : 0;

  const storedTokens = Number.isFinite(existing?.tokens)
    ? (existing as IPRecord).tokens as number
    : IP_BURST_CAPACITY;
  const storedAt = Number.isFinite(existing?.tokensAt)
    ? (existing as IPRecord).tokensAt as number
    : now;

  const available = Math.min(
    IP_BURST_CAPACITY,
    storedTokens + Math.max(0, now - storedAt) / IP_REFILL_MS,
  );
  const allowed = available >= 1;

  const record: IPRecord = {
    lastSeen: now,
    totalViolations: allowed ? violations : violations + 1,
    tokens: allowed ? available - 1 : available,
    tokensAt: now,
  };

  if (state) state.ips[ip] = record;

  return {
    allowed,
    record,
    retryAfter: allowed
      ? 0
      : Math.max(1, Math.ceil(((1 - available) * IP_REFILL_MS) / 1000)),
  };
}

async function updateRapidAPIState(
  index: number,
  remaining: number,
  resetsat: number,
  ip: string,
  gate: IPRecord | null,
) {
  const store = getStore("rapidapi");
  const state = (await getRapidAPIState()) || { keys: [], ips: {} };

  while (state.keys.length <= index) {
    state.keys.push({ remaining: 500, resetsat: 0 });
  }

  state.keys[index] = { remaining, resetsat };

  // Clean request: Safely resolve historical totals if transitioning from a raw numerical schema
  const existingRecord = state.ips[ip];
  const historicalViolations = existingRecord && typeof existingRecord === 'object'
    ? existingRecord.totalViolations
    : 0;

  // Keep the bucket the gate already debited; re-reading the store here can
  // race with a concurrent request and would otherwise refund tokens.
  state.ips[ip] = {
    lastSeen: Date.now(),
    totalViolations: gate?.totalViolations ?? historicalViolations,
    tokens: gate?.tokens ?? existingRecord?.tokens,
    tokensAt: gate?.tokensAt ?? existingRecord?.tokensAt,
  };

  try {
    await store.setJSON("data", state);
  } catch (e) {
    console.error("Failed to update RapidAPI state:", e);
  }
}

export default async (request: Request, context: Context) => {
  const { id } = context.params;
  const cgeo = context.geo?.country?.code || "IN";
  if (!id || id.length < 11) return new Response("Invalid ID", { status: 400 });

  const accept = request.headers.get("accept") || "";
  const isJson = accept.includes("application/json");

  const clientIp = getClientIp(request, context);

  // Fast gateway firewall drop
  const isBanned = HARD_BANNED_SUBNETS.some(subnet => clientIp.startsWith(subnet));
  if (isBanned) {
    console.warn(`[FAST-DROP] Blocked heavy abuser ${clientIp} at the gate.`);
    return new Response('Fast Gateway Firewall Drop | You have been restricted from access to the SoundDesk fallback service.', {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
        "Vary": "x-forwarded-for"
      }
    });
  }

  const rawKeys = Netlify.env.get("rkeys") || "";
  const allKeys = rawKeys.split(",").map(k => k.trim()).filter(Boolean);

  if (!allKeys.length) {
    return new Response(JSON.stringify({ error: "No API keys configured" }), { status: 500 });
  }

  let selectedKey = "";
  let selectedIndex = 0;
  let state: RapidAPIState | null = null;
  let gateRecord: IPRecord | null = null;

  if (isJson) {
    state = await getRapidAPIState();
    const now = Date.now();
    const gate = takeIpToken(state, clientIp, now);

    if (!gate.allowed) {
      const store = getStore("rapidapi");
      if (state) await store.setJSON("data", state);

      console.warn(
        `[VIOLATION] IP ${clientIp} exhausted its stream resolution budget. Metrics Accumulator: ${gate.record.totalViolations}.`,
      );

      // Never cache a per-IP rejection: a shared CDN entry would keep blocking
      // this client (and everyone behind the same NAT) long after the bucket
      // refilled.
      return new Response(null, {
        status: 403,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(gate.retryAfter),
        },
      });
    }

    gateRecord = gate.record;

    const selection = selectBestKey(state, allKeys);
    selectedKey = selection.key;
    selectedIndex = selection.index;
  } else {
    selectedIndex = Math.floor(Math.random() * allKeys.length);
    selectedKey = allKeys[selectedIndex];
  }

  try {
    const res = await fetch(`https://yt-api.p.rapidapi.com/dl?id=${id}&cgeo=${cgeo}`, {
      headers: {
        "X-RapidAPI-Key": selectedKey,
        "X-RapidAPI-Host": "yt-api.p.rapidapi.com"
      }
    });

    const remaining = parseInt(res.headers.get("x-ratelimit-requests-remaining") || "0");
    const resetSec = parseInt(res.headers.get("x-ratelimit-requests-reset") || "0");

    const rawResponseText = await res.text();

    if (!res.ok) {
      console.error(`[RAPIDAPI ERROR] Key Index: ${selectedIndex}, Status: ${res.status}. Raw Payload: ${rawResponseText}`);
      if (isJson) {
        await updateRapidAPIState(
          selectedIndex, remaining, Date.now() + resetSec * 1000, clientIp, gateRecord,
        );
      }
      throw new Error(`RapidAPI HTTP Error: ${res.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error(`[PARSE ERROR] Invalid JSON payload from RapidAPI: ${rawResponseText}`);
      throw new Error("Received malformed JSON data payload from source API.");
    }

    if (!data || !data.adaptiveFormats) {
      console.error(`[VALIDATION ERROR] Missing payload properties. Raw Output: ${rawResponseText}`);
    }

    const expireSeconds = parseInt(data?.expiresInSeconds || "21600");

    if (isJson) {
      await updateRapidAPIState(
        selectedIndex, remaining, Date.now() + resetSec * 1000, clientIp, gateRecord,
      );

      const mediaProxy = (
        Netlify.env.get("MEDIA_PROXY") || "https://api.ytify.workers.dev"
      ).replace(/\/+$/, "");

      return new Response(JSON.stringify({
        title: data?.title || "Unknown Title",
        author: data?.channelTitle || "Unknown Author",
        authorId: data?.authorId || data?.channelId || "",
        lengthSeconds: parseInt(data?.lengthSeconds || "0"),
        adaptiveFormats: data?.adaptiveFormats ? data.adaptiveFormats.map((f: any) => ({
          ...f,
          type: f.mimeType,
          bitrate: f.bitrate?.toString() || "",
          clen: f.contentLength,
          url: `${mediaProxy}/stream?u=${encodeURIComponent(f.url + "&fallback")}`
        })) : [],
        recommendedVideos: [],
        captions: [],
        liveNow: data?.isLiveContent || false
      }), {
        headers: {
          "content-type": "application/json",
          "Cache-Control": `public, s-maxage=${expireSeconds}`,
          "Vary": "Accept, x-nf-country"
        }
      });
    }

    const music = data.channelTitle?.endsWith(" - Topic") ? "https://wsrv.nl?w=180&h=180&fit=cover&url=" : "";
    const thumbnail = `${music}https://i.ytimg.com/vi_webp/${id}/mqdefault.webp`;

    return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="description" content="${data.title || ''} by ${(data.channelTitle || '').replace(' - Topic', '')} in SoundDesk">
  <meta property="og:title" content="${data.title || ''}">
  <meta property="og:description" content="By ${(data.channelTitle || '').replace(' - Topic', '')}">
  <meta property="og:image" content="${thumbnail}">
  <meta property="og:type" content="website">
  <title>${data.title || 'Playback'} | SoundDesk</title>
  <script>location.replace('/?s=${id}')</script>
</head>
<body>Redirecting...</body>
</html>`, {
      headers: {
        "content-type": "text/html",
        "Cache-Control": "public, s-maxage=604800",
        "Vary": "Accept"
      }
    });

  } catch (err) {
    console.error("Stream Edge Function failed:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};

export const config: Config = { path: "/s/:id" };
