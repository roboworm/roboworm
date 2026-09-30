/* KIVA on real rollouts: the hero audit card and the five-stage lab share one sample
   loader, one skeleton renderer and one segment timeline. */
(function () {
  const U = window.RW;
  const SAMPLES = [
    { id: "halluc_bimanual", label: "Bimanual", group: "halluc" },
    { id: "halluc_humanoid", label: "Humanoid", group: "halluc" },
    { id: "halluc_single_arm", label: "Single-arm", group: "halluc" },
    { id: "clean_bimanual", label: "Bimanual", group: "clean" },
    { id: "clean_humanoid", label: "Humanoid", group: "clean" },
    { id: "clean_single_arm", label: "Single-arm", group: "clean" },
  ];
  // Per-embodiment cuts fitted against human labels (Appendix B.1, Eq. B.1).
  const CUTS = { single_arm: [1.70, 2.10], bimanual: [1.00, 1.50], humanoid: [0.32, 0.80] };
  const ROBOT = { single_arm: "Single-arm · GALAXEA A1X", bimanual: "Bimanual · ALOHA", humanoid: "Humanoid · Fourier GR-1" };
  const MODEL = { fastercache: "FasterCache", svg2: "SVG2", itm: "ITM", dense: "Dense", pisa: "PISA", dicache: "DiCache", sito: "SiTo", radial: "Radial", worldcache: "WorldCache", svg1: "SVG1" };
  const band = (r, robot) => (r > CUTS[robot][1] ? "high" : r > CUTS[robot][0] ? "med" : "low");
  const BAND_TXT = { high: "Hallucinated", med: "Borderline", low: "Plausible" };
  const BAND_PILL = { high: "bad", med: "med", low: "good" };

  const cache = {};
  function load(id) {
    if (!cache[id]) cache[id] = fetch(`data/kiva_${id}.json`).then(r => r.json()).then(prep);
    return cache[id];
  }
  function hex(s) { const a = new Uint8Array(s.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16); return a; }
  function prep(d) {
    d.draws = d.draws.slice(0, 5);   // five runs, as KIVA averages N = 5
    d.attnF = d.attn_frame.map(hex);
    d.attnK = d.attn_kp.map(hex);
    const M = d.mean5, T = M.length, K = M[0].length;
    d.T = T; d.K = K;
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // signed length error of each rigid bone at each frame (mm)
    d.err = M.map(P => d.rigid.map(([a, b], j) => dist(P[a], P[b]) - d.rest_mm[j]));
    d.worst = d.err.map(e => e.reduce((m, x) => Math.max(m, Math.abs(x)), 0));
    const sorted = d.worst.slice().sort((a, b) => a - b);
    d.vRig = (sorted[(T - 1) >> 1] + sorted[T >> 1]) / 2;
    // third backward difference per keypoint, lambda/dt^3 with dt = 1/fps
    const f3 = d.fps ** 3;
    d.jerkK = M.map((P, t) => t < 3 ? null : P.map((p, k) => {
      const a = M[t - 1][k], b = M[t - 2][k], c = M[t - 3][k];
      return Math.hypot(p[0] - 3 * a[0] + 3 * b[0] - c[0], p[1] - 3 * a[1] + 3 * b[1] - c[1], p[2] - 3 * a[2] + 3 * b[2] - c[2]) * f3;
    }));
    d.jerk = d.jerkK.map(v => v ? Math.max(...v) : null);
    d.vJerk = Math.max(...d.jerk.filter(v => v != null));
    // average of the five runs shown, and their spread around it, per frame (median over keypoints)
    d.avg = M.map((P, t) => P.map((_, k) => [0, 1, 2].map(j => d.draws.reduce((a, D) => a + D[t][k][j], 0) / d.draws.length)));
    d.spread = d.avg.map((P, t) => {
      const per = P.map((p, k) => { let s = 0; d.draws.forEach(D => { s += dist(D[t][k], p); }); return s / d.draws.length; });
      per.sort((a, b) => a - b); return per[per.length >> 1];
    });
    d.spreadMed = U.median(d.spread);
    // geometry for the camera
    let c = [0, 0, 0], n = 0;
    M.forEach(P => P.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++; }));
    c = c.map(v => v / n);
    let R = 1; M.forEach(P => P.forEach(p => { R = Math.max(R, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); }));
    d.center = c; d.R = R;
    // the runs differ by millimetres; enlarge their offsets from the mean so the five skeletons separate on screen
    const want = R * 0.07 / Math.max(0.1, d.spreadMed);
    d.exag = [1, 2, 5, 10, 20, 50].reduce((a, b) => Math.abs(Math.log(b / want)) < Math.abs(Math.log(a / want)) ? b : a);
    d.zmin = Math.min(...M.flat().map(p => p[2]));
    // fixed noise for the denoising animation (normalized units)
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    d.eps = d.draws.map(D => D.map(P => P.map(() => [g(), g(), g()])));
    d.segScore = d.segments.find(s => s.s === d.start);
    return d;
  }

  /* ---------- skeleton renderer ---------- */
  const ramp = r => U.ramp(r); // 0 green, 1 amber (threshold), 2+ red
  const T = U.tok;
  function Skel(canvas) {
    const ctx = canvas.getContext("2d");
    const st = { yaw: 0.6, el: 0.35, drag: null, auto: true, d: null, w: 0, h: 0 };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function size() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      st.w = r.width; st.h = r.height;
      canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(size).observe(canvas); size();
    canvas.addEventListener("pointerdown", e => { st.drag = [e.clientX, e.clientY, st.yaw, st.el]; st.auto = false; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => {
      if (!st.drag) return;
      st.yaw = st.drag[2] + (e.clientX - st.drag[0]) * 0.01;
      st.el = Math.max(-0.2, Math.min(1.3, st.drag[3] + (e.clientY - st.drag[1]) * 0.008));
    });
    const up = () => { st.drag = null; setTimeout(() => { if (!st.drag) st.auto = true; }, 2500); };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

    function proj(p) {
      const d = st.d, s = 0.47 * Math.min(st.w, st.h) / d.R;
      const x = p[0] - d.center[0], y = p[1] - d.center[1], z = p[2] - d.center[2];
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      const xr = x * cy - y * sy, yr = x * sy + y * cy;
      const v = z * Math.cos(st.el) - yr * Math.sin(st.el);
      return [st.w / 2 + xr * s, st.h * 0.52 - v * s];
    }
    function line(a, b, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }

    function draw(i, o) {
      const d = st.d; if (!d || !st.w) return;
      if (st.auto && !reduce) st.yaw += 0.004;
      ctx.clearRect(0, 0, st.w, st.h);
      ctx.lineCap = "round";
      // floor grid
      const g = d.R * 1.1, z0 = d.zmin - d.R * 0.15;
      ctx.globalAlpha = 1;
      for (let k = -4; k <= 4; k++) {
        const t = k / 4 * g;
        line(proj([d.center[0] + t, d.center[1] - g, z0]), proj([d.center[0] + t, d.center[1] + g, z0]), T("--stage-grid"), 1);
        line(proj([d.center[0] - g, d.center[1] + t, z0]), proj([d.center[0] + g, d.center[1] + t, z0]), T("--stage-grid"), 1);
      }
      ctx.globalAlpha = 1;
      if (o.runs) { runs(i, o.runs); return; }
      const M = d.mean5, P = M[i], dim = o.dim ? 0.35 : 1;
      // keypoint paths over the segment
      if (o.paths !== false) {
        for (let k = 0; k < d.K; k++) {
          const hot = o.jerk && k === d.jerkKey;
          ctx.strokeStyle = hot ? T("--jerk") : U.alpha("--stage-ink-3", .3); ctx.lineWidth = hot ? 1.8 : 1;
          ctx.beginPath(); M.forEach((Q, t) => { const q = proj(Q[k]); t ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke();
        }
      }
      // diffusion draws (optionally mid-denoising)
      if (o.draws) {
        const ab = o.noise == null ? 1 : Math.cos((o.noise + 0.008) / 1.008 * Math.PI / 2) ** 2;
        const a = Math.sqrt(ab), b = Math.sqrt(1 - ab), sc = d.R * 0.9;
        ctx.fillStyle = U.alpha("--kiva", o.noise == null ? .55 : .75);
        d.draws.forEach((D, n) => D[i].forEach((p, k) => {
          const e = d.eps[n][i][k];
          const q = proj([d.center[0] + a * (p[0] - d.center[0]) + b * e[0] * sc, d.center[1] + a * (p[1] - d.center[1]) + b * e[1] * sc, d.center[2] + a * (p[2] - d.center[2]) + b * e[2] * sc]);
          ctx.beginPath(); ctx.arc(q[0], q[1], o.noise == null ? 1.6 : 2.2, 0, 7); ctx.fill();
        }));
      }
      const skelA = o.skelAlpha == null ? 1 : o.skelAlpha;
      if (skelA > 0) {
        ctx.globalAlpha = skelA * dim;
        const rigidSet = new Set(d.rigid.map(([a, b]) => a + "-" + b));
        d.drawn.forEach(([a, b]) => { if (!rigidSet.has(a + "-" + b)) line(proj(P[a]), proj(P[b]), T("--stage-ink-3"), 2); });
        let wj = 0; d.err[i].forEach((e, j) => { if (Math.abs(e) > Math.abs(d.err[i][wj])) wj = j; });
        d.rigid.forEach(([a, b], j) => {
          const col = o.color ? ramp(Math.abs(d.err[i][j]) / d.rigidity_threshold_mm) : T("--stage-ink");
          line(proj(P[a]), proj(P[b]), col, o.color && j === wj ? 5 : 3.4);
        });
        P.forEach(p => { const q = proj(p); ctx.fillStyle = T("--stage"); ctx.strokeStyle = T("--stage-ink"); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(q[0], q[1], 3.2, 0, 7); ctx.fill(); ctx.stroke(); });
        if (o.color && !o.dim) {
          const [a, b] = d.rigid[wj], e = d.err[i][wj], q = proj(P[a]).map((v, t) => (v + proj(P[b])[t]) / 2);
          const bad = Math.abs(e) > d.rigidity_threshold_mm;
          ctx.font = "600 12px 'IBM Plex Sans', sans-serif";
          const txt = `${e > 0 ? "+" : "−"}${Math.abs(e).toFixed(0)} mm of ${d.rest_mm[wj].toFixed(0)}`;
          const w = ctx.measureText(txt).width;
          ctx.fillStyle = bad ? T("--bad-bg") : T("--good-bg");
          const lx = Math.max(4, Math.min(q[0] + 8, st.w - w - 14)), ly = Math.max(22, q[1]);
          ctx.fillRect(lx, ly - 20, w + 10, 18);
          ctx.fillStyle = bad ? T("--bad") : T("--good"); ctx.fillText(txt, lx + 5, ly - 7);
        }
        ctx.globalAlpha = 1;
      }
      // jerk stencil on the jerkiest keypoint
      if (o.jerk && i >= 3) {
        const k = d.jerkKey, W = ["−1", "+3", "−3", "+1"];
        const pts = [i - 3, i - 2, i - 1, i].map(t => proj(M[t][k]));
        ctx.setLineDash([3, 3]); ctx.strokeStyle = T("--jerk"); ctx.lineWidth = 1.2;
        ctx.beginPath(); pts.forEach((q, n) => n ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = "500 11px 'IBM Plex Mono', monospace";
        pts.forEach((q, n) => {
          ctx.fillStyle = n === 3 ? T("--jerk") : U.alpha("--jerk", .6); ctx.beginPath(); ctx.arc(q[0], q[1], n === 3 ? 5 : 3.6, 0, 7); ctx.fill();
          ctx.fillStyle = T("--jerk"); ctx.fillText(W[n], q[0] + 7, q[1] + (n % 2 ? 14 : -7));
        });
      }
      if (o.dim) {
        ctx.fillStyle = T("--stage-ink-3"); ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
        ctx.fillText("outside the scored segment", 10, st.h - 12);
      }
    }
    // Denoise stage: five DDIM runs leave their noise, then collapse onto their mean
    const RUNS = ["--kiva", "--rigis", "--audit", "--accel", "--data"];
    function runs(i, R) {
      const d = st.d, M = d.avg[i], cols = RUNS.map(n => T(n));
      const ab = Math.cos((R.noise + 0.008) / 1.008 * Math.PI / 2) ** 2, a = Math.sqrt(ab), b = Math.sqrt(1 - ab), sc = d.R * 0.9;
      const off = d.exag * (1 - R.merge);
      const P = d.draws.map((D, n) => D[i].map((p, k) => {
        const m = M[k], e = d.eps[n][i][k];
        return [0, 1, 2].map(j => { const v = m[j] + off * (p[j] - m[j]); return d.center[j] + a * (v - d.center[j]) + b * e[j] * sc; });
      }));
      const boneA = Math.max(0, 1 - R.noise / 0.3) * (1 - R.mean * 0.75);
      P.forEach((Q, n) => {
        if (boneA > 0) { ctx.globalAlpha = boneA; d.drawn.forEach(([x, y]) => line(proj(Q[x]), proj(Q[y]), cols[n], 1.8)); }
        ctx.globalAlpha = R.noise > 0.3 ? 0.85 : 0.9 * (1 - R.mean * 0.6); ctx.fillStyle = cols[n];
        Q.forEach(p => { const q = proj(p); ctx.beginPath(); ctx.arc(q[0], q[1], R.noise > 0.3 ? 2.4 : 2.8, 0, 7); ctx.fill(); });
      });
      if (R.mean > 0) {
        ctx.globalAlpha = R.mean;
        d.drawn.forEach(([x, y]) => line(proj(M[x]), proj(M[y]), T("--stage-ink"), 3.4));
        M.forEach(p => { const q = proj(p); ctx.fillStyle = T("--stage"); ctx.strokeStyle = T("--stage-ink"); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(q[0], q[1], 3.2, 0, 7); ctx.fill(); ctx.stroke(); });
      }
      ctx.globalAlpha = 1;
      // what is happening, in words, plus a key for the five colors
      ctx.font = "600 12.5px 'IBM Plex Sans', sans-serif"; ctx.fillStyle = T("--stage-ink");
      ctx.fillText(R.label, 10, 38);
      ctx.font = "500 11px 'IBM Plex Sans', sans-serif"; ctx.fillStyle = T("--stage-ink-3");
      let x = 10; const y = st.h - 14;
      cols.forEach((c, n) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 4, y - 4, 4, 0, 7); ctx.fill(); x += 12; });
      ctx.fillStyle = T("--stage-ink-3");
      ctx.fillText(R.merge < 1 && R.noise < 0.3 ? `5 runs · offsets from the mean drawn ×${d.exag}` : R.mean >= 1 ? "5 runs → mean (dark)" : "5 runs", x + 4, y);
    }
    return { st, draw, set(d) { st.d = d; }, size };
  }

  /* ---------- attention overlay ---------- */
  function Overlay(canvas) {
    const ctx = canvas.getContext("2d");
    const small = document.createElement("canvas"); const sctx = small.getContext("2d");
    let w = 0, h = 0;
    function size() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width; h = r.height; canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(size).observe(canvas); size();
    function heat(v) { // inferno-like
      const s = [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]];
      const x = v * 4, i = Math.min(3, Math.floor(x)), u = x - i;
      return s[i].map((c, j) => Math.round(c + (s[i + 1][j] - c) * u));
    }
    function draw(a, grid, alpha, showGrid) {
      ctx.clearRect(0, 0, w, h);
      if (alpha <= 0) return;
      small.width = grid; small.height = grid;
      const img = sctx.createImageData(grid, grid);
      for (let i = 0; i < grid * grid; i++) {
        const v = a[i] / 255, c = heat(v);
        img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.pow(v, 1.4) * 1.15));
      }
      sctx.putImageData(img, 0, 0);
      ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(small, 0, 0, w, h); ctx.globalAlpha = 1;
      if (showGrid) {
        ctx.strokeStyle = "rgba(255,255,255,.13)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = 1; k < grid; k++) { const x = k * w / grid, y = k * h / grid; ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
      }
    }
    return { draw };
  }

  /* ---------- segment timeline ---------- */
  function timeline(svg, d, opts = {}) {
    const W = svg.clientWidth || 600, H = opts.h || 64, pad = { l: 34, r: 8, t: 6, b: 16 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const n = d.segments.length, cuts = CUTS[d.robot];
    const top = Math.max(4, Math.max(...d.segments.map(s => Math.max(s.rig, d.robot === "single_arm" ? s.jerk : 0))) * 1.05);
    const ly = v => pad.t + (H - pad.t - pad.b) * (1 - Math.log(Math.max(v, 0.05) / 0.05) / Math.log(top / 0.05));
    const bw = (W - pad.l - pad.r) / n;
    const col = { high: "var(--bad)", med: "var(--med)", low: "var(--good)" };
    const ink = "var(--stage-ink-3)";
    let s = "";
    [1].concat(cuts).forEach((c, k) => {
      const y = ly(c);
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="${k ? ink : "var(--stage-line)"}" stroke-dasharray="${k ? "3 3" : "1 3"}" stroke-width="1"/>`;
    });
    s += `<text x="${pad.l - 5}" y="${ly(cuts[0]) + 3}" fill="${ink}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono">γ₁</text>`;
    s += `<text x="${pad.l - 5}" y="${ly(cuts[1]) + 3 - (Math.abs(ly(cuts[1]) - ly(cuts[0])) < 10 ? 8 : 0)}" fill="${ink}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono">γ₂</text>`;
    d.segments.forEach((g, k) => {
      const r = d.robot === "single_arm" ? Math.max(g.rig, g.jerk) : g.rig;
      const y = ly(r), x = pad.l + k * bw;
      const hot = g.s === d.start;
      s += `<rect x="${x + bw * 0.12}" y="${y}" width="${Math.max(1, bw * 0.76)}" height="${H - pad.b - y}" fill="${col[band(r, d.robot)]}" opacity="${hot ? 1 : 0.55}" rx="1"/>`;
      if (hot) s += `<rect x="${x - 1}" y="${pad.t - 2}" width="${bw + 2}" height="${H - pad.b - pad.t + 4}" fill="none" stroke="var(--stage-ink)" stroke-width="1.2" rx="2"/>`;
    });
    s += `<text x="${pad.l}" y="${H - 3}" fill="${ink}" font-size="9.5" font-family="IBM Plex Sans">16-frame segments →</text>`;
    s += `<text x="${W - pad.r}" y="${H - 3}" fill="${ink}" font-size="9.5" text-anchor="end" font-family="IBM Plex Sans">score (log) vs. calibrated cuts</text>`;
    s += `<line data-ph x1="0" x2="0" y1="${pad.t - 3}" y2="${H - pad.b + 2}" stroke="var(--stage-ink)" stroke-width="1.5"/>`;
    svg.innerHTML = s;
    const ph = svg.querySelector("[data-ph]");
    const total = Math.max(1, d.segments[n - 1].e + 1);
    return f => { const x = pad.l + (W - pad.l - pad.r) * Math.min(1, f / total); ph.setAttribute("x1", x); ph.setAttribute("x2", x); };
  }

  function verdicts(root, d) {
    const hb = d.human === "Bad" ? "high" : d.human === "Good" ? "low" : "med";
    const vRuns = d.vlm_runs, vHigh = vRuns.filter(v => v === "high").length;
    const vb = vHigh * 2 > vRuns.length ? "high" : "low";
    const kb = band(d.kiva_ratio, d.robot);
    const set = (k, b, why, wrong) => {
      const el = root.querySelector(`[data-v="${k}"]`);
      el.querySelector(".what").innerHTML = `<span class="pill ${BAND_PILL[b]}">${BAND_TXT[b]}</span>`;
      if (why != null) el.querySelector(".why").textContent = why;
      el.classList.toggle("wrong", !!wrong);
    };
    set("human", hb, null, false);
    set("vlm", vb, `“${d.vlm_evidence}”`, vb !== hb);
    const det = d.robot === "single_arm" ? (d.segScore.jerk > d.segScore.rig ? "jerk" : "rigidity") : "rigidity";
    set("kiva", kb, `${d.kiva_ratio.toFixed(2)}× real p95 (${det}); cuts ${CUTS[d.robot].join(" / ")}`, kb !== hb);
  }

  // plain-language reading of the clip: what the metric saw, then who agrees with the human raters
  function takeaway(el, d) {
    if (!el) return;
    const hb = d.human === "Bad" ? "high" : d.human === "Good" ? "low" : "med";
    const kb = band(d.kiva_ratio, d.robot), r = d.kiva_ratio.toFixed(2);
    const jerky = d.robot === "single_arm" && d.segScore.jerk > d.segScore.rig;
    const nv = d.vlm_runs.filter(v => v === "high").length, vb = nv * 2 > d.vlm_runs.length ? "high" : "low";
    const nAgree = d.vlm_runs.filter(v => (v === "high") === (hb === "high")).length;
    const what = kb === "high"
      ? (jerky ? `Joints jump between frames: jerk reaches <b>${r}×</b> the 95th percentile of real footage of this robot.`
               : `Rigid links change length: the bone error reaches <b>${r}×</b> the 95th percentile of real footage of this robot.`)
      : kb === "low" ? `Links hold their length and motion stays smooth: the segment scores <b>${r}×</b> the real-footage threshold, inside what real video shows.`
      : `The segment sits between the two cuts at <b>${r}×</b> the real-footage threshold.`;
    const k = kb === hb ? `<span class="ok">KIVA agrees with the human raters.</span>` : `<span class="no">KIVA disagrees with the human raters.</span>`;
    const v = vb === hb ? `The VLM judge agrees in ${nAgree} of 3 runs.` : `<span class="no">The VLM judge calls it ${BAND_TXT[vb].toLowerCase()}</span> in ${3 - nAgree} of 3 runs.`;
    el.innerHTML = `<span class="lbl">This clip</span><span class="txt">${what} ${k} ${v}</span>`;
  }

  function picker(root, onPick, current) {
    root.innerHTML = SAMPLES.map(s => `<button type="button" data-id="${s.id}" aria-pressed="${s.id === current}"><span class="sw" style="background:${s.group === "halluc" ? "var(--bad)" : "var(--good)"}"></span>${s.label} · ${s.group === "halluc" ? "hallucinated" : "clean"}</button>`).join("");
    root.addEventListener("click", e => {
      const b = e.target.closest("button[data-id]"); if (!b) return;
      root.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      onPick(b.dataset.id);
    });
  }

  function finishSample(d) {
    // jerkiest keypoint for the stencil
    let best = -1; d.jerkKey = d.jerk_keypoint;
    d.jerkK.forEach(v => v && v.forEach((x, k) => { if (x > best) { best = x; d.jerkKey = k; } }));
    return d;
  }

  /* ---------- hero audit card ---------- */
  function hero() {
    const root = document.getElementById("heroAudit"); if (!root) return;
    const f = n => root.querySelector(`[data-f="${n}"]`);
    const video = f("video"), sk = Skel(f("skel"));
    let d = null, setPh = () => {}, token = 0;
    async function show(id) {
      const my = ++token; const s = finishSample(await load(id)); if (my !== token) return;
      d = s; sk.set(d);
      f("head").textContent = `${ROBOT[d.robot]} · ${MODEL[d.model] || d.model} rollout · ${d.split === "markov" ? "Markovian" : "non-Markovian"}`;
      video.src = d.video; video.play().catch(() => {});
      setPh = timeline(f("tl"), d, {});
      verdicts(root, d); takeaway(f("take"), d);
    }
    picker(f("picker"), show, "halluc_bimanual");
    show("halluc_bimanual");
    addEventListener("resize", U.debounce(() => { if (d) setPh = timeline(f("tl"), d, {}); }, 150));
    let visible = true;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; visible ? video.play().catch(() => {}) : video.pause(); }).observe(root);
    (function loop() {
      requestAnimationFrame(loop);
      if (!d || !visible) return;
      const lo = Math.max(0, d.start - 8), hi = d.end + 8;
      let fr = Math.floor(video.currentTime * d.fps + 1e-3);
      if (!video.paused && (fr > hi || fr < lo)) { video.currentTime = (lo + 0.1) / d.fps; fr = lo; }
      const i = Math.max(0, Math.min(15, fr - d.start));
      const inside = fr >= d.start && fr <= d.end;
      sk.draw(i, { color: true, draws: false, dim: !inside });
      setPh(fr);
      f("t").textContent = `frame ${String(fr).padStart(3, "0")}`;
    })();
  }

  /* ---------- the lab ---------- */
  const STAGES = [
    { k: "read", t: "Read the pixels", c: "var(--kiva)",
      h: "A frozen DINOv3 encoder turns each frame into tokens",
      p: "The reader never sees robot state at test time. Its keypoint queries cross-attend to the 24×24 token grid of each frame; the heat map is where they look. It was trained only on real teleoperation, with forward-kinematics targets and a Huber loss.",
      eq: "\\(\\mathbf{X}^{\\text{FK}} = \\text{FK}(\\mathbf{s}_{1:T}),\\quad \\hat{\\mathbf{x}}_0 = g_\\theta(\\mathbf{x}_t, t, \\mathcal{F})\\)",
      plot: "End-effector path over the segment (mm, from frame 0)" },
    { k: "denoise", t: "Denoise", c: "var(--kiva)",
      h: "Several DDIM runs, one mean trajectory",
      p: "Each run starts from its own Gaussian noise and denoises to a full 3-D trajectory. KIVA averages N = 5 runs and maps the mean back to metres; rigidity and jerk are measured on that mean. The runs differ by a few millimetres, so the animation enlarges their offsets.",
      eq: "\\(\\mathbf{P} = \\mathcal{W}^{-1}\\Big(\\tfrac{1}{N}\\sum_{n=1}^{N} \\hat{\\mathbf{x}}_0^{(n)}\\Big)\\)",
      plot: "How far the 5 runs sit from their mean (mm, median keypoint)" },
    { k: "rig", t: "Rigidity", c: "var(--rig)",
      h: "Links of a robot do not change length",
      p: "Every rigid pair of keypoints has a known URDF length. Rigidity is the worst length error at each frame; the segment keeps the median. Bone color runs from green through yellow at the real-video threshold to red at twice it.",
      eq: "\\(r_\\tau = \\lambda \\max_{(a,b)\\in\\mathcal{B}} \\big|\\,\\|\\mathbf{P}_{\\tau a}-\\mathbf{P}_{\\tau b}\\|_2 - L_{ab}\\big|,\\quad v^{\\text{rig}}_S = \\operatorname{median}_{\\tau\\in S} r_\\tau\\)",
      plot: "Worst bone length error per frame (mm)" },
    { k: "jerk", t: "Jerk", c: "var(--jerk)",
      h: "Joints do not teleport between frames",
      p: "Jerk is the third derivative of position, taken as a backward finite difference over four frames with weights −1, +3, −3, +1. The segment keeps the maximum over frames and keypoints.",
      eq: "\\(j_\\tau = \\dfrac{\\lambda}{\\Delta t^3}\\max_k \\|\\mathbf{P}_{\\tau k} - 3\\mathbf{P}_{\\tau-1,k} + 3\\mathbf{P}_{\\tau-2,k} - \\mathbf{P}_{\\tau-3,k}\\|_2\\)",
      plot: "Jerk per frame ÷ real-video threshold" },
    { k: "cal", t: "Calibrate", c: "var(--stage-ink)",
      h: "Measured against real footage of the same robot",
      p: "The reader has a small error even on real video, so raw millimetres mean little. Each value is divided by its 95th percentile on real training clips; 1.0 is the top of real footage. Two cuts per embodiment, fitted on nine human-labelled videos, turn the score into low / medium / high.",
      eq: "\\(s^d_S = v^d_S / \\theta^d,\\;\\; \\theta^d = Q_{0.95}\\{v^d_R\\},\\;\\; s_S = \\max_d s^d_S\\)",
      plot: "Every segment of this rollout, scored" },
  ];

  function lab() {
    const root = document.getElementById("kivaLab"); if (!root) return;
    const f = n => root.querySelector(`[data-f="${n}"]`);
    const video = f("video"), sk = Skel(f("skel")), ov = Overlay(f("ov"));
    const stepsEl = f("steps");
    let d = null, stage = 0, playing = true, frame = 0, stageT0 = performance.now(), token = 0, visible = false;
    stepsEl.innerHTML = STAGES.map((s, k) => `<button type="button" role="tab" aria-selected="${k === 0}" style="--c:${s.c}" data-k="${k}"><span class="i">${k + 1} / 5</span>${s.t}<span class="bar"></span></button>`).join("");
    stepsEl.addEventListener("click", e => { const b = e.target.closest("button"); if (b) setStage(+b.dataset.k, true); });
    let userPicked = false;
    function setStage(k, user) {
      stage = k; stageT0 = performance.now(); if (user) userPicked = true;
      stepsEl.querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-selected", j === k));
      const s = STAGES[k];
      f("h").textContent = s.h; f("p").textContent = s.p; f("eq").innerHTML = s.eq; f("plotT").textContent = s.plot;
      U.typeset(f("eq"));
      renderPlot(); renderChips();
    }
    async function show(id) {
      const my = ++token; const s = finishSample(await load(id)); if (my !== token) return;
      d = s; sk.set(d);
      video.src = d.video; video.currentTime = (d.start + 0.5) / d.fps;
      if (playing && visible) video.play().catch(() => {});
      f("segname").textContent = `${d.segment.replace(".mp4", "")} · frames ${d.start}–${d.end}`;
      takeaway(f("take"), d);
      renderPlot(); renderChips();
    }
    picker(f("picker"), show, "halluc_bimanual");

    f("play").addEventListener("click", () => {
      playing = !playing;
      f("play").innerHTML = playing ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.5v9l8-4.5z"/></svg>';
      f("play").setAttribute("aria-label", playing ? "Pause" : "Play");
      playing ? video.play().catch(() => {}) : video.pause();
    });
    f("scrub").addEventListener("input", e => {
      if (playing) f("play").click();
      frame = +e.target.value; if (d) video.currentTime = (d.start + frame + 0.5) / d.fps;
    });

    let setPh = null;
    function renderChips() {
      const c = f("chips"); if (!d) return;
      const thr = d.rigidity_threshold_mm, cut = CUTS[d.robot];
      const ch = [];
      if (stage === 0) ch.push(`<span class="chip">${d.K} keypoints · ${d.T} frames · <b>${d.grid}×${d.grid}</b> tokens</span>`);
      if (stage === 1) ch.push(`<span class="chip">N = <b>5</b> runs</span>`, `<span class="chip">median spread <b>${d.spreadMed.toFixed(1)} mm</b></span>`, `<span class="chip">θ<sub>rig</sub> <b>${thr.toFixed(1)} mm</b></span>`, `<span class="chip">offsets drawn <b>×${d.exag}</b></span>`);
      if (stage === 2) ch.push(`<span class="chip">v<sub>rig</sub> = <b>${d.vRig.toFixed(1)} mm</b></span>`, `<span class="chip">θ<sub>rig</sub> = <b>${thr.toFixed(1)} mm</b></span>`, `<span class="chip">s<sub>rig</sub> = <b>${(d.vRig / thr).toFixed(2)}</b> re-read · <b>${d.segScore.rig.toFixed(2)}</b> stored</span>`);
      if (stage === 3) ch.push(`<span class="chip">s<sub>jerk</sub> = <b>${(d.vJerk / d.jerk_threshold).toFixed(2)}</b> re-read · <b>${d.segScore.jerk.toFixed(2)}</b> stored</span>`, `<span class="chip">${d.robot === "single_arm" ? "counts toward the score" : "reported; this embodiment is scored on rigidity"}</span>`);
      if (stage === 4) {
        const b = band(d.kiva_ratio, d.robot);
        ch.push(`<span class="chip">s<sub>S</sub> = <b>${d.kiva_ratio.toFixed(2)}</b></span>`, `<span class="chip">cuts γ = <b>${cut[0]} / ${cut[1]}</b></span>`, `<span class="chip">KIVA: <b style="color:var(--${b === "high" ? "bad" : b === "med" ? "med" : "good"})">${BAND_TXT[b]}</b></span>`, `<span class="chip">Human: <b>${d.human}</b></span>`, `<span class="chip">VLM ×3: <b>${d.vlm_runs.filter(v => v === "high").length > 1 ? "Hallucinated" : "Plausible"}</b></span>`);
      }
      c.innerHTML = ch.join("");
    }
    function renderPlot() {
      const svg = f("plot"); if (!d) return;
      setPh = null;
      if (stage === 4) { f("plotR").textContent = `${d.segments.length} segments`; setPh = timeline(svg, d, { h: 190 }); return; }
      const W = svg.clientWidth || 520, H = 190, pad = { l: 44, r: 12, t: 12, b: 24 };
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const xs = t => pad.l + (W - pad.l - pad.r) * t / (d.T - 1);
      let series = [], lines = [], yMin = 0, yMax = 1, band_ = null, lab = "";
      if (stage === 0) {
        const k = d.jerkKey, o = d.mean5[0][k];
        series = [0, 1, 2].map(ax => ({ c: ["var(--ax-x)", "var(--ax-y)", "var(--ax-z)"][ax], v: d.mean5.map(P => P[k][ax] - o[ax]), n: "xyz"[ax] }));
        const all = series.flatMap(s => s.v); yMin = Math.min(...all, -5); yMax = Math.max(...all, 5); lab = "mm";
        f("plotR").textContent = `keypoint ${k}`;
      } else if (stage === 1) {
        const thr = d.rigidity_threshold_mm;
        series = [{ c: "var(--kiva)", v: d.spread, n: "spread" }]; yMin = 0; yMax = Math.max(thr, ...d.spread) * 1.18; lab = "mm";
        lines = [{ y: thr, c: "var(--bad)", t: "θ rig, for scale" }];
        f("plotR").textContent = `spread ≈ ${Math.round(d.spreadMed / thr * 100)}% of θ rig`;
      } else if (stage === 2) {
        const thr = d.rigidity_threshold_mm;
        series = [{ c: "var(--rig)", v: d.worst, n: "worst bone" }];
        yMin = 0; yMax = Math.max(thr * 1.5, ...d.worst) * 1.15; lab = "mm";
        lines = [{ y: thr, c: "var(--bad)", t: "θ rig (real p95)" }, { y: d.vRig, c: "var(--rig)", t: "median", dash: "2 3" }];
        band_ = [thr, yMax]; f("plotR").textContent = "";
      } else if (stage === 3) {
        const v = d.jerk.map(x => x == null ? null : x / d.jerk_threshold);
        series = [{ c: "var(--jerk)", v, n: "jerk" }]; yMin = 0; yMax = Math.max(1.4, ...v.filter(x => x != null)) * 1.15; lab = "×θ";
        lines = [{ y: 1, c: "var(--bad)", t: "real p95" }]; band_ = [1, yMax];
        f("plotR").textContent = `needs τ ≥ 3`;
      }
      const ys = v => pad.t + (H - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin));
      let s = "";
      if (band_) s += `<rect x="${pad.l}" y="${ys(band_[1])}" width="${W - pad.l - pad.r}" height="${ys(band_[0]) - ys(band_[1])}" fill="var(--bad)" fill-opacity=".08"/>`;
      const ticks = U.ticks(yMin, yMax, 4);
      ticks.forEach(t => { s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="var(--stage-grid)"/><text x="${pad.l - 6}" y="${ys(t) + 3.5}" fill="var(--stage-ink-3)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${U.fmt(t)}</text>`; });
      s += `<text x="${pad.l - 6}" y="${pad.t - 2}" fill="var(--stage-ink-3)" font-size="9.5" text-anchor="end" font-family="IBM Plex Sans">${lab}</text>`;
      for (let t = 0; t < d.T; t += 3) s += `<text x="${xs(t)}" y="${H - 6}" fill="var(--stage-ink-3)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${t}</text>`;
      lines.forEach(L => { s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(L.y)}" y2="${ys(L.y)}" stroke="${L.c}" stroke-dasharray="${L.dash || "5 4"}" stroke-width="1.2"/><text x="${W - pad.r}" y="${ys(L.y) - 4}" fill="${L.c}" font-size="10" text-anchor="end" font-family="IBM Plex Sans">${L.t}</text>`; });
      series.forEach(S => {
        let p = "", on = false;
        S.v.forEach((v, t) => { if (v == null) { on = false; return; } p += `${on ? "L" : "M"}${xs(t).toFixed(1)},${ys(v).toFixed(1)}`; on = true; });
        s += `<path d="${p}" fill="none" stroke="${S.c}" stroke-width="2" stroke-linejoin="round"/>`;
        S.v.forEach((v, t) => { if (v != null) s += `<circle data-t="${t}" cx="${xs(t)}" cy="${ys(v)}" r="2.4" fill="${S.c}"/>`; });
      });
      if (stage === 0) s += `<text x="${pad.l + 6}" y="${pad.t + 10}" fill="var(--stage-ink-3)" font-size="10.5" font-weight="600" font-family="IBM Plex Sans"><tspan fill="var(--ax-x)">x</tspan> <tspan fill="var(--ax-y)">y</tspan> <tspan fill="var(--ax-z)">z</tspan></text>`;
      s += `<line data-ph x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--stage-ink)" stroke-width="1" opacity=".6"/>`;
      svg.innerHTML = s;
      const ph = svg.querySelector("[data-ph]");
      setPh = fr => { const t = Math.max(0, Math.min(d.T - 1, fr - d.start)); ph.setAttribute("x1", xs(t)); ph.setAttribute("x2", xs(t)); };
    }
    addEventListener("resize", U.debounce(renderPlot, 150));

    new IntersectionObserver(es => {
      visible = es[0].isIntersecting;
      if (visible && playing) video.play().catch(() => {}); else video.pause();
    }, { threshold: 0.15 }).observe(root);

    const DWELL = [7000, 8400, 7000, 7000, 8000];
    (function loop(now) {
      requestAnimationFrame(loop);
      if (!d || !visible) return;
      let fr = Math.floor(video.currentTime * d.fps + 1e-3);
      if (playing && (fr > d.end || fr < d.start)) { video.currentTime = (d.start + 0.1) / d.fps; fr = d.start; }
      frame = Math.max(0, Math.min(15, fr - d.start));
      f("scrub").value = frame; f("fr").textContent = `τ = ${String(frame).padStart(2, " ")}`;
      const el = now - stageT0;
      // auto-advance the tour until the viewer takes over
      const bar = stepsEl.querySelectorAll(".bar")[stage];
      if (!userPicked && playing) {
        bar.style.width = Math.min(100, el / DWELL[stage] * 100) + "%";
        if (el > DWELL[stage]) { bar.style.width = "0"; setStage((stage + 1) % 5); }
      } else stepsEl.querySelectorAll(".bar").forEach(b => { b.style.width = "0"; });
      const k = STAGES[stage].k;
      ov.draw(d.attnF[frame], d.grid, k === "read" ? 0.72 : k === "denoise" ? 0.25 : 0, k === "read");
      let o;
      if (k === "read") o = { draws: false, skelAlpha: 0.9 };
      else if (k === "denoise") {
        // 0-2.8 s denoise, 2.8-4.1 s hold the five runs, 4.1-5.3 s collapse onto their mean, then hold the mean
        const c = el % 7600, ease = u => u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        const noise = c < 2800 ? (1 - c / 2800) ** 1.3 : 0, merge = c < 4100 ? 0 : c < 5300 ? ease((c - 4100) / 1200) : 1;
        const label = c < 2800 ? "Five DDIM runs, each from its own noise" : c < 4100 ? "Five clean trajectories" : c < 5300 ? "Average the runs" : "Mean of 5: the trajectory KIVA scores";
        o = { runs: { noise, merge, mean: merge, label } };
      } else if (k === "rig") o = { color: true, draws: true };
      else if (k === "jerk") o = { jerk: true, skelAlpha: 0.5 };
      else o = { color: true };
      sk.draw(frame, o);
      if (setPh) setPh(stage === 4 ? fr : fr);
    })(performance.now());
    setStage(0);
    show("halluc_bimanual");
  }

  document.addEventListener("DOMContentLoaded", () => { hero(); lab(); });
})();
