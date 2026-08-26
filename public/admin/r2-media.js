(function () {
  'use strict';

  const CONFIG_URL = '/admin/config.yml';
  const RUNTIME_CONFIG_URL = '/admin/r2-runtime.json';
  const MAX_UNOPTIMIZED_BYTES = 5 * 1024 * 1024;
  const TARGET_OPTIMIZED_BYTES = 5.8 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 5000;
  let configPromise;

  function trim(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
  }

  function readConfigValue(text, key) {
    const pattern = new RegExp('^\\s{4}' + key + ':\\s*([^\\r\\n#]+)', 'm');
    const match = text.match(pattern);
    return match ? trim(match[1]) : '';
  }

  async function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(CONFIG_URL, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('无法读取 Sveltia 配置。');
          return response.text();
        })
        .then(async function (text) {
          const accountId = readConfigValue(text, 'account_id');
          const publicUrl = readConfigValue(text, 'public_url');
          const bucket = readConfigValue(text, 'bucket');
          const accessKeyId = readConfigValue(text, 'access_key_id');
          if (!accountId || !publicUrl || !bucket || !accessKeyId) {
            throw new Error('R2 配置缺少 account_id、bucket、access_key_id 或 public_url。');
          }
          let runtimePublicUrl = '';
          try {
            const runtimeResponse = await fetch(RUNTIME_CONFIG_URL, { cache: 'no-store' });
            if (runtimeResponse.ok) runtimePublicUrl = trim((await runtimeResponse.json()).publicUrl);
          } catch {
            // The generated runtime file is optional; config.yml remains the fallback.
          }
          return {
            accountId: accountId,
            bucket: bucket,
            accessKeyId: accessKeyId,
            publicUrl: (runtimePublicUrl || publicUrl).replace(/\/+$/, ''),
            endpoint: 'https://' + accountId + '.r2.cloudflarestorage.com',
          };
        });
    }
    return configPromise;
  }

  function parseStoredSecret(value) {
    if (!value) return '';
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
      return parsed.secret_access_key || parsed.secretAccessKey || parsed.cloudflare_r2 || '';
    } catch {
      return value;
    }
  }

  function getSecretAccessKey() {
    const directKeys = [
      'icelin.r2.secret_access_key',
      'sveltia-cms.prefs.apiKeys.cloudflare_r2',
      'sveltia-cms.apiKeys.cloudflare_r2',
    ];
    for (const key of directKeys) {
      const value = parseStoredSecret(window.localStorage.getItem(key));
      if (value) return value;
    }

    const preferenceKeys = ['sveltia-cms.prefs', 'sveltia-cms.preferences'];
    for (const key of preferenceKeys) {
      try {
        const preferences = JSON.parse(window.localStorage.getItem(key) || '{}');
        const value = preferences.apiKeys && parseStoredSecret(preferences.apiKeys.cloudflare_r2);
        if (value) return value;
      } catch {
        // Ignore unrelated local-storage values.
      }
    }
    return '';
  }

  function saveSecretAccessKey(value) {
    const secret = String(value || '').trim();
    if (!secret) return;
    window.localStorage.setItem('icelin.r2.secret_access_key', secret);
    window.localStorage.setItem('sveltia-cms.prefs.apiKeys.cloudflare_r2', secret);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new TextEncoder().encode(String(value));
  }

  async function sha256Hex(value) {
    const digest = await window.crypto.subtle.digest('SHA-256', asBytes(value));
    return bytesToHex(new Uint8Array(digest));
  }

  async function hmac(key, value) {
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      asBytes(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return new Uint8Array(await window.crypto.subtle.sign('HMAC', cryptoKey, asBytes(value)));
  }

  function awsEncode(value) {
    return encodeURIComponent(String(value))
      .replace(/[!'()*]/g, function (character) {
        return '%' + character.charCodeAt(0).toString(16).toUpperCase();
      });
  }

  function canonicalPath(key) {
    return '/' + key.split('/').map(awsEncode).join('/');
  }

  function canonicalQuery(query) {
    return Object.keys(query)
      .filter(function (key) {
        return query[key] !== undefined && query[key] !== null && query[key] !== '';
      })
      .map(function (key) {
        return [awsEncode(key), awsEncode(query[key])];
      })
      .sort(function (left, right) {
        return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
      })
      .map(function (pair) {
        return pair[0] + '=' + pair[1];
      })
      .join('&');
  }

  function objectPath(config, key) {
    return canonicalPath(config.bucket + (key ? '/' + key : ''));
  }

  function amzTimestamp() {
    const now = new Date();
    const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return {
      date: iso.slice(0, 8),
      timestamp: iso,
    };
  }

  async function authorization(config, secret, method, key, query, body, contentType) {
    const timestamp = amzTimestamp();
    const payloadHash = await sha256Hex(body || new Uint8Array());
    const host = new URL(config.endpoint).host;
    const headers = {
      'content-type': contentType || 'application/octet-stream',
      host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp.timestamp,
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map(function (name) {
      return name + ':' + String(headers[name]).trim().replace(/\s+/g, ' ') + '\n';
    }).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      objectPath(config, key),
      canonicalQuery(query || {}),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = timestamp.date + '/auto/s3/aws4_request';
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp.timestamp,
      scope,
      await sha256Hex(canonicalRequest),
    ].join('\n');
    const dateKey = await hmac('AWS4' + secret, timestamp.date);
    const regionKey = await hmac(dateKey, 'auto');
    const serviceKey = await hmac(regionKey, 's3');
    const signingKey = await hmac(serviceKey, 'aws4_request');
    const signature = bytesToHex(await hmac(signingKey, stringToSign));
    headers.authorization = 'AWS4-HMAC-SHA256 Credential='
      + config.accessKeyId + '/' + scope
      + ', SignedHeaders=' + signedHeaders
      + ', Signature=' + signature;
    // `host` is part of the canonical signature, but browsers reject it as a
    // forbidden request header. Fetch derives it from the URL automatically.
    delete headers.host;
    return headers;
  }

  async function signedRequest(config, secret, method, key, query, body, contentType) {
    const headers = await authorization(config, secret, method, key, query, body, contentType);
    const queryString = canonicalQuery(query || {});
    const url = config.endpoint + objectPath(config, key) + (queryString ? '?' + queryString : '');
    const response = await fetch(url, {
      method: method,
      headers: headers,
      body: method === 'GET' || method === 'HEAD'
        ? undefined
        : body instanceof Uint8Array ? body : body || undefined,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error('R2 请求失败（' + response.status + '）' + (detail ? '：' + detail : '。'));
    }
    return response;
  }

  function safeFolder(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(function (part) {
        return part && part !== '.' && part !== '..';
      })
      .join('-')
      .replace(/[^\p{L}\p{N}._~-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  function safeFilename(value) {
    const original = String(value || '').split(/[\\/]/).pop().trim();
    const cleaned = original
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\.\.(?=\/|\\|$)/g, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ');
    return cleaned || ('image-' + Date.now() + '.webp');
  }

  function extensionOf(name) {
    const match = String(name).match(/(\.[A-Za-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function basenameWithoutExtension(name) {
    return String(name).replace(/(\.[A-Za-z0-9]+)$/, '');
  }

  async function prepareImage(file) {
    if (file.size <= MAX_UNOPTIMIZED_BYTES || !/^image\//i.test(file.type)) {
      return { file: file, optimized: false, originalBytes: file.size };
    }

    if (/image\/(gif|svg\+xml)$/i.test(file.type)) {
      return { file: file, optimized: false, originalBytes: file.size, note: 'GIF/SVG 保留原文件，避免破坏动画或矢量内容。' };
    }

    if (!window.createImageBitmap) {
      return { file: file, optimized: false, originalBytes: file.size, note: '当前浏览器不支持预处理，已保留原文件。' };
    }

    const bitmap = await window.createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      bitmap.close();
      throw new Error('浏览器无法创建图片处理画布。');
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const qualities = [0.92, 0.90, 0.88, 0.86, 0.84, 0.82];
    let bestBlob = null;
    for (const quality of qualities) {
      const blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, 'image/webp', quality);
      });
      if (!blob) continue;
      bestBlob = blob;
      if (blob.size <= TARGET_OPTIMIZED_BYTES) break;
    }
    if (!bestBlob) throw new Error('大图预处理失败，请换用较小的图片。');

    const originalName = safeFilename(file.name);
    const optimizedName = basenameWithoutExtension(originalName) + '.webp';
    if (bestBlob.size >= file.size && scale === 1) {
      return { file: file, optimized: false, originalBytes: file.size, note: '优化结果没有更小，已保留原文件。' };
    }
    return {
      file: new File([bestBlob], optimizedName, { type: 'image/webp', lastModified: Date.now() }),
      optimized: true,
      originalBytes: file.size,
      outputBytes: bestBlob.size,
      note: '大图已按高质量 WebP 预处理。',
    };
  }

  async function listObjects(folder, options) {
    const config = options && options.config ? options.config : await loadConfig();
    const secret = options && options.secret ? options.secret : getSecretAccessKey();
    if (!secret) throw new Error('还没有输入 R2 Secret Access Key，请先在 Sveltia 的 Cloudflare R2 媒体库中输入。');
    const prefix = folder ? safeFolder(folder) + '/' : '';
    let token = '';
    const objects = [];
    do {
      const query = {
        'list-type': '2',
        'max-keys': '1000',
        prefix: prefix,
        'continuation-token': token,
      };
      const response = await signedRequest(config, secret, 'GET', '', query, new Uint8Array(), 'application/xml');
      const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      const contents = Array.from(xml.getElementsByTagName('Contents'));
      contents.forEach(function (content) {
        const read = function (tag) {
          const element = content.getElementsByTagName(tag)[0];
          return element ? element.textContent || '' : '';
        };
        const key = read('Key');
        if (!key || key === prefix || key.endsWith('/')) return;
        objects.push({
          key: key,
          name: key.split('/').pop(),
          size: Number(read('Size')) || 0,
          lastModified: read('LastModified'),
          etag: read('ETag').replace(/^"|"$/g, ''),
          url: publicUrlForKey(config, key),
        });
      });
      const next = xml.getElementsByTagName('NextContinuationToken')[0];
      token = next ? next.textContent || '' : '';
    } while (token);
    return objects;
  }

  function publicUrlForKey(config, key) {
    return config.publicUrl + '/' + key.split('/').map(encodeURIComponent).join('/');
  }

  async function uploadPrepared(prepared, folder, options) {
    const config = options && options.config ? options.config : await loadConfig();
    const secret = options && options.secret ? options.secret : getSecretAccessKey();
    if (!secret) throw new Error('还没有输入 R2 Secret Access Key，请先在 Sveltia 的 Cloudflare R2 媒体库中输入。');
    const cleanFolder = safeFolder(folder);
    if (!cleanFolder) throw new Error('无法确定当前专栏文件夹，请先保存专栏生成 slug。');

    const originalName = safeFilename(prepared.file.name);
    const existing = await listObjects(cleanFolder, { config: config, secret: secret });
    const existingKeys = new Set(existing.map(function (object) { return object.key; }));
    let candidate = originalName;
    let index = 2;
    while (existingKeys.has(cleanFolder + '/' + candidate)) {
      const extension = extensionOf(originalName);
      candidate = basenameWithoutExtension(originalName) + '-' + index + extension;
      index += 1;
    }
    const key = cleanFolder + '/' + candidate;
    const body = new Uint8Array(await prepared.file.arrayBuffer());
    await signedRequest(config, secret, 'PUT', key, {}, body, prepared.file.type || 'application/octet-stream');
    return {
      key: key,
      name: candidate,
      url: publicUrlForKey(config, key),
      optimized: prepared.optimized,
      originalBytes: prepared.originalBytes,
      outputBytes: prepared.file.size,
      note: prepared.note || '',
    };
  }

  window.IcelinR2Media = {
    loadConfig: loadConfig,
    getSecretAccessKey: getSecretAccessKey,
    saveSecretAccessKey: saveSecretAccessKey,
    safeFolder: safeFolder,
    prepareImage: prepareImage,
    listObjects: listObjects,
    uploadPrepared: uploadPrepared,
    publicUrlForKey: publicUrlForKey,
    maxUnoptimizedBytes: MAX_UNOPTIMIZED_BYTES,
  };
}());
