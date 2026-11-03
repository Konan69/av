import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Plugin, Connect} from 'vite';

/** Bridge to a local dj-organizer library (http://localhost:8765, override with DJ_ORGANIZER_URL).
 *
 *   GET  /api/dj/tracks               the library, newest first (proxied, trimmed)
 *   GET  /api/dj/audio/:id            the track's audio, streamed through (Range passes through)
 *   POST /api/dj/now-playing          dj-organizer's player reports {id,title,artist,time,playing,sentAt}
 *   GET  /api/dj/now-playing/events   the visualizer follows it (server-sent events)
 *
 * The visualizer only reads from dj-organizer; nothing here writes to the library. */
const DJ = process.env.DJ_ORGANIZER_URL || 'http://127.0.0.1:8765';
const DJ_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):8765$/;

interface NowPlaying {id:number;title:string;artist:string|null;time:number;duration:number;playing:boolean;sentAt:number}
interface DjTrack {id:number;title?:string|null;artist?:string|null;filename?:string;duration?:number|null;added_at?:number|null;folder?:string|null}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.end(JSON.stringify(data));
}
async function readBody(req: IncomingMessage, max = 16 * 1024) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > max) throw new Error('Too large'); }
  return text;
}
function nowPlaying(value: unknown): NowPlaying | null {
  const v = value as Partial<NowPlaying>;
  if (!v || !Number.isInteger(v.id) || !Number.isFinite(v.time) || !Number.isFinite(v.sentAt)) return null;
  return {id:v.id!, title:String(v.title ?? ''), artist:v.artist == null ? null : String(v.artist), time:Math.max(0, v.time!),
    duration:Number.isFinite(v.duration) ? v.duration! : 0, playing:Boolean(v.playing), sentAt:v.sentAt!};
}

export function djBridge(): Plugin {
  const followers = new Set<ServerResponse>();
  let latest: NowPlaying | null = null;
  const broadcast = () => { const line = `data: ${JSON.stringify(latest)}\n\n`; for (const client of followers) client.write(line); };

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/dj/')) { next(); return; }
    const route = url.pathname.slice('/api/dj/'.length), method = req.method || 'GET';
    try {
      if (route === 'now-playing') {
        // The only cross-origin route: dj-organizer's page reports its player here.
        const origin = req.headers.origin;
        if (origin && DJ_ORIGIN.test(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Vary', 'Origin');
        } else if (origin && new URL(origin).host !== req.headers.host) { json(res, {error:'Origin not allowed'}, 403); return; }
        if (method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        if (method === 'GET') { json(res, latest); return; }
        if (method !== 'POST') { json(res, {error:'Method not allowed'}, 405); return; }
        const state = nowPlaying(JSON.parse(await readBody(req)));
        if (!state) { json(res, {error:'Expected {id,time,playing,sentAt}'}, 400); return; }
        latest = state; broadcast(); json(res, {ok:true, followers:followers.size}); return;
      }
      // Everything else is same-origin only.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { json(res, {error:'Origin mismatch'}, 403); return; }
      if (route === 'now-playing/events' && method === 'GET') {
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
        res.write(': dj-organizer now playing\n\n');
        if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
        followers.add(res); req.on('close', () => followers.delete(res));
        return;
      }
      if (route === 'tracks' && method === 'GET') {
        const response = await fetch(`${DJ}/api/state`);
        if (!response.ok) { json(res, {error:`DJ library answered ${response.status}`}, 502); return; }
        const state = await response.json() as {tracks?: DjTrack[]};
        const tracks = (state.tracks ?? []).map(t => ({id:t.id, title:t.title || t.filename || `Track ${t.id}`, artist:t.artist ?? null,
          duration:t.duration ?? null, addedAt:t.added_at ?? 0, folder:t.folder ?? null}))
          .sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title));
        json(res, {tracks}); return;
      }
      const audio = route.match(/^audio\/(\d+)$/);
      if (audio && (method === 'GET' || method === 'HEAD')) {
        const headers: Record<string,string> = {};
        if (req.headers.range) headers.range = String(req.headers.range);
        const upstream = await fetch(`${DJ}/api/audio/${audio[1]}`, {method, headers});
        res.statusCode = upstream.status;
        for (const name of ['content-type','content-length','content-range','accept-ranges']) {
          const value = upstream.headers.get(name); if (value) res.setHeader(name, value);
        }
        res.setHeader('Cache-Control', 'no-store');
        if (!upstream.body || method === 'HEAD') { res.end(); return; }
        const reader = upstream.body.getReader();
        req.on('close', () => { void reader.cancel().catch(() => {}); });
        for (;;) { const {done, value} = await reader.read(); if (done) break; if (!res.write(value)) await new Promise(r => res.once('drain', r)); }
        res.end(); return;
      }
      json(res, {error:'Unknown DJ route'}, 404);
    } catch (error) {
      const offline = error instanceof TypeError && /fetch failed/i.test(String(error.message));
      json(res, {error: offline ? 'DJ library (dj-organizer on :8765) is not running' : error instanceof Error ? error.message : String(error)}, offline ? 503 : 400);
    }
  };
  const install = (server: {middlewares: Connect.Server; httpServer?: {once:(event:string, fn:()=>void)=>unknown} | null}) => {
    server.middlewares.use(middleware);
    server.httpServer?.once('close', () => { for (const client of followers) client.end(); followers.clear(); });
  };
  return {name:'av-dj-bridge', configureServer:install, configurePreviewServer:install};
}
