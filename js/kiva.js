/* KIVA on real rollouts: the hero audit card and the step-by-step lab share one sample
   loader and the per-frame measurements computed in prep(). */
(function () {
  const U = window.RW;
  const SAMPLES = [
    { id: "halluc_severe", label: "Bimanual, severe", group: "halluc" },
    { id: "halluc_arm", label: "Humanoid, kettle", group: "halluc" },
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
      ctx.fillText(R.merge < 1 && R.noise < 0.3 ? `5 runs · offsets ×${d.exag}` : R.mean >= 1 ? "5 runs → mean (dark)" : "5 runs", x + 4, y);
    }
    return { st, draw, set(d) { st.d = d; }, size };
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
      ? (jerky ? `Joints jump between frames: <b>${r}×</b> the real-video limit.` : `Rigid links change length: <b>${r}×</b> the real-video limit.`)
      : kb === "low" ? `Links hold their length: <b>${r}×</b> the real-video limit.`
      : `Borderline: <b>${r}×</b> the real-video limit.`;
    const v = vb === hb ? "" : ` <span class="no">VLM: ${BAND_TXT[vb].toLowerCase()}, ${3 - nAgree}/3 runs.</span>`;
    el.innerHTML = `<span class="lbl">This clip</span><span class="txt">${what}${v}</span>`;
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
    picker(f("picker"), show, "halluc_severe");
    show("halluc_severe");
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

  /* ---------- the lab: one frame held still, each KIVA step drawn over it ----------
     A check runs the reader's steps on the frame at τ, then time advances a few frames and the
     next check starts. The first check runs in full, later ones quickly, and the segment ends
     with calibration. The side widgets fill in as frames are processed. */
  const DK = { ink: "#e8eef6", ink2: "#a9b8c9", ink3: "#6f8196", grid: "rgba(255,255,255,.10)", kiva: "#38bdf8", good: "#3ddc84", amber: "#ffc233", bad: "#ff5a4f", jerk: "#ff8a50", panel: "rgba(8,12,17,.82)" };
  const RUNC = ["#38bdf8", "#b388ff", "#ffb74d", "#69f0ae", "#f472b6"];
  const rgbS = a => `rgb(${a.map(Math.round).join(",")})`;
  const dkRamp = x => {
    const v = Math.max(0, Math.min(2, x)), A = [61, 220, 132], B = [255, 194, 51], C = [255, 90, 79];
    const [p, q, u] = v < 1 ? [A, B, v] : [B, C, v - 1];
    return rgbS(p.map((c, i) => c + (q[i] - c) * u));
  };
  function heatRGB(v) { // inferno-like
    const s = [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]];
    const x = Math.max(0, Math.min(1, v)) * 4, i = Math.min(3, Math.floor(x)), u = x - i;
    return s[i].map((c, j) => Math.round(c + (s[i + 1][j] - c) * u));
  }
  const LSTEPS = [
    { k: "tok", li: "Cut the frame into 24×24 patch tokens", eq: "\\(\\mathcal{F}_\\tau = \\mathrm{DINOv3}(I_\\tau)\\)" },
    { k: "att", li: "Keypoint queries read the patch tokens", eq: "\\(\\hat{\\mathbf{x}}_0 = g_\\theta(\\mathbf{x}_t, t, \\mathcal{F})\\)" },
    { k: "den", li: "Denoise five runs and keep their mean", eq: "\\(\\mathbf{P} = \\mathcal{W}^{-1}\\Big(\\tfrac{1}{N}\\sum_{n=1}^{N} \\hat{\\mathbf{x}}_0^{(n)}\\Big)\\)" },
    { k: "rig", li: "Measure every bone against its URDF length", eq: "\\(r_\\tau = \\lambda \\max_{(a,b)\\in\\mathcal{B}} \\big|\\,\\|\\mathbf{P}_{\\tau a}-\\mathbf{P}_{\\tau b}\\|_2 - L_{ab}\\big|\\)" },
    { k: "adv", li: "Advance, and run the jerk stencil along each trail", eq: "\\(j_\\tau = \\tfrac{\\lambda}{\\Delta t^3}\\max_k \\|\\mathbf{P}_{\\tau k} - 3\\mathbf{P}_{\\tau-1,k} + 3\\mathbf{P}_{\\tau-2,k} - \\mathbf{P}_{\\tau-3,k}\\|_2\\)" },
    { k: "cal", li: "Divide by the real-footage p95 and read the band", eq: "\\(s^d_S = v^d_S / \\theta^d,\\;\\; \\theta^d = Q_{0.95}\\{v^d_R\\},\\;\\; s_S = \\max_d s^d_S\\)" },
  ];
  const ORDER = LSTEPS.map(s => s.k);
  const CHECKS = [0, 4, 8, 12];
  const QUICK = 0.3, ADV_MS = 430, Q_MS = 420, SWAY = 0.25;
  const ease = u => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
  const cl = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  function lab() {
    const root = document.getElementById("kivaLab"); if (!root) return;
    const f = n => root.querySelector(`[data-f="${n}"]`);
    const cv = f("cv"), ctx = cv.getContext("2d");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const heatC = document.createElement("canvas"), hctx = heatC.getContext("2d");
    let d = null, sprite = null, token = 0, W = 0, H = 0, visible = false;
    let playing = !reduce, speed = 1;
    const st = { c: 0, ph: "tok", t: 0, tau: 0, clk: 0 };
    const view = { yaw: 0.6, el: 0.5, base: 0.6, sw: 0, drag: null, auto: true };

    /* side panel scaffolding */
    f("steps").innerHTML = LSTEPS.map((s, i) => `<li data-k="${s.k}"><span class="i">${i + 1}</span><span>${s.li}</span></li>`).join("");
    f("steps").addEventListener("click", e => { const li = e.target.closest("li"); if (li && d) { st.ph = li.dataset.k; st.t = 0; if (st.ph === "cal") st.tau = 15; sync(); } });
    U.seg(f("sp"), [0.5, 1, 2, 4].map(v => ({ k: String(v), t: v + "×" })), "1", k => { speed = +k; });
    const PLAY = '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.5v9l8-4.5z"/></svg>Play';
    const PAUSE = '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg>Pause';
    const setPlay = p => { playing = p; f("play").innerHTML = p ? PAUSE : PLAY; f("play").classList.toggle("on", p); };
    setPlay(playing);
    f("play").addEventListener("click", () => setPlay(!playing));
    f("next").addEventListener("click", () => { if (d) { st.t = dur(st.ph); step(0); } });
    f("scrub").addEventListener("input", e => {
      if (!d) return; setPlay(false);
      st.tau = +e.target.value; st.c = CHECKS.filter(c => c <= st.tau).length - 1;
      st.ph = "rig"; st.t = dur("rig"); sync();
    });

    function size() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width; H = r.height; cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(size).observe(cv); size();
    cv.addEventListener("pointerdown", e => { view.drag = [e.clientX, e.clientY, view.yaw, view.el]; view.auto = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", e => {
      if (!view.drag) return;
      view.yaw = view.drag[2] + (e.clientX - view.drag[0]) * 0.01;
      view.el = Math.max(-0.2, Math.min(1.3, view.drag[3] + (e.clientY - view.drag[1]) * 0.008));
    });
    const up = () => { view.drag = null; setTimeout(() => { if (!view.drag) { view.base = view.yaw; view.sw = 0; view.auto = true; } }, 2500); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);

    /* ---------- timeline ---------- */
    const detailed = () => st.c === 0;
    const advTarget = () => Math.min(15, (CHECKS.find(c => c > st.tau) ?? 15));
    function dur(ph) {
      const q = detailed() ? 1 : QUICK;
      if (ph === "tok") return 2600 * q;
      if (ph === "att") return detailed() ? d.K * Q_MS + 2600 : 1800;
      if (ph === "den") return 4600 * q;
      if (ph === "rig") return detailed() ? 3800 : 1400;
      if (ph === "adv") return Math.max(1, advTarget() - st.tau) * ADV_MS + 300;
      return 6500; // cal
    }
    function step(dt) {
      st.t += dt; st.clk += dt;
      let guard = 0;
      while (st.t >= dur(st.ph) && guard++ < 8) {
        st.t -= dur(st.ph);
        if (st.ph === "adv") {
          st.tau = advTarget();
          if (st.tau >= 15) st.ph = "cal";
          else { st.c = CHECKS.indexOf(st.tau); st.ph = "tok"; }
        } else if (st.ph === "cal") { st.c = 0; st.tau = 0; st.ph = "tok"; st.t = 0; }
        else st.ph = ORDER[ORDER.indexOf(st.ph) + 1];
        sync();
      }
    }
    // τ on screen: during "adv" the frame walks forward
    const tauShow = () => st.ph === "adv" ? Math.min(advTarget(), st.tau + Math.floor(st.t / ADV_MS) + (st.t > 0 ? 1 : 0)) : st.tau;
    // the last frame whose bones have been measured
    const measured = () => st.ph === "cal" ? 15 : ["tok", "att", "den"].includes(st.ph) ? st.tau - 1 : tauShow();

    let lastPh = null;
    function sync() {
      if (st.ph !== lastPh) {
        const i = ORDER.indexOf(st.ph);
        f("steps").querySelectorAll("li").forEach((li, j) => { li.classList.toggle("on", j === i); li.classList.toggle("done", j < i); });
        f("eq").innerHTML = LSTEPS[i].eq; U.typeset(f("eq"));
        lastPh = st.ph;
      }
    }

    /* ---------- loading ---------- */
    async function show(id) {
      const my = ++token;
      f("phase").textContent = "Loading";
      const [s, img] = await Promise.all([load(id).then(finishSample), new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `assets/kiva/frames_${id}.jpg`; })]);
      if (my !== token) return;
      d = s; sprite = img;
      if (!d.labPrep) labPrep(d);
      view.yaw = view.base = d.fitYaw; view.el = d.fitEl; view.sw = 0;
      takeaway(f("take"), d);
      f("jl").textContent = d.robot === "single_arm" ? "Jerk ÷ real p95" : "Jerk ÷ real p95, reported only";
      st.c = 0; st.tau = 0; st.ph = "tok"; st.t = 0; lastPh = null; sync();
    }
    // bright blobs of a saliency map: local maxima above 45% of its peak, strongest first
    function blobs(a, g, n) {
      const c = [];
      for (let i = 0; i < g * g; i++) {
        const v = a[i]; if (v < 115) continue;
        const x = i % g, y = (i / g) | 0; let top = true;
        for (let dy = -2; dy <= 2 && top; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < g && yy < g && a[yy * g + xx] > v) { top = false; break; }
        }
        if (top) c.push([(x + 0.5) / g, (y + 0.5) / g, v / 255, i]);
      }
      return c.sort((p, q) => q[2] - p[2]).slice(0, n);
    }
    // for the whole frame: each bright blob of the summed map, sent to the keypoints whose own map is bright there
    function frameSrc(t) {
      if (d.fsrc[t]) return d.fsrc[t];
      const out = [];
      blobs(d.attnF[t], d.grid, 8).forEach(b => {
        const ks = d.attnK.map((a, k) => [k, a[b[3]] / 255]).filter(([k, v]) => d.kpW[k] >= 0.4 && v >= 0.45).sort((p, q) => q[1] - p[1]).slice(0, 5);
        ks.forEach(([k, v]) => out.push({ b, k, v }));
      });
      return (d.fsrc[t] = out);
    }
    function labPrep(d) {
      d.labPrep = true;
      const top = (a, n) => Array.from(a.keys()).sort((x, y) => a[y] - a[x]).slice(0, n);
      d.topK = d.attnK.map(a => top(a, 5));
      d.top1 = d.attnK.map(a => top(a, 1)[0]);
      // where each query looks: weighted centre of the cells around its peak, in frame units
      d.hot = d.attnK.map((a, k) => {
        const g = d.grid, m = d.top1[k], mx = m % g, my = Math.floor(m / g);
        let sx = 0, sy = 0, sw = 0;
        for (let y = Math.max(0, my - 2); y <= Math.min(g - 1, my + 2); y++) for (let x = Math.max(0, mx - 2); x <= Math.min(g - 1, mx + 2); x++) {
          const w = (a[y * g + x] / 255) ** 4; sx += w * (x + 0.5); sy += w * (y + 0.5); sw += w;
        }
        return [sx / sw / g, sy / sw / g];
      });
      // every bright blob of a query's map, not only its peak: local maxima above 45% of the peak, strongest first
      d.src = d.attnK.map(a => blobs(a, d.grid, 6));
      d.fsrc = [];
      const km = Math.max(...(d.kp_mm || [1]));
      d.kpW = d.attnK.map((_, k) => d.kp_mm ? d.kp_mm[k] / km : 1);
      d.sRigRe = d.vRig / d.rigidity_threshold_mm;
      d.sJerkRe = d.vJerk / d.jerk_threshold;
      d.jRatio = d.jerk.map(v => v == null ? null : v / d.jerk_threshold);
      d.worstJ = d.err.map(e => e.reduce((w, x, j) => Math.abs(x) > Math.abs(e[w]) ? j : w, 0));
      d.sprite = { cols: 4, fw: 0, fh: 0 };
      // viewing angle whose 2-D layout of the keypoints best matches where the queries look on the frame
      // (least squares up to scale and shift), so the 3-D panel reads like the camera view
      const ar = d.width / d.height, live = d.kpW.map(w => w >= 0.4), mid = d.mean5[d.mean5.length >> 1];
      const Hs = d.hot.map(h => [h[0] * ar, h[1]]).filter((_, k) => live[k]);
      const scr = (p, yaw, el) => { const x = p[0] - d.center[0], y = p[1] - d.center[1], z = p[2] - d.center[2], c = Math.cos(yaw), sn = Math.sin(yaw);
        return [x * c - y * sn, -(z * Math.cos(el) - (x * sn + y * c) * Math.sin(el))]; };
      const cen = A => { const m = [0, 1].map(j => A.reduce((a, p) => a + p[j], 0) / A.length); return A.map(p => [p[0] - m[0], p[1] - m[1]]); };
      const Hc = cen(Hs), hh2 = Hc.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0);
      let best = [Infinity, 0.6, 0.5];
      if (Hs.length >= 3) for (let yaw = 0; yaw < 6.28; yaw += 0.05) for (let el = 0.25; el <= 1.2; el += 0.05) {
        const Q = cen(mid.filter((_, k) => live[k]).map(p => scr(p, yaw, el)));
        let qh = 0, qq = 0; Q.forEach((q, i) => { qh += q[0] * Hc[i][0] + q[1] * Hc[i][1]; qq += q[0] ** 2 + q[1] ** 2; });
        const res = qh > 0 ? 1 - qh * qh / (qq * hh2) : 1;
        if (res < best[0]) best = [res, yaw, el];
      }
      d.fitYaw = best[1]; d.fitEl = best[2]; d.fitRes = best[0];
      // half extents on screen over the sway around that angle, so the skeleton is drawn as large as the panel allows
      let hw = 1, hh = 1;
      for (let a = -SWAY; a <= SWAY + 1e-6; a += SWAY / 4) d.mean5.forEach(P => P.forEach(p => { const q = scr(p, d.fitYaw + a, d.fitEl); hw = Math.max(hw, Math.abs(q[0])); hh = Math.max(hh, Math.abs(q[1])); }));
      d.fitW = hw; d.fitH = hh;
    }
    picker(f("picker"), show, "halluc_severe");

    /* ---------- drawing helpers ---------- */
    function contain(ar, x, y, w, h) { let fw = w, fh = w / ar; if (fh > h) { fh = h; fw = h * ar; } return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh }; }
    const lerpR = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
    function frame(i, R) {
      const fw = sprite.width / 4, fh = sprite.height / 4;
      ctx.drawImage(sprite, (i % 4) * fw, Math.floor(i / 4) * fh, fw, fh, R.x, R.y, R.w, R.h);
    }
    function heat(a, R, alpha) {
      const g = d.grid; heatC.width = g; heatC.height = g;
      const img = hctx.createImageData(g, g);
      for (let i = 0; i < g * g; i++) {
        const v = a[i] / 255, c = heatRGB(v);
        img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.pow(v, 2) * 1.4));
      }
      hctx.putImageData(img, 0, 0);
      ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(heatC, R.x, R.y, R.w, R.h); ctx.restore();
    }
    const tokXY = (i, R) => [R.x + ((i % d.grid) + 0.5) * R.w / d.grid, R.y + (Math.floor(i / d.grid) + 0.5) * R.h / d.grid];
    function proj(p, S) {
      const s = S.sc;
      const x = p[0] - d.center[0], y = p[1] - d.center[1], z = p[2] - d.center[2];
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
      const xr = x * cy - y * sy, yr = x * sy + y * cy;
      const v = z * Math.cos(view.el) - yr * Math.sin(view.el);
      return [S.cx + xr * s, S.cy - v * s];
    }
    function seg(a, b, col, w, dash) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]); }
    function dot(p, r, col, ring) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1.2; ctx.stroke(); } }
    function text(s, x, y, o = {}) {
      ctx.font = o.font || "500 12px 'IBM Plex Sans', sans-serif"; ctx.textAlign = o.align || "left"; ctx.textBaseline = o.base || "alphabetic";
      if (o.halo !== false) { ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeText(s, x, y); }
      ctx.fillStyle = o.col || DK.ink; ctx.fillText(s, x, y);
    }
    function floor(S, alpha) {
      const g = Math.min(d.R * 0.9, d.fitW * 1.05), z0 = d.zmin - d.R * 0.04, c = d.center;
      ctx.save(); ctx.beginPath(); ctx.rect(S.x, S.y, S.w, S.h); ctx.clip();
      for (let k = -4; k <= 4; k++) {
        const t = k / 4 * g;
        ctx.globalAlpha = alpha * (1 - Math.abs(k) / 5);
        seg(proj([c[0] + t, c[1] - g, z0], S), proj([c[0] + t, c[1] + g, z0], S), DK.grid, 1);
        seg(proj([c[0] - g, c[1] + t, z0], S), proj([c[0] + g, c[1] + t, z0], S), DK.grid, 1);
      }
      ctx.restore();
    }
    // a cubic from a patch on the frame to a keypoint in the 3-D panel; every curve funnels through the gap between them
    function fiber(h, p, F) {
      const X = F.x + F.w, Ym = F.y + F.h / 2, gx = p[0] - X;
      return [h, [Math.max(h[0] + 40, X + gx * 0.22), lerp(h[1], Ym, 0.75)], [X + gx * 0.62, p[1]], p];
    }
    const bez = (C, t) => { const m = 1 - t; return [0, 1].map(j => m * m * m * C[0][j] + 3 * m * m * t * C[1][j] + 3 * m * t * t * C[2][j] + t * t * t * C[3][j]); };
    function curve(C, t1, col, w, a) {
      ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      const n = Math.max(2, Math.ceil(40 * t1));
      for (let i = 0; i <= n; i++) { const q = bez(C, t1 * i / n); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    function flow(C, seed, a) {
      for (let j = 0; j < 4; j++) {
        const t = (st.clk / 1200 + seed * 0.37 + j / 4) % 1, q = bez(C, t), f = a * Math.min(1, 4 * Math.sin(Math.PI * t));
        ctx.globalAlpha = 0.25 * f; dot(q, 6, DK.kiva);
        ctx.globalAlpha = f; dot(q, 2.4, "#e6f7ff");
      }
      ctx.globalAlpha = 1;
    }
    // mean skeleton at frame i; boneCol(j) colors rigid bone j (null = neutral)
    function skel(i, S, o = {}) {
      const P = d.mean5[i], rigidSet = new Set(d.rigid.map(([a, b]) => a + "-" + b));
      ctx.lineCap = "round";
      d.drawn.forEach(([a, b]) => { if (!rigidSet.has(a + "-" + b)) seg(proj(P[a], S), proj(P[b], S), DK.ink3, 2); });
      const gap = d.robot === "single_arm" ? 3 : -1; // a1x_ee: wrist, palm, two fingertips; bone 3 is the fingertip gap
      d.rigid.forEach(([a, b], j) => { const c = o.boneCol ? o.boneCol(j) : null; seg(proj(P[a], S), proj(P[b], S), c || "#c9d5e3", j === gap ? 1.6 : c && o.wide === j ? 6.5 : 4.2, j === gap ? [4, 4] : null); });
      P.forEach((p, k) => dot(proj(p, S), o.hi === k ? 6.5 : 3.8, o.hi === k ? DK.kiva : "#0d1116", o.hi === k ? "#fff" : DK.ink));
    }

    /* ---------- one frame of the stage ---------- */
    function draw() {
      ctx.clearRect(0, 0, W, H);
      if (!d || !sprite) return;
      if (view.auto && !reduce && playing) { view.sw += 0.004 * speed; view.yaw = view.base + SWAY * Math.sin(view.sw); }
      const ph = st.ph, D = dur(ph), u = cl(st.t / D), det = detailed(), ts = tauShow();
      const ar = d.width / d.height;
      // the frame fills the stage for the first tokenization, then moves left to make room for the 3-D skeleton
      const F0 = contain(ar, 16, 52, W - 32, H - 68), F1 = contain(ar, 16, 56, W * 0.56 - 24, H * 0.5); F1.y = Math.max(56, H * 0.42 - F1.h / 2);
      const split = st.c === 0 && ph === "tok" && st.tau === 0 ? 0 : st.c === 0 && ph === "att" && st.tau === 0 ? ease(cl(st.t / 800)) : 1;
      const F = lerpR(F0, F1, split);
      const S = { x: W * 0.56 + 8, y: 44, w: W * 0.44 - 22, h: H - 60 };
      S.cx = S.x + S.w / 2; S.cy = F1.y + F1.h * 0.5; S.sc = Math.min(0.45 * S.w / d.fitW, 0.34 * S.h / d.fitH);
      const B = { x: 16, y: F1.y + F1.h + 22, w: W * 0.57 - 32, h: H - (F1.y + F1.h + 22) - 16 }; // panel under the frame
      frame(ts, F);
      const dimT = ph === "tok" ? 0.12 : ph === "att" ? 0.3 : ph === "cal" ? 0.6 : 0.45;
      ctx.fillStyle = `rgba(8,12,17,${dimT})`; ctx.fillRect(F.x, F.y, F.w, F.h);
      let pill = "", quick = !det && ph !== "adv" && ph !== "cal";

      if (ph === "tok") {
        const g = d.grid, n = Math.floor(cl(u * 1.6) * g);
        ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = 0; k <= n; k++) { const x = F.x + k * F.w / g, y = F.y + k * F.h / g; ctx.moveTo(x, F.y); ctx.lineTo(x, F.y + F.h * cl(u * 1.6)); ctx.moveTo(F.x, y); ctx.lineTo(F.x + F.w * cl(u * 1.6), y); }
        ctx.stroke();
        // a scan over the patches, row by row: each one becomes a token
        const scan = Math.floor(cl((u - 0.45) / 0.5) * g * g);
        if (u > 0.45) {
          ctx.fillStyle = "rgba(56,189,248,.28)";
          for (let i = 0; i < scan; i += 1) { if (i % g === 0 || i === scan - 1) { const r = Math.floor(i / g); ctx.fillRect(F.x, F.y + r * F.h / g, F.w * (r < Math.floor((scan - 1) / g) ? 1 : ((scan - 1) % g + 1) / g), F.h / g); } }
          const [x, y] = tokXY(Math.max(0, scan - 1), F);
          ctx.strokeStyle = DK.kiva; ctx.lineWidth = 2; ctx.strokeRect(x - F.w / g / 2, y - F.h / g / 2, F.w / g, F.h / g);
        }
        text(`${g} × ${g} = ${g * g} patch tokens`, F.x + 10, F.y + F.h - 12, { font: "600 13px 'IBM Plex Mono', monospace" });
        pill = "Patch tokens, 24 × 24";
      }
      if (ph !== "tok") floor(S, split * 0.6);
      if (ph === "att") {
        // one query at a time: its blur map on the frame, and a fibre from where it looks to the keypoint it becomes
        const QT = d.K * Q_MS, perQ = det && st.t < QT, qf = perQ ? st.t / Q_MS : d.K, k = perQ ? Math.floor(qf) : -1, qu = qf - Math.floor(qf);
        // queries whose keypoint barely moves when any patch is blurred (the fixed base) get no fibre
        const live = q => d.kpW[q] >= 0.4, ha = q => live(q) ? 0.82 : 0.35;
        if (k >= 0) {
          if (k > 0 && qu < 0.3) heat(d.attnK[k - 1], F, ha(k - 1) * (1 - qu / 0.3));
          heat(d.attnK[k], F, ha(k) * (k > 0 ? cl(qu / 0.3) : 1));
        } else heat(d.attnF[ts], F, 0.82 * (det ? cl((st.t - QT) / 600) : 1));
        const P = d.mean5[ts], at = sp => [F.x + sp[0] * F.w, F.y + sp[1] * F.h];
        // a glowing stream from a bright patch to a keypoint, drawn up to t1, with particles once complete
        const stream = (h, q, a, t1, seed) => {
          const C = fiber(h, proj(P[q], S), F);
          curve(C, t1, DK.kiva, 7, 0.16 * a); curve(C, t1, "#9fdcff", 1.5, 0.85 * a);
          if (t1 >= 1) flow(C, seed, a);
        };
        const ring = (h, v, a) => { ctx.globalAlpha = a; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(h[0], h[1], 4 + 6 * v, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; };
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
        if (k >= 0) {
          // this query: every bright blob of its map streams into its keypoint
          if (live(k)) { const g = ease(cl(qu / 0.5)); d.src[k].forEach((sp, j) => stream(at(sp), k, (0.45 + 0.55 * sp[2]) * split, g, k * 7 + j)); }
        } else {
          // all queries: every bright blob of the frame streams into the keypoints that read it
          const fin = det ? ease(cl((st.t - d.K * Q_MS) / 900)) : 1;
          frameSrc(ts).forEach((e, j) => stream(at(e.b), e.k, 0.35 + 0.65 * e.b[2] * e.v, fin, j));
        }
        ctx.restore();
        if (k >= 0 && live(k)) d.src[k].forEach(sp => ring(at(sp), sp[2], 0.5 + 0.5 * sp[2]));
        if (k < 0) { const seen = new Set(); frameSrc(ts).forEach(e => { if (!seen.has(e.b[3])) { seen.add(e.b[3]); ring(at(e.b), e.b[2], 0.4 + 0.6 * e.b[2]); } }); }
        ctx.globalAlpha = split; skel(ts, S, { hi: k });
        text(d.robot === "single_arm" ? "3-D gripper keypoints" : "3-D keypoints", S.cx, Math.min(S.y + S.h - 8, S.cy + d.fitH * S.sc + 30), { align: "center", col: DK.ink3, halo: false });
        ctx.globalAlpha = 1;
        if (k >= 0 && live(k)) {
          const p = proj(P[k], S);
          if (qu > 0.5) { ctx.globalAlpha = cl((qu - 0.5) / 0.2) * (1 - cl((qu - 0.75) / 0.25)); ctx.strokeStyle = DK.kiva; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p[0], p[1], 7 + 10 * cl((qu - 0.5) / 0.5), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
        }
        pill = k >= 0 ? `Query ${k + 1} of ${d.K}` : "All queries";
      }
      if (ph === "den") {
        // 0-37% denoise from noise, 37-54% hold the five runs, 54-70% collapse onto the mean, then hold it
        const noise = u < 0.37 ? (1 - u / 0.37) ** 1.3 : 0, merge = u < 0.54 ? 0 : u < 0.7 ? ease((u - 0.54) / 0.16) : 1;
        runs(ts, S, noise, merge);
        pill = u < 0.37 ? "Denoising, 5 runs from noise" : u < 0.54 ? "Five clean runs" : u < 0.7 ? "Averaging the runs" : "Mean of 5 runs";
        // noise level of the runs, drawn as five bars under the frame
        const bx = B.x, by = B.y + 18, bw = Math.min(B.w, 330);
        text("noise", bx, B.y + 6, { col: DK.ink2, base: "middle" });
        RUNC.forEach((c, n) => {
          const y = by + n * 16;
          ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(bx, y, bw - 70, 8);
          ctx.fillStyle = c; ctx.fillRect(bx, y, (bw - 70) * noise, 8);
          text(`run ${n + 1}`, bx + bw - 62, y + 8, { col: c, font: "500 11px 'IBM Plex Mono', monospace" });
        });
        if (merge > 0) text(`mean of 5 → P${merge >= 1 ? "" : "…"}`, bx, by + 5 * 16 + 14, { col: DK.ink, font: "600 12px 'IBM Plex Sans', sans-serif", base: "middle" });
      }
      if (ph === "rig" || ph === "adv" || ph === "cal") {
        const i = ts, thr = d.rigidity_threshold_mm, nb = d.rigid.length;
        // bones get measured one after another in the first check
        const shown = ph === "rig" && det ? Math.floor(cl(u / 0.55) * nb + 0.001) : nb;
        const wj = d.worstJ[i];
        const col = j => j < shown ? dkRamp(Math.abs(d.err[i][j]) / thr) : null;
        if (ph === "adv") trails(i, S);
        skel(i, S, { boneCol: col, wide: shown >= nb ? wj : -1 });
        if (ph === "rig" && det && shown < nb) {
          const [a, b] = d.rigid[shown] || d.rigid[nb - 1], P = d.mean5[i];
          const m = proj(P[a], S).map((v, t) => (v + proj(P[b], S)[t]) / 2);
          ctx.strokeStyle = DK.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(m[0], m[1], 14, 0, 7); ctx.stroke();
        }
        if (shown >= nb) { urdf(i, wj, S, ph !== "adv"); ruler(i, wj, B, ph === "rig" && det ? ease(cl((u - 0.55) / 0.3)) : 1); }
        pill = ph === "rig" ? (shown < nb ? `Bone ${shown + 1} of ${nb}` : "Worst bone") : pill;
        if (ph === "adv") {
          if (i >= 3) stencil(i, S, { ...B, y: B.y + 118 });
          pill = `Advancing to frame ${d.start + advTarget()}`;
        }
      }
      if (ph === "cal") { verdictCard(u); pill = "Compare with real video"; }

      const pe = f("phase"); if (pe.textContent !== pill) pe.textContent = pill;
      pe.classList.toggle("quick", quick);
      f("badge").textContent = `frame ${d.start + ts}`;
      f("t").textContent = `τ ${String(ts).padStart(2, " ")} / 15`;
      if (+f("scrub").value !== ts) f("scrub").value = ts;
      widgets(ts);
    }

    function runs(i, S, noise, merge) {
      const M = d.avg[i];
      const ab = Math.cos((noise + 0.008) / 1.008 * Math.PI / 2) ** 2, a = Math.sqrt(ab), b = Math.sqrt(1 - ab), sc = d.R * 0.9;
      const off = d.exag * (1 - merge);
      const P = d.draws.map((D, n) => D[i].map((p, k) => {
        const m = M[k], e = d.eps[n][i][k];
        return [0, 1, 2].map(j => { const v = m[j] + off * (p[j] - m[j]); return d.center[j] + a * (v - d.center[j]) + b * e[j] * sc; });
      }));
      const boneA = Math.max(0, 1 - noise / 0.3) * (1 - merge * 0.75);
      P.forEach((Q, n) => {
        if (boneA > 0) { ctx.globalAlpha = boneA; d.drawn.forEach(([x, y]) => seg(proj(Q[x], S), proj(Q[y], S), RUNC[n], 1.8)); }
        ctx.globalAlpha = noise > 0.3 ? 0.9 : 0.95 * (1 - merge * 0.6);
        Q.forEach(p => dot(proj(p, S), noise > 0.3 ? 2.4 : 2.8, RUNC[n]));
      });
      if (merge > 0) {
        ctx.globalAlpha = merge;
        d.drawn.forEach(([x, y]) => seg(proj(M[x], S), proj(M[y], S), DK.ink, 3.4));
        M.forEach(p => dot(proj(p, S), 3.2, "#0d1116", DK.ink));
      }
      ctx.globalAlpha = 1;
      if (merge < 1 && noise < 0.3) text(`offsets ×${d.exag}`, S.x + S.w / 2, S.y + S.h - 6, { align: "center", col: DK.ink2 });
    }
    // the URDF length laid along the worst bone, and the part that should not be there
    function urdf(i, j, S, label) {
      const [a, b] = d.rigid[j], P = d.mean5[i], L = d.rest_mm[j], e = d.err[i][j];
      const pa = P[a], pb = P[b], len = L + e, dir = [0, 1, 2].map(t => (pb[t] - pa[t]) / len);
      const end = [0, 1, 2].map(t => pa[t] + dir[t] * L);
      const A = proj(pa, S), E = proj(end, S), Bp = proj(pb, S);
      seg(A, E, "rgba(232,238,246,.95)", 1.6, [5, 4]);
      dot(E, 3.5, DK.ink);
      const bad = Math.abs(e) > d.rigidity_threshold_mm;
      const m = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2];
      if (label) text(`${e > 0 ? "+" : "−"}${Math.abs(e).toFixed(0)} mm`, m[0] + 10, m[1] - 10, { font: "700 14px 'IBM Plex Sans', sans-serif", col: bad ? DK.bad : DK.good });
    }
    // flat ruler under the frame: URDF length, the ±θ band real footage stays in, and what the reader measured
    function ruler(i, j, B, g) {
      const [a, b] = d.rigid[j], L = d.rest_mm[j], e = d.err[i][j], thr = d.rigidity_threshold_mm, len = L + e;
      const max = Math.max(len, L + 2 * thr) * 1.08, x0 = B.x, w = Math.min(B.w, 420), sx = v => x0 + w * v / max;
      const y = B.y + 56;
      text("worst bone", x0, B.y + 8, { col: DK.ink2, base: "middle" });
      ctx.fillStyle = "rgba(61,220,132,.22)"; ctx.fillRect(sx(L - thr), y - 16, sx(L + thr) - sx(L - thr), 40);
      ctx.fillStyle = "rgba(255,255,255,.10)"; ctx.fillRect(sx(0), y, sx(L) - sx(0), 8);
      ctx.fillStyle = dkRamp(Math.abs(e) / thr); ctx.fillRect(sx(0), y, (sx(len * g + L * (1 - g)) - sx(0)), 8);
      seg([sx(L), y - 18], [sx(L), y + 26], DK.ink, 1.4, [4, 3]);
      text(`URDF ${L.toFixed(0)} mm`, sx(L), y + 40, { align: "center", col: DK.ink, font: "500 11px 'IBM Plex Mono', monospace" });
      text(`±θ ${thr.toFixed(1)} mm`, sx(L), y - 22, { align: "center", col: DK.good, font: "500 11px 'IBM Plex Mono', monospace" });
      const mx = sx(len * g + L * (1 - g));
      dot([mx, y + 4], 4, dkRamp(Math.abs(e) / thr));
      if (g > 0.95) text(`measured ${len.toFixed(0)} mm`, Math.min(mx, x0 + w), y + 58, { align: len > L ? "right" : "left", col: dkRamp(Math.abs(e) / thr), font: "600 12px 'IBM Plex Mono', monospace" });
    }
    function trails(i, S) {
      const M = d.mean5;
      for (let k = 0; k < d.K; k++) {
        const hot = k === d.jerkKey;
        ctx.strokeStyle = hot ? DK.jerk : "rgba(169,184,201,.35)"; ctx.lineWidth = hot ? 2 : 1;
        ctx.beginPath(); for (let t = 0; t <= i; t++) { const q = proj(M[t][k], S); t ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } ctx.stroke();
      }
    }
    // the four-frame stencil on the jerkiest keypoint's trail, and its arithmetic under the frame
    function stencil(i, S, B) {
      const k = d.jerkKey, Wt = [-1, 3, -3, 1], ts = [i - 3, i - 2, i - 1, i];
      const pts = ts.map(t => proj(d.mean5[t][k], S));
      seg(pts[0], pts[3], "rgba(255,138,80,.5)", 1, [3, 3]);
      pts.forEach((q, n) => { dot(q, n === 3 ? 5.5 : 4, DK.jerk, "#fff"); text((Wt[n] > 0 ? "+" : "−") + Math.abs(Wt[n]), q[0] + 8, q[1] + (n % 2 ? 15 : -8), { col: DK.jerk, font: "600 12px 'IBM Plex Mono', monospace" }); });
      const x0 = B.x, y = B.y + 8;
      text("jerk", x0, y, { col: DK.ink2, base: "middle" });
      const bw = 64;
      ts.forEach((t, n) => {
        const x = x0 + n * (bw + 10);
        ctx.fillStyle = "rgba(255,138,80,.14)"; ctx.fillRect(x, y + 14, bw, 36);
        text((Wt[n] > 0 ? "+" : "−") + Math.abs(Wt[n]), x + bw / 2, y + 30, { align: "center", col: DK.jerk, font: "700 13px 'IBM Plex Mono', monospace" });
        text(`P(τ${t - i ? "−" + (i - t) : ""})`, x + bw / 2, y + 45, { align: "center", col: DK.ink2, font: "500 10.5px 'IBM Plex Mono', monospace" });
      });
      const r = d.jRatio[i];
      text(`= ${r < 0.01 ? r.toExponential(1) : r.toFixed(2)} × θ`, x0 + 4 * (bw + 10) + 4, y + 36, { col: r > 1 ? DK.bad : DK.ink, font: "700 14px 'IBM Plex Mono', monospace", base: "middle" });
    }
    function verdictCard(u) {
      const w = Math.min(470, W - 60), h = 176, x = (W - w) / 2, y = (H - h) / 2;
      ctx.fillStyle = DK.panel; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill(); ctx.stroke();
      const thr = d.rigidity_threshold_mm, line = (n, s, col, font) => { if (u > n * 0.14) text(s, x + 20, y + 34 + n * 27, { col, font: font || "500 13.5px 'IBM Plex Mono', monospace", halo: false }); };
      line(0, `median bone error  ${d.vRig.toFixed(1)} mm`, DK.ink);
      line(1, `÷ θ (real video)   ${thr.toFixed(1)} mm`, DK.ink2);
      if (d.robot === "single_arm") line(2, `rigidity ${d.sRigRe.toFixed(2)} · jerk ${d.sJerkRe.toFixed(2)} → max`, DK.ink);
      else line(2, `= ${d.sRigRe.toFixed(2)} (this re-read)`, DK.ink);
      line(3, `KIVA score ${d.kiva_ratio.toFixed(2)}`, DK.ink);
      if (u > 0.62) {
        const b = band(d.kiva_ratio, d.robot), c = b === "high" ? DK.bad : b === "med" ? DK.amber : DK.good;
        text(BAND_TXT[b], x + 20, y + h - 18, { col: c, font: "700 20px 'IBM Plex Sans', sans-serif", halo: false });
      }
    }

    /* ---------- side widgets: they fill in as frames are measured ---------- */
    let wKey = "";
    function widgets(ts) {
      const m = measured(), key = `${d.id}|${m}|${st.ph === "cal"}|${root.clientWidth}`;
      if (key === wKey) return; wKey = key;
      const thr = d.rigidity_threshold_mm, cut = CUTS[d.robot];
      // worst bone error per frame
      {
        const svg = f("wr"), w = svg.clientWidth || 288, h = 96, p = { l: 30, r: 6, t: 8, b: 16 };
        const ymax = Math.max(thr * 2, ...d.worst) * 1.1, xs = t => p.l + (w - p.l - p.r) * t / 15, ys = v => p.t + (h - p.t - p.b) * (1 - v / ymax);
        let s = `<rect x="${p.l}" y="${ys(ymax)}" width="${w - p.l - p.r}" height="${ys(thr) - ys(ymax)}" fill="var(--bad)" fill-opacity=".07"/>`;
        U.ticks(0, ymax, 3).forEach(t => { s += `<line x1="${p.l}" x2="${w - p.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="var(--stage-grid)"/><text x="${p.l - 4}" y="${ys(t) + 3}" font-size="9.5" fill="var(--stage-ink-3)" text-anchor="end">${U.fmt(t)}</text>`; });
        s += `<line x1="${p.l}" x2="${w - p.r}" y1="${ys(thr)}" y2="${ys(thr)}" stroke="var(--bad)" stroke-dasharray="4 3"/><text x="${w - p.r}" y="${ys(thr) - 3}" font-size="9.5" fill="var(--bad)" text-anchor="end">θ ${thr.toFixed(1)} mm</text>`;
        let path = "";
        for (let t = 0; t <= m; t++) { path += `${t ? "L" : "M"}${xs(t).toFixed(1)},${ys(d.worst[t]).toFixed(1)}`; }
        if (m >= 0) s += `<path d="${path}" fill="none" stroke="var(--rig)" stroke-width="1.8"/>` + Array.from({ length: m + 1 }, (_, t) => `<circle cx="${xs(t)}" cy="${ys(d.worst[t])}" r="2.3" fill="var(--rig)"/>`).join("");
        if (st.ph === "cal") s += `<line x1="${p.l}" x2="${w - p.r}" y1="${ys(d.vRig)}" y2="${ys(d.vRig)}" stroke="var(--stage-ink)" stroke-dasharray="2 3"/><text x="${p.l + 4}" y="${ys(d.vRig) - 4}" font-size="9.5" fill="var(--stage-ink)">median ${d.vRig.toFixed(0)} mm</text>`;
        [0, 5, 10, 15].forEach(t => { s += `<text x="${xs(t)}" y="${h - 3}" font-size="9.5" fill="var(--stage-ink-3)" text-anchor="middle">${t}</text>`; });
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.style.height = h + "px"; svg.innerHTML = s;
        f("rv").textContent = m >= 0 ? `${d.worst[m].toFixed(0)} mm · τ ${m}` : "–";
      }
      // jerk per frame over its threshold
      {
        const svg = f("wj"), w = svg.clientWidth || 288, h = 70, p = { l: 30, r: 6, t: 6, b: 16 };
        const vals = d.jRatio.filter(v => v != null), ymax = Math.max(1.3, ...vals) * 1.1;
        const xs = t => p.l + (w - p.l - p.r) * t / 15, ys = v => p.t + (h - p.t - p.b) * (1 - v / ymax), bw = (w - p.l - p.r) / 16 * 0.6;
        let s = `<line x1="${p.l}" x2="${w - p.r}" y1="${ys(1)}" y2="${ys(1)}" stroke="var(--bad)" stroke-dasharray="4 3"/><text x="${w - p.r}" y="${ys(1) - 3}" font-size="9.5" fill="var(--bad)" text-anchor="end">real p95</text>`;
        s += `<line x1="${p.l}" x2="${w - p.r}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--stage-line)"/><text x="${p.l - 4}" y="${ys(0) + 3}" font-size="9.5" fill="var(--stage-ink-3)" text-anchor="end">0</text><text x="${p.l - 4}" y="${ys(1) + 3}" font-size="9.5" fill="var(--stage-ink-3)" text-anchor="end">1</text>`;
        let best = -1;
        for (let t = 3; t <= m; t++) { const v = d.jRatio[t]; if (best < 0 || v > d.jRatio[best]) best = t; s += `<rect x="${xs(t) - bw / 2}" y="${ys(v)}" width="${bw}" height="${ys(0) - ys(v)}" fill="var(--jerk)" opacity=".85"/>`; }
        if (best >= 0) s += `<rect x="${xs(best) - bw / 2 - 1.5}" y="${ys(d.jRatio[best]) - 1.5}" width="${bw + 3}" height="${ys(0) - ys(d.jRatio[best]) + 3}" fill="none" stroke="var(--stage-ink)" stroke-width="1.2"/>`;
        s += `<text x="${p.l}" y="${h - 3}" font-size="9.5" fill="var(--stage-ink-3)">needs 4 frames: starts at τ 3</text>`;
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.style.height = h + "px"; svg.innerHTML = s;
        f("jv").textContent = best >= 0 ? `max ${d.jRatio[best].toFixed(2)}` : "–";
      }
      // running score on the calibrated scale
      {
        const svg = f("ws"), w = svg.clientWidth || 288, h = 58, p = { l: 6, r: 10 };
        const vals = d.worst.slice(0, Math.max(0, m + 1));
        let sNow = vals.length ? U.median(vals) / thr : 0;
        if (d.robot === "single_arm") { const j = d.jRatio.slice(3, m + 1).filter(v => v != null); if (j.length) sNow = Math.max(sNow, Math.max(...j)); }
        const final = st.ph === "cal", s0 = final ? d.kiva_ratio : sNow;
        const xmax = Math.max(cut[1] * 1.8, d.kiva_ratio * 1.12, d.sRigRe * 1.05), xs = v => p.l + (w - p.l - p.r) * Math.min(v, xmax) / xmax, y = 22;
        let s = `<rect x="${xs(0)}" y="${y}" width="${xs(cut[0]) - xs(0)}" height="10" fill="var(--good-bg)"/><rect x="${xs(cut[0])}" y="${y}" width="${xs(cut[1]) - xs(cut[0])}" height="10" fill="var(--med-bg)"/><rect x="${xs(cut[1])}" y="${y}" width="${xs(xmax) - xs(cut[1])}" height="10" fill="var(--bad-bg)"/>`;
        s += `<text x="${xs(cut[0])}" y="${y + 22}" font-size="9.5" fill="var(--stage-ink-3)" text-anchor="middle">γ₁ ${cut[0]}</text><text x="${xs(cut[1])}" y="${y + 22}" font-size="9.5" fill="var(--stage-ink-3)" text-anchor="${xs(cut[1]) - xs(cut[0]) < 36 ? "start" : "middle"}" dx="${xs(cut[1]) - xs(cut[0]) < 36 ? 4 : 0}">γ₂ ${cut[1]}</text>`;
        if (m >= 0) {
          const b = band(s0, d.robot), c = b === "high" ? "var(--bad)" : b === "med" ? "var(--med)" : "var(--good)";
          s += `<line x1="${xs(s0)}" x2="${xs(s0)}" y1="${y - 6}" y2="${y + 16}" stroke="${c}" stroke-width="3"/><text x="${xs(s0)}" y="${y - 9}" font-size="10" font-weight="600" fill="${c}" text-anchor="${xs(s0) > w - 60 ? "end" : "middle"}">${final ? "stored" : "so far"} ${s0.toFixed(2)}</text>`;
        }
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.style.height = h + "px"; svg.innerHTML = s;
        const b = band(d.kiva_ratio, d.robot);
        f("sv").innerHTML = final ? `<span style="color:var(--${b === "high" ? "bad" : b === "med" ? "med" : "good"})">${BAND_TXT[b]}</span>` : m >= 0 ? `${sNow.toFixed(2)} so far` : "–";
      }
    }
    addEventListener("resize", U.debounce(() => { wKey = ""; }, 150));

    new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.1 }).observe(root);
    let last = performance.now();
    (function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(100, now - last); last = now;
      if (!visible || !d) return;
      if (playing) step(dt * speed);
      draw();
    })(last);
    show("halluc_severe");
  }

  document.addEventListener("DOMContentLoaded", () => { hero(); lab(); });
})();
