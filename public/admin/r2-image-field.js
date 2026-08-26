(function () {
  'use strict';

  const CMS = window.CMS;
  const createClass = window.createClass;
  const h = window.h;
  const R2 = window.IcelinR2Media;
  const Routing = window.IcelinR2Routing;
  const MEDIA_STATUS_URL = '/admin/media-status.json';

  if (!CMS || !createClass || !h || !R2 || !Routing) {
    console.error('R2 图片字段初始化失败：Sveltia 或 R2 媒体模块未加载。');
    return;
  }

  function fieldValue(field, key, fallback) {
    if (!field) return fallback;
    if (typeof field.get === 'function') return field.get(key, fallback);
    return field[key] === undefined ? fallback : field[key];
  }

  function entryValue(entry, path) {
    if (!entry) return '';
    if (typeof entry.getIn === 'function') return entry.getIn(path, '');
    let current = entry;
    for (const key of path) {
      if (!current || typeof current !== 'object') return '';
      current = current[key];
    }
    return current || '';
  }

  function getFolderInfo(props) {
    return Routing.resolveFolder({
      configuredFolder: fieldValue(props.field, 'r2_folder', ''),
      mode: fieldValue(props.field, 'r2_folder_mode', ''),
      hash: window.location.hash,
      entrySlugs: [
        entryValue(props.entry, ['data', '_slug']),
        entryValue(props.entry, ['data', 'slug']),
        entryValue(props.entry, ['slug']),
      ],
    });
  }

  function normalizeUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, window.location.origin).href.replace(/\/$/, '');
    } catch {
      return String(value).replace(/\/$/, '');
    }
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function isImageFile(file) {
    return Boolean(
      file && (
        /^image\//i.test(file.type || '')
        || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name || '')
      ),
    );
  }

  async function loadUsage() {
    const response = await fetch(MEDIA_STATUS_URL + '?v=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取图片使用状态。');
    const status = await response.json();
    const usage = new Map();
    for (const asset of status.assets || []) {
      if (!asset.src) continue;
      usage.set(normalizeUrl(asset.src), asset.usedBy || []);
    }
    return usage;
  }

  function errorMessage(error) {
    return error && error.message ? error.message : '操作失败，请稍后重试。';
  }

  const R2ImageControl = createClass({
    getInitialState: function () {
      return {
        inputId: 'r2-image-' + Math.random().toString(36).slice(2),
        dragActive: false,
        status: 'idle',
        message: '',
        pickerOpen: false,
        pickerLoading: false,
        pickerError: '',
        pickerFilter: 'unused',
        pickerSearch: '',
        objects: [],
        usage: new Map(),
        secretRequired: false,
        secretDraft: '',
        pendingFile: null,
        pendingAction: '',
      };
    },

    isValid: function (value) {
      return value
        ? true
        : { error: { message: '请上传图片，或从当前专栏的 R2 文件夹中选择图片。' } };
    },

    componentDidUpdate: function (previousProps) {
      const oldFolder = getFolderInfo(previousProps).folder;
      const newFolder = getFolderInfo(this.props).folder;
      if (oldFolder !== newFolder && this.state.pickerOpen) {
        this.setState({ pickerOpen: false, objects: [], pickerError: '' });
      }
    },

    inputId: function () {
      // `forID` is supplied by Sveltia for normal fields. Keep a stable
      // fallback for nested list fields so the Browse button always targets
      // the same hidden input that the control rendered.
      return this.props.forID || this.state.inputId;
    },

    triggerInput: function () {
      const input = document.getElementById(this.inputId());
      if (input) input.click();
    },

    handleInputChange: function (event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) this.handleFile(file);
    },

    handleDragOver: function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.state.dragActive) this.setState({ dragActive: true });
    },

    handleDragLeave: function (event) {
      event.preventDefault();
      event.stopPropagation();
      this.setState({ dragActive: false });
    },

    handleDrop: function (event) {
      event.preventDefault();
      event.stopPropagation();
      this.setState({ dragActive: false });
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) this.handleFile(file);
    },

    handlePaste: function (event) {
      const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
      const item = items.find((candidate) => candidate.kind === 'file');
      const file = item && item.getAsFile();
      if (file) {
        event.preventDefault();
        this.handleFile(file);
      }
    },

    handleFile: function (file) {
      const folder = getFolderInfo(this.props).folder;
      if (!isImageFile(file)) {
        this.setState({ status: 'error', message: '这里只接受图片文件（JPG、PNG、WebP、GIF、SVG 或 AVIF）。' });
        return;
      }
      if (!folder) {
        this.setState({
          status: 'error',
          message: '还无法确定专栏文件夹。请先保存这个专栏，让地址中的 slug 确定后再上传。',
        });
        return;
      }
      if (!R2.getSecretAccessKey()) {
        this.setState({
          secretRequired: true,
          pendingFile: file,
          pendingAction: 'upload',
          status: 'idle',
          message: '',
        });
        return;
      }
      this.uploadFile(file);
    },

    uploadFile: async function (file) {
      const folder = getFolderInfo(this.props).folder;
      if (!folder || !file) return;
      this.setState({ status: 'preparing', message: '正在准备图片…', pendingFile: null });
      try {
        const prepared = await R2.prepareImage(file);
        this.setState({
          status: 'uploading',
          message: '正在上传到 R2 · ' + folder + '/ …',
        });
        const result = await R2.uploadPrepared(prepared, folder);
        this.props.onChange(result.url);
        const detail = result.optimized
          ? '大图已按高质量 WebP 处理：' + formatBytes(result.originalBytes) + ' → ' + formatBytes(result.outputBytes)
          : '原文件已保留：' + formatBytes(result.outputBytes);
        this.setState({
          status: 'success',
          message: '已上传到 R2 · ' + result.key + '。' + detail,
          secretRequired: false,
          pendingAction: '',
        });
      } catch (error) {
        const message = errorMessage(error);
        const missingSecret = message.includes('Secret Access Key') || message.includes('还没有输入 R2');
        this.setState({
          status: 'error',
          message,
          secretRequired: missingSecret,
          pendingFile: missingSecret ? file : null,
          pendingAction: missingSecret ? 'upload' : '',
        });
      }
    },

    removeValue: function () {
      this.props.onChange('');
      this.setState({ status: 'idle', message: '' });
    },

    saveSecret: function () {
      const secret = String(this.state.secretDraft || '').trim();
      if (!secret) {
        this.setState({ status: 'error', message: '请输入 R2 Secret Access Key。' });
        return;
      }
      R2.saveSecretAccessKey(secret);
      const pendingFile = this.state.pendingFile;
      const pendingAction = this.state.pendingAction;
      this.setState(
        { secretRequired: false, secretDraft: '', pendingFile: null, pendingAction: '', message: '' },
        () => {
          if (pendingAction === 'upload' && pendingFile) this.uploadFile(pendingFile);
          if (pendingAction === 'picker') this.openPicker();
        },
      );
    },

    openPicker: async function () {
      const folder = getFolderInfo(this.props).folder;
      if (!folder) {
        this.setState({ status: 'error', message: '请先保存专栏，生成当前专栏的 slug。' });
        return;
      }
      if (!R2.getSecretAccessKey()) {
        this.setState({ secretRequired: true, pendingAction: 'picker', status: 'idle', message: '' });
        return;
      }
      this.setState({
        pickerOpen: true,
        pickerLoading: true,
        pickerError: '',
        objects: [],
      });
      try {
        const results = await Promise.all([R2.listObjects(folder), loadUsage()]);
        this.setState({
          pickerLoading: false,
          objects: results[0],
          usage: results[1],
        });
      } catch (error) {
        const message = errorMessage(error);
        const missingSecret = message.includes('Secret Access Key') || message.includes('还没有输入 R2');
        this.setState({
          pickerLoading: false,
          pickerError: message,
          pickerOpen: !missingSecret,
          secretRequired: missingSecret,
          pendingAction: missingSecret ? 'picker' : '',
        });
      }
    },

    closePicker: function () {
      this.setState({ pickerOpen: false, pickerError: '' });
    },

    chooseObject: function (object) {
      this.props.onChange(object.url);
      this.setState({ pickerOpen: false, status: 'success', message: '已引用 R2 图片：' + object.key });
    },

    setPickerFilter: function (filter) {
      this.setState({ pickerFilter: filter });
    },

    setPickerSearch: function (event) {
      this.setState({ pickerSearch: event.target.value });
    },

    renderSecretPrompt: function () {
      const secretId = this.inputId() + '-secret';
      return h(
        'div',
        { className: 'icelin-r2-secret', role: 'group', 'aria-labelledby': secretId + '-label' },
        h('div', { className: 'icelin-r2-secret-title', id: secretId + '-label' }, '连接 R2 文件夹'),
        h(
          'p',
          { className: 'icelin-r2-secret-copy' },
          '首次使用时输入 R2 Secret Access Key。密钥只保存在当前浏览器，不会写入 GitHub 或文章。',
        ),
        h('input', {
          id: secretId,
          className: 'icelin-r2-secret-input',
          type: 'password',
          value: this.state.secretDraft,
          placeholder: 'R2 Secret Access Key',
          autoComplete: 'off',
          onChange: (event) => this.setState({ secretDraft: event.target.value }),
        }),
        h(
          'button',
          { className: 'icelin-r2-button icelin-r2-button-primary', type: 'button', onClick: this.saveSecret },
          '保存并继续',
        ),
      );
    },

    renderDropzone: function (folder) {
      const inputId = this.inputId();
      const value = this.props.value || '';
      const dropClass = 'icelin-r2-dropzone' + (this.state.dragActive ? ' is-dragging' : '');
      const preview = value
        ? h(
          'div',
          { className: 'icelin-r2-preview' },
          h('img', { src: value, alt: '', className: 'icelin-r2-preview-image' }),
          h(
            'div',
            { className: 'icelin-r2-preview-meta' },
            h('span', { className: 'icelin-r2-preview-label' }, '当前图片'),
            h('span', { className: 'icelin-r2-preview-url', title: value }, value),
          ),
        )
        : h(
          'div',
          { className: 'icelin-r2-empty-preview' },
          h('span', { className: 'icelin-r2-upload-icon', 'aria-hidden': 'true' }, '↑'),
          h('strong', {}, '拖拽图片到这里'),
          h('span', {}, '或点击浏览，也可以直接粘贴图片'),
        );

      return h(
        'div',
        {
          className: dropClass,
          tabIndex: 0,
          role: 'button',
          'aria-label': value ? '替换 R2 图片' : '上传图片到 R2',
          onClick: (event) => {
            if (event.target.closest && event.target.closest('button')) return;
            this.triggerInput();
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              this.triggerInput();
            }
          },
          onDragOver: this.handleDragOver,
          onDragEnter: this.handleDragOver,
          onDragLeave: this.handleDragLeave,
          onDrop: this.handleDrop,
          onPaste: this.handlePaste,
        },
        preview,
        h(
          'div',
          { className: 'icelin-r2-drop-actions' },
          h(
            'button',
            { className: 'icelin-r2-button', type: 'button', onClick: this.triggerInput },
            value ? '替换图片' : '浏览图片',
          ),
          value && h(
            'button',
            { className: 'icelin-r2-button icelin-r2-button-quiet', type: 'button', onClick: this.removeValue },
            '移除引用',
          ),
        ),
        h('input', {
          id: inputId,
          type: 'file',
          accept: 'image/*',
          className: 'icelin-r2-file-input',
          onChange: this.handleInputChange,
        }),
        h(
          'div',
          { className: 'icelin-r2-drop-hint' },
          folder ? '上传目标已锁定：R2 /' + folder + '/' : '请先保存专栏以确定目标文件夹',
        ),
      );
    },

    renderPickerObject: function (object) {
      const usedBy = this.state.usage.get(normalizeUrl(object.url)) || [];
      const used = usedBy.length > 0;
      return h(
        'button',
        {
          key: object.key,
          type: 'button',
          className: 'icelin-r2-object' + (used ? ' is-used' : ''),
          onClick: () => this.chooseObject(object),
          title: object.key,
        },
        h('img', { src: object.url, alt: object.name, loading: 'lazy' }),
        h(
          'span',
          { className: 'icelin-r2-object-footer' },
          h('span', { className: 'icelin-r2-object-name' }, object.name),
          h(
            'span',
            { className: 'icelin-r2-object-meta' },
            h('span', { className: 'icelin-r2-badge ' + (used ? 'is-used' : 'is-unused') }, used ? '已添加' : '未添加'),
            h('span', {}, formatBytes(object.size)),
          ),
        ),
      );
    },

    renderPicker: function (folder) {
      if (!this.state.pickerOpen) return null;
      const search = String(this.state.pickerSearch || '').trim().toLowerCase();
      const filtered = this.state.objects.filter((object) => {
        const used = (this.state.usage.get(normalizeUrl(object.url)) || []).length > 0;
        const matchesFilter = this.state.pickerFilter === 'all'
          || (this.state.pickerFilter === 'used' && used)
          || (this.state.pickerFilter === 'unused' && !used);
        const matchesSearch = !search || object.name.toLowerCase().includes(search) || object.key.toLowerCase().includes(search);
        return matchesFilter && matchesSearch;
      });
      const filters = [
        ['unused', '未添加'],
        ['all', '全部'],
        ['used', '已添加'],
      ];
      const body = this.state.pickerLoading
        ? h('div', { className: 'icelin-r2-picker-state' }, h('span', { className: 'icelin-r2-skeleton' }), '正在读取 ' + folder + '/ …')
        : this.state.pickerError
          ? h('div', { className: 'icelin-r2-picker-state is-error' }, this.state.pickerError)
          : filtered.length
            ? h('div', { className: 'icelin-r2-object-grid' }, filtered.map(this.renderPickerObject))
            : h(
              'div',
              { className: 'icelin-r2-picker-state' },
              this.state.objects.length
                ? '当前筛选没有结果；可以切换“全部”查看已经添加的图片。'
                : '这个 R2 文件夹还没有图片。可以直接拖拽或浏览上传。',
            );

      return h(
        'div',
        { className: 'icelin-r2-picker-backdrop', onClick: this.closePicker },
        h(
          'div',
          {
            className: 'icelin-r2-picker',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': '选择 R2 图片',
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'icelin-r2-picker-header' },
            h(
              'div',
              {},
              h('strong', {}, '选择 R2 图片'),
              h('span', { className: 'icelin-r2-picker-folder' }, folder + '/'),
            ),
            h('button', { className: 'icelin-r2-close', type: 'button', onClick: this.closePicker, 'aria-label': '关闭' }, '×'),
          ),
          h(
            'div',
            { className: 'icelin-r2-picker-toolbar' },
            h(
              'div',
              { className: 'icelin-r2-filter-group', role: 'group', 'aria-label': '图片使用状态筛选' },
              filters.map(([key, label]) => h(
                'button',
                {
                  key,
                  className: 'icelin-r2-filter' + (this.state.pickerFilter === key ? ' is-active' : ''),
                  type: 'button',
                  'aria-pressed': this.state.pickerFilter === key,
                  onClick: () => this.setPickerFilter(key),
                },
                label,
              )),
            ),
            h('input', {
              className: 'icelin-r2-search',
              type: 'search',
              value: this.state.pickerSearch,
              placeholder: '搜索文件名…',
              onChange: this.setPickerSearch,
            }),
          ),
          h('div', { className: 'icelin-r2-picker-content' }, body),
          h(
            'div',
            { className: 'icelin-r2-picker-footer' },
            h('span', {}, '“未添加”按已提交内容中的引用判断；上传后保存文章即可更新状态。'),
            h('button', { className: 'icelin-r2-button', type: 'button', onClick: this.closePicker }, '取消'),
          ),
        ),
      );
    },

    render: function () {
      const folderInfo = getFolderInfo(this.props);
      const folder = folderInfo.folder;
      const value = this.props.value || '';
      const statusMessage = this.state.message || (this.state.status === 'preparing'
        ? '正在准备图片…'
        : this.state.status === 'uploading' ? '正在上传到 R2…' : '');

      return h(
        'div',
        { className: (this.props.classNameWrapper || '') + ' icelin-r2-field' },
        h(
          'div',
          { className: 'icelin-r2-field-head' },
          h(
            'div',
            {},
            h('strong', {}, 'Cloudflare R2 图片'),
            h('span', { className: 'icelin-r2-folder-chip' }, folder ? folder + '/' : '文件夹待确定'),
          ),
          h('span', { className: 'icelin-r2-field-source' }, folderInfo.label),
        ),
        this.renderDropzone(folder),
        h(
          'div',
          { className: 'icelin-r2-field-actions' },
          h(
            'button',
            {
              className: 'icelin-r2-button icelin-r2-button-primary',
              type: 'button',
              disabled: !folder,
              onClick: this.openPicker,
            },
            '从 R2 选择',
          ),
          value && h('span', { className: 'icelin-r2-current-note' }, '当前引用已保存为 R2 地址'),
        ),
        statusMessage && h(
          'p',
          { className: 'icelin-r2-status is-' + this.state.status, role: 'status' },
          statusMessage,
        ),
        this.state.secretRequired && this.renderSecretPrompt(),
        this.renderPicker(folder),
      );
    },
  });

  const R2ImagePreview = createClass({
    render: function () {
      const value = this.props.value;
      if (!value) return h('span', {}, '尚未选择图片');
      return h('img', {
        src: value,
        alt: '',
        style: { display: 'block', maxWidth: '100%', maxHeight: '360px', objectFit: 'contain' },
      });
    },
  });

  CMS.registerFieldType(
    'r2_image',
    R2ImageControl,
    R2ImagePreview,
    {
      properties: {
        r2_folder: { type: 'string' },
        r2_folder_mode: { type: 'string', enum: ['entry', 'fixed'] },
      },
    },
  );
}());
