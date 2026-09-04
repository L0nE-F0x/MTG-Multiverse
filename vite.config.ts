import { defineConfig, type Plugin } from 'vite';
import glsl from 'vite-plugin-glsl';

/**
 * Absolute URLs are mandatory in Open Graph tags — WhatsApp and several other
 * scrapers will not resolve a relative og:image — but the deploy URL is not
 * known until build time. Netlify exposes it, so substitute it then.
 */
function siteUrl(): Plugin {
  // Netlify sets both, and they differ. `URL` is the canonical site address;
  // `DEPLOY_PRIME_URL` is this particular deploy's address, which for a branch
  // deploy of main is the branch-prefixed `main--<site>.netlify.app`. Taking
  // DEPLOY_PRIME_URL first meant the production site advertised og:url and
  // og:image on a hostname nobody would ever share. Previews still want to
  // reference themselves, so the choice is by context, not by precedence.
  const env = process.env;
  const url = (
    (env.CONTEXT === 'production' ? env.URL : env.DEPLOY_PRIME_URL || env.URL) ||
    env.VITE_SITE_URL ||
    'https://mtg-multiverse.netlify.app'
  ).replace(/\/$/, '');

  return {
    name: 'mcu-site-url',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', url),
    },
  };
}

export default defineConfig({
  /**
   * Relative asset URLs, so the built site works from a subdirectory as well
   * as from a domain root. Filthy Net Deck vendors `dist/` into its own
   * `public/aetherfield/`, and an absolute `/assets/…` there would resolve
   * against the host app's origin and collide with the host's own bundle.
   * The data loads already use document-relative paths, so this is the only
   * change the embed needs.
   */
  base: './',
  plugins: [glsl({ compress: false }), siteUrl()],
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
