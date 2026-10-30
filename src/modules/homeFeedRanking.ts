import { parseDuration } from "../utils";

export const HOME_FEED_VERSION = 1;
export const HOME_PAGE_SIZE = 24;
export const HOME_FEED_MAX = 72;
export const HOME_SEED_LIMIT = 3;
export const HOME_MIN_SECONDS = 60;
export const HOME_MAX_SECONDS = 4 * 60 * 60;
export const HOME_PER_CHANNEL = 2;

export interface HomeSeed {
  id: string;
  title: string;
  author: string;
  authorId: string;
  weight: number;
}

export interface HomeFeedCache {
  v: number;
  fetchedAt: number;
  fingerprint: string;
  seedCursor: number;
  exhausted: boolean;
  pool: YTItem[];
}

export interface HomeFeedGroup {
  seed: HomeSeed;
  items: YTItem[];
}

export interface HomeFeedOptions {
  history: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  banned: ReadonlySet<string>;
  currentId?: string;
  existing?: YTItem[];
  max?: number;
  perChannel?: number;
}

export function channelKey(item: Pick<YTItem, "authorId" | "author">): string {
  return item.authorId || item.author || "";
}

function distinctAuthors(
  history: Pick<YTItem, "id" | "title" | "author" | "authorId">[],
) {
  const seen = new Set<string>();
  const authors: Pick<YTItem, "id" | "title" | "author" | "authorId">[] = [];
  for (const item of history) {
    const key = channelKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    authors.push(item);
  }
  return authors;
}

/**
 * Picks at most `limit` distinct-author seeds, newest first.
 * `cursor` counts distinct authors already consumed, including banned ones.
 */
export function selectSeeds(
  history: Pick<YTItem, "id" | "title" | "author" | "authorId">[],
  banned: ReadonlySet<string>,
  limit = HOME_SEED_LIMIT,
  cursor = 0,
): { seeds: HomeSeed[]; nextCursor: number; exhausted: boolean } {
  const authors = distinctAuthors(history);
  const start = Math.min(Math.max(cursor, 0), authors.length);
  const seeds: HomeSeed[] = [];
  let nextCursor = start;

  for (let i = start; i < authors.length && seeds.length < limit; i++) {
    nextCursor = i + 1;
    const item = authors[i];
    const key = channelKey(item);
    if (banned.has(key)) continue;
    seeds.push({
      id: item.id,
      title: item.title,
      author: item.author,
      authorId: item.authorId,
      weight: Math.max(1, HOME_SEED_LIMIT - seeds.length),
    });
  }

  return { seeds, nextCursor, exhausted: nextCursor >= authors.length };
}

function isCandidate(
  item: YTItem,
  options: HomeFeedOptions,
  seen: ReadonlySet<string>,
  counts: ReadonlyMap<string, number>,
  perChannel: number,
): boolean {
  if (!item.id || !item.title) return false;
  if (seen.has(item.id)) return false;
  if (options.history.has(item.id)) return false;
  if (options.hidden.has(item.id)) return false;
  if (item.id === options.currentId) return false;

  const key = channelKey(item);
  if (options.banned.has(key)) return false;
  if ((counts.get(key) ?? 0) >= perChannel) return false;

  const seconds = parseDuration(item.duration);
  return (
    Number.isFinite(seconds) &&
    seconds >= HOME_MIN_SECONDS &&
    seconds <= HOME_MAX_SECONDS
  );
}

/**
 * Interleaves recommendation groups by seed weight (3/2/1), applying
 * history/feedback/channel/duration filters and a global cap.
 */
export function rankCandidates(
  groups: HomeFeedGroup[],
  options: HomeFeedOptions,
): YTItem[] {
  const max = options.max ?? HOME_FEED_MAX;
  const perChannel = options.perChannel ?? HOME_PER_CHANNEL;
  const seen = new Set<string>((options.existing ?? []).map((item) => item.id));
  const counts = new Map<string, number>();

  for (const item of options.existing ?? []) {
    const key = channelKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const pools = groups.map((group) => ({
    weight: Math.max(1, group.seed.weight),
    items: group.items,
    index: 0,
  }));
  const out: YTItem[] = [];

  while (out.length < max) {
    let added = false;
    for (const pool of pools) {
      let taken = 0;
      while (
        taken < pool.weight &&
        pool.index < pool.items.length &&
        out.length < max
      ) {
        const item = pool.items[pool.index++];
        if (!isCandidate(item, options, seen, counts, perChannel)) continue;

        seen.add(item.id);
        const key = channelKey(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        out.push(item);
        taken++;
        added = true;
      }
    }
    if (!added) break;
  }

  return out;
}

/** Appends new items after `existing`, preserving order and dropping duplicates. */
export function mergeUnique(
  existing: YTItem[],
  incoming: YTItem[],
  max = HOME_FEED_MAX,
): YTItem[] {
  const seen = new Set(existing.map((item) => item.id));
  const out = [...existing];

  for (const item of incoming) {
    if (!item.id || seen.has(item.id)) continue;
    out.push(item);
    seen.add(item.id);
    if (out.length >= max) break;
  }

  return out.slice(0, max);
}

/** Cheap, stable cache key for the current listening history. */
export function historyFingerprint(ids: string[]): string {
  return `${ids.length}:${ids.slice(0, 24).join(",")}`;
}
