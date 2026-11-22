# 声屿 设计规范

> 这份文档描述应用**实际使用**的设计变量和组件。数值以 `src/styles.css` 为准，
> `src/lib/designTokens.test.ts` 会在 `pnpm test` 时检查代码是否遵守其中的字号、圆角、颜色和深色映射规则。
> 旧版的 Apple 官网视觉分析在 git 历史里（2026-11-22 之前的 `DESIGN.md`）。

## 1. 原则

- **内容优先**：封面和歌曲是主角，界面元素用浅色毛玻璃和细分隔线退到后面。
- **一个强调色**：交互色只有 `accent`（随配色方案变化），其余信息层级靠文字灰度表达，不靠颜色。
- **同一种东西只有一种做法**：标题、筛选、时间、播放按钮顺序在所有页面保持一致（见第 4 节）。
- **深色模式靠变量**：新代码使用 ink / 语义色 / 面板变量，不要依赖类名映射表。

## 2. 颜色

### 文字灰度（ink）

只用这 4 级，禁止 `text-black/NN`（测试会拦截）。

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `text-ink-1` | `rgba(0,0,0,.85)` | `rgba(255,255,255,.92)` | 标题、歌名、主要文字 |
| `text-ink-2` | `rgba(0,0,0,.65)` | `rgba(255,255,255,.78)` | 正文、次要按钮、列表文字 |
| `text-ink-3` | `rgba(0,0,0,.5)` | `rgba(255,255,255,.62)` | 副标题、元信息、说明 |
| `text-ink-4` | `rgba(0,0,0,.35)` | `rgba(255,255,255,.46)` | 提示、占位符、分隔点 |

沉浸播放页（`.nowplaying-overlay.dark`）把 `ink-4` 提亮到 `.52`；二维码等始终白底的元素（`.qr-surface`、`.media-chip`）在深色模式下仍用浅色 ink。

### 语义色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `accent` | 随配色方案（默认 `#0066cc`） | 随配色方案（默认 `#2997ff`） | 链接、选中态、主按钮、进度 |
| `love` | `#ff2d55` | `#ff375f` | 喜欢、VIP 标签 |
| `warn` / `warn-ink` | `#ff9500` / `#b36b00` | `#ff9f0a` / `#ffb340` | 试听标签（`bg-warn/12 text-warn-ink`）、警告 |
| `danger` | `#d70015` | `#ff6961` | 删除、错误 |

禁止在类名里直接写这些十六进制值（`text-[#ff2d55]` 等），测试会拦截。

### 面板

| 变量 | 用途 |
| --- | --- |
| `--app-card` / `.apple-card` | 卡片 |
| `--app-glass` | 吸顶栏、浮层 |
| `--app-border` / `--app-border-strong` | 分隔线、描边 |
| `--app-chip` / `--app-chip-hover` | 筛选胶囊底色 |
| `--app-group` / `.settings-group` | 卡片内的分组底色（不再加第二层边框） |

还在用 `bg-black/5`、`border-black/8`、`bg-white/80` 这类类名时，`styles.css` 必须有对应的 `.dark [class~="…"]` 映射；没有就会被测试拦截。

## 3. 字号、圆角、间距

### 字号（px）

| 字号 | 用途 |
| --- | --- |
| 11 | 标签、提示、时间、侧栏分组标题（最小字号） |
| 12 | 元信息、副标题、筛选胶囊 |
| 13 | 列表正文、卡片标题 |
| 15 | 设置卡片标题、小节标题 |
| 19 | 强调数字 |
| 21 | 区块标题（`.section-title`、`.headline-md`） |
| 24 | 媒体标题（MV / 视频详情、播放页歌名） |
| 28 | 页面标题（`.headline-lg`） |
| 32 | 首页「每日推荐」横幅标题 |
| 84、210 | 装饰性大数字（日期） |

`.headline-lg`、`.headline-md`、`.section-title`、`.eyebrow` 没有放在 CSS layer 里，同一元素上的 `text-[Npx]` 不会生效，不要再给它们加字号类。

### 圆角（px）

`6`（标签、小按钮）· `10`（封面、菜单项、输入框）· `14`（卡片、分组、浮层）· `18`（大卡片）· `22`（横幅、媒体容器）· `28`（特大面板）· `rounded-full`（胶囊、圆形按钮）。

不要使用 `rounded`、`rounded-sm/lg/xl/2xl/3xl` 这类命名圆角。

### 页面间距

- 页面根元素统一用 `.page`：上 24、左右 32、下 64；窄屏（< 768px）为 20 / 20 / 48。
- 横贯页面的吸顶栏用 `.page-bleed`，它会自动抵消 `.page` 的左右内边距。
- 区块之间：页面头部到第一块内容 20～24px，区块之间 32px 左右。

## 4. 组件约定

### 页面头部 `PageHeader`

```tsx
<PageHeader
  eyebrow={<Trans>发现音乐</Trans>}   // 可选：所属分组
  title={<Trans>排行榜</Trans>}
  description={<Trans>云音乐官方榜单，实时更新</Trans>}
  actions={<PlayAllButton … />}        // 可选：右侧操作
/>
```

- 页面标题不放图标；图标只出现在侧栏和设置卡片标题里。
- 「发现音乐」下的页面（推荐歌单、排行榜、最新音乐、最新 MV）统一带 eyebrow。
- 结构比较复杂的页面（最近播放、推荐歌单、本地歌单）直接使用 `.page-header` / `.page-subtitle` 类，效果和组件一致。

### 区块标题

统一用 `.section-title`（21px / 600），不要单独写字号和字重。

### 筛选与切换

- **分类、地区、类型等筛选**：`<button className={cn('chip', selected && 'chip--selected')} aria-pressed={selected}>`。
- **视图切换**（搜索结果类型、歌手页标签）：Darwin `Tabs` 分段按钮。

### 时间

所有时长都用 `formatDuration`：`m:ss`，满一小时为 `h:mm:ss`。

进度条左侧是已播放时间；右侧用 `TimeToggle`，默认显示**剩余时间**（`formatRemaining`，`-m:ss`），可在「设置 → 播放 → 进度条显示剩余时间」或直接点击右侧时间切换为总时长。三处进度条（底部播放栏、播放页、沉浸式播放栏）共用 `showRemainingTime` 这一个设置，不要各自实现。

### 播放控制顺序

所有播放控件（底部播放栏、播放页、沉浸式播放栏）的中间区域都按这个顺序：

`（左侧附加按钮）· 上一首 · 播放/暂停 · 下一首 · 播放模式 · 播放列表 ·（更多）`

### 卡片

- 封面圆角 10，标题 13px / `ink-1`，副信息 12px / `ink-4`，紧贴标题，不预留两行高度。
- 悬停：封面轻微放大 + 标题变 `accent`；卡片底色变化只能用已映射深色值的类。

### 侧栏

- 一级分组（浏览、我的音乐）：`.eyebrow`。
- 二级分组（本地歌单、创建的歌单、收藏的歌单）：`.sidebar-subheading`。

## 5. 动效与无障碍

- 尊重 `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`（已在 `styles.css` 全局处理）。
- 图标按钮在窄屏下热区不小于 40px（`max-md:h-10 max-md:w-10`）。
- 筛选胶囊、切换按钮带 `aria-pressed`；滑块带 `aria-valuetext`。

## 6. 修改规范时

1. 改 `styles.css` 里的变量。
2. 同步改 `designTokens.test.ts` 里的允许值。
3. 更新本文件。
