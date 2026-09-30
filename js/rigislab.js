/* RIGIS lab: replays the algorithm of Appendix B.2 on a rated multi-view clip. The stage holds the
   two views at one timestep and draws each step on them with the real VGGT-Ω outputs (depth maps,
   cameras, lifted points, residual maps); the side widgets fill as the timesteps advance. Full
   geometry exists at three keyframes per clip; the other timesteps replay their logged scores. */
(function () {
  const U = window.RW;
  // take(d, pct, R): one-sentence reading of the clip; numbers come from the rerun
  const CLIPS = [
    { id: "00096", label: "Bimanual", tag: "VLM missed", bad: true,
      take: (d, p, R) => `Camera 2 swings by up to <b>${Math.round(d.maxRot)}°</b> against camera 1. RIGIS: <b>${p} percentile</b>.` },
    { id: "00132", label: "Humanoid", tag: "VLM missed", bad: true,
      take: (d, p, R) => `Camera 2 drifts by up to <b>${Math.round(d.maxRot)}°</b>, pulling S<sub>pose</sub> to ${R.pose.toFixed(2)}. RIGIS: <b>${p} percentile</b>.` },
    { id: "00278", label: "Single-arm", tag: "VLM false alarm", bad: false,
      take: (d, p, R) => `The rig holds still (camera 2 moves ${Math.round(d.maxRot)}° at most) and the views agree. RIGIS: <b>${p} percentile</b>.` },
    { id: "00090", label: "Bimanual", tag: "clean", bad: false,
      take: (d, p, R) => `Camera 2 moves ${Math.round(d.maxRot)}° at most and the views agree. RIGIS: <b>${p} percentile</b>.` },
    { id: "00195", label: "Humanoid", tag: "clean", bad: false,
      take: (d, p, R) => `Camera 2 moves ${Math.round(d.maxRot)}° at most and S<sub>pose</sub> stays at ${R.pose.toFixed(2)}. RIGIS: <b>${p} percentile</b>.` },
  ];
  const T = U.tok;
  const HB = { 1: ["bad", "Bad"], 2: ["med", "Medium"], 3: ["good", "Good"] };
  const EMB = { bimanual: "bimanual", humanoid: "humanoid", single_arm: "single-arm" };
  const ord = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const f3 = x => x == null ? "–" : x.toFixed(3);
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = x => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const lerp = (a, b, u) => a + (b - a) * u;

  // brighter than the page tokens: they sit on the dark stage
  const C1 = "#b690e6", C2 = "#5ea9dc", INK = "#e8eef6", DIM = "#9aa7b8";
  const SANS = "'IBM Plex Sans', sans-serif", MONO = "'IBM Plex Mono', monospace";

  // one entry per step in the side list; phases of a keyframe run in this order
  const STEPS = [
    { ph: "depth", li: "Depth and a camera for each view", pill: "VGGT-Ω: depth and camera per view",
      eq: String.raw`\(D_v,\;(K_v, R_v, t_v) = \text{VGGT-}\Omega(I_1, I_2)\)` },
    { ph: "lift", li: "Lift both views into one 3-D cloud", pill: "Lift every pixel into 3-D",
      eq: String.raw`\(\mathbf X = R_v^{\top}\big(D_v(u)\,K_v^{-1}\tilde u - t_v\big)\)` },
    { ph: "reproj", li: "Render each view from the other camera", pill: "Render each view from the other camera",
      eq: String.raw`\(\Delta_X = \operatorname{RMSE}\big(I_v, \hat I_v\big),\quad \Delta_D = \overline{\lvert D_v - \hat D_v\rvert}\)` },
    { ph: "agree", li: "Score the timestep, s(1)·s(2)", pill: "Score this timestep",
      eq: String.raw`\(s(v) = \tfrac12\big[(1-\Delta_X) + (1-(\Delta_D/\tilde d)^2)\big],\quad \textstyle\prod_v s(v)\)` },
    { ph: "pose", li: "Track camera 2 against τ = 0", pill: "Has camera 2 moved?",
      eq: String.raw`\(S_{\text{ext}} = \tfrac12\big(e^{-\sigma_R/5} + e^{-\sigma_t}\big),\quad S_{\text{int}} = \tfrac1V\textstyle\sum_v e^{-\sigma_K}\)` },
    { ph: "combine", li: "Combine into S and rank", pill: "Combine into one score",
      eq: String.raw`\(S = \tfrac12\big(S_{\text{geo}} + S_{\text{pose}}\big),\quad S_{\text{geo}} = \tfrac1T\textstyle\sum_\tau \prod_v s(v)\)` },
  ];
  const SI = Object.fromEntries(STEPS.map((s, i) => [s.ph, i]));
  const KEY_MS = { depth: 1600, lift: 2400, reproj: 3200, agree: 3600, pose: 2000 };
  const QUICK_MS = { agree: 900, pose: 280 };
  const END_MS = 6500;

  const cache = {};
  const img = src => { if (!cache[src]) { const i = new Image(); i.src = src; cache[src] = i; } return cache[src]; };
  const all = fetch("data/rigis_all.json").then(r => r.json());

  function project(cam, p) {
    const R = cam.R, t = cam.t, K = cam.K;
    const x = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0];
    const y = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1];
    const z = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2];
    if (z <= 1e-6) return null;
    return [K[0][0] * x / z + K[0][2], K[1][1] * y / z + K[1][2]];
  }

  function prep(d, A) {
    const a = A.clips.find(c => c.id === d.id);
    const peers = A.clips.filter(c => c.e === a.e).map(c => c.S).sort((x, y) => x - y);
    d.human = a.h; d.vlm = a.v.gemma_cot || []; d.peers = peers;
    d.pct = peers.filter(x => x < a.S).length / peers.length;
    const fe = (A.featured || {})[d.id];
    d.why = fe && fe.rationale && fe.rationale["gemma/cot"] ? fe.rationale["gemma/cot"][0] : "";
    d.S = d.stored.S; d.emb = a.e;
    d.maxRot = Math.max(...d.frames.map(f => f.rotDeg[1] || 0));
    d.key.forEach(k => {
      const P = [];
      k.views.forEach(v => v.pts.forEach(p => P.push(p)));
      const med = i => { const s = P.map(p => p[i]).sort((x, y) => x - y); return s[s.length >> 1]; };
      k.c = [med(0), med(1), med(2)];
      const r = P.map(p => Math.hypot(p[0] - k.c[0], p[1] - k.c[1], p[2] - k.c[2])).sort((x, y) => x - y);
      const cams = k.views.map(v => Math.hypot(v.cam.C[0] - k.c[0], v.cam.C[1] - k.c[1], v.cam.C[2] - k.c[2]));
      k.R = Math.max(r[Math.floor(r.length * 0.95)] || 1, Math.max(...cams) * 0.8);
      k.views.forEach((v, vi) => {
        const c = v.cam, Rt = [[c.R[0][0], c.R[1][0], c.R[2][0]], [c.R[0][1], c.R[1][1], c.R[2][1]], [c.R[0][2], c.R[1][2], c.R[2][2]]];
        const mul = (M, x) => M.map(row => row[0] * x[0] + row[1] * x[1] + row[2] * x[2]);
        const K = c.K, dep = k.R * 0.3;
        v.C = c.C;
        v.corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, w]) => {
          const dw = mul(Rt, [(u - K[0][2]) / K[0][0], (w - K[1][2]) / K[1][1], 1]);
          return [c.C[0] + dw[0] * dep, c.C[1] + dw[1] * dep, c.C[2] + dw[2] * dep];
        });
        // where each lifted point sits in its own image and in the other camera's image
        const other = k.views[1 - vi].cam;
        v.own = v.pts.map(p => project(c, p) || [0.5, 0.5]);
        v.cross = v.pts.map(p => { const q = project(other, p); return q && q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1 ? q : null; });
        v.delay = v.pts.map((_, i) => ((i * 37 + vi * 11) % 100) / 100);
      });
    });
    d.frames.forEach(fr => { fr.k = d.key.find(k => k.tau === fr.tau) || null; });
    // the replay schedule: full steps at keyframes, logged scores only elsewhere
    const ev = [];
    d.frames.forEach((fr, i) => {
      if (fr.k) Object.entries(KEY_MS).forEach(([ph, du]) => ev.push({ i, ph, du }));
      else {
        if (fr.prod != null) ev.push({ i, ph: "agree", du: QUICK_MS.agree, q: true });
        ev.push({ i, ph: "pose", du: QUICK_MS.pose, q: true });
      }
    });
    ev.push({ i: d.frames.length - 1, ph: "combine", du: END_MS });
    let t = 0; ev.forEach(e => { e.t0 = t; t += e.du; });
    d.ev = ev; d.total = t;
    d.scored = d.frames.filter(f => f.prod != null);
    return d;
  }

  // grab the frame of every timestep from the clip once
  async function grab(d, alive, onFirst) {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = `assets/rigis/${d.id}.mp4`;
    await new Promise((res, rej) => { v.addEventListener("loadeddata", res, { once: true }); v.addEventListener("error", rej, { once: true }); });
    for (const fr of d.frames) {
      if (!alive()) return;
      await new Promise(res => { v.addEventListener("seeked", res, { once: true }); v.currentTime = Math.max(0.01, Math.min(d.dur - 0.05, fr.t + 0.25 / d.fps)); });
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0); fr.img = c;
      if (fr === d.frames[0]) onFirst();
    }
    v.removeAttribute("src"); v.load();
  }

  /* ---------- the stage ---------- */
  function Stage(cv) {
    const ctx = cv.getContext("2d");
    let W = 0, H = 0;
    function size() { const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    new ResizeObserver(size).observe(cv); size();

    function layout(d) {
      const pad = 14, top = 48, iw = (W - pad * 3) / 2, vw = d.width / 2, ih = iw * d.height / vw;
      const R = [{ x: pad, y: top, w: iw, h: ih }, { x: pad * 2 + iw, y: top, w: iw, h: ih }];
      const gy = top + ih + 14, G = { x: pad, y: gy, w: W - pad * 2, h: Math.max(160, H - gy - pad) };
      return { R, G };
    }
    function proj3(k, G, yaw) {
      const el = 0.42, s = Math.min(G.w * 0.4, G.h * 0.72), cx = G.x + G.w / 2, cy = G.y + G.h * 0.5;
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), ce = Math.cos(el), se = Math.sin(el);
      return p => {
        const x = (p[0] - k.c[0]) / k.R, y = (p[2] - k.c[2]) / k.R, z = -(p[1] - k.c[1]) / k.R;
        const X = x * cyw - y * syw, Y = x * syw + y * cyw, vz = z * ce - Y * se, dep = Y * ce + z * se, ps = 1 / (1 + dep * 0.18);
        return [cx + X * s * ps, cy - vz * s * ps, dep];
      };
    }
    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function tag(txt, x, y, col, align) {
      ctx.font = `600 11px ${SANS}`; const w = ctx.measureText(txt).width + 12;
      const x0 = align === "right" ? x - w : x;
      ctx.fillStyle = "rgba(6,10,16,.72)"; rr(x0, y, w, 20, 4); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(txt, x0 + 6, y + 14);
    }
    function view(fr, d, vi, R, a) {
      ctx.save(); rr(R.x, R.y, R.w, R.h, 6); ctx.clip();
      ctx.fillStyle = "#1a2230"; ctx.fillRect(R.x, R.y, R.w, R.h);
      if (fr.img) { ctx.globalAlpha = a; const vw = fr.img.width / 2; ctx.drawImage(fr.img, vi * vw, 0, vw, fr.img.height, R.x, R.y, R.w, R.h); }
      ctx.restore();
    }
    function overlayPng(src, R, a, wipe) {
      const im = img(src); if (!im.complete || !im.naturalWidth || a <= 0) return;
      ctx.save(); ctx.beginPath(); ctx.rect(R.x, R.y, R.w * wipe, R.h); ctx.clip(); ctx.globalAlpha = a; ctx.drawImage(im, R.x, R.y, R.w, R.h); ctx.restore();
      if (wipe < 1) { ctx.fillStyle = "#fff"; ctx.fillRect(R.x + R.w * wipe - 1, R.y, 2, R.h); }
    }
    function legend(R, stops, lo, hi) {
      const lw = 120, lx = R.x + R.w - lw - 12, ly = R.y + R.h - 12;
      ctx.fillStyle = "rgba(6,10,16,.72)"; ctx.fillRect(lx - 8, ly - 17, lw + 16, 24);
      const g = ctx.createLinearGradient(lx, 0, lx + lw, 0); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
      ctx.fillStyle = g; ctx.fillRect(lx, ly, lw, 4);
      ctx.font = `500 10px ${SANS}`; ctx.fillStyle = INK; ctx.fillText(lo, lx, ly - 5); ctx.textAlign = "right"; ctx.fillText(hi, lx + lw, ly - 5); ctx.textAlign = "left";
    }
    function frustum(P, v, col, a, label, dash) {
      const o = P(v.C), cs = v.corners.map(P);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash(dash || []);
      ctx.beginPath(); cs.forEach(q => { ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); });
      cs.concat([cs[0]]).forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(o[0], o[1], 3.5, 0, 7); ctx.fill();
      if (label) { ctx.font = `600 11px ${SANS}`; ctx.fillText(label, o[0] + 7, o[1] - 7); }
      ctx.restore();
    }
    function floor(P, k) {
      ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
      const gy = k.c[1] + k.R * 0.9;
      for (let i = -4; i <= 4; i++) {
        const a = P([k.c[0] + i * k.R * 0.3, gy, k.c[2] - k.R * 1.2]), b = P([k.c[0] + i * k.R * 0.3, gy, k.c[2] + k.R * 1.2]);
        const c = P([k.c[0] - k.R * 1.2, gy, k.c[2] + i * k.R * 0.3]), e = P([k.c[0] + k.R * 1.2, gy, k.c[2] + i * k.R * 0.3]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      }
    }
    function label(txt, x, y, col, align, font) {
      ctx.font = font || `500 11px ${SANS}`; ctx.fillStyle = col; ctx.textAlign = align || "left"; ctx.fillText(txt, x, y); ctx.textAlign = "left";
    }
    function bar(x, y, w, len, col, a) {
      ctx.globalAlpha = a * 0.5; ctx.fillStyle = "rgba(255,255,255,.12)"; rr(x, y, w, 12, 6); ctx.fill();
      ctx.globalAlpha = a; ctx.fillStyle = col; rr(x, y, Math.max(12, w * len), 12, 6); ctx.fill(); ctx.globalAlpha = 1;
    }
    // the per-timestep products so far, at the bottom of the 3-D panel; cur = draw this timestep's bar too
    function strip(d, fr, G, cur) {
      const F = d.scored, n = F.length, idx = F.indexOf(fr), v = F.map(f => f.prod);
      const lo = Math.max(0, Math.min(...v) - 0.03), hi = Math.min(1, Math.max(...v) + 0.01);
      const S = { x: G.x + 16, y: G.y + G.h - 62, w: G.w - 32, h: 44 }, sw = S.w / n;
      const bh = x => 3 + (S.h - 3) * (x - lo) / (hi - lo);
      ctx.fillStyle = "rgba(13,17,22,.85)"; rr(S.x - 8, S.y - 22, S.w + 16, S.h + 38, 6); ctx.fill();
      label("s(1)·s(2) per timestep", S.x, S.y - 8, DIM);
      F.forEach((f, i) => {
        if (i > idx || (i === idx && !cur)) { ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(S.x + i * sw + 1, S.y + S.h - 2, sw - 2, 2); return; }
        ctx.globalAlpha = i === idx ? 1 : 0.5; ctx.fillStyle = C1; ctx.fillRect(S.x + i * sw + 1, S.y + S.h - bh(f.prod), sw - 2, bh(f.prod)); ctx.globalAlpha = 1;
      });
      return { x: S.x + idx * sw + 1, y: S.y + S.h - bh(fr.prod), w: sw - 2, h: bh(fr.prod) };
    }
    // one timestep's score: color and depth agreement per view -> s(v) -> s(1)·s(2) -> into the strip.
    // A logged (non-keyframe) timestep starts from the s(v) bars.
    function scoreBuild(d, fr, L, u, quick) {
      const G = L.G, U = quick ? 0.5 + 0.5 * u : u, cw = Math.min(G.w * 0.26, 220);
      const grow = ease(clamp01(U / 0.26)), mrg = ease(clamp01((U - 0.3) / 0.16)), mid = ease(clamp01((U - 0.5) / 0.16));
      const mul = ease(clamp01((U - 0.62) / 0.1)), drop = ease(clamp01((U - 0.76) / 0.2));
      ctx.fillStyle = "rgba(18,25,37,.86)"; rr(G.x, G.y, G.w, G.h, 8); ctx.fill();
      const slot = strip(d, fr, G, drop >= 1);
      const y0 = G.y + 30, y1 = G.y + 56, yS = G.y + 92, yP = G.y + 112, xM = G.x + G.w / 2 - cw / 2;
      [0, 1].forEach(v => {
        const col = v ? C2 : C1, xL = G.x + G.w * (v ? 0.75 : 0.25) - cw / 2;
        if (mrg < 1) {
          const Rv = L.R[v], a = 1 - mrg;
          ctx.globalAlpha = 0.5 * a * grow; ctx.strokeStyle = col; ctx.setLineDash([3, 4]); ctx.beginPath();
          ctx.moveTo(Rv.x + Rv.w / 2, Rv.y + Rv.h); ctx.lineTo(xL + cw / 2, y0 - 12); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
          [[fr.sX[v], y0, "color"], [fr.sD[v], y1, "depth"]].forEach(([x, y, nm]) => {
            bar(xL, lerp(y, yS, mrg), cw, lerp(x, fr.s[v], mrg) * grow, col, 0.85);
            ctx.globalAlpha = a; label(nm, xL - 8, lerp(y, yS, mrg) + 10, DIM, "right");
            label(x.toFixed(2), xL + cw + 8, lerp(y, yS, mrg) + 10, INK, "left", `500 11px ${MONO}`); ctx.globalAlpha = 1;
          });
        } else {
          const x = lerp(xL, xM, mid), y = lerp(yS, v ? y1 : y0, mid), a = drop > 0 ? 1 - 0.6 * drop : 1;
          bar(x, y, cw, fr.s[v], col, a);
          ctx.globalAlpha = a; label(`s(${v + 1})`, x - 8, y + 10, col, "right", `600 11.5px ${MONO}`);
          label(fr.s[v].toFixed(3), x + cw + 8, y + 10, INK, "left", `500 11px ${MONO}`); ctx.globalAlpha = 1;
        }
      });
      if (mid <= 0) return;
      ctx.globalAlpha = mid; label("×", xM - 44, y0 + 26, INK, "center", `600 16px ${MONO}`); ctx.globalAlpha = 1;
      const len = lerp(fr.s[0], fr.prod, mul);
      if (drop < 1) {
        const from = { x: xM, y: yP + 14, w: cw * len, h: 14 };
        const r = { x: lerp(from.x, slot.x, drop), y: lerp(from.y, slot.y, drop), w: lerp(from.w, slot.w, drop), h: lerp(from.h, slot.h, drop) };
        ctx.globalAlpha = mid * 0.5; ctx.fillStyle = "rgba(255,255,255,.12)"; if (drop === 0) { rr(xM, yP + 14, cw, 14, 7); ctx.fill(); }
        ctx.globalAlpha = mid; ctx.fillStyle = C1; rr(r.x, r.y, Math.max(r.w, 3), r.h, Math.min(7, r.w / 2)); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = mid * (1 - drop * 0.4);
      label("=", xM - 44, yP + 26, INK, "center", `600 16px ${MONO}`);
      label(len.toFixed(3), xM + cw + 8, yP + 26, INK, "left", `700 15px ${MONO}`);
      ctx.globalAlpha = 1;
    }

    // points: 0 = in the image, 1 = in 3-D, 2 = in the other view's image
    function points(d, k, L, P, from, to, u, alpha, onlyCross) {
      const items = [];
      k.views.forEach((v, vi) => {
        const Rs = L.R[vi], Ro = L.R[1 - vi], rs = Rs.w / 70;
        v.pts.forEach((p, i) => {
          if (onlyCross && !v.cross[i]) return;
          const e = ease(clamp01((u * 1.25 - v.delay[i] * 0.45) / 0.8));
          const at = s => s === 0 ? [Rs.x + v.own[i][0] * Rs.w, Rs.y + v.own[i][1] * Rs.h, 9] : s === 1 ? P(p) : [Ro.x + v.cross[i][0] * Ro.w, Ro.y + v.cross[i][1] * Ro.h, -9];
          const a = at(from), b = at(to);
          const land = to === 2 && e >= 1;
          items.push([lerp(a[2], b[2], e), lerp(a[0], b[0], e), lerp(a[1], b[1], e), `rgb(${p[3]},${p[4]},${p[5]})`, land ? rs : 2.2 + e * (to === 2 ? rs - 2.2 : 0)]);
        });
      });
      items.sort((a, b) => b[0] - a[0]);
      ctx.globalAlpha = alpha;
      items.forEach(([, x, y, col, r]) => { ctx.fillStyle = col; ctx.fillRect(x - r / 2, y - r / 2, r, r); });
      ctx.globalAlpha = 1;
    }

    function combine(d, u) {
      ctx.fillStyle = "rgba(9,12,18,.9)"; ctx.fillRect(0, 0, W, H);
      const R = d.recomputed, x0 = Math.max(40, W / 2 - 300), bx = x0 + 150, bw = Math.min(360, W - bx - 120);
      const rows = [["S_geo", R.geo, INK, "mean of ∏ s(v) over all timesteps"], ["S_ext", R.ext, C2, `σ_R ${R.sigmaRdeg.toFixed(1)}°, σ_t ${R.sigmaT.toFixed(2)}`], ["S_int", R.int, C2, "intrinsics drift"],
        ["S_pose", R.pose, INK, "½ (S_ext + S_int)"], ["S", R.S, C1, "½ (S_geo + S_pose)"]];
      ctx.font = `600 12px ${SANS}`;
      rows.forEach(([n, v, col, note], i) => {
        const a = clamp01((u * 6.5 - i * 0.9)), y = 64 + i * 46 + (i >= 3 ? 12 : 0) + (i >= 4 ? 12 : 0);
        if (a <= 0) return;
        ctx.globalAlpha = a;
        ctx.font = `${i === 4 ? 700 : 600} ${i === 4 ? 15 : 13}px ${MONO}`; ctx.fillStyle = i === 4 ? C1 : INK; ctx.textAlign = "right"; ctx.fillText(n, bx - 14, y + 11); ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,.08)"; rr(bx, y, bw, 14, 7); ctx.fill();
        ctx.fillStyle = col; rr(bx, y, Math.max(14, bw * v * ease(clamp01(a * 1.2))), 14, 7); ctx.fill();
        ctx.font = `500 13px ${MONO}`; ctx.fillStyle = INK; ctx.fillText(v.toFixed(3), bx + bw + 10, y + 12);
        if (i === 2 || i === 3) { ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.beginPath(); ctx.moveTo(bx - 70, y + 42); ctx.lineTo(bx + bw + 70, y + 42); ctx.stroke(); }
        ctx.globalAlpha = 1;
      });
      // rank among the rated clips of this robot
      const a = clamp01((u - 0.62) / 0.15); if (a <= 0) return;
      ctx.globalAlpha = a;
      const y0 = 64 + 4 * 46 + 24 + 70, sx0 = x0, sw = bx + bw + 60 - x0, lo = d.peers[0], hi = d.peers[d.peers.length - 1], sx = v => sx0 + sw * (v - lo) / (hi - lo);
      const t1 = d.peers[Math.floor(d.peers.length / 3)], t2 = d.peers[Math.floor(d.peers.length * 2 / 3)];
      [[sx0, sx(t1), T("--bad")], [sx(t1), sx(t2), T("--med")], [sx(t2), sx0 + sw, T("--good")]].forEach(([a0, a1, c]) => { ctx.fillStyle = c; ctx.globalAlpha = a * 0.35; ctx.fillRect(a0, y0, a1 - a0, 26); });
      ctx.globalAlpha = a; ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1;
      d.peers.forEach(v => { ctx.beginPath(); ctx.moveTo(sx(v), y0 + 5); ctx.lineTo(sx(v), y0 + 21); ctx.stroke(); });
      const m = clamp01((u - 0.72) / 0.12), mx = lerp(sx0 + sw / 2, sx(d.S), ease(m));
      ctx.strokeStyle = C1; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mx, y0 - 8); ctx.lineTo(mx, y0 + 34); ctx.stroke();
      if (m >= 1) {
        const rb = d.pct < 1 / 3 ? HB[1] : d.pct >= 2 / 3 ? HB[3] : HB[2];
        ctx.font = `600 14px ${SANS}`; ctx.fillStyle = INK; ctx.textAlign = "center";
        ctx.fillText(`${ord(Math.round(d.pct * 100))} percentile → ${rb[1]}`, Math.max(sx0 + 90, Math.min(sx0 + sw - 90, mx)), y0 - 16); ctx.textAlign = "left";
      }
      ctx.globalAlpha = 1;
    }

    return {
      draw(d, e, u, now) {
        if (!W) return;
        ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#0d1116"; ctx.fillRect(0, 0, W, H);
        const L = layout(d), fr = d.frames[e.i], ph = e.ph;
        let k = fr.k; if (!k) for (let j = e.i; j >= 0 && !k; j--) k = d.frames[j].k;
        const isKey = !!fr.k && !e.q;
        const yaw = -0.5 + 0.35 * Math.sin(now / 5000);
        const P = k ? proj3(k, L.G, yaw) : null;
        const dimImg = isKey && (ph === "lift" || ph === "pose") ? 0.4 : isKey && ph === "reproj" ? 0.55 : 1;
        L.R.forEach((R, vi) => view(fr, d, vi, R, dimImg));

        // 3-D panel
        const G = L.G;
        ctx.fillStyle = "#121925"; rr(G.x, G.y, G.w, G.h, 8); ctx.fill();
        ctx.save(); rr(G.x, G.y, G.w, G.h, 8); ctx.clip();
        if (!k) {
        } else {
          floor(P, k);
          const camA = isKey && ph === "depth" ? u : 1;
          if (isKey && ph === "lift") { /* points drawn after the clip ends, so they can leave the panel */ }
          else if (isKey && ph === "reproj") points(d, k, L, P, 1, 1, 0, 0.35, false);
          else if (!(isKey && ph === "depth")) points(d, k, L, P, 1, 1, 0, isKey ? (ph === "pose" ? 0.35 : 0.9) : 0.3, false);
          if (isKey && ph === "pose" || !isKey && ph === "pose") {
            d.key.filter(o => o.tau <= fr.tau && o !== k).forEach(o => frustum(P, o.views[1], C2, 0.45, `τ = ${o.tau}`, [4, 4]));
          }
          frustum(P, k.views[0], C1, camA * (isKey ? 1 : 0.6), "camera 1");
          frustum(P, k.views[1], C2, camA * (isKey ? 1 : 0.6), "camera 2");
        }
        ctx.restore();

        // step drawings on the views
        if (isKey && ph === "depth") {
          L.R.forEach((R, vi) => overlayPng(k.views[vi].depth, R, 0.85, clamp01(u / 0.7)));
          legend(L.R[1], ["#30123b", "#4686fb", "#1ae4b6", "#a2fc3c", "#fab435", "#e4460a", "#7a0403"], "near", "far");
        }
        if (isKey && ph === "lift") {
          L.R.forEach((R, vi) => overlayPng(k.views[vi].depth, R, 0.85 * (1 - clamp01(u * 3)), 1));
          points(d, k, L, P, 0, 1, clamp01(u / 0.8), 0.95, false);
        }
        if (isKey && ph === "reproj") {
          const fly = clamp01(u / 0.5), fade = clamp01((u - 0.6) / 0.2);
          if (fade < 1) points(d, k, L, P, 1, 2, fly, 0.92 * (1 - fade), true);
          if (fade > 0) {
            L.R.forEach((R, vi) => { view(fr, d, vi, R, lerp(0.55, 1, fade)); overlayPng(k.views[vi].resid, R, 0.7 * fade, 1); });
            legend(L.R[1], ["#6fcf5f", "#f5d547", "#ff4d3d"], "0", "≥ 20% depth error");
          }
        }
        if (isKey && (ph === "agree" || ph === "pose")) L.R.forEach((R, vi) => overlayPng(k.views[vi].resid, R, ph === "agree" ? 0.5 * (1 - u) : 0, 1));
        if (ph === "agree" && fr.prod != null) scoreBuild(d, fr, L, u, !!e.q);
        if (ph === "pose" && fr.prod != null) strip(d, fr, G, true);
        if (ph === "pose" && fr.rotDeg[1] != null) {
          const a = clamp01(u * (e.q ? 5 : 2.5)), big = fr.rotDeg[1] > 10;
          ctx.globalAlpha = a;
          tag(`camera 2 ↻ ${fr.rotDeg[1].toFixed(1)}°`, L.R[1].x + L.R[1].w - 8, L.R[1].y + 8, big ? "#ff8a7a" : C2, "right");
          ctx.globalAlpha = 1;
        }
        L.R.forEach((R, vi) => tag(`view ${vi + 1}`, R.x + 8, R.y + 8, vi ? C2 : C1));
        if (ph === "combine") combine(d, u);
      },
    };
  }

  /* ---------- side widgets ---------- */
  function wGeo(svg, d, doneN, cur) {
    const W = svg.clientWidth || 288, H = 64, F = d.scored, n = F.length;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const v = F.map(f => f.prod), lo = Math.max(0, Math.min(...v) - 0.03), hi = Math.min(1, Math.max(...v) + 0.01), bw = W / n;
    const ys = x => H - 12 - (H - 16) * (x - lo) / (hi - lo);
    let s = `<line x1="0" x2="${W}" y1="${H - 12}" y2="${H - 12}" stroke="var(--stage-line)"/>`;
    F.forEach((f, i) => {
      const on = i < doneN, c = f === cur;
      s += `<rect x="${i * bw + 1}" y="${on ? ys(f.prod) : H - 13}" width="${Math.max(1, bw - 2)}" height="${on ? H - 12 - ys(f.prod) : 1}" rx="1.5" fill="var(--rigis)" opacity="${c ? 1 : on ? 0.55 : 0.15}"/>`;
    });
    if (doneN >= n) { const m = v.reduce((a, b) => a + b, 0) / n; s += `<line x1="0" x2="${W}" y1="${ys(m)}" y2="${ys(m)}" stroke="var(--stage-ink)" stroke-dasharray="4 3"/><text x="2" y="${ys(m) - 4}" font-size="10" fill="var(--stage-ink)">mean ${m.toFixed(3)}</text>`; }
    s += `<text x="0" y="${H}" font-size="9.5" fill="var(--stage-ink-3)">τ ${F[0].tau}</text><text x="${W}" y="${H}" text-anchor="end" font-size="9.5" fill="var(--stage-ink-3)">τ ${F[n - 1].tau}</text>`;
    svg.innerHTML = s;
  }
  function wRot(svg, d, doneN) {
    const W = svg.clientWidth || 288, H = 64, F = d.frames, n = F.length, hi = Math.max(10, d.maxRot) * 1.1;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const xs = i => 4 + (W - 8) * i / Math.max(1, n - 1), ys = x => H - 12 - (H - 16) * x / hi;
    let s = `<line x1="0" x2="${W}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--stage-line)"/><line x1="0" x2="${W}" y1="${ys(hi / 1.1)}" y2="${ys(hi / 1.1)}" stroke="var(--stage-line)" stroke-dasharray="2 3"/><text x="2" y="${ys(hi / 1.1) - 3}" font-size="9.5" fill="var(--stage-ink-3)">${Math.round(hi / 1.1)}°</text>`;
    const pts = F.slice(0, doneN).map((f, i) => f.rotDeg[1] == null ? null : [xs(i), ys(f.rotDeg[1])]).filter(Boolean);
    if (pts.length) {
      s += `<polyline points="${pts.map(p => p.map(x => x.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--kiva)" stroke-width="2"/>`;
      const l = pts[pts.length - 1]; s += `<circle cx="${l[0]}" cy="${l[1]}" r="3.5" fill="var(--kiva)"/>`;
    }
    s += `<text x="0" y="${H}" font-size="9.5" fill="var(--stage-ink-3)">τ ${F[0].tau}</text><text x="${W}" y="${H}" text-anchor="end" font-size="9.5" fill="var(--stage-ink-3)">τ ${F[n - 1].tau}</text>`;
    svg.innerHTML = s;
  }
  function wS(svg, d, show) {
    const W = svg.clientWidth || 288, H = 34, lo = d.peers[0], hi = d.peers[d.peers.length - 1], sx = v => W * (v - lo) / (hi - lo);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const t1 = d.peers[Math.floor(d.peers.length / 3)], t2 = d.peers[Math.floor(d.peers.length * 2 / 3)];
    let s = `<rect x="0" y="6" width="${sx(t1)}" height="18" fill="var(--bad-bg)"/><rect x="${sx(t1)}" y="6" width="${sx(t2) - sx(t1)}" height="18" fill="var(--med-bg)"/><rect x="${sx(t2)}" y="6" width="${W - sx(t2)}" height="18" fill="var(--good-bg)"/>`;
    d.peers.forEach(v => { s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="9" y2="21" stroke="var(--stage-ink-3)" stroke-opacity=".6"/>`; });
    if (show) s += `<line x1="${sx(d.S)}" x2="${sx(d.S)}" y1="2" y2="28" stroke="var(--rigis)" stroke-width="3"/>`;
    s += `<text x="0" y="${H}" font-size="9.5" fill="var(--stage-ink-3)">${lo.toFixed(2)}</text><text x="${W}" y="${H}" text-anchor="end" font-size="9.5" fill="var(--stage-ink-3)">${hi.toFixed(2)}</text>`;
    svg.innerHTML = s;
  }

  function verdicts(root, d) {
    const set = (k, txt, why, wrong) => {
      const el = root.querySelector(`[data-v="${k}"]`);
      el.querySelector(".what").innerHTML = txt;
      if (why != null) el.querySelector(".why").textContent = why;
      el.classList.toggle("wrong", !!wrong);
    };
    const hb = HB[d.human];
    set("human", `<span class="pill ${hb[0]}">${hb[1]}</span>`, null, false);
    const mean = d.vlm.reduce((a, b) => a + b, 0) / (d.vlm.length || 1);
    set("vlm", d.vlm.map(v => `<span class="pill ${HB[v][0]}">${HB[v][1]}</span>`).join(""), d.why ? `“${d.why}”` : "", Math.round(mean) !== d.human);
    const rb = d.pct < 1 / 3 ? HB[1] : d.pct >= 2 / 3 ? HB[3] : HB[2];
    set("rigis", `<span class="pill ${rb[0]}">${rb[1]}</span>`, `S = ${d.S.toFixed(3)}, ${ord(Math.round(d.pct * 100))} percentile of ${d.peers.length} ${EMB[d.emb]} clips`, rb[0] !== hb[0]);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("rigisLab"); if (!root) return;
    const f = n => root.querySelector(`[data-f="${n}"]`);
    const stage = Stage(f("cv"));
    let d = null, T0 = 0, playing = !matchMedia("(prefers-reduced-motion: reduce)").matches, speed = 1, visible = false, loadN = 0, last = 0, ready = false, sig = "";

    f("picker").innerHTML = CLIPS.map(c => `<button type="button" data-id="${c.id}" aria-pressed="${c.id === CLIPS[0].id}"><span class="sw" style="background:${c.bad ? "var(--bad)" : c.tag === "clean" ? "var(--good)" : "var(--med)"}"></span>${c.label} · ${c.tag}</button>`).join("");
    f("picker").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) pick(b.dataset.id); });
    f("steps").innerHTML = STEPS.map((s, i) => `<li data-i="${i}"><span class="i">${i + 1}</span><span>${s.li}</span></li>`).join("");
    f("steps").addEventListener("click", e => {
      const li = e.target.closest("li"); if (!li || !d) return;
      const ph = STEPS[+li.dataset.i].ph, n = d.ev.length, c = cur().j;
      for (let s = 1; s <= n; s++) { const x = d.ev[(c + s) % n]; if (x.ph === ph && !x.q) { T0 = x.t0; break; } }
    });
    document.addEventListener("rw-rigis-open", e => { if (CLIPS.some(c => c.id === e.detail)) pick(e.detail); });

    function cur() {
      let j = 0; while (j < d.ev.length - 1 && d.ev[j + 1].t0 <= T0) j++;
      const e = d.ev[j]; return { j, e, u: clamp01((T0 - e.t0) / e.du) };
    }
    function setPlaying(on) {
      playing = on;
      f("play").classList.toggle("on", on);
      f("play").innerHTML = on ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg>Pause' : '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7-4.5z"/></svg>Play';
    }
    f("play").addEventListener("click", () => setPlaying(!playing));
    f("next").addEventListener("click", () => { if (!d) return; const { j } = cur(); T0 = j + 1 < d.ev.length ? d.ev[j + 1].t0 : 0; });
    U.seg(f("speed"), [{ k: "0.5", t: "0.5×" }, { k: "1", t: "1×" }, { k: "2", t: "2×" }, { k: "4", t: "4×" }], "1", k => { speed = +k; });
    f("scrub").addEventListener("input", e => { if (!d) return; const i = +e.target.value; const x = d.ev.find(v => v.i === i); if (x) T0 = x.t0; });

    async function pick(id) {
      const n = ++loadN; ready = false;
      f("picker").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.id === id));
      f("phase").textContent = "Loading";
      const [A, raw] = await Promise.all([all, fetch(`data/rigis_${id}.json`).then(r => r.json())]);
      if (n !== loadN) return;
      d = prep(raw, A); T0 = 0; sig = "";
      d.key.forEach(k => k.views.forEach(v => { img(v.depth); img(v.resid); }));
      f("scrub").max = d.frames.length - 1;
      f("nPeers").textContent = `${d.peers.length} ${EMB[d.emb]}`;
      verdicts(f("verdicts"), d);
      f("take").innerHTML = `<span class="lbl">This clip</span><span class="txt">${CLIPS.find(c => c.id === id).take(d, ord(Math.round(d.pct * 100)), d.recomputed)}</span>`;
      grab(d, () => n === loadN, () => { if (n === loadN) ready = true; }).catch(() => { ready = true; });
    }

    function side(e, u) {
      const step = SI[e.ph], fr = d.frames[e.i];
      const key = `${d.id}|${e.i}|${e.ph}|${e.q ? 1 : 0}|${e.ph === "combine" ? Math.floor(u * 4) : 0}`;
      if (key === sig) return; sig = key;
      f("steps").querySelectorAll("li").forEach((li, i) => { li.classList.toggle("on", i === step); li.classList.toggle("done", i < step); });
      if (f("eq").dataset.s !== String(step)) { f("eq").dataset.s = step; f("eq").innerHTML = STEPS[step].eq; U.typeset(f("eq")); }
      const pastAgree = e.ph === "pose" || e.ph === "combine" || (e.ph === "agree");
      const doneG = d.scored.filter(x => x.tau < fr.tau || (x.tau === fr.tau && pastAgree)).length;
      const doneR = e.ph === "pose" || e.ph === "combine" ? e.i + 1 : e.i;
      wGeo(f("wGeo"), d, doneG, pastAgree ? fr : null);
      wRot(f("wRot"), d, doneR);
      wS(f("wS"), d, e.ph === "combine" && u > 0.7);
      f("geoV").textContent = pastAgree && fr.prod != null ? fr.prod.toFixed(3) : "–";
      const lastRot = d.frames.slice(0, doneR).map(x => x.rotDeg[1]).filter(x => x != null).pop();
      f("rotV").textContent = lastRot != null ? `${lastRot.toFixed(1)}°` : "–";
      f("sV").textContent = e.ph === "combine" && u > 0.7 ? d.S.toFixed(3) : "–";
      const ph = f("phase");
      ph.textContent = e.q ? `τ = ${fr.tau}` : STEPS[step].pill;
      ph.classList.toggle("quick", !!e.q);
      f("badge").textContent = `τ = ${fr.tau} · ${fr.t.toFixed(1)} s${fr.k ? " · keyframe" : ""}`;
      f("tt").textContent = `${e.i + 1} / ${d.frames.length} timesteps`;
      if (document.activeElement !== f("scrub")) f("scrub").value = e.i;
    }

    new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.15 }).observe(root);
    (function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(100, now - (last || now)); last = now;
      if (!d || !visible || !ready) return;
      if (playing) { T0 += dt * speed; if (T0 >= d.total) T0 = 0; }
      const { e, u } = cur();
      side(e, u);
      stage.draw(d, e, u, now);
    })(performance.now());

    setPlaying(playing);
    pick(CLIPS[0].id);
  });
})();
