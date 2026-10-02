// SnapVault backend: fallback resolver. The web app normally talks to the
// cobalt instances directly from the visitor's browser (their home/mobile IPs
// aren't blocked the way datacenter IPs are). This function is the last-resort
// fallback, and also serves the live health check.
// Only instances that accept keyless requests are listed here.

const INSTANCES = [
  "https://rue-cobalt.xenon.zone",
  "https://api.cobalt.liubquanti.click",
  "https://cobaltapi.cjs.nz",
];

const FETCH_TIMEOUT_MS = 45000;

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string" && req.body.length) {
      try { return resolve(JSON.parse(req.body)); } catch { /* fall through */ }
    }
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

async function tryInstance(base, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(base + "/", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: true, data, http: r.status };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "timeout" : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

const VALID_MODES = ["auto", "audio", "mute"];
const VALID_QUALITY = ["max", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"];
const VALID_AUDIO_FMT = ["best", "mp3", "ogg", "wav", "opus"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // Health check: report the first reachable backend instance.
  if (req.method === "GET") {
    for (const base of INSTANCES) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(base + "/", { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) {
          const info = await r.json().catch(() => ({}));
          return json(res, 200, {
            status: "ok",
            instance: base,
            version: (info && info.cobalt && info.cobalt.version) || null,
            services: (info && info.cobalt && info.cobalt.services) || [],
          });
        }
      } catch { /* try next */ }
    }
    return json(res, 503, { status: "error", error: "no backend instance reachable" });
  }

  if (req.method !== "POST") return json(res, 405, { status: "error", error: "method not allowed" });

  const body = await parseBody(req);
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return json(res, 400, { status: "error", error: "invalid url" });
  }

  const downloadMode = VALID_MODES.includes(body.downloadMode) ? body.downloadMode : "auto";
  const videoQuality = VALID_QUALITY.includes(body.videoQuality) ? body.videoQuality : "1080";
  const audioFormat = VALID_AUDIO_FMT.includes(body.audioFormat) ? body.audioFormat : "mp3";

  const payload = {
    url,
    downloadMode,
    videoQuality: downloadMode === "audio" ? "720" : videoQuality,
    audioFormat,
    youtubeVideoCodec: "h264",
    youtubeVideoContainer: "auto",
    filenameStyle: "basic",
    disableMetadata: false,
    tiktokFullAudio: !!body.tiktokFullAudio,
    convertGif: true,
  };

  const attempts = [];
  for (const base of INSTANCES) {
    const attempt = await tryInstance(base, payload);
    attempts.push({ instance: base, ok: attempt.ok, http: attempt.http || null });
    if (!attempt.ok) continue;
    const d = attempt.data || {};
    if (d.status === "tunnel" || d.status === "redirect" || d.status === "picker") {
      return json(res, 200, {
        status: d.status,
        url: d.url || null,
        filename: d.filename || "download",
        picker: d.picker || null,
        audio: d.audio || null,
        instance: base,
      });
    }
    if (d.status === "error") {
      const code = d.error && d.error.code ? d.error.code : "unknown";
      // Content errors (private/deleted post) won't be fixed by another instance — stop here.
      return json(res, 200, { status: "error", code, instance: base, attempts });
    }
  }

  return json(res, 502, { status: "error", code: "all instances failed", attempts });
}
