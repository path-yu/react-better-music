# UI / UX 巡检报告（声屿）

> **范围**：`src/**` 的布局、交互、样式、可访问性、性能
> **方法**：只读检索 + 关键文件通读；所有结论都对应到具体文件与行号
> **度量时间**：2026-10-27（后续代码演进后数字会变，复现命令见附录）
> **用途**：作为分批改造的勾选清单；本文件不包含业务代码改动

---

## 1. 度量快照

| 指标 | 当前值 | 备注 |
| --- | --- | --- |
| `prefers-reduced-motion` 出现次数 | **0** | `animate-` 16 处、`transition` 83 处 |
| `aria-live` / `role="status"` | 2 / 2 | 仅沉浸页的加载状态有 |
| 28px 图标按钮（`h-7 w-7`） | 13 处 | 低于 44px 触控基准 |
| 32px 图标按钮（`h-8 w-8`） | 9 处 | 同上 |
| `overflow-y-auto` 滚动容器 | 9 处 | 沉浸页存在 3 层嵌套 |
| 硬编码主题蓝 `#0066cc` | 95 处 | 深色另有 `#0a84ff` 分支 |
| ≤11px 字号（9/10/10.5/11px） | 119 处 | 移动端可读性风险 |
| `backdrop-blur` 使用 | 17 处 | 沉浸页同时叠 3 层模糊 |
| Esc 键关闭 | 2 个组件 | 沉浸页、搜索框；队列/侧栏缺失 |
| `focus-visible` 自定义样式 | 7 处 | 其余依赖浏览器默认 |

**优先级定义**：`P0` 影响所有人且改动小；`P1` 一致性与可读性；`P2` 打磨项。
**工作量**：`S` < 0.5 天，`M` 0.5–1.5 天，`L` > 1.5 天。

---

## 2. P0（建议第 1 批）

### P0-1 全局缺少「减少动效」支持

- **现象**：全仓 `prefers-reduced-motion` 为 **0**，但存在 16 处 `animate-`（`animate-spin`、`animate-pulse`）与大量 0.3s 级过渡、页面进入动画。
  位置：`src/styles.css:605`（`@keyframes fade-up`）、`:616`（`.fade-up`）、`:950`（`@keyframes nowplaying-enter`）、`:681`（沉浸页入场）；`PlayerBar.tsx:375,400,435`、`TopBar.tsx:70`、`QueuePanel.tsx:120` 等 `animate-spin/pulse`。
- **影响**：前庭敏感用户（系统已开「减弱动态效果」）仍会看到旋转唱片、脉动指示器、整页缩放进入，属于典型的无障碍缺陷。
- **建议**（最小改法，放 `styles.css` 顶部）：
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
  之后可再针对 `.disc-spin` / `animate-spin` 单独保留“静态姿势”。
- **验证**：系统设置开启「减弱动态效果」→ 切歌、暂停、打开播放页，应无旋转/缩放动画。
- **工作量**：S

### P0-2 队列面板、移动端侧边栏没有 Esc 关闭

- **现象**：只有 `NowPlaying.tsx:58-65` 与 `SearchBox.tsx:157` 处理了 `Escape`。`QueuePanel.tsx`（`:32` 起）与移动端侧栏（遮罩在 `AppShell.tsx:165-171`）只能点击关闭。
- **影响**：键盘用户打开队列后必须回到鼠标；与 macOS「Esc 关闭浮层」的普遍预期不符。
- **建议**：
  ```tsx
  // QueuePanel.tsx
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleQueue(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [show, toggleQueue])
  ```
  `AppShell.tsx` 里对 `sidebarOpen` 同理调用 `closeSidebar()`。
- **验证**：打开队列/侧栏 → 按 Esc → 关闭且焦点回到触发按钮。
- **工作量**：S

### P0-3 图标按钮热区低于 44px

- **现象**：`h-7 w-7`（28px）13 处、`h-8 w-8`（32px）9 处，集中在 `PlayerBar`、`TopBar`、`NowPlaying`、`QueuePanel`。
- **影响**：触屏/触控板误触率高；Windows 平板模式尤甚。
- **建议**：视觉尺寸不变，用伪元素扩热区，或仅移动端放大：
  ```css
  .icon-button { position: relative; }
  .icon-button::after { content: ''; position: absolute; inset: -8px; }
  ```
  ```tsx
  className="pressable flex h-7 w-7 items-center justify-center ... max-md:h-9 max-md:w-9"
  ```
- **验证**：DevTools 设备模拟 375px 宽，逐个点击播放条按钮，确认不再“点空气”。
- **工作量**：S

### P0-4 沉浸播放页 3 层嵌套滚动

- **现象**：
  - `NowPlaying.tsx:159` 整页 grid `overflow-y-auto`；
  - `NowPlaying.tsx:284` 右侧面板内部再 `overflow-y-auto`；
  - `LyricsPanel.tsx:120-123` 歌词视口第 3 层 `overflow-y-auto`；
  - 三者全部 `scrollbar-width: none`。
- **影响**：滚轮落点决定滚哪一层，触控板“滚动被吃掉”的体感明显；移动端单列布局下尤其混乱（外层滚整页、内层滚歌词）。
- **建议**：桌面断点只保留「列内滚动」，外层不滚：
  ```tsx
  // NowPlaying.tsx:159
  'grid flex-1 grid-cols-1 gap-4 px-6 pb-5 md:overflow-hidden md:grid-cols-[...] max-md:overflow-y-auto'
  ```
  左栏内容少时无需滚动；右栏由歌词/评论自身滚动。移动端（`max-md`）保持外层滚动、禁用歌词视口内部滚动。
- **验证**：1440px 与 375px 两种宽度下，滚轮在左栏/歌词/评论区分别滚动，行为一致。
- **工作量**：M

### P0-5 Toast 对屏幕阅读器完全静默

- **现象**：`src/lib/toast.ts:1-21` 只是发布订阅（`listeners.forEach(...)`），真正渲染交给 `@pikoloo/darwin-ui`（`ToastBridge.tsx:5-18`），项目侧没有任何 `role` / `aria-live`。
- **影响**：41 处 `toast.error` 的反馈（收藏失败、缓存清除、网络错误）读屏用户全部收不到。
- **建议**：在 `ToastBridge` 里加一个只读 live region，不侵入第三方组件：
  ```tsx
  const [live, setLive] = useState('')
  useEffect(() => subscribe((message) => setLive(`${message} ${performance.now()}`)), [])
  return <><div className="sr-only" role="status" aria-live="polite">{live}</div>{/* 原有 toast 渲染 */}</>
  ```
  （`toast.ts` 已导出 `subscribe`，`performance.now()` 用于让相同文案重复播报。）
- **验证**：开启 macOS 旁白 / NVDA，触发一次「已添加到队列」，应能听到播报。
- **工作量**：S

---

## 3. P1（建议第 2 批）

### P1-1 极小字号过多

- **现象**：`text-[9px]`–`text-[11px]` 共 **119** 处。典型：`PlayerBar.tsx` 的「试听」角标（`text-[9px]`）、艺人/时间行（`text-[10.5px]`）。
- **影响**：13" 1080p 缩放或移动端明显吃力；与 macOS 最小 11px 的排版习惯不一致。
- **建议**：设下限 11px，层级改用颜色/字重表达（`text-black/45` vs `/80`），不再靠缩小字号。
- **工作量**：M

### P1-2 主题蓝硬编码 95 处

- **现象**：`#0066cc` 分布：`styles.css` 11、`routes/settings.tsx` 7、`routes/index.tsx` 6、`SongTable.tsx` 5、`QueuePanel.tsx` 5、`PlayerBar.tsx` 5、`songlists/$id.tsx` 5、`artist/$id.tsx` 4…；深色还另有 `#0a84ff` 分支（如 `PlayerBar.tsx:432`）。
- **影响**：换主色/做主题定制要改几十处，极易漏改导致深浅色不一致。
- **建议**：统一到 `var(--apple-blue)` / `var(--apple-blue-dark)`；Tailwind 侧可定义 `--color-accent` 后在 `@theme` 里注册，写 `bg-accent`。
- **工作量**：M

### P1-3 固定宽度容器在小屏溢出

| 位置 | 宽度 | 用途 |
| --- | --- | --- |
| `player/QueuePanel.tsx:53` | 360px | 队列面板（已有 `max-md:w-full`） |
| `routes/songlists/index.tsx:190` | 380px | 新建歌单 Popover |
| `layout/UserMenu.tsx:66` | 290px | 用户菜单 |
| `player/PlayerBar.tsx:497` | 190px | 音量浮层 |
| `routes/mv/$id.tsx:213` | 300px | MV 侧栏 |
| `layout/LoginModal.tsx:324` | 210px | 二维码区 |

- **影响**：分屏/窄窗口下 Popover 会顶出视口。
- **建议**：改为 `w-[min(380px,calc(100vw-24px))]` 这类“带视口上限”的写法；浮层统一加 `max-w-[calc(100vw-24px)]`。
- **工作量**：S

### P1-4 搜索建议不支持键盘上下选择

- **现象**：`SearchBox.tsx` 只有 Enter 提交、Esc 关闭；建议列表需鼠标点选。
- **影响**：与 macOS 搜索习惯不符（↑/↓ 选、Enter 进）。
- **建议**：维护 `activeIndex`，`ArrowDown/ArrowUp` 移动并同步 `aria-activedescendant`，Enter 优先提交选中项。
- **工作量**：M

### P1-5 快捷键不可发现

- **现象**：`Space` 播放/暂停、`Alt+↑/↓` 音量（`PlayerBar.tsx:182-198`）无任何 UI 提示。
- **影响**：用户不知道有快捷键，等于白做。
- **建议**：设置页加「快捷键」区块；播放按钮 `title` 里补 `空格`；或长按 `?` 弹出速查面板。
- **工作量**：S

### P1-6 滑块缺少可读数值

- **现象**：`ProgressSlider.tsx:51-58` 的隐藏 `input[type=range]` 无 `aria-valuetext`；`VolumeSlider.tsx:76-82` 的 `role="slider"` 只有 `aria-valuenow`。
- **影响**：读屏只会念「50」，不会念「1:23 / 3:45」「音量 50%」。
- **建议**：
  ```tsx
  aria-valuetext={`${formatDuration(current)} / ${formatDuration(duration)}`}
  aria-valuetext={`音量 ${Math.round(percent)}%`}
  ```
- **工作量**：S

### P1-7 空态与错误态不分

- **现象**：`routes/search.tsx:83-84` 失败时 `toast.error` 后仍走 `<EmptyState>`（`:205`、`:257`）；`songlists/index.tsx:81-82` 同样。
- **影响**：网络失败与「真的没有结果」长得一样，用户无法判断该重试还是换关键词。
- **建议**：`EmptyState` 增加 `variant="error"` + `onRetry`，失败时展示重试按钮；保留 toast 作为即时反馈。
- **工作量**：M

---

## 4. P2（打磨项）

| 编号 | 问题 | 位置 | 建议 | 工作量 |
| --- | --- | --- | --- | --- |
| P2-1 | 路由切换硬切，无过渡 | 全局（`__root.tsx` / `AppShell`） | 120–180ms 淡入，复用 `.fade-up`，并纳入 reduce-motion 白名单 | S |
| P2-2 | 玻璃层叠加偏多 | 沉浸页：封面 `blur(64px)` + 面板 `backdrop-blur-xl` + 播放条 `blur(32px)`；全仓 17 处 | 在 `prefers-reduced-transparency` 下降级为纯色（Video 皮肤已有类似处理可复用） | M |
| P2-3 | 沉浸页顶部工具条被整段注释 | `NowPlaying.tsx:120-148` | 恢复为图标胶囊（收起/喜欢/播放列表），或提供“随滚动淡出” | S |
| P2-4 | 深色适配依赖类名字符串映射 | `styles.css` 中 `.dark [class~="text-black/45"]` 等 | 逐步改为语义变量（`--ink-1/2/3`），减少“新增类名忘记映射”的隐性问题 | L |
| P2-5 | 圆角尺度分散 | 3/5/6/7/8/9/10/12/14/16/18/20/22/30px 共 14 种 | 收敛为 6/10/14/18/22/28 六档；与 `corner-shape` 配合时半径可整体 ×1.05 补偿视觉变“胖” | M |
| P2-6 | `corner-shape` 存在浏览器差异 | `styles.css` 顶部 `@supports` 段 | 文档化：Chromium 139+ 生效，Safari/Firefox 回退普通圆角；需要跨端一致再评估运行时方案 | — |
| P2-7 | 首屏图片优先级覆盖不全 | `ImageWithFallback` 已有 `priority`，全仓 12 处使用 | 列表首屏/轮播第一张补 `priority`，其余保持 `lazy` | S |
| P2-8 | 桌面标题栏与沉浸页的视觉衔接 | `styles.css` `.desktop-titlebar`（已提到 `z-index: 80`） | 沉浸页打开时把标题栏也切成深色玻璃，避免顶部一条浅色 | S |

---

## 5. 已修复项（背景，避免重复排查）

| 项目 | 结论 |
| --- | --- |
| `dark:` 变体不跟随应用主题 | 已加 `@custom-variant dark (&:where(.dark, .dark *))`，`ImageWithFallback` / `LoginModal` 生效 |
| 沉浸页覆盖桌面标题栏 | `.desktop-titlebar` 提到 `z-index: 80`，窗口按钮与拖动区域恢复可用 |
| 搜索建议面板固定 420px | 改为 `w-full min-w-[280px]` |
| 评论分隔线变成亮白线 | `divide-black/6` 未生成颜色导致 `currentColor`；改为 `.comment-list > * + *` 显式描边 |
| 评论输入框在深色下变实心黑块 | 引入 `.comment-composer`（白 6% 玻璃 + `:focus-within` 提亮），并修掉 Darwin 的 `focus:`/`active:` 背景类 |
| 两个滑块规格不一致 | 统一 4px 轨道 + 13px 白点 + `--slider-*` 变量，深浅色与焦点环齐备 |
| 沉浸页背景/歌词观感 | 按 Apple 线上样式重做：模糊封面 + 黑纱 + 白字歌词（当前行 `#ffffffeb`） |
| 专辑封面不可点 | 封面与专辑名跳转 `/albums/$id`，并加 hover「查看专辑」提示 |
| 全局圆角 | `@supports (corner-shape: squircle)` 覆盖 `*, *::before, *::after`，圆形元素复位为 `round` |
| Windows 安装包无目录选择 | 新增 Inno Setup 安装器（`scripts/installer/`），安装解压后的应用镜像 |

---

## 6. 不建议改动 / 已达标

- **快捷键的输入框排除**：`PlayerBar.tsx:171-178` 已正确排除 `INPUT/TEXTAREA/SELECT/contenteditable`，无需再加判断。
- **图片加载策略**：`ImageWithFallback` 已有 `lazy` + `fetchPriority` + 失败占位 + 淡入，无需重写。
- **滚动位置记忆**：`AppShell.tsx:94-150` 已按路由 `sessionStorage` 记录并重试恢复，属成熟实现。
- **骨架屏**：全仓 57 处，覆盖良好。
- **焦点可见性基线**：全站只有 2 处 `outline-none`，没有把浏览器焦点环全局抹掉，无需“补 outline”。
- **路由错误兜底**：`__root.tsx:15-16` 已有 `errorComponent` / `notFoundComponent`。

---

## 7. 建议实施顺序

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| 第 1 批 | P0-1 ~ P0-5 | 五项均为 S/M 改动，收益直接，可一起回归 |
| 第 2 批 | P1-1 ~ P1-7 | 涉及多文件替换（颜色/字号/宽度），建议单独一轮并全量截图对比 |
| 第 3 批 | P2-1 ~ P2-8 | 打磨项，按视觉验收节奏推进 |
| 单独立项 | P2-4（深色映射变量化） | 面最广，建议改造完再做一次完整深浅色回归 |

---

## 8. 快速验证清单

- [ ] 系统开「减弱动态效果」→ 切歌、暂停、打开播放页无旋转/缩放动画（P0-1）
- [ ] 打开队列面板、移动端侧栏 → 按 Esc 可关闭（P0-2）
- [ ] 375px 宽度下点击播放条所有图标按钮，命中率正常（P0-3）
- [ ] 1440 / 375 两种宽度下，滚轮在左栏、歌词、评论区的滚动行为一致（P0-4）
- [ ] 读屏软件能听到 toast 文案（P0-5）
- [ ] 分屏 800px 宽打开新建歌单、用户菜单、音量浮层，浮层不出界（P1-3）
- [ ] 搜索框 ↑/↓ 能选建议、Enter 进入（P1-4）
- [ ] 键盘聚焦进度条/音量条，读屏播报「1:23 / 3:45」「音量 50%」（P1-6）
- [ ] 断网后搜索，空态出现「重试」而非普通空列表（P1-7）
- [ ] `corner-shape` 在 Chrome 生效、Safari 回退正常且不破图（P2-6）

---

## 9. 附录：度量复现命令

```powershell
cd d:/code/react-music/src
$all = Get-ChildItem -Recurse -Include *.tsx,*.ts,*.css
foreach ($p in @('prefers-reduced-motion','aria-live','h-7 w-7','h-8 w-8',
                 'overflow-y-auto','#0066cc','backdrop-blur','focus-visible')) {
  "$p => $(($all | Select-String -Pattern $p -AllMatches | ForEach-Object { $_.Matches } | Measure-Object).Count)"
}
```

```powershell
# 极小字号
(Get-ChildItem -Recurse -Include *.tsx |
  Select-String -Pattern 'text-\[(9|10|10\.5|11)px\]' -AllMatches |
  ForEach-Object { $_.Matches } | Measure-Object).Count
```
