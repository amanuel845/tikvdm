const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY     = 20;
const MAX_BATCH_SIZE      = 50;

/* ============================================================
   HTTP fetch (redirects + decompression)
   ============================================================ */
function fetchUrl(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) { reject(new Error('Too many redirects')); return; }

    const parsedUrl = new URL(urlStr);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Cookie': 'tt_webid_v2=7020568976118589446; tt_webid=7020568976118589446;',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, urlStr).toString();
        res.resume();
        resolve(fetchUrl(redirectUrl, redirects + 1));
        return;
      }

      let stream = res;
      const encoding = res.headers['content-encoding'];
      if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      const decoder = new StringDecoder('utf-8');
      let body = '';
      stream.on('data', (chunk) => body += decoder.write(chunk));
      stream.on('end', () => { body += decoder.end(); resolve({ status: res.statusCode, body }); });
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

/* ============================================================
   Parse <script id="__FRONTITY_CONNECT_STATE__"> … </script>
   ============================================================ */
function extractFrontityState(html) {
  const match = html.match(
    /<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.error('Failed to parse __FRONTITY_CONNECT_STATE__:', e.message);
    return null;
  }
}

/* ============================================================
   Scrape one video. Never throws; always returns a result object.

   Success: { videoId, ok: true, status: 200, data: {...} }
   Failure: { videoId, ok: false, status, error, ...extras }
   ============================================================ */
async function scrapeVideo(videoId) {
  const targetUrl = `https://www.tiktok.com/embed/v2/${videoId}`;

  try {
    const { status, body } = await fetchUrl(targetUrl);

    if (status !== 200) {
      return {
        videoId, ok: false, status: 502,
        error: 'TikTok embed returned a non-200 status',
        tiktokStatus: status,
      };
    }

    const state = extractFrontityState(body);
    if (!state) {
      return { videoId, ok: false, status: 502, error: 'Could not read embed state' };
    }

    const entry = state?.source?.data?.[`/embed/v2/${videoId}`];
    if (!entry) {
      return { videoId, ok: false, status: 502, error: 'No entry for video ID in embed state' };
    }

    // ---- Unavailable / private / removed ----
    if (entry.isError) {
      return {
        videoId, ok: false, status: 404,
        error: 'Video is unavailable',
        message: 'This TikTok video is not available. It may have been removed, made private, or region-locked.',
        tiktokErrorCode: entry.errorCode ?? null,
      };
    }

    // ---- Success path ----
    const itemInfos   = entry.videoData?.itemInfos;
    const authorInfos = entry.videoData?.authorInfos;

    if (!itemInfos || !authorInfos) {
      return { videoId, ok: false, status: 502, error: 'Missing video or author block' };
    }

    return {
      videoId,
      ok: true,
      status: 200,
      data: {
        video: {
          id:              itemInfos.id ?? null,
          text:            itemInfos.text ?? '',
          createTime:      itemInfos.createTime ?? null,
          locationCreated: itemInfos.locationCreated ?? null,
          cover:           itemInfos.coversOrigin?.[2] ?? null,
          urls:            itemInfos.video?.urls ?? [],
          videoMeta:       itemInfos.video?.videoMeta ?? null,
          diggCount:       itemInfos.diggCount ?? 0,
          shareCount:      itemInfos.shareCount ?? 0,
          playCount:       itemInfos.playCount ?? 0,
          commentCount:    itemInfos.commentCount ?? 0,
        },
        author: {
          userId:   authorInfos.userId ?? null,
          uniqueId: authorInfos.uniqueId ?? null,
          nickName: authorInfos.nickName ?? null,
          verified: authorInfos.verified ?? false,
          avatar:   authorInfos.coversMedium?.[1] ?? null,
        },
        source: targetUrl,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      videoId, ok: false, status: 500,
      error: 'Fetch failed',
      details: error.message,
    };
  }
}

/* ============================================================
   Concurrency pool — runs `tasks` with a limit, preserving
   input order in the result array.
   ============================================================ */
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = { ok: false, status: 500, error: 'Worker exception', details: e.message };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/* ============================================================
   Handler
   ============================================================ */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  // Collect video IDs from either form:
  //   ?videoId=X                       → single
  //   ?videoId=X&videoId=Y&videoId=Z   → batch (repeated param)
  //   ?videoIds=X,Y,Z                  → batch (comma-separated)
  // If `videoIds` is present, it wins; otherwise all `videoId` values are used.
  const batchParam     = requestUrl.searchParams.get('videoIds');
  const repeatedIds    = requestUrl.searchParams.getAll('videoId');
  const concurrencyRaw = requestUrl.searchParams.get('concurrency');

  let rawIds = [];
  if (batchParam) {
    rawIds = batchParam.split(',').map(s => s.trim()).filter(Boolean);
  } else if (repeatedIds.length > 0) {
    rawIds = repeatedIds.map(s => s.trim()).filter(Boolean);
  }

  if (rawIds.length === 0) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Missing "videoId" or "videoIds" query parameter',
      usage: {
        single:      '/api/embed?videoId=7234567890123456789',
        batchA:      '/api/embed?videoId=111&videoId=222&videoId=333',
        batchB:      '/api/embed?videoIds=111,222,333',
        concurrency: '/api/embed?videoIds=111,222,333&concurrency=10',
      },
    }));
    return;
  }

  if (rawIds.length > MAX_BATCH_SIZE) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: `Too many video IDs (max ${MAX_BATCH_SIZE})`,
      requested: rawIds.length,
    }));
    return;
  }

  for (const id of rawIds) {
    if (!/^\d+$/.test(id)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Invalid "videoId" — must be numeric: ${id}` }));
      return;
    }
  }

  // Concurrency — validated, clamped, defaulted
  let concurrency = parseInt(concurrencyRaw, 10);
  if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = DEFAULT_CONCURRENCY;
  if (concurrency > MAX_CONCURRENCY) concurrency = MAX_CONCURRENCY;

  /* ---------------- Single request ---------------- */
  if (rawIds.length === 1) {
    const result = await scrapeVideo(rawIds[0]);

    if (result.ok) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result.data));
    } else {
      res.statusCode = result.status;
      res.setHeader('Content-Type', 'application/json');
      const body = { error: result.error, videoId: result.videoId };
      if (result.message)                       body.message          = result.message;
      if (result.tiktokErrorCode !== undefined) body.tiktokErrorCode  = result.tiktokErrorCode;
      if (result.tiktokStatus    !== undefined) body.tiktokStatus     = result.tiktokStatus;
      if (result.details)                       body.details          = result.details;
      res.end(JSON.stringify(body));
    }
    return;
  }

  /* ---------------- Batch request ---------------- */
  const tasks   = rawIds.map(id => () => scrapeVideo(id));
  const results = await runWithConcurrency(tasks, concurrency);

  const shaped = results.map(r => {
    if (r.ok) {
      return { videoId: r.videoId, ok: true, status: 200, ...r.data };
    }
    const item = { videoId: r.videoId, ok: false, status: r.status, error: r.error };
    if (r.message)                       item.message         = r.message;
    if (r.tiktokErrorCode !== undefined) item.tiktokErrorCode = r.tiktokErrorCode;
    if (r.tiktokStatus    !== undefined) item.tiktokStatus    = r.tiktokStatus;
    if (r.details)                       item.details         = r.details;
    return item;
  });

  const response = {
    results: shaped,
    summary: {
      total:       shaped.length,
      succeeded:   shaped.filter(r => r.ok).length,
      failed:      shaped.filter(r => !r.ok).length,
      concurrency,
    },
  };

  res.statusCode = 200;   // batch itself succeeded — per-item statuses are inside
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(response));
};
