import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://icelin-blog.pages.dev',
  integrations: [sitemap()],
});
