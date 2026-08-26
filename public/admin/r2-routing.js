(function () {
  'use strict';

  function safeFolder(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter((part) => part && part !== '.' && part !== '..')
      .join('-')
      .replace(/[^\p{L}\p{N}._~-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function routeInfo(hash) {
    const match = String(hash || '').match(/#\/collections\/([^/]+)\/entries\/([^/?#]+)/);
    if (!match) return { collection: '', slug: '' };
    return { collection: decode(match[1]), slug: decode(match[2]) };
  }

  function isPlaceholder(value) {
    return !value || ['new', 'new-entry', 'create'].includes(String(value).toLowerCase());
  }

  function resolveFolder({ configuredFolder = '', mode = '', hash = '', entrySlugs = [] } = {}) {
    if (configuredFolder) {
      const folder = safeFolder(configuredFolder);
      return { folder, source: 'configured', label: folder ? '固定媒体文件夹' : '媒体文件夹配置无效' };
    }

    const route = routeInfo(hash);
    const candidates = [route.slug, ...entrySlugs];
    const candidate = candidates.find((value) => !isPlaceholder(value));
    if (mode === 'entry' || route.collection === 'topics') {
      const folder = safeFolder(candidate);
      return {
        folder,
        source: folder ? (route.slug === candidate ? 'route' : 'entry') : 'missing',
        label: folder ? '按当前专栏 slug 自动选择' : '保存专栏后生成文件夹',
      };
    }
    return { folder: '', source: 'missing', label: '未配置 R2 文件夹' };
  }

  window.IcelinR2Routing = { safeFolder, routeInfo, resolveFolder };
}());
