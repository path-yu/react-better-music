/**
 * Compact always-on-top player served from the local bridge.
 *
 * It reads the same `/lyrics-state` snapshot as the lyric HUD (title, artists,
 * cover, progress, playing) and sends transport commands back to the main
 * window through `/command`.
 */
export const MINI_PLAYER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>迷你播放器</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    color: #fff;
  }
  .card {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    height: calc(100% - 12px);
    margin: 6px;
    padding: 10px 12px 10px 10px;
    border-radius: 16px;
    background: rgba(18, 18, 21, 0.92);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    -webkit-app-region: drag;
    app-region: drag;
    user-select: none;
  }
  .cover {
    width: 76px;
    height: 76px;
    flex: none;
    border-radius: 11px;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.08);
  }
  .meta {
    min-width: 0;
    flex: 1;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }
  .controls button {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  .controls button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  .controls button.primary {
    width: 30px;
    height: 30px;
    background: #0a84ff;
    color: #fff;
    font-size: 12px;
  }
  .controls button.primary:hover {
    background: #2b95ff;
  }
  /* Tall invisible hit area: the visible track is only 2px. */
  .seek {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    height: 14px;
    padding: 0 12px;
    cursor: pointer;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }
  .track {
    flex: 1;
    height: 2px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .track span {
    display: block;
    width: 0;
    height: 100%;
    border-radius: inherit;
    background: #0a84ff;
    transition: width 0.25s linear;
  }
  .close {
    position: absolute;
    top: 5px;
    right: 6px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }
  .card:hover .close { opacity: 1; }
  .close:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
</style>
</head>
<body>
  <div class="card">
    <img class="cover" id="cover" alt="" />
    <div class="meta">
      <div class="title" id="title">等待播放</div>
      <div class="artist" id="artist">声屿</div>
      <div class="controls">
        <button type="button" data-action="previous" data-title-zh="上一首" data-title-en="Previous track">⏮</button>
        <button type="button" class="primary" id="play" data-action="play-pause" data-title-zh="播放 / 暂停" data-title-en="Play / Pause">▶</button>
        <button type="button" data-action="next" data-title-zh="下一首" data-title-en="Next track">⏭</button>
      </div>
    </div>
    <button class="close" id="close" type="button" data-title-zh="关闭迷你播放器" data-title-en="Close mini player">×</button>
    <div class="seek" id="seek" data-title-zh="点击跳转进度" data-title-en="Seek">
      <div class="track"><span id="progress"></span></div>
    </div>
  </div>
  <script>
    (function () {
      var query = new URLSearchParams(location.search);
      var lang = (query.get('lang') || navigator.language || 'zh').toLowerCase();
      var english = lang.indexOf('zh') !== 0;
      document.querySelectorAll('[data-title-zh]').forEach(function (element) {
        element.title = english ? element.dataset.titleEn : element.dataset.titleZh;
      });
      var token = query.get('token') || '';
      var cover = document.getElementById('cover');
      var title = document.getElementById('title');
      var artist = document.getElementById('artist');
      var play = document.getElementById('play');
      var progress = document.getElementById('progress');
      var seek = document.getElementById('seek');
      var track = seek.querySelector('.track');
      var current = null;

      function headers() {
        return { 'x-bridge-token': token };
      }

      function render(state) {
        if (!state) return;
        current = state;
        title.textContent = state.title || '等待播放';
        artist.textContent = state.artists || '声屿';
        play.textContent = state.playing ? '❚❚' : '▶';
        var src = state.cover || '';
        if (src && cover.getAttribute('src') !== src) cover.src = src;
        cover.style.visibility = src ? 'visible' : 'hidden';
        var duration = state.duration || 0;
        var time = (state.time || 0) * 1000;
        progress.style.width =
          duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) + '%' : '0%';
      }

      seek.addEventListener('click', function (event) {
        if (!current || !current.duration) return;
        var rect = track.getBoundingClientRect();
        var ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        var seconds = (current.duration / 1000) * ratio;
        // Move the thumb immediately; the next poll confirms the real position.
        progress.style.width = ratio * 100 + '%';
        fetch('/command?action=seek&value=' + encodeURIComponent(seconds.toFixed(2)), {
          method: 'POST',
          headers: headers(),
        }).catch(function () {});
      });

      function poll() {
        fetch('/lyrics-state', { headers: headers() })
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(render)
          .catch(function () {})
          .then(function () { setTimeout(poll, 500); });
      }

      Array.prototype.forEach.call(
        document.querySelectorAll('[data-action]'),
        function (button) {
          button.addEventListener('click', function () {
            var action = button.getAttribute('data-action');
            fetch('/command?action=' + encodeURIComponent(action), {
              method: 'POST',
              headers: headers(),
            }).catch(function () {});
          });
        },
      );

      document.getElementById('close').addEventListener('click', function () {
        fetch('/mini-window?action=hide', { method: 'POST', headers: headers() }).catch(function () {});
      });

      poll();
    })();
  </script>
</body>
</html>
`
