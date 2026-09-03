import { defineConfig, type Plugin } from 'vite';
import glsl from 'vite-plugin-glsl';

/**
 * Absolute URLs are mandatory in Open Graph tags — WhatsApp and several other
 * scrapers will not resolve a relative og:image — but the deploy URL is not
 * known until build time. Netlify exposes it, so substitute it then.
 */
function siteUrl(): Plugin {
  const url = (
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL ||
    process.env.VITE_SITE_URL ||
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
  plugins: [glsl({ compress: false }), siteUrl()],
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
