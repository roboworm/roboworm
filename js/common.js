/* Shared helpers: theme toggle, review-style line numbers, lightbox, tooltips, small math. */
(function () {
  const U = (window.RW = window.RW || {});
  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (s[(n - 1) >> 1] + s[n >> 1]) / 2 : 0; };
  U.ticks = (lo, hi, n) => {
    const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10)); return out;
  };
  U.fmt = v => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : Math.abs(v) >= 10 || v === 0 ? String(Math.round(v)) : String(+v.toFixed(2)));
  U.typeset = el => { const M = window.MathJax; if (M && M.typesetPromise) M.typesetPromise([el]).catch(() => {}); };
  U.css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // theme tokens for canvas drawing, cached until the theme changes
  let tokC = {};
  document.addEventListener("rw-theme", () => { tokC = {}; });
  U.tok = name => tokC[name] || (tokC[name] = U.css(name));
  const rgb = h => { h = h.replace("#", ""); if (h.length === 3) h = h.replace(/./g, c => c + c); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  U.alpha = (name, a) => `rgba(${rgb(U.tok(name)).join(",")},${a})`;
  // green at 0, amber at 1 (the threshold), red at 2
  U.ramp = x => {
    const [A, B, C] = ["--ramp-0", "--ramp-1", "--ramp-2"].map(n => rgb(U.tok(n))), v = Math.max(0, Math.min(2, x));
    const [p, q, u] = v < 1 ? [A, B, v] : [B, C, v - 1];
    return `rgb(${p.map((c, i) => Math.round(c + (q[i] - c) * u)).join(",")})`;
  };

  // segmented control: items [{k, t}], returns setter
  U.seg = (el, items, cur, onChange) => {
    el.innerHTML = items.map(i => `<button type="button" data-k="${i.k}" aria-pressed="${i.k === cur}">${i.t}</button>`).join("");
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      onChange(b.dataset.k);
    });
  };

  const tip = () => document.getElementById("tip");
  U.tipShow = (html, x, y) => { const t = tip(); t.innerHTML = html; t.style.opacity = 1; const r = t.getBoundingClientRect(); t.style.left = Math.min(innerWidth - r.width - 8, x + 12) + "px"; t.style.top = Math.max(8, y - r.height - 10) + "px"; };
  U.tipHide = () => { tip().style.opacity = 0; };

  document.addEventListener("DOMContentLoaded", () => {
    // theme
    const btns = [...document.querySelectorAll(".theme-btn")], root = document.documentElement;
    try { const t = localStorage.getItem("rw-theme"); if (t) root.dataset.theme = t; } catch (e) {}
    const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const label = () => btns.forEach(b => { b.textContent = isDark() ? "Light" : "Dark"; });
    label();
    btns.forEach(btn => btn.addEventListener("click", () => {
      root.dataset.theme = isDark() ? "light" : "dark"; label();
      try { localStorage.setItem("rw-theme", root.dataset.theme); } catch (e) {}
      document.dispatchEvent(new Event("rw-theme"));
    }));
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { label(); document.dispatchEvent(new Event("rw-theme")); });

    // ICLR review line numbers in the hero margin
    const g = document.getElementById("gutter");
    if (g) g.innerHTML = Array.from({ length: 24 }, (_, i) => `<span>${String(i).padStart(3, "0")}</span>`).join("");

    // count-up on the Fig. 1 numbers (the final value is already in the markup)
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) document.querySelectorAll("[data-count]").forEach(el => {
      const to = +el.dataset.count, dec = +(el.dataset.dec || 0), pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
      const fmt = v => pre + v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
      const t0 = performance.now(), dur = 1400;
      (function step(now) { const u = Math.min(1, (now - t0) / dur), e = 1 - (1 - u) ** 3; el.textContent = fmt(to * e); if (u < 1) requestAnimationFrame(step); })(t0);
    });

    // lightbox for paper figures
    document.querySelectorAll("[data-zoom] img").forEach(img => img.addEventListener("click", () => {
      const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${img.src}" alt="${img.alt}">`;
      lb.addEventListener("click", () => lb.remove()); document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { lb.remove(); document.removeEventListener("keydown", k); } });
      document.body.appendChild(lb);
    }));

    // nav highlight
    const links = [...document.querySelectorAll(".nav a.l, .side ol a")];
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("section.sec").forEach(s => io.observe(s));
    const bar = document.getElementById("progress");
    const prog = () => { const h = document.documentElement; bar.style.width = (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) * 100) + "%"; };
    if (bar) { addEventListener("scroll", prog, { passive: true }); prog(); }

    // BibTeX copy
    const cb = document.getElementById("copyBib");
    if (cb) cb.addEventListener("click", () => {
      const txt = document.getElementById("bib").textContent.replace(/^Copy(ied)?/, "").trim();
      const done = () => { cb.textContent = "Copied"; setTimeout(() => { cb.textContent = "Copy"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => { const r = document.createRange(); r.selectNodeContents(document.getElementById("bib")); getSelection().removeAllRanges(); getSelection().addRange(r); });
    });
  });
})();
