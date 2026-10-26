# 声屿

一个 macOS 风格的网易云音乐第三方客户端，使用 React 19 + TypeScript 重写，支持 Web 与 Windows 桌面端（Electrobun）。

> 仅用于学习与个人使用，音乐版权归网易云音乐及版权方所有，请勿用于商业用途。

## 应用截图

| 发现音乐 | 全屏播放 |
| --- | --- |
| ![发现音乐](assets/screenshots/01-home.png) | ![全屏播放](assets/screenshots/06-now-playing.png) |

| 最新音乐 | 最新 MV |
| --- | --- |
| ![最新音乐](assets/screenshots/03-latest-music.png) | ![最新 MV](assets/screenshots/08-latest-mv.png) |

| 推荐歌单 | 搜索结果 |
| --- | --- |
| ![推荐歌单](assets/screenshots/02-songlists.png) | ![搜索结果](assets/screenshots/04-search.png) |

| 歌手详情 | 设置与缓存管理 |
| --- | --- |
| ![歌手详情](assets/screenshots/05-artist.png) | ![设置](assets/screenshots/07-settings.png) |

## 功能

- **发现**：首页轮播、推荐歌单、最新音乐、最新 MV
- **搜索**：单曲 / 歌单 / 歌手三个标签页，支持分页
- **歌单与歌手**：歌单详情、歌手详情、热门作品、专辑、MV、相似歌手
- **播放器**：音质切换（标准 / 较高 / 极高 / 无损 / Hi-Res）、自动预取下一首播放地址、播放队列、顺序 / 随机 / 单曲循环、音量、心动模式（智能播放）
- **快捷键**：`Space` 播放 / 暂停，`Alt` + `↑` / `↓` 调节音量（按住 `Shift` 微调）
- **歌词**：逐字歌词（YRC）渐变高亮，无逐字数据时使用普通 LRC
- **全屏播放页**：CD 唱片、专辑色渐变背景、沉浸式歌词
- **登录**：手机验证码 / 扫码登录，登录 Cookie 本地持久化，过期自动调用 `/login/refresh`；未登录时使用游客 Cookie
- **本地缓存**：ffmpeg.wasm 将播放过的歌曲转码为 Opus 存入 IndexedDB，可在设置中选择 64 / 96 / 128kbps，查看缓存列表、单曲或批量下载、一键清除
- **外观**：浅色 / 深色模式切换，隐藏式滚动条，Apple 风格动效
- **桌面端**：Electrobun 原生窗口，内置本地 API 服务，无需额外启动后端

## 技术栈

- React 19、TypeScript、Vite 8
- TanStack Router（文件路由）、Zustand（状态管理）、TanStack Virtual（虚拟列表）
- Tailwind CSS v4、[@pikoloo/darwin-ui](https://www.npmjs.com/package/@pikoloo/darwin-ui)
- NetEaseCloudMusicApiEnhanced（`server/` 本地 API）
- ffmpeg.wasm + IndexedDB（音频缓存）
- Electrobun + Hutch + Bun（Windows 桌面端）

## 本地运行（Web）

需要 Node.js 22+ 与 pnpm，并且能访问网易云音乐接口。

```bash
pnpm install

# 终端 1：本地 API，默认 http://localhost:3000
pnpm dev:api

# 终端 2：前端，默认 http://localhost:5173
pnpm dev
```

可通过环境变量 `API_TARGET` 修改 Vite 代理目标，通过 `PORT` 修改 API 端口。

## 桌面端

桌面端由 Electrobun 驱动，构建时会把 `server/` 打包成单文件并嵌入 Bun 主进程，因此运行安装版时不需要单独启动 `dev:api`。

```bash
# 开发模式（需要 Hutch CLI 在 PATH 中）
pnpm desktop:dev

# 构建 Windows 安装包
pnpm desktop:build
```

构建产物位于 `build/stable-win-x64/`：

- `声屿-Setup.exe`
- `声屿-Setup.tar.zst`（需与安装器放在同一目录）

Web 构建使用 `dist/`，桌面端构建使用 `dist-electrobun/`，互不覆盖。

## 项目结构

```text
src/
  bun/           Electrobun 主进程（内嵌 API、窗口图标）
  components/    布局、播放器、歌曲列表、通用组件
  routes/        文件路由页面（首页、歌单、搜索、歌手、MV、设置等）
  store/         Zustand 状态（播放器、用户、UI、设置）
  lib/           HTTP、会话 Cookie、音频缓存、歌词、格式化
server/          本地 NetEaseCloudMusicApiEnhanced 服务
scripts/         桌面端 API 打包脚本
assets/          图标与 README 截图
```

## 音频缓存说明

- 缓存位于 IndexedDB 数据库 `react-music-audio`，播放时优先读取缓存。
- 播放音质在底部播放器右侧切换，缓存品质在「设置」中调整，两者相互独立。
- 默认 96kbps Opus，可在「设置 → 缓存品质」中调整；修改后仅影响之后缓存的新歌曲。
- 缓存列表支持多选下载：网页端多选会打包为一个 ZIP（内含 `.opus`），桌面端直接保存为 `.opus` 文件；清除缓存会删除 IndexedDB 中的全部音频与元数据。
- 缓存上限为 60 首 / 80MB，超出后按缓存时间淘汰。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm dev:api` | 启动本地网易云 API |
| `pnpm build` | 构建 Web 静态资源 |
| `pnpm preview` | 预览 Web 构建产物 |
| `pnpm desktop:dev` | 启动 Electrobun 开发版 |
| `pnpm desktop:build` | 构建 Electrobun 安装包 |
| `pnpm generate-routes` | 重新生成 TanStack 路由树 |

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE` | 前端 API 地址，Web 默认为 `/api`，桌面端为 `http://127.0.0.1:13000` |
| `VITE_DESKTOP` | 是否启用桌面端模式（Hash 路由、原生窗口） |
| `API_TARGET` | Vite 代理的 API 地址，默认 `http://127.0.0.1:3000` |
| `PORT` | 本地 API 监听端口，默认 `3000` |
