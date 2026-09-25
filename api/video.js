const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');

// TikTok sometimes serves description text as UTF-8 bytes interpreted
// as Latin-1. This reverses that when detected.
function fixMojibake(str) {
  if (!str || typeof str !== 'string') return str;
  if (!/[ÃÂðáŠ]/.test(str)) return str;
  try {
    const repaired = Buffer.from(str, 'latin1').toString('utf8');
    return /[ÃÂðáŠ]/.test(repaired) ? str : repaired;
  } catch {
    return str;
  }
}

function fetchUrl(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      reject(new Error('Too many redirects'));
      return;
    }

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
      stream.on('end', () => {
        body += decoder.end();
        resolve({ status: res.statusCode, body });
      });
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

function extractFromHtml(html) {
  const patterns = [
    {
      name: '__UNIVERSAL_DATA_FOR_REHYDRATION__',
      regex: /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
      parser: (data) => data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct,
    },
    {
      name: 'SIGI_STATE',
      regex: /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/,
      parser: (data) => {
        const vm = data?.ItemModule;
        if (!vm) return null;
        const id = Object.keys(vm)[0];
        return id ? vm[id] : null;
      },
    },
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (!match) continue;

    try {
      const json = JSON.parse(match[1]);
      const item = pattern.parser(json);
      if (!item) continue;

      const a = item.author || {};
      const aStats = item.authorStats || {};
      const author = {
        id: a.id || null,
        uniqueId: a.uniqueId || null,
        nickname: a.nickname || null,
        avatar: a.avatarLarger || a.avatarMedium || a.avatarThumb || null,
        secUid: a.secUid || null,
        stats: {
          followerCount: aStats.followerCount || 0,
          followingCount: aStats.followingCount || 0,
          heartCount: aStats.heartCount || aStats.heart || 0,
          videoCount: aStats.videoCount || 0,
          diggCount: aStats.diggCount || 0,
          friendCount: aStats.friendCount || 0,
        },
      };

      const video = {
        id: item.id || null,
        cover: item.video?.cover || item.video?.originCover || null,
        stats: item.statsV2 ? {
          diggCount: parseInt(item.statsV2.diggCount || '0'),
          shareCount: parseInt(item.statsV2.shareCount || '0'),
          commentCount: parseInt(item.statsV2.commentCount || '0'),
          playCount: parseInt(item.statsV2.playCount || '0'),
          collectCount: parseInt(item.statsV2.collectCount || '0'),
          repostCount: parseInt(item.statsV2.repostCount || '0'),
        } : {
          diggCount: item.stats?.diggCount || 0,
          shareCount: item.stats?.shareCount || 0,
          commentCount: item.stats?.commentCount || 0,
          playCount: item.stats?.playCount || 0,
          collectCount: item.stats?.collectCount || 0,
          repostCount: item.stats?.repostCount || 0,
        },
        locationCreated: item.locationCreated || null,
        duration: item.video?.duration || null,
        videoSize: item.video?.size || item.video?.PlayAddrStruct?.DataSize || (item.video?.bitrateInfo?.[0]?.PlayAddr?.DataSize) || null,
        createTime: item.createTime || null,
        description: fixMojibake(item.desc || item.description || ''),
        qualities: [],
        downloadUrl: null,
      };

      if (item.video?.bitrateInfo && item.video.bitrateInfo.length > 0) {
        for (const info of item.video.bitrateInfo) {
          const label = info.GearName || info.definition || info.QualityType || 'unknown';
          const urls = info.PlayAddr?.UrlList || [];
          if (urls.length > 0) {
            video.qualities.push({
              label,
              bitrate: info.Bitrate || null,
              urls,
            });
          }
        }
      }

      if (video.qualities.length === 0 && item.video?.playAddr) {
        video.qualities.push({
          label: 'default',
          bitrate: item.video.bitrate || null,
          urls: [item.video.playAddr],
        });
      }

      if (video.qualities.length > 0) {
        video.downloadUrl = video.qualities[0].urls[0];
      }

      return { author, video };
    } catch (e) {
      console.error(`Error parsing ${pattern.name}:`, e.message);
    }
  }

  return null;
}

function buildCandidates(videoId) {
  return [
    `https://www.tiktok.com/@i/video/${videoId}`,
    `https://www.tiktok.com/@a/video/${videoId}`,
    `https://www.tiktok.com/embed/v2/${videoId}`,
  ];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const videoId = requestUrl.searchParams.get('videoId');

  if (!videoId) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing "videoId" query parameter' }));
    return;
  }

  if (!/^\d+$/.test(videoId)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid "videoId" — must be numeric' }));
    return;
  }

  const candidates = buildCandidates(videoId);
  const attempts = [];

  try {
    for (const targetUrl of candidates) {
      let result;
      try {
        result = await fetchUrl(targetUrl);
      } catch (err) {
        attempts.push({ url: targetUrl, error: err.message });
        continue;
      }

      if (result.status !== 200) {
        attempts.push({
          url: targetUrl,
          status: result.status,
          snippet: result.body.slice(0, 120),
        });
        continue;
      }

      const data = extractFromHtml(result.body);
      if (!data) {
        attempts.push({ url: targetUrl, status: 200, error: 'parsed but no data' });
        continue;
      }

      const fetchedAt = new Date().toISOString();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        author: data.author,
        video: [{ ...data.video, fetchedAt }],
        source: targetUrl,
      }));
      return;
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'All TikTok endpoints failed',
      videoId,
      attempts,
    }));
  } catch (error) {
    console.error('Error:', error.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to fetch video by id', details: error.message }));
  }
};
