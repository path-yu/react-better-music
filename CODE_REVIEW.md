# 代码审查与修改记录（声屿）

> **日期**：2026-11-22**范围**：`src/**`、`server/remoteControl.js`；按要求未查看 `server-rust/`、`src-tauri/`**方法**：只读通读核心模块 + 全仓关键字检索；`UI_REVIEW.md` 中已修复的项不重复记录**用途**：合并前的改动清单与回归检查表

---

## 0. ⚠️ 验证状态

本文所有改动**都没有运行过类型检查、lint 和测试**（审查环境无法执行命令）。每批改动都做过以下静态核对：

- 每处替换必须在原文件中**唯一命中**，否则整批不写入
- 改动文件的大括号、小括号、`<Trans>` 标签成对
- 删除的变量没有遗留引用；原文件的 CRLF 换行保留

合并前请务必执行：

```bash
pnpm i18n:extract && pnpm typecheck && pnpm typecheck:desktop && pnpm lint && pnpm test

```

`i18n:extract` 会刷新 `.po` 里的源码行号引用。新增文案已手动补进 `en.po` 和 `zh-CN.po`，但条目追加在文件末尾，提取后顺序会被重排，属正常现象。

建议按下面的批次拆成独立提交，出问题时便于回退。

---

## 1. 需要知道的行为变化

| 变化 | 说明 | 影响 |
| --- | --- | --- |
| **新增「列表循环」，默认模式改为它** | 切换顺序：列表循环 → 随机 → 单曲循环 → 顺序播放。「顺序播放」现在播完最后一首就停 | 老用户保存的「顺序播放」通过 `react-music-player` v1 迁移转成列表循环，听感与以前一致 |
| **试听结束暂停并提示** | 以前因 bug 会直接跳到下一首 | VIP 歌多的歌单会频繁停下（已确认保持此行为） |
| **手机遥控默认关闭** | API 改为只监听 `127.0.0.1`；遥控开启后单独监听 **13003** 端口 | 以前用过遥控的用户需在「设置 → 手机遥控」重新开启并扫码；首次开启 Windows 会弹防火墙提示 |
| **退出登录不再清空播放队列** | 只清除喜欢标记和心动模式 | 以前删存储键后会被下一次状态写回，行为本就不稳定 |
| **清空播放列表需点两次** | 第一次点击变成「确认清空？」，3 秒内再点才清空 | — |
| **⌘ + ← / → 用于切歌** | 与 Mac Safari 的「后退 / 前进」冲突 | 只影响网页版；桌面版（Windows）不受影响 |
| **切歌后伴奏继续在后台生成** | 结果写入缓存，切回该歌自动应用 | 这段时间 CPU 仍被占用（以前同样在跑，只是结果被丢弃） |
| **登录 cookie 改走请求头** | Node API（`server/`）从 `X-NCM-Cookie` 请求头读取会话；Tauri 版仍用 `?cookie=` | 桌面版跨域请求会多一次预检（OPTIONS，本机耗时可忽略）；**Node API 与前端需同时更新**，旧 API 读不到请求头会按游客处理 |
| **`pnpm dev:api` 只监听本机** | 加了 `--host 127.0.0.1` | 开发时要让局域网访问，改用 `node server/app.js` 或设 `HOST=0.0.0.0`；Docker 镜像不受影响 |
| **底部播放栏右侧默认改为剩余时间** | 三处进度条统一，默认显示 `-m:ss` | 想看总时长可在设置里关掉，或直接点一下右侧的时间 |
| **离开有未保存修改的页面会弹确认** | 歌单编辑页、个人资料页 | 网页版关闭或刷新标签页只能显示浏览器自带提示；桌面版不拦截 |

---

## 2. 改动清单（按批次）

### 第 1 批：高优先级 Bug

| 问题 | 修复 | 文件 |
| --- | --- | --- |
| `next({ auto })` 的标记被丢弃，顺序模式不会停；音源全坏时无限「出错 → 刷新 → 下一首」 | `step(direction, auto)`：自动前进时在末尾停止，最后一首提前 0.4s 的预切换不截掉结尾；连续 5 首报错（不足 5 首按队列长度）暂停并提示一次，任一首正常播放超过 1 秒计数清零 | `store/player.ts`、`PlayerBar.tsx` |
| 刷新播放地址时，歌词接口失败导致整首歌被判为失效 | `enrichSong` 改用带缓存和去重的 `loadLyricsPatch`，失败返回空；同一版本已有歌词直接复用；失败时保留当前显示的歌词 | `store/player.ts` |
| 歌单增删歌曲后 5 分钟内看不到变化 | 三个增删接口完成后清除 `/playlist/detail`、`/playlist/track/all` 缓存 | `api/index.ts` |
| Safari 没有 `requestIdleCallback`，网页版整个外壳崩溃 | 特性检测，不支持时退回 `setTimeout` | `AppShell.tsx` |
| 清空列表后，进行中的加载请求仍写回状态 | `clearQueue` 递增 `loadRequestId`，并重置插播、歌词加载、恢复进度 | `store/player.ts` |

### 第 2 批：试听时长

`freeTrialInfo` 的 `{start, end}` 是试听片段在原曲中的位置，返回的文件本身只有 `end - start` 秒。以前直接用 `end`，导致进度条、提示文案、试听结束判断全部错误。

| 修复 | 文件 |
| --- | --- |
| 新增 `trialLengthSeconds()`：按 `end - start` 计算；值大于 600 视为毫秒换算；用接口 `time` 字段（实际文件时长）兜底并封顶；都拿不到按 30 秒 | `lib/songs.ts` |
| 5 组单元测试（秒、毫秒、文件时长兜底、整首可播） | `lib/songs.test.ts` |
| 试听歌曲不再提前切下一首；到达试听时长或文件播完时统一暂停，只提示一次 | `PlayerBar.tsx` |
| 试听结束后再按播放从头开始 | `store/player.ts` |

> 未用真实试听歌曲验证（当时本地 API 未运行）。验证方法见第 4 节。

### 第 3 批：断网登出、长歌单丢歌、遥控鉴权

**断网启动被登出**（`store/user.ts`）

- 有登录 cookie 但服务不可达（断网、超时、桌面 API 未就绪、5xx）时保留本地登录信息
- 自动重试：`online` 事件立即重试，否则按 5s / 15s / 30s / 60s 退避
- 并发的 `initSession` 合并为一次；登出、过期、重新登录时取消重试

**长歌单静默丢歌**（`api/index.ts`、`routes/songlists/$id.tsx`）

- `fetchRemainingPlaylistTracks` 返回 `{ songs, failedPages }`；失败页等 0.8s 重试一次；按页码归位，不打乱顺序
- 仍有缺失时提示「有 N 首歌曲加载失败，可点击「刷新」重试」

**局域网遥控鉴权**

| 层 | 改动 | 文件 |
| --- | --- | --- |
| 主进程 | API 只监听本机；开关和配对密钥存 `remote-control.json`；每次启动生成仅主进程持有的管理密钥 | `src/bun/index.ts` |
| 服务端 | 开启后才在 13003 开局域网监听，只对外提供 `/remote`；手机接口校验配对密钥（`timingSafeEqual`）；写状态、读命令只允许本机且拒绝跨域网页；重置配对立即断开已连接手机 | `server/remoteControl.js` |
| 手机页面 | 密钥存本地，「添加到主屏幕」后仍保持配对；密钥失效提示重新扫码 | `server/remoteControl.js` |
| 设置页 | 新增「手机遥控」卡片：开关、二维码（多网卡可切换）、已连接设备数、重置配对、防火墙说明；Tauri 版不显示 | `components/settings/RemoteControlCard.tsx`（新）、`lib/desktopBridge.ts`、`routes/settings.tsx` |

### 第 4 批：性能

| 问题 | 修复 | 文件 |
| --- | --- | --- |
| 播放栏（约 1700 行）每次 `timeupdate` 整体重渲染（约 4 次/秒） | 拆出 `AudioProgressRow`、`VideoProgress` 各自订阅进度；系统媒体控件进度改为订阅 store | `PlayerBar.tsx` |
| 播放页（约 1900 行）打开时每次时间更新整体重渲染 | 只订阅当前歌词行号；黑胶封面、逐字歌词由 `LivePlayerArtwork` / `LiveLyricStage` 各自订阅 | `NowPlaying.tsx` |
| 播放页关闭（只是隐藏）时，内部控制条和进度条仍在后台刷新 | 新增 `selectOverlayTime`：关闭时停在最后显示的位置，切歌归零 | `store/player.ts`、`NowPlayingTransport.tsx`、`ImmersivePlayerBar.tsx` |
| 每次播放先下载封面再查缓存 | 先查缓存；本次运行已处理过的封面直接跳过 | `lib/coverCache.ts` |
| 封面 Object URL 从不释放 | 最多保留 120 个，超出释放最久未用的 | `lib/coverCache.ts` |
| 无 `content-length` 的预取要下完才发现超过 32MB | 流式读取，超限立即中断 | `lib/audioPrefetch.ts` |
| 滚动时每帧同步写 `sessionStorage` | 最多每 150ms 写一次，离开页面前补写 | `AppShell.tsx` |
| 换搜索关键词多发一次请求 | 页码与「关键词 + 标签」绑定（第 5 批进一步移入 URL） | `routes/search.tsx` |

### 第 5 批：体验改进

| 改进 | 说明 | 文件 |
| --- | --- | --- |
| 列表循环模式 | 见第 1 节；模式名称统一放在 `PLAY_MODE_LABELS` | `lib/playMode.ts`（新）、`store/player.ts`、三处播放控件 |
| 记住播放进度 | 每 5 秒及窗口隐藏/关闭时保存到 `react-music-player-position`；重启后首次播放从该位置继续；离结尾不足 5 秒或不足 3 秒的不恢复 | `store/player.ts`、`PlayerBar.tsx` |
| 喜欢按钮即时反馈 | 先更新界面，失败回滚；请求未完成时忽略重复点击；成功后清除「我喜欢的音乐」缓存。本地收藏同样处理 | `store/user.ts`、`store/localLibrary.ts` |
| 合并跳过提示 | 「已跳过 N 首无法播放的歌曲」/「连续 N 首歌曲无法播放，已停止播放」；只跳 1 首时保留具体原因 | `store/player.ts` |
| 搜索页码写入 URL | 返回时回到原页码；第 1 页不加参数 | `routes/search.tsx` |
| 新增快捷键 | ← / → 快退快进 5 秒；Ctrl/⌘ + ← / → 切歌；M 静音；L 喜欢。输入框、弹窗、滑块、标签栏内不触发；设置页列表同步 | `PlayerBar.tsx`、`routes/settings.tsx` |
| 系统媒体控件封面 | 请求 512px 缩略图 | `PlayerBar.tsx` |
| 退出登录 | 见第 1 节 | `store/user.ts` |
| 顺带修复 | 重启后先点进度条再播放会从头开始：现在点击位置优先于自动恢复位置 | `PlayerBar.tsx` |

### 第 6 批：剩余组件审查后的修复

**回归**（第 5 批引入）：「我喜欢的音乐」改成多语言后，两处菜单仍按中文名过滤，英文界面下 Liked Songs 出现在「收藏到歌单」列表。现在读取歌单时打上 `isMyLike` 标记，按标记排除。

**Bug**

| 问题 | 修复 | 文件 |
| --- | --- | --- |
| 右键菜单中滚动歌单列表会关闭整个菜单 | 菜单内部滚动不触发关闭 | `SongContextMenu.tsx` |
| 外层重新渲染导致登录二维码重新生成；提示写错端口 | `onOpenChange` 改存 ref；提示改为「请确认本地 API 服务已启动」 | `LoginModal.tsx` |
| 导入歌单不检查添加结果；匹配阶段无法取消；直接取搜索第一条；未匹配的歌静默丢弃 | 检查每批返回并提示已导入数量；关闭对话框即取消；按歌手、歌名、时长打分选最佳；显示未匹配数量（悬停看明细） | `ImportPlaylistDialog.tsx` |
| 切歌后正在生成的伴奏被丢弃；轮询无总超时 | 继续跟进并写入缓存，切回自动应用；总超时为预计用时 4 倍、至少 10 分钟 | `store/smartStem.ts` |
| 伴奏缓存无限增长 | 最多保留最近使用的 30 首；设置页新增「清除伴奏缓存」 | `lib/smartStemCache.ts`、`routes/settings.tsx` |
| 随心唱人声卡顿 | 音量均衡调音量不再触发跳转；小偏差用播放速度微调（±5%），超过 0.25s 才跳转 | `lib/karaoke.ts` |

**体验**

- 歌单编辑：保存或换封面后刷新侧栏歌单（`$id.edit.tsx`）
- 播放列表：打开时滚到当前歌曲；清空二次确认（`QueuePanel.tsx`）
- 语音评论：播完自动恢复被暂停的音乐；评论点赞防连点，热门/最新同步更新（`CommentSection.tsx`）
- 加入歌单：重复歌曲提示「这首歌已在该歌单中」；本地歌单显示服务端原因（`PlaylistPicker.tsx`、`SongContextMenu.tsx`、`store/localLibrary.ts`）
- 右键菜单：打开时聚焦第一项，支持 ↑ ↓ Home End，关闭后焦点归还（`SongContextMenu.tsx`）

**多语言**：补齐约 90 条文案，包括 404/出错页、`EmptyState`、歌单编辑页、个人资料页（月份用 `Intl` 本地化）、10 种配色、Spleeter 格式与码率、智能伴奏全部提示、MV 详情、首页日期、伴奏剩余时间、音量读屏文字、若干底层错误信息。

### 第 7 批：离开页面确认

| 文件 | 内容 |
| --- | --- |
| `lib/useUnsavedChangesGuard.ts`（新） | 基于 TanStack Router `useBlocker`，拦截侧栏链接、前进后退、代码跳转；保存成功后用 `allowNextNavigation()` 放行一次 |
| `components/common/UnsavedChangesDialog.tsx`（新） | 应用内确认弹窗：「继续编辑」/「放弃修改」，Esc 或点外部等于继续编辑 |
| `routes/songlists/$id.edit.tsx` | 移除 `window.confirm`，接入统一拦截 |
| `routes/profile.tsx` | 新增拦截：昵称、简介、性别、生日、地区有改动时生效（头像即时上传，不计入） |

### 第 8 批：遗留项

| 问题 | 修复 | 文件 |
| --- | --- | --- |
| 登录 cookie（含 `MUSIC_U`）拼在 GET/POST 请求网址里，会进日志、URL 过长 | 改为 `X-NCM-Cookie` 请求头；`/login/refresh` 同样处理。服务端在响应缓存之前解析该请求头，缓存键仍按会话区分；和 `?cookie=` 一样整体替换浏览器 cookie 罐，避免旧登录残留。服务端日志里的 `cookie=` 参数打码。Tauri 版（server-rust）保留查询参数 | `lib/http.ts`、`lib/session.ts`、`server/server.js` |
| `pnpm dev:api` 监听所有网卡 | 脚本加 `--host 127.0.0.1`，`app.js` 支持该参数；Docker / `npm start` 行为不变 | `package.json`、`server/app.js` |
| 恢复进度后，播放页进度和歌词停在 0:00 | 尚未加载音频时，播放页显示保存的位置 | `store/player.ts` |
| 刷新后第一次播放，底部播放栏和详情页进度条先显示 0:00，音频加载完再跳到恢复位置 | 有待恢复位置（`resumeAt`）时，两处进度条都显示目标位置，直到音频跳转完成；新音源加载时共享的 `currentTime` 不再先归零；`onPlaying` 兜底，确保待恢复位置不会一直挂着。切换音源、出错重载也一并受益 | `PlayerBar.tsx`、`store/player.ts` |
| 刷新后还没播放时，在详情页点击或拖动进度条无效，滑块弹回恢复位置（上一条修复引入的回归）。原因：详情页、沉浸式播放栏直接给还没加载音频的元素设 `currentTime`（会被忽略），而进度条在有待恢复位置时显示 `resumeAt`；按播放时也仍从记住的位置开始 | 新增统一入口 `seekTo`：音频已加载就直接跳转，否则把目标记为 `resumeAt`，加载后应用；按播放时优先用这次拖动的位置；详情页、沉浸式播放栏、手机遥控、系统媒体控件的拖动都走它，底部栏的延迟拖动也同步到这里 | `store/player.ts`、`NowPlayingTransport.tsx`、`ImmersivePlayerBar.tsx`、`PlayerBar.tsx`、`lib/remoteBridge.ts` |
| 边听边缓存重复下载：`<audio>` 的缓冲 JS 读不到，播放 10 秒后缓存任务又向 CDN 完整下载一次 | 新增 `server/audioTee.js`：同一媒体地址第一次完整请求时全速下载到临时文件，播放、进度内拖动、缓存任务、重播都从这个正在增长的文件读；拖到未下载部分 2MB 以外仍直接请求 CDN；没人读的未完成下载 5 秒后放弃（快速切歌不会下完每一首）；最多 8 个 / 300MB，25 分钟过期；临时目录按进程区分，启动时清理已退出进程留下的目录。**自查修复**：读取端原先在写入流异步创建文件之前就去打开文件，首个播放请求可能因 ENOENT 失败，现在改为有数据写入后才打开；读取端在打开期间被销毁时，文件句柄会被关闭 | `server/audioTee.js`（新）、`server/server.js` |
| vitest 未配置 Lingui，底层文件无法翻译 | `vitest.config.ts` 接入 `@lingui/vite-plugin`（与构建相同的宏转换和 `.po` 加载）；`songs.ts`「未知专辑」、`video.ts`「视频」、`image.ts` 两条错误改走多语言 | `vitest.config.ts`、`lib/songs.ts`、`lib/video.ts`、`lib/image.ts`、`lib/format.test.ts` |

### 第 9 批：界面规范统一

| 内容 | 说明 | 主要文件 |
| --- | --- | --- |
| 深色模式 bug | 5 处卡片悬停变成近白底（`hover:bg-white/80`）、本地歌单重命名输入框白底（`bg-white/70`），以及另外 7 个缺失的深色映射 | `styles.css` |
| 文字灰度 | 18 档 `text-black/NN` 收敛为 `ink-1`～`ink-4` 四级（443 处），深色值由变量控制；沉浸播放页、二维码白底单独覆盖变量 | 全部组件、`styles.css` |
| 语义色 | `#ff2d55`、`#ff9500`、`#b36b00`、`#d70015`、`#ff3b30` 改为 `love` / `warn` / `warn-ink` / `danger` 变量（47 处），深色值随主题切换 | 全部组件、`styles.css` |
| 字号 | 小于 11px 的全部提到 11px；11.5/12.5/14/16/17/18/30 归到 12/13/15/19/28（127 处）；删除 12 处对 `.headline-lg` 等类无效的字号覆盖 | 全部组件 |
| 圆角 | 收敛到 6/10/14/18/22/28（55 处，含 10 处命名圆角） | 全部组件 |
| 页面结构 | 新增 `PageHeader` 和 `.page` / `.page-header` / `.page-subtitle` / `.page-bleed`；所有页面边距统一；首页、设置页、最新音乐、最新 MV、排行榜、个人资料、歌单编辑、本地收藏改用 `PageHeader`；页面标题去掉图标；「发现音乐」页统一加 eyebrow；设置页恢复页面标题 | `components/common/PageHeader.tsx`（新）、各 `routes/*` |
| 区块标题 | 首页改用 `.section-title`，与其他页一致 | `routes/index.tsx` |
| 筛选控件 | 推荐歌单、最新音乐、最新 MV 统一为 `.chip` 胶囊（带 `aria-pressed`）；最新 MV 去掉外层卡片 | `songlists/index.tsx`、`latest-music.tsx`、`latest-mv.tsx` |
| 时间格式 | `formatDuration` 改为 `m:ss` / `h:mm:ss`；新增 `formatRemaining`（`-m:ss`）。三处进度条右侧统一用 `TimeToggle`：默认显示剩余时间，「设置 → 播放 → 进度条显示剩余时间」或点击右侧时间可切换为总时长，三处共用同一个设置 | `lib/format.ts`、`format.test.ts`、`components/player/TimeToggle.tsx`（新）、`store/settings.ts`、`PlayerBar.tsx`、`NowPlayingTransport.tsx`、`ImmersivePlayerBar.tsx`、`routes/settings.tsx` |
| 播放按钮顺序 | 三处统一为 上一首 · 播放 · 下一首 · 模式 · 列表 | `NowPlayingTransport.tsx`、`ImmersivePlayerBar.tsx` |
| 细节 | 歌单卡片不再预留两行标题高度；首页横幅去掉重复日期；侧栏二级分组标题改用 `.sidebar-subheading`；设置页卡片内分组去掉第二层边框 | `PlaylistCard.tsx`、`routes/index.tsx`、`Sidebar.tsx`、`routes/settings.tsx` |
| 规范约束 | 新增 `designTokens.test.ts`：字号、圆角、`text-black`、语义色十六进制、未映射的浅色面板类，任一违规 `pnpm test` 失败；`DESIGN.md` 按应用实际重写 | `lib/designTokens.test.ts`（新）、`DESIGN.md` |

> 更正：之前说「详情页标题有 24/28/32 三种」，实际 `.headline-lg` 等类不在 CSS layer 中，同元素上的 `text-[Npx]` 不生效，详情页标题本来都是 28px。这批改动只删除了这些无效类，视觉不变。

---

## 3. 改动文件汇总

前 8 批共 57 个文件，其中新增 5 个（标 ★）。第 9 批又改动约 60 个文件（大部分为全局替换），新增 `components/common/PageHeader.tsx`、`lib/designTokens.test.ts`。

```
package.json, vitest.config.ts
server/remoteControl.js, server/server.js, server/app.js, ★server/audioTee.js
src/
├── api/            index.ts, local.ts
├── bun/            index.ts
├── components/
│   ├── comments/   CommentSection.tsx
│   ├── common/     EmptyState.tsx, ★UnsavedChangesDialog.tsx
│   ├── layout/     AppShell.tsx, LoginModal.tsx
│   ├── player/     PlayerBar.tsx, NowPlaying.tsx, NowPlayingTransport.tsx,
│   │               ImmersivePlayerBar.tsx, QueuePanel.tsx, PlaylistPicker.tsx,
│   │               VolumeSlider.tsx
│   ├── playlists/  ImportPlaylistDialog.tsx
│   ├── settings/   ★RemoteControlCard.tsx
│   ├── songs/      SongContextMenu.tsx, SongTable.tsx
│   └── video/      VideoCard.tsx
├── lib/            songs.ts, songs.test.ts, coverCache.ts, audioPrefetch.ts,
│                   karaoke.ts, smartStemCache.ts, spleeter.ts, theme.ts,
│                   desktopBridge.ts, http.ts, session.ts, video.ts, image.ts,
│                   format.test.ts, ★playMode.ts, ★useUnsavedChangesGuard.ts
├── locales/        en.po, zh-CN.po
├── routes/         settings.tsx, search.tsx, profile.tsx, index.tsx, daily.tsx,
│                   __root.tsx, mv/$id.tsx, songlists/$id.tsx, songlists/$id.edit.tsx
└── store/          player.ts, user.ts, localLibrary.ts, smartStem.ts

```

---

## 4. 回归检查清单

**播放**

- [x] 列表循环：最后一首播完回到第一首；顺序播放：播完最后一首停止且结尾完整
- [ ] 建一个全是失效歌曲的小列表，开随机模式：很快暂停，只提示一次
- [ ] DevTools 将 `/lyric/new` 设为失败，拖动进度条或模拟卡顿：歌曲继续播放，歌词不变
- [ ] 播到 1:30 关闭应用再打开：底部进度条和播放页都显示 1:30，按空格从 1:30 继续
- [ ] 重启后先点进度条再按播放：从点击位置开始
- [ ] 刷新后按播放：底部和详情页进度条在加载期间一直停在恢复位置，不会先跳回 0:00；「切换音源」时同样不跳
- [ ] 刷新后**先不播放**，在详情页和底部栏分别点击、拖动进度条：滑块停在新位置，按播放从新位置开始；手机遥控拖动同样有效
- [ ] 快捷键：← / →、Ctrl + ← / →、M、L；在搜索框和滑块上不触发
- [ ] Windows 媒体浮层的封面和进度正常

**试听**

- [ ] 不登录播一首 VIP 歌，Network 中查看 `/song/url/v1` 的 `freeTrialInfo` 与 `time`
- [ ] 进度条显示约 0:30，到点暂停并提示「试听结束」；再按播放从头开始

**性能**

- [ ] React DevTools 勾选「Highlight updates」：播放时只有进度条一行闪烁
- [ ] 重复播放同一首歌，Network 中不再出现封面请求
- [ ] 直接点一首未缓存的歌播放：服务端只向 CDN 请求一次；10 秒后缓存任务完成，设置页缓存列表出现这首歌
- [ ] 播放中拖动进度条（已下载部分和很靠后的位置各试一次）：都能正常继续播放
- [ ] 快速连续切歌：系统临时目录 `qimiao-audio-proxy` 下不会留下大量文件
- [ ] 在搜索第 3 页换关键词：只发一次 `offset=0` 请求；进入歌曲再返回仍在原页码

**账号与网络**

- [ ] 断网启动：仍显示已登录、喜欢列表还在；联网后几秒内恢复歌单
- [ ] 断网点喜欢：先变红再变回，并提示「操作失败」
- [ ] 退出登录：音乐不中断，队列保留
- [ ] 登录弹窗打开时切换路由：二维码不重新生成
- [ ] Network 面板：API 请求网址里不再有 `cookie=`，请求头带 `X-NCM-Cookie`；登录后「每日推荐」「我喜欢的音乐」正常，退出后变回游客内容
- [ ] 服务端控制台日志不出现 cookie 内容

**歌单**

- [ ] 往歌单加歌、删歌后立即进入：能看到变化；重复添加提示已在歌单中
- [ ] 拦截某个 `offset` 的 `/playlist/track/all`：出现缺失提示，点「刷新」补齐
- [ ] 英文界面下「收藏到歌单」列表中没有 Liked Songs
- [ ] 右键菜单滚动歌单列表不会关闭；方向键可切换菜单项
- [ ] 导入 QQ / Apple Music 歌单：匹配中可关闭取消；结果显示未匹配数量
- [ ] 编辑歌单后点侧栏其他页面或浏览器后退：弹出确认；保存后不弹；侧栏名称立即更新
- [ ] 个人资料页同上

**手机遥控**

- [ ] 默认状态下手机访问 `电脑IP:13000/remote/` 打不开
- [ ] 开启后扫码能控制；「重置配对」后手机提示重新扫码；关闭后 13003 不再监听

**智能伴奏**

- [ ] 生成伴奏途中切歌，再切回：生成完成后自动应用，不重新生成
- [ ] 随心唱开启音量均衡：人声不再断续
- [ ] 设置页「清除伴奏缓存」可用

**界面规范**

- [ ] 浅色、深色各过一遍：首页、推荐歌单、排行榜、最新音乐、最新 MV、搜索、歌单详情、歌手页、设置页，页面标题和左边距对齐，没有白块或看不清的文字
- [ ] 深色模式：鼠标悬停用户卡片、歌手页专辑卡片、搜索结果卡片、排行榜卡片不再变白；本地歌单重命名输入框可见
- [ ] 筛选胶囊在三个页面样式一致，选中态跟随配色方案
- [ ] 底部栏、播放页、沉浸式播放栏的按钮顺序一致；时间都是 `m:ss`
- [ ] 三处进度条右侧默认显示剩余时间（`-2:26`）；点击任意一处右侧时间，三处一起切换为总时长；设置页开关同步变化，重启后保持
- [ ] 沉浸播放页里的浅色提示文字（评论时间、歌词提示）依然清晰
- [ ] `pnpm test` 中 `designTokens.test.ts` 通过

**多语言**

- [ ] 切到英文，浏览 404、空状态、歌单编辑、个人资料、设置页配色与 Spleeter 选项：无中文残留

---

## 5. 未处理 / 遗留项

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 登录 cookie 拼在请求网址里 | ✅ 第 8 批 | Tauri 版仍用查询参数，需在 server-rust 支持 `X-NCM-Cookie` 后去掉 |
| `pnpm dev:api` 监听所有网卡 | ✅ 第 8 批 | — |
| 恢复进度时播放页显示 0:00 | ✅ 第 8 批 | — |
| 3 个底层文件的兜底文案 | ✅ 第 8 批 | — |
| `server-rust` 默认监听 `0.0.0.0` | ⏸ 未审查 | 按要求未看该目录，Tauri 版可能有相同暴露问题 |
| 桌面端遥控接口放行 `Origin: null` | ⏸ 保留 | WebView2 有时这样标记应用自身页面，收紧会让桌面端失效。最坏情况是沙箱 iframe 伪造手机上显示的播放状态，无法开启遥控或读取密钥 |
| 边听边缓存重复下载 | ✅ 第 8 批 | 在 Node API 代理层共享下载。Tauri 版走 server-rust，仍会重复下载 |
| Spleeter 没有取消接口 | ⏸ 保留 | 现在切歌后会保留结果，取消只在关闭智能伴奏时有用，收益低 |
| 视频模式下播放页关闭时进度仍刷新 | ⏸ 保留 | 场景少 |
| 约 65 处中文有意保留 | — | 接口参数值、数据匹配（「纯音乐，请欣赏」、语音占位）、设置搜索关键词、品牌名 |


## 第 11 批：实机截图审查（1920×945，浅色 / 深色）

| 问题 | 原因 / 处理 | 文件 |
|---|---|---|
| 宽屏下网格列数不对：首页推荐只有 4 列（应 5 列）、最新 MV 3 列（应 4 列）；首页横幅的日期水印 `hidden lg:block` 永远不显示；窄窗口下 `max-md:h-10` 之类的尺寸也无效 | `@pikoloo/darwin-ui/styles.css` 是一整份预编译 Tailwind（主题 + preflight + 工具类）。它在 app 的 Tailwind **之后**导入，`hidden`、`grid-cols-2`、`lg:grid-cols-4`、`px-6`、`h-7` 等同名工具类排在 utilities 层后面，盖掉了 app 的 `lg:`/`xl:`/`max-md:` 变体。静态扫描约 130 处受影响。改为先导入 darwin-ui，再导入 tailwindcss；用 `@theme static` 保留 darwin-ui 原本生效的 `--font-sans`、`--radius-lg`；`designTokens.test.ts` 新增导入顺序检查 | `styles.css`、`lib/designTokens.test.ts` |
| 播放页在 1080p 窗口里封面只有 380px，左右大片留白 | 封面尺寸抽成 `--np-art-size`，上限 380→480px（仍受 50vh 限制）；标题区宽度跟随封面 | `styles.css`、`NowPlaying.tsx` |
| 歌单/专辑/歌手简介的「展开全部」居中，和左对齐的正文错位 | 改为左对齐 | `components/common/ExpandableDescription.tsx` |

回归检查：
- [ ] 首页、推荐歌单、搜索、歌手页的卡片网格在宽窗口为 5 列，MV 为 4 列；缩窄窗口逐级减少
- [ ] darwin-ui 组件（下拉框、开关、对话框、Toast）样式与之前一致，圆角不变
- [ ] 把窗口缩到 768px 以下：顶栏、播放栏按钮变大为触控尺寸，部分按钮按设计隐藏
- [ ] 播放页封面在矮窗口（高度 700 左右）里不挤压进度条和按钮


## 第 12 批：页面结构与宽屏细节

| 改动 | 说明 | 文件 |
|---|---|---|
| 排行榜卡片补齐 | 只有前几个官方榜带前三首预览，其余卡片下半截空着。没有预览时底部用「查看完整榜单 ›」补位，和有预览的卡片底边对齐；去掉没有更新频率时多出来的「·」；≥1680px 窗口改为三列 | `routes/toplist.tsx`、`locales/*.po` |
| 新增 `3xl` 断点（1680px） | `min-[1680px]:` 这种任意值断点排在 `lg:` 前面，会被盖掉，所以改在 `@theme static` 里定义 `--breakpoint-3xl` | `styles.css` |
| 歌曲表格宽屏收紧 | 新增容器查询 `song-table`：表格 ≥1240px 时歌手、专辑最多 300px，多出的宽度给标题，专辑不再离时长很远。容器只包表头和行，「定位当前播放」按钮仍是 fixed | `styles.css`、`components/songs/SongTable.tsx` |
| 歌词字号自适应 | `.lyrics-viewport` 设为尺寸容器，字号从 `clamp(24px, 1.7vw, 28px)` 改为 `clamp(24px, 3.4cqi, 40px)`，按歌词栏宽度计算；1080p 窗口约 34px；用户字号倍率、迷你歌词不受影响 | `styles.css` |
| 统一页面结构 | 设置、个人资料、编辑歌单去掉 `mx-auto`，和其他页面一样靠左对齐（保留最大宽度）；最近播放、本地歌单、推荐歌单的头部操作区改用 `.page-header__actions`。核对「播放全部」的位置后，发现它按页面类型是统一的（详情页在头图里、列表页在右上、标签页在标签栏），所以没有挪动，只把规则写进 DESIGN.md | `routes/settings.tsx`、`profile.tsx`、`songlists/$id.edit.tsx`、`recent.tsx`、`local/playlists/$id.tsx`、`songlists/index.tsx`、`DESIGN.md` |

回归检查：
- [ ] 排行榜：1920 宽三列，缩到 1600 以下两列，窄屏一列；所有卡片底边对齐
- [ ] 歌单、专辑、搜索结果的歌曲表格：宽屏下专辑紧挨时长；收起侧栏或窗口变窄时列宽正常；表头吸顶仍正常，长列表的「定位当前播放」按钮仍在右下角
- [ ] 播放页歌词：拖动窗口宽度，字号在 24～40px 间平滑变化；设置里的歌词字号倍率仍生效；当前行自动滚到中间的位置没有偏
- [ ] 设置、个人资料、编辑歌单：标题和其他页面左边对齐
- [ ] 运行 `pnpm i18n:extract`，确认「查看完整榜单」已进入目录（我手动加到了 en / zh-CN 的 .po）
