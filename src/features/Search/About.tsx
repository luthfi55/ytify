import './About.css';
import { createSignal, lazy, Show } from 'solid-js';
import { t } from '@stores';
import { BRAND } from '@brand';

const EasyUsageGuide = lazy(() => import("./EasyUsageGuide"));

export default function () {
  const [showGuide, setShowGuide] = createSignal(false);

  return (
    <div class="about">
      <img class="brandMark" src="/sounddesk.svg" width="72" height="72" alt={BRAND.name} />

      {t('about_description')}
      <br />
      <button
        class="guideTrigger"
        type="button"
        aria-expanded={showGuide()}
        onclick={() => setShowGuide(!showGuide())}
      >
        {t('about_learn_more')}
      </button>

      <Show when={showGuide()}>
        <EasyUsageGuide />
      </Show>
      <br />
      <p>{t('about_support_earth')}&nbsp;
        <a
          href='https://en.m.wikipedia.org/wiki/Individual_action_on_climate_change' target='_blank'><b>{t('about_lifestyle_changes')}</b></a>
      </p>
      <br />
      <p>
        <a href={BRAND.repo} target="_blank">{t('about_source_code')}</a>
        &nbsp;·&nbsp;{BRAND.license}
      </p>
      <br />
    </div >
  );
}
