import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onMount,
  Show,
} from "solid-js";
import "./Home.css";
import HeaderNav from "@components/HeaderNav";
import StreamItem from "@components/StreamItem";
import About from "../Search/About";
import { config } from "@config";
import { getCollection } from "@modules/library";
import {
  getHomeFeed,
  isHomeFeedFresh,
  loadMoreHomeFeed,
  refreshHomeFeed,
} from "@modules/homeFeed";
import {
  HOME_FEED_MAX,
  HOME_PAGE_SIZE,
  type HomeFeedCache,
} from "@modules/homeFeedRanking";
import {
  filterFeedback,
  homeFeedbackVersion,
} from "@modules/homeFeedback";
import {
  openSubView,
  queueStore,
  setNavStore,
  setQueueStore,
  setStore,
  t,
} from "@stores";

type HomeState = "loading" | "ready" | "empty" | "off" | "error";

export default function () {
  let homeSection!: HTMLElement;
  const [state, setState] = createSignal<HomeState>("loading");
  const [pool, setPool] = createSignal<YTItem[]>([]);
  const [visible, setVisible] = createSignal(HOME_PAGE_SIZE);
  const [exhausted, setExhausted] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);

  function applyCache(cache: HomeFeedCache): YTItem[] {
    const next = filterFeedback(cache.pool);
    setPool(next);
    setExhausted(cache.exhausted);
    setVisible(Math.min(HOME_PAGE_SIZE, next.length));
    return next;
  }

  async function refresh() {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      const previousVisible = visible();
      const next = applyCache(await refreshHomeFeed());
      setVisible(
        Math.min(Math.max(previousVisible, HOME_PAGE_SIZE), next.length),
      );
      setState(next.length ? "ready" : "empty");
    } catch {
      if (pool().length) setStore("snackbar", t("home_error"));
      else setState("error");
    } finally {
      setRefreshing(false);
    }
  }

  function load() {
    if (!config.history) {
      setState("off");
      return;
    }

    const historyIds = getCollection("history");
    if (!historyIds.length) {
      setState("empty");
      return;
    }

    const cache = getHomeFeed();
    if (cache) {
      const next = applyCache(cache);
      if (next.length) {
        setState("ready");
        if (!isHomeFeedFresh(cache, historyIds)) void refresh();
        return;
      }
    }

    setState("loading");
    void refresh();
  }

  onMount(() => {
    setNavStore("home", "ref", homeSection);
    homeSection.scrollIntoView();
    load();
  });

  createEffect(
    on(
      homeFeedbackVersion,
      () => {
        const cache = getHomeFeed();
        if (!cache) return;
        const next = filterFeedback(cache.pool);
        setPool(next);
        setExhausted(cache.exhausted);
        if (next.length < HOME_PAGE_SIZE / 2 && next.length < HOME_FEED_MAX) {
          void refresh();
        }
      },
      { defer: true },
    ),
  );

  const visibleItems = createMemo(() => {
    homeFeedbackVersion();
    return filterFeedback(pool()).slice(0, visible());
  });

  const hasMore = createMemo(
    () =>
      visible() < pool().length ||
      (!exhausted() && pool().length < HOME_FEED_MAX),
  );

  function handlePlay(item: YTItem) {
    if (queueStore.list.length && !queueStore.homeSession) return;
    const cache = getHomeFeed();
    if (!cache) return;

    const source = filterFeedback(cache.pool);
    const index = source.findIndex((candidate) => candidate.id === item.id);
    if (index === -1) return;

    setQueueStore("list", source.slice(index + 1));
    setQueueStore("homeSession", true);
  }

  async function handleLoadMore() {
    const nextVisible = Math.min(visible() + HOME_PAGE_SIZE, HOME_FEED_MAX);
    if (nextVisible <= visible() || loadingMore()) return;

    const cache = getHomeFeed();
    if (!cache) return;

    const filtered = filterFeedback(cache.pool);
    if (filtered.length >= nextVisible || cache.exhausted) {
      setVisible(Math.min(nextVisible, filtered.length));
      return;
    }

    setLoadingMore(true);
    try {
      const updated = await loadMoreHomeFeed(nextVisible);
      const next = filterFeedback(updated.pool);
      setPool(next);
      setExhausted(updated.exhausted);
      setVisible(Math.min(nextVisible, next.length));
    } catch {
      setStore("snackbar", t("home_error"));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section class="homeSection" ref={homeSection}>
      <header class="sticky-bar">
        <HeaderNav
          title={
            <div class="home-title">
              <p>{t("home_title")}</p>
              <small>{t("home_subtitle")}</small>
            </div>
          }
          extra={
            <>
              <button
                class="home-refresh"
                aria-label={t("home_refresh")}
                onclick={() => void refresh()}
                disabled={refreshing()}
              >
                <i
                  class={
                    refreshing()
                      ? "ri-loader-3-line loading-spinner"
                      : "ri-refresh-line"
                  }
                ></i>
              </button>
              <button
                class="home-refresh"
                aria-label={t("nav_settings")}
                onclick={() => openSubView("settings")}
              >
                <i class="ri-settings-line"></i>
              </button>
            </>
          }
        />
      </header>

      <Show when={state() === "loading"}>
        <div class="home-loading">
          <i class="ri-loader-3-line loading-spinner"></i>
          <p>{t("home_loading")}</p>
        </div>
      </Show>

      <Show when={state() === "ready"}>
        <div class="home-feed">
          <For each={visibleItems()}>
            {(item) => (
              <StreamItem
                {...item}
                context={item.context}
                onPlay={handlePlay}
              />
            )}
          </For>
        </div>
        <Show when={hasMore()}>
          <button
            class="home-more"
            onclick={() => void handleLoadMore()}
            disabled={loadingMore()}
          >
            {loadingMore() ? t("home_loading") : t("home_load_more")}
          </button>
        </Show>
      </Show>

      <Show when={state() === "empty" || state() === "off"}>
        <About />
        <div class="home-empty">
          <Show when={state() === "off"}>
            <p>{t("home_history_off")}</p>
            <button
              class="home-cta"
              onclick={() => openSubView("settings")}
            >
              {t("home_settings_link")}
            </button>
          </Show>
          <Show when={state() === "empty"}>
            <p>{t("home_empty_title")}</p>
            <p class="home-empty-body">{t("home_empty_body")}</p>
          </Show>
          <button class="home-cta" onclick={() => openSubView("search")}>
            {t("home_empty_cta")}
          </button>
        </div>
      </Show>

      <Show when={state() === "error"}>
        <div class="home-error">
          <p>{t("home_error")}</p>
          <button class="home-cta" onclick={() => void refresh()}>
            {t("home_retry")}
          </button>
        </div>
      </Show>
    </section>
  );
}
