import { createSignal } from "solid-js";
import { drawer, setDrawer } from "@config";
import { channelKey, type HomeFeedCache } from "./homeFeedRanking";

const [homeFeedbackVersion, setHomeFeedbackVersion] = createSignal(0);
export { homeFeedbackVersion };

function bump() {
  setHomeFeedbackVersion((version) => version + 1);
}

function hiddenIds(): string[] {
  return Array.isArray(drawer.homeHidden) ? drawer.homeHidden : [];
}

function bannedIds(): string[] {
  return Array.isArray(drawer.homeBanned) ? drawer.homeBanned : [];
}

export function filterFeedback(items: YTItem[]): YTItem[] {
  const hidden = new Set(hiddenIds());
  const banned = new Set(bannedIds());
  if (!hidden.size && !banned.size) return items;
  return items.filter(
    (item) => !hidden.has(item.id) && !banned.has(channelKey(item)),
  );
}

export function hideHomeItem(id: string) {
  if (!id) return;
  if (!hiddenIds().includes(id)) {
    setDrawer("homeHidden", [...hiddenIds(), id]);
  }
  const cache = drawer.homeFeed as HomeFeedCache | null;
  if (cache) {
    setDrawer("homeFeed", {
      ...cache,
      pool: cache.pool.filter((item) => item.id !== id),
    });
  }
  bump();
}

export function banHomeAuthor(item: Pick<YTItem, "authorId" | "author">) {
  const key = channelKey(item);
  if (!key) return;
  if (!bannedIds().includes(key)) {
    setDrawer("homeBanned", [...bannedIds(), key]);
  }
  const cache = drawer.homeFeed as HomeFeedCache | null;
  if (cache) {
    setDrawer("homeFeed", {
      ...cache,
      pool: cache.pool.filter((candidate) => channelKey(candidate) !== key),
    });
  }
  bump();
}

export function resetHomeFeedback() {
  setDrawer("homeHidden", []);
  setDrawer("homeBanned", []);
  setDrawer("homeFeed", null);
  bump();
}
