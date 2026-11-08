const { icon192, icon512 } = require('./remoteIcons')

const REMOTE_COMMAND_TTL = 20_000
const REMOTE_COMMAND_LIMIT = 24
const REMOTE_ACTIVE_WINDOW = 12_000

let commandSequence = 0
let commands = []
let remoteState = null
let lastRemoteClientAt = 0
let remoteActive = false
let activeResetTimer = null
const phoneClients = new Set()
const desktopClients = new Set()

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

/** Only real LAN clients count; the desktop bridge is loopback traffic. */
function noteRemoteClient(req) {
  if (isLoopbackRequest(req)) return
  lastRemoteClientAt = Date.now()
  setRemoteActive(true)
  scheduleRemoteInactive()
}

function hasActiveRemoteClient() {
  return remoteActive || phoneClients.size > 0
}

function sendSse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    res.flush?.()
  } catch {
    // The client disappeared between the heartbeat and this write.
  }
}

function broadcastSse(clients, event, data) {
  for (const client of clients) sendSse(client, event, data)
}

function setRemoteActive(next) {
  if (remoteActive === next) return
  remoteActive = next
  broadcastSse(desktopClients, 'active', { active: next })
}

function scheduleRemoteInactive() {
  if (activeResetTimer) clearTimeout(activeResetTimer)
  activeResetTimer = setTimeout(() => {
    if (phoneClients.size === 0) setRemoteActive(false)
  }, REMOTE_ACTIVE_WINDOW)
}

function openSse(req, res, clients) {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  clients.add(res)
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n')
      res.flush?.()
    } catch {
      // The close handler removes the client.
    }
  }, 15_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(res)
    if (clients === phoneClients) scheduleRemoteInactive()
  })
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function clampText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function cleanState(input) {
  if (!input || typeof input !== 'object') return null
  const cover = clampText(input.cover, 500)
  return {
    connected: true,
    songId: clampNumber(input.songId, 0, 0, Number.MAX_SAFE_INTEGER),
    title: clampText(input.title, 160),
    artists: clampText(input.artists, 200),
    album: clampText(input.album, 160),
    cover: /^https?:\/\//i.test(cover) ? cover : '',
    duration: clampNumber(input.duration, 0, 0, 24 * 60 * 60 * 1000),
    position: clampNumber(input.position, 0, 0, 24 * 60 * 60 * 1000),
    playing: Boolean(input.playing),
    volume: clampNumber(input.volume, 0, 0, 100),
    queueLength: clampNumber(input.queueLength, 0, 0, 100_000),
    currentIndex: clampNumber(input.currentIndex, 0, 0, 100_000),
    updatedAt: Date.now(),
  }
}

function validAction(action) {
  return ['play-pause', 'next', 'prev', 'seek', 'volume'].includes(action)
}

function freshCommands() {
  const cutoff = Date.now() - REMOTE_COMMAND_TTL
  commands = commands.filter((command) => command.createdAt >= cutoff)
  return commands
}

function installRemoteControl(app) {
  app.get('/remote', (req, res, next) => {
    // Express matches both /remote and /remote/ here; only redirect the
    // slash-less form so the PWA start_url does not loop.
    if (req.path !== '/remote') {
      next()
      return
    }
    res.redirect(308, '/remote/')
  })

  app.get('/remote/', (req, res) => {
    noteRemoteClient(req)
    noStore(res)
    res.type('html').send(REMOTE_PAGE_HTML)
  })

  app.get('/remote/manifest.webmanifest', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type('application/manifest+json').send(REMOTE_MANIFEST)
  })

  app.get('/remote/sw.js', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type('application/javascript').send(REMOTE_SW)
  })

  app.get('/remote/icon-192.png', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.type('image/png').send(Buffer.from(icon192, 'base64'))
  })

  app.get('/remote/icon-512.png', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.type('image/png').send(Buffer.from(icon512, 'base64'))
  })

  // Phone -> state stream. The phone page opens one EventSource and receives
  // snapshots as soon as the desktop publishes them.
  app.get('/remote/api/events', (req, res) => {
    noteRemoteClient(req)
    openSse(req, res, phoneClients)
    sendSse(res, 'state', {
      code: 200,
      data: remoteState,
      now: Date.now(),
    })
  })

  // Desktop -> command stream. It is loopback-only because it exposes
  // phone-originated commands and active-state transitions.
  app.get('/remote/api/desktop-events', (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(403).end()
      return
    }
    openSse(req, res, desktopClients)
    sendSse(res, 'active', { active: hasActiveRemoteClient() })
  })

  app.get('/remote/api/state', (req, res) => {
    noteRemoteClient(req)
    noStore(res)
    res.json({ code: 200, data: remoteState, now: Date.now() })
  })

  app.post('/remote/api/state', (req, res) => {
    noStore(res)
    const next = cleanState(req.body)
    if (!next) {
      res.status(400).json({ code: 400, msg: 'Invalid state' })
      return
    }
    remoteState = next
    broadcastSse(phoneClients, 'state', {
      code: 200,
      data: remoteState,
      now: Date.now(),
    })
    res.json({ code: 200 })
  })

  app.get('/remote/api/commands', (req, res) => {
    noStore(res)
    const after = clampNumber(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER)
    const reset = after > commandSequence
    const data = freshCommands().filter(
      (command) => reset || command.id > after,
    )
    res.json({
      code: 200,
      data,
      reset,
      next: commandSequence,
      active: hasActiveRemoteClient(),
    })
  })

  app.post('/remote/api/command', (req, res) => {
    noteRemoteClient(req)
    noStore(res)
    const action = typeof req.body?.action === 'string' ? req.body.action : ''
    if (!validAction(action)) {
      res.status(400).json({ code: 400, msg: 'Unknown action' })
      return
    }
    const value = Number(req.body?.value)
    if (
      (action === 'seek' || action === 'volume') &&
      !Number.isFinite(value)
    ) {
      res.status(400).json({ code: 400, msg: 'Invalid value' })
      return
    }
    const command = {
      id: ++commandSequence,
      action,
      value: Number.isFinite(value) ? value : undefined,
      createdAt: Date.now(),
    }
    freshCommands().push(command)
    if (commands.length > REMOTE_COMMAND_LIMIT) {
      commands = commands.slice(-REMOTE_COMMAND_LIMIT)
    }
    broadcastSse(desktopClients, 'command', command)
    res.json({ code: 200, data: command })
  })
}

const REMOTE_MANIFEST = {
  id: '/remote/',
  name: 'Qimiao Remote',
  short_name: 'Qimiao',
  description: 'Control the Qimiao desktop music player from your phone.',
  start_url: '/remote/',
  scope: '/remote/',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#09090c',
  theme_color: '#111114',
  icons: [
    {
      src: '/remote/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/remote/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable',
    },
  ],
}

const REMOTE_SW = `
const CACHE = 'qimiao-remote-v5'
const SHELL = [
  '/remote/',
  '/remote/manifest.webmanifest',
  '/remote/icon-192.png',
  '/remote/icon-512.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  // Live state and commands must always reach the desktop.
  if (url.pathname.startsWith('/remote/api/')) return
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE).then((cache) => cache.put('/remote/', response.clone()))
          }
          return response
        })
        .catch(() => caches.match('/remote/'))
    )
    return
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  )
})
`

const REMOTE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#111114" />
  <link rel="manifest" href="/remote/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/remote/icon-192.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Qimiao Remote" />
  <title>Qimiao Remote</title>
  <style>
    :root { color-scheme: dark; --accent: #fb923c; --ink: #f7f7f8; --muted: #98989f; --line: rgba(255,255,255,.1); --glass: rgba(28,28,31,.82); }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body { background: radial-gradient(90% 65% at 50% 0%, #34231d 0%, #151216 52%, #09090c 100%); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; -webkit-tap-highlight-color: transparent; }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(50% 36% at 50% 30%, rgba(251,146,60,.13), transparent 70%); }
    main { position: relative; width: min(100%, 430px); min-height: 100dvh; margin: 0 auto; padding: max(22px, env(safe-area-inset-top)) 22px max(26px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 26px; }
    .brand { min-width: 0; font-size: 11px; font-weight: 700; letter-spacing: .18em; color: rgba(255,255,255,.6); white-space: nowrap; }
    .header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
    .install { border: 0; border-radius: 999px; padding: 6px 9px; background: var(--accent); color: #1b0f08; font-size: 10px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .install:active { transform: scale(.96); }
    [hidden] { display: none !important; }
    .status { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; font-size: 10px; color: var(--muted); background: rgba(255,255,255,.04); white-space: nowrap; }
    .status::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: #777; }
    .status.is-live { color: #8de7bd; border-color: rgba(141,231,189,.2); }
    .status.is-live::before { background: #45d99b; box-shadow: 0 0 8px rgba(69,217,155,.7); }
    .art { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 24px; background: linear-gradient(145deg, #44352e, #1a171b); box-shadow: 0 28px 60px -24px rgba(0,0,0,.85); }
    .art img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .art::after { content: ""; position: absolute; inset: 0; border: 1px solid rgba(255,255,255,.14); border-radius: inherit; pointer-events: none; }
    .meta { margin-top: 22px; text-align: center; }
    .title { margin: 0; font-size: clamp(21px, 6vw, 28px); line-height: 1.18; font-weight: 700; letter-spacing: -.03em; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .artists { margin-top: 8px; color: rgba(255,255,255,.56); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .album { margin-top: 4px; color: rgba(255,255,255,.3); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .progress { margin-top: 24px; }
    .range { width: 100%; height: 18px; margin: 0; appearance: none; -webkit-appearance: none; background: transparent; }
    .range::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: linear-gradient(to right, var(--accent) 0%, var(--accent) var(--fill,0%), rgba(255,255,255,.14) var(--fill,0%), rgba(255,255,255,.14) 100%); }
    .range::-moz-range-track { height: 4px; border-radius: 999px; background: rgba(255,255,255,.14); }
    .range::-moz-range-progress { height: 4px; border-radius: 999px; background: var(--accent); }
    .range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border: 0; border-radius: 999px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.45); }
    .range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 999px; background: #fff; }
    .times { display: flex; justify-content: space-between; margin-top: -2px; color: rgba(255,255,255,.36); font-size: 10px; font-variant-numeric: tabular-nums; }
    .controls { display: flex; align-items: center; justify-content: center; gap: 30px; margin-top: 24px; }
    .control { display: grid; place-items: center; width: 54px; height: 54px; border: 0; border-radius: 999px; color: rgba(255,255,255,.75); background: rgba(255,255,255,.07); font-size: 21px; cursor: pointer; transition: transform .14s ease, background .14s ease; }
    .control:active { transform: scale(.94); background: rgba(255,255,255,.14); }
    .control.play { width: 72px; height: 72px; background: #f5f5f7; color: #17171a; font-size: 24px; box-shadow: 0 12px 28px -10px rgba(0,0,0,.65); }
    .volume-row { display: flex; align-items: center; gap: 8px; margin-top: 28px; color: rgba(255,255,255,.38); font-size: 11px; }
    .volume-row .range { flex: 1; min-width: 0; }
    .volume-step { display: grid; place-items: center; width: 25px; height: 25px; flex: none; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.06); color: rgba(255,255,255,.7); font-size: 16px; line-height: 1; cursor: pointer; }
    .volume-step:active { background: rgba(255,255,255,.14); transform: scale(.94); }
    .footer { display: flex; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 26px; color: rgba(255,255,255,.28); font-size: 10px; }
    @media (max-height: 700px) { main { padding-top: 16px; } .art { width: 70%; margin: 0 auto; } .controls { margin-top: 18px; } .progress { margin-top: 16px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="brand">QIMIAO REMOTE</span>
      <div class="header-actions">
        <button class="install" id="install" type="button" hidden>添加到桌面</button>
        <span class="status" id="status">连接中</span>
      </div>
    </header>
    <div class="art"><img id="cover" alt="" hidden /></div>
    <div class="meta">
      <h1 class="title" id="title">等待桌面播放器</h1>
      <div class="artists" id="artists">在电脑上播放一首歌</div>
      <div class="album" id="album"></div>
    </div>
    <section class="progress" aria-label="播放进度">
      <input class="range" id="seek" type="range" min="0" max="1" value="0" step="1" aria-label="播放进度" />
      <div class="times"><span id="elapsed">0:00</span><span id="duration">0:00</span></div>
    </section>
    <section class="controls" aria-label="播放控制">
      <button class="control" id="prev" type="button" aria-label="上一首">‹</button>
      <button class="control play" id="play" type="button" aria-label="播放">▶</button>
      <button class="control" id="next" type="button" aria-label="下一首">›</button>
    </section>
    <section class="volume-row" aria-label="音量">
      <span>音量</span>
      <button class="volume-step" id="volume-down" type="button" aria-label="音量减">−</button>
      <input class="range" id="volume" type="range" min="0" max="100" value="0" step="1" aria-label="音量" />
      <button class="volume-step" id="volume-up" type="button" aria-label="音量加">+</button>
      <span id="volume-value">0%</span>
    </section>
    <footer class="footer"><span id="queue">队列 0 首</span><span>同一局域网</span></footer>
  </main>
  <script>
    (function () {
      var state = null;
      var lastCover = '';
      var draggingSeek = false;
      var draggingVolume = false;
      var seekHoldUntil = 0;
      var volumeHoldUntil = 0;
      var eventSource = null;
      var serverNow = 0;
      var cover = document.getElementById('cover');
      var title = document.getElementById('title');
      var artists = document.getElementById('artists');
      var album = document.getElementById('album');
      var status = document.getElementById('status');
      var seek = document.getElementById('seek');
      var elapsed = document.getElementById('elapsed');
      var duration = document.getElementById('duration');
      var play = document.getElementById('play');
      var volume = document.getElementById('volume');
      var volumeValue = document.getElementById('volume-value');
      var queue = document.getElementById('queue');

      function format(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return '0:00';
        var seconds = Math.floor(ms / 1000);
        var minutes = Math.floor(seconds / 60);
        return minutes + ':' + String(seconds % 60).padStart(2, '0');
      }

      function setRangeFill(input) {
        var min = Number(input.min) || 0;
        var max = Number(input.max) || 1;
        var value = Number(input.value) || 0;
        input.style.setProperty('--fill', ((value - min) / (max - min)) * 100 + '%');
      }

      function render(next, now) {
        state = next;
        if (Number.isFinite(now)) serverNow = now;
        var live = Boolean(
          next &&
            next.connected &&
            serverNow &&
            serverNow - next.updatedAt < 6000
        );
        status.textContent = live ? '已连接' : '等待桌面播放器';
        status.classList.toggle('is-live', live);
        if (!next || !next.songId) {
          title.textContent = '等待桌面播放器';
          artists.textContent = '在电脑上播放一首歌';
          album.textContent = '';
          cover.hidden = true;
          queue.textContent = '队列 0 首';
          play.textContent = '▶';
          return;
        }
        title.textContent = next.title || '未知歌曲';
        artists.textContent = next.artists || '未知歌手';
        album.textContent = next.album || '';
        queue.textContent = '队列 ' + (next.queueLength || 0) + ' 首';
        play.textContent = next.playing ? '❚❚' : '▶';
        play.setAttribute('aria-label', next.playing ? '暂停' : '播放');
        if (next.cover && next.cover !== lastCover) {
          lastCover = next.cover;
          cover.src = next.cover;
          cover.hidden = false;
        } else if (!next.cover) {
          cover.hidden = true;
        }
        if (!draggingSeek && Date.now() >= seekHoldUntil) {
          seek.max = String(Math.max(1, next.duration || 0));
          seek.value = String(Math.min(next.duration || 0, next.position || 0));
          setRangeFill(seek);
        }
        elapsed.textContent = format(Number(seek.value));
        duration.textContent = format(next.duration);
        if (!draggingVolume && Date.now() >= volumeHoldUntil) {
          volume.value = String(next.volume || 0);
          setRangeFill(volume);
          volumeValue.textContent = Math.round(next.volume || 0) + '%';
        }
      }

      function connectEvents() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource('/remote/api/events');
        eventSource.addEventListener('state', function (event) {
          try {
            var payload = JSON.parse(event.data);
            render(payload.data, payload.now);
          } catch (error) {}
        });
        eventSource.onopen = function () {
          status.textContent = '已连接';
          status.classList.add('is-live');
        };
        eventSource.onerror = function () {
          status.textContent = '等待桌面播放器';
          status.classList.remove('is-live');
        };
      }

      async function command(action, value) {
        try {
          var body = { action: action };
          if (value !== undefined) body.value = value;
          var response = await fetch('/remote/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          await response.text();
        } catch (error) {}
      }

      play.addEventListener('click', function () {
        command('play-pause');
      });
      document.getElementById('prev').addEventListener('click', function () {
        command('prev');
      });
      document.getElementById('next').addEventListener('click', function () {
        command('next');
      });
      seek.addEventListener('input', function () {
        draggingSeek = true;
        elapsed.textContent = format(Number(seek.value));
        setRangeFill(seek);
      });
      seek.addEventListener('change', function () {
        var value = Number(seek.value);
        draggingSeek = false;
        seekHoldUntil = Date.now() + 1500;
        command('seek', value);
      });
      volume.addEventListener('input', function () {
        draggingVolume = true;
        volumeValue.textContent = Math.round(Number(volume.value)) + '%';
        setRangeFill(volume);
      });
      volume.addEventListener('change', function () {
        draggingVolume = false;
        volumeHoldUntil = Date.now() + 1500;
        command('volume', Number(volume.value));
      });
      function stepVolume(delta) {
        var next = Math.max(0, Math.min(100, Number(volume.value) + delta));
        draggingVolume = false;
        volumeHoldUntil = Date.now() + 1500;
        volume.value = String(next);
        setRangeFill(volume);
        volumeValue.textContent = Math.round(next) + '%';
        command('volume', next);
      }
      document.getElementById('volume-down').addEventListener('click', function () {
        stepVolume(-5);
      });
      document.getElementById('volume-up').addEventListener('click', function () {
        stepVolume(5);
      });
      cover.addEventListener('error', function () {
        cover.hidden = true;
      });
      document.addEventListener('visibilitychange', function () {
        if (
          document.visibilityState === 'visible' &&
          eventSource &&
          eventSource.readyState === 2
        ) {
          connectEvents();
        }
      });
      setRangeFill(seek);
      setRangeFill(volume);
      connectEvents();
      window.addEventListener('pagehide', function () {
        if (eventSource) eventSource.close();
      });

      var installButton = document.getElementById('install');
      var deferredInstall = null;
      var isIos =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      // Android/iOS can always show the entry point; Chrome's native prompt
      // supplies the one-tap flow when the page is served from HTTPS.
      if (isIos || /Android/i.test(navigator.userAgent)) {
        installButton.hidden = false;
      }
      window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        deferredInstall = event;
        installButton.hidden = false;
      });
      installButton.addEventListener('click', function () {
        if (deferredInstall) {
          deferredInstall.prompt();
          deferredInstall = null;
          installButton.hidden = true;
          return;
        }
        window.alert(
          isIos
            ? '点击 Safari 的分享按钮，然后选择「添加到主屏幕」。'
            : '打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。'
        );
      });
      window.addEventListener('appinstalled', function () {
        installButton.hidden = true;
      });

      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker
            .register('/remote/sw.js', { scope: '/remote/' })
            .catch(function () {
              // LAN HTTP is not a secure context; the page still works online.
            });
        });
      }
    })();
  </script>
</body>
</html>`

module.exports = { installRemoteControl }
