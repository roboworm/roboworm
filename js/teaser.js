/* Hero teaser: three tabs (KIVA, RIGIS, Acceleration) over one card. The KIVA pane is driven by
   kiva.js; this file switches panes and draws the RIGIS rotation plot and the acceleration bars. */
(function () {
  const U = window.RW;
  const NS = "http://www.w3.org/2000/svg";
  const DWELL = 12000;
  const svgEl = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------- RIGIS: view 2 rotation, bad clip against clean clip ---------- */
  function rigisPane(pane) {
    const g = n => pane.querySelector(`[data-g="${n}"]`);
    const video = g("video"), svg = g("rot"), clock = g("t");
    let bad = null, good = null, head = null;
    Promise.all(["00096", "00090"].map(id => fetch(`data/rigis_${id}.json`).then(r => r.json())))
      .then(([a, b]) => { bad = a; good = b; draw(); })
      .catch(() => {});

    function draw() {
      if (!bad) return;
      const W = svg.clientWidth || 600, H = 128, L = 30, R = 150, T = 8, B = 20;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
      svg.replaceChildren();
      const tMax = bad.dur, yMax = 180;
      const x = t => L + (W - L - R) * t / tMax, y = v => T + (H - T - B) * (1 - v / yMax);
      [0, 90, 180].forEach(v => {
        svg.append(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "var(--stage-grid)", "stroke-width": 1 }));
        svg.append(svgEl("text", { x: L - 6, y: y(v) + 3.5, "text-anchor": "end", fill: "var(--stage-ink-3)", "font-size": 10 }, v + "°"));
      });
      for (let t = 0; t <= tMax; t += 2) svg.append(svgEl("text", { x: x(t), y: H - 5, "text-anchor": "middle", fill: "var(--stage-ink-3)", "font-size": 10 }, t + " s"));
      const path = (d, col, w) => {
        const pts = d.frames.map(f => `${x(f.t).toFixed(1)},${y(Math.min(yMax, f.rotDeg[1] || 0)).toFixed(1)}`);
        svg.append(svgEl("polyline", { points: pts.join(" "), fill: "none", stroke: col, "stroke-width": w, "stroke-linejoin": "round" }));
        d.frames.forEach(f => svg.append(svgEl("circle", { cx: x(f.t), cy: y(Math.min(yMax, f.rotDeg[1] || 0)), r: w, fill: col })));
        return d.frames[d.frames.length - 1];
      };
      const eg = path(good, "var(--good)", 2), eb = path(bad, "var(--rigis)", 2.4);
      const tag = (f, col, l1, l2, dy) => {
        const yy = y(Math.min(yMax, f.rotDeg[1] || 0)) + dy;
        svg.append(svgEl("text", { x: W - R + 10, y: yy, fill: col, "font-size": 11, "font-weight": 700 }, l1));
        svg.append(svgEl("text", { x: W - R + 10, y: yy + 13, fill: "var(--stage-ink-3)", "font-size": 10 }, l2));
      };
      tag(eb, "var(--rigis)", "this clip, 00096", "humans: bad", -2);
      tag(eg, "var(--good)", "clean clip, 00090", "humans: good", -8);
      head = svgEl("line", { y1: T, y2: H - B, stroke: "var(--stage-ink)", "stroke-width": 1.2, "stroke-dasharray": "3 3" });
      svg.append(head);
    }
    addEventListener("resize", U.debounce(draw, 150));
    addEventListener("rw-theme", draw);

    (function loop() {
      requestAnimationFrame(loop);
      if (!bad || !head || !pane.classList.contains("on")) return;
      const t = video.currentTime || 0;
      const W = svg.clientWidth || 600, xx = 30 + (W - 30 - 150) * Math.min(t, bad.dur) / bad.dur;
      head.setAttribute("x1", xx); head.setAttribute("x2", xx);
      const f = bad.frames.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
      clock.textContent = `t ${t.toFixed(1)} s · view 2 at ${Math.round(f.rotDeg[1] || 0)}°`;
    })();
  }

  /* ---------- Acceleration: KIVA on single view and RIGIS on multi-view, side by side ---------- */
  function accelPane(pane) {
    const g = n => pane.querySelector(`[data-g="${n}"]`);
    const svg = g("acc");
    const A = window.RW_DATA.accel || [];
    const ORDER = ["Dense", "WorldCache", "DiCache", "FasterCache", "SVG1", "SVG2", "PISA", "Radial", "SiTo", "ITM"];
    const FAM = { cache: "cache", sparse: "sparse", token: "pruning" };
    const MORPH = [{ k: "bimanual", t: "Bimanual" }, { k: "humanoid", t: "Humanoid" }, { k: "single_arm", t: "Single-arm" }];
    const NAME = { bimanual: "bimanual", humanoid: "humanoid", single_arm: "single-arm" };
    let morph = "bimanual";
    U.seg(g("morph"), MORPH, morph, k => { morph = k; draw(); replay(); });

    const track = (tr) => {
      const P = A.find(p => p.morph === morph && p.track === tr);
      const M = P.models.find(m => m.name === "DreamGen");
      const by = Object.fromEntries(M.methods.map(m => [m.name, m]));
      return { P, by, dense: by.Dense };
    };
    const fig = n => (n || "").replace(/^Figure\s*/, "Fig. ").replace(/\s*\(\w\)\.?.*$/, "");
    function replay() { pane.classList.remove("grow"); void pane.offsetWidth; pane.classList.add("grow"); }

    function draw() {
      const sv = track("sv"), mv = track("mv");
      g("head").textContent = `DreamGen · ${NAME[morph]} · ${fig(sv.P.note)}`;
      const W = svg.clientWidth || 540, RH = 31, T = 44, n = ORDER.length, H = T + RH * n + 26;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
      svg.replaceChildren();
      const c0 = 0, colW = (W - 104 - 16) / 2;
      const cols = [
        { x: 104, tr: sv, key: "kiva", col: "var(--kiva)", h: "KIVA · single view", sub: "% of segments flagged, lower is better", lowBetter: true, fmt: v => v.toFixed(1) + "%" },
        { x: 104 + colW + 16, tr: mv, key: "rigis", col: "var(--rigis)", h: "RIGIS · multi-view", sub: "consistency score, higher is better", lowBetter: false, fmt: v => v.toFixed(3) },
      ];
      svg.append(svgEl("text", { x: c0, y: 14, fill: "var(--stage-ink-2)", "font-size": 11, "font-weight": 700 }, "Method"));
      cols.forEach(c => {
        const vals = ORDER.map(k => c.tr.by[k] && c.tr.by[k].metric).filter(v => v != null);
        if (c.tr.P.real != null) vals.push(c.tr.P.real);
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (c.lowBetter) { lo = 0; hi = Math.ceil(hi * 1.08 / 10) * 10; }
        else { const pad = (hi - lo) * 0.12 + 0.002; lo -= pad; hi += pad; }
        const sx = 50, px0 = c.x + sx + 10, px1 = c.x + colW - 50;
        const X = v => px0 + (px1 - px0) * (v - lo) / (hi - lo);
        svg.append(svgEl("text", { x: c.x, y: 14, fill: c.col, "font-size": 11.5, "font-weight": 700 }, c.h));
        svg.append(svgEl("text", { x: c.x, y: 27, fill: "var(--stage-ink-3)", "font-size": 9.5 }, c.sub));
        svg.append(svgEl("text", { x: c.x + sx - 4, y: T - 4, "text-anchor": "end", fill: "var(--stage-ink-3)", "font-size": 9 }, "speed · Q"));
        const d = c.tr.dense.metric, yTop = T - 2, yBot = T + RH * n - 4;
        const ref = (v, label, col, anchor) => {
          svg.append(svgEl("line", { x1: X(v), x2: X(v), y1: yTop, y2: yBot, stroke: col, "stroke-width": 1.2, "stroke-dasharray": "3 3" }));
          svg.append(svgEl("text", { x: X(v) + (anchor === "end" ? -2 : 2), y: yBot + 12, "text-anchor": anchor, fill: col, "font-size": 9, "font-weight": 600 }, label));
        };
        const real = c.tr.P.real;
        const realLeft = real != null && real < d;
        ref(d, "dense", "var(--stage-ink-2)", realLeft ? "start" : "end");
        if (real != null) ref(real, "real video", "var(--good)", realLeft ? "end" : "start");
        ORDER.forEach((k, i) => {
          const m = c.tr.by[k], yy = T + i * RH, cy = yy + 11;
          if (!m || m.metric == null) {
            svg.append(svgEl("text", { x: c.x + sx - 4, y: cy + 4, "text-anchor": "end", fill: "var(--stage-ink-3)", "font-size": 10 }, "n/a"));
            return;
          }
          const isD = k === "Dense";
          svg.append(svgEl("text", { x: c.x + sx - 4, y: cy + 1, "text-anchor": "end", fill: isD ? "var(--stage-ink-3)" : "var(--accel)", "font-size": 11.5, "font-weight": 700 }, m.speedup.toFixed(2) + "×"));
          svg.append(svgEl("text", { x: c.x + sx - 4, y: cy + 12, "text-anchor": "end", fill: "var(--stage-ink-3)", "font-size": 9 }, "Q " + Math.round(m.q * 100) + "%"));
          svg.append(svgEl("line", { x1: px0, x2: px1, y1: cy + 2, y2: cy + 2, stroke: "var(--stage-grid)", "stroke-width": 1 }));
          const worse = c.lowBetter ? m.metric > d : m.metric < d;
          const tol = c.lowBetter ? 1 : 0.003, same = Math.abs(m.metric - d) < tol;
          const col = isD ? "var(--stage-ink)" : same ? "var(--stage-ink-3)" : worse ? "var(--bad)" : "var(--good)";
          if (!isD) svg.append(svgEl("line", { x1: X(d), x2: X(m.metric), y1: cy + 2, y2: cy + 2, stroke: col, "stroke-width": 4, "stroke-linecap": "round", class: "bar", style: `transform-origin:${X(d)}px ${cy + 2}px` }));
          svg.append(svgEl("circle", { cx: X(m.metric), cy: cy + 2, r: 4.5, fill: col, stroke: "var(--stage)", "stroke-width": 1.5 }));
          svg.append(svgEl("text", { x: c.x + colW, y: cy + 5.5, "text-anchor": "end", fill: col, "font-size": 10.5, "font-weight": 700, class: "num" }, c.fmt(m.metric)));
        });
      });
      ORDER.forEach((k, i) => {
        const yy = T + i * RH, cy = yy + 11, m = sv.by[k] || mv.by[k], isWC = k === "WorldCache";
        if (isWC) svg.insertBefore(svgEl("rect", { x: -6, y: yy - 3, width: W + 6, height: RH - 2, rx: 4, fill: "color-mix(in srgb, var(--accel) 13%, transparent)" }), svg.firstChild);
        svg.append(svgEl("text", { x: c0, y: cy + 1, fill: "var(--stage-ink)", "font-size": 12, "font-weight": isWC || k === "Dense" ? 700 : 500 }, k));
        if (m.fam !== "dense") svg.append(svgEl("text", { x: c0, y: cy + 12, fill: "var(--stage-ink-3)", "font-size": 9 }, FAM[m.fam]));
      });

      // takeaway, computed from the two panels
      const wcS = sv.by.WorldCache, wcM = mv.by.WorldCache;
      const worst = (tr, low) => ORDER.slice(1).map(k => tr.by[k]).filter(m => m && m.metric != null).reduce((a, b) => (low ? b.metric > a.metric : b.metric < a.metric) ? b : a);
      const wK = worst(sv, true), wR = worst(mv, false);
      const cmpK = wcS.metric > sv.dense.metric ? `flags <b>${wcS.metric}%</b> of its segments against ${sv.dense.metric}% for dense` : `flags ${wcS.metric}% of its segments, below dense (${sv.dense.metric}%)`;
      g("take").innerHTML = `WorldCache runs <b>${wcS.speedup}×</b> on single view with Q ${Math.round(wcS.q * 100)}%, and KIVA ${cmpK}. ` +
        `On multi-view it runs <b>${wcM.speedup}×</b> with RIGIS ${wcM.metric.toFixed(3)} against ${mv.dense.metric.toFixed(3)} for dense. ` +
        `<span class="no">Largest physics loss: ${wK.name} on KIVA (${wK.metric}%), ${wR.name} on RIGIS (${wR.metric.toFixed(3)}).</span>`;
    }
    draw();
    addEventListener("resize", U.debounce(draw, 150));
    addEventListener("rw-theme", draw);
  }

  /* ---------- tabs ---------- */
  function tabs() {
    const root = document.getElementById("heroAudit"); if (!root) return;
    const btns = [...root.querySelectorAll("#teaseTabs [data-t]")];
    const panes = Object.fromEntries([...root.querySelectorAll(".tease-pane")].map(p => [p.dataset.pane, p]));
    let cur = "kiva", auto = true, t0 = performance.now(), visible = true;

    const vids = p => [...p.querySelectorAll("video")];
    Object.values(panes).forEach(p => vids(p).forEach(v => v.addEventListener("play", () => { if (!p.classList.contains("on")) v.pause(); })));

    function go(k, user) {
      if (user) auto = false;
      cur = k; t0 = performance.now();
      btns.forEach(b => {
        const on = b.dataset.t === k;
        b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
        b.querySelector("i").style.width = "0";
      });
      for (const key in panes) {
        const p = panes[key], on = key === k;
        p.classList.toggle("on", on); p.inert = !on;
        vids(p).forEach(v => {
          if (on) {
            if (!v.src && v.dataset.src) v.src = v.dataset.src;
            if (visible) v.play().catch(() => {});
          } else v.pause();
        });
        if (on) { p.classList.remove("grow"); void p.offsetWidth; p.classList.add("grow"); }
      }
    }
    btns.forEach((b, i) => {
      b.addEventListener("click", () => go(b.dataset.t, true));
      b.addEventListener("keydown", e => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return;
        const n = btns[(i + d + btns.length) % btns.length]; n.focus(); go(n.dataset.t, true);
      });
    });
    new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) t0 = performance.now() - 0; }).observe(root);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) auto = false;
    (function loop(now) {
      requestAnimationFrame(loop);
      if (!auto) return;
      if (!visible) { t0 = now - (btns.find(b => b.dataset.t === cur).__el || 0); return; }
      const el = now - t0, b = btns.find(x => x.dataset.t === cur);
      b.__el = el;
      b.querySelector("i").style.width = Math.min(100, 100 * el / DWELL) + "%";
      if (el >= DWELL) go(btns[(btns.indexOf(b) + 1) % btns.length].dataset.t, false);
    })(performance.now());
    go("kiva", false);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const r = document.querySelector('.tease-pane[data-pane="rigis"]'), a = document.querySelector('.tease-pane[data-pane="accel"]');
    if (r) rigisPane(r);
    if (a) accelPane(a);
    tabs();
  });
})();
