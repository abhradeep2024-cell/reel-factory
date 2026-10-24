// ============================================================================
// Reel Factory film engine: validated shot sheet -> self-contained HTML film.
//
// DETERMINISM: every visual property is a pure function of t (ms since film
// start). The renderer calls window.__film.seek(t) once per frame. There are
// NO CSS animations or transitions anywhere - all motion is applied as inline
// styles from seek(), so the same plan always renders identical frames on any
// machine.
//
// Scene concepts adapted from html-anime (github.com/blixvip/html-anime, MIT):
// explicit shot durations that must sum exactly to the runtime, holds, one
// spotlight moment per reel, closed color scripts per mood.
// ============================================================================

export const PALETTES = {
  bold:   { bg: ['#0f0c29', '#302b63'], accent: '#ff2e63', accent2: '#08d9d6', text: '#ffffff', sub: 'rgba(255,255,255,0.72)', light: false },
  calm:   { bg: ['#eef2f3', '#8e9eab'], accent: '#2d728f', accent2: '#e9a13b', text: '#16303e', sub: 'rgba(22,48,62,0.66)', light: true },
  dark:   { bg: ['#060606', '#1b1b22'], accent: '#ffb703', accent2: '#ff006e', text: '#ffffff', sub: 'rgba(255,255,255,0.66)', light: false },
  bright: { bg: ['#ff9e00', '#ff0059'], accent: '#ffffff', accent2: '#ffd166', text: '#ffffff', sub: 'rgba(255,255,255,0.82)', light: false },
  pastel: { bg: ['#fbc2eb', '#a6c1ee'], accent: '#6c5ce7', accent2: '#00b894', text: '#2d3436', sub: 'rgba(45,52,54,0.66)', light: true },
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Motifs: keyword-driven SVG illustrations with per-frame animation.
// Each returns { svg, init, frame } where init/frame are JS strings evaluated
// inside the film runtime (signature: function(t,d,S,RW,ph,eo,ec,eb)).
// ---------------------------------------------------------------------------
const MOTIF_RULES = [
  [/chart|graph|data|percent|growth|stat|number|score|%|metric|money|revenue/i, 'bars'],
  [/heart|love|like|follow|care|community|friend/i, 'heart'],
  [/fire|hot|trend|viral|fast|burn|streak|energy/i, 'flame'],
  [/clock|time|minute|hour|day|daily|week|routine|habit|morning|night/i, 'clock'],
  [/person|character|silhouette|human|you|viewer|hero|student|developer|people|brain|mind/i, 'person'],
  [/star|sparkle|magic|dream|shine|future|idea|light/i, 'stars'],
  [/arrow|rise|grow|boost|increase|level|progress|step|build|skill|learn/i, 'arrow'],
];
export function motifFor(visual) {
  for (const [re, m] of MOTIF_RULES) if (re.test(visual || '')) return m;
  return 'orbit';
}

const PERSON_PATH = 'M100 30 C 122 30 136 46 136 66 C 136 84 124 96 110 99 C 140 108 158 132 162 170 L 38 170 C 42 132 60 108 90 99 C 76 96 64 84 64 66 C 64 46 78 30 100 30 Z';

function motifSVG(kind, pal) {
  const A = pal.accent, A2 = pal.accent2;
  const wrap = (inner) => `<svg class="motif" viewBox="0 0 200 200">${inner}</svg>`;
  switch (kind) {
    case 'bars': {
      const hs = [72, 112, 148, 96, 128];
      return {
        svg: wrap(hs.map((h, i) =>
          `<rect class="mbar" x="${28 + i * 34}" y="${150 - h}" width="20" height="${h}" rx="6" fill="${i % 2 ? A2 : A}"></rect>`).join('')),
        init: `return { bars: [].slice.call(root.querySelectorAll('.mbar')), hs: ${JSON.stringify(hs)} }`,
        frame: "S.bars.forEach(function(r,i){var p=ec(ph(t,300+i*170,d-80));var h=Math.max(6,S.hs[i]*p);r.setAttribute('height',String(h));r.setAttribute('y',String(150-h));});",
      };
    }
    case 'heart':
      return {
        svg: wrap(`<path class="mheart" d="M100 168 C 18 106 20 42 62 38 C 84 36 100 56 100 72 C 100 56 116 36 138 38 C 180 42 182 106 100 168 Z" fill="${A}"></path>`),
        init: `return { heart: root.querySelector('.mheart') }`,
        frame: "var pu=0.92+0.08*Math.sin(t/240);S.heart.setAttribute('transform','translate(100 100) scale('+pu.toFixed(4)+') translate(-100 -100)');",
      };
    case 'flame':
      return {
        svg: wrap(`<g class="mflame"><path d="M100 24 C 108 58 146 74 146 116 C 146 150 124 172 100 172 C 76 172 54 150 54 116 C 54 84 82 70 88 44 C 92 64 104 70 108 58 C 112 76 100 88 100 100" fill="none" stroke="${A}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"></path></g>`),
        init: `return { flame: root.querySelector('.mflame') }`,
        frame: "var fl=1+0.05*Math.sin(t/90)+0.04*Math.sin(t/37);S.flame.setAttribute('transform','translate(100 100) scale('+fl.toFixed(4)+') translate(-100 -100)');",
      };
    case 'clock':
      return {
        svg: wrap(`<circle cx="100" cy="100" r="74" fill="none" stroke="${A}" stroke-width="12"></circle><line class="mhand" x1="100" y1="100" x2="100" y2="52" stroke="${A2}" stroke-width="10" stroke-linecap="round"></line><circle cx="100" cy="100" r="8" fill="${A2}"></circle>`),
        init: `return { hand: root.querySelector('.mhand') }`,
        frame: "S.hand.setAttribute('transform','rotate('+(t*0.36).toFixed(2)+' 100 100)');",
      };
    case 'person':
      return {
        svg: wrap(`<path class="mperson" d="${PERSON_PATH}" fill="${A}"></path>`),
        init: `return { person: root.querySelector('.mperson') }`,
        frame: "var sw=Math.sin(t/520)*8;S.person.setAttribute('transform','translate('+sw.toFixed(2)+' 0)');",
      };
    case 'stars': {
      const star = (x, y, r, fill) =>
        `<polygon class="mstar" points="${starPts(x, y, r)}" fill="${fill}"></polygon>`;
      return {
        svg: wrap(star(60, 60, 26, A) + star(140, 84, 18, A2) + star(96, 148, 22, A)),
        init: `return { stars: [].slice.call(root.querySelectorAll('.mstar')) }`,
        frame: "S.stars.forEach(function(s,i){var tw=0.45+0.55*Math.abs(Math.sin(t/(310+i*90)+i));s.setAttribute('opacity',String(tw.toFixed(3)));});",
      };
    }
    case 'arrow':
      return {
        svg: wrap(`<path class="marrow" d="M36 158 L 92 102 L 92 128 L 158 62" fill="none" stroke="${A}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"></path><path d="M132 56 L 162 54 L 160 84 Z" fill="${A}"></path>`),
        init: `return { arrow: root.querySelector('.marrow') }`,
        frame: "var p=ec(ph(t,350,d-250));S.arrow.style.strokeDasharray='400';S.arrow.style.strokeDashoffset=String(400*(1-p));",
      };
    default:
      return {
        svg: wrap(`<g class="morbit"><circle cx="100" cy="100" r="70" fill="none" stroke="${A}" stroke-width="10" stroke-dasharray="20 26"></circle><circle cx="100" cy="30" r="16" fill="${A2}"></circle><circle cx="100" cy="170" r="10" fill="${A}"></circle></g>`),
        init: `return { orbit: root.querySelector('.morbit') }`,
        frame: "S.orbit.setAttribute('transform','rotate('+(t/14).toFixed(2)+' 100 100)');",
      };
  }
}
function starPts(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push((cx + Math.cos(rad) * rr).toFixed(1) + ',' + (cy + Math.sin(rad) * rr).toFixed(1));
  }
  return pts.join(' ');
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function splitLines(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = [];
  for (const w of words) {
    if ((cur.join(' ').length + (cur.length ? 1 : 0) + w.length) > maxChars && cur.length) {
      lines.push(cur); cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}
function fontSizeFor(maxLineLen) {
  const n = Math.max(1, maxLineLen);
  if (n <= 8) return 150;
  if (n <= 12) return 124;
  if (n <= 16) return 102;
  if (n <= 20) return 86;
  return 72;
}
function wordsHTML(text, opts = {}) {
  const start = opts.start ?? 140;
  const stagger = opts.stagger ?? 66;
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let out = '';
  words.forEach((w, i) => { out += `<span class="w" data-at="${start + i * stagger}">${esc(w)}</span> `; });
  return out.trim();
}

// ---------------------------------------------------------------------------
// Scene builders (one per template)
// ---------------------------------------------------------------------------
function sceneKinetic(scene, i, ctx) {
  const pal = ctx.pal(scene);
  const lines = splitLines(scene.text, 16);
  const fs = fontSizeFor(Math.max(...lines.map((l) => l.length)));
  const stagger = scene.emphasis === 'none' ? 90 : 66;
  const words = lines
    .map((l, li) => `<div class="l" style="font-size:${li === 0 ? fs : Math.round(fs * 0.88)}px">${wordsHTML(l.join(' '), { start: 150 + li * 80, stagger })}</div>`)
    .join('');
  const sub = scene.subtext
    ? `<div class="ksub" style="color:${pal.sub}">${wordsHTML(scene.subtext, { start: 1400, stagger: 40 })}</div>` : '';
  const motif = motifSVG(motifFor((scene.visual || '') + ' ' + scene.text), pal);
  const seedS = (ctx.seed + i * 7.3) % 10;
  const html = `<div class="grad" style="background:linear-gradient(158deg,${pal.bg[0]},${pal.bg[1]})"></div>
<div class="blob" style="background:radial-gradient(circle,${pal.accent}55,transparent 68%)"></div>
<div class="blob b2" style="background:radial-gradient(circle,${pal.accent2}3d,transparent 68%)"></div>
<div class="mframe">${motif.svg}</div>
<div class="content center">
  <div class="ktext" style="color:${pal.text}">${words}</div>
  ${sub}
  <div class="accentbar" style="background:linear-gradient(90deg,${pal.accent},${pal.accent2})"></div>
</div>
${scene.emphasis === 'hard' ? '<div class="flash"></div>' : ''}`;
  const init = `return Object.assign({bar:root.querySelector('.accentbar'),b1:root.querySelector('.blob'),b2:root.querySelector('.b2'),flash:root.querySelector('.flash')},(function(root){${motif.init}})(root))`;
  const frame = [
    'RW(t,S);',
    "S.bar.style.transform='scaleX('+Math.min(1,ph(t,280,Math.max(420,d-260))).toFixed(4)+')';",
    `S.b1.style.transform='translate('+(Math.sin(t/1300+${seedS.toFixed(2)})*74).toFixed(1)+'px,'+(Math.cos(t/1600+${seedS.toFixed(2)})*54).toFixed(1)+'px)';`,
    `S.b2.style.transform='translate('+(Math.cos(t/1500+${seedS.toFixed(2)})*86).toFixed(1)+'px,'+(Math.sin(t/1100+${seedS.toFixed(2)})*64).toFixed(1)+'px)';`,
    motif.frame,
    "if(S.flash){S.flash.style.opacity=String(Math.max(0,0.85*(1-ph(t,40,440))));}",
  ].join('\n');
  return { html, init, frame };
}

function sceneAnime(scene, i, ctx) {
  const pal = ctx.pal(scene);
  const lines = splitLines(scene.text, 14);
  const fs = fontSizeFor(Math.max(...lines.map((l) => l.length)));
  const words = lines
    .map((l, li) => `<div class="l" style="font-size:${li === 0 ? fs : Math.round(fs * 0.86)}px">${wordsHTML(l.join(' '), { start: 170 + li * 70, stagger: 58 })}</div>`)
    .join('');
  const rng = mulberry32(ctx.seed + i * 31);
  let linesSvg = '';
  for (let k = 0; k < 26; k++) {
    const ang = (k / 26) * Math.PI * 2 + rng() * 0.14;
    const x2 = (540 + Math.cos(ang) * 1500).toFixed(0);
    const y2 = (960 + Math.sin(ang) * 1500).toFixed(0);
    const sw = (2 + rng() * 6).toFixed(1);
    linesSvg += `<line class="sl" x1="540" y1="960" x2="${x2}" y2="${y2}" stroke="${pal.accent}" stroke-width="${sw}" stroke-dasharray="46 180"></line>`;
  }
  const chip = i === 0 ? '!?' : 'DAY ' + (ctx.dayIndex + 1);
  const chipColor = pal.light ? '#ffffff' : pal.bg[0];
  const motifKind = motifFor((scene.visual || '') + ' ' + scene.text);
  const sil = motifKind === 'person'
    ? `<svg class="sil" viewBox="0 0 200 200"><path d="${PERSON_PATH}" fill="${pal.accent}" opacity="0.9"></path></svg>` : '';
  const motif = motifSVG(motifKind, pal);
  const burst = i === 0
    ? `<div class="burst"><svg viewBox="0 0 200 200"><polygon points="${starPts(100, 100, 92)}" fill="${pal.accent}" opacity="0.9"></polygon><polygon points="${starPts(100, 100, 56)}" fill="${pal.accent2}" opacity="0.95"></polygon></svg></div>` : '';
  const html = `<div class="abg" style="background:linear-gradient(180deg,${pal.bg[0]},${pal.bg[1]})"></div>
<div class="dots"></div>
<svg class="speed" viewBox="0 0 1080 1920" preserveAspectRatio="none">${linesSvg}</svg>
${burst}
<div class="mframe dim">${motif.svg}</div>
${sil}
<div class="content center">
  <div class="atext" style="color:${pal.text};-webkit-text-stroke:${pal.light ? '0' : '2px'} ${pal.light ? 'transparent' : 'rgba(0,0,0,0.35)'}">${words}</div>
  <div class="chip" style="background:${pal.accent};color:${chipColor}">${esc(chip)}</div>
</div>
${scene.emphasis === 'hard' ? '<div class="flash"></div>' : ''}`;
  const init = `return Object.assign({sl:[].slice.call(root.querySelectorAll('.sl')),dots:root.querySelector('.dots'),burst:root.querySelector('.burst'),chip:root.querySelector('.chip'),flash:root.querySelector('.flash'),sil:root.querySelector('.sil')},(function(root){${motif.init}})(root))`;
  const frame = [
    'RW(t,S);',
    "S.dots.style.backgroundPosition=((t/38)%26)+'px '+((t/52)%26)+'px';",
    "var sv=0.22+0.45*ph(t,0,620)*(1-ph(t,d-420,d));S.sl.forEach(function(l,i){l.style.opacity=String(sv);l.style.strokeDashoffset=String(2000-((t*2.1+i*137)%2000));});",
    "if(S.burst){var bp=0.55+0.5*eb(ph(t,160,900));S.burst.style.transform='translate(-50%,-50%) scale('+bp.toFixed(4)+') rotate('+(t/46).toFixed(1)+'deg)';}",
    "if(S.chip){S.chip.style.transform='translateY('+(-16*(1-eo(ph(t,380,700)))).toFixed(1)+'px)';}",
    "if(S.sil){S.sil.style.transform='translateX('+(Math.sin(t/600)*26).toFixed(1)+'px)';}",
    motif.frame,
    "if(S.flash){S.flash.style.opacity=String(Math.max(0,0.9*(1-ph(t,30,380))));}",
  ].join('\n');
  return { html, init, frame };
}

function sceneMotion(scene, i, ctx) {
  const pal = ctx.pal(scene);
  const lines = splitLines(scene.text, 20);
  const fs = Math.round(fontSizeFor(Math.max(...lines.map((l) => l.length))) * 0.82);
  const words = lines
    .map((l, li) => `<div class="l" style="font-size:${fs}px">${wordsHTML(l.join(' '), { start: 200 + li * 70, stagger: 72 })}</div>`)
    .join('');
  const rng = mulberry32(ctx.seed + i * 53);
  let glass = '';
  const gcount = 4;
  for (let k = 0; k < gcount; k++) {
    const w = 220 + Math.round(rng() * 300);
    const h = 220 + Math.round(rng() * 420);
    const x = Math.round(rng() * 80) / 100; // 0..0.8 fraction
    const y = Math.round(rng() * 60) / 100;
    const rot = Math.round(rng() * 60 - 30);
    const r = 30 + Math.round(rng() * 70);
    glass += `<div class="glass" data-k="${k}" style="left:${x * 100}%;top:${y * 100}%;width:${w}px;height:${h}px;border-radius:${r}px;transform:rotate(${rot}deg);background:${pal.light ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)'};border:2px solid ${pal.light ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.16)'}"></div>`;
  }
  const motif = motifSVG(motifFor((scene.visual || '') + ' ' + scene.text), pal);
  const sub = scene.subtext
    ? `<div class="ksub" style="color:${pal.sub}">${wordsHTML(scene.subtext, { start: 1300, stagger: 44 })}</div>` : '';
  const html = `<div class="grad" style="background:linear-gradient(200deg,${pal.bg[0]},${pal.bg[1]})"></div>
${glass}
<div class="mframe corner">${motif.svg}</div>
<div class="content bottom">
  <div class="mcard" style="background:${pal.light ? 'rgba(255,255,255,0.72)' : 'rgba(10,10,20,0.45)'};border:2px solid ${pal.light ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.14)'}">
    <div class="mtext" style="color:${pal.text}">${words}</div>
    ${sub}
  </div>
</div>
${scene.emphasis === 'hard' ? '<div class="flash"></div>' : ''}`;
  const init = `return Object.assign({glass:[].slice.call(root.querySelectorAll('.glass')),flash:root.querySelector('.flash')},(function(root){${motif.init}})(root))`;
  const frame = [
    'RW(t,S);',
    "S.glass.forEach(function(g,k){var sp=900+k*340;g.style.transform+='';g.style.translate=Math.sin(t/sp+k*1.7)*24+'px '+Math.cos(t/(sp*0.8)+k)*18+'px';g.style.rotate=((Math.sin(t/(sp*2.2)+k)*3)).toFixed(2)+'deg';});",
    motif.frame,
    "if(S.flash){S.flash.style.opacity=String(Math.max(0,0.7*(1-ph(t,40,420))));}",
  ].join('\n');
  return { html, init, frame };
}

function sceneStory(scene, i, ctx) {
  const pal = ctx.pal(scene);
  const chunks = splitBubbles(scene.text, 3);
  const ats = chunks.map((c, k) => 520 + k * 1500);
  const bubbles = chunks.map((c, k) => {
    const side = k % 2 === 0 ? 'left' : 'right';
    return `<div class="bubble ${side}" data-at="${ats[k]}" style="background:${pal.light ? '#ffffff' : '#232331'};color:${pal.light ? '#1c2430' : '#f2f3f7'}">
      <div class="btxt">${wordsHTML(c, { start: ats[k] + 200, stagger: 36 })}</div>
    </div>`;
  }).join('');
  const header = `<div class="phead" style="background:${pal.light ? 'rgba(255,255,255,0.9)' : '#1a1a26'};color:${pal.light ? '#1c2430' : '#e8e9ef'}"><span class="pdot" style="background:${pal.accent}"></span>${esc(ctx.title.slice(0, 26))}</div>`;
  const html = `<div class="grad" style="background:linear-gradient(165deg,${pal.bg[0]},${pal.bg[1]})"></div>
<div class="phone" style="background:${pal.light ? '#f2f4f7' : '#14141d'};border:3px solid ${pal.light ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.12)'}">
  ${header}
  <div class="pbody">
    ${bubbles}
    <div class="tdots" style="background:${pal.light ? '#ffffff' : '#232331'}"><i></i><i></i><i></i></div>
  </div>
</div>
${scene.emphasis === 'hard' ? '<div class="flash"></div>' : ''}`;
  const init = `return {bubs:[].slice.call(root.querySelectorAll('.bubble')),dots:root.querySelector('.tdots'),dotsEls:[].slice.call(root.querySelectorAll('.tdots i')),flash:root.querySelector('.flash')}`;
  const firstAt = ats[0] || 600;
  const frame = [
    "var dv=t>120&&t<firstAt-60?1:0;S.dots.style.opacity=String(dv);S.dots.style.visibility=dv?'visible':'hidden';",
    "S.dotsEls.forEach(function(e,k){e.style.transform='translateY('+(-3.5*Math.max(0,Math.sin(t/190+k*1.1))).toFixed(2)+'px)';});",
    "S.bubs.forEach(function(b,k){var at=Number(b.dataset.at);var p=eb(ph(t,at,at+320));b.style.opacity=String(p>0?1:0);b.style.transform='translateY('+(14*(1-p)).toFixed(2)+'px) scale('+(0.92+0.08*p).toFixed(3)+')';b.style.pointerEvents='none';});",
    'RW(t,S);',
    "if(S.flash){S.flash.style.opacity=String(Math.max(0,0.6*(1-ph(t,40,400))));}",
  ].join('\n').replace(/firstAt-60/g, `${firstAt - 60}`);
  return { html, init, frame };
}

function splitBubbles(text, max) {
  const parts = String(text || '')
    .split(/(?<=[.!?,])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return [String(text || '')];
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > 56 && cur) { chunks.push(cur.trim()); cur = p; }
    else cur = (cur + ' ' + p).trim();
    if (chunks.length === max - 1 && cur) break;
  }
  if (cur && chunks.length < max) chunks.push(cur.trim());
  // remaining text (if any) appended to last chunk
  return chunks;
}

const BUILDERS = { kinetic: sceneKinetic, anime: sceneAnime, motion: sceneMotion, story: sceneStory };

// ---------------------------------------------------------------------------
// CSS + runtime (fixed strings embedded into every film)
// ---------------------------------------------------------------------------
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
body{font-family:'Carlito','Liberation Sans',Arial,sans-serif;-webkit-font-smoothing:antialiased}
#stage{position:relative;width:{{W}}px;height:{{H}}px;overflow:hidden;background:#000}
.scene{position:absolute;inset:0;overflow:hidden;visibility:hidden;opacity:0;will-change:transform,opacity}
.cam{position:absolute;inset:0;will-change:transform}
.grad{position:absolute;inset:-12%}
.blob{position:absolute;width:62%;height:38%;left:-14%;top:8%;filter:blur(46px);will-change:transform}
.blob.b2{left:44%;top:52%;width:58%;height:44%}
.mframe{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);width:46%;opacity:0.4}
.mframe.dim{opacity:0.22}
.mframe.corner{left:auto;top:auto;right:6%;bottom:38%;transform:none;width:30%;opacity:0.3}
.motif{width:100%;height:auto;display:block}
.content{position:absolute;left:84px;right:84px;display:flex;flex-direction:column;gap:30px}
.content.center{top:50%;transform:translateY(-50%)}
.content.bottom{bottom:110px}
.ktext .l,.atext .l,.mtext .l{font-weight:700;line-height:1.16;letter-spacing:-0.5px}
.atext .l{font-weight:800;letter-spacing:-1px;text-transform:uppercase}
.ksub .w{font-size:38px;font-weight:400}
.accentbar{height:12px;width:100%;border-radius:8px;transform:scaleX(0);transform-origin:left;will-change:transform}
.w{display:inline-block;opacity:0;transform:translateY(0.45em);will-change:transform,opacity}
.chip{align-self:flex-start;font-weight:800;font-size:40px;letter-spacing:6px;padding:12px 30px;border-radius:14px}
.flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
.dots{position:absolute;inset:0;opacity:0.5;background-size:26px 26px;will-change:background-position}
.speed{position:absolute;inset:0;width:100%;height:100%;opacity:0;will-change:opacity}
.burst{position:absolute;left:50%;top:42%;width:74%;transform:translate(-50%,-50%) scale(0.6);will-change:transform}
.burst svg{width:100%;height:auto;display:block}
.sil{position:absolute;left:60px;bottom:120px;width:30%;opacity:0.95;will-change:transform}
.glass{position:absolute;filter:blur(3px);will-change:translate,rotate}
.mcard{border-radius:34px;padding:44px 46px;backdrop-filter:blur(14px)}
.phone{position:absolute;left:70px;right:70px;top:300px;bottom:300px;border-radius:44px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.35)}
.phead{position:absolute;top:0;left:0;right:0;height:96px;display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700;padding:0 36px}
.pdot{width:26px;height:26px;border-radius:50%;display:inline-block}
.pbody{position:absolute;top:130px;left:28px;right:28px;bottom:36px;display:flex;flex-direction:column;gap:22px;justify-content:flex-end}
.bubble{max-width:78%;padding:24px 30px;border-radius:26px;font-size:42px;line-height:1.3;opacity:0;will-change:transform,opacity}
.bubble.left{align-self:flex-start;border-bottom-left-radius:6px}
.bubble.right{align-self:flex-end;border-bottom-right-radius:6px}
.tdots{align-self:flex-start;padding:18px 26px;border-radius:22px;display:flex;gap:12px;opacity:0;visibility:hidden}
.tdots i{width:14px;height:14px;border-radius:50%;background:#9aa0ab;display:inline-block;will-change:transform}
#dip{position:absolute;inset:0;opacity:0;pointer-events:none;will-change:opacity}
#progresswrap{position:absolute;left:0;right:0;bottom:0;height:10px;background:rgba(255,255,255,0.14)}
#progress{height:100%;width:0;background:linear-gradient(90deg,#ff2e63,#ffb703);will-change:width}
`;

const RUNTIME = `
var DUR={{DUR}};
var FPS={{FPS}};
var DEFS={{DEFS}};
var BOUNDS={{BOUNDS}};
function ph(t,a,b){if(b<=a)return 1;var u=(t-a)/(b-a);return u<0?0:u>1?1:u;}
function eo(u){return 1-Math.pow(1-u,3);}
function ec(u){return u<0.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;}
function eb(u){var c1=1.70158,c3=c1+1;return 1+c3*Math.pow(u-1,3)+c1*Math.pow(u-1,2);}
function RW(t,S){for(var i=0;i<S.words.length;i++){var sp=S.words[i];var at=+sp.dataset.at;var pr=ph(t,at,at+260);
if(pr<=0){sp.style.opacity='0';sp.style.transform='translateY(0.45em)';}
else if(pr>=1){sp.style.opacity='1';sp.style.transform='translateY(0)';}
else{var e=eo(pr);var tf='translateY('+(0.45*(1-e)).toFixed(3)+'em)';if(S.em&&pr<1)tf+=' scale('+(0.85+0.15*eb(pr)).toFixed(3)+')';sp.style.opacity=String(pr);sp.style.transform=tf;}}}
var SCENES=[];
DEFS.forEach(function(def,i){
  var el=document.getElementById('s'+i);
  var S=(new Function('root',def.init))(el);
  S.el=el;S.cam=el.querySelector('.cam');S.words=[].slice.call(el.querySelectorAll('.w'));
  S.dur=def.dur;S.cameras=def.cam;S.tr=def.tr;S.em=def.em;
  S.frame=new Function('t','d','S','RW','ph','eo','ec','eb',def.frame);
  SCENES.push(S);
});
var dip=document.getElementById('dip');
var progress=document.getElementById('progress');
function applyCam(S,t,d){
  var cam=S.cameras,tr='';
  if(cam==='zoom_in')tr='scale('+(1.18-0.18*eo(ph(t,0,Math.min(d,900)))).toFixed(4)+')';
  else if(cam==='zoom_out')tr='scale('+(1+0.16*eo(ph(t,0,d))).toFixed(4)+')';
  else if(cam==='pan_left')tr='translateX('+(-6*eo(ph(t,0,d))).toFixed(2)+'%) scale(1.08)';
  else if(cam==='pan_right')tr='translateX('+(6*eo(ph(t,0,d))).toFixed(2)+'%) scale(1.08)';
  else if(cam==='tilt_up')tr='translateY('+(4-6*eo(ph(t,0,d))).toFixed(2)+'%) scale(1.08)';
  else if(cam==='shake'){var k=Math.max(0,1-t/650);tr='translate('+(Math.sin(t*0.09)*10*k).toFixed(1)+'px,'+(Math.cos(t*0.11)*8*k).toFixed(1)+'px)';}
  else tr='scale('+(1+0.035*(t/d)).toFixed(4)+')';
  S.cam.style.transform=tr;
}
window.__film={durationMs:DUR,fps:FPS,width:{{W}},height:{{H}},t:0,ready:false,seek:function(ms){
  var t=Math.max(0,Math.min(ms,DUR-0.001));
  var acc=0,ai=SCENES.length-1;
  for(var i=0;i<SCENES.length;i++){if(t<acc+SCENES[i].dur){ai=i;break;}acc+=SCENES[i].dur;}
  var S=SCENES[ai];var local=t-acc;
  for(var j=0;j<SCENES.length;j++){SCENES[j].el.style.visibility=j===ai?'visible':'hidden';}
  var op=1,sl='translateX(0)';
  if(S.tr==='fade')op=ph(local,0,340);
  else if(S.tr==='slide'){var pp=eo(ph(local,0,420));sl='translateX('+((1-pp)*9).toFixed(2)+'%)';op=pp;}
  S.el.style.opacity=String(op);S.el.style.transform=sl;
  var dop=0,dcol='#000';
  for(var b=0;b<BOUNDS.length;b++){var bd=BOUNDS[b];if(bd.kind==='dip_to_black'||bd.kind==='dip_to_white'){var w=270;
    if(t>bd.t-w&&t<bd.t+w){var o=1-Math.abs(t-bd.t)/w;if(o>dop){dop=o;dcol=bd.kind==='dip_to_white'?'#fff':'#000';}}}}
  if(dop>0){dip.style.background=dcol;dip.style.opacity=String(dop);}else{dip.style.opacity='0';}
  applyCam(S,local,S.dur);
  S.frame(local,S.dur,S,RW,ph,eo,ec,eb);
  progress.style.width=(t/DUR*100).toFixed(3)+'%';
  window.__film.t=t;
}};
window.__film.seek(0);
if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){window.__film.ready=true;});}
setTimeout(function(){window.__film.ready=true;},2500);
`;

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
export function buildFilm(plan, opts = {}) {
  const width = opts.width || 1080;
  const height = opts.height || 1920;
  const fps = opts.fps || 30;
  const dayIndex = opts.dayIndex ?? 0;
  const seed = hash32((plan.title || '') + '|' + (plan.concept || '') + '|' + dayIndex);

  const ctx = {
    seed,
    dayIndex,
    title: plan.title || 'Reel',
    pal: (scene) => PALETTES[scene.mood] || PALETTES.bold,
  };

  const defs = [];
  const sections = [];
  let accMs = 0;
  const bounds = [];

  plan.scenes.forEach((scene, i) => {
    const builder = BUILDERS[plan.template] || BUILDERS.kinetic;
    const { html, init, frame } = builder(scene, i, ctx);
    const durMs = Math.round(scene.duration_sec * 1000);
    if (i > 0 && (scene.transition_in === 'dip_to_black' || scene.transition_in === 'dip_to_white')) {
      bounds.push({ t: accMs, kind: scene.transition_in });
    }
    sections.push(
      `<section class="scene" id="s${i}"><div class="cam">${html}</div></section>`,
    );
    defs.push({ dur: durMs, cam: scene.camera, tr: scene.transition_in, em: scene.emphasis === 'hard', init, frame });
    accMs += durMs;
  });

  const durationMs = accMs;
  const css = CSS.replace(/\{\{W\}\}/g, String(width)).replace(/\{\{H\}\}/g, String(height));
  let runtime = RUNTIME
    .replace(/\{\{DUR\}\}/g, String(durationMs))
    .replace(/\{\{FPS\}\}/g, String(fps))
    .replace(/\{\{W\}\}/g, String(width))
    .replace(/\{\{H\}\}/g, String(height))
    .replace(/\{\{DEFS\}\}/g, JSON.stringify(defs))
    .replace(/\{\{BOUNDS\}\}/g, JSON.stringify(bounds));

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(plan.title || 'Reel')}</title>
<style>{{FONTS}}${css}</style></head>
<body><div id="stage">
${sections.join('\n')}
<div id="dip"></div>
<div id="progresswrap"><div id="progress"></div></div>
</div>
<script>${runtime}</script>
</body></html>`;

  return { html: html.replace('{{FONTS}}', opts.fontCSS || ''), durationMs, fps, width, height };
}
