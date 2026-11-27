  // Downloads (the viewer's Download button, files in chats) go straight to
  // the Downloads folder, and nothing on screen said so: fMess reports each
  // one done (downloads.rs) and this shows it at the bottom of the window,
  // with a button that shows the file in its folder.
  const DOWNLOADED = 'fmess-downloaded';
  const downloadedStyle = document.createElement('style');
  downloadedStyle.textContent = `
    #${DOWNLOADED} {
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(480px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 10px 10px 10px 16px;
      border-radius: 10px;
      background: rgba(28, 30, 33, 0.94);
      color: #fff;
      font: 13px/18px system-ui, -apple-system, 'Segoe UI', sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      transform: translate(-50%, 8px);
      opacity: 0;
      transition: opacity 0.15s, transform 0.15s;
      pointer-events: none;
    }
    /* Above the photo viewer's strip of thumbnails. */
    html[data-fmess-media] #${DOWNLOADED} { bottom: 100px; }
    #${DOWNLOADED}.shown { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
    #${DOWNLOADED} > span { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #${DOWNLOADED} > button {
      flex: none;
      padding: 4px 10px;
      border: 0;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.16);
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    #${DOWNLOADED} > button:hover { background: rgba(255, 255, 255, 0.26); }
  `;
  withRoot((root) => root.append(downloadedStyle));

  let downloadedHide = 0;
  let downloadedStays = false;
  // The box at the bottom saying `message`, with Show in Finder for the
  // download fMess knows as `id`. It hides after a while unless `stays`.
  const showDownloadBox = (message, id, stays = false) => {
    let box = document.getElementById(DOWNLOADED);
    if (!box) {
      box = document.createElement('div');
      box.id = DOWNLOADED;
      box.setAttribute('role', 'status');
      // Kept while the pointer is on it, to reach the button.
      box.addEventListener('mouseenter', () => clearTimeout(downloadedHide));
      box.addEventListener('mouseleave', () => downloadedStays || hideDownloadedSoon(2000));
      document.body.append(box);
    }
    const text = document.createElement('span');
    text.textContent = message;
    text.title = message;
    box.replaceChildren(text);
    if (id != null) {
      const show = document.createElement('button');
      show.type = 'button';
      show.textContent = navigator.platform.startsWith('Mac')
        ? say('Show in Finder', 'Mở trong Finder')
        : say('Show in folder', 'Mở thư mục');
      show.addEventListener('click', () => {
        invoke('show_download', { id }).catch(() => {});
        hideDownloadedSoon(0);
      });
      box.append(show);
    }
    box.getBoundingClientRect(); // so a new box slides in
    box.classList.add('shown');
    downloadedStays = stays;
    if (stays) clearTimeout(downloadedHide);
    else hideDownloadedSoon(6000);
  };
  const hideDownloadedSoon = (ms) => {
    clearTimeout(downloadedHide);
    downloadedHide = setTimeout(() => document.getElementById(DOWNLOADED)?.classList.remove('shown'), ms);
  };
  window.__fmessDownloaded = ({ ok, name, id }) => {
    const file = name || say('the file', 'tệp');
    showDownloadBox(
      ok ? say(`Downloaded ${file}`, `Đã tải về ${file}`) : say(`Couldn't download ${file}`, `Không tải được ${file}`),
      ok ? id : null
    );
  };

  // In a chat that isn't encrypted, Download links to the photo or video on
  // Facebook's CDN, another site, so WebKit and WebView2 don't download it but
  // open a new window, which fMess sent to the browser. The page fetches it
  // instead (the CDN allows that without cookies) and saves it from a blob:,
  // under the CDN's file name.
  const downloadFromCdn = async (href) => {
    const name = decodeURIComponent(new URL(href).pathname.split('/').pop() || '');
    showDownloadBox(say(`Downloading ${name}…`, `Đang tải ${name}…`), null, true);
    try {
      const response = await fetch(href, { credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      window.__fmessDownloaded({ ok: false, name });
    }
  };

  window.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element && event.target.closest('a[download][href]');
      if (!link || event.defaultPrevented) return;
      if (link.protocol === 'https:' && link.hostname.endsWith('.fbcdn.net')) {
        event.preventDefault();
        downloadFromCdn(link.href);
      } else if (link.protocol === 'blob:' && !link.getAttribute('download')) {
        // A photo or video from an encrypted chat comes from a blob: URL with
        // no file name, which WebKit saves as "Unknown", "Unknown (1)"...: it
        // gets the blob's id instead, as in Chrome (WebKit adds the extension).
        link.setAttribute('download', link.href.split('/').pop());
      }
    },
    true
  );
