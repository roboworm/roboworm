/* Benchmark composition, world-model pipelines, human-alignment and acceleration charts. */
(function () {
  const U = window.RW, D = window.RW_DATA;
  const C = n => `var(--${n})`;
  const svgNS = "http://www.w3.org/2000/svg";
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  function tween(from, to, ms, fn) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { fn(to); return; }
    const t0 = performance.now();
    (function step(now) { const u = Math.min(1, (now - t0) / ms), e = 1 - (1 - u) ** 3; fn(from.map((v, i) => v + (to[i] - v) * e)); if (u < 1) requestAnimationFrame(step); })(t0);
  }

  /* ---------- Fig. 2 donuts ---------- */
  function donuts() {
    const el = document.getElementById("donuts"); if (!el) return;
    el.innerHTML = D.fig2.donuts.map(g => {
      const tot = g.parts.reduce((a, p) => a + p[1], 0);
      let a0 = -Math.PI / 2, arcs = "";
      g.parts.forEach(([n, v, c]) => {
        const a1 = a0 + v / tot * Math.PI * 2, r = 50, R = 60, big = a1 - a0 > Math.PI ? 1 : 0;
        const P = (a, rr) => `${62 + rr * Math.cos(a)},${62 + rr * Math.sin(a)}`;
        arcs += `<path d="M${P(a0 + 0.012, R)}A${R},${R} 0 ${big} 1 ${P(a1 - 0.012, R)}L${P(a1 - 0.012, r)}A${r},${r} 0 ${big} 0 ${P(a0 + 0.012, r)}Z" fill="${c}"><title>${esc(n)}: ${v}%</title></path>`;
        a0 = a1;
      });
      return `<div class="card donut"><h4>${g.title}</h4><svg viewBox="0 0 124 124" role="img" aria-label="${g.title}">${arcs}
        <text x="62" y="62" text-anchor="middle" font-family="STIX Two Text, serif" font-weight="600" font-size="20" fill="var(--ink)">${g.center}</text>
        <text x="62" y="78" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="9" fill="var(--ink-3)">${g.sub}</text></svg>
        <ul class="legend">${g.parts.map(([n, v, c]) => `<li><i style="background:${c}"></i><span>${n}</span><b>${v}%</b></li>`).join("")}</ul></div>`;
    }).join("");
    document.getElementById("robots").innerHTML = D.robots.map(r =>
      `<div class="card robot"><div class="m" style="color:${C(r.c)}">${r.morph}</div><div class="n">${r.name}</div><div class="d">${r.src}<br>${r.views}</div></div>`).join("");
    document.getElementById("families").innerHTML = D.families.map(f =>
      `<div class="card"><b style="color:${C(f.c)}">${f.name} <span class="mono" style="font-size:.8rem;color:var(--ink-3)">${f.share}% of rollouts</span></b>${f.how}<div style="margin-top:.5rem;color:var(--ink)">${f.members.join(" · ")}</div></div>`).join("");
  }

  /* ---------- §3.2 world-model pipelines (after Fig. 2) ---------- */
  const WM = {
    dreamgen: {
      t: "DreamGen", d: "Scalable general-purpose DiT (Cosmos, 2B / 14B). Image-to-video diffusion: an instruction and the initial frame produce the whole clip in one pass. Multi-view is rendered as a 2 × 2 tiled frame.",
      svg: () => box(20, 60, 130, 34, "Instruction", "nv") + box(20, 130, 130, 34, "Initial frame x₀", "nv") +
        box(250, 80, 190, 64, "World model", "wm", "image-to-video diffusion") +
        frames(520, 90, ["x̂₁", "x̂₂", "…", "x̂ₜ"], "Generated frames") +
        flow("M150,77 C200,77 205,100 250,104") + flow("M150,147 C200,147 205,124 250,120") + flow("M440,112 L520,112"),
    },
    dreamdojo: {
      t: "DreamDojo", d: "Action-conditioned DiT (Cosmos, 2B). Each step takes an action chunk and the latest frame and predicts the next k frames; the last one becomes the next input, so errors can compound with rollout depth.",
      svg: () => box(20, 55, 130, 34, "Action chunk", "nv") + box(20, 130, 130, 34, "Frame x̂ₜ", "nv") +
        box(250, 80, 190, 64, "World model", "wm", "autoregressive") +
        frames(520, 90, ["x̂ₜ₊₁", "x̂ₜ₊₂", "…", "x̂ₜ₊ₖ"], "Generated frames") +
        flow("M150,72 C200,72 205,100 250,104") + flow("M150,147 C200,147 205,124 250,120") + flow("M440,112 L520,112") +
        flow("M800,140 C800,205 85,210 85,164", "x̂ₜ₊ₖ becomes the next input", [440, 214]),
    },
    ctrl: {
      t: "Ctrl-World", d: "Spatio-temporal U-Net (Stable Diffusion, 1.5B) that generates synchronized views. A generalist policy reads the predicted views and emits the next N-step action chunk, with a memory of past frames: a policy-in-the-loop rollout.",
      svg: () => box(20, 30, 90, 30, "Instruction", "nv") + ["View 1", "View 2", "View 3"].map((v, i) => box(120 + i * 78, 30, 70, 30, v, "nv")).join("") +
        box(120, 100, 226, 36, "Generalist policy", "wm") + box(500, 100, 170, 36, "World model", "wm") + box(700, 165, 110, 30, "Memory", "lt") +
        ["Pred 1", "Pred 2", "Pred 3"].map((v, i) => box(500 + i * 78, 30, 70, 30, v, "nv")).join("") +
        flow("M233,60 L233,100") + flow("M346,118 L500,118", "N-step action chunk") + flow("M585,100 L585,60") + flow("M700,180 C640,180 610,160 600,136") +
        flow("M700,45 C860,45 860,210 420,210 C200,210 60,200 60,60", "rollout × N", [420, 225]),
    },
  };
  function box(x, y, w, h, t, kind, sub) {
    const fill = kind === "nv" ? "var(--navy)" : kind === "wm" ? "var(--surface)" : "var(--sunken)";
    const ink = kind === "nv" ? "var(--bg)" : "var(--ink)";
    const stroke = kind === "wm" ? "var(--navy)" : "none";
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      <text x="${x + w / 2}" y="${y + h / 2 + (sub ? -2 : 4.5)}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="${kind === "wm" ? 15 : 12.5}" font-weight="${kind === "wm" ? 600 : 500}" fill="${ink}">${t}</text>
      ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 15}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11" fill="var(--ink-3)">${sub}</text>` : ""}`;
  }
  function frames(x, y, labels, cap) {
    return `<rect x="${x - 10}" y="${y - 26}" width="${labels.length * 66 + 10}" height="72" rx="8" fill="none" stroke="var(--line)" stroke-dasharray="4 4"/>
      <text x="${x}" y="${y - 10}" font-family="IBM Plex Sans, sans-serif" font-size="11" fill="var(--ink-3)">${cap}</text>` +
      labels.map((l, i) => l === "…" ? `<text x="${x + i * 66 + 28}" y="${y + 28}" text-anchor="middle" fill="var(--ink-3)" font-size="16">…</text>` :
        `<rect class="gf" style="animation-delay:${i * 0.35}s" x="${x + i * 66}" y="${y}" width="56" height="36" rx="4" fill="var(--data)"/><text x="${x + i * 66 + 28}" y="${y + 23}" text-anchor="middle" font-family="STIX Two Text, serif" font-size="14" fill="#fff">${l}</text>`).join("");
  }
  let flowN = 0;
  // at = [x, y] marks a feedback loop; its label is set upright there, since the loop runs right to left
  function flow(d, label, at) {
    const id = "fl" + (flowN++), loop = !!at;
    const mid = !label ? "" : loop
      ? `<text x="${at[0]}" y="${at[1]}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11" fill="var(--audit)">${label}</text>`
      : `<text font-family="IBM Plex Sans, sans-serif" font-size="11" fill="var(--ink-3)" dy="-6"><textPath href="#${id}" startOffset="20%">${label}</textPath></text>`;
    return `<path id="${id}" d="${d}" fill="none" stroke="${loop ? "var(--audit)" : "var(--ink-3)"}" stroke-width="1.5" ${loop ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#arr${loop ? "O" : ""})"/>${mid}
      <circle r="3.5" fill="${loop ? "var(--audit)" : "var(--kiva)"}"><animateMotion dur="${loop ? 3.6 : 1.8}s" repeatCount="indefinite" path="${d}"/></circle>`;
  }
  function wm() {
    const svg = document.getElementById("wmSvg"); if (!svg) return;
    const defs = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10z" fill="var(--ink-3)"/></marker>
      <marker id="arrO" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10z" fill="var(--audit)"/></marker>
      <style>.gf{animation:gf 2.4s infinite both}@keyframes gf{0%,15%{opacity:.25}35%,100%{opacity:1}}@media (prefers-reduced-motion:reduce){.gf{animation:none}}</style></defs>`;
    const show = k => { flowN = 0; svg.innerHTML = defs + WM[k].svg(); document.getElementById("wmDesc").textContent = WM[k].d; };
    U.seg(document.getElementById("wmSeg"), Object.entries(WM).map(([k, v]) => ({ k, t: v.t })), "dreamgen", show);
    show("dreamgen");
  }

  /* ---------- Table 1 ---------- */
  function tab1() {
    const t = document.getElementById("tab1"); if (!t) return;
    const yn = v => v ? '<span class="y" aria-label="yes">✓</span>' : '<span class="n" aria-label="no">✗</span>';
    let h = `<thead><tr><th>Benchmark</th><th># Samples</th><th>Data sources</th><th>Morphologies</th><th>Multi-view</th><th>Long-horizon</th><th>Evaluator</th><th>Cross-view geometry</th><th>Speed-up audit</th></tr></thead><tbody>`;
    D.tab1.forEach(g => {
      h += `<tr class="grp"><td colspan="9">${g.group}</td></tr>`;
      g.rows.forEach(r => { h += `<tr${r[0] === "RoboWorM" ? ' class="ours"' : ""}><td>${r[0] === "RoboWorM" ? '<span class="mark">RoboWorM</span>' : r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${yn(r[4])}</td><td>${yn(r[5])}</td><td>${r[6]}</td><td>${yn(r[7])}</td><td>${yn(r[8])}</td></tr>`; });
    });
    t.innerHTML = h + "</tbody>";
  }

  /* ---------- RQ1 alignment bars ---------- */
  function align() {
    const svg = document.getElementById("alChart"); if (!svg) return;
    const st = { task: "physics", metric: "overlap", morph: 3 };
    const metrics = { physics: [["overlap", "Overlap %"], ["spearman", "Spearman ρ"]], multiview: [["spearman", "Spearman ρ"], ["rank", "Rank accuracy %"]] };
    let cur = null;
    function build() {
      const T = D.align[st.task], M = T[st.metric];
      const names = [...new Set(M.rows.filter(r => r[1] !== "ours").map(r => r[0]))];
      const W = svg.clientWidth || 800, rowH = 30, pad = { l: 150, r: 60, t: 22, b: 30 };
      const groups = names.map(n => [M.rows.find(r => r[0] === n && r[1] === "zs"), M.rows.find(r => r[0] === n && r[1] === "cot")]);
      const ours = M.rows.find(r => r[1] === "ours");
      const H = pad.t + groups.length * (rowH * 1.5) + rowH * 1.4 + pad.b;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.height = H + "px";
      const xs = v => pad.l + (W - pad.l - pad.r) * v / M.max;
      let s = "";
      U.ticks(0, M.max, 5).forEach(t => { s += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${pad.t - 6}" y2="${H - pad.b}" stroke="var(--line)"/><text x="${xs(t)}" y="${H - pad.b + 16}" text-anchor="middle" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono">${t}${M.unit === "%" ? "%" : ""}</text>`; });
      const bars = [];
      let y = pad.t;
      groups.forEach(([zs, cot]) => {
        s += `<text x="${pad.l - 10}" y="${y + rowH * 0.62}" text-anchor="end" font-size="13" fill="var(--ink-2)" font-family="IBM Plex Sans">${zs[0]}</text>`;
        [[zs, "vlm", 0], [cot, "vlm-cot", 1]].forEach(([r, c, k]) => {
          const yy = y + k * rowH * 0.62;
          s += `<rect data-b="${bars.length}" x="${pad.l}" y="${yy}" height="${rowH * 0.52}" width="0" rx="3" fill="${C(c)}"/><text data-l="${bars.length}" x="${pad.l}" y="${yy + rowH * 0.4}" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono"></text>`;
          bars.push(r[2]);
        });
        y += rowH * 1.5;
      });
      y += rowH * 0.2;
      s += `<text x="${pad.l - 10}" y="${y + rowH * 0.66}" text-anchor="end" font-size="14" font-weight="600" fill="var(--ink)" font-family="IBM Plex Sans">${ours[0]}</text>`;
      s += `<rect data-b="${bars.length}" x="${pad.l}" y="${y}" height="${rowH * 0.9}" width="0" rx="3" fill="${st.task === "physics" ? C("kiva") : C("rigis")}"/><text data-l="${bars.length}" x="${pad.l}" y="${y + rowH * 0.62}" font-size="13" font-weight="600" fill="var(--ink)" font-family="IBM Plex Mono"></text>`;
      bars.push(ours[2]);
      svg.innerHTML = s;
      const vals = bars.map(b => b[st.morph]);
      const from = cur && cur.length === vals.length ? cur : vals.map(() => 0);
      tween(from, vals, 700, v => {
        cur = v;
        v.forEach((x, i) => {
          const r = svg.querySelector(`[data-b="${i}"]`), l = svg.querySelector(`[data-l="${i}"]`);
          r.setAttribute("width", Math.max(0, xs(x) - pad.l));
          l.setAttribute("x", xs(x) + 6); l.textContent = M.unit === "%" ? x.toFixed(1) + "%" : x.toFixed(3);
        });
      });
    }
    const mseg = document.getElementById("alMetric");
    function metricSeg() { const m = metrics[st.task]; st.metric = m[0][0]; mseg.replaceWith(mseg.cloneNode(false)); const el = document.getElementById("alMetric"); U.seg(el, m.map(([k, t]) => ({ k, t })), st.metric, k => { st.metric = k; build(); }); }
    const morphSeg = () => { const el0 = document.getElementById("alMorph"), el = el0.cloneNode(false); el0.replaceWith(el); U.seg(el, D.align[st.task].morphs.map((t, k) => ({ k: String(k), t })), String(st.morph), k => { st.morph = +k; build(); }); };
    U.seg(document.getElementById("alTask"), [{ k: "physics", t: "Embodied physics (KIVA)" }, { k: "multiview", t: "Multi-view (RIGIS)" }], "physics", k => {
      st.task = k; st.morph = 3; cur = null; metricSeg(); morphSeg(); build();
    });
    metricSeg(); morphSeg(); build();
    addEventListener("resize", U.debounce(() => { cur = null; build(); }, 150));
    document.addEventListener("rw-theme", build);
  }

  /* ---------- RQ2 latency vs agreement ---------- */
  // One row per judge. Left: share of videos scored the same across runs. Right: seconds per video
  // second on a reversed log axis, so better is to the right in both columns. The replay shows each
  // VLM zero-shot (ring), slides it to its chain-of-thought run (diamond), then drops in KIVA and RIGIS.
  function latency() {
    const svg = document.getElementById("latChart"); if (!svg) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const AT = { rows: 0, cot: 900, cotDur: 1300, ours: 2500, oursDur: 700 }, END = 4000;
    let t0 = null, raf = 0;
    const ease = x => 1 - (1 - x) ** 3, cl = x => Math.max(0, Math.min(1, x));
    function draw(t) {
      const W = svg.clientWidth || 900, lab = 150, gap = 90, rh = 26, head = 30, blockGap = 18, top = 40;
      const cw = (W - lab - gap - 24) / 2, ax = lab, bx = lab + cw + gap;
      const xa = v => ax + cw * (v - 30) / 72;
      const xb = v => bx + cw * (Math.log10(25) - Math.log10(v)) / (Math.log10(25) - Math.log10(0.2));
      const tasks = [["physics", "kiva", "Embodied physics"], ["multiview", "rigis", "Multi-view"]];
      const H = top + tasks.length * (head + 5 * rh + blockGap) + 18;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.height = H + "px";
      const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" text-anchor="${o.a || "start"}" font-size="${o.fs || 11.5}" font-weight="${o.fw || 400}" fill="${o.c || "var(--ink-2)"}" fill-opacity="${o.o == null ? 1 : o.o}" font-family="${o.ff || "IBM Plex Sans"}">${s}</text>`;
      const rowsA = cl((t - AT.rows) / 600), cot = ease(cl((t - AT.cot) / AT.cotDur)), ours = cl((t - AT.ours) / AT.oursDur);
      const y0 = top, y1 = H - 22;
      // the better end of each column
      let s = `<defs><linearGradient id="latBest" x1="0" x2="1"><stop offset="0" stop-color="var(--good)" stop-opacity="0"/><stop offset="1" stop-color="var(--good)" stop-opacity=".12"/></linearGradient></defs>`;
      s += `<rect x="${xa(88)}" y="${y0}" width="${xa(102) - xa(88)}" height="${y1 - y0}" fill="url(#latBest)"/><rect x="${xb(0.6)}" y="${y0}" width="${xb(0.2) - xb(0.6)}" height="${y1 - y0}" fill="url(#latBest)"/>`;
      s += T(ax, 16, "Same score across runs", { fw: 600, c: "var(--ink)" }) + T(ax + cw, 16, "more stable →", { a: "end", c: "var(--good)", fw: 600 });
      s += T(bx, 16, "Seconds per video second (log)", { fw: 600, c: "var(--ink)" }) + T(bx + cw, 16, "faster →", { a: "end", c: "var(--good)", fw: 600 });
      [40, 60, 80, 100].forEach(v => { s += `<line x1="${xa(v)}" x2="${xa(v)}" y1="${y0}" y2="${y1}" stroke="var(--line)"/>` + T(xa(v), H - 4, v + "%", { a: "middle", fs: 11, c: "var(--ink-3)", ff: "IBM Plex Mono" }); });
      [20, 10, 5, 2, 1, 0.5, 0.2].forEach(v => { s += `<line x1="${xb(v)}" x2="${xb(v)}" y1="${y0}" y2="${y1}" stroke="var(--line)"/>` + T(xb(v), H - 4, v + "s", { a: "middle", fs: 11, c: "var(--ink-3)", ff: "IBM Plex Mono" }); });
      let y = top;
      tasks.forEach(([task, col, name]) => {
        const rows = D.latency[task], c = C(col);
        s += T(0, y + 18, name, { fw: 600, c, fs: 12.5 });
        y += head;
        const our = rows.find(r => r[1] === "ours"), vlms = rows.filter(r => r[1] === "zs").map(z => [z, rows.find(r => r[0] === z[0] && r[1] === "cot")]);
        const line = cy => `<line x1="${ax}" x2="${W - 24}" y1="${cy}" y2="${cy}" stroke="var(--line)" stroke-opacity=".6"/>`;
        // ours
        let cy = y + rh / 2;
        s += line(cy) + T(0, cy + 4, our[0].replace(" (ours)", ""), { fw: 700, c, o: 0.25 + 0.75 * ours });
        if (ours > 0) {
          const e = ease(ours), dy = (1 - e) * -26, pulse = cl((t - AT.ours - AT.oursDur) / 700);
          const tip = esc(`${our[0]} · deterministic · ${our[4]} s`);
          [xa(100), xb(our[4])].forEach(x => {
            s += `<g data-tip="${tip}" opacity="${e}"><circle cx="${x}" cy="${cy + dy}" r="7" fill="${c}"/>`;
            if (pulse > 0 && pulse < 1) s += `<circle cx="${x}" cy="${cy}" r="${7 + 16 * pulse}" fill="none" stroke="${c}" stroke-opacity="${1 - pulse}" stroke-width="2"/>`;
            s += `</g>`;
          });
          s += T(xa(100) - 26, cy + 4, "100%", { a: "end", fw: 700, c, ff: "IBM Plex Mono", fs: 11, o: e });
          s += T(xb(our[4]) - 26, cy + 4, our[4] + " s", { a: "end", fw: 700, c, ff: "IBM Plex Mono", fs: 11, o: e });
        }
        y += rh;
        vlms.forEach(([z, k], n) => {
          cy = y + rh / 2;
          const ra = cl(rowsA * 5 - n * 0.8);
          s += line(cy) + T(0, cy + 4, z[0], { o: ra });
          const tip = esc(`${z[0]} · ${name.toLowerCase()}<br>zero-shot: ${z[2]}% same, ${z[4]} s<br>+ CoT: ${k[2]}% same, ${k[4]} s`);
          [[xa(z[2]), xa(k[2])], [xb(z[4]), xb(k[4])]].forEach(([x0, x1]) => {
            const x = x0 + (x1 - x0) * cot, dir = Math.sign(x1 - x0);
            s += `<g data-tip="${tip}" opacity="${ra}">`;
            if (cot > 0 && Math.abs(x - x0) > 12) s += `<line x1="${x0 + dir * 6}" x2="${x - dir * 7}" y1="${cy}" y2="${cy}" stroke="${c}" stroke-opacity=".45" stroke-width="2"/>`;
            s += `<circle cx="${x0}" cy="${cy}" r="5" fill="var(--surface)" stroke="${c}" stroke-width="2" stroke-opacity="${cot > 0 ? 0.6 : 1}"/>`;
            if (cot > 0) s += `<rect x="${x - 5}" y="${cy - 5}" width="10" height="10" transform="rotate(45 ${x} ${cy})" fill="${c}" opacity="${cl(cot * 3)}"/>`;
            s += `</g>`;
          });
          y += rh;
        });
        y += blockGap;
      });
      const phase = t < AT.cot ? "VLM, zero-shot" : t < AT.ours ? "VLM + chain-of-thought" : "KIVA and RIGIS";
      svg.innerHTML = s;
      const st = svg.parentNode.querySelector(".lat-step"); if (st) st.textContent = phase;
    }
    function play() {
      cancelAnimationFrame(raf); t0 = null;
      if (reduce) { draw(END); return; }
      const f = now => { if (t0 == null) t0 = now; const t = now - t0; draw(t); if (t < END) raf = requestAnimationFrame(f); };
      raf = requestAnimationFrame(f);
    }
    draw(0);
    const card = svg.parentNode;
    card.insertAdjacentHTML("beforeend", `<div class="lat-bar"><span class="lat-step"></span><button type="button" class="lat-replay">Replay</button></div>`);
    card.querySelector(".lat-replay").addEventListener("click", play);
    let seen = false;
    new IntersectionObserver(es => { if (es[0].isIntersecting && !seen) { seen = true; play(); } }, { threshold: 0.4 }).observe(svg);
    addEventListener("resize", U.debounce(() => draw(t0 == null ? 0 : END), 150));
    tipHost(svg);
  }
  function tipHost(svg) {
    svg.addEventListener("pointermove", e => { const g = e.target.closest("[data-tip]"); if (g) U.tipShow(g.dataset.tip, e.clientX, e.clientY); else U.tipHide(); });
    svg.addEventListener("pointerleave", U.tipHide);
  }

  /* ---------- Table 2 ---------- */
  function tab2() {
    const t = document.getElementById("tab2"); if (!t || !D.tab2) return;
    const show = k => {
      const tr = D.tab2[k];
      let h = `<thead><tr><th rowspan="2">Morphology</th><th rowspan="2">Model</th><th rowspan="2">Size</th><th colspan="2" class="gl">Vis. integrity ↑</th><th colspan="2" class="gl">PSNR ↑</th><th colspan="2" class="gl">Text align. ↑</th><th colspan="2" class="gl">FVD ↓</th><th colspan="2" class="gl">${k === "mv" ? "RIGIS ↑" : "KIVA ↓"}</th></tr>
        <tr>${'<th class="gl">Mkv</th><th>Non-Mkv</th>'.repeat(5)}</tr></thead><tbody>`;
      const DEC = [2, 2, 2, 2, 1, 1, 0, 0, k === "mv" ? 3 : 1, k === "mv" ? 3 : 1];
      tr.forEach(r => {
        r.models.forEach((m, i) => {
          h += `<tr${i === 1 ? ' class="pair"' : ""}>${i === 0 ? `<td rowspan="2" class="morph">${r.morph}</td>` : ""}<td>${m.name}</td><td class="mono">${m.size}</td>${m.vals.map((v, j) => {
            const phys = j >= 8, cls = [m.bold[j] ? "best" : "", phys ? "phys" : "", j % 2 === 0 ? "gl" : ""].filter(Boolean).join(" ");
            return `<td class="${cls}">${v == null ? '<span class="n">N/A</span>' : v.toFixed(DEC[j])}</td>`;
          }).join("")}</tr>`;
        });
      });
      t.innerHTML = h + "</tbody>"; t.dataset.k = k;
    };
    U.seg(document.getElementById("t2Seg"), [{ k: "mv", t: "Multi-view tracks · RIGIS" }, { k: "sv", t: "Single-view tracks · KIVA" }], "mv", show);
    show("mv");
  }

  /* ---------- Table C4 depth ---------- */
  function depth() {
    const svg = document.getElementById("depthChart"); if (!svg || !D.depth) return;
    function draw() {
      const rows = D.depth, W = svg.clientWidth || 800, nar = W < 560, rowH = nar ? 62 : 44, pad = { l: nar ? 14 : 190, r: nar ? 56 : 70, t: nar ? 48 : 30, b: 34 };
      const H = pad.t + rows.length * rowH + pad.b;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.height = H + "px";
      const mx = Math.max(...rows.flatMap(r => [r.kMkv, r.kNon])) * 1.1;
      const xs = v => pad.l + (W - pad.l - pad.r) * v / mx;
      let s = "";
      U.ticks(0, mx, 5).forEach(t => { s += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${pad.t - 8}" y2="${H - pad.b}" stroke="var(--line)"/><text x="${xs(t)}" y="${H - pad.b + 16}" text-anchor="middle" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono">${t}%</text>`; });
      s += `<text x="${W - pad.r}" y="${nar ? pad.t - 12 : pad.t - 14}" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Sans">KIVA violation rate (lower is better)</text>`;
      rows.forEach((r, i) => {
        const y = pad.t + i * rowH + rowH / 2, up = r.kNon > r.kMkv;
        if (nar) s += `<text x="${pad.l}" y="${y - 14}" font-size="12.5" fill="var(--ink)" font-family="IBM Plex Sans">${r.emb} · ${r.model} <tspan fill="var(--ink-3)" font-family="IBM Plex Mono" font-size="10.5">depth ${r.dMkv} → ${r.dNon}</tspan></text>`;
        else s += `<text x="${pad.l - 12}" y="${y - 3}" text-anchor="end" font-size="13" fill="var(--ink)" font-family="IBM Plex Sans">${r.emb} · ${r.model}</text><text x="${pad.l - 12}" y="${y + 12}" text-anchor="end" font-size="10.5" fill="var(--ink-3)" font-family="IBM Plex Mono">depth ${r.dMkv} → ${r.dNon} chunks</text>`;
        s += `<line x1="${xs(r.kMkv)}" x2="${xs(r.kNon)}" y1="${y}" y2="${y}" stroke="${up ? "var(--bad)" : "var(--good)"}" stroke-width="3" stroke-opacity=".5"/>`;
        s += `<circle cx="${xs(r.kMkv)}" cy="${y}" r="6" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="2"><title>Markovian ${r.kMkv}%</title></circle>`;
        s += `<circle cx="${xs(r.kNon)}" cy="${y}" r="6" fill="${up ? "var(--bad)" : "var(--good)"}"><title>non-Markovian ${r.kNon}%</title></circle>`;
        s += `<text x="${Math.max(xs(r.kMkv), xs(r.kNon)) + 12}" y="${y + 4}" font-size="11.5" font-family="IBM Plex Mono" fill="${up ? "var(--bad)" : "var(--good)"}">${up ? "+" : ""}${(r.kNon - r.kMkv).toFixed(2)}</text>`;
      });
      s += `<g font-family="IBM Plex Sans" font-size="11" fill="var(--ink-2)"><circle cx="${pad.l + 6}" cy="${pad.t - (nar ? 36 : 18)}" r="5" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="2"/><text x="${pad.l + 16}" y="${pad.t - (nar ? 32 : 14)}">Markovian</text><circle cx="${pad.l + 96}" cy="${pad.t - (nar ? 36 : 18)}" r="5" fill="var(--ink-2)"/><text x="${pad.l + 106}" y="${pad.t - (nar ? 32 : 14)}">non-Markovian</text></g>`;
      svg.innerHTML = s;
    }
    draw(); addEventListener("resize", U.debounce(draw, 150));
  }

  /* ---------- §4.4 acceleration explorer ---------- */
  function accel() {
    const svg = document.getElementById("acScatter"); if (!svg || !D.accel) return;
    const FAM = { dense: "ink", cache: "accel", sparse: "data", token: "audit" };
    const st = { morph: "bimanual", track: "mv" };
    let pos = null;
    function panel() { return D.accel.find(p => p.morph === st.morph && p.track === st.track); }
    function draw() {
      const P = panel(); if (!P) return;
      const isK = st.track === "sv";
      const W = svg.clientWidth || 700, H = 380, pad = { l: 56, r: 24, t: 24, b: 46 };
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.height = H + "px";
      const pts = [];
      P.models.forEach((m, mi) => {
        const ok = m.methods.filter(x => x.speedup != null && x.metric != null);
        const top = ok.filter(x => x.fam !== "dense").sort((a, b) => b.speedup - a.speedup)[0];
        ok.forEach(x => pts.push({ ...x, model: m.name, mi, best: x === top }));
      });
      const xmax = Math.max(2.5, ...pts.map(p => p.speedup)) * 1.06;
      const ms = pts.map(p => p.metric).concat(P.real == null ? [] : [P.real]);
      let lo = Math.min(...ms), hi = Math.max(...ms); const padv = (hi - lo) * 0.12 || 0.05; lo -= padv; hi += padv;
      if (isK) lo = Math.max(0, lo);
      const xs = v => pad.l + (W - pad.l - pad.r) * (v - 0.8) / (xmax - 0.8);
      // y: better is up. RIGIS higher is better; KIVA lower is better
      const ys = v => isK ? pad.t + (H - pad.t - pad.b) * (v - lo) / (hi - lo) : pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
      let s = "";
      [1, 1.5, 2, 2.5, 3, 3.5].filter(t => t <= xmax).forEach(t => { s += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--line)"/><text x="${xs(t)}" y="${H - pad.b + 16}" text-anchor="middle" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono">${t}×</text>`; });
      U.ticks(lo, hi, 5).forEach(t => { s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${pad.l - 8}" y="${ys(t) + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono">${isK ? U.fmt(t) + "%" : t.toFixed(2)}</text>`; });
      if (P.real != null) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ys(P.real)}" y2="${ys(P.real)}" stroke="var(--ink-2)" stroke-dasharray="6 4"/><text x="${pad.l + 6}" y="${ys(P.real) - 5}" font-size="11" fill="var(--ink-2)" font-family="IBM Plex Sans">real video ${isK ? P.real + "%" : P.real}</text>`;
      s += `<text x="${(W + pad.l) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="var(--ink-2)" font-family="IBM Plex Sans">speed-up over dense →</text>`;
      s += `<text transform="translate(14 ${(H - pad.b + pad.t) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="var(--ink-2)" font-family="IBM Plex Sans">${isK ? "KIVA violation % (better ↑)" : "RIGIS (better ↑)"}</text>`;
      // dense level of each world model: points above it kept quality, points below lost it
      pts.filter(p => p.fam === "dense").forEach(p => { s += `<line x1="${xs(p.speedup)}" x2="${W - pad.r}" y1="${ys(p.metric)}" y2="${ys(p.metric)}" stroke="var(--ink-3)" stroke-opacity=".5" stroke-dasharray="${p.mi ? "2 3" : "8 3"}"/>`; });
      pts.forEach((p, i) => {
        const tip = `<b>${p.name}</b> on ${p.model}<br>${p.speedup.toFixed(2)}× · ${isK ? "KIVA " + p.metric + "%" : "RIGIS " + p.metric.toFixed(3)}${p.q != null ? " · retention Q " + p.q.toFixed(2) : ""}`;
        const x = xs(p.speedup), y = ys(p.metric), c = C(FAM[p.fam]);
        s += p.mi === 0 ? `<circle data-i="${i}" data-tip="${esc(tip)}" cx="${x}" cy="${y}" r="${p.fam === "dense" ? 7 : 6}" fill="${c}" stroke="var(--surface)" stroke-width="1.5"/>`
          : `<rect data-i="${i}" data-tip="${esc(tip)}" x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" transform="rotate(45 ${x} ${y})" fill="${c}" stroke="var(--surface)" stroke-width="1.5"/>`;
        if (p.fam === "dense" || p.best) s += `<text x="${x + 10}" y="${y - 8}" font-size="11" font-weight="600" fill="${c}" font-family="IBM Plex Sans">${p.fam === "dense" ? "Dense · " + p.model : p.name}</text>`;
      });
      svg.innerHTML = s;
      // animate points from previous positions
      const now = pts.map(p => [xs(p.speedup), ys(p.metric)]);
      if (pos && pos.length === now.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const els = [...svg.querySelectorAll("[data-i]")];
        tween(pos.flat(), now.flat(), 600, v => els.forEach((e, i) => {
          const x = v[i * 2], y = v[i * 2 + 1];
          if (e.tagName === "circle") { e.setAttribute("cx", x); e.setAttribute("cy", y); } else { e.setAttribute("x", x - 5.5); e.setAttribute("y", y - 5.5); e.setAttribute("transform", `rotate(45 ${x} ${y})`); }
        }));
      }
      pos = now;
      side(P, pts, isK);
    }
    function side(P, pts, isK) {
      const el = document.getElementById("acSide");
      const models = P.models.map((m, mi) => {
        const rows = m.methods.filter(x => x.speedup != null).map(x => {
          const w = Math.min(100, x.speedup / 3 * 100);
          return `<div style="display:grid;grid-template-columns:5.6rem minmax(0,1fr) 3rem 3.4rem;gap:.5rem;align-items:center;font:400 .78rem/1.2 var(--f-ui);margin-top:.28rem">
            <span style="color:var(--ink-2)">${x.name}</span><span style="height:8px;border-radius:4px;background:var(--sunken)"><span style="display:block;height:100%;width:${w}%;border-radius:4px;background:${C(FAM[x.fam])}"></span></span>
            <span class="mono num" style="text-align:right">${x.speedup.toFixed(2)}×</span><span class="mono num" style="text-align:right;color:var(--ink-3)">${x.metric == null ? "–" : isK ? x.metric + "%" : x.metric.toFixed(3)}</span></div>`;
        }).join("");
        return `<div style="margin-top:${mi ? "1rem" : 0}"><div style="font:600 .74rem/1 var(--f-ui);letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3)">${mi ? "◆" : "●"} ${m.name}</div>${rows}</div>`;
      }).join("");
      el.innerHTML = models + (P.note ? `<p class="cap">${P.note}</p>` : "");
    }
    const morphs = [...new Set(D.accel.map(p => p.morph))];
    U.seg(document.getElementById("acMorph"), morphs.map(m => ({ k: m, t: m[0].toUpperCase() + m.slice(1).replace("_", "-") })), st.morph, k => { st.morph = k; draw(); });
    U.seg(document.getElementById("acTrack"), [{ k: "mv", t: "Multi-view · RIGIS" }, { k: "sv", t: "Single-view · KIVA" }], st.track, k => { st.track = k; draw(); });
    draw(); tipHost(svg);
    addEventListener("resize", U.debounce(() => { pos = null; draw(); }, 150));
  }

  /* ---------- RQ1 detail: 300 multi-view clips, RIGIS vs a VLM judge ---------- */
  function swarm() {
    const svg = document.getElementById("swarm"); if (!svg) return;
    const MODES = [
      { k: "S", t: "RIGIS" }, { k: "gemma_cot", t: "Gemma 4 31B + CoT" }, { k: "gemma_zs", t: "Gemma 4 31B" },
      { k: "gemini_cot", t: "Gemini 3.6 Flash + CoT" }, { k: "gemini_zs", t: "Gemini 3.6 Flash" },
    ];
    const LANES = [["bimanual", "Bimanual"], ["humanoid", "Humanoid"], ["single_arm", "Single-arm"]];
    const HC = { 1: "var(--bad)", 2: "var(--med)", 3: "var(--good)" }, HN = { 1: "bad", 2: "medium", 3: "good" };
    let data = null, mode = "S", pos = null;
    const val = (c, m) => m === "S" ? c.S : (c.v[m] && c.v[m].length ? c.v[m].reduce((a, b) => a + b, 0) / c.v[m].length : null);
    function layout(W) {
      const pad = { l: 92, r: 16, t: 26 }, laneH = W < 560 ? 120 : 132, r = W < 560 ? 3 : 3.6;
      const out = {}, meta = [];
      LANES.forEach(([e, name], li) => {
        const cs = data.clips.filter(c => c.e === e && val(c, mode) != null);
        let lo, hi;
        if (mode === "S") { const v = cs.map(c => c.S).sort((a, b) => a - b); lo = v[0]; hi = v[v.length - 1]; const pd = (hi - lo) * .04; lo -= pd; hi += pd; }
        else { lo = 0.9; hi = 3.1; }
        const xs = v => pad.l + (W - pad.l - pad.r) * (v - lo) / (hi - lo);
        const cy = pad.t + li * laneH + laneH / 2, half = laneH / 2 - 8;
        const placed = [];
        cs.map(c => ({ c, x: xs(val(c, mode)) })).sort((a, b) => a.x - b.x).forEach(o => {
          let best = 0;
          for (let k = 0; k < 400; k++) {
            const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * r * 0.9;
            if (Math.abs(off) > half) { best = (Math.random() * 2 - 1) * half; break; }
            if (!placed.some(q => Math.abs(q.x - o.x) < 2 * r && Math.abs(q.y - (cy + off)) < 2 * r)) { best = off; break; }
          }
          o.y = cy + best; placed.push(o); out[o.c.id] = [o.x, o.y];
        });
        const med = [1, 2, 3].map(h => { const v = cs.filter(c => c.h === h).map(c => val(c, mode)).sort((a, b) => a - b); return v.length ? xs(v[Math.floor(v.length / 2)]) : null; });
        meta.push({ name, cy, half, lo, hi, xs, med, n: cs.length });
      });
      return { out, meta, pad, laneH, r, H: pad.t + LANES.length * laneH + 30 };
    }
    function draw() {
      const W = svg.clientWidth || 800, L = layout(W);
      svg.setAttribute("viewBox", `0 0 ${W} ${L.H}`); svg.style.height = L.H + "px";
      let s = "";
      L.meta.forEach((m, i) => {
        s += `<rect x="${L.pad.l - 6}" y="${m.cy - m.half - 4}" width="${W - L.pad.l - L.pad.r + 12}" height="${2 * m.half + 8}" rx="8" fill="var(--sunken)" opacity=".55"/>`;
        s += `<text x="${L.pad.l - 14}" y="${m.cy + 4}" text-anchor="end" font-size="13" font-weight="600" fill="var(--ink)" font-family="IBM Plex Sans">${m.name}</text>`;
        s += `<text x="${L.pad.l - 14}" y="${m.cy + 19}" text-anchor="end" font-size="10.5" fill="var(--ink-3)" font-family="IBM Plex Mono">n = ${m.n}</text>`;
        m.med.forEach((x, h) => { if (x != null) s += `<line x1="${x}" x2="${x}" y1="${m.cy - m.half - 4}" y2="${m.cy - m.half + 6}" stroke="${HC[h + 1]}" stroke-width="3" stroke-linecap="round"/><line x1="${x}" x2="${x}" y1="${m.cy + m.half - 6}" y2="${m.cy + m.half + 4}" stroke="${HC[h + 1]}" stroke-width="3" stroke-linecap="round"/>`; });
        if (i === L.meta.length - 1) {
          const ticks = mode === "S" ? [] : [1, 2, 3];
          ticks.forEach(t => { s += `<text x="${m.xs(t)}" y="${m.cy + m.half + 22}" text-anchor="middle" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono">${t} ${["bad", "medium", "good"][t - 1]}</text>`; });
          if (mode === "S") s += `<text x="${L.pad.l}" y="${m.cy + m.half + 22}" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Sans">← lower RIGIS</text><text x="${W - L.pad.r}" y="${m.cy + m.half + 22}" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Sans">higher RIGIS →</text>`;
        }
        if (mode === "S") s += `<text x="${L.pad.l}" y="${m.cy - m.half + 8}" font-size="10" fill="var(--ink-3)" font-family="IBM Plex Mono">${m.lo.toFixed(2)}</text><text x="${W - L.pad.r}" y="${m.cy - m.half + 8}" text-anchor="end" font-size="10" fill="var(--ink-3)" font-family="IBM Plex Mono">${m.hi.toFixed(2)}</text>`;
      });
      const feat = data.featured || {};
      data.clips.forEach(c => {
        const p = L.out[c.id]; if (!p) return;
        const runs = k => (c.v[k] || []).join(" / ") || "–";
        const tip = `<b>Clip ${c.id}</b> · ${c.m === "ctrlworld" ? "Ctrl-World" : "DreamGen"} · ${c.e.replace("_", "-")}<br>Humans: <b>${HN[c.h]}</b> · RIGIS ${c.S.toFixed(3)} (geo ${c.g.toFixed(2)}, pose ${c.p.toFixed(2)})<br>Gemma + CoT runs: ${runs("gemma_cot")} · Gemini + CoT: ${runs("gemini_cot")}${feat[c.id] ? "<br><i>Open in the RIGIS lab ↗</i>" : ""}`;
        s += `<circle class="dot${feat[c.id] ? " f" : ""}" data-id="${c.id}" data-tip="${esc(tip)}" cx="${p[0]}" cy="${p[1]}" r="${feat[c.id] ? L.r + 1.6 : L.r}" fill="${HC[c.h]}" ${feat[c.id] ? 'stroke="var(--ink)" stroke-width="2"' : 'stroke="var(--surface)" stroke-width=".8"'}/>`;
      });
      svg.innerHTML = s;
      const ids = data.clips.map(c => c.id).filter(id => L.out[id]);
      const now = ids.map(id => L.out[id]);
      if (pos) {
        const from = ids.map(id => pos[id] || L.out[id]);
        const els = ids.map(id => svg.querySelector(`circle[data-id="${id}"]`));
        tween(from.flat(), now.flat(), 850, v => els.forEach((e, i) => { e.setAttribute("cx", v[2 * i]); e.setAttribute("cy", v[2 * i + 1]); }));
      }
      pos = L.out;
    }
    svg.addEventListener("click", e => {
      const d = e.target.closest("circle.f"); if (!d) return;
      document.dispatchEvent(new CustomEvent("rw-rigis-open", { detail: d.dataset.id }));
      const lab = document.getElementById("rigisLab"); if (lab) lab.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    fetch("data/rigis_all.json").then(r => r.json()).then(d => {
      data = d; window.RW_RIGIS_ALL = d;
      U.seg(document.getElementById("swMode"), MODES, "S", k => { mode = k; draw(); });
      draw(); tipHost(svg);
      addEventListener("resize", U.debounce(() => { pos = null; draw(); }, 150));
    }).catch(e => console.error("swarm", e));
  }

  document.addEventListener("DOMContentLoaded", () => {
    [donuts, wm, tab1, align, swarm, latency, tab2, depth, accel].forEach(f => { try { f(); } catch (e) { console.error(f.name, e); } });
    if (window.MathJax && MathJax.startup && MathJax.startup.promise) MathJax.startup.promise.catch(() => {});
  });
})();
