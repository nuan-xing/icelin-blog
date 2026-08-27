(() => {
  'use strict';

  const root = document.getElementById('admin-root');
  const configuredApi = String(window.ICELIN_API_URL || '').replace(/\/+$/, '');
  const configuredMedia = String(window.ICELIN_MEDIA_PUBLIC_URL || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'icelin-editor-session';
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    summary: null,
    mediaFilter: 'all',
    mediaSearch: '',
  };

  if (!configuredApi) {
    root.innerHTML = '<main class="login-page"><section class="login-card"><span class="brand-mark" aria-hidden="true"></span><h1>编辑室尚未配置</h1><p>缺少公开 API 地址，请检查 <code>/api-config.js</code>。</p></section></main>';
    return;
  }

  const collectionInfo = {
    writing: { api: 'posts', label: '随笔', singular: '随笔', description: '写下日常、念头与旅途。', symbol: '▤' },
    photos: { api: 'photos', label: '摄影', singular: '摄影作品', description: '保存独立摄影作品及其说明。', symbol: '▧' },
    topics: { api: 'topics', label: '专题', singular: '专题', description: '在一个专栏中编排多张照片与说明。', symbol: '◫' },
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const escapeAttr = escapeHtml;
  const today = () => new Date().toISOString().slice(0, 10);
  const dateValue = (value) => {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.valueOf()) ? today() : date.toISOString().slice(0, 10);
  };
  const displayDate = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.valueOf())) return '未设置日期';
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  };
  function routeParts() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  }

  function go(path) {
    const next = `#/${String(path || '').replace(/^#?\/?/, '')}`;
    if (window.location.hash === next) renderRoute();
    else window.location.hash = next;
  }

  function toast(message, tone = '') {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.append(stack);
    }
    const item = document.createElement('div');
    item.className = `toast ${tone}`.trim();
    item.textContent = message;
    stack.append(item);
    window.setTimeout(() => item.remove(), 4600);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${configuredApi}${path}`, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;
    if (!response.ok) {
      if (response.status === 401 && path !== '/v1/admin/login') {
        state.token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        renderLogin('登录已失效，请重新输入密码。');
      }
      throw new Error(payload?.error || `请求失败（${response.status}）`);
    }
    return payload;
  }

  async function refreshSummary() {
    const payload = await api('/v1/admin/summary');
    state.summary = payload.summary;
    return payload.summary;
  }

  function sidebar(active) {
    const count = state.summary || {};
    const link = (path, label, symbol, value, key) => `
      <a class="side-link" href="#/${path}"${active === key ? ' aria-current="page"' : ''}>
        <span class="side-link-label"><span class="side-symbol" aria-hidden="true">${symbol}</span>${label}</span>
        <small>${value ?? 0}</small>
      </a>`;
    return `
      <aside class="sidebar">
        <a class="brand-link" href="#/collections/writing" aria-label="icelin 编辑室">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-copy"><strong>icelin 编辑室</strong><span>写下日常，收藏光线</span></span>
        </a>
        <section class="side-section" aria-label="内容集合">
          <span class="side-label">集合</span>
          <nav class="side-nav">
            ${link('collections/writing', '随笔', '▤', count.writing, 'writing')}
            ${link('collections/photos', '摄影', '▧', count.photos, 'photos')}
            ${link('collections/topics', '专题', '◫', count.topics, 'topics')}
          </nav>
        </section>
        <section class="side-section" aria-label="媒体资源">
          <span class="side-label">媒体</span>
          <nav class="side-nav">${link('media', 'R2 图库', '▦', count.media, 'media')}</nav>
        </section>
        <div class="sidebar-footer">
          <a href="/" target="_blank" rel="noreferrer">查看博客 ↗</a>
          <button type="button" data-action="logout">退出编辑室</button>
        </div>
      </aside>`;
  }

  function appShell(active, breadcrumb, content, actions = '') {
    root.innerHTML = `
      <div class="app-shell">
        ${sidebar(active)}
        <div class="workspace">
          <header class="topbar">
            <div class="breadcrumb">${breadcrumb}</div>
            <div class="top-actions">${actions}<a class="button" href="/" target="_blank" rel="noreferrer">查看博客 ↗</a></div>
          </header>
          <main class="workspace-main">${content}</main>
        </div>
      </div>`;
  }

  function renderLogin(message = '') {
    root.innerHTML = `
      <main class="login-page">
        <form class="login-card" data-login-form>
          <span class="brand-mark" aria-hidden="true"></span>
          <h1>icelin 编辑室</h1>
          <p>内容与图片均保存在你的 Cloudflare D1 和 R2 中。</p>
          ${message ? `<div class="notice error" role="alert">${escapeHtml(message)}</div>` : ''}
          <div class="field" style="margin-top:18px">
            <label for="editor-password">编辑室密码</label>
            <input id="editor-password" name="password" type="password" autocomplete="current-password" required autofocus />
          </div>
          <div class="form-actions"><span></span><button class="button primary" type="submit">进入编辑室</button></div>
        </form>
      </main>`;
  }

  function listHeading(info) {
    return `
      <div class="page-heading">
        <div><p class="eyebrow">内容集合</p><h1>${info.label}</h1><p>${info.description}</p></div>
        <button class="button primary" type="button" data-action="new-entry" data-collection="${info.key}">新建${info.singular}</button>
      </div>`;
  }

  function renderList(collection, items) {
    const info = { ...collectionInfo[collection], key: collection };
    const rows = items.map((item) => {
      const description = collection === 'writing' ? item.description : collection === 'photos' ? `${item.location || '未填写地点'} · ${item.caption || item.alt || '暂无图片说明'}` : `${item.description || '暂无专题说明'} · ${item.photos?.length || 0} 张照片`;
      const status = collection === 'writing' ? `<span class="status-dot ${item.draft ? '' : 'published'}">${item.draft ? '草稿' : '已发布'}</span>` : `<span class="status-dot published">${collection === 'topics' ? `${item.photos?.length || 0} 张` : displayDate(item.pubDate)}</span>`;
      return `
        <article class="entry-row">
          <div><div class="entry-title">${escapeHtml(item.title)}</div><div class="entry-summary">${escapeHtml(description)}</div></div>
          <div class="entry-meta">${status}</div>
          <a class="button" href="#/collections/${collection}/entries/${encodeURIComponent(item.slug)}">编辑</a>
        </article>`;
    }).join('');
    appShell(collection, `<strong>${info.label}</strong>`, `${listHeading(info)}${rows ? `<section class="panel entry-list">${rows}</section>` : emptyState(`还没有${info.singular}`, `新建第一条${info.singular}，内容会直接写入 D1。`)}`);
  }

  function emptyState(title, copy) {
    return `<section class="empty-state"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div></section>`;
  }

  function renderMediaField({ name, label, key = '', folder = '', helper = '', disabled = false }) {
    const url = key ? mediaUrl(key) : '';
    const permission = disabled ? ' disabled' : '';
    const preview = url ? `<img src="${escapeAttr(url)}" alt="" />` : '<span aria-hidden="true">图片</span>';
    return `
      <div class="media-field" data-media-field="${escapeAttr(name)}" data-key="${escapeAttr(key)}" data-folder="${escapeAttr(folder)}" data-disabled="${disabled ? 'true' : 'false'}">
        <span class="field-label">${escapeHtml(label)}</span>
        <div class="media-drop${disabled ? ' is-disabled' : ''}" tabindex="0">
          <div class="media-drop-preview" data-media-preview>${preview}</div>
          <div class="media-drop-copy">
            <strong data-media-title>${key ? escapeHtml(key.split('/').pop()) : '拖拽图片到这里'}</strong>
            <span data-media-name>${key ? escapeHtml(key) : (helper || (folder ? `将上传至 R2 /${folder}/` : '请先保存条目后再上传'))}</span>
            <div class="media-drop-actions">
              <button class="button quiet" type="button" data-action="browse-image"${permission}>选择图片</button>
              ${key ? '<button class="button quiet" type="button" data-action="clear-image">移除引用</button>' : ''}
            </div>
            <span class="media-progress" data-media-progress></span>
          </div>
          <input class="media-file-input" data-upload-input type="file" accept="image/*"${permission} />
        </div>
      </div>`;
  }

  function field(name, label, value = '', options = {}) {
    const { type = 'text', full = false, hint = '', placeholder = '', disabled = false } = options;
    const common = `name="${escapeAttr(name)}"${disabled ? ' disabled' : ''}`;
    let control;
    if (type === 'textarea') control = `<textarea ${common} placeholder="${escapeAttr(placeholder)}">${escapeHtml(value)}</textarea>`;
    else control = `<input ${common} type="${type}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" />`;
    return `<div class="field${full ? ' full' : ''}"><label for="${escapeAttr(name)}">${escapeHtml(label)}</label>${control}${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}</div>`;
  }

  function textArea(name, label, value = '', options = {}) {
    const { full = true, hint = '', className = '' } = options;
    return `<div class="field${full ? ' full' : ''}"><label for="${escapeAttr(name)}">${escapeHtml(label)}</label><textarea class="${escapeAttr(className)}" name="${escapeAttr(name)}">${escapeHtml(value)}</textarea>${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}</div>`;
  }

  function entryForm(collection, item, isNew) {
    const info = collectionInfo[collection];
    const title = isNew ? `新建${info.singular}` : `编辑${info.singular}`;
    const slug = item.slug || '';
    const folder = collection === 'topics' ? slug : '';
    let fields = '';
    if (collection === 'writing') {
      fields = `
        ${field('title', '标题', item.title, { placeholder: '给这篇随笔一个标题' })}
        ${field('pubDate', '发布日期', dateValue(item.pubDate), { type: 'date' })}
        ${field('description', '摘要', item.description, { full: true, placeholder: '在列表中展示的一句话摘要' })}
        ${field('tags', '标签', Array.isArray(item.tags) ? item.tags.join('，') : (item.tags || ''), { hint: '用逗号分隔，例如：日常，骑行' })}
        <div class="field"><span class="field-label">发布状态</span><label class="check-row"><input type="checkbox" name="draft"${item.draft ? ' checked' : ''} /> 保存为草稿</label></div>
        ${renderMediaField({ name: 'bodyImage', label: '插入正文图片', folder: 'writing', helper: '拖入后会上传到 R2 /writing/，并自动插入 Markdown。' })}
        ${textArea('body', '正文（Markdown）', item.body, { className: 'body-editor', hint: '支持 Markdown。正文中拖拽图片会上传到 R2 /writing/。' })}`;
    } else if (collection === 'photos') {
      fields = `
        ${field('title', '标题', item.title, { placeholder: '例如：雨后的西湖' })}
        ${field('location', '地点', item.location, { placeholder: '可留空' })}
        ${field('pubDate', '拍摄日期', dateValue(item.pubDate), { type: 'date' })}
        ${renderMediaField({ name: 'imageKey', label: '图片', key: item.imageKey || '', folder: 'photos', helper: '拖拽或选择图片，将上传到 R2 /photos/。' })}
        ${field('alt', '图片描述', item.alt, { full: true, placeholder: '用于网站展示和无障碍阅读' })}
        ${textArea('caption', '说明', item.caption, { hint: '显示在摄影详情中，可留空。' })}`;
    } else {
      fields = `
        ${field('title', '专题名称', item.title, { placeholder: '例如：青龙湖' })}
        ${field('eyebrow', '小标题', item.eyebrow, { placeholder: '例如：自然光影' })}
        ${textArea('description', '专题说明', item.description, { hint: '用几句话说明这个专题的主题。' })}
        ${renderMediaField({ name: 'coverKey', label: '专题封面', key: item.coverKey || '', folder, disabled: !folder, helper: folder ? `将上传至 R2 /${folder}/` : '请先保存专题，系统会创建对应的 R2 文件夹。' })}
        ${field('coverAlt', '封面图片描述', item.coverAlt, { full: true, placeholder: '给封面图片的一句话描述' })}
        <div class="field full"><span class="field-label">专题图片</span><span class="hint">专题中的图片固定上传到 R2 /${escapeHtml(folder || '专题-slug')}/，可增加、删除并调整顺序。</span><div class="topic-photo-list" data-topic-photo-list>${(item.photos || []).map((photo, index) => topicPhotoForm(photo, index, folder)).join('')}</div><button class="button" type="button" data-action="add-topic-photo"${folder ? '' : ' disabled'}>添加一张图片</button></div>`;
    }
    const notice = collection === 'topics' && isNew ? '<div class="notice">先保存专题一次，系统会生成 slug 并启用对应 R2 文件夹上传。</div>' : '';
    return `
      <div class="page-heading"><div><p class="eyebrow">${escapeHtml(info.label)}</p><h1>${title}</h1><p>${collection === 'topics' ? '编辑专题说明，编排其中的照片；图片只会上传到该专题对应的 R2 文件夹。' : info.description}</p></div></div>
      ${notice}
      <form class="form-layout" data-entry-form data-collection="${collection}" data-slug="${escapeAttr(slug)}">
        <section class="panel editor-panel"><div class="form-grid">${fields}</div><div class="form-actions"><button class="button danger" type="button" data-action="delete-entry"${isNew ? ' disabled' : ''}>删除</button><div class="form-actions-group"><a class="button" href="#/collections/${collection}">取消</a><button class="button primary" type="submit">${isNew ? '创建并保存' : '保存修改'}</button></div></div></section>
        <aside class="editor-side"><div class="side-note"><strong>数据保存位置</strong>文字和结构化内容保存到 D1；图片原件只保存在 R2。</div><div class="side-note"><strong>${collection === 'topics' ? '专题上传规则' : '图片上传规则'}</strong>${collection === 'topics' ? (folder ? `当前专题图片会进入 <code>/${escapeHtml(folder)}/</code>` : '保存专题后会自动确定 R2 文件夹。') : collection === 'writing' ? '正文图片会进入 <code>/writing/</code>。' : '摄影图片会进入 <code>/photos/</code>。'}</div></aside>
      </form>`;
  }

  function topicPhotoForm(photo = {}, index = 0, folder = '') {
    return `
      <article class="topic-photo" data-topic-photo>
        <div class="topic-photo-head"><strong>第 ${index + 1} 张</strong><span><button class="button quiet" type="button" data-action="move-topic-photo" data-direction="up">上移</button><button class="button quiet" type="button" data-action="move-topic-photo" data-direction="down">下移</button><button class="button quiet danger" type="button" data-action="remove-topic-photo">移除</button></span></div>
        <div class="topic-photo-grid">
          ${field('topic-title', '标题', photo.title || '', { placeholder: '图片标题' })}
          ${field('topic-date', '拍摄日期', dateValue(photo.pubDate), { type: 'date' })}
          ${renderMediaField({ name: 'topic-image', label: '图片', key: photo.imageKey || '', folder, disabled: !folder, helper: folder ? `将上传至 R2 /${folder}/` : '请先保存专题。' })}
          ${field('topic-alt', '图片描述', photo.alt || '', { placeholder: '图片的替代文字' })}
          ${textArea('topic-caption', '说明', photo.caption || '', { full: true })}
        </div>
      </article>`;
  }

  function mediaUrl(key) {
    if (!key) return '';
    return `${configuredMedia}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
  }

  function renderEntry(collection, item, isNew) {
    const info = collectionInfo[collection];
    appShell(collection, `<a href="#/collections/${collection}">${info.label}</a><span class="breadcrumb-separator">/</span><strong>${isNew ? `新建${info.singular}` : escapeHtml(item.title)}</strong>`, entryForm(collection, item, isNew));
  }

  function galleryUploadForm(topics) {
    const options = [`<option value="photos">摄影 /photos/</option>`, `<option value="writing">随笔 /writing/</option>`]
      .concat(topics.map((topic) => `<option value="${escapeAttr(topic.slug)}">专题 /${escapeHtml(topic.slug)}/</option>`)).join('');
    return `
      <section class="panel editor-panel" style="margin-bottom:24px">
        <div class="form-grid">
          <div class="field"><label for="gallery-folder">上传到</label><select id="gallery-folder" name="gallery-folder">${options}</select><span class="hint">专题文件夹来自已保存的专题；无需在 Cloudflare 控制台手动建目录。</span></div>
          <div class="field"><span class="field-label">上传图片</span><div class="media-drop" data-gallery-drop tabindex="0"><div class="media-drop-preview"><span aria-hidden="true">R2</span></div><div class="media-drop-copy"><strong>拖拽到这里上传</strong><span>图片直接进入上方所选的 R2 文件夹。</span><div class="media-drop-actions"><button class="button quiet" type="button" data-action="browse-gallery-image">选择图片</button></div><span class="media-progress" data-gallery-progress></span></div><input class="media-file-input" data-gallery-input type="file" accept="image/*" /></div></div>
        </div>
      </section>`;
  }

  function mediaCard(asset) {
    const used = Array.isArray(asset.usedBy) && asset.usedBy.length > 0;
    const usage = used ? asset.usedBy.map((item) => `${item.collection === 'writing' ? '随笔' : item.collection === 'photos' ? '摄影' : '专题'} · ${item.title}`).join('、') : '尚未添加到内容';
    return `
      <article class="asset">
        <a class="asset-thumb" href="${escapeAttr(asset.imageUrl)}" target="_blank" rel="noreferrer"><img src="${escapeAttr(asset.imageUrl)}" alt="" loading="lazy" /></a>
        <div class="asset-body"><div class="asset-name" title="${escapeAttr(asset.name)}">${escapeHtml(asset.name)}</div><div class="asset-path">/${escapeHtml(asset.key)}</div><span class="badge ${used ? 'used' : 'unused'}">${used ? '已添加' : '未添加'}</span><div class="asset-usage">${escapeHtml(usage)}</div><div class="form-actions-group"><button class="button quiet" type="button" data-action="copy-media-url" data-url="${escapeAttr(asset.imageUrl)}">复制链接</button><button class="button quiet danger" type="button" data-action="delete-media" data-key="${escapeAttr(asset.key)}" data-used="${used ? 'true' : 'false'}">删除</button></div></div>
      </article>`;
  }

  async function renderMedia() {
    const [mediaPayload, topicsPayload] = await Promise.all([api('/v1/admin/media'), api('/v1/admin/topics')]);
    const all = mediaPayload.objects || [];
    const query = state.mediaSearch.trim().toLowerCase();
    const assets = all.filter((asset) => {
      const used = asset.usedBy?.length > 0;
      if (state.mediaFilter === 'used' && !used) return false;
      if (state.mediaFilter === 'unused' && used) return false;
      return !query || `${asset.key} ${asset.usedBy?.map((item) => item.title).join(' ') || ''}`.toLowerCase().includes(query);
    });
    const content = `
      <div class="page-heading"><div><p class="eyebrow">Cloudflare R2</p><h1>R2 图库</h1><p>全部图片只存储在 R2。可筛选已经添加到内容和仍未使用的照片。</p></div></div>
      ${galleryUploadForm(topicsPayload.items || [])}
      <div class="gallery-toolbar"><button class="filter" type="button" data-action="set-media-filter" data-filter="all" aria-pressed="${state.mediaFilter === 'all'}">全部 ${all.length}</button><button class="filter" type="button" data-action="set-media-filter" data-filter="used" aria-pressed="${state.mediaFilter === 'used'}">已添加 ${all.filter((item) => item.usedBy?.length).length}</button><button class="filter" type="button" data-action="set-media-filter" data-filter="unused" aria-pressed="${state.mediaFilter === 'unused'}">未添加 ${all.filter((item) => !item.usedBy?.length).length}</button><input class="search" type="search" data-media-search value="${escapeAttr(state.mediaSearch)}" placeholder="搜索文件名或引用内容" /></div>
      ${assets.length ? `<section class="asset-grid">${assets.map(mediaCard).join('')}</section>` : emptyState('没有符合条件的图片', '调整筛选条件，或上传一张新图片。')}`;
    appShell('media', '<strong>R2 图库</strong>', content);
  }

  async function renderRoute() {
    if (!state.token) return renderLogin();
    try {
      if (!state.summary) await refreshSummary();
      const parts = routeParts();
      if (parts[0] === 'media') return await renderMedia();
      const collection = parts[1] || 'writing';
      if (!collectionInfo[collection]) return go('collections/writing');
      if (parts[2] === 'entries') {
        const slug = parts[3] || '';
        if (slug === 'new' || !slug) {
          const defaults = collection === 'writing' ? { title: '', description: '', pubDate: today(), tags: [], body: '', draft: false } : collection === 'photos' ? { title: '', location: '', pubDate: today(), imageKey: '', alt: '', caption: '' } : { title: '', eyebrow: '', description: '', coverKey: '', coverAlt: '', photos: [] };
          return renderEntry(collection, defaults, true);
        }
        const data = await api(`/v1/admin/${collectionInfo[collection].api}/${encodeURIComponent(slug)}`);
        return renderEntry(collection, data.item, false);
      }
      const data = await api(`/v1/admin/${collectionInfo[collection].api}`);
      renderList(collection, data.items || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开编辑室。';
      appShell('writing', '<strong>编辑室</strong>', `<section class="empty-state"><div><strong>暂时无法读取内容</strong><span>${escapeHtml(message)}</span><div style="margin-top:18px"><button class="button primary" type="button" data-action="retry-route">重试</button></div></div></section>`);
      toast(message, 'error');
    }
  }

  function readMediaKey(container, name) {
    return container.querySelector(`[data-media-field="${CSS.escape(name)}"]`)?.dataset.key || '';
  }

  function readEntry(form) {
    const collection = form.dataset.collection;
    const value = (name) => form.querySelector(`[name="${CSS.escape(name)}"]`)?.value?.trim() || '';
    if (collection === 'writing') return {
      title: value('title'), pubDate: value('pubDate'), description: value('description'), tags: value('tags'), draft: Boolean(form.querySelector('[name="draft"]')?.checked), body: value('body'),
    };
    if (collection === 'photos') return {
      title: value('title'), location: value('location'), pubDate: value('pubDate'), imageKey: readMediaKey(form, 'imageKey'), alt: value('alt'), caption: value('caption'),
    };
    const photos = [...form.querySelectorAll('[data-topic-photo]')].map((card) => ({
      title: card.querySelector('[name="topic-title"]')?.value?.trim() || '',
      pubDate: card.querySelector('[name="topic-date"]')?.value || today(),
      imageKey: readMediaKey(card, 'topic-image'),
      alt: card.querySelector('[name="topic-alt"]')?.value?.trim() || '',
      caption: card.querySelector('[name="topic-caption"]')?.value?.trim() || '',
    })).filter((photo) => photo.title || photo.imageKey);
    return { title: value('title'), eyebrow: value('eyebrow'), description: value('description'), coverKey: readMediaKey(form, 'coverKey'), coverAlt: value('coverAlt'), photos };
  }

  async function saveEntry(form) {
    const collection = form.dataset.collection;
    const apiName = collectionInfo[collection].api;
    const slug = form.dataset.slug || '';
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = '正在保存…';
    try {
      const result = await api(`/v1/admin/${apiName}${slug ? `/${encodeURIComponent(slug)}` : ''}`, { method: slug ? 'PUT' : 'POST', body: JSON.stringify(readEntry(form)) });
      await refreshSummary();
      toast('已保存到 D1。', 'success');
      if (!slug) go(`collections/${collection}/entries/${encodeURIComponent(result.item.slug)}`);
      else await renderRoute();
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败。', 'error');
      button.disabled = false;
      button.textContent = slug ? '保存修改' : '创建并保存';
    }
  }

  async function optimizeImage(file) {
    const target = 5_800_000;
    if (file.size <= target || !('createImageBitmap' in window)) return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const longEdge = Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, 5000 / longEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.92, 0.9, 0.88, 0.86, 0.84, 0.82]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && (blob.size <= target || quality === 0.82)) {
          const base = file.name.replace(/\.[^.]+$/, '') || 'image';
          return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() });
        }
      }
    } catch {
      return file;
    } finally {
      bitmap?.close?.();
    }
    return file;
  }

  async function uploadToField(field, file, insertIntoBody = false) {
    if (!file) return;
    if (field.dataset.disabled === 'true') return toast('请先保存专题，系统才能确定它的 R2 文件夹。', 'error');
    const folder = field.dataset.folder || '';
    if (!folder) return toast('尚未确定 R2 上传文件夹。', 'error');
    const progress = field.querySelector('[data-media-progress]');
    try {
      progress.textContent = '正在处理并上传…';
      const optimized = await optimizeImage(file);
      const data = new FormData();
      data.set('file', optimized);
      data.set('folder', folder);
      const result = await api('/v1/admin/media', { method: 'POST', body: data });
      const asset = result.asset;
      if (insertIntoBody) {
        const form = field.closest('[data-entry-form]');
        const editor = form?.querySelector('[name="body"]');
        if (editor) {
          const markdown = `![${asset.name}](${asset.imageUrl})`;
          const start = editor.selectionStart || editor.value.length;
          const end = editor.selectionEnd || start;
          editor.value = `${editor.value.slice(0, start)}${editor.value && !editor.value.endsWith('\n') ? '\n\n' : ''}${markdown}\n${editor.value.slice(end)}`;
          editor.focus();
        }
      } else {
        field.dataset.key = asset.key;
        field.querySelector('[data-media-preview]').innerHTML = `<img src="${escapeAttr(asset.imageUrl)}" alt="" />`;
        field.querySelector('[data-media-title]').textContent = asset.name;
        field.querySelector('[data-media-name]').textContent = asset.key;
        const clear = field.querySelector('[data-action="clear-image"]');
        if (!clear) {
          const actions = field.querySelector('.media-drop-actions');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'button quiet';
          button.dataset.action = 'clear-image';
          button.textContent = '移除引用';
          actions.append(button);
        }
      }
      await refreshSummary();
      toast(`已上传到 R2 /${asset.folder}/。`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '图片上传失败。', 'error');
    } finally {
      progress.textContent = '';
    }
  }

  async function uploadGallery(file) {
    const folder = root.querySelector('[name="gallery-folder"]')?.value || '';
    const progress = root.querySelector('[data-gallery-progress]');
    if (!folder) return toast('请选择 R2 文件夹。', 'error');
    try {
      progress.textContent = '正在处理并上传…';
      const data = new FormData();
      data.set('file', await optimizeImage(file));
      data.set('folder', folder);
      const result = await api('/v1/admin/media', { method: 'POST', body: data });
      await refreshSummary();
      toast(`已上传到 R2 /${result.asset.folder}/。`, 'success');
      await renderMedia();
    } catch (error) {
      toast(error instanceof Error ? error.message : '图片上传失败。', 'error');
    } finally {
      if (progress) progress.textContent = '';
    }
  }

  root.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.matches('[data-login-form]')) {
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      button.textContent = '正在验证…';
      try {
        const payload = await api('/v1/admin/login', { method: 'POST', body: JSON.stringify({ password: form.elements.password.value }) });
        state.token = payload.token;
        sessionStorage.setItem(TOKEN_KEY, state.token);
        state.summary = null;
        toast('欢迎回来。', 'success');
        go('collections/writing');
      } catch (error) {
        renderLogin(error instanceof Error ? error.message : '无法登录。');
      }
      return;
    }
    if (form.matches('[data-entry-form]')) await saveEntry(form);
  });

  root.addEventListener('click', async (event) => {
    const control = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!control) return;
    const action = control.dataset.action;
    if (action === 'logout') {
      state.token = '';
      state.summary = null;
      sessionStorage.removeItem(TOKEN_KEY);
      renderLogin('已退出编辑室。');
      return;
    }
    if (action === 'new-entry') return go(`collections/${control.dataset.collection}/entries/new`);
    if (action === 'retry-route') return renderRoute();
    if (action === 'browse-image') return control.closest('[data-media-field]')?.querySelector('[data-upload-input]')?.click();
    if (action === 'browse-gallery-image') return root.querySelector('[data-gallery-input]')?.click();
    if (action === 'clear-image') {
      const field = control.closest('[data-media-field]');
      if (!field) return;
      field.dataset.key = '';
      field.querySelector('[data-media-preview]').innerHTML = '<span aria-hidden="true">图片</span>';
      field.querySelector('[data-media-title]').textContent = '拖拽图片到这里';
      field.querySelector('[data-media-name]').textContent = field.dataset.folder ? `将上传至 R2 /${field.dataset.folder}/` : '请先保存条目后再上传';
      control.remove();
      return;
    }
    if (action === 'add-topic-photo') {
      const list = root.querySelector('[data-topic-photo-list]');
      const form = control.closest('[data-entry-form]');
      const folder = form?.dataset.slug || '';
      if (!folder) return toast('请先保存专题。', 'error');
      const holder = document.createElement('div');
      holder.innerHTML = topicPhotoForm({}, list.children.length, folder);
      list.append(holder.firstElementChild);
      return;
    }
    if (action === 'remove-topic-photo') return control.closest('[data-topic-photo]')?.remove();
    if (action === 'move-topic-photo') {
      const card = control.closest('[data-topic-photo]');
      const sibling = control.dataset.direction === 'up' ? card?.previousElementSibling : card?.nextElementSibling;
      if (card && sibling) control.dataset.direction === 'up' ? card.parentElement.insertBefore(card, sibling) : card.parentElement.insertBefore(sibling, card);
      return;
    }
    if (action === 'delete-entry') {
      const form = control.closest('[data-entry-form]');
      const collection = form?.dataset.collection;
      const slug = form?.dataset.slug;
      if (!collection || !slug || !window.confirm('确定删除这条内容吗？已上传的 R2 图片不会自动删除。')) return;
      try {
        await api(`/v1/admin/${collectionInfo[collection].api}/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        await refreshSummary();
        toast('内容已从 D1 删除。', 'success');
        go(`collections/${collection}`);
      } catch (error) { toast(error instanceof Error ? error.message : '删除失败。', 'error'); }
      return;
    }
    if (action === 'set-media-filter') {
      state.mediaFilter = control.dataset.filter || 'all';
      return renderMedia();
    }
    if (action === 'copy-media-url') {
      try { await navigator.clipboard.writeText(control.dataset.url || ''); toast('R2 图片链接已复制。', 'success'); } catch { toast('无法自动复制，请手动复制链接。', 'error'); }
      return;
    }
    if (action === 'delete-media') {
      const key = control.dataset.key || '';
      const used = control.dataset.used === 'true';
      if (!key || !window.confirm(used ? '这张图片仍被内容引用。确定要强制删除吗？网站中的对应图片会失效。' : '确定从 R2 删除这张未使用的图片吗？')) return;
      try {
        await api(`/v1/admin/media?key=${encodeURIComponent(key)}${used ? '&force=1' : ''}`, { method: 'DELETE' });
        await refreshSummary();
        toast('已从 R2 删除图片。', 'success');
        await renderMedia();
      } catch (error) { toast(error instanceof Error ? error.message : '删除失败。', 'error'); }
    }
  });

  root.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.[0]) return;
    if (input.matches('[data-gallery-input]')) await uploadGallery(input.files[0]);
    else {
      const field = input.closest('[data-media-field]');
      const insertIntoBody = field?.dataset.mediaField === 'bodyImage';
      await uploadToField(field, input.files[0], insertIntoBody);
    }
    input.value = '';
  });

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.matches('[data-media-search]')) {
      state.mediaSearch = input.value;
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(renderMedia, 180);
    }
  });

  root.addEventListener('dragover', (event) => {
    const drop = event.target instanceof Element ? event.target.closest('.media-drop') : null;
    if (!drop) return;
    event.preventDefault();
    drop.classList.add('is-dragging');
  });
  root.addEventListener('dragleave', (event) => {
    const drop = event.target instanceof Element ? event.target.closest('.media-drop') : null;
    if (drop) drop.classList.remove('is-dragging');
  });
  root.addEventListener('drop', async (event) => {
    const drop = event.target instanceof Element ? event.target.closest('.media-drop') : null;
    if (!drop) return;
    event.preventDefault();
    drop.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (drop.matches('[data-gallery-drop]')) await uploadGallery(file);
    else {
      const field = drop.closest('[data-media-field]');
      await uploadToField(field, file, field?.dataset.mediaField === 'bodyImage');
    }
  });

  window.addEventListener('hashchange', renderRoute);

  (async () => {
    if (!state.token) return renderLogin();
    try {
      await api('/v1/admin/session');
      await renderRoute();
    } catch {
      state.token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      renderLogin('请使用编辑室密码登录。');
    }
  })();
})();
