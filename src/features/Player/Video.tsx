import { createSignal, For, createEffect, Show, onMount, onCleanup } from "solid-js";
import { generateImageUrl } from "@utils";
import { config, setConfig } from "@config";
import { proxyHandler } from "@modules/playback";
import { playerStore, playNext, setPlayerStore, t, queueStore } from "@stores";

export default function() {

  const [data, setData] = createSignal({
    video: [] as string[][],
    captions: [] as Invidious['captions']
  });
  let video!: HTMLVideoElement;
  let selector!: HTMLSelectElement;
  let resumeOnVisible = false;
  let userPaused = false;

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      resumeOnVisible = playerStore.isWatching && !userPaused;
      return;
    }
    if (!resumeOnVisible) return;
    resumeOnVisible = false;
    if (
      !video?.src ||
      !playerStore.isWatching ||
      playerStore.audio.paused ||
      !video.paused
    )
      return;
    video.currentTime = playerStore.audio.currentTime;
    video.play().catch(() => {});
  };

  onMount(() =>
    document.addEventListener("visibilitychange", handleVisibilityChange),
  );
  onCleanup(() =>
    document.removeEventListener("visibilitychange", handleVisibilityChange),
  );


  const savedQ = config.watchMode || { worst: '144p', low: '240', medium: '360p', high: '720p' }[config.quality];

  createEffect(async () => {
    const streamId = playerStore.stream.id;
    const data = playerStore.data as Invidious & { id?: string };
    if (!streamId || !data?.adaptiveFormats?.length || data.id !== streamId)
      return;
    playerStore.audio.pause();

    const supportsAv1 = await navigator.mediaCapabilities
      .decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="av01.0.00M.08"',
          bitrate: 1e7,
          framerate: 22,
          height: 720,
          width: 1280
        }
      })
      .then(result => result.supported);

    if (streamId !== playerStore.stream.id) return;

    const hasAv1 = data.adaptiveFormats.filter(v => v.type?.includes('av01')).length === 4 ? data.adaptiveFormats.find(v => v.type?.includes('av01'))?.url : false;
    const hasVp9 = data.adaptiveFormats.find(v => v.type?.includes('vp9'))?.url;

    const videoStreams = data.adaptiveFormats
      .filter(f => {
        if (!f.type.startsWith('video')) return false;
        const av1 = hasAv1 && supportsAv1 && f.type?.includes('av01');
        if (av1) return true;
        const vp9 = !hasAv1 && f.type?.includes('vp9');
        if (vp9) return true;
        const avc = !hasVp9 && f.type?.includes('avc1');
        if (avc) return true;
        return false;
      })
      .map(f => ([f.resolution || f.quality, f.url]));

    video.currentTime = playerStore.audio.currentTime;
    setData({
      video: videoStreams,
      captions: data.captions.map(c => ({
        ...c,
        url: playerStore.proxy + c.url
      }))
    });

    delete video.dataset.retried;

    // Providers name resolutions differently (Invidious vs RapidAPI), so fall
    // back to the first available stream instead of a placeholder option.
    const initialStream = videoStreams.find(v => v[0] === savedQ) ?? videoStreams[0];
    if (initialStream?.[1]) {
      const nextSrc = proxyHandler(initialStream[1], true);
      selector.value = initialStream[1];
      if (video.src !== nextSrc) {
        video.pause();
        video.src = nextSrc;
      }
    } else {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }

  });

  function close() {
    video.pause();
    setPlayerStore('status', '');
    setPlayerStore('isWatching', false);
  }

  return (
    <div class='watcher'>
      <video
        ref={video}
        controls
        poster={generateImageUrl(playerStore.stream.id, 'mq')}
        onplay={() => {
          userPaused = false;
          video.currentTime = playerStore.audio.currentTime;
          playerStore.audio.play();
        }}
        onpause={() => {
          if (document.visibilityState !== "visible") return;
          userPaused = true;
          if (playerStore.isWatching)
            playerStore.audio.pause();
          playerStore.audio.currentTime = video.currentTime;
        }}
        onended={() => {
          if (!queueStore.list.length) {
            close();
            playNext();
          }
        }}
        onwaiting={() => {
          if (document.visibilityState === "visible" && !playerStore.audio.paused)
            playerStore.audio.pause();
        }}
        ontimeupdate={() => {
          const diff = playerStore.audio.currentTime - video.currentTime;
          const vpr = video.playbackRate;
          const npr = vpr - diff;
          if (npr < 0) return;
          const rpr = Math.round(npr * 100) / 100;
          if (rpr !== playerStore.audio.playbackRate)
            playerStore.audio.playbackRate = rpr;

        }}
        onloadstart={() => {
          video.currentTime = playerStore.audio.currentTime;
          video.play().catch(() => {});
        }}
        onplaying={() => {
          if (playerStore.audio.paused)
            playerStore.audio.play();
        }}
        onseeked={() => {
          playerStore.audio.currentTime = video.currentTime;
        }}
        onratechange={() => {
          playerStore.audio.playbackRate = video.playbackRate;
        }}
        onerror={async () => {
          if (!video.src) return;
          const oldOrigin = new URL(video.src).origin;
          const { default: audioErrorHandler } = await import("@modules/audioErrorHandler");
          audioErrorHandler(video);
          if (video.dataset.retried) {
            const { proxy, audio } = playerStore;
            audio.src = audio.src.replace(oldOrigin, proxy);
          }
        }}

      >
        <Show when={data().captions.length}>
          <For each={data().captions}>
            {(v) =>
              <track
                kind="subtitles"
                src={v.url}
                srclang={v.language_code}
                label={v.label}
              >
              </track>
            }
          </For>
        </Show>

      </video>

      <div class="watcher-bar">

        <button onclick={close}>{t('close')}</button>

        <select
          ref={selector}
          onchange={_ => {
            video.src = proxyHandler(_.target.value, true);
            video.currentTime = playerStore.audio.currentTime;
            if (config.watchMode)
              setConfig('watchMode', _.target.selectedOptions[0].textContent as string);
          }}
        >

          <option>{t('player_video_resolution')}</option>
          <For each={data().video}>
            {(f) =>
              <option value={f[1]} selected={f[0] === savedQ}>
                {f[0]}
              </option>
            }
          </For>
        </select>
      </div>
    </div>

  );
}
