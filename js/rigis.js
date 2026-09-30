/* RIGIS explorer: the Appendix B.2 formulas on a two-camera schematic. Sliders set the
   per-view residuals and the camera drift; the canvas shows what those numbers mean. */
(function () {
  const U = window.RW;
  const PRESETS = [
    { k: "rig", t: "Consistent rig", v: { rX: 0.04, rD: 0.08, rR: 0.3, rT: 0.03, rK: 0.02 } },
    { k: "depth", t: "Views disagree", v: { rX: 0.16, rD: 0.38, rR: 0.6, rT: 0.06, rK: 0.05 } },
    { k: "drift", t: "Camera drifts", v: { rX: 0.07, rD: 0.12, rR: 6.5, rT: 0.55, rK: 0.35 } },
    { k: "halluc", t: "Both", v: { rX: 0.22, rD: 0.45, rR: 5, rT: 0.6, rK: 0.5 } },
  ];
  const ids = ["rX", "rD", "rR", "rT", "rK"];

  function scores(v) {
    const sX = 1 - v.rX, sD = 1 - v.rD * v.rD, sv = 0.5 * (sX + sD);
    const geo = sv * sv;                       // product over V = 2 views
    const ext = 0.5 * (Math.exp(-v.rR / 5) + Math.exp(-v.rT));
    const int = Math.exp(-v.rK);
    const pose = 0.5 * (ext + int);
    return { geo, ext, int, pose, S: 0.5 * (geo + pose) };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const cv = document.getElementById("rigisCanvas"); if (!cv) return;
    const ctx = cv.getContext("2d");
    const el = Object.fromEntries(ids.map(i => [i, document.getElementById(i)]));
    const bars = document.getElementById("rigisBars");
    bars.innerHTML = [["geo", "S_geo"], ["pose", "S_pose"], ["S", "RIGIS S"]].map(([k, t]) =>
      `<div class="r${k === "S" ? " total" : ""}"><span>${t.replace("_", " ")}</span><div class="track"><div class="fill" data-k="${k}"></div></div><output data-k="${k}"></output></div>`).join("");
    const val = () => Object.fromEntries(ids.map(i => [i, +el[i].value]));
    function update() {
      const v = val(), s = scores(v);
      ids.forEach(i => { el[i].nextElementSibling.textContent = (+el[i].value).toFixed(i === "rR" ? 1 : 2); });
      ["geo", "pose", "S"].forEach(k => {
        bars.querySelector(`.fill[data-k="${k}"]`).style.width = (s[k] * 100).toFixed(1) + "%";
        bars.querySelector(`output[data-k="${k}"]`).textContent = s[k].toFixed(3);
      });
    }
    U.seg(document.getElementById("rigisPresets"), PRESETS, "rig", k => { const p = PRESETS.find(x => x.k === k); ids.forEach(i => { el[i].value = p.v[i]; }); update(); });
    ids.forEach(i => { el[i].value = PRESETS[0].v[i]; el[i].addEventListener("input", update); });
    update();

    // scene: a table top with three objects, as a point set
    const pts = [];
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 520; i++) pts.push({ p: [(rnd() - 0.5) * 2.4, (rnd() - 0.5) * 1.4, 0], c: 0, n: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] });
    [[-0.6, -0.1, 0.35, 0.25, 0.5], [0.45, 0.25, 0.3, 0.3, 0.3], [0.1, -0.4, 0.18, 0.18, 0.7]].forEach(([x, y, w, d, h]) => {
      for (let i = 0; i < 160; i++) {
        const f = Math.floor(rnd() * 3), u = rnd() - 0.5, v = rnd() - 0.5;
        const p = f === 0 ? [x + u * w, y + v * d, h] : f === 1 ? [x + u * w, y - d / 2, rnd() * h] : [x + w / 2, y + u * d, rnd() * h];
        pts.push({ p, c: 1, n: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] });
      }
    });
    const cams = [{ pos: [-1.9, -1.6, 1.5], tok: "--rigis" }, { pos: [1.9, -1.5, 1.4], tok: "--kiva" }];

    let W = 0, H = 0;
    function size() { const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    new ResizeObserver(size).observe(cv); size();
    const yaw = -0.35, el0 = 0.55;
    function proj(p) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const x = p[0] * cy - p[1] * sy, y = p[0] * sy + p[1] * cy;
      const v = p[2] * Math.cos(el0) - y * Math.sin(el0);
      const s = Math.min(W / 5.4, H / 3.6);
      return [W / 2 + x * s, H * 0.6 - v * s];
    }
    const heat = r => U.ramp(Math.max(0, Math.min(1, r)) * 2);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(cv);
    (function loop(now) {
      requestAnimationFrame(loop);
      if (!visible || !W) return;
      const v = val(), t = reduce ? 0 : now / 1000;
      ctx.clearRect(0, 0, W, H);
      // table outline
      ctx.strokeStyle = U.tok("--stage-grid"); ctx.lineWidth = 1;
      ctx.beginPath(); [[-1.2, -0.7], [1.2, -0.7], [1.2, 0.7], [-1.2, 0.7], [-1.2, -0.7]].forEach(([x, y], i) => { const q = proj([x, y, 0]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke();
      // reprojected points: offset by depth error, colored by combined residual
      const r = Math.min(1, v.rX * 2.2 + v.rD * 1.3);
      pts.forEach((o, i) => {
        const wob = Math.sin(t * 1.3 + i) * 0.5 + 0.5;
        const off = v.rD * 0.5 * (o.c ? 1 : 0.4);
        const ghost = [o.p[0] + o.n[0] * off, o.p[1] + o.n[1] * off, Math.max(0, o.p[2] + o.n[2] * off)];
        const q = proj(o.p), g = proj(ghost);
        const res = Math.min(1, r * (0.5 + wob * (o.c ? 0.9 : 0.5)));
        if (off > 0.02) { ctx.strokeStyle = U.alpha("--ramp-2", .18); ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(g[0], g[1]); ctx.stroke(); }
        ctx.fillStyle = heat(res); ctx.globalAlpha = o.c ? 0.95 : 0.55;
        ctx.beginPath(); ctx.arc(g[0], g[1], o.c ? 1.9 : 1.4, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      });
      // cameras: anchor frustum (dashed) and current one, drifting with sigma_R, sigma_t, sigma_K
      cams.forEach((c, k) => {
        const ph = t * 0.9 + k * 2;
        const dr = v.rR / 57.3 * 2.2, dt = v.rT * 0.35, fov = 0.34 * (1 + v.rK * 0.8 * Math.sin(ph * 1.7));
        const pos = [c.pos[0] + dt * Math.sin(ph), c.pos[1] + dt * Math.cos(ph * 1.3), c.pos[2] + dt * 0.5 * Math.sin(ph * 0.7)];
        const look = [0, 0, 0.25], ang = dr * Math.sin(ph * 1.1);
        const frustum = (P, f, a) => {
          const fwd = look.map((x, i) => x - P[i]), L = Math.hypot(...fwd); const F = fwd.map(x => x / L);
          let R = [F[1], -F[0], 0]; const rl = Math.hypot(...R); R = R.map(x => x / rl);
          const Uv = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
          const ca = Math.cos(a), sa = Math.sin(a);
          const R2 = R.map((x, i) => x * ca + Uv[i] * sa), U2 = Uv.map((x, i) => x * ca - R[i] * sa);
          const d = 0.75;
          return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => P.map((x, i) => x + F[i] * d + R2[i] * sx * f * d * 1.3 + U2[i] * sy * f * d));
        };
        const draw = (P, f, a, dash, alpha) => {
          const cn = frustum(P, f, a), o = proj(P);
          ctx.setLineDash(dash); ctx.strokeStyle = U.tok(c.tok); ctx.globalAlpha = alpha; ctx.lineWidth = 1.4;
          ctx.beginPath(); cn.forEach(p => { const q = proj(p); ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); });
          cn.concat([cn[0]]).forEach((p, i) => { const q = proj(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        };
        draw(c.pos, 0.34, 0, [3, 4], 0.5);
        draw(pos, fov, ang, [], 1);
        const q = proj(pos); ctx.fillStyle = U.tok(c.tok); ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 7); ctx.fill();
        ctx.font = "500 11px 'IBM Plex Sans', sans-serif"; ctx.fillText(`view ${k + 1}`, q[0] + (k ? 8 : -46), q[1] - 8);
      });
      ctx.font = "500 11px 'IBM Plex Sans', sans-serif"; ctx.fillStyle = U.tok("--stage-ink-3");
      ctx.fillText("dashed: camera at τ = 0 (anchor)   dots: points reprojected across views, green → red by residual", 12, H - 12);
    })(performance.now());
  });
})();
