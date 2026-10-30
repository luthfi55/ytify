import getStreamData from "@modules/getStreamData";
import { getCollection, getCollectionItems } from "@modules/library";
import { drawer, setDrawer } from "@config";
import { playerStore, t } from "@stores";
import { convertSStoHHMMSS, isTopicAuthor } from "@utils";
import {
  HOME_FEED_MAX,
  HOME_FEED_VERSION,
  HOME_PAGE_SIZE,
  historyFingerprint,
  mergeUnique,
  rankCandidates,
  selectSeeds,
  type HomeFeedCache,
  type HomeFeedGroup,
  type HomeSeed,
} from "./homeFeedRanking";

const HOME_FEED_TTL = 6 * 60 * 60 * 1000;
const HOME_FETCH_TIMEOUT = 8 * 1000;

export function getHomeFeed(): HomeFeedCache | null {
  const cache = drawer.homeFeed as HomeFeedCache | null;
  if (!cache || cache.v !== HOME_FEED_VERSION || !Array.isArray(cache.pool))
    return null;
  return cache;
}

export function isHomeFeedFresh(
  cache: HomeFeedCache,
  historyIds: string[],
): boolean {
  return (
    Date.now() - cache.fetchedAt < HOME_FEED_TTL &&
    cache.fingerprint === historyFingerprint(historyIds)
  );
}

function save(cache: HomeFeedCache): HomeFeedCache {
  setDrawer("homeFeed", cache.pool.length ? cache : null);
  return cache;
}

function emptyCache(historyIds: string[]): HomeFeedCache {
  return {
    v: HOME_FEED_VERSION,
    fetchedAt: 0,
    fingerprint: historyFingerprint(historyIds),
    seedCursor: 0,
    exhausted: true,
    pool: [],
  };
}

async function fetchRelated(seed: HomeSeed): Promise<YTItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOME_FETCH_TIMEOUT);
  let data: Invidious | Record<"error" | "message", string> | undefined;
  try {
    data = await getStreamData(seed.id, controller.signal, {
      sideEffects: false,
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
  if (!data || "error" in data) return [];
  const recommended = (data as Invidious).recommendedVideos;
  if (!Array.isArray(recommended)) return [];
  return recommended.map((item) => ({
    id: item.videoId,
    title: item.title,
    author: item.author,
    authorId: item.authorId,
    duration: convertSStoHHMMSS(item.lengthSeconds),
    type: isTopicAuthor(item.author) ? "song" : "video",
    context: { src: "home", id: t("home_title") },
  }));
}

async function extendCache(
  cache: HomeFeedCache,
  target: number,
  history: YTItem[],
  historyIds: string[],
  hidden: Set<string>,
  banned: Set<string>,
): Promise<HomeFeedCache> {
  let pool = cache.pool;
  let cursor = cache.seedCursor;
  let exhausted = cache.exhausted;
  const currentId = playerStore.stream.id;

  while (pool.length < target && pool.length < HOME_FEED_MAX && !exhausted) {
    const next = selectSeeds(history, banned, 1, cursor);
    cursor = next.nextCursor;
    exhausted = next.exhausted;
    if (!next.seeds.length) break;

    const seed = next.seeds[0];
    let items: YTItem[] = [];
    try {
      items = await fetchRelated(seed);
    } catch {
      items = [];
    }

    const ranked = rankCandidates([{ seed, items }], {
      history: new Set(historyIds),
      hidden,
      banned,
      currentId,
      existing: pool,
      max: HOME_FEED_MAX,
    });
    pool = mergeUnique(pool, ranked, HOME_FEED_MAX);
  }

  return {
    ...cache,
    pool,
    seedCursor: cursor,
    exhausted,
    fetchedAt: Date.now(),
    fingerprint: historyFingerprint(historyIds),
  };
}

export async function refreshHomeFeed(): Promise<HomeFeedCache> {
  const historyIds = getCollection("history");
  if (!historyIds.length) return save(emptyCache(historyIds));

  const previous = getHomeFeed();
  const history = getCollectionItems("history");
  const hidden = new Set(
    Array.isArray(drawer.homeHidden) ? drawer.homeHidden : [],
  );
  const banned = new Set(
    Array.isArray(drawer.homeBanned) ? drawer.homeBanned : [],
  );
  const seedResult = selectSeeds(history, banned);
  const groups: HomeFeedGroup[] = await Promise.all(
    seedResult.seeds.map(async (seed) => {
      try {
        return { seed, items: await fetchRelated(seed) };
      } catch {
        return { seed, items: [] };
      }
    }),
  );

  let cache: HomeFeedCache = {
    v: HOME_FEED_VERSION,
    fetchedAt: Date.now(),
    fingerprint: historyFingerprint(historyIds),
    seedCursor: seedResult.nextCursor,
    exhausted: seedResult.exhausted,
    pool: rankCandidates(groups, {
      history: new Set(historyIds),
      hidden,
      banned,
      currentId: playerStore.stream.id,
    }),
  };

  if (cache.pool.length < HOME_PAGE_SIZE) {
    cache = await extendCache(
      cache,
      HOME_PAGE_SIZE,
      history,
      historyIds,
      hidden,
      banned,
    );
  }

  if (!cache.pool.length && previous?.pool.length) {
    return previous;
  }

  return save(cache);
}

export async function loadMoreHomeFeed(target: number): Promise<HomeFeedCache> {
  const cache = getHomeFeed();
  if (!cache) return refreshHomeFeed();

  const desired = Math.min(Math.max(target, cache.pool.length), HOME_FEED_MAX);
  if (cache.pool.length >= desired || cache.exhausted) return cache;

  const historyIds = getCollection("history");
  const history = getCollectionItems("history");
  const hidden = new Set(
    Array.isArray(drawer.homeHidden) ? drawer.homeHidden : [],
  );
  const banned = new Set(
    Array.isArray(drawer.homeBanned) ? drawer.homeBanned : [],
  );
  const extended = await extendCache(
    cache,
    desired,
    history,
    historyIds,
    hidden,
    banned,
  );
  return save(extended);
}
