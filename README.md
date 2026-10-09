# Personal News · 私人阅报室

<p align="center">
  <strong>认真阅读，自主选择。</strong><br />
  一份属于自己的报纸，一套看得懂、调得动的新闻规则。
</p>

<p align="center">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-171717?style=flat-square" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-087EA4?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square" />
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-417E38?style=flat-square" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-003B57?style=flat-square" />
</p>

**Personal News** 是一个可自行部署的新闻阅读应用，将整版 PDF 阅报、私人批注与可解释的个人推荐放在同一处。它面向希望认真理解新闻、保存思考，并主动掌握信息选择方式的读者。

*A self-hosted news reading workspace with PDF annotations and transparent, user-controlled recommendations.*

[快速开始](#本机运行) · [阅读与笔记](#阅读与笔记) · [个人新闻算法](PERSONAL_NEWS.md) · [部署](#服务器部署与手机同步) · [架构](#架构)

## 从阅读到判断

| 能力 | 阅读体验 |
|---|---|
| **保留报纸版式** | 连续阅读整版 PDF，切换期数与版本，缩放、跳页并记住阅读位置。 |
| **让思考留在原文旁** | 文字高亮、下划线与批注；笔记关联不可变的 PDF 版本，支持跨期搜索。 |
| **在设备之间继续阅读** | 连接同一服务、登录同一私人账号后同步笔记；并发修改时提示冲突，保留草稿。 |
| **掌握自己的新闻规则** | 五题校准分别了解兴趣与重要性；通过设置、明确的自然语言指令及逐条反馈调整推荐。 |
| **看清推荐如何发生** | 检查筛选账本、评分依据与排序贡献，保存前预览整组推荐变化；可选多样性重排。 |
| **按自己的节奏回看** | 选择过去 1／7／30 天或自定义日期；导出、导入推荐规则文件，保留可撤销的调整记录。 |

个人推荐与公共重要新闻各有独立规则。阅读来源会标记已读，**不会自动训练偏好**；明确屏蔽和证据门槛优先于排序。详细机制见[个人新闻算法说明](PERSONAL_NEWS.md)。

## 当前阶段

项目处于早期可运行阶段。推荐使用本地可解释规则，尚未接入实时新闻采集或通用大模型。仓库内的默认选题是历史编辑样本，界面会注明日期与未实时复核的状态；它不是实时新闻服务。公共重要区需要完整的编辑影响评估，默认历史样本未提供该评估，因此该区可能为空。

私人 PDF 阅报室使用部署者生成的账号；`/personal` 支持独立注册个人推荐账号，新注册账号不能访问部署者的私人报刊和笔记。公开的是应用源码，个人数据库、密码、笔记和本地研究资料不随仓库发布。

## 本机运行

需要 Node.js 24 和 npm。首次运行：

```powershell
npm ci
npm run setup
npm run dev
```

打开 http://127.0.0.1:3000 。`npm run setup` 生成私人账号，用户名和随机密码保存在被忽略的 `.local-access.txt`；密码的加盐哈希写入 `.env.local`。账号已配置时不要重复运行 setup。不要提交或分享这两个文件。

启动后可打开 `http://127.0.0.1:3000/personal` 注册账号并体验个人推荐。私人阅报室还需要导入你自己的文字型 PDF；公开仓库不附带个人报刊和本地采编生成流程。应用导入默认读取 `output/pdf`（使用前自行创建并放入 PDF），也可以直接指定已有文件或目录：

```powershell
npm run import -- "path/to/your-newspaper.pdf"
```

导入按 SHA-256 去重，重复导入不会新增记录。相同日期但不同内容保存为独立版本，旧文件和旧笔记不会被覆盖。新导入记录在刷新页面后出现。

## 阅读与笔记

- 在“我的新闻”或“往期报刊”选择全部、过去 1／7／30 天；自定义支持过去 1–30 天或起止日期（含首尾，最多 30 天）。快捷区间按北京时间自然日计算并包含今天。PDF 阅读工具栏的“选择时间区间”进入报刊筛选。
- 个人新闻先筛选日期再推荐；公共重要区使用同一区间。往期 PDF 按期刊日期筛选，多日合刊以结束日期归档，保持整期内容。区间选择不修改个人推荐规则；刷新页面后恢复全部。
- 最新一期直接打开报刊；往期报刊可切换期数及版本。
- 在正文选中文字，点击高亮、划线或写笔记；跨页内容请分别标注。
- 点击标注或笔记的“编辑”可修改颜色、类型、批注或删除。笔记摘录可跳回对应页面和位置。
- 本期笔记在电脑侧栏显示，在手机上点击“笔记”打开。我的笔记支持跨报刊搜索和筛选。
- 已保存的笔记在页面获得焦点时和前台每 15 秒同步。两台设备同时修改同一笔记会提示冲突，保留草稿；查看服务器最新内容后再保存。
- 未提交草稿保留在当前浏览器。退出账号不会清除草稿，请仅在自己的设备上使用；清除浏览器数据会删除草稿。草稿不等于已同步笔记。
- 此阅读模块需要网络，不支持扫描件 OCR、手写绘图、多人共享笔记、离线打开报刊或笔记导出。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:personal:e2e
npm run test:period
npm run test:period:e2e
```

浏览器测试使用独立数据库、随机测试账号和 3107 端口，不修改个人笔记。Windows 默认查找本机 Chrome；其他环境可设置 `CHROME_PATH`，或用 Playwright 安装 Chromium 后直接运行。测试结果和截图在 `test-results`。

时间区间专项浏览器测试使用独立数据库和 3119 端口，覆盖两个入口、日期校验、空结果以及桌面与手机布局；运行前先完成构建。

已验证 Chrome 桌面与移动尺寸模拟，包括双设备同步、冲突、草稿恢复和重启保留。实体手机、Safari 和 Docker 公网部署仍需在相应设备或服务器验收。

## 服务器部署与手机同步

先准备一台有持久磁盘、支持 Docker Compose 的服务器，以及解析到该服务器的域名。此项目不会自动购买或发布服务。

1. 在服务器创建 `.env.production`，写入 `NEWS_USERNAME`、`NEWS_PASSWORD_HASH` 和 `NEWS_ORIGIN=https://你的域名`。使用独立目录运行 `scripts/setup.mjs` 生成部署专用随机账号，再安全转存哈希；不要将明文密码放入 Compose 文件。
2. 在服务器 `.env` 中写入 `NEWS_DOMAIN=你的域名`，并开放 80、443 端口。
3. 运行 `docker compose up -d --build`。Caddy 自动配置 HTTPS，应用端口不直接暴露到公网。
4. 将生成的 PDF 放入服务器 `output/pdf`，运行 `docker compose exec reader node node_modules/tsx/dist/cli.mjs scripts/import-pdfs.ts /imports`。
5. 电脑和手机打开同一个 HTTPS 地址，用私人账号登录。

SQLite 和原始 PDF 保存在 `reader_data` 持久卷。此方案必须单实例运行，不应把数据库放在临时文件系统或让多个副本分别持有数据。会话有效期 30 天；账号密码用 scrypt 哈希保存，登录失败有次数限制，写接口校验请求来源。

## 备份和恢复

本机运行 `npm run backup`；容器运行 `docker compose exec reader node node_modules/tsx/dist/cli.mjs scripts/backup.ts`。备份先通过 SQLite 在线备份 API 创建一致的数据库副本，再复制不可变 PDF 文件。备份保存在 `backups` 或 `reader_backups` 卷，需定期另存到其他磁盘；账号配置需单独安全备份。

恢复前停止应用，将备份中的 `news.sqlite` 和 `pdfs` 恢复到一个空数据目录，设置 `NEWS_DATA_DIR` 后启动。不要把恢复的数据库与旧的 `-wal` / `-shm` 文件混用。恢复数据包含会话，若需使全部设备重新登录，可在维护时清空 sessions 表。

## 架构

Next.js App Router 提供界面和受保护的 `/api` 接口；PDF.js 负责渲染和文字层。标注区域保存在 PDF 原页面坐标中，显示时按当前缩放转换；分行保存矩形，避免把栏间空白一起涂色。数据库使用 Node.js 24 的内置 SQLite 驱动。

API：`/api/login`、`/api/logout`、`/api/session`、`/api/editions`、`/api/pdf/:editionId`、`/api/annotations`、`/api/annotations/:id`、`/api/progress/:editionId`。标注更新和删除需要当前版本号，冲突返回 409。创建由客户端生成唯一 ID，重试不会重复创建；删除保留墓碑，旧设备不能让记录复活。

```text
app/           页面、样式与 API 入口
components/    PDF 阅读、笔记、推荐与规则解释界面
lib/           账号、SQLite 存储、筛选与推荐逻辑
scripts/       初始化、导入、备份及启动工具
tests/         单元、接口与浏览器场景验证
```

## 已知边界

- 当前自然语言调整是有限规则解析；开放式对话、选中文本问答和实时采编尚未接入。
- 暂不支持扫描件 OCR、离线阅读、手写绘图、多人共享笔记或笔记导出。
- 推荐多样性使用主题与来源标签启发式，不保证语义、事件或观点多样性；推荐效果仍需实际使用评价。
- 暂无密码找回或账号管理后台。Docker 配置已提供，实体手机、Safari 与公网部署仍需对应环境验收。
- 当前未指定开源许可证；仓库公开可见不代表已授予任意使用、修改或再分发许可。

欢迎通过 Issue 反馈可复现的问题或讨论设计。反馈时请移除账号配置、数据库、私人报刊与笔记。
