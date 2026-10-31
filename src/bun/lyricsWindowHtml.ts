/**
 * Self-contained page for the desktop-lyrics window.
 *
 * The window is a second webview, so it is deliberately not part of the React
 * bundle: loading the SPA over `views://` in a secondary window failed on
 * Windows, while a plain page served from the local bridge is reliable and
 * paints instantly. It polls `/lyrics-state` and posts back to
 * `/lyrics-window` for the close button.
 */
export const LYRICS_WINDOW_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>桌面歌词</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    color: #fff;
  }
  .hud {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    margin: 0;
    padding: 0 28px;
    /* Fully transparent: any painted backdrop shows up as a gray blob. */
    background: transparent;
    -webkit-app-region: drag;
    app-region: drag;
    user-select: none;
  }
  .line {
    width: 100%;
    max-width: 900px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Layered shadows keep white text readable on light wallpapers without
       painting anything behind it. */
    text-shadow:
      0 0 3px rgba(0, 0, 0, 0.9),
      0 2px 16px rgba(0, 0, 0, 0.8),
      0 1px 2px rgba(0, 0, 0, 0.9);
  }
  .hint { font-size: 13px; color: rgba(255, 255, 255, 0.72); display: none; }
  .hint.is-visible { display: block; }
  .prev { font-size: 14px; line-height: 22px; color: rgba(255, 255, 255, 0.64); margin-bottom: 2px; }
  .active { font-size: 28px; line-height: 38px; font-weight: 600; color: rgba(255, 255, 255, 0.98); }
  .trans { font-size: 13px; line-height: 20px; color: rgba(255, 255, 255, 0.78); margin-top: 4px; }
  .next { font-size: 14px; line-height: 22px; color: rgba(255, 255, 255, 0.52); margin-top: 6px; }
  .paused {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2px;
    text-align: center;
    font-size: 10px;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.4);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
    display: none;
  }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.7);
    font-size: 15px;
    line-height: 22px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }
  .hud:hover .close { opacity: 1; }
  .close:hover { background: rgba(0, 0, 0, 0.5); color: #fff; }
</style>
</head>
<body>
  <div class="hud" id="hud">
    <button class="close" id="close" type="button" data-title-zh="隐藏桌面歌词" data-title-en="Hide desktop lyrics">×</button>
    <div class="line hint is-visible" id="hint">桌面歌词 · 等待播放</div>
    <div class="line prev" id="prev"></div>
    <div class="line active" id="active"></div>
    <div class="line trans" id="trans"></div>
    <div class="line next" id="next"></div>
    <div class="paused" id="paused">已暂停</div>
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
      var hint = document.getElementById('hint');
      var prev = document.getElementById('prev');
      var active = document.getElementById('active');
      var trans = document.getElementById('trans');
      var next = document.getElementById('next');
      var paused = document.getElementById('paused');
      var state = null;

      function headers() {
        return { 'x-bridge-token': token };
      }

      function indexAt(lines, ms) {
        var left = 0;
        var right = lines.length - 1;
        var found = -1;
        while (left <= right) {
          var mid = (left + right) >> 1;
          if (lines[mid].time <= ms) {
            found = mid;
            left = mid + 1;
          } else {
            right = mid - 1;
          }
        }
        return found;
      }

      function show(el, visible) {
        el.style.display = visible ? 'block' : 'none';
      }

      function render() {
        var lines = (state && state.lines) || [];
        var ready = lines.length > 0;
        hint.classList.toggle('is-visible', !ready);
        show(prev, ready);
        show(active, ready);
        show(next, ready);
        show(paused, Boolean(state) && !state.playing);

        if (!ready) {
          if (!state || !state.title) {
            hint.textContent = '桌面歌词 · 等待播放';
          } else {
            hint.textContent = state.title + (state.artists ? ' · ' + state.artists : '') + ' · 暂无歌词';
          }
          return;
        }

        var mode = state.displayMode || 'both';
        var index = indexAt(lines, (state.time || 0) * 1000);
        if (index < 0) index = 0;
        function primary(line) {
          return mode === 'translation' && line.translate ? line.translate : line.content;
        }
        var current = lines[index];
        active.textContent = primary(current) || '';
        prev.textContent = index > 0 ? primary(lines[index - 1]) : '';
        next.textContent = index + 1 < lines.length ? primary(lines[index + 1]) : '';
        var translation = mode === 'both' && current.translate ? current.translate : '';
        trans.textContent = translation;
        trans.style.visibility = translation ? 'visible' : 'hidden';
      }

      function poll() {
        fetch('/lyrics-state', { headers: headers() })
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (next) {
            state = next;
            render();
          })
          .catch(function () {})
          .then(function () { setTimeout(poll, 500); });
      }

      document.getElementById('close').addEventListener('click', function () {
        fetch('/lyrics-window?action=hide', { method: 'POST', headers: headers() }).catch(function () {});
      });

      poll();
    })();
  </script>
</body>
</html>
`
