const SCRAPE_API = 'https://tikvdm.vercel.app/api/video';

  const urlInput = document.getElementById('urlInput');
  const fetchBtn = document.getElementById('fetchBtn');
  const clearBtn = document.getElementById('clearBtn');
  const skeletonCard = document.getElementById('skeletonCard');
  const resultCard = document.getElementById('resultCard');
  const errorToast = document.getElementById('errorToast');

  const coverImg = document.getElementById('coverImg');
  const ownerAvatar = document.getElementById('ownerAvatar');
  const ownerName = document.getElementById('ownerName');
  const ownerUnique = document.getElementById('ownerUnique');
  const detailCountry = document.getElementById('detailCountry');
  const durationText = document.getElementById('durationText');
  const detailSize = document.getElementById('detailSize');
  const detailCreated = document.getElementById('detailCreated');
  const detailDescRow = document.getElementById('detailDescRow');
  const detailDesc = document.getElementById('detailDesc');
  const secUid = document.getElementById('secUid');
  const statViews = document.getElementById('statViews');
  const statLikes = document.getElementById('statLikes');
  const statComments = document.getElementById('statComments');
  const statShares = document.getElementById('statShares');
  const statSaves = document.getElementById('statSaves');
  const statReposts = document.getElementById('statReposts');
  const authorFollowers = document.getElementById('authorFollowers');
  const authorFollowing = document.getElementById('authorFollowing');
  const authorVideos = document.getElementById('authorVideos');
  const authorHearts = document.getElementById('authorHearts');
  const authorDiggs = document.getElementById('authorDiggs');
  const qualitySelector = document.getElementById('qualitySelector');
  const qualitySelect = document.getElementById('qualitySelect');
  const downloadBtn = document.getElementById('downloadBtn');
  const detailExtracted = document.getElementById('detailExtracted');
  const downloadAvatarBtn = document.getElementById('downloadAvatarBtn');
  const downloadCoverBtn = document.getElementById('downloadCoverBtn');

  const paneStat = document.getElementById('pane-stat');
  const paneCode = document.getElementById('pane-code');
  const paneMulti = document.getElementById('pane-multi');
  const tabStatBtn = document.getElementById('tabStatBtn');
  const tabCodeBtn = document.getElementById('tabCodeBtn');
  const tabMultiBtn = document.getElementById('tabMultiBtn');
  const codePre = document.getElementById('codePre');
  const copyCodeBtn = document.getElementById('copyCodeBtn');

  const expireAvatarBadge = document.getElementById('expireAvatarBadge');
  const expireCoverBadge = document.getElementById('expireCoverBadge');
  const expireVideoBadge = document.getElementById('expireVideoBadge');

  const multiInput = document.getElementById('multiInput');
  const multiFetchBtn = document.getElementById('multiFetchBtn');
  const multiClearBtn = document.getElementById('multiClearBtn');
  const multiResults = document.getElementById('multiResults');

  let currentQualities = [];
  let currentDownloadUrl = null;
  let toastTimeout;

  let currentAvatarUrl = '';
  let currentCoverUrl = '';
  let currentOwnerUnique = 'unknown';
  let currentVideoId = 'video';

  let lastFullData = null;
  let hasFetchedSingle = false;

  /* -----------------------------------------------------------
   *  Video ID extraction
   * --------------------------------------------------------- */
  function extractVideoId(input) {
    if (input === null || input === undefined) return null;
    const s = String(input).trim();
    if (!s) return null;

    // Raw numeric id
    if (/^\d{6,}$/.test(s)) return s;

    // URL-ish patterns
    const patterns = [
      /\/video\/(\d{6,})/i,
      /\/embed\/v2\/(\d{6,})/i,
      /\/embed\/(\d{6,})/i,
      /[?&]item_id=(\d{6,})/i,
      /[?&]video_id=(\d{6,})/i,
      /[?&]aweme_id=(\d{6,})/i,
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (m) return m[1];
    }

    // Last resort: any long digit run
    const fallback = s.match(/(\d{15,25})/);
    if (fallback) return fallback[1];

    return null;
  }

  function normalizeMediaUrl(u) {
    if (!u) return '';
    if (u.startsWith('//')) return 'https:' + u;
    return u;
  }

  /* -----------------------------------------------------------
   *  Small formatting helpers
   * --------------------------------------------------------- */
  function countryCodeToFlag(code) {
    if (!code || typeof code !== 'string') return '';
    const cc = code.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    const OFFSET = 0x1F1E6 - 'A'.charCodeAt(0);
    return String.fromCodePoint(
      cc.charCodeAt(0) + OFFSET,
      cc.charCodeAt(1) + OFFSET
    );
  }

  function formatK(num) {
    if (!num) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
  }

  function formatFetchedDate(isoString) {
    if (!isoString) return '--';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '--';
    const datePart = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${datePart}, ${timePart}`;
  }

  function formatCreateTime(unixSeconds) {
    if (unixSeconds === null || unixSeconds === undefined || unixSeconds === '') return '--';
    const seconds = Number(unixSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return '--';
    const date = new Date(seconds * 1000);
    if (isNaN(date.getTime())) return '--';
    const datePart = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${datePart}, ${timePart}`;
  }

  function formatDuration(seconds) {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function formatSize(bytes) {
    if (!bytes) return '--';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
  }

  function sanitizeFilename(name) {
    if (!name) return 'unknown';
    return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* -----------------------------------------------------------
   *  Expire-badge helpers
   * --------------------------------------------------------- */
  function getExpireFromUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const expire = u.searchParams.get('expire');
      if (expire) return Number(expire);
      const xExpires = u.searchParams.get('x-expires');
      if (xExpires) return Number(xExpires);
      return null;
    } catch {
      return null;
    }
  }

  function formatExpireRemaining(expireSec) {
    if (!expireSec) return 'no expiry';
    const remaining = expireSec - Date.now() / 1000;
    if (remaining <= 0) return 'expired';
    if (remaining < 60) return `${Math.floor(remaining)}s`;
    if (remaining < 3600) return `${Math.floor(remaining / 60)}m`;
    if (remaining < 86400) return `${Math.floor(remaining / 3600)}h`;
    return `${(remaining / 86400).toFixed(1)}d`;
  }

  function updateExpireBadge(badgeEl, label, url) {
    if (!badgeEl) return;
    const exp = getExpireFromUrl(url);
    const txt = formatExpireRemaining(exp);
    badgeEl.textContent = `${label}: ${txt}`;
    badgeEl.classList.toggle('expired', txt === 'expired');
  }

  /* -----------------------------------------------------------
   *  Image download helper
   * --------------------------------------------------------- */
  async function downloadImage(url, filename) {
    if (!url) {
      showError('Image URL not available');
      return;
    }
    const safeUrl = normalizeMediaUrl(url);
    try {
      const response = await fetch(safeUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('Failed to fetch image');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      console.warn('Blob download failed, opening in new tab:', err);
      window.open(safeUrl, '_blank');
    }
  }

  /* -----------------------------------------------------------
   *  UI state helpers
   * --------------------------------------------------------- */
  function showSkeleton() {
    skeletonCard.style.display = 'block';
    resultCard.style.display = 'none';
    hideError();
  }

  function showResult() {
    skeletonCard.style.display = 'none';
    resultCard.style.display = 'block';
    hideError();
  }

  function showError(msg) {
    errorToast.textContent = msg;
    errorToast.style.display = 'block';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      errorToast.style.display = 'none';
    }, 4000);
  }

  function hideError() {
    errorToast.style.display = 'none';
  }

  function toggleClearButton() {
    clearBtn.style.display = urlInput.value.trim() ? 'flex' : 'none';
  }

  function showPane(pane) {
    tabStatBtn.classList.remove('active');
    tabStatBtn.classList.add('inactive');
    tabCodeBtn.classList.remove('active');
    tabCodeBtn.classList.add('inactive');
    tabMultiBtn.classList.remove('active');
    tabMultiBtn.classList.add('inactive');

    paneStat.classList.add('hidden');
    paneCode.classList.add('hidden');
    paneMulti.classList.add('hidden');

    if (pane === 'stat') {
      tabStatBtn.classList.add('active');
      tabStatBtn.classList.remove('inactive');
      paneStat.classList.remove('hidden');
      if (hasFetchedSingle) {
        skeletonCard.style.display = 'none';
        resultCard.style.display = 'block';
      } else {
        skeletonCard.style.display = 'block';
        resultCard.style.display = 'none';
      }
    } else if (pane === 'code') {
      tabCodeBtn.classList.add('active');
      tabCodeBtn.classList.remove('inactive');
      paneCode.classList.remove('hidden');
      if (hasFetchedSingle) {
        skeletonCard.style.display = 'none';
        resultCard.style.display = 'block';
      } else {
        skeletonCard.style.display = 'block';
        resultCard.style.display = 'none';
      }
    } else if (pane === 'multi') {
      tabMultiBtn.classList.add('active');
      tabMultiBtn.classList.remove('inactive');
      paneMulti.classList.remove('hidden');
      skeletonCard.style.display = 'none';
      resultCard.style.display = 'block';
    }
  }

  tabStatBtn.addEventListener('click', () => showPane('stat'));
  tabCodeBtn.addEventListener('click', () => showPane('code'));
  tabMultiBtn.addEventListener('click', () => showPane('multi'));

  /* -----------------------------------------------------------
   *  API call (single video, by ID)
   * --------------------------------------------------------- */
  async function fetchScrape(videoId) {
    const response = await fetch(`${SCRAPE_API}?videoId=${encodeURIComponent(videoId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to fetch data (HTTP ${response.status})`);
    return data;
  }

  async function fetchAllData(videoId) {
    showSkeleton();
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Loading...';

    try {
      const data = await fetchScrape(videoId);
      lastFullData = data;
      codePre.textContent = JSON.stringify(data, null, 2);

      const avatarUrl = normalizeMediaUrl(data.author?.avatar || '');
      const coverUrl = normalizeMediaUrl(data.video?.[0]?.cover || '');
      const videoUrl = normalizeMediaUrl(
        data.video?.[0]?.downloadUrl
          || data.video?.[0]?.qualities?.[0]?.urls?.[0]
          || ''
      );

      updateExpireBadge(expireAvatarBadge, 'Avatar', avatarUrl);
      updateExpireBadge(expireCoverBadge, 'Cover', coverUrl);
      updateExpireBadge(expireVideoBadge, 'Video', videoUrl);

      populateAuthorData(data.author);
      populateVideoData(data.video[0]);
      hasFetchedSingle = true;
      showResult();
    } catch (err) {
      showError('Error: ' + err.message);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch';
    }
  }

  /* -----------------------------------------------------------
   *  Populate single result
   * --------------------------------------------------------- */
  function populateAuthorData(author) {
    if (!author) return;
    const avatar = normalizeMediaUrl(author.avatar || '');
    ownerAvatar.src = avatar;
    ownerName.textContent = author.nickname || 'Unknown';
    ownerUnique.textContent = '@' + (author.uniqueId || 'unknown');
    secUid.textContent = author.secUid || '--';

    currentAvatarUrl = avatar;
    currentOwnerUnique = author.uniqueId || 'unknown';
    downloadAvatarBtn.disabled = !currentAvatarUrl;

    const stats = author.stats || {};
    authorFollowers.textContent = formatK(stats.followerCount);
    authorFollowing.textContent = formatK(stats.followingCount);
    authorVideos.textContent = formatK(stats.videoCount);
    authorHearts.textContent = formatK(stats.heartCount);
    authorDiggs.textContent = formatK(stats.diggCount);
  }

  function populateVideoData(video) {
    if (!video) return;
    const cover = normalizeMediaUrl(video.cover || '');
    coverImg.src = cover;
    detailCountry.textContent = countryCodeToFlag(video.locationCreated) || '--';

    durationText.textContent = formatDuration(video.duration);
    detailSize.textContent = formatSize(video.videoSize);

    detailCreated.textContent = formatCreateTime(video.createTime);
    detailExtracted.textContent = formatFetchedDate(video.fetchedAt);

    if (video.description) {
      detailDescRow.style.display = 'flex';
      detailDesc.textContent = video.description;
    } else {
      detailDescRow.style.display = 'none';
    }

    

    const stats = video.stats || {};
    statViews.textContent = formatK(stats.playCount);
    statLikes.textContent = formatK(stats.diggCount);
    statComments.textContent = formatK(stats.commentCount);
    statShares.textContent = formatK(stats.shareCount);
    statSaves.textContent = formatK(stats.collectCount);
    statReposts.textContent = formatK(stats.repostCount);

    // Normalize quality URLs once
    currentQualities = (video.qualities || []).map(q => ({
      ...q,
      urls: (q.urls || []).map(normalizeMediaUrl).filter(Boolean),
    })).filter(q => q.urls.length > 0);

    qualitySelect.innerHTML = '';

    currentCoverUrl = cover;
    currentVideoId = video.id || 'video';
    downloadCoverBtn.disabled = !currentCoverUrl;

    if (currentQualities.length > 1) {
      currentQualities.forEach((q, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = q.label;
        qualitySelect.appendChild(option);
      });
      qualitySelector.style.display = 'flex';
      qualitySelect.onchange = (e) => {
        const idx = parseInt(e.target.value, 10);
        if (currentQualities[idx] && currentQualities[idx].urls.length > 0) {
          currentDownloadUrl = currentQualities[idx].urls[0];
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download Video';
        }
      };
    } else {
      qualitySelector.style.display = 'none';
    }

    if (currentQualities.length > 0) {
      currentDownloadUrl = currentQualities[0].urls[0];
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download Video';
    } else {
      currentDownloadUrl = null;
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Preparing download...';
    }

    downloadBtn.onclick = () => {
      if (!currentDownloadUrl) return;
      const filename = `tikvdm-${video.id || 'video'}.mp4`;
      const a = document.createElement('a');
      a.href = currentDownloadUrl;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard');
    }).catch(() => {
      alert('Failed to copy');
    });
  }

  /* -----------------------------------------------------------
   *  Single-input handlers
   * --------------------------------------------------------- */
  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    toggleClearButton();
    urlInput.focus();
    showSkeleton();
    hasFetchedSingle = false;
    showPane('stat');
  });

  urlInput.addEventListener('input', toggleClearButton);

  fetchBtn.addEventListener('click', () => {
    const raw = urlInput.value.trim();
    if (!raw) {
      showError('Please paste a TikTok URL or video ID');
      return;
    }
    const videoId = extractVideoId(raw);
    if (!videoId) {
      showError('Could not find a video ID. Paste a full TikTok URL (…/video/123…) or the numeric ID. Short links like vt.tiktok.com are not supported.');
      return;
    }
    showPane('stat');
    fetchAllData(videoId);
  });

  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
  });

  downloadAvatarBtn.addEventListener('click', () => {
    const filename = `tikvdm-${sanitizeFilename(currentOwnerUnique)}.png`;
    downloadImage(currentAvatarUrl, filename);
  });

  downloadCoverBtn.addEventListener('click', () => {
    const filename = `tikvdm-${sanitizeFilename(currentOwnerUnique)}-${sanitizeFilename(currentVideoId)}-cover.png`;
    downloadImage(currentCoverUrl, filename);
  });

  copyCodeBtn.addEventListener('click', () => {
    const text = codePre.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const original = copyCodeBtn.textContent;
      copyCodeBtn.textContent = 'Copied!';
      setTimeout(() => { copyCodeBtn.textContent = original; }, 1500);
    }).catch(() => {
      alert('Failed to copy');
    });
  });

  downloadAvatarBtn.disabled = true;
  downloadCoverBtn.disabled = true;

  toggleClearButton();

  /* -----------------------------------------------------------
   *  Multi-pane
   * --------------------------------------------------------- */
  function parseMultiTokens(raw) {
    return raw
      .split(/[\n,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  function renderMultiEmpty(text) {
    multiResults.innerHTML = `<div class="multi-empty">${escapeHtml(text)}</div>`;
  }

  function buildMultiError(url, msg) {
    const el = document.createElement('div');
    el.className = 'multi-item';
    el.innerHTML = `
      <div class="multi-item-body">
        <div class="multi-item-desc" style="word-break:break-all;">${escapeHtml(url)}</div>
        <div class="multi-item-status error">Error: ${escapeHtml(msg)}</div>
      </div>
    `;
    return el;
  }

  function buildMultiLoading(label) {
    const el = document.createElement('div');
    el.className = 'multi-item';
    el.innerHTML = `
      <div class="multi-item-cover"></div>
      <div class="multi-item-body">
        <div class="multi-item-status">Loading ${escapeHtml(label)}...</div>
      </div>
    `;
    return el;
  }

  function buildMultiItem(video, author) {
    const item = document.createElement('div');
    item.className = 'multi-item';

    const cover = normalizeMediaUrl(video.cover || '');
    const desc = video.description || '(no description)';
    const stats = video.stats || {};
    const id = video.id || 'video';
    const unique = author?.uniqueId || 'unknown';

    const downloadUrl = normalizeMediaUrl(
      video.downloadUrl
        || (video.qualities && video.qualities[0] && video.qualities[0].urls && video.qualities[0].urls[0])
        || ''
    );

    item.innerHTML = `
      <img class="multi-item-cover" src="${cover}" alt="cover" loading="lazy" />
      <div class="multi-item-body">
        <div class="multi-item-desc">${escapeHtml(desc)}</div>
        <div class="multi-item-stats">
          <span>👁 ${formatK(stats.playCount)}</span>
          <span>❤️ ${formatK(stats.diggCount)}</span>
          <span>💬 ${formatK(stats.commentCount)}</span>
        </div>
        <div class="multi-item-actions">
          <button type="button" class="multi-download-video">Download</button>
          <button type="button" class="icon-btn multi-download-cover" title="Download cover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
        </div>
      </div>
    `;

    item.querySelector('.multi-download-video').addEventListener('click', () => {
      if (!downloadUrl) return;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `tikvdm-${id}.mp4`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    item.querySelector('.multi-download-cover').addEventListener('click', () => {
      if (!cover) return;
      downloadImage(cover, `tikvdm-${sanitizeFilename(unique)}-${sanitizeFilename(id)}-cover.png`);
    });

    return item;
  }

  async function fetchMulti() {
    const tokens = parseMultiTokens(multiInput.value || '');

    if (tokens.length === 0) {
      showError('Paste at least one TikTok URL or video ID');
      return;
    }

    multiResults.innerHTML = '';
    multiFetchBtn.disabled = true;
    multiFetchBtn.textContent = 'Fetching...';

    const entries = tokens.map(token => {
      const id = extractVideoId(token);
      let node;
      if (!id) {
        node = buildMultiError(token, 'No video ID found (short links are not supported)');
      } else {
        node = buildMultiLoading(id);
      }
      multiResults.appendChild(node);
      return { token, id, node };
    });

    const results = await Promise.allSettled(
      entries.map(e => e.id ? fetchScrape(e.id) : Promise.reject(new Error('No video ID')))
    );

    const aggregate = [];

    results.forEach((r, i) => {
      const entry = entries[i];
      const parent = entry.node.parentNode;

      if (r.status === 'fulfilled') {
        const data = r.value;
        aggregate.push({ videoId: entry.id, response: data });

        const author = data.author || null;
        const videos = data.video || [];
        if (videos.length === 0) {
          parent.replaceChild(buildMultiError(entry.token, 'No video returned'), entry.node);
        } else {
          parent.replaceChild(buildMultiItem(videos[0], author), entry.node);
        }
      } else {
        const msg = r.reason && r.reason.message ? r.reason.message : 'Failed';
        if (entry.id) {
          parent.replaceChild(buildMultiError(entry.token, msg), entry.node);
        }
      }
    });

    lastFullData = aggregate.length === 1 ? aggregate[0].response : aggregate;
    codePre.textContent = JSON.stringify(lastFullData, null, 2);

    const firstOk = aggregate[0]?.response;
    if (firstOk) {
      const firstVideo = firstOk.video && firstOk.video[0];
      const avatarUrl = normalizeMediaUrl(firstOk.author?.avatar || '');
      const coverUrl = normalizeMediaUrl(firstVideo?.cover || '');
      const videoUrl = normalizeMediaUrl(
        firstVideo?.downloadUrl || firstVideo?.qualities?.[0]?.urls?.[0] || ''
      );
      updateExpireBadge(expireAvatarBadge, 'Avatar', avatarUrl);
      updateExpireBadge(expireCoverBadge, 'Cover', coverUrl);
      updateExpireBadge(expireVideoBadge, 'Video', videoUrl);
    }

    multiFetchBtn.disabled = false;
    multiFetchBtn.textContent = 'Fetch All';
  }

  multiFetchBtn.addEventListener('click', fetchMulti);

  multiClearBtn.addEventListener('click', () => {
    multiInput.value = '';
    renderMultiEmpty('No videos yet. Paste URLs above and click Fetch All.');
  });

  showPane('stat');
