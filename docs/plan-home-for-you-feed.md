# ADR-0001: For You home feed from local listening history

- **Status:** Accepted
- **Date:** 2026-10-30
- **Related:** `docs/systems/library-state.md`, `docs/systems/search.md`, `docs/systems/streaming.md`

> Repo note: this decision record lives under `docs/plan-*.md` because `AGENTS.md` restricts `docs/` to `docs/systems/`, `docs/plan-*.md`, and `docs/archive/`.

## Context

SoundDesk opens on Search today; its empty state is About. The requested product behavior is a YouTube-like landing surface: on open, show audio recommendations derived from the user's own listening history.

There is no server-side recommender and no telemetry. `library_history` is device-local and ordered newest-first; history is written after 10 seconds of playback when `config.history` is enabled (default true). Recommendations and history must remain on-device per `AGENTS.md`. The only usable related-content source is the Invidious `/api/v1/videos/:id` payload's `recommendedVideos`, already used by radio and queue-related filling. The existing `drawer.discovery` pool is not a primary feed: it fills only after ~100 seconds of playback, stores frequency without timestamps, is shuffled on write, and has no recency ranking.

Constraints: zero new npm dependencies; initial JS entry <= 23.5 KB gzip; top-level views lazy-loaded; no server profiling; no new telemetry.

## Decision

### Settled decisions

1. **Surface and routing.** Home ("For You") becomes the default/base surface. Search becomes a pushed panel, not the base. Deep links (`/s/:id`, `?q=`, `?collection=`, share target) still open their target directly. PWA `launch_handler: focus-existing` may restore the last panel; acceptable.
2. **Composition.** One ranked "For You" feed, not shelves and not `drawer.discovery`. Items are related videos of up to three recent distinct-author history seeds.
3. **Rows.** Use the existing `StreamItem` component. All audio types are eligible: music videos, videos, podcasts, talks, live audio where playable.
4. **Seeds and ranking.** Use up to three most recent distinct-author items from `library_history` as seeds, newest seed weighted 3, then 2, then 1. Fetch their Invidious `recommendedVideos`, dedupe, and merge by seed weight. Exclude IDs already in `library_history` and the currently playing item. Do **not** exclude the entire queue (deliberate deviation from the first draft). Cap two items per channel. Accept durations 60 s–4 h. No favorites or subscription boost in v1.
5. **Freshness and cache.** Cache-first with background refresh. `drawer.homeFeed` is device-local (not cloud-synced), TTL 6 h. Refresh on open when stale or when the history fingerprint changed; provide a manual refresh button. Keep stale cache if refresh fails; show error plus retry only when no cache exists. Skip a failed seed if other seeds produced candidates.
6. **Queue handoff.** If `queueStore.list` is empty, or it was started from Home and has not been edited, play the feed as a Home session. If a manually built queue exists, play the clicked item one-off and resume the manual queue when it ends. Any manual queue edit clears the Home-session flag. Never replace a manually built queue.
7. **Feedback.** "Not interested" (hide item) and "Don't recommend this channel" (ban author) live in the item actions menu, Home only. Persist hidden IDs and banned authors in `drawer`, apply them at build/render time, and skip banned authors when choosing seeds. Provide a reset control in Settings.
8. **Empty history.** Show the existing About content plus a call to action to Search. If history is disabled, add one line explaining it plus a Settings link. Do not fabricate a generic/trending feed or fall back to session-only history.
9. **Size, paging, and queue population.** 24 rows initially; "Load more" appends 24; hard cap 72. Cache the deduped candidate pool, not only rendered rows. If the three initial seeds produce fewer than 24 valid candidates, fetch older seed authors until 24 or history is exhausted. "Load more" reveals remaining cached candidates first; if fewer than 24 remain, fetch older seed authors to fill the batch, up to 72. When a Home session starts, queue the cached pool after the clicked item, including not-yet-rendered items, so playback continues past the visible page. No infinite scroll.
10. **Navigation and shortcut.** Home is the first nav item. Order: Home, Queue, Search, Library, List. Keyboard `0` opens Home; existing `1`/`2`/`3` stay unchanged; the handler continues to ignore inputs and open dialogs. Nav label `nav_home` = "Home"; view title `home_title` = "For You". Portrait mode already hides `.nav-list-btn` (`src/styles/layout.css:437-439`), so portrait shows four icons (Home, Queue, Search, Library) and landscape/desktop shows five. Clicking Home while it is active scrolls to top; otherwise it replaces state to the base, not pushes.
11. **Search empty state.** Remove `<About />` from Search (`src/features/Search/index.tsx`); About becomes the Home empty state. Search autofocuses its input when opened without a query, shows recent searches plus suggestions, or a short hint when none. Existing query/results behavior is unchanged.
12. **Feedback refill and reset.** "Not interested" removes the item from cache and render immediately and persists the hidden ID. "Don't recommend this channel" removes all author items, persists the banned author, and skips the author in seed selection. Refill from cached unseen candidates first; if visible items drop below half a page (12 of 24), background refresh fills back to 24. Reset lives in Settings behind `confirm` (pattern at `src/features/Settings/index.tsx:155`) and clears hidden IDs, banned authors, and `drawer.homeFeed`. No per-action undo.
13. **Explanation and self-reinforcement.** The Home header shows subtitle "Based on your listening history" under the title; no per-item reason and no seed artist names. Plays from Home enter `library_history` normally after 10 s when `config.history` is on, and become seeds on the next refresh. No source tagging or exclusion in v1. The three-distinct-author and two-per-channel caps limit narrowing.

## Considered options

| Decision | Chosen | Rejected because |
|---|---|---|
| Where the feed lives | New Home tab | Reusing Search's empty state conflicts with persistent `searchStore.query`: after a search, returning to Search shows results, not Home. |
| Feed source | History seeds plus Invidious related videos | `drawer.discovery` is stale, shuffled, and timestamp-free; a server recommender would require telemetry and backend work. |
| Layout | Existing `StreamItem` rows | A card grid adds CSS and layout risk without changing behavior; deferred. |
| Freshness | Cache-first plus background refresh | On-open blocking fetch makes the landing depend on a flaky public instance; pool-only is stale and slow to fill. |
| Queue on play | Conditional handoff plus one-off/resume | Always replacing the queue destroys a manual queue; never queuing leaves playback stopped after one item. |
| Paging | 24 + 24, cap 72, cached pool | Infinite scroll adds network churn against public Invidious; a fixed 30 has no way to go deeper. |
| Feedback | Two local actions plus reset with confirm, no undo | A server-side dislike store adds backend work and conflicts with the zero-telemetry invariant; per-action undo adds state for menu-initiated actions. |
| Navigation | Five tabs, Home first | Replacing List hides a contextual surface; moving List elsewhere adds scope. |

## Consequences

- Routing must change: `openSubView("search")` currently replaces history state as the base view. With Home as the base, Search becomes a pushed panel and `closeSubView`, `popstate`, `resetList`, `start.ts`, and the App fallback must all agree. `handleNavClick` gains a `"home"` member; clicking Home while active scrolls to top, otherwise it replaces state to the base.
- New `MainFeature` / `Features` / `Context` member `"home"`. `NavBar` grows to five icons, but portrait mode already hides `.nav-list-btn`, so four are visible there. `HeaderNav` grows to five labels.
- All 20 locale files need new keys because `t()` has no fallback (`translations[key] || key`).
- The feed engine should live in the lazy Home chunk; the queue-handoff flag lives in `queueStore`, and the Home view sets it. `StreamItem` must not import the feed engine, so the entry bundle stays at <= 23.5 KB gzip. Pure ranking helpers live in a browser-free module for unit tests.
- `queueStore.homeSession` is in-memory only; queue mutations clear it. A reload starts with an empty queue and no Home session.
- The feed depends on a public Invidious instance; seed IDs leave the device transiently, as they already do during playback. History itself is never uploaded or profiled.
- Feed quality is bounded by the related-video graph; it will not match YouTube's account-level recommender.
- The cache is device-local and does not sync; a new device builds its own feed. Metadata only, up to 72 items, so localStorage growth stays bounded.
- About moves from the Search empty state to the Home empty state; Search's empty state becomes autofocus plus recent searches/suggestions.
- Reset is the escape hatch for both feedback actions; it does not clear `library_history`.

## Open questions

None. Implementation follows the decisions above.

## Out of scope

- Server-side recommendations, telemetry, or account profiling.
- Podcast chapters, grid layout, Shorts, autoplay-on-open, infinite scroll, cross-device feed sync.
- Per-action undo and a manage-hidden/banned list.
- Source tagging of Home plays.
