// Deterministic reel player: setup(timeline) builds the DOM once, renderFrame(t)
// puts every element in the exact state for time t. No CSS animations or timers,
// so frames can be captured in any order and in parallel.
(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeBack = (x) => {
    x = clamp(x);
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const el = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };

  let TL = null;
  const scenes = []; // { data, root, anims: [{el, at, dur, kind}] }
  let chunks = []; // caption chunks: { start, end, words }

  // "*accent words*" markup, "\n" forces a line break.
  function addWords(parent, text, anims, at, stagger) {
    let accent = false, i = 0;
    for (const line of String(text).split('\n')) {
      for (let tok of line.split(/\s+/).filter(Boolean)) {
        let on = accent;
        if (tok.startsWith('*')) { on = accent = true; tok = tok.slice(1); }
        const m = tok.match(/^(.*?)\*([.,!?;:…]*)$/);
        if (m) { accent = false; tok = m[1] + m[2]; }
        if (!tok) continue;
        const s = el('span', 'w' + (on ? ' accent' : ''), parent);
        s.textContent = tok;
        anims.push({ el: s, at: at + i * stagger, dur: 0.42, kind: 'pop' });
        i++;
      }
      el('br', null, parent);
    }
    parent.lastChild.remove();
    return at + i * stagger;
  }

  function buildScene(sc) {
    const root = el('section', 'scene ' + sc.type, document.getElementById('scenes'));
    const anims = [];
    const len = sc.end - sc.start;
    const count = (s) => String(s || '').split(/\s+/).filter(Boolean).length || 1;
    const stag = (s, share) => Math.min(0.085, (len * share) / count(s));
    const block = (cls, at, kind = 'rise', dur = 0.5) => {
      const e = el('div', cls + ' anim', root);
      anims.push({ el: e, at, dur, kind });
      return e;
    };
    let at = sc.start + 0.1;

    if (sc.type === 'quote') { block('mark', at).textContent = '“'; at += 0.12; }
    if (sc.type === 'hook' && sc.kicker) { block('tag', at, 'pop').textContent = sc.kicker; at += 0.15; }
    if (sc.type === 'point' && sc.kicker) { block('kicker', at, 'pop').textContent = sc.kicker; at += 0.15; }

    if (sc.type === 'stat') {
      const v = block('value', at, 'pop');
      v.textContent = sc.value;
      const m = String(sc.value).match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
      if (m) {
        const target = parseFloat(m[2].replace(/,/g, ''));
        const decimals = (m[2].split('.')[1] || '').length;
        anims.push({ el: v, at, dur: 0.9, kind: 'count', pre: m[1], post: m[3], target, decimals, commas: m[2].includes(',') });
      }
      at += 0.55;
    } else if (sc.text) {
      const h = el('div', 'headline', root);
      at = addWords(h, sc.text, anims, at, stag(sc.text, 0.4)) + 0.2;
    }

    if (sc.type === 'point' && sc.sub) { block('rule', at, 'grow'); at += 0.12; }
    const subText = sc.type === 'stat' ? sc.text : sc.sub;
    if (subText) {
      const p = el('div', 'sub', root);
      at = addWords(p, subText, anims, at, stag(subText, 0.3)) + 0.15;
    }
    if (sc.type === 'quote' && sc.author) block('', at).appendChild(Object.assign(el('cite'), { textContent: '— ' + sc.author }));
    if (sc.type === 'cta' && (sc.button || TL.handle)) {
      const pill = block('pill', at, 'pop');
      pill.textContent = sc.button || TL.handle;
      anims.push({ el: pill, at: at + 0.45, kind: 'pulse' });
    }
    scenes.push({ data: sc, root, anims });
  }

  // Shrink text until the scene fits its box (long headlines, long words).
  function fit(root) {
    root.style.display = 'flex';
    const targets = [...root.querySelectorAll('.headline, .sub, .value')];
    const overflow = () =>
      root.scrollHeight > root.clientHeight + 1 || targets.some((e) => e.scrollWidth > root.clientWidth + 1);
    let scale = 1;
    const base = targets.map((e) => parseFloat(getComputedStyle(e).fontSize));
    while (overflow() && scale > 0.4) {
      scale *= 0.95;
      targets.forEach((e, i) => (e.style.fontSize = base[i] * scale + 'px'));
    }
    root.style.display = '';
  }

  function buildCaptions() {
    chunks = [];
    for (const sc of TL.scenes) {
      let cur = [];
      const flush = () => { if (cur.length) chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; };
      for (const w of sc.words || []) {
        const chars = cur.reduce((n, x) => n + x.w.length + 1, 0);
        if (cur.length >= 4 || chars + w.w.length > 22) flush();
        cur.push(w);
        if (/[.,!?;:…]$/.test(w.w)) flush();
      }
      flush();
    }
  }

  function apply(a, t) {
    const p = (t - a.at) / (a.dur || 1);
    const s = a.el.style;
    if (a.kind === 'pop') {
      const b = easeBack(p);
      s.opacity = easeOut(p * 1.6);
      s.transform = `translateY(${(1 - b) * 70}px) scale(${0.86 + 0.14 * b})`;
    } else if (a.kind === 'rise') {
      const e = easeOut(p);
      s.opacity = e;
      s.transform = `translateY(${(1 - e) * 44}px)`;
    } else if (a.kind === 'grow') {
      s.transform = `scaleX(${easeOut(p)})`;
    } else if (a.kind === 'count') {
      const v = a.target * easeOut(p);
      let n = v.toFixed(a.decimals);
      if (a.commas) n = Number(n).toLocaleString('en-US', { minimumFractionDigits: a.decimals });
      a.el.textContent = a.pre + n + a.post;
    } else if (a.kind === 'pulse' && t > a.at) {
      s.transform = `scale(${1 + 0.035 * Math.sin((t - a.at) * 5)})`;
    }
  }

  window.setup = async (timeline) => {
    TL = timeline;
    document.getElementById('stage').dataset.theme = TL.theme || 'midnight';
    document.getElementById('handle').textContent = TL.handle || '';
    await Promise.all([
      document.fonts.load('900 100px "Inter Reel"'),
      document.fonts.load('500 100px "Inter Reel"'),
      document.fonts.load('italic 100px "Serif Reel"'),
    ]);
    TL.scenes.forEach(buildScene);
    scenes.forEach((s) => fit(s.root));
    if (TL.captions !== false) buildCaptions();
    return true;
  };

  window.renderFrame = (t) => {
    document.getElementById('bar').style.transform = `scaleX(${clamp(t / TL.duration)})`;
    document.querySelectorAll('.blob').forEach((b, i) => {
      const k = i + 1;
      b.style.transform = `translate(${Math.sin(t * 0.23 * k + k) * 140}px, ${Math.cos(t * 0.19 * k + k * 2) * 170}px) scale(${1 + 0.12 * Math.sin(t * 0.3 + k)})`;
    });

    const last = scenes[scenes.length - 1];
    for (const s of scenes) {
      const { start, end } = s.data;
      const on = t >= start && (t < end || s === last);
      s.root.style.display = on ? 'flex' : 'none';
      if (!on) continue;
      const out = s === last ? 0 : easeOut((t - (end - 0.26)) / 0.26);
      s.root.style.opacity = 1 - out;
      s.root.style.transform = `translateY(${-out * 70}px) scale(${1 - 0.04 * out})`;
      for (const a of s.anims) apply(a, t);
    }

    const cap = document.getElementById('caption');
    const c = chunks.find((c, i) => t >= c.start - 0.05 && t < Math.min(c.end + 0.35, chunks[i + 1] ? chunks[i + 1].start - 0.05 : Infinity));
    cap.innerHTML = c
      ? '<div class="box">' + c.words.map((w) => {
          const cls = t >= w.start && t < w.end ? 'now' : t >= w.end ? 'said' : '';
          return `<span class="${cls}">${w.w.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</span>`;
        }).join('') + '</div>'
      : '';
  };
})();
