/* =====================================================================
   Dynamic Dashboards · runtime  (dd.js)  — window.DD, no dependencies
   ---------------------------------------------------------------------
   theme · shell · router · select groups · formatters · seeded mock data
   · count-up · table · charts (line, bars, hbars, donut, stack, spark,
   heat, geo) · tooltip · drawer · toast · refresh · live
   Contract & usage rules: _system/GUIDELINES.md
   ===================================================================== */
(function () {
  "use strict";
  const DD = (window.DD = {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const r1 = (v) => Math.round(v * 10) / 10;
  Object.assign(DD, { $, $$, esc });

  // per-viewer conveniences only (theme); never state that must persist
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  /* ------------------------------------------------------------ format */
  const LOCALE = "en-US";
  const NNBSP = " "; // narrow no-break space: "71 %", "1,250 mm"
  const fmt = (DD.fmt = {
    n: (x, d = 0) => Number(x).toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }),
    compact(x, d = 1) {
      const a = Math.abs(x), t = (v) => (+v.toFixed(d)).toLocaleString(LOCALE);
      if (a >= 1e9) return t(x / 1e9) + "B";
      if (a >= 1e6) return t(x / 1e6) + "M";
      if (a >= 1e4) return t(x / 1e3) + "K";
      return fmt.n(x, a < 10 && x % 1 ? d : 0);
    },
    pct: (x, d = 0) => fmt.n(x * 100, d) + NNBSP + "%",
    money: (x, cur = "USD", d = 0) => new Intl.NumberFormat(LOCALE, { style: "currency", currency: cur, maximumFractionDigits: d, minimumFractionDigits: d }).format(x),
    moneyCompact: (x, cur = "USD") => new Intl.NumberFormat(LOCALE, { style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 1 }).format(x),
    signed: (x, f = fmt.n) => (x > 0 ? "+" : x < 0 ? "−" : "±") + f(Math.abs(x)),
    unit: (x, u, d = 0) => fmt.n(x, d) + NNBSP + u,
    date(d) { d = new Date(d); return d.toISOString().slice(0, 10); },
    day(d) { return new Date(d).toLocaleDateString(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" }); },
    month(d) { return new Date(d).toLocaleDateString(LOCALE, { month: "short", timeZone: "UTC" }); },
    time(d) { return new Date(d).toISOString().slice(11, 16); },
    ago(mins) { return mins < 1 ? "just now" : mins < 60 ? `${Math.round(mins)} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`; },
  });

  /* ------------------------------------------------- seeded mock data */
  function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  DD.rng = function (seed = 1) {
    let a = typeof seed === "string" ? hash(seed) : seed >>> 0;
    const next = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const r = {
      next,
      float: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
      int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      bool: (p = 0.5) => next() < p,
      normal(mu = 0, sd = 1) { const u = 1 - next(), v = next(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
      weighted(pairs) { const tot = pairs.reduce((s, p) => s + p[1], 0); let x = next() * tot; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; },
      shuffle(arr) { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; },
      sample: (arr, k) => r.shuffle(arr).slice(0, k),
      // multiplicative random walk: revenue, volumes, prices
      walk(n, { start = 100, drift = 0.01, vol = 0.05, min = 0, season = 0, round = 0 } = {}) {
        const out = []; let v = start;
        for (let i = 0; i < n; i++) {
          const s = season ? 1 + season * Math.sin((i / n) * Math.PI * 2) : 1;
          v = Math.max(min, v * (1 + drift + r.normal(0, vol)));
          out.push(+(v * s).toFixed(round));
        }
        return out;
      },
      id: (prefix, n = 4) => prefix + "-" + String(r.int(0, 10 ** n - 1)).padStart(n, "0"),
    };
    return r;
  };
  // date axis ending at the dashboard's fixed "as of" date (never the real clock)
  DD.dates = function (n, { end = "2026-09-30", step = "day" } = {}) {
    const e = new Date(end + "T00:00:00Z"), out = [];
    for (let i = n - 1; i >= 0; i--) {
      if (step === "month") { out.push(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - i, 1))); continue; } // 1st of month: no Feb-30 overflow
      const d = new Date(e);
      d.setUTCDate(e.getUTCDate() - i * (step === "week" ? 7 : 1));
      out.push(d);
    }
    return out;
  };
  DD.sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
  DD.countBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  DD.groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});

  /* -------------------------------------------------------------- theme */
  DD.theme = {
    get: () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"),
    set(t) { document.documentElement.setAttribute("data-theme", t); store.set(THEME_KEY, t); document.dispatchEvent(new CustomEvent("dd:theme", { detail: t })); },
    toggle() { DD.theme.set(DD.theme.get() === "dark" ? "light" : "dark"); },
    init() { $$("[data-theme-toggle]").forEach((b) => b.addEventListener("click", DD.theme.toggle)); },
  };
  // Light by default regardless of OS. A dashboard may declare <html data-theme="dark"> to open dark.
  // The viewer's choice is remembered per dashboard (per path) and applies before first paint.
  const THEME_KEY = "dd-theme:" + location.pathname;
  (function () { const saved = store.get(THEME_KEY); if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved); })();

  /* -------------------------------------------------------------- shell */
  DD.shell = function () {
    const close = () => document.body.classList.remove("nav-open");
    $$("[data-nav-toggle]").forEach((b) => b.addEventListener("click", () => document.body.classList.toggle("nav-open")));
    $$(".scrim").forEach((s) => s.addEventListener("click", close));
    $$(".side a").forEach((a) => a.addEventListener("click", close));
  };

  /* ------------------------------------------------------------- router
     Screens are <section class="screen" id="s-{id}">. Links use href="#{id}"
     or "#{id}/{param}". Anything with data-route="{id}" gets .on; inside a
     .stepper, earlier steps get .done. */
  DD.router = function ({ routes, fallback = routes[0], onChange } = {}) {
    let current = null;
    function go() {
      const raw = decodeURIComponent((location.hash || "").slice(1));
      let [id, ...rest] = raw.split("/");
      if (!routes.includes(id)) id = fallback;
      const param = rest.join("/") || null;
      routes.forEach((r) => { const s = document.getElementById("s-" + r); if (s) s.hidden = r !== id; });
      $$("[data-route]").forEach((el) => el.classList.toggle("on", el.dataset.route === id));
      $$(".stepper").forEach((st) => {
        const items = $$("[data-route]", st), idx = items.findIndex((x) => x.dataset.route === id);
        items.forEach((x, i) => x.classList.toggle("done", idx > -1 && i < idx));
      });
      const changed = id !== current;
      const prev = current; current = id;
      if (changed) window.scrollTo({ top: 0 });
      onChange && onChange({ id, param, prev, changed });
    }
    window.addEventListener("hashchange", go);
    go();
    return { go: (h) => (location.hash = h), get current() { return current; } };
  };

  /* ------------------------------------------ single-select groups
     <div class="tabs" data-select> <button data-value="7d" class="on">…
     DD.select(el, v => …) — works for .tabs, .chips, .filters, KPI rows */
  DD.select = function (el, onChange, { multi = false } = {}) {
    el = node(el);
    const items = () => $$("[data-value]", el);
    const api = {
      get value() { const on = items().filter((x) => x.classList.contains("on")).map((x) => x.dataset.value); return multi ? on : on[0]; },
      set(v, silent) {
        items().forEach((x) => {
          const hit = multi ? [].concat(v).includes(x.dataset.value) : x.dataset.value === v;
          x.classList.toggle("on", hit); x.setAttribute("aria-pressed", hit);
        });
        if (!silent && onChange) onChange(api.value);
      },
    };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-value]"); if (!b || !el.contains(b)) return;
      if (multi) { b.classList.toggle("on"); b.setAttribute("aria-pressed", b.classList.contains("on")); onChange && onChange(api.value); }
      else api.set(b.dataset.value);
    });
    return api;
  };

  /* ----------------------------------------------------------- count-up
     <b class="kpi-value" data-count="17260" data-fmt="n">17,260</b> */
  DD.countUp = function (root = document) {
    $$("[data-count]", root).forEach((el) => {
      const target = +el.dataset.count, f = fmt[el.dataset.fmt || "n"] || fmt.n, d = +(el.dataset.d || 0);
      const pre = el.dataset.pre || "", suf = el.dataset.suf || "";
      const out = (v) => (el.textContent = pre + (el.dataset.fmt === "money" || el.dataset.fmt === "moneyCompact" ? f(v) : f(v, d)) + suf);
      if (reduced()) return out(target);
      const t0 = performance.now(), dur = 700;
      const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); out(target * e); if (p < 1) requestAnimationFrame(tick); else out(target); };
      requestAnimationFrame(tick);
    });
  };

  /* ------------------------------------------------------------ tooltip
     Values lead, labels follow. Built with textContent (labels are data). */
  let tipEl;
  const tip = (DD.tip = {
    show(x, y, { title, rows = [] }) {
      if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.setAttribute("role", "status"); document.body.appendChild(tipEl); }
      tipEl.replaceChildren();
      if (title != null) { const h = document.createElement("div"); h.className = "th"; h.textContent = title; tipEl.appendChild(h); }
      rows.forEach((r) => {
        const row = document.createElement("div"); row.className = "tr";
        const i = document.createElement("i"); if (r.shape === "sq") i.className = "sq"; i.style.background = r.color || "transparent";
        const s = document.createElement("span"); s.textContent = r.name ?? "";
        const b = document.createElement("b"); b.textContent = r.value ?? "";
        row.append(i, s, b); tipEl.appendChild(row);
      });
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > innerWidth - 8) left = x - w - 14;
      if (top + h > innerHeight - 8) top = y - h - 14;
      tipEl.style.left = Math.max(8, left) + "px"; tipEl.style.top = Math.max(8, top) + "px";
      tipEl.classList.add("on");
    },
    hide() { tipEl && tipEl.classList.remove("on"); },
  });
  const tipAt = (el, data) => { const r = el.getBoundingClientRect(); tip.show(r.left + r.width / 2, r.top, data); };

  /* ------------------------------------------------------ chart helpers */
  const TONES = { ink: "var(--chart-ink)", dim: "var(--chart-dim)", ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", na: "var(--na)" };
  const color = (k, i = 0) => (!k ? `var(--c${(i % 7) + 1})` : TONES[k] || (/^c[1-7]$/.test(k) ? `var(--${k})` : /^seq-[1-7]$/.test(k) ? `var(--${k})` : k));
  DD.color = color;
  // one series → ink · any series marked "dim" → emphasis form, the rest ink · otherwise categorical by index
  function seriesColors(series) {
    const emphasis = series.length === 1 || series.some((s) => s.color === "dim");
    return series.map((s, i) => (s.color ? color(s.color) : emphasis ? TONES.ink : color(null, i)));
  }
  function nice(min, max, count = 4, integer = false) {
    if (min === max) { max = min + 1; }
    const step0 = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
    let step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    if (integer) step = Math.max(1, step); // counts never get half-steps
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo, hi, ticks };
  }
  function monotone(pts) {
    const n = pts.length;
    if (n < 3) return pts.map((p, i) => (i ? "L" : "M") + r1(p[0]) + "," + r1(p[1])).join("");
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${r1(pts[i][0] + h)},${r1(pts[i][1] + t[i] * h)} ${r1(pts[i + 1][0] - h)},${r1(pts[i + 1][1] - t[i + 1] * h)} ${r1(pts[i + 1][0])},${r1(pts[i + 1][1])}`;
    }
    return d;
  }
  // vertical bar: 4px rounded data-end, square at the baseline
  function barPath(x, y0, y1, w, r = 4) {
    const h = Math.abs(y1 - y0); r = Math.min(r, h, w / 2);
    const s = y1 < y0 ? 1 : -1;
    return `M${r1(x)},${r1(y0)}V${r1(y1 + s * r)}Q${r1(x)},${r1(y1)} ${r1(x + r)},${r1(y1)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y1)} ${r1(x + w)},${r1(y1 + s * r)}V${r1(y0)}Z`;
  }
  // re-render on width change; hidden screens draw when first shown
  const node = (el) => (typeof el === "string" ? $(el) : el);
  function mount(el, draw) {
    if (!el) return;
    el.classList.add("chart");
    const run = () => { const w = Math.round(el.clientWidth); if (!w || w === el._ddW) return; el._ddW = w; draw(w); };
    if (el._ddRO) el._ddRO.disconnect();
    el._ddRO = new ResizeObserver(() => requestAnimationFrame(run));
    el._ddRO.observe(el);
    el._ddW = 0; run();
    return el;
  }
  function legendEl(items) {
    const lg = document.createElement("div"); lg.className = "legend"; lg.style.marginTop = "12px";
    items.forEach(({ name, c, line }) => {
      const s = document.createElement("span"), i = document.createElement("i");
      if (line) i.className = "line"; i.style.background = c;
      s.append(i, document.createTextNode(name)); lg.appendChild(s);
    });
    return lg;
  }
  // accessible twin of every chart (screen readers; also printable)
  function dataTable(caption, head, rows) {
    const wrap = document.createElement("div"); wrap.className = "sr-only"; // tables ignore height:1px, so clip a wrapper
    const t = document.createElement("table"); wrap.appendChild(t);
    const c = document.createElement("caption"); c.textContent = caption; t.appendChild(c);
    const tr = document.createElement("tr"); head.forEach((h) => { const th = document.createElement("th"); th.textContent = h; tr.appendChild(th); });
    t.appendChild(tr);
    rows.forEach((r) => { const row = document.createElement("tr"); r.forEach((v) => { const td = document.createElement("td"); td.textContent = v; row.appendChild(td); }); t.appendChild(row); });
    return wrap;
  }
  const yAxisW = (ticks, f) => Math.max(...ticks.map((t) => String(f(t)).length)) * 6.8 + 12;

  const chart = (DD.chart = {});

  /* shared chart furniture
     bands: [{from, to, label}]          shaded x-ranges by index (events, seasons) — behind the marks
     refs:  [{y, label, tone, from, to}] dashed threshold lines (stress lines, means), optionally over an index range */
  function bandsSvg(bands, x0, x1, T, ph) {
    return (bands || []).map((b) => `<rect class="band" x="${r1(x0(b.from))}" y="${T}" width="${r1(Math.max(1, x1(b.to) - x0(b.from)))}" height="${ph}"><title>${esc(b.label || "")}</title></rect>`).join("");
  }
  function refsSvg(refs, Y, xa, xb, R) {
    return (refs || []).map((r) => {
      const y = r1(Y(r.y)), a = r1(xa(r)), b = r1(xb(r)), c = r.tone ? color(r.tone) : "var(--chart-axis)";
      return `<line class="ref" x1="${a}" x2="${b}" y1="${y}" y2="${y}" style="stroke:${c}"${r.strong ? ' stroke-width="1.5"' : ""}/>` +
        (r.label ? `<text class="ref-lbl" x="${b - 4}" y="${y - 5}" text-anchor="end"${r.strong ? ' style="font-weight:600;fill:var(--fg)"' : ""}>${esc(r.label)}</text>` : "");
    }).join("");
  }
  const runs = (vals) => { const out = []; let cur = null; vals.forEach((v, i) => { if (v == null) { cur = null; return; } if (!cur) out.push((cur = [])); cur.push(i); }); return out; };

  /* line / area — crosshair + one tooltip listing every series; null values leave a gap */
  chart.line = function (el, o) {
    el = node(el);
    const { labels, series, height = 220, yFmt = fmt.compact, xFmt = (x) => x, curve = "smooth", zero = true, title = "Chart" } = o;
    const area = o.area ?? series.length === 1;
    const cols = seriesColors(series);
    return mount(el, (W) => {
      const all = series.flatMap((s) => s.values).filter((v) => v != null).concat((o.refs || []).map((r) => r.y));
      const lo0 = o.yMin ?? (zero ? Math.min(0, ...all) : Math.min(...all)), hi0 = o.yMax ?? Math.max(...all);
      const { lo, hi, ticks } = nice(lo0, hi0, 4, all.every(Number.isInteger));
      const L = yAxisW(ticks, yFmt), R = o.endLabels ? 64 : 10, T = 10, B = 26, H = height;
      const pw = W - L - R, ph = H - T - B, n = labels.length, half = n > 1 ? pw / (n - 1) / 2 : pw / 2;
      const X = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), Y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;
      let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(title)}">`;
      s += bandsSvg(o.bands, (i) => Math.max(L, X(i) - half), (i) => Math.min(W - R, X(i) + half), T, ph);
      ticks.forEach((t) => { s += `<line class="${t === 0 ? "base" : "grid"}" x1="${L}" x2="${W - R}" y1="${r1(Y(t))}" y2="${r1(Y(t))}"/><text class="axis" x="${L - 8}" y="${r1(Y(t)) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`; });
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 64))));
      labels.forEach((lb, i) => {
        const last = i === n - 1;
        if (i % every !== 0 && !(last && (n - 1) % every >= every / 2)) return; // last label only if it has room
        s += `<text class="axis" x="${r1(X(i))}" y="${H - 6}" text-anchor="${i === 0 ? "start" : last ? "end" : "middle"}">${esc(xFmt(lb))}</text>`;
      });
      s += refsSvg(o.refs, Y, (r) => X(r.from ?? 0), (r) => X(r.to ?? n - 1), R);
      series.forEach((se, k) => {
        runs(se.values).forEach((run) => {
          const pts = run.map((i) => [X(i), Y(se.values[i])]);
          const d = curve === "smooth" ? monotone(pts) : pts.map((p, j) => (j ? "L" : "M") + r1(p[0]) + "," + r1(p[1])).join("");
          if (area && !se.dash) s += `<path class="mark" d="${d}L${r1(pts[pts.length - 1][0])},${r1(Y(Math.max(lo, 0)))}L${r1(pts[0][0])},${r1(Y(Math.max(lo, 0)))}Z" style="fill:${cols[k]};opacity:.1"/>`;
          s += `<path class="mark" d="${d}" fill="none" style="stroke:${cols[k]}" stroke-width="${se.width || 2}" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ' stroke-dasharray="4 4"' : ""}/>`;
        });
        (se.dots || []).forEach((i) => { if (se.values[i] != null) s += `<circle cx="${r1(X(i))}" cy="${r1(Y(se.values[i]))}" r="4.5" style="fill:${cols[k]};stroke:var(--card)" stroke-width="2"/>`; });
        const li = se.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i > -1).pop();
        if (li == null || se.noEnd) return;
        s += `<circle cx="${r1(X(li))}" cy="${r1(Y(se.values[li]))}" r="4" style="fill:${cols[k]};stroke:var(--card)" stroke-width="2"/>`;
        if (o.endLabels) s += `<text class="lbl-end" x="${r1(X(li)) + 9}" y="${r1(Y(se.values[li])) + 4}">${esc(yFmt(se.values[li]))}</text>`;
      });
      s += `<g class="hov" style="display:none"><line class="xhair" y1="${T}" y2="${T + ph}"/>${series.map((_, k) => `<circle r="4" style="fill:${cols[k]};stroke:var(--card)" stroke-width="2"/>`).join("")}</g>`;
      s += `<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" aria-label="${esc(title)}: use arrow keys to read values"/></svg>`;
      el.innerHTML = s;
      const g = $(".hov", el), hit = $(".hit", el), line = $("line", g), dots = $$("circle", g);
      let idx = n - 1;
      const show = (i, cx, cy) => {
        idx = Math.max(0, Math.min(n - 1, i)); g.style.display = "";
        line.setAttribute("x1", X(idx)); line.setAttribute("x2", X(idx));
        dots.forEach((c, k) => { const v = series[k].values[idx]; c.style.display = v == null ? "none" : ""; if (v != null) { c.setAttribute("cx", X(idx)); c.setAttribute("cy", Y(v)); } });
        const band = (o.bands || []).find((b) => idx >= b.from && idx <= b.to);
        const rows = series.map((se, k) => ({ name: se.name, value: se.values[idx] == null ? null : yFmt(se.values[idx]), color: cols[k] })).filter((r) => r.value != null);
        if (band && band.label) rows.push({ name: band.label, value: "" });
        const data = { title: String(xFmt(labels[idx])), rows };
        if (cx == null) { const b = line.getBoundingClientRect(); tip.show(b.left, b.top + 20, data); } else tip.show(cx, cy, data);
      };
      const hide = () => { g.style.display = "none"; tip.hide(); };
      hit.addEventListener("pointermove", (e) => { const b = hit.getBoundingClientRect(); show(Math.round(((e.clientX - b.left) / b.width) * (n - 1)), e.clientX, e.clientY); });
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", () => show(idx)); hit.addEventListener("blur", hide);
      hit.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show(idx + (e.key === "ArrowRight" ? 1 : -1)); } });
      const leg = series.filter((se) => !se.noLegend);
      if (leg.length > 1 && o.legend !== false) el.appendChild(legendEl(leg.map((se) => ({ name: se.name, c: cols[series.indexOf(se)], line: true }))));
      el.appendChild(dataTable(title, ["", ...series.map((x) => x.name)], labels.map((lb, i) => [String(xFmt(lb)), ...series.map((se) => (se.values[i] == null ? "" : yFmt(se.values[i])))])));
    });
  };

  /* columns — grouped or stacked; ≤24px thick; 2px surface gap; band hover */
  chart.bars = function (el, o) {
    el = node(el);
    const { labels, series, height = 220, yFmt = fmt.compact, xFmt = (x) => x, stacked = false, barMax = 24, title = "Chart" } = o;
    const cols = seriesColors(series), tones = o.tones; // tones[i]: per-bar status/emphasis override (single series)
    return mount(el, (W) => {
      const n = labels.length, sums = labels.map((_, i) => series.reduce((a, se) => a + Math.max(0, se.values[i]), 0));
      const all = (stacked ? sums : series.flatMap((se) => se.values)).concat((o.refs || []).map((r) => r.y));
      const { lo, hi, ticks } = nice(Math.min(0, ...all), o.yMax ?? Math.max(...all), 4, all.every(Number.isInteger));
      const L = yAxisW(ticks, yFmt), R = 6, T = o.valueLabels ? 20 : 10, B = 26, H = height, pw = W - L - R, ph = H - T - B;
      const Y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph, band = pw / n;
      const k = stacked ? 1 : series.length;
      const bw = Math.max(3, Math.min(barMax, (band * 0.72 - (k - 1) * 2) / k));
      let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(title)}">`;
      s += bandsSvg(o.bands, (i) => L + band * i, (i) => L + band * (i + 1), T, ph);
      ticks.forEach((t) => { s += `<line class="${t === 0 ? "base" : "grid"}" x1="${L}" x2="${W - R}" y1="${r1(Y(t))}" y2="${r1(Y(t))}"/><text class="axis" x="${L - 8}" y="${r1(Y(t)) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`; });
      const lw = Math.max(48, ...labels.map((l) => String(xFmt(l)).length * 6.4 + 12)); // thin labels by their real width
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / lw))));
      labels.forEach((lb, i) => {
        const cx = L + band * i + band / 2, gx = cx - (k * bw + (k - 1) * 2) / 2;
        s += `<g class="mark" data-i="${i}">`;
        if (stacked) {
          let acc = 0;
          series.forEach((se, j) => {
            const v = Math.max(0, se.values[i]); if (!v) return;
            const y0 = Y(acc) - (acc ? 1 : 0), y1 = Y(acc + v) + (j < series.length - 1 && acc + v < sums[i] ? 1 : 0);
            const top = acc + v >= sums[i] - 1e-9;
            s += top ? `<path d="${barPath(gx, y0, y1, bw)}" style="fill:${cols[j]}"/>` : `<rect x="${r1(gx)}" y="${r1(y1)}" width="${r1(bw)}" height="${r1(Math.max(0, y0 - y1))}" style="fill:${cols[j]}"/>`;
            acc += v;
          });
        } else {
          series.forEach((se, j) => {
            const c = tones && tones[i] ? color(tones[i]) : cols[j];
            s += `<path d="${barPath(gx + j * (bw + 2), Y(0), Y(se.values[i]), bw)}" style="fill:${c}"/>`;
          });
        }
        if (o.valueLabels && !stacked && k === 1) { const v = series[0].values[i]; s += `<text class="axis" x="${r1(cx)}" y="${r1(Y(v)) - (v >= 0 ? 6 : -14)}" text-anchor="middle" style="fill:var(--fg-2)">${esc(yFmt(v))}</text>`; }
        s += `</g>`;
        if (i % every === 0) s += `<text class="axis" x="${r1(cx)}" y="${H - 6}" text-anchor="middle">${esc(xFmt(lb))}</text>`;
        s += `<rect class="hit" data-i="${i}" x="${r1(L + band * i)}" y="${T}" width="${r1(band)}" height="${ph}" fill="transparent" tabindex="0"/>`;
      });
      el.innerHTML = s + refsSvg(o.refs, Y, (r) => L + band * (r.from ?? 0), (r) => L + band * ((r.to ?? n - 1) + 1), R) + "</svg>";
      const rowsAt = (i) => series.map((se, j) => ({ name: se.name, value: yFmt(se.values[i]), color: tones && tones[i] && k === 1 ? color(tones[i]) : cols[j], shape: "sq" }));
      $$(".hit", el).forEach((h) => {
        const i = +h.dataset.i;
        const on = (e) => { el.classList.add("dim-others"); $$(".mark", el).forEach((m) => m.classList.toggle("hot", +m.dataset.i === i)); const d = { title: String(xFmt(labels[i])), rows: rowsAt(i) }; if (stacked && series.length > 1) d.rows.push({ name: "Total", value: yFmt(sums[i]) }); e && e.clientX != null ? tip.show(e.clientX, e.clientY, d) : tipAt(h, d); };
        const off = () => { el.classList.remove("dim-others"); tip.hide(); };
        h.addEventListener("pointermove", on); h.addEventListener("pointerleave", off);
        h.addEventListener("focus", () => on()); h.addEventListener("blur", off);
        if (o.onClick) { h.style.cursor = "pointer"; h.addEventListener("click", () => o.onClick(labels[i], i)); }
      });
      if (series.length > 1 && o.legend !== false) el.appendChild(legendEl(series.map((se, j) => ({ name: se.name, c: cols[j] }))));
      el.appendChild(dataTable(title, ["", ...series.map((x) => x.name)], labels.map((lb, i) => [String(xFmt(lb)), ...series.map((se) => yFmt(se.values[i]))])));
    });
  };

  /* horizontal breakdown rows (FARM "main reasons") — HTML, not SVG */
  chart.hbars = function (el, rows, { fmt: f = fmt.n, max, tone = "ink", onClick } = {}) {
    el = node(el);
    const m = max ?? Math.max(...rows.map((r) => r.value), 1);
    el.classList.add("bars");
    el.innerHTML = rows.map((r, i) => `<div class="bar"${onClick ? ` role="button" tabindex="0" data-i="${i}" style="cursor:pointer"` : ""}><span class="n" title="${esc(r.label)}">${esc(r.label)}</span><span class="t"><i class="${esc(r.tone || tone)}" style="width:0"></i></span><span class="v">${esc(f(r.value))}</span></div>`).join("");
    requestAnimationFrame(() => $$(".t i", el).forEach((i, k) => (i.style.width = (rows[k].value / m) * 100 + "%")));
    if (onClick) $$(".bar", el).forEach((b) => b.addEventListener("click", () => onClick(rows[+b.dataset.i])));
    return el;
  };

  /* donut — part-to-whole at a glance, ≤ 6 parts, always with a legend */
  chart.donut = function (el, parts, { center, sub = "", size = 132, stroke = 16, fmt: f = fmt.n, title = "Share" } = {}) {
    el = node(el);
    const tot = DD.sum(parts, (p) => p.value), R = 50, C = 2 * Math.PI * R, gap = parts.filter((p) => p.value).length > 1 ? 2 : 0;
    let off = 0, s = `<svg viewBox="0 0 128 128" width="${size}" height="${size}" role="img" aria-label="${esc(title)}"><circle cx="64" cy="64" r="${R}" fill="none" style="stroke:var(--muted)" stroke-width="${stroke}"/>`;
    parts.forEach((p, i) => {
      const len = tot ? (p.value / tot) * C : 0; if (!len) return;
      s += `<circle class="seg" data-i="${i}" cx="64" cy="64" r="${R}" fill="none" style="stroke:${color(p.tone || p.color, i)}" stroke-width="${stroke}" stroke-dasharray="${r1(Math.max(0, len - gap))} ${r1(C)}" stroke-dashoffset="${r1(-off)}" transform="rotate(-90 64 64)" tabindex="0"/>`;
      off += len;
    });
    s += `<text x="64" y="62" text-anchor="middle" style="fill:var(--fg);font:700 26px var(--sans)">${esc(center ?? f(tot))}</text><text x="64" y="80" text-anchor="middle" style="fill:var(--muted-fg);font:400 11px var(--sans)">${esc(sub)}</text></svg>`;
    el.classList.add("donut");
    el.innerHTML = s + `<div class="legend col">${parts.map((p, i) => `<span><i style="background:${color(p.tone || p.color, i)}"></i><b>${esc(f(p.value))}</b>&nbsp;${esc(p.label)}</span>`).join("")}</div>`;
    $$(".seg", el).forEach((c) => {
      const p = parts[+c.dataset.i], d = () => ({ title: p.label, rows: [{ name: "Share", value: fmt.pct(p.value / tot), color: color(p.tone || p.color, +c.dataset.i), shape: "sq" }, { name: "Count", value: f(p.value) }] });
      c.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, d())); c.addEventListener("pointerleave", tip.hide);
      c.addEventListener("focus", () => tipAt(c, d())); c.addEventListener("blur", tip.hide);
    });
    return el;
  };

  /* segmented part-to-whole bar + legend (FARM "hectares by outcome") */
  chart.stack = function (el, parts, { fmt: f = fmt.n, legend = true, size = "" } = {}) {
    el = node(el);
    const tot = DD.sum(parts, (p) => p.value) || 1;
    el.innerHTML = `<div class="stackbar ${size}">${parts.map((p, i) => `<span data-i="${i}" style="flex-grow:${p.value / tot};background:${color(p.tone || p.color, i)}"></span>`).join("")}</div>` +
      (legend ? `<div class="legend">${parts.map((p, i) => `<span><i style="background:${color(p.tone || p.color, i)}"></i>${esc(p.label)} <b>${esc(f(p.value))}</b></span>`).join("")}</div>` : "");
    $$(".stackbar span", el).forEach((sp) => {
      const p = parts[+sp.dataset.i];
      sp.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, { title: p.label, rows: [{ name: "Value", value: f(p.value), color: color(p.tone || p.color, +sp.dataset.i), shape: "sq" }, { name: "Share", value: fmt.pct(p.value / tot) }] }));
      sp.addEventListener("pointerleave", tip.hide);
    });
    return el;
  };

  /* sparkline — KPI tiles; ink by default, status tone when it means good/bad */
  chart.spark = function (el, values, { tone = "ink", area = true } = {}) {
    el = node(el);
    return mount(el, (W) => {
      const H = el.clientHeight || 40, lo = Math.min(...values), hi = Math.max(...values), n = values.length;
      const X = (i) => 3 + (i / (n - 1)) * (W - 8), Y = (v) => 4 + (H - 8) * (1 - (v - lo) / (hi - lo || 1));
      const pts = values.map((v, i) => [X(i), Y(v)]), d = monotone(pts), c = color(tone), last = pts[n - 1];
      const inner = (area ? `<path d="${d}L${r1(X(n - 1))},${H}L${r1(X(0))},${H}Z" style="fill:${c};opacity:.08"/>` : "") +
        `<path d="${d}" fill="none" style="stroke:${c}" stroke-width="2" stroke-linecap="round"/><circle cx="${r1(last[0])}" cy="${r1(last[1])}" r="3.5" style="fill:${c};stroke:var(--card)" stroke-width="2"/>`;
      if (el instanceof SVGElement) { el.setAttribute("viewBox", `0 0 ${W} ${H}`); el.setAttribute("aria-hidden", "true"); el.innerHTML = inner; }
      else el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" aria-hidden="true">${inner}</svg>`;
    });
  };

  /* heatmap — sequential one-hue ramp (magnitude), with scale legend */
  chart.heat = function (el, { rows, cols, values, fmt: f = fmt.n, min, max, title = "Heatmap" }) {
    el = node(el);
    const flat = values.flat(), lo = min ?? Math.min(...flat), hi = max ?? Math.max(...flat);
    const lvl = (v) => 1 + Math.min(6, Math.floor(((v - lo) / (hi - lo || 1)) * 7));
    el.innerHTML = `<div class="tw"><table aria-label="${esc(title)}"><thead><tr><th></th>${cols.map((c) => `<th class="r" style="text-align:center">${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      rows.map((r, i) => `<tr><td style="white-space:nowrap"><b>${esc(r)}</b></td>${values[i].map((v, j) => `<td style="padding:3px"><div class="heat h${lvl(v)}" tabindex="0" data-r="${i}" data-c="${j}">${esc(f(v))}</div></td>`).join("")}</tr>`).join("") +
      `</tbody></table></div><div class="legend" style="margin-top:12px;align-items:center"><span class="muted">${esc(f(lo))}</span>${[1, 2, 3, 4, 5, 6, 7].map((k) => `<i style="width:22px;border-radius:2px;background:var(--seq-${k});margin:0 -6px"></i>`).join("")}<span class="muted" style="margin-left:8px">${esc(f(hi))}</span></div>`;
    $$(".heat", el).forEach((c) => {
      const d = () => ({ title: `${rows[+c.dataset.r]} · ${cols[+c.dataset.c]}`, rows: [{ name: "Value", value: f(values[+c.dataset.r][+c.dataset.c]) }] });
      c.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, d())); c.addEventListener("pointerleave", tip.hide);
      c.addEventListener("focus", () => tipAt(c, d())); c.addEventListener("blur", tip.hide);
    });
    return el;
  };

  /* geo — stylised point map (no tiles): dotted land-grid + status points */
  chart.geo = function (el, points, { bbox, height = 380, onClick, title = "Map" } = {}) {
    el = node(el);
    const lons = points.map((p) => p.lon), lats = points.map((p) => p.lat);
    const [x0, y0, x1, y1] = bbox || [Math.min(...lons) - 0.4, Math.min(...lats) - 0.4, Math.max(...lons) + 0.4, Math.max(...lats) + 0.4];
    return mount(el, (W) => {
      const H = height, P = 18, sx = (W - 2 * P) / (x1 - x0), sy = (H - 2 * P) / (y1 - y0), k = Math.min(sx, sy);
      const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
      const X = (lon) => ox + (lon - x0) * k, Y = (lat) => oy + (y1 - lat) * k;
      let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(title)}"><defs><pattern id="ddgeo" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" style="fill:var(--border-2)"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#ddgeo)"/>`;
      points.forEach((p, i) => { s += `<g class="pt" data-i="${i}" tabindex="0"><circle cx="${r1(X(p.lon))}" cy="${r1(Y(p.lat))}" r="12" fill="transparent"/><circle cx="${r1(X(p.lon))}" cy="${r1(Y(p.lat))}" r="${p.r || 5}" style="fill:${color(p.tone || p.color || "ink")};stroke:var(--card)" stroke-width="2"/></g>`; });
      el.innerHTML = s + "</svg>";
      $$(".pt", el).forEach((g) => {
        const p = points[+g.dataset.i], d = () => ({ title: p.label, rows: (p.rows || []).map((r) => ({ name: r[0], value: r[1] })) });
        g.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, d())); g.addEventListener("pointerleave", tip.hide);
        g.addEventListener("focus", () => tipAt(g, d())); g.addEventListener("blur", tip.hide);
        if (onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => onClick(p)); g.addEventListener("keydown", (e) => e.key === "Enter" && onClick(p)); }
      });
    });
  };

  /* dial — returns HTML for a 0–100 score; `to` draws a ghost arc to a second value
     (e.g. soil 26 → 71 once amended). Tone: ≥ 80 ok · 50–79 warn · < 50 bad. value null → "excluded". */
  DD.dial = function ({ value, to = null, label = "", sub = "", tones = [80, 50] } = {}) {
    const tone = (v) => (v >= tones[0] ? "ok" : v >= tones[1] ? "warn" : "bad");
    const P = (t) => { const a = Math.PI * (1 - t); return [60 + 50 * Math.cos(a), 62 - 50 * Math.sin(a)]; };
    const arc = (t0, t1) => { const [x0, y0] = P(t0), [x1, y1] = P(t1); return `M${x0.toFixed(1)},${y0.toFixed(1)} A50,50 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
    const track = `<path d="${arc(0, 1)}" fill="none" style="stroke:var(--muted)" stroke-width="10" stroke-linecap="round"/>`;
    const foot = `<span class="dl">${esc(label)}</span><span class="dv">${esc(sub)}</span>`;
    if (value == null) return `<div class="dial"><svg viewBox="0 0 120 70" aria-hidden="true">${track}<text x="60" y="58" text-anchor="middle" style="fill:var(--muted-fg);font:600 13px var(--sans)">excluded</text></svg>${foot}</div>`;
    const t = Math.max(0.002, Math.min(1, value / 100));
    let g = track;
    if (to != null && to > value) g += `<path d="${arc(t, Math.min(1, to / 100))}" fill="none" style="stroke:var(--${tone(to)});opacity:.35" stroke-width="10"/>`;
    g += `<path d="${arc(0, t)}" fill="none" style="stroke:var(--${tone(value)})" stroke-width="10" stroke-linecap="round"/>`;
    g += `<text x="60" y="58" text-anchor="middle" style="fill:var(--fg);font:700 24px var(--sans)">${esc(value)}</text>`;
    return `<div class="dial" role="img" aria-label="${esc(label)}: ${esc(value)}${to != null ? " to " + esc(to) : ""}"><svg viewBox="0 0 120 70">${g}</svg>${foot}</div>`;
  };

  /* swipe — before/after over two stacked .layer children of el (first = left/base, second = right/top).
     The divider position survives re-renders of the same element. */
  DD.swipe = function (el, { labels = ["", ""], pos = 0.5 } = {}) {
    el = node(el);
    const layers = $$(":scope > .layer", el); if (layers.length < 2) return null;
    el.classList.add("swipe-wrap");
    $(":scope > .swipe-s", el)?.remove();
    const R = layers[1], sw = document.createElement("div"); sw.className = "swipe-s";
    sw.innerHTML = `<span class="side-l"></span><span class="side-r"></span><div class="knob" role="slider" tabindex="0" aria-label="Compare divider" aria-valuemin="0" aria-valuemax="100"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg></div>`;
    $(".side-l", sw).textContent = labels[0]; $(".side-r", sw).textContent = labels[1];
    el.appendChild(sw);
    const knob = $(".knob", sw);
    const set = (x) => { const p = Math.max(0.03, Math.min(0.97, x)); el._swipe = p; sw.style.left = p * 100 + "%"; R.style.clipPath = `inset(0 0 0 ${p * 100}%)`; knob.setAttribute("aria-valuenow", Math.round(p * 100)); };
    knob.addEventListener("pointerdown", (e) => { knob.setPointerCapture(e.pointerId); const mv = (ev) => { const r = el.getBoundingClientRect(); set((ev.clientX - r.left) / r.width); }; knob.addEventListener("pointermove", mv); knob.addEventListener("pointerup", () => knob.removeEventListener("pointermove", mv), { once: true }); });
    knob.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") set(el._swipe - 0.05); if (e.key === "ArrowRight") set(el._swipe + 0.05); });
    set(el._swipe ?? pos);
    return { set };
  };

  /* ------------------------------------------------------------- table
     cols: [{key,label,align:'r',render:(row)=>html,sort:true|(row)=>v,mono}]
     render() returns trusted HTML — wrap data in DD.esc(). */
  DD.table = function (el, o) {
    el = node(el);
    const { cols, rowKey = "id", onRow, pageSize = 0, empty = "No rows match these filters." } = o;
    let rows = o.rows, sort = o.sort || null, dir = o.dir || "desc", shown = pageSize || Infinity, selected = o.selected ?? null;
    const val = (c, r) => (typeof c.sort === "function" ? c.sort(r) : r[c.key]);
    function draw() {
      let data = rows.slice();
      const sc = cols.find((c) => c.key === sort);
      if (sc) data.sort((a, b) => { const x = val(sc, a), y = val(sc, b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === "asc" ? 1 : -1); });
      const vis = data.slice(0, shown), left = data.length - vis.length;
      el.innerHTML = `<div class="tw"><table class="${onRow ? "rows" : ""}"><thead><tr>${cols.map((c) => `<th class="${c.align === "r" ? "r" : ""}"${c.sort ? ` data-sort="${esc(c.key)}" aria-sort="${c.key === sort ? (dir === "asc" ? "ascending" : "descending") : "none"}" tabindex="0"` : ""}${c.width ? ` style="width:${c.width}"` : ""}>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>` +
        (vis.length ? vis.map((r) => `<tr data-k="${esc(r[rowKey])}"${r[rowKey] === selected ? ' class="sel"' : ""}${onRow ? ' tabindex="0"' : ""}>${cols.map((c) => `<td class="${[c.align === "r" ? "r" : "", c.mono ? "mono" : "", c.num ? "num" : ""].join(" ").trim()}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")
          : `<tr><td colspan="${cols.length}"><div class="empty"><b>Nothing here</b>${esc(empty)}</div></td></tr>`) +
        `</tbody></table></div>` + (left > 0 ? `<button type="button" class="btn sm" data-more style="margin-top:12px">Load more (${left} more)</button>` : "");
      $$("th[data-sort]", el).forEach((th) => {
        const act = () => { if (sort === th.dataset.sort) dir = dir === "asc" ? "desc" : "asc"; else { sort = th.dataset.sort; dir = "desc"; } draw(); };
        th.addEventListener("click", act); th.addEventListener("keydown", (e) => e.key === "Enter" && act());
      });
      const more = $("[data-more]", el); if (more) more.addEventListener("click", () => { shown += pageSize; draw(); });
      if (onRow) $$("tbody tr[data-k]", el).forEach((tr) => {
        const act = () => { const r = rows.find((x) => String(x[rowKey]) === tr.dataset.k); api.select(r[rowKey]); onRow(r); };
        tr.addEventListener("click", act); tr.addEventListener("keydown", (e) => e.key === "Enter" && act());
      });
    }
    const api = {
      update(r) { rows = r; shown = pageSize || Infinity; draw(); },
      select(k) { selected = k; $$("tbody tr", el).forEach((tr) => tr.classList.toggle("sel", tr.dataset.k === String(k))); },
      get rows() { return rows; },
    };
    draw();
    return api;
  };

  /* ------------------------------------------------------------ drawer */
  DD.drawer = (function () {
    let d, sc, last;
    function ensure() {
      if (d) return;
      sc = document.createElement("div"); sc.className = "drawer-scrim";
      d = document.createElement("aside"); d.className = "drawer"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
      d.innerHTML = `<div class="drawer-head"><div data-h></div><button type="button" class="btn ghost icon" data-x aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="drawer-body" data-b></div>`;
      document.body.append(sc, d);
      sc.addEventListener("click", api.close); $("[data-x]", d).addEventListener("click", api.close);
      document.addEventListener("keydown", (e) => e.key === "Escape" && d.classList.contains("open") && api.close());
    }
    const api = {
      open({ head = "", body = "" } = {}) {
        ensure(); last = document.activeElement;
        $("[data-h]", d).innerHTML = head; $("[data-b]", d).innerHTML = body; $("[data-b]", d).scrollTop = 0;
        d.classList.add("open"); sc.classList.add("open"); $("[data-x]", d).focus();
        return $("[data-b]", d);
      },
      close() { if (!d) return; d.classList.remove("open"); sc.classList.remove("open"); tip.hide(); last && last.focus && last.focus(); },
    };
    return api;
  })();

  /* ------------------------------------------------------------- toast */
  DD.toast = function (msg, tone = "ok") {
    let wrap = $(".toasts");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "toasts"; wrap.setAttribute("aria-live", "polite"); document.body.appendChild(wrap); }
    const t = document.createElement("div"); t.className = "toast";
    const dot = document.createElement("span"); dot.className = "dot " + tone;
    const tx = document.createElement("span"); tx.textContent = msg;
    t.append(dot, tx); wrap.appendChild(t);
    setTimeout(() => { t.style.transition = "opacity .25s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 260); }, 3200);
  };

  /* ------------------------------------------- refresh & live updates
     Refetch keeps the frame: dim the previous render, never skeleton-flash. */
  DD.refresh = function (els, fn, ms = 420) {
    els = [].concat(els).map((e) => (typeof e === "string" ? $(e) : e)).filter(Boolean);
    els.forEach((e) => e.classList.add("is-loading"));
    setTimeout(() => { fn && fn(); els.forEach((e) => e.classList.remove("is-loading")); }, reduced() ? 0 : ms);
  };
  DD.live = function (fn, ms = 5000) {
    const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(id);
  };

  /* -------------------------------------------------------- auto init */
  function init() {
    DD.theme.init();
    DD.shell();
    // mock actions give feedback instead of doing nothing
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-toast]"); if (b) DD.toast(b.dataset.toast, b.dataset.tone || "ok");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
