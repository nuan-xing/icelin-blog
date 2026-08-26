# icelin-blog 的 R2 图片配置

项目的内容仍然由 GitHub 保存，图片由 Cloudflare R2 保存。Sveltia 的图片字段会把文件直接写入 R2，再把公开 URL 写入 Markdown/frontmatter；不会先把图片提交到 GitHub。

## 目录规则

| Sveltia 编辑位置 | R2 Object key |
| --- | --- |
| 专栏 `topics/qinglong-lake` | `qinglong-lake/<文件名>` |
| 专栏 `topics/astronomy` | `astronomy/<文件名>` |
| 普通摄影 `photos/...` | `photos/<文件名>` |
| 随笔正文未来接入图片 | `writing/<文件名>` |

专栏图片字段使用独立的 `r2_image` 控件。它读取当前编辑页的 entry slug，所以在 `qinglong-lake` 页面拖入文件时，目标前缀就是 `qinglong-lake/`，不会先上传到桶根目录再移动。

## Cloudflare Dashboard

### 1. 建立桶和最小权限 Token

创建桶 `icelin-blog-media`，然后创建只允许这个桶的 R2 API Token：

- 权限：`Object Read & Write`
- 范围：只选择 `icelin-blog-media`
- 不要使用账号级别的所有桶管理员权限

仓库配置只保存 `account_id`、`bucket`、`access_key_id` 和公开域名。`Secret Access Key` 不得写入仓库、`.env.example`、Astro 公开环境变量或前端源码。第一次使用自定义字段时，页面会要求输入 secret，并只保存到当前浏览器的 localStorage。

### 2. 设置 R2 CORS

在 R2 bucket 的 Settings → CORS policy 中填入下面配置。若以后使用自定义博客域名，把它追加到 `AllowedOrigins`：

```json
[
  {
    "AllowedOrigins": [
      "https://icelin-blog.pages.dev"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3000
  }
]
```

自定义域名示例：

```json
"AllowedOrigins": [
  "https://icelin-blog.pages.dev",
  "https://example.com"
]
```

### 3. 公开图片域名

测试阶段可以使用 R2 的 `r2.dev` public URL。正式使用建议把 bucket 绑定到单独的图片域名，例如 `img.example.com`，再在 Cloudflare Pages 的环境变量中设置：

```env
PUBLIC_R2_BASE_URL=https://img.example.com
```

代码中的媒体识别、媒体状态和页面渲染都会读取这个变量；切换域名不需要改 Markdown 或页面组件。若环境变量为空，仍会识别标准 `r2.dev` / `r2.cloudflarestorage.com` 地址作为兼容 fallback。

## 可选：Cloudflare Image Transform

R2 只保存一份高质量母版。若要让页面按设备请求 480、768、1080、1440、1600、1920 等宽度，先在承载图片域名的 Cloudflare zone 中启用 Image Transformations，然后在 Pages 的环境变量中设置：

```env
PUBLIC_IMAGE_TRANSFORM_BASE=https://img.example.com
```

页面会生成 Cloudflare 官方形式的 URL：

```text
https://img.example.com/cdn-cgi/image/width=1080,quality=88,format=auto,fit=scale-down/<R2公开图片URL>
```

如果暂时没有启用转换，变量留空即可，`ResponsiveImage` 会直接使用 R2 URL，构建不会失败，图片也不会消失。

## Sveltia 日常使用

1. 打开 `/admin/`，进入“专栏”，打开 `青龙湖公园` 或 `天文`。
2. 在“专栏图片”中添加图片，进入图片字段后直接拖拽或点击“浏览图片”。
3. 首次使用输入 R2 Secret Access Key；它不会出现在 GitHub。
4. 页面会显示 `R2 文件夹：qinglong-lake/` 或 `astronomy/`。上传状态完成后，字段里的地址就是 R2 URL。
5. 也可以点击“从 R2 选择”，选择器默认显示当前文件夹中“未添加”的对象；“全部/已添加”可用于复用已有图片。
6. 填写标题、日期、图片描述和说明，然后点击 Sveltia 的“保存”。GitHub 只会收到 Markdown/frontmatter 和图片 URL。

新建专栏时，先保存一次让 Sveltia 生成 entry slug，再拖拽上传图片。这样可以避免在 slug 尚未确定时把文件错误写入根目录。

## 图片大小策略

- `≤ 5 MB`：不重新编码、不转格式，原文件直接上传。
- `> 5 MB`：浏览器端先用高质量 WebP 尝试优化，长边最多约 5000px；质量从 92 逐步尝试到 82，目标约 3–5.8 MB。
- GIF、SVG 和无法处理的格式保留原文件。
- R2 每张作品只保留一份上传后的母版，不生成 thumb/display/full 多份对象。
- 上传文件名冲突时自动使用 `-2`、`-3` 等新文件名，不覆盖 R2 中未知对象。

## R2 图库与使用状态

打开 `/admin/media.html`（后台顶部的“R2 图库”）可以读取 bucket 中的真实对象。它会把 `/admin/media-status.json` 中已经出现在已提交内容里的 URL 标为“已添加”，其余对象标为“未添加”。状态索引由构建脚本生成，因此刚上传但尚未保存文章的对象会先显示为“未添加”；保存并部署后会自动变成“已添加”。

## 迁移旧的 `public/images`

脚本默认只预览，不上传、不删除本地文件、不修改 Markdown：

```bash
node scripts/migrate-images-to-r2.mjs --dry-run
```

确认清单后，使用仅限目标 bucket 的 Token 设置环境变量，再执行：

```bash
R2_ACCOUNT_ID=... \
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
R2_BUCKET=icelin-blog-media \
PUBLIC_R2_BASE_URL=https://img.example.com \
node scripts/migrate-images-to-r2.mjs --execute --rewrite-content
```

PowerShell 示例：

```powershell
$env:R2_ACCOUNT_ID = '...'
$env:R2_ACCESS_KEY_ID = '...'
$env:R2_SECRET_ACCESS_KEY = '...'
$env:R2_BUCKET = 'icelin-blog-media'
$env:PUBLIC_R2_BASE_URL = 'https://img.example.com'
node scripts/migrate-images-to-r2.mjs --execute --rewrite-content
```

脚本会：

- 跳过 `public/generated/images`，只扫描源图片；
- `≤ 5 MB` 原样迁移，大图默认按高质量 WebP 优化，`--keep-large` 可保留大图；
- `public/images/qinglong-lake` 写入 `qinglong-lake/`，`public/images/photos` 写入 `photos/`，`writing` 同理；
- 检测 R2 同名对象，无法确认是同一源文件时停止，避免覆盖；
- 只有所有上传完成后，`--rewrite-content` 才会更新 Markdown 引用；
- 从不删除本地文件。

## 访问与缓存建议

上传后不要覆盖同名文件。若要替换图片，使用新的、不可变的文件名（例如 `solar-ha-v2.webp`），这样可以避免 CDN 继续提供旧缓存。网站没有增加“原图下载”或 `original/fullImage` 字段。
