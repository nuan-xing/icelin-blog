(() => {
  'use strict';

  const root = document.getElementById('icelin-runtime');
  if (!root || root.dataset.runtimeBound === 'true') return;
  root.dataset.runtimeBound = 'true';

  const apiBase = String(window.ICELIN_API_URL || '').replace(/\/+$/, '');
  const transformBase = String(window.ICELIN_IMAGE_TRANSFORM_BASE || '').replace(/\/+$/, '');
  const mediaPublicBase = String(window.ICELIN_MEDIA_PUBLIC_URL || '').replace(/\/+$/, '');

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const escapeAttr = escapeHtml;
  const dateText = (value, long = false) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat('zh-CN', long
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  };
  const currentPath = () => decodeURIComponent(location.pathname).replace(/\/+$/, '') || '/';

  async function api(path) {
    const response = await fetch(`${apiBase}${path}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || '暂时无法读取内容。');
    return payload;
  }

  function mediaKey(url) {
    if (!mediaPublicBase || !url) return '';
    try {
      const source = new URL(url, location.origin);
      const base = new URL(mediaPublicBase);
      if (source.origin !== base.origin) return '';
      const basePath = base.pathname.replace(/\/+$/, '');
      if (basePath && !source.pathname.startsWith(`${basePath}/`)) return '';
      const keyPath = basePath ? source.pathname.slice(basePath.length) : source.pathname;
      return keyPath.replace(/^\/+/, '').split('/').filter(Boolean).map((part) => decodeURIComponent(part)).join('/');
    } catch {
      return '';
    }
  }

  function transformedImageSource(key, width) {
    if (!transformBase || !key) return '';
    return `${transformBase}/${String(key).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}?width=${width}`;
  }

  function imageSource(url, width, key = '') {
    if (!transformBase || !url) return url;
    return transformedImageSource(key || mediaKey(url), width) || url;
  }

  function imageMarkup(item, options = {}) {
    const { loading = 'lazy', sizes = '(max-width: 760px) calc(100vw - 28px), 760px', className = '' } = options;
    const src = item.imageUrl || item.coverUrl || '';
    const alt = item.alt || item.coverAlt || item.title || '';
    const key = item.imageKey || item.coverKey || mediaKey(src);
    if (!src) return '<span aria-hidden="true"></span>';
    const canTransform = Boolean(transformBase && key);
    const srcset = canTransform ? [480, 768, 1080, 1440, 1600, 1920]
      .map((width) => `${escapeAttr(imageSource(src, width, key))} ${width}w`).join(', ') : '';
    return `<img${className ? ` class="${escapeAttr(className)}"` : ''} src="${escapeAttr(canTransform ? imageSource(src, 1080, key) : src)}"${srcset ? ` srcset="${srcset}" sizes="${escapeAttr(sizes)}"` : ''} data-original-src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="${loading}" decoding="async" />`;
  }

  function setMetadata(title, description = '') {
    document.title = title === 'icelin' ? title : `${title} | icelin`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && description) meta.setAttribute('content', description);
  }

  function refreshEffects() {
    window.setTimeout(() => {
      window.__icelinRefreshLayout?.();
      document.dispatchEvent(new CustomEvent('icelin:content-rendered'));
    }, 0);
  }

  function setNav() {
    const path = currentPath();
    document.querySelectorAll('.nav a').forEach((link) => {
      const href = link.getAttribute('href') || '';
      const active = href === '/' ? path === '/' : path === href.replace(/\/$/, '') || path.startsWith(href.replace(/\/$/, '') + '/');
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function render(html, title = 'icelin', description = '') {
    root.innerHTML = html;
    setMetadata(title, description);
    setNav();
    root.querySelectorAll('img[data-original-src]').forEach((image) => {
      if (image.closest('a')) return;
      image.setAttribute('title', '点击查看原图');
      image.setAttribute('role', 'button');
      image.setAttribute('tabindex', '0');
    });
    refreshEffects();
  }

  function openOriginalImage(image) {
    const original = image.dataset.originalSrc;
    if (original) window.open(original, '_blank', 'noopener,noreferrer');
  }

  root.addEventListener('click', (event) => {
    const image = event.target instanceof HTMLImageElement ? event.target : null;
    if (!image?.dataset.originalSrc || image.closest('a')) return;
    openOriginalImage(image);
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const image = event.target instanceof HTMLImageElement ? event.target : null;
    if (!image?.dataset.originalSrc || image.closest('a')) return;
    event.preventDefault();
    openOriginalImage(image);
  });

  function notFound(message = '没有找到这页内容。') {
    render(`<div class="empty-state"><div><p>${escapeHtml(message)}</p><a class="text-link" href="/">返回首页</a></div></div>`, '未找到内容');
  }

  function renderHome(payload) {
    const posts = payload.posts || [];
    const photos = payload.photos || [];
    render(`
      <section class="hero">
        <p class="eyebrow">Personal journal & photography</p>
        <h1>icelin</h1>
        <p class="hero-copy">我把一些日常、光线和想法留在这里。也留下一点关于成都、公园、骑行、星空和自己的记录。</p>
      </section>
      <section class="section-grid">
        <div><div class="section-heading"><p class="eyebrow">Writing</p><h2>最近随笔</h2></div><div class="post-list">${posts.map((post) => `
          <a class="post-row" href="/writing/${encodeURIComponent(post.slug)}/"><time datetime="${escapeAttr(post.pubDate)}">${escapeHtml(dateText(post.pubDate))}</time><div><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.description)}</p></div></a>`).join('') || '<p>第一篇随笔正在准备中。</p>'}</div></div>
        <aside class="intro-panel"><p class="eyebrow">About</p><h2>你好，我是 icelin。</h2><p>我在成都上学，喜欢天文、骑行，也喜欢去自然里散步和发呆。这个小站会记录我探索自己、靠近生活的过程。</p><a class="text-link" href="/about/">阅读关于我</a></aside>
      </section>
      <section class="photo-strip" aria-label="摄影作品">${photos.slice(0, 3).map((photo) => `<a href="/photos/"><div class="photo-strip-frame">${imageMarkup(photo, { sizes: '(max-width: 760px) calc(100vw - 28px), 420px' })}</div><span>${escapeHtml(photo.title)}</span></a>`).join('')}</section>`, 'icelin', '生活随笔、摄影作品和个人日记。');
  }

  function renderWritingList(payload) {
    const posts = payload.posts || [];
    render(`<section class="page"><div class="section-heading"><p class="eyebrow">Writing</p><h1>生活随笔</h1><p>慢慢写下来的日常、想法和阶段性的自己。</p></div><div class="post-list spacious">${posts.map((post) => `<a class="post-row" href="/writing/${encodeURIComponent(post.slug)}/"><time datetime="${escapeAttr(post.pubDate)}">${escapeHtml(dateText(post.pubDate))}</time><div><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.description)}</p></div></a>`).join('') || '<div class="empty-state"><p>这里还没有随笔。</p></div>'}</div></section>`, '随笔');
  }

  function safeUrl(raw) {
    try {
      const url = new URL(String(raw).replace(/&amp;/g, '&'), location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function inlineMarkdown(source) {
    return source
      .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, alt, url) => {
        const safe = safeUrl(url);
        return safe ? imageMarkup({ imageUrl: safe, title: alt, alt }, { sizes: '(max-width: 760px) calc(100vw - 28px), 760px' }) : alt;
      })
      .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, url) => {
        const safe = safeUrl(url);
        return safe ? `<a href="${escapeAttr(safe)}"${safe.startsWith(location.origin) ? '' : ' target="_blank" rel="noreferrer"'}>${label}</a>` : label;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function markdownHtml(markdown) {
    const blocks = escapeHtml(markdown || '').trim().split(/\n{2,}/).filter(Boolean);
    return blocks.map((block) => {
      if (/^###\s+/.test(block)) return `<h3>${inlineMarkdown(block.replace(/^###\s+/, ''))}</h3>`;
      if (/^##\s+/.test(block)) return `<h2>${inlineMarkdown(block.replace(/^##\s+/, ''))}</h2>`;
      if (/^#\s+/.test(block)) return `<h1>${inlineMarkdown(block.replace(/^#\s+/, ''))}</h1>`;
      if (/^(?:[-*]\s+.+\n?)+$/.test(block)) return `<ul>${block.split('\n').filter(Boolean).map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      const imageOnly = block.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)$/);
      if (imageOnly) {
        const safe = safeUrl(imageOnly[2]);
        return safe ? `<figure>${imageMarkup({ imageUrl: safe, title: imageOnly[1], alt: imageOnly[1] }, { sizes: '(max-width: 760px) calc(100vw - 28px), 760px' })}<figcaption>${escapeHtml(imageOnly[1])}</figcaption></figure>` : '';
      }
      return `<p>${inlineMarkdown(block).replace(/\n/g, '<br />')}</p>`;
    }).join('');
  }

  function renderPost(payload) {
    const post = payload.post;
    render(`<article class="page prose"><a class="text-link" href="/writing/">返回随笔</a><p class="eyebrow">${escapeHtml(dateText(post.pubDate, true))}</p><h1>${escapeHtml(post.title)}</h1>${markdownHtml(post.body)}</article>`, post.title, post.description || '');
  }

  function topicHref(topic) {
    return ['qinglong-lake', 'astronomy'].includes(topic.slug) ? `/photos/${encodeURIComponent(topic.slug)}/` : `/photos/topics/${encodeURIComponent(topic.slug)}/`;
  }

  function topicFeature(topic) {
    const preview = (topic.photos || []).slice(0, 3);
    const previewContent = preview.length ? preview.map((photo) => imageMarkup(photo, { sizes: '(max-width: 760px) 31vw, 96px' })).join('') : imageMarkup({ imageUrl: topic.coverUrl, coverAlt: topic.coverAlt, title: topic.title }, { sizes: '(max-width: 760px) 31vw, 288px' });
    return `<a class="feature-link" href="${topicHref(topic)}"><div><p class="eyebrow">${escapeHtml(topic.eyebrow || 'Photo Story')}</p><h2>${escapeHtml(topic.title)}</h2><p>${escapeHtml(topic.description)}</p><span class="text-link">查看这个专栏</span></div><div class="feature-preview" aria-hidden="true">${previewContent}</div></a>`;
  }

  function renderPhotos(payload) {
    const photos = payload.photos || [];
    const topics = payload.topics || [];
    render(`<section class="page"><div class="section-heading"><p class="eyebrow">Life Images</p><h1>生活影像</h1><p>一些日常里被光线、时间和心情留下来的画面。</p></div><div class="feature-list">${topics.map(topicFeature).join('')}</div><div class="section-heading compact-heading"><p class="eyebrow">Recent</p><h2>最近的画面</h2></div><div class="photo-grid" data-masonry>${photos.map((photo) => `<figure class="photo-card"><div class="photo-frame">${imageMarkup(photo, { sizes: '(max-width: 760px) calc(100vw - 28px), 520px' })}</div><figcaption><span>${escapeHtml(photo.title)}</span><small>${escapeHtml(dateText(photo.pubDate))}${photo.location ? ` / ${escapeHtml(photo.location)}` : ''}</small><p>${escapeHtml(photo.caption || photo.alt)}</p></figcaption></figure>`).join('')}</div></section>`, '生活影像');
  }

  function renderTopic(payload) {
    const topic = payload.topic;
    const photos = topic.photos || [];
    render(`<section class="page"><div class="section-heading"><a class="text-link" href="/photos/">返回摄影</a><p class="eyebrow">${escapeHtml(topic.eyebrow || 'Photo Story')}</p><h1>${escapeHtml(topic.title)}</h1><p>${escapeHtml(topic.description)}</p></div>${photos.length ? `<div class="place-timeline">${photos.map((photo, index) => `<article class="place-entry"><time datetime="${escapeAttr(photo.pubDate)}">${escapeHtml(dateText(photo.pubDate))}</time><figure>${imageMarkup(photo, { loading: index < 2 ? 'eager' : 'lazy', sizes: '(max-width: 760px) calc(100vw - 28px), 916px' })}<figcaption><strong>${escapeHtml(photo.title)}</strong>${photo.caption || photo.alt ? `<span>${escapeHtml(photo.caption || photo.alt)}</span>` : ''}</figcaption></figure></article>`).join('')}</div>` : '<div class="empty-state"><p>这个专栏已经准备好了。等你在编辑室添加第一张图片后，它会出现在这里。</p></div>'}</section>`, topic.title, topic.description || '');
  }

  async function renderPath() {
    if (!apiBase) return notFound('博客尚未配置公开内容接口。');
    const path = currentPath();
    try {
      if (path === '/') return renderHome(await api('/v1/public/bootstrap'));
      if (path === '/writing') return renderWritingList(await api('/v1/public/posts'));
      if (path.startsWith('/writing/')) return renderPost(await api(`/v1/public/posts/${encodeURIComponent(path.slice('/writing/'.length))}`));
      if (path === '/photos') {
        const [photos, topics] = await Promise.all([api('/v1/public/photos'), api('/v1/public/topics')]);
        return renderPhotos({ photos: photos.photos, topics: topics.topics });
      }
      if (path.startsWith('/photos/topics/')) return renderTopic(await api(`/v1/public/topics/${encodeURIComponent(path.slice('/photos/topics/'.length))}`));
      if (path.startsWith('/photos/')) return renderTopic(await api(`/v1/public/topics/${encodeURIComponent(path.slice('/photos/'.length))}`));
      return notFound();
    } catch (error) {
      const message = error instanceof Error ? error.message : '暂时无法读取内容。';
      render(`<div class="empty-state"><div><p>${escapeHtml(message)}</p><button class="text-link" type="button" data-retry>重新加载</button></div></div>`, '内容暂不可用');
      root.querySelector('[data-retry]')?.addEventListener('click', renderPath);
    }
  }

  renderPath();
})();
