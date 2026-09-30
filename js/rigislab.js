/* RIGIS lab: real VGGT-Ω outputs (depth, cameras, residuals, per-timestep scores) for five rated
   multi-view clips, walked through the stages of Appendix B.2. */
(function () {
  const U = window.RW;
  // take(d, pct, R): one-sentence reading of the clip; numbers come from the rerun
  const CLIPS = [
    { id: "00096", label: "Bimanual", tag: "VLM missed", bad: true,
      take: (d, p, R) => `VGGT cannot find one steady pose for view 2: against view 1 it swings by up to <b>${Math.round(d.maxRot)}°</b> (σ<sub>R</sub> ${R.sigmaRdeg.toFixed(0)}°). RIGIS puts the clip in the <b>${p} percentile</b> of bimanual clips. <span class="ok">Human raters agree: bad.</span> <span class="no">Gemma rated it good in all 3 runs.</span>` },
    { id: "00132", label: "Humanoid", tag: "VLM missed", bad: true,
      take: (d, p, R) => `View 2 drifts by up to <b>${Math.round(d.maxRot)}°</b> against view 1, which pulls S<sub>pose</sub> down to ${R.pose.toFixed(2)}. RIGIS puts the clip in the <b>${p} percentile</b> of humanoid clips. <span class="ok">Human raters agree: bad.</span> <span class="no">Gemma rated it good, good and medium.</span>` },
    { id: "00278", label: "Single-arm", tag: "VLM false alarm", bad: false,
      take: (d, p, R) => `The rig holds still (view 2 moves at most ${Math.round(d.maxRot)}°) and the views agree, so RIGIS puts the clip in the <b>${p} percentile</b> of single-arm clips. <span class="ok">Human raters agree: good.</span> <span class="no">Gemma rated it bad in all 3 runs.</span>` },
    { id: "00090", label: "Bimanual", tag: "clean", bad: false,
      take: (d, p, R) => `View 2 moves at most ${Math.round(d.maxRot)}° and the views agree. RIGIS puts the clip in the <b>${p} percentile</b> of bimanual clips. <span class="ok">Human raters and Gemma agree: good.</span>` },
    { id: "00195", label: "Humanoid", tag: "clean", bad: false,
      take: (d, p, R) => `View 2 moves at most ${Math.round(d.maxRot)}° and S<sub>pose</sub> stays at ${R.pose.toFixed(2)}. RIGIS puts the clip in the <b>${p} percentile</b> of humanoid clips. <span class="ok">Human raters and Gemma agree: good.</span>` },
  ];
  // SVG strings take CSS variables; canvas drawing reads the resolved token each frame
  const V1 = "var(--rigis)", V2 = "var(--kiva)", INK = "var(--stage-ink-3)", GRID = "var(--stage-grid)", FG = "var(--stage-ink)";
  const T = U.tok;
  const HB = { 1: ["bad", "Bad"], 2: ["med", "Medium"], 3: ["good", "Good"] };
  const EMB = { bimanual: "bimanual", humanoid: "humanoid", single_arm: "single-arm" };
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ord = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const f3 = x => x == null ? "–" : x.toFixed(3);

  const STAGES = [
    {
      k: "lift", t: "Lift to 3-D", h: "Lift both views into 3-D",
      p: "At each timestep VGGT-Ω reads both views together and predicts a depth map and a camera for each. Unprojecting every pixel puts both views in one frame, anchored on view 1's camera.",
      eq: String.raw`\(\mathbf X = R_v^{\top}\big(D_v(u)\,K_v^{-1}\tilde u - t_v\big)\)`,
      plot: "Overlap: share of each view the other camera sees",
    },
    {
      k: "reproj", t: "Reproject", h: "Render each view from the other camera",
      p: "Points from both views are splatted into each camera with a z-buffer. Where the views overlap, the render should reproduce the view's own colors and depths. The map is the depth error on that overlap; pixels outside it are left clear.",
      eq: String.raw`\(\Delta_X = \operatorname{RMSE}\big(I_v, \hat I_v\big),\quad \Delta_D = \overline{\lvert D_v - \hat D_v\rvert}\)`,
      plot: "Reprojection error per view",
    },
    {
      k: "agree", t: "Agree", h: "Score agreement at every timestep",
      p: "Each view gets the mean of a color score and a depth score, and the two views multiply, so one bad view pulls the timestep down. On these clips depth agrees almost everywhere, and the color term carries most of the signal.",
      eq: String.raw`\(s(v) = \tfrac12\big[(1-\Delta_X) + (1-(\Delta_D/\tilde d)^2)\big],\quad S_{\text{geo}} = \tfrac1T\textstyle\sum_\tau \prod_v s(v)\)`,
      plot: "∏ᵥ s(v) per timestep",
    },
    {
      k: "pose", t: "Hold still", h: "Check that the rig holds still",
      p: "The cameras are bolted to the rig, so the pose VGGT recovers for view 2 relative to view 1 should stay where it started. RIGIS measures how far its rotation, translation and intrinsics wander over the rollout.",
      eq: String.raw`\(S_{\text{ext}} = \tfrac12\big(e^{-\sigma_R/5} + e^{-\sigma_t}\big),\quad S_{\text{int}} = \tfrac1V\textstyle\sum_v e^{-\sigma_K}\)`,
      plot: "View 2 rotation against τ = 0",
    },
    {
      k: "score", t: "Score", h: "Combine into one score",
      p: "Geometry and pose stability are averaged. The clip is then ranked against the other rated clips of its morphology.",
      eq: String.raw`\(S = \tfrac12\big(S_{\text{geo}} + S_{\text{pose}}\big),\quad S_{\text{pose}} = \tfrac12\big(S_{\text{ext}} + S_{\text{int}}\big)\)`,
      plot: "Score parts, and rank among rated clips",
    },
  ];
  const DWELL = [7500, 7500, 7000, 8000, 8000];

  const cache = {};
  const img = src => { if (!cache[src]) { const i = new Image(); i.src = src; cache[src] = i; } return cache[src]; };
  const all = fetch("data/rigis_all.json").then(r => r.json());

  function prep(d, A) {
    const a = A.clips.find(c => c.id === d.id);
    const peers = A.clips.filter(c => c.e === a.e).map(c => c.S).sort((x, y) => x - y);
    d.human = a.h; d.vlm = a.v.gemma_cot || []; d.peers = peers;
    d.pct = peers.filter(x => x < a.S).length / peers.length;
    const fe = (A.featured || {})[d.id];
    d.why = fe && fe.rationale && fe.rationale["gemma/cot"] ? fe.rationale["gemma/cot"][0] : "";
    d.S = d.stored.S; d.emb = a.e;
    d.maxRot = Math.max(...d.frames.map(f => f.rotDeg[1] || 0));
    // display frame: x right, z forward (becomes y), -y up
    d.key.forEach(k => {
      const P = [];
      k.views.forEach((v, vi) => v.pts.forEach(p => P.push(p)));
      const med = i => { const a = P.map(p => p[i]).sort((x, y) => x - y); return a[a.length >> 1]; };
      k.c = [med(0), med(1), med(2)];
      const r = P.map(p => Math.hypot(p[0] - k.c[0], p[1] - k.c[1], p[2] - k.c[2])).sort((x, y) => x - y);
      const cams = k.views.map(v => Math.hypot(v.cam.C[0] - k.c[0], v.cam.C[1] - k.c[1], v.cam.C[2] - k.c[2]));
      k.R = Math.max(r[Math.floor(r.length * 0.95)] || 1, Math.max(...cams) * 0.8);
      k.views.forEach(v => {
        const c = v.cam, Rt = [[c.R[0][0], c.R[1][0], c.R[2][0]], [c.R[0][1], c.R[1][1], c.R[2][1]], [c.R[0][2], c.R[1][2], c.R[2][2]]];
        const mul = (M, x) => M.map(row => row[0] * x[0] + row[1] * x[1] + row[2] * x[2]);
        const K = c.K, dep = k.R * 0.3;
        v.C = c.C;
        v.corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, w]) => {
          const dc = [(u - K[0][2]) / K[0][0], (w - K[1][2]) / K[1][1], 1];
          const dw = mul(Rt, dc);
          return [c.C[0] + dw[0] * dep, c.C[1] + dw[1] * dep, c.C[2] + dw[2] * dep];
        });
        v.up = mul(Rt, [0, -1, 0]);
      });
    });
    const byT = d.key.slice().sort((a, b) => a.t - b.t);
    d.keyOrder = byT;
    return d;
  }

  const ramp = r => U.ramp(Math.max(0, Math.min(1, r)) * 2);

  /* point cloud and the two cameras */
  function Cloud(cv) {
    const ctx = cv.getContext("2d");
    let W = 0, H = 0, yaw = -0.5, el = 0.42, drag = null, auto = true, lastUser = 0;
    function size() { const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    new ResizeObserver(size).observe(cv); size();
    cv.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY, yaw, el]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", e => { if (!drag) return; yaw = drag[2] + (e.clientX - drag[0]) * 0.008; el = Math.max(-0.2, Math.min(1.3, drag[3] + (e.clientY - drag[1]) * 0.006)); lastUser = performance.now(); });
    cv.addEventListener("pointerup", () => { drag = null; });
    function P(k, p) {
      // OpenCV (x right, y down, z forward) -> display (x, z, -y), centered and scaled
      const x = (p[0] - k.c[0]) / k.R, y = (p[2] - k.c[2]) / k.R, z = -(p[1] - k.c[1]) / k.R;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const X = x * cy - y * sy, Y = x * sy + y * cy;
      const vz = z * Math.cos(el) - Y * Math.sin(el), depth = Y * Math.cos(el) + z * Math.sin(el);
      const s = Math.min(W * 0.4, H * 0.36), persp = 1 / (1 + depth * 0.18);
      return [W / 2 + X * s * persp, H * 0.52 - vz * s * persp, depth];
    }
    function frustum(k, v, col, alpha, dash, label) {
      const o = P(k, v.C), cs = v.corners.map(c => P(k, c));
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []);
      ctx.beginPath(); cs.forEach(q => { ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); });
      cs.concat([cs[0]]).forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(o[0], o[1], 3.5, 0, 7); ctx.fill();
      if (label) { ctx.font = "600 11px 'IBM Plex Sans', sans-serif"; ctx.fillText(label, Math.max(4, Math.min(o[0] + 7, W - ctx.measureText(label).width - 4)), Math.max(14, o[1] - 7)); }
      ctx.restore();
    }
    return {
      draw(d, key, mode, t) {
        if (!W) return;
        if (!drag && performance.now() - lastUser > 2500) yaw += 0.0025;
        ctx.clearRect(0, 0, W, H);
        const k = key;
        // floor grid under the scene
        ctx.strokeStyle = T("--stage-grid"); ctx.lineWidth = 1;
        const gy = k.c[1] + k.R * 0.9;
        for (let i = -4; i <= 4; i++) {
          const a = P(k, [k.c[0] + i * k.R * 0.3, gy, k.c[2] - k.R * 1.2]), b = P(k, [k.c[0] + i * k.R * 0.3, gy, k.c[2] + k.R * 1.2]);
          const c = P(k, [k.c[0] - k.R * 1.2, gy, k.c[2] + i * k.R * 0.3]), e = P(k, [k.c[0] + k.R * 1.2, gy, k.c[2] + i * k.R * 0.3]);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
        }
        const lift = mode === "lift" ? Math.min(1, ((t % 5200) / 2600)) : 1;
        const items = [];
        k.views.forEach((v, vi) => v.pts.forEach((p, i) => {
          let q = p;
          if (lift < 1) {
            const u = Math.max(0, Math.min(1, lift * 1.6 - (i % 97) / 97 * 0.6)), e = 1 - (1 - u) ** 3;
            q = [v.C[0] + (p[0] - v.C[0]) * e, v.C[1] + (p[1] - v.C[1]) * e, v.C[2] + (p[2] - v.C[2]) * e];
          }
          const s = P(k, q);
          let col, a = 0.9, r = 1.7;
          if (mode === "reproj") { if (p[6] < 0) { col = T("--stage-ink-3"); a = 0.25; r = 1.2; } else { col = ramp(p[6]); r = 1.4 + p[6] * 1.6; } }
          else if (mode === "agree") { col = T(vi ? "--kiva" : "--rigis"); a = 0.75; }
          else { col = `rgb(${p[3]},${p[4]},${p[5]})`; if (mode === "pose") a = 0.4; }
          items.push([s[2], s[0], s[1], col, a, r]);
        }));
        items.sort((a, b) => b[0] - a[0]);
        items.forEach(([, x, y, col, a, r]) => { ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(x - r / 2, y - r / 2, r, r); });
        ctx.globalAlpha = 1;
        // rays from the other camera during reprojection
        if (mode === "reproj") {
          const ph = (t % 2400) / 2400, src = k.views[1], dst = k.views[0].pts;
          ctx.strokeStyle = T("--kiva"); ctx.lineWidth = 0.8;
          for (let i = 0; i < 26; i++) {
            const p = dst[(i * 61 + Math.floor(t / 2400) * 7) % dst.length]; if (p[6] < 0) continue;
            const a = P(k, src.C), b = P(k, p), u = Math.min(1, ph * 1.4);
            ctx.globalAlpha = 0.45 * (1 - ph); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        // cameras
        if (mode === "pose") {
          d.keyOrder.forEach(o => { if (o !== k) frustum(k, remap(o, k), T("--kiva"), 0.55, [4, 4], `t = ${o.t.toFixed(1)} s`); });
        }
        frustum(k, k.views[0], T("--rigis"), 1, null, "view 1");
        frustum(k, k.views[1], T("--kiva"), 1, null, mode === "pose" ? `view 2 · t = ${k.t.toFixed(1)} s` : "view 2");
      },
    };
  }
  // each timestep has its own frame anchored on view 1, so another keyframe's view-2 camera can be drawn in this one directly
  function remap(o) { return o.views[1]; }

  /* overlay of VGGT depth / residual maps on the video */
  function Overlay(cv, video) {
    const ctx = cv.getContext("2d");
    return {
      draw(d, key, mode, prog) {
        const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
        if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
        if (!(mode === "lift" || mode === "reproj") || !key) return;
        const vr = video.getBoundingClientRect(), ox = vr.left - r.left, oy = vr.top - r.top, w = vr.width / 2, h = vr.height;
        ctx.fillStyle = "rgba(6,10,16,.45)"; ctx.fillRect(ox, oy, vr.width * prog, h);
        key.views.forEach((v, vi) => {
          const im = img(mode === "lift" ? v.depth : v.resid); if (!im.complete || !im.naturalWidth) return;
          const x0 = ox + vi * w, clip = Math.max(0, Math.min(w, vr.width * prog - vi * w));
          if (clip <= 0) return;
          ctx.save(); ctx.beginPath(); ctx.rect(x0, oy, clip, h); ctx.clip(); ctx.globalAlpha = mode === "lift" ? 0.82 : 0.62;
          ctx.drawImage(im, x0, oy, w, h); ctx.restore();
        });
        if (prog < 1) { ctx.fillStyle = "#fff"; ctx.fillRect(ox + vr.width * prog - 1, oy, 2, h); }
        // legend
        const lw = mode === "lift" ? 110 : 190, lx = ox + vr.width - lw - 10, ly = oy + h - 16;
        ctx.fillStyle = "rgba(6,10,16,.7)"; ctx.fillRect(lx - 8, ly - 16, lw + 16, 24);
        const g = ctx.createLinearGradient(lx, 0, lx + lw, 0);
        (mode === "lift" ? ["#30123b", "#4686fb", "#1ae4b6", "#a2fc3c", "#fab435", "#e4460a", "#7a0403"] : ["#6fcf5f", "#f5d547", "#ff4d3d"]).forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
        ctx.fillStyle = g; ctx.fillRect(lx, ly, lw, 4);
        ctx.font = "500 10px 'IBM Plex Sans', sans-serif"; ctx.fillStyle = "#e8eef6";
        ctx.fillText(mode === "lift" ? "near" : "0", lx, ly - 4);
        ctx.textAlign = "right"; ctx.fillText(mode === "lift" ? "far" : "≥ 20% depth error (clear: no overlap)", lx + lw, ly - 4); ctx.textAlign = "left";
      },
    };
  }

  function plot(svg, d, st, t, key) {
    const W = svg.clientWidth || 500, H = 190, pad = { l: 40, r: 12, t: 12, b: 24 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const F = d.frames.filter(f => f.prod != null || st === "pose");
    const xs = v => pad.l + (W - pad.l - pad.r) * v / d.dur;
    let s = "";
    const axis = (lo, hi, fmt, n = 4) => {
      const ys = v => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
      U.ticks(lo, hi, n).forEach(v => { s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(v)}" y2="${ys(v)}" stroke="${GRID}"/><text x="${pad.l - 6}" y="${ys(v) + 3.5}" text-anchor="end" font-size="10" fill="${INK}" font-family="IBM Plex Mono">${fmt(v)}</text>`; });
      [0, d.dur / 2, d.dur].forEach(v => { s += `<text x="${xs(v)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="${INK}" font-family="IBM Plex Mono">${v.toFixed(1)} s</text>`; });
      return ys;
    };
    const line = (ys, get, col, dash) => {
      const pts = F.filter(f => get(f) != null).map(f => `${xs(f.t).toFixed(1)},${ys(get(f)).toFixed(1)}`);
      s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="4 3"' : ""}/>`;
      F.forEach(f => { if (get(f) != null) s += `<circle cx="${xs(f.t)}" cy="${ys(get(f))}" r="2.4" fill="${col}"/>`; });
    };
    const leg = items => { let x = pad.l + 8; items.forEach(([c, txt, dash]) => { s += `<line x1="${x}" x2="${x + 18}" y1="${pad.t + 6}" y2="${pad.t + 6}" stroke="${c}" stroke-width="2" ${dash ? 'stroke-dasharray="4 3"' : ""}/><text x="${x + 23}" y="${pad.t + 9.5}" font-size="10.5" fill="${FG}" font-family="IBM Plex Sans">${txt}</text>`; x += 34 + txt.length * 5.6; }); };
    let right = "";
    if (st === "lift") {
      const ys = axis(0, 1, v => Math.round(v * 100) + "%");
      line(ys, f => f.roi && f.roi[0], V1); line(ys, f => f.roi && f.roi[1], V2);
      leg([[V1, "view 1"], [V2, "view 2"]]);
      right = `keyframe ${Math.round(key.views[0].roiFrac * 100)}% / ${Math.round(key.views[1].roiFrac * 100)}%`;
    } else if (st === "reproj") {
      const hi = Math.max(0.25, ...F.flatMap(f => f.dX ? f.dX : [0])) * 1.15;
      const ys = axis(0, hi, v => v.toFixed(2));
      line(ys, f => f.dX && f.dX[0], V1); line(ys, f => f.dX && f.dX[1], V2);
      line(ys, f => f.dD && f.dD[0] / f.dRef[0], V1, true); line(ys, f => f.dD && f.dD[1] / f.dRef[1], V2, true);
      leg([[V1, "color Δₓ, view 1"], [V2, "view 2"], [FG, "depth Δ_D / d̃", true]]);
      right = "";
    } else if (st === "agree") {
      const v = F.map(f => f.prod), lo = Math.max(0, Math.min(...v) - 0.05), hi = Math.min(1, Math.max(...v) + 0.03);
      const ys = axis(lo, hi, x => x.toFixed(2));
      const bw = Math.max(3, (W - pad.l - pad.r) / F.length * 0.55);
      F.forEach(f => { s += `<rect x="${xs(f.t) - bw / 2}" y="${ys(f.prod)}" width="${bw}" height="${ys(lo) - ys(f.prod)}" rx="1.5" fill="${ramp((hi - f.prod) / (hi - lo))}" opacity=".9"/>`; });
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(m)}" y2="${ys(m)}" stroke="${FG}" stroke-dasharray="5 4"/><text x="${W - pad.r}" y="${ys(m) - 5}" text-anchor="end" font-size="10.5" font-weight="600" fill="${FG}" font-family="IBM Plex Sans">mean in this window ${m.toFixed(3)}</text>`;
      right = `S_geo over the full clip ${f3(d.recomputed.geo)}`;
    } else if (st === "pose") {
      const hi = Math.max(10, d.maxRot) * 1.12;
      const ys = axis(0, hi, x => Math.round(x) + "°");
      line(ys, f => f.rotDeg[1], V2);
      leg([[V2, "view 2 rotation"]]);
      right = `σ_R ${d.recomputed.sigmaRdeg.toFixed(1)}° · max ${Math.round(d.maxRot)}°`;
    } else {
      // score bars and the peer strip
      const rows = [["S_geo", d.recomputed.geo, FG], ["S_ext", d.recomputed.ext, V2], ["S_int", d.recomputed.int, V2], ["S_pose", d.recomputed.pose, FG], ["RIGIS S", d.recomputed.S, V1]];
      const bx = 64, bw = W - bx - 52;
      rows.forEach(([n, v, c], i) => {
        const y = 8 + i * 20;
        s += `<text x="${bx - 8}" y="${y + 10}" text-anchor="end" font-size="11" fill="${i === 4 ? FG : INK}" font-weight="${i === 4 ? 600 : 400}" font-family="IBM Plex Sans">${n}</text><rect x="${bx}" y="${y + 2}" width="${bw}" height="10" rx="5" fill="var(--stage-2)"/><rect class="grow" x="${bx}" y="${y + 2}" width="${bw * v}" height="10" rx="5" fill="${c}"/><text x="${bx + bw + 6}" y="${y + 11}" font-size="11" fill="${FG}" font-family="IBM Plex Mono">${v.toFixed(3)}</text>`;
      });
      const y0 = 132, lo = d.peers[0], hi = d.peers[d.peers.length - 1], sx = v => bx + bw * (v - lo) / (hi - lo);
      const t1 = d.peers[Math.floor(d.peers.length / 3)], t2 = d.peers[Math.floor(d.peers.length * 2 / 3)];
      s += `<rect x="${bx}" y="${y0}" width="${sx(t1) - bx}" height="22" fill="var(--bad-bg)"/><rect x="${sx(t1)}" y="${y0}" width="${sx(t2) - sx(t1)}" height="22" fill="var(--med-bg)"/><rect x="${sx(t2)}" y="${y0}" width="${bx + bw - sx(t2)}" height="22" fill="var(--good-bg)"/>`;
      d.peers.forEach(v => { s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${y0 + 4}" y2="${y0 + 18}" stroke="${INK}" stroke-opacity=".7"/>`; });
      s += `<line x1="${sx(d.S)}" x2="${sx(d.S)}" y1="${y0 - 4}" y2="${y0 + 26}" stroke="${FG}" stroke-width="3"/><text x="${Math.max(bx + 24, Math.min(bx + bw - 24, sx(d.S)))}" y="${y0 - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="${FG}" font-family="IBM Plex Sans">this clip</text>`;
      s += `<text x="${bx - 8}" y="${y0 + 15}" text-anchor="end" font-size="10.5" fill="${INK}" font-family="IBM Plex Sans">${d.peers.length} clips</text><text x="${bx}" y="${y0 + 40}" font-size="10" fill="${INK}" font-family="IBM Plex Mono">${lo.toFixed(2)}</text><text x="${bx + bw}" y="${y0 + 40}" text-anchor="end" font-size="10" fill="${INK}" font-family="IBM Plex Mono">${hi.toFixed(2)}</text>`;
      svg.innerHTML = s;
      return { right: `${ord(Math.round(d.pct * 100))} percentile of ${EMB[d.emb]} clips`, setT() {} };
    }
    // keyframe markers and playhead
    d.key.forEach(k => { s += `<path d="M${xs(k.t) - 4},${H - pad.b} l4,-6 l4,6z" fill="${k === key ? FG : INK}"/>`; });
    s += `<line data-ph x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="${FG}" stroke-opacity=".6"/>`;
    svg.innerHTML = s;
    const ph = svg.querySelector("[data-ph]");
    return { right, setT(tt) { const x = xs(Math.max(0, Math.min(d.dur, tt))); ph.setAttribute("x1", x); ph.setAttribute("x2", x); } };
  }

  function verdicts(root, d) {
    const set = (k, cls, txt, why, wrong) => {
      const el = root.querySelector(`[data-v="${k}"]`);
      el.querySelector(".what").innerHTML = txt;
      if (why != null) el.querySelector(".why").textContent = why;
      el.classList.toggle("wrong", !!wrong);
    };
    const hb = HB[d.human];
    set("human", hb[0], `<span class="pill ${hb[0]}">${hb[1]}</span>`, null, false);
    const mean = d.vlm.reduce((a, b) => a + b, 0) / (d.vlm.length || 1), vb = HB[Math.round(mean)] || HB[2];
    set("vlm", vb[0], d.vlm.map(v => `<span class="pill ${HB[v][0]}">${HB[v][1]}</span>`).join(""), d.why ? `“${d.why}”` : "", Math.round(mean) !== d.human);
    const rb = d.pct < 1 / 3 ? HB[1] : d.pct >= 2 / 3 ? HB[3] : HB[2];
    set("rigis", rb[0], `<span class="pill ${rb[0]}">${rb[1]}</span>`, `S = ${d.S.toFixed(3)}, ${ord(Math.round(d.pct * 100))} percentile of ${d.peers.length} ${EMB[d.emb]} clips`, rb[0] !== hb[0]);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("rigisLab"); if (!root) return;
    const f = n => root.querySelector(`[data-f="${n}"]`);
    const video = f("video"), cloud = Cloud(f("cloud")), ov = Overlay(f("ov"), video), stepsEl = f("steps");
    let d = null, key = null, stage = 0, stageT0 = performance.now(), userStep = false, playing = true, visible = false, ph = null, loadN = 0;

    f("picker").innerHTML = CLIPS.map(c => `<button type="button" data-id="${c.id}" aria-pressed="${c.id === CLIPS[0].id}"><span class="sw" style="background:${c.bad ? "var(--bad)" : c.tag === "clean" ? "var(--good)" : "var(--med)"}"></span>${c.label} · ${c.tag}</button>`).join("");
    f("picker").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) pick(b.dataset.id); });
    stepsEl.innerHTML = STAGES.map((s, k) => `<button type="button" role="tab" aria-selected="${k === 0}" data-k="${k}"><span class="i">${k + 1} / 5</span>${s.t}<span class="bar"></span></button>`).join("");
    stepsEl.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { userStep = true; setStage(+b.dataset.k); } });
    f("keys").addEventListener("click", e => { const b = e.target.closest("button[data-i]"); if (!b || !d) return; setKey(d.keyOrder[+b.dataset.i], true); });
    document.addEventListener("rw-rigis-open", e => { if (CLIPS.some(c => c.id === e.detail)) pick(e.detail); });

    const seek = t => { try { video.currentTime = Math.max(0, Math.min(d.dur - 0.05, t + 0.25 / d.fps)); } catch (_) { } };
    function setKey(k, doSeek) {
      key = k;
      f("keys").querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", d.keyOrder[i] === k));
      if (doSeek) seek(k.t);
      renderPlot(); chips();
    }
    function still() { return STAGES[stage].k === "lift" || STAGES[stage].k === "reproj"; }
    function setStage(k) {
      stage = k; stageT0 = performance.now();
      stepsEl.querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-selected", j === k));
      const s = STAGES[k];
      f("h").textContent = s.h;
      f("p").textContent = s.p + (s.k === "pose" && d ? ` In this clip view 2 turns by up to ${Math.round(d.maxRot)}° against view 1.` : "");
      f("eq").innerHTML = s.eq; U.typeset(f("eq"));
      f("plotT").textContent = s.plot;
      f("cloudtag").textContent = s.k === "reproj" ? "Points colored by depth error on the overlap" : s.k === "agree" ? "Points colored by view" : s.k === "pose" ? "View 2 camera at the three keyframes" : "VGGT-Ω point cloud · drag to rotate";
      if (d) {
        if (still()) { if (!key) key = d.key.find(x => x.label === "worst"); video.pause(); seek(key.t); }
        else if (playing && visible) video.play().catch(() => {});
      }
      renderPlot(); chips();
    }
    function chips() {
      if (!d || !key) return;
      const s = STAGES[stage].k, v1 = key.views[0], v2 = key.views[1], R = d.recomputed;
      const c = {
        lift: [["keyframe", `t = ${key.t.toFixed(1)} s`], ["VGGT input", `${key.imgSize[0]}×${key.imgSize[1]}`], ["points shown", `${v1.nPts} + ${v2.nPts}`]],
        reproj: [["Δₓ view 1", v1.sX != null ? (1 - v1.sX).toFixed(3) : "–"], ["Δₓ view 2", v2.sX != null ? (1 - v2.sX).toFixed(3) : "–"], ["s_D", `${f3(v1.sD)} / ${f3(v2.sD)}`]],
        agree: [["s(v) at keyframe", `${f3(v1.s)} · ${f3(v2.s)}`], ["∏ᵥ s(v)", f3(key.prod)], ["S_geo", f3(R.geo)]],
        pose: [["σ_R", `${R.sigmaRdeg.toFixed(1)}°`], ["σ_t", R.sigmaT.toFixed(3)], ["S_ext", f3(R.ext)], ["S_int", f3(R.int)]],
        score: [["S_geo", f3(R.geo)], ["S_pose", f3(R.pose)], ["RIGIS", f3(R.S)], ["stored", f3(d.stored.S)]],
      }[s];
      f("chips").innerHTML = c.map(([a, b]) => `<span class="chip">${a} <b>${b}</b></span>`).join("");
    }
    function renderPlot() {
      if (!d || !key) return;
      ph = plot(f("plot"), d, STAGES[stage].k, video.currentTime, key);
      f("plotR").textContent = ph.right;
    }
    async function pick(id) {
      const n = ++loadN;
      f("picker").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.id === id));
      const [A, raw] = await Promise.all([all, fetch(`data/rigis_${id}.json`).then(r => r.json())]);
      if (n !== loadN) return;
      d = prep(raw, A);
      d.key.forEach(k => k.views.forEach(v => { img(v.depth); img(v.resid); }));
      key = d.key.find(x => x.label === "worst");
      f("keys").innerHTML = d.keyOrder.map((k, i) => `<button type="button" data-i="${i}" aria-pressed="${k === key}">${k.label} · ${k.t.toFixed(1)} s</button>`).join("");
      video.src = `assets/rigis/${id}.mp4`;
      video.addEventListener("loadeddata", () => { if (still()) seek(key.t); else if (playing && visible) video.play().catch(() => {}); }, { once: true });
      f("meta").textContent = `clip ${id} · ${d.fps} fps · ${d.frames.length} timesteps`;
      verdicts(f("verdicts"), d);
      f("take").innerHTML = `<span class="lbl">This clip</span><span class="txt">${CLIPS.find(c => c.id === id).take(d, ord(Math.round(d.pct * 100)), d.recomputed)}</span>`;
      setStage(stage);
    }
    function setPlaying(on) {
      playing = on;
      f("play").innerHTML = on ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7-4.5z"/></svg>';
      f("play").setAttribute("aria-label", on ? "Pause" : "Play");
      if (on && !still()) video.play().catch(() => {}); else video.pause();
    }
    f("play").addEventListener("click", () => setPlaying(!playing));
    f("scrub").addEventListener("input", e => {
      if (!d) return; userStep = true;
      setPlaying(false);
      seek(+e.target.value / 1000 * d.dur);
      const near = d.keyOrder.reduce((a, b) => Math.abs(b.t - video.currentTime) < Math.abs(a.t - video.currentTime) ? b : a);
      if (near !== key) setKey(near, false);
    });
    addEventListener("resize", U.debounce(renderPlot, 150));
    new IntersectionObserver(es => {
      visible = es[0].isIntersecting;
      if (visible && playing && !still()) video.play().catch(() => {}); else video.pause();
    }, { threshold: 0.15 }).observe(root);

    (function loop(now) {
      requestAnimationFrame(loop);
      if (!d || !key || !visible) return;
      const el = now - stageT0, s = STAGES[stage].k, t = video.currentTime;
      // keyframe follows the playhead while the clip plays
      if (!still() && !video.paused) {
        const near = d.keyOrder.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
        if (near !== key) setKey(near, false);
      }
      let tau = 0; d.frames.forEach((fr, i) => { if (fr.t <= t + 1e-3) tau = i; });
      f("fr").textContent = `τ = ${tau} · ${t.toFixed(1)} s`;
      if (document.activeElement !== f("scrub")) f("scrub").value = Math.round(t / d.dur * 1000);
      if (ph) ph.setT(t);
      const bar = stepsEl.querySelectorAll(".bar")[stage];
      if (!userStep && playing) {
        bar.style.width = Math.min(100, el / DWELL[stage] * 100) + "%";
        if (el > DWELL[stage]) { bar.style.width = "0"; setStage((stage + 1) % 5); }
      } else stepsEl.querySelectorAll(".bar").forEach(b => { b.style.width = "0"; });
      ov.draw(d, key, s, Math.min(1, el / 1400));
      cloud.draw(d, key, s, el);
    })(performance.now());

    pick(CLIPS[0].id);
  });
})();
