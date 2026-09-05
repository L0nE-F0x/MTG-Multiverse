/**
 * Title screen shown after boot, every visit, and again from the HUD wordmark.
 * The galaxy keeps turning behind it. Tour and Settings are the secondary
 * actions; the Wizards disclaimer and ApexForge credit sit at the bottom.
 */
import { isEmbedded } from '../core/embed.ts';
import { store } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';
import {
  BRAND_TAGLINE,
  BRAND_WORDMARK,
  CREDIT_HREF,
  CREDIT_LABEL,
  CREDIT_NAME,
  DISCLAIMER,
} from './brand.ts';
import { el, fmtInt, listen } from './dom.ts';
import { MANA_COLOR_HEX } from './theme.ts';
import '../styles/title.css';

export interface TitleHandle {
  open(): void;
  enter(): void;
  destroy(): void;
}

export interface TitleHost {
  toggleSettings(): void;
  closeSettings(): void;
  settingsOpen(): boolean;
  onTour(): void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function manaPips(className: string): HTMLElement {
  const row = el('div', { className });
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) {
    const pip = el('span', { className: 'mcu-title-pip' });
    const hex = MANA_COLOR_HEX[c] ?? '#888';
    pip.style.background = hex;
    pip.style.color = hex;
    row.append(pip);
  }
  return row;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

export function mountTitle(root: HTMLElement, universe: Universe, host: TitleHost): TitleHandle {
  const enterBtn = el('button', {
    className: 'mcu-title-enter',
    text: 'Enter the Multiverse',
    attrs: { type: 'button' },
  });
  const tourBtn = el('button', {
    className: 'mcu-title-btn',
    text: 'Tour',
    attrs: { type: 'button' },
  });
  const settingsBtn = el('button', {
    className: 'mcu-title-btn',
    text: 'Settings',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'mcu-settings-panel' },
  });

  const mark = el('img', {
    className: 'mcu-title-mark',
    // BASE_URL, not '/mark.svg': the site is also served from a subdirectory
    // when a host app embeds the build, and a root-absolute path resolves
    // against the host's origin, where this file does not exist.
    attrs: { src: `${import.meta.env.BASE_URL}mark.svg`, alt: '', width: '120', height: '120' },
  });

  const installBtn = el('button', {
    className: 'mcu-title-install',
    text: 'Install app',
    attrs: { type: 'button', hidden: '' },
  });

  const credit = el('p', { className: 'mcu-title-credit' }, [
    document.createTextNode(`${CREDIT_LABEL} `),
    el('a', {
      className: 'mcu-title-credit-link',
      text: CREDIT_NAME,
      attrs: { href: CREDIT_HREF, target: '_blank', rel: 'noopener noreferrer' },
    }),
  ]);

  const overlay = el(
    'div',
    {
      className: 'mcu-title',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'mcu-title-wordmark',
        'aria-hidden': 'true',
      },
    },
    [
      el('div', { className: 'mcu-title-vignette' }),
      el('div', { className: 'mcu-title-center' }, [
        mark,
        el('h1', {
          className: 'mcu-title-wordmark',
          text: BRAND_WORDMARK,
          attrs: { id: 'mcu-title-wordmark' },
        }),
        manaPips('mcu-title-pips'),
        el('p', { className: 'mcu-title-tagline', text: BRAND_TAGLINE }),
        el('p', {
          className: 'mcu-title-count',
          text: `${fmtInt(universe.count)} printings`,
        }),
        el('div', { className: 'mcu-title-actions' }, [
          enterBtn,
          el('div', { className: 'mcu-title-secondary' }, [tourBtn, settingsBtn]),
        ]),
      ]),
      el('div', { className: 'mcu-title-footer' }, [
        installBtn,
        credit,
        el('p', { className: 'mcu-title-disclaimer', text: DISCLAIMER }),
      ]),
    ],
  );
  root.append(overlay);

  let titleOpen = false;
  let savedAutoRotate = false;
  let deferredInstall: BeforeInstallPromptEvent | null = null;

  function syncRoot(): void {
    root.classList.toggle('mcu-root--title', titleOpen);
  }

  function syncSettingsBtn(): void {
    settingsBtn.setAttribute('aria-expanded', String(host.settingsOpen()));
  }

  function setTitleOpen(open: boolean): void {
    if (titleOpen === open) {
      syncRoot();
      return;
    }
    titleOpen = open;
    overlay.classList.toggle('mcu-title--open', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    syncRoot();
    if (open) {
      savedAutoRotate = store.state.visual.autoRotate;
      store.patchVisual({ autoRotate: true });
      if (store.state.shell !== 'title') store.set('shell', 'title');
      requestAnimationFrame(() => enterBtn.focus());
    } else {
      store.patchVisual({ autoRotate: savedAutoRotate });
      if (store.state.shell !== 'play') store.set('shell', 'play');
    }
  }

  function open(): void {
    host.closeSettings();
    setTitleOpen(true);
  }

  function enter(): void {
    host.closeSettings();
    setTitleOpen(false);
  }

  const offEnter = listen(enterBtn, 'click', enter);
  const offTour = listen(tourBtn, 'click', () => host.onTour());
  const offSettings = listen(settingsBtn, 'click', () => {
    host.toggleSettings();
    syncSettingsBtn();
  });

  const offInstall = listen(installBtn, 'click', () => {
    void deferredInstall?.prompt();
  });
  const offBip = listen(window, 'beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isStandalone() || isEmbedded()) return;
    deferredInstall = e as BeforeInstallPromptEvent;
    installBtn.hidden = false;
  });
  const offInstalled = listen(window, 'appinstalled', () => {
    deferredInstall = null;
    installBtn.hidden = true;
  });
  if (isStandalone() || isEmbedded()) installBtn.hidden = true;

  const offKeydown = listen(window, 'keydown', (e) => {
    const ev = e as KeyboardEvent;
    if (!titleOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (host.settingsOpen()) {
        host.closeSettings();
        syncSettingsBtn();
      }
    }
  });

  const offShell = store.on('shell', (mode) => {
    if (mode === 'play') {
      host.closeSettings();
      if (titleOpen) setTitleOpen(false);
    } else if (mode === 'title' && !titleOpen) {
      setTitleOpen(true);
    }
  });

  const offVisual = store.on('visual', syncSettingsBtn);

  setTitleOpen(true);

  return {
    open,
    enter,
    destroy() {
      offEnter();
      offTour();
      offSettings();
      offInstall();
      offBip();
      offInstalled();
      offKeydown();
      offShell();
      offVisual();
      if (titleOpen) store.patchVisual({ autoRotate: savedAutoRotate });
      if (store.state.shell === 'title') store.set('shell', 'play');
      overlay.remove();
      root.classList.remove('mcu-root--title');
    },
  };
}
