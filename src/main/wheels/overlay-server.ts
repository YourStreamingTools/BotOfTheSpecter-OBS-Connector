import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { WheelsSnapshot } from '@shared/ipc';

const DEFAULT_PORT = 47821;
const HOST = '127.0.0.1';

export interface WheelOverlay {
  url: string;
  close(): void;
  broadcast(snap: WheelsSnapshot): void;
}

export interface OverlayListen {
  listen(server: Server, host: string, port: number): Promise<number>;
}

const defaultListen: OverlayListen['listen'] = (server, host, port) => new Promise((resolve, reject) => {
  const onErr = (err: Error) => { server.off('listening', onListen); reject(err); };
  const onListen = () => { server.off('error', onErr); resolve(port); };
  server.once('error', onErr);
  server.once('listening', onListen);
  server.listen(port, host);
});

/** Localhost-only overlay for an OBS Browser Source. SSE pushes wheel state; the page is transparent. */
export async function startWheelOverlay(
  getSnapshot: () => WheelsSnapshot,
  opts: { listen?: OverlayListen['listen']; startPort?: number } = {}
): Promise<WheelOverlay> {
  const listen = opts.listen ?? defaultListen;
  const clients = new Set<ServerResponse>();
  const server = createServer((req, res) => handle(req, res, getSnapshot, clients));

  let port = opts.startPort ?? DEFAULT_PORT;
  if (port === 0) {
    await listen(server, HOST, 0);
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  } else {
    const last = port + 9;
    let bound = false;
    while (port <= last) {
      try {
        await listen(server, HOST, port);
        bound = true;
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE') {
          server.close();
          throw err;
        }
        port += 1;
      }
    }
    if (!bound) {
      server.close();
      throw new Error('Could not bind the wheel overlay on localhost');
    }
  }

  return {
    url: `http://${HOST}:${port}/wheel`,
    close() {
      for (const c of clients) c.end();
      clients.clear();
      server.close();
    },
    broadcast(snap) {
      const payload = `data: ${JSON.stringify(snap)}\n\n`;
      for (const c of clients) c.write(payload);
    }
  };
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  getSnapshot: () => WheelsSnapshot,
  clients: Set<ServerResponse>
): void {
  const url = req.url ?? '/';
  if (req.method === 'GET' && (url === '/wheel' || url === '/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(OVERLAY_HTML);
    return;
  }
  if (req.method === 'GET' && url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(getSnapshot()));
    return;
  }
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(getSnapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => { clients.delete(res); });
    return;
  }
  res.writeHead(404);
  res.end();
}

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>BotOfTheSpecter Wheel</title>
<style>
  html,body { margin:0; width:100%; height:100%; background:transparent; overflow:hidden; font-family: Inter, Segoe UI, sans-serif; }
  body { display:grid; place-items:center; }
  #stage { position:relative; width:min(92vmin, 920px); height:min(92vmin, 920px); }
  #pointer { position:absolute; left:50%; top:-6px; transform:translateX(-50%); z-index:3;
    width:0; height:0; border-left:18px solid transparent; border-right:18px solid transparent;
    border-top:34px solid #fff; filter: drop-shadow(0 2px 6px rgba(0,0,0,.55)); }
  #wheel { width:100%; height:100%; transform-origin:50% 50%; will-change:transform; }
  #hub { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:2;
    width:22%; height:22%; border-radius:50%; background:#1A1A2E; border:4px solid #9B59B6;
    display:grid; place-items:center; color:#fff; text-align:center; padding:8px;
    box-shadow: 0 0 24px rgba(155,89,182,.45); }
  #hub .lbl { font-size: clamp(11px, 2.2vmin, 18px); font-weight:800; line-height:1.2; word-break:break-word; }
  #hub .sub { font-size: clamp(9px, 1.5vmin, 12px); color:#B0B0C0; margin-top:4px; letter-spacing:.08em; text-transform:uppercase; }
</style>
</head>
<body>
<div id="stage">
  <div id="pointer"></div>
  <svg id="wheel" viewBox="0 0 200 200"></svg>
  <div id="hub"><div class="lbl" id="hubLabel">Wheel</div><div class="sub" id="hubSub">ready</div></div>
</div>
<script>
const wheelEl = document.getElementById('wheel');
const hubLabel = document.getElementById('hubLabel');
const hubSub = document.getElementById('hubSub');
let lastSpin = null;

function polar(cx, cy, r, deg) {
  const rad = deg * Math.PI / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}
function layout(slices) {
  const usable = slices.filter(s => (s.label||'').trim() && s.weight > 0);
  const total = usable.reduce((a,s) => a + s.weight, 0);
  let acc = 0;
  return usable.map(s => {
    const span = (s.weight / total) * 360;
    const start = acc; acc += span;
    return { ...s, start, span, mid: start + span/2 };
  });
}
function draw(slices) {
  const L = layout(slices);
  if (!L.length) { wheelEl.innerHTML = ''; return L; }
  const cx=100, cy=100, r=96;
  let html = '<circle cx="100" cy="100" r="98" fill="#0D0D0D"/>';
  L.forEach(s => {
    if (s.span >= 359.9) {
      html += '<circle cx="100" cy="100" r="'+r+'" fill="'+s.color+'"/>';
      return;
    }
    const a = polar(cx,cy,r,s.start);
    const b = polar(cx,cy,r,s.start+s.span);
    const large = s.span > 180 ? 1 : 0;
    html += '<path d="M'+cx+' '+cy+' L'+a[0]+' '+a[1]+' A'+r+' '+r+' 0 '+large+' 1 '+b[0]+' '+b[1]+' Z" fill="'+s.color+'"/>';
    if (s.span >= 10) {
      const p = polar(cx,cy, r*0.62, s.mid);
      const rot = s.mid > 90 && s.mid < 270 ? s.mid + 180 : s.mid;
      const label = (s.label||'').slice(0, 18);
      html += '<text x="'+p[0]+'" y="'+p[1]+'" fill="#fff" font-size="'+(s.span>28?9:7)+'" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate('+rot+' '+p[0]+' '+p[1]+')">'+escape(label)+'</text>';
    }
  });
  html += '<circle cx="100" cy="100" r="98" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>';
  wheelEl.innerHTML = html;
  return L;
}
function escape(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function applySpin(spin, rest) {
  if (!spin) {
    wheelEl.style.transition = 'none';
    wheelEl.style.transform = 'rotate('+(rest||0)+'deg)';
    lastSpin = null;
    return;
  }
  if (lastSpin && lastSpin.startedAt === spin.startedAt) return;
  lastSpin = spin;
  const elapsed = Date.now() - spin.startedAt;
  const remaining = Math.max(0, spin.durationMs - elapsed);
  wheelEl.style.transition = 'none';
  wheelEl.style.transform = 'rotate('+spin.fromDeg+'deg)';
  if (remaining === 0) {
    wheelEl.style.transform = 'rotate('+spin.toDeg+'deg)';
    return;
  }
  requestAnimationFrame(() => {
    wheelEl.style.transition = 'transform '+remaining+'ms cubic-bezier(0.12, 0.7, 0.08, 1)';
    wheelEl.style.transform = 'rotate('+spin.toDeg+'deg)';
  });
}
function render(state) {
  const active = (state.wheels||[]).find(w => w.id === state.activeWheelId) || state.wheels[0];
  if (!active) {
    wheelEl.innerHTML = '';
    hubLabel.textContent = 'No wheel';
    hubSub.textContent = '';
    return;
  }
  draw(active.slices||[]);
  const spinningThis = state.spinning && state.spin && state.spin.wheelId === active.id;
  applySpin(spinningThis ? state.spin : null, active.restRotationDeg);
  if (spinningThis) {
    hubLabel.textContent = '…';
    hubSub.textContent = 'spinning';
  } else if (state.lastWinner && state.lastWinner.wheelId === active.id) {
    hubLabel.textContent = state.lastWinner.label;
    hubSub.textContent = 'winner';
  } else {
    hubLabel.textContent = active.name;
    hubSub.textContent = (active.slices||[]).length + ' options';
  }
}
fetch('/state').then(r => r.json()).then(render).catch(() => {});
try {
  const es = new EventSource('/events');
  es.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch (err) {} };
} catch (e) {}
</script>
</body>
</html>
`;
