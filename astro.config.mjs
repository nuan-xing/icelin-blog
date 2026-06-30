import { defineConfig } from 'astro/config';
import rehypeResponsiveImages from './src/lib/rehype-responsive-images.mjs';

export default defineConfig({
  site: 'https://icelin-blog.pages.dev',
  markdown: {
    rehypePlugins: [[rehypeResponsiveImages, { sizes: '(max-width: 760px) calc(100vw - 28px), 760px' }]],
  },
});
