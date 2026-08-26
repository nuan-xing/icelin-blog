# icelin 的 Cloudflare 内容系统

博客不再使用 Sveltia 或 Git 作为运行时内容库：

- **D1** 保存随笔、摄影条目、专题、说明和图片引用；
- **R2** 只保存图片原件；
- **Worker** 提供公开读取与受密码保护的编辑接口；
- **Pages** 承载博客和 `/admin/` 自建编辑室。

Markdown 文件保留在 `src/content/`，仅作为迁移备份和恢复来源；网站公开页面与编辑室均以 D1 为准。

## 日常编辑

打开 `https://icelin-blog.pages.dev/admin/`：

1. 登录“icelin 编辑室”。
2. 在“随笔”“摄影”或“专题”中编辑内容并保存；保存会直接写入 D1。
3. 在图片字段中拖拽或选择图片。浏览器会把图片交给 Worker，Worker 再写入 R2；浏览器不持有 R2 密钥。
4. 保存后刷新博客即可看到更新，无需 Git 提交或等待静态构建。

## R2 文件夹规则

| 编辑位置 | R2 object key |
| --- | --- |
| 摄影作品 | `photos/<文件名>` |
| 随笔正文图片 | `writing/<文件名>` |
| 专题 `qinglong-lake` | `qinglong-lake/<文件名>` |
| 任意专题 `<slug>` | `<slug>/<文件名>` |

新建专题时，先保存一次。系统会生成专题 slug，之后拖拽上传会自动进入同名 R2 文件夹，不会写到桶根目录。

“R2 图库”实时列出 bucket 对象，并根据 D1 中的图片引用显示“已添加”或“未添加”。被引用的图片默认不能删除；如确有需要，可在编辑室中确认强制删除。

## 部署配置

`wrangler.jsonc` 绑定 D1 `blog` 和 R2 bucket `icelin-blog-media`。生产环境需要两个 Worker Secret：

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

它们只保存在 Cloudflare，不要写入仓库、`api-config.js`、浏览器 localStorage 或任何前端文件。

部署 Worker：

```powershell
npx wrangler deploy
```

构建并部署 Pages：

```powershell
npm run build
npx wrangler pages deploy dist --project-name icelin-blog
```

如 Worker 地址改变，更新 `public/api-config.js` 中的 `ICELIN_API_URL` 后重新部署 Pages。

## 首次或重新迁移内容

迁移脚本会读取现有 Markdown，生成 D1 表结构和 upsert 数据；默认只是预览：

```powershell
node scripts/migrate-content-to-d1.mjs
```

确认后执行：

```powershell
node scripts/migrate-content-to-d1.mjs --execute
```

该操作不会删除 Markdown 或 R2 对象。导出的临时 SQL `database/seed.generated.sql` 已被 git 忽略。

## 图片大小与缓存

- 小于约 5.8 MB 的图片按原样上传；更大的常规图片在浏览器中尝试转为高质量 WebP，最长边限制约 5000px。
- 文件名冲突时，Worker 自动使用 `-2`、`-3` 等后缀，绝不覆盖未知对象。
- 建议替换图片时上传新文件名，而不是覆盖旧 object key，避免 CDN 缓存显示旧图。
- 需要 Image Transform 时，可在 `public/api-config.js` 设置 `ICELIN_IMAGE_TRANSFORM_BASE`；留空时页面直接使用 R2 公共 URL。
