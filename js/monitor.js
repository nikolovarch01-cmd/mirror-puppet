// Mirror Puppet — monitor: what the machine does each second — the main thread, every recognition thread, the
// video card — shown in the Performance panel (closed by default: one summary line; tap to open the rows with
// bars). Busy % of a thread = milliseconds it worked in the last second / 1000, so 100 − busy is the room left
// for more work on that thread. The GPU share is an estimate: the time of GPU-delegate recognition (which
// includes some CPU pre/post-processing) plus the measured draw time of the 3D view when the browser can time
// it (EXT_disjoint_timer_query_webgl2); no browser exposes a real GPU utilisation figure.
import { $ } from './core.js';
import { renderer } from './skeleton.js';

const KIND_ORDER = { main: 0, thread: 1, gpu: 2, info: 3 };
const mon = {
  cores: navigator.hardwareConcurrency || 0,
  rows: new Map(),                     // name -> { kind, delegate, acc (ms this second), last (ms), pct, text, order }
  at: performance.now(),
  gpu: { name: '', ext: null, query: null, acc: 0, have: false },
  summary: '',
  threads: 0,
  report(name, ms, opts) {              // add `ms` of work done by `name` (a thread, the main thread, or an info row)
    let r = mon.rows.get(name);
    if (!r) { r = { kind: (opts && opts.kind) || 'thread', delegate: '', acc: 0, last: 0, pct: 0, text: '', order: mon.rows.size, seen: 0 }; mon.rows.set(name, r); }
    if (opts && opts.kind) r.kind = opts.kind;
    if (opts && opts.delegate) r.delegate = opts.delegate;
    if (opts && opts.text != null) r.text = opts.text;
    r.acc += ms; r.last = ms; r.seen = performance.now();
  },
  forget(name) { mon.rows.delete(name); },
  gpuBegin() {                          // time the 3D draw on the video card when the browser allows it (one query in flight)
    const g = mon.gpu; if (g.ext === null) initGpu();
    if (!g.ext || g.query) return;
    const gl = renderer.getContext();
    g.query = gl.createQuery(); gl.beginQuery(g.ext.TIME_ELAPSED_EXT, g.query);
  },
  gpuEnd() {
    const g = mon.gpu; if (!g.ext || !g.query) return;
    const gl = renderer.getContext(); gl.endQuery(g.ext.TIME_ELAPSED_EXT); g.pending = g.query; g.query = null;
    mon.gpuPoll();
  },
  gpuPoll() {
    const g = mon.gpu; if (!g.pending) return;
    const gl = renderer.getContext();
    if (gl.getQueryParameter(g.pending, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(g.ext.GPU_DISJOINT_EXT)) { g.acc += gl.getQueryParameter(g.pending, gl.QUERY_RESULT) / 1e6; g.have = true; }
      gl.deleteQuery(g.pending); g.pending = null;
    }
  },
  tick(now) {                           // once a second: percentages, the summary line, the panel
    const dt = Math.max(1, now - mon.at); mon.at = now;
    mon.gpuPoll();
    let gpuInf = 0, gpuThreads = 0, threads = 0;
    for (const [name, r] of mon.rows) {
      r.pct = Math.min(100, Math.round(r.acc * 100 / dt));
      if (r.kind === 'thread') threads++;
      // recognition on the video card: threads queue on the one card and overlap, so the slowest of them counts once;
      // work on the main thread adds to it
      if (r.delegate === 'GPU') { if (r.kind === 'thread') gpuThreads = Math.max(gpuThreads, r.acc); else gpuInf += r.acc; }
      if (r.kind !== 'info' && now - r.seen > 5000) { mon.rows.delete(name); continue; }   // a thread that stopped reporting
      r.acc = 0;
    }
    gpuInf += gpuThreads;
    const render = mon.gpu.have ? mon.gpu.acc : 0; mon.gpu.acc = 0;
    mon.threads = threads;
    const gpuPct = Math.min(100, Math.round((gpuInf + render) * 100 / dt));
    const main = mon.rows.get('main');
    const cores = 'threads ' + (threads + 1) + (mon.cores ? ' of ' + mon.cores : '');   // the main thread + the recognition threads, of the cores the browser reports
    mon.summary = (main ? 'main ' + main.pct + '%' : 'main –') + ' · ' + cores + (mon.gpu.name ? ' · GPU ~' + gpuPct + '%' : '');
    mon.gpuPct = gpuPct; mon.gpuRenderMs = render / (dt / 1000);
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
    const open = $('perf').classList.contains('open');
    $('perfTitle').textContent = 'Performance' + (open ? ' ▾' : ' ▸ ' + mon.summary);
    if (!open) return;
    const rows = [...mon.rows].sort((a, b) => (KIND_ORDER[a[1].kind] - KIND_ORDER[b[1].kind]) || (a[1].order - b[1].order))
      .map(([name, r]) => ({ n: name + (r.delegate ? ' · ' + r.delegate : ''), v: r.pct + '% · ' + Math.round(r.last) + ' ms', pct: r.pct, kind: r.kind }));
    if (mon.gpu.name) {
      rows.push({ n: 'GPU ~ ' + mon.gpu.name, v: '~' + gpuPct + '%', pct: gpuPct, kind: 'gpu' });
      rows.push({ n: mon.gpu.have ? '3D draw on the GPU' : '3D draw on the GPU · not timed here', v: mon.gpu.have ? Math.round(mon.gpuRenderMs) + ' ms/s' : '–', pct: mon.gpu.have ? Math.min(100, Math.round(render * 100 / dt)) : 0, kind: 'gpu' });
    }
    rows.push({ n: 'cores (hardwareConcurrency)', v: mon.cores ? String(mon.cores) : 'unknown', pct: 0, kind: 'info' });
    if (mem) rows.push({ n: 'JS memory', v: mem + ' MB', pct: 0, kind: 'info' });
    const list = $('perfList');
    while (list.children.length < rows.length) { const row = document.createElement('div'); row.className = 'bs'; row.innerHTML = '<span class="n"></span><span class="v"></span><span class="b"><i></i></span>'; list.appendChild(row); }
    while (list.children.length > rows.length) list.removeChild(list.lastChild);
    rows.forEach((x, i) => {
      const el = list.children[i]; el.children[0].textContent = x.n; el.children[1].textContent = x.v;
      const bar = el.children[2]; bar.style.display = x.kind === 'info' ? 'none' : ''; bar.firstChild.style.width = x.pct + '%';
      bar.firstChild.style.background = x.pct > 85 ? '#ff6b6b' : x.pct > 60 ? '#ffb347' : 'var(--acc)';
    });
  },
};
function initGpu() {
  const g = mon.gpu, gl = renderer.getContext();
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    let name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    name = String(name || '').replace(/^ANGLE \((.*)\)$/, '$1').replace(/Direct3D11.*$/, '').replace(/\s+vs_\d.*$/, '')
      .replace(/^(Intel|NVIDIA|AMD|Apple|Qualcomm|ARM|Google|Microsoft)(?: Inc\.| Corporation)?,\s*/i, '').replace(/\s*\(0x[0-9A-Fa-f]+\)/g, '').replace(/,\s*$/, '').trim();
    g.name = name || 'unknown';
    g.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || false;
  } catch (e) { g.name = g.name || 'unknown'; g.ext = false; }
}
$('perfTitle').onclick = () => { $('perf').classList.toggle('open'); mon.tick(performance.now()); };
export { mon };
