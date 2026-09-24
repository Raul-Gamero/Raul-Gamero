#!/usr/bin/env node
/**
 * Builds the animated SVG assets used by README.md.
 *
 *   npm install
 *   npm run build
 *
 * Every SVG is self-contained (no external fonts, images or scripts), so it
 * renders on GitHub exactly as it does locally. Animations are pure CSS and
 * respect `prefers-reduced-motion`. Icons: Simple Icons (CC0) and Devicon (MIT).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as simpleIcons from 'simple-icons';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');
const DEVICON = join(ROOT, 'node_modules', 'devicon', 'icons');

// ------------------------------------------------------------------ theme --
const C = {
  bg0: '#0B1220', bg1: '#1A2540', panel: '#0F1729', tile: '#16213A', well: '#0A101D',
  border: '#24324D', borderHi: '#3B4D72', text: '#E8EEF8', soft: '#CBD5E1', muted: '#94A3B8', dim: '#64748B',
  cyan: '#22D3EE', yellow: '#FACC15', orange: '#FB923C', green: '#A3E635',
  blue: '#60A5FA', violet: '#A78BFA', pink: '#F472B6', teal: '#34D399', sky: '#38BDF8',
};
const SANS = `'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace`;
// Monospace advance in em. Enforced with textLength so typing effects line up in any font.
const CW = 0.61;

const BASE_CSS = `
.sans{font-family:${SANS}}
.mono{font-family:${MONO}}
.b{font-weight:700}
.pop{transform-box:fill-box;transform-origin:center;animation:pop .7s cubic-bezier(.2,.8,.2,1) both}
.rise{animation:rise .9s cubic-bezier(.2,.8,.2,1) both}
.fade{animation:fade 1s ease both}
@keyframes pop{from{opacity:0;transform:translateY(10px) scale(.85)}to{opacity:1;transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

// ---------------------------------------------------------------- helpers --
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r = (n) => Math.round(n * 100) / 100;
const len = (s) => [...s].length;
const delay = (s) => `style="animation-delay:${r(s)}s"`;

const SI = Object.fromEntries(Object.values(simpleIcons).filter((i) => i && i.slug).map((i) => [i.slug, i]));

function luminance(hex) {
  const [R, G, B] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

let uid = 0;
/** Inline an icon as a nested <svg>. spec: {si, color?} | {dev, color?} | {draw: 'globe'} */
function icon(spec, x, y, size) {
  if (spec.si) {
    const ic = SI[spec.si];
    if (!ic) throw new Error(`Unknown Simple Icon: ${spec.si}`);
    let color = spec.color || `#${ic.hex}`;
    if (luminance(color) < 0.1) color = C.text; // keep dark logos visible on the dark theme
    return `<svg x="${r(x)}" y="${r(y)}" width="${size}" height="${size}" viewBox="0 0 24 24"><path fill="${color}" d="${ic.path}"/></svg>`;
  }
  if (spec.dev) {
    const raw = readFileSync(join(DEVICON, spec.dev), 'utf8');
    const viewBox = raw.match(/viewBox="([^"]+)"/)[1];
    const p = `i${++uid}-`;
    let inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
      .replace(/id="([^"]+)"/g, `id="${p}$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`)
      .replace(/(?:xlink:)?href="#([^"]+)"/g, `href="#${p}$1"`);
    if (spec.color) inner = `<g fill="${spec.color}">${inner.replace(/\sfill="[^"]*"/g, '')}</g>`;
    return `<svg x="${r(x)}" y="${r(y)}" width="${size}" height="${size}" viewBox="${viewBox}">${inner}</svg>`;
  }
  if (spec.draw === 'globe') {
    const s = size / 24;
    return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s)})" fill="none" stroke="#93C5FD" stroke-width="1.6">
<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4.2" ry="10"/><path d="M2 12h20M3.6 7h16.8M3.6 17h16.8"/></g>`;
  }
  throw new Error(`Bad icon spec ${JSON.stringify(spec)}`);
}

/** Monospace text with a fixed advance per character. runs: string | [text, color][] */
function mono(x, y, size, runs, attrs = '') {
  const arr = typeof runs === 'string' ? [[runs, C.text]] : runs;
  const n = arr.reduce((acc, [t]) => acc + len(t), 0);
  const spans = arr.map(([t, c]) => `<tspan fill="${c}">${esc(t)}</tspan>`).join('');
  return `<text class="mono" x="${r(x)}" y="${r(y)}" font-size="${size}" textLength="${r(n * size * CW)}" lengthAdjust="spacing" xml:space="preserve" ${attrs}>${spans}</text>`;
}

function text(x, y, size, str, { fill = C.text, weight = 400, anchor = 'start', cls = 'sans', extra = '' } = {}) {
  return `<text class="${cls}" x="${r(x)}" y="${r(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${extra}>${esc(str)}</text>`;
}

function svgDoc({ w, h, title, css = '', defs = '', body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${BASE_CSS}${css}</style>
<defs>${defs}</defs>
${body}
</svg>
`;
}

/** Rounded dark card with a diagonal light sweep every few seconds. */
function card(w, h, { accent, rx = 18, sweepEvery = 9, id = 'card' } = {}) {
  const defs = `
<clipPath id="${id}-clip"><rect width="${w}" height="${h}" rx="${rx}"/></clipPath>
<linearGradient id="${id}-sheen" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const css = `.${id}-sheen{animation:${id}-sheen ${sweepEvery}s ease-in-out 1.2s infinite}
@keyframes ${id}-sheen{0%{transform:translateX(0)}30%,100%{transform:translateX(${w + 500}px)}}`;
  const open = `<g clip-path="url(#${id}-clip)">
<rect width="${w}" height="${h}" fill="${C.panel}"/>
${accent ? `<rect width="6" height="${h}" fill="${accent}"/>` : ''}
<g class="${id}-sheen"><rect x="-320" y="-40" width="220" height="${h + 80}" fill="url(#${id}-sheen)" transform="skewX(-18)"/></g>`;
  const close = `</g><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="none" stroke="${C.border}"/>`;
  return { defs, css, open, close };
}

// ------------------------------------------------------------------- data --
const STACK = [
  {
    id: 'frontend', title: 'Frontend', comment: '<UI responsive accessible fast />', accent: C.cyan,
    items: [
      ['Next.js', { si: 'nextdotjs' }], ['React', { si: 'react' }], ['Angular', { si: 'angular', color: '#DD0031' }],
      ['TypeScript', { si: 'typescript' }], ['JavaScript', { si: 'javascript' }], ['Tailwind CSS', { si: 'tailwindcss' }],
      ['Bootstrap', { si: 'bootstrap', color: '#8E6CEF' }], ['TanStack', { si: 'tanstack' }], ['HTML5', { si: 'html5' }], ['CSS', { si: 'css', color: '#8B5CF6' }],
    ],
  },
  {
    id: 'mobile', title: 'Mobile & Multiplatform', comment: '// build once, ship everywhere', accent: C.violet,
    items: [
      ['Flutter', { si: 'flutter', color: '#47C5FB' }], ['Dart', { si: 'dart', color: '#1FB5F0' }], ['React Native', { si: 'react' }],
      ['Expo', { si: 'expo' }], ['Ionic', { si: 'ionic', color: '#4D8DFF' }], ['Capacitor', { si: 'capacitor' }],
      ['.NET MAUI', { si: 'dotnet', color: '#8B6CF0' }], ['C#', { dev: 'csharp/csharp-original.svg' }], ['Kotlin', { si: 'kotlin', color: '#A97BFF' }],
      ['Android', { si: 'android' }], ['PWA', { si: 'pwa', color: '#9D6CFF' }],
    ],
    chipLabel: '// targets', chips: ['Android', 'iOS', 'Web', 'Windows', 'macOS'],
  },
  {
    id: 'backend', title: 'Backend & APIs', comment: '@RestController · async def api()', accent: C.green,
    items: [
      ['Python', { si: 'python', color: '#4B8BBE' }], ['FastAPI', { si: 'fastapi' }], ['Flask', { si: 'flask' }],
      ['Java', { dev: 'java/java-original.svg' }], ['Spring Boot', { si: 'springboot' }], ['Hibernate/JPA', { si: 'hibernate', color: '#BCAE79' }],
      ['PHP', { si: 'php', color: '#8993BE' }], ['Stripe', { si: 'stripe', color: '#7A73FF' }],
    ],
    chipLabel: '// plus', chips: ['REST APIs', 'Webhooks', 'CRM integrations', 'Payment workflows'],
  },
  {
    id: 'devops', title: 'Databases, DevOps & Cloud', comment: '$ docker compose up -d', accent: C.blue,
    items: [
      ['PostgreSQL', { si: 'postgresql', color: '#5B8DEF' }], ['Supabase', { si: 'supabase' }], ['Redis', { si: 'redis' }],
      ['SQLite', { si: 'sqlite', color: '#44A8E0' }], ['Docker', { si: 'docker' }], ['Nginx', { si: 'nginx' }],
      ['GitHub Actions', { si: 'githubactions' }], ['Vercel', { si: 'vercel' }], ['Railway', { si: 'railway' }],
      ['Linux', { si: 'linux' }], ['Git', { si: 'git' }],
    ],
    chipLabel: '// plus', chips: ['CI/CD pipelines', 'Containerized services', 'HTTPS', 'SQL', 'Cloud deployment'],
  },
  {
    id: 'ai', title: 'AI & Automation', comment: 'await workflow.run({ ai: true })', accent: C.pink,
    items: [
      ['n8n', { si: 'n8n' }], ['Mistral AI', { si: 'mistralai' }], ['Ollama', { si: 'ollama' }], ['Llama 3', { si: 'meta' }],
    ],
    chipLabel: '// plus', chips: ['Botpress', 'GoHighLevel', 'Prompt Engineering', 'AI Classification', 'Data Enrichment', 'Workflow Automation', 'CRM Automation'],
  },
  {
    id: 'growth', title: 'Growth, SEO & E-commerce', comment: "gtag('event', 'purchase')", accent: C.orange,
    items: [
      ['Shopify', { si: 'shopify', color: '#95BF47' }], ['Analytics', { si: 'googleanalytics' }], ['Tag Manager', { si: 'googletagmanager', color: '#4C8BF5' }],
      ['Search Console', { si: 'googlesearchconsole' }], ['WordPress', { si: 'wordpress', color: '#3F9FD8' }], ['Elementor', { si: 'elementor', color: '#E2336B' }],
      ['Meta Business', { si: 'meta' }],
    ],
    chipLabel: '// channels', chips: ['Google Merchant Center', 'Amazon Seller Central', 'Amazon Ads', 'Mirakl', 'Channable', 'Miravia', 'AliExpress', 'Temu', 'Decathlon', 'Worten', 'SEO'],
  },
];

const FRAMEWORKS = [
  { name: 'Flutter', sub: 'Dart · Material widgets', icon: { si: 'flutter', color: '#47C5FB' }, color: C.sky, targets: ['android', 'ios', 'web'] },
  { name: 'React Native', sub: 'Expo SDK 51 · JavaScript', icon: { si: 'react' }, color: C.teal, targets: ['android', 'ios', 'web'] },
  { name: 'Ionic', sub: 'Angular 17 · Capacitor 6', icon: { si: 'ionic', color: '#4D8DFF' }, color: C.yellow, targets: ['android', 'ios', 'web'] },
  { name: '.NET MAUI', sub: 'C# · XAML · .NET 10', icon: { si: 'dotnet', color: '#8B6CF0' }, color: C.violet, targets: ['android', 'ios', 'windows', 'macos'] },
  { name: 'Kotlin', sub: 'Android SDK 34 · Gradle KTS', icon: { si: 'kotlin', color: '#A97BFF' }, color: C.pink, targets: ['android'] },
];
const PLATFORMS = [
  { id: 'android', name: 'Android', sub: 'Phones & tablets', icon: { si: 'android' } },
  { id: 'ios', name: 'iOS', sub: 'iPhone & iPad', icon: { si: 'apple' } },
  { id: 'web', name: 'Web / PWA', sub: 'Any browser', icon: { draw: 'globe' } },
  { id: 'windows', name: 'Windows', sub: 'Desktop', icon: { dev: 'windows11/windows11-original.svg', color: '#3B9BF0' } },
  { id: 'macos', name: 'macOS', sub: 'Desktop', icon: { si: 'apple' } },
];

const PROJECTS = [
  {
    file: 'project-flutter', repo: 'ActividadFlutterApp', icon: { si: 'flutter', color: '#47C5FB' }, accent: C.sky,
    tech: 'Flutter 3 · Dart · Material',
    desc: 'Number-sum calculator using Material widgets, StatefulWidget state, TextEditingController input and safe double parsing.',
    platforms: ['Android', 'iOS', 'Web'], lang: ['Dart', '#00B4AB'],
  },
  {
    file: 'project-react-native', repo: 'ActividadReactNativeApp', icon: { si: 'react' }, accent: C.teal,
    tech: 'React Native 0.74 · Expo SDK 51',
    desc: 'Five exercises unified in one tabbed app: Checkbox, RadioButton and Picker calculators plus a fruit catalog with images, prices and stock.',
    platforms: ['Android', 'iOS', 'Web'], lang: ['JavaScript', '#F1E05A'],
  },
  {
    file: 'project-ionic', repo: 'ActividadIonicApp', icon: { si: 'ionic', color: '#4D8DFF' }, accent: C.yellow,
    tech: 'Ionic 7 · Angular 17 · Capacitor 6',
    desc: 'Hybrid app with two-way binding, input validation and async REST API consumption rendered in ion-list. Capacitor-ready for native builds.',
    platforms: ['Android', 'iOS', 'Web'], lang: ['TypeScript', '#3178C6'],
  },
  {
    file: 'project-maui', repo: 'ActividadMauiApp', icon: { si: 'dotnet', color: '#8B6CF0' }, accent: C.violet,
    tech: '.NET MAUI · C# · XAML · .NET 10',
    desc: 'Single-project app with Shell navigation: RadioButton, CheckBox and Picker calculators plus an ObservableCollection-backed ListView.',
    platforms: ['Android', 'iOS', 'Windows', 'macOS'], lang: ['C#', '#178600'],
  },
  {
    file: 'project-kotlin', repo: 'EjerciciosKotlin', icon: { si: 'kotlin', color: '#A97BFF' }, accent: C.pink,
    tech: 'Kotlin · Android SDK 34 · Gradle KTS',
    desc: 'Ten native Android modules: Intents, WebView, SharedPreferences, file storage, SQLite CRUD, Canvas custom views and media recording.',
    platforms: ['Android'], lang: ['Kotlin', '#A97BFF'],
  },
];

// ----------------------------------------------------------------- header --
function buildHeader() {
  const W = 1200, H = 366;
  const lines = [
    'Full-Stack & Mobile Engineer',
    'Flutter · React Native · Ionic · .NET MAUI · Kotlin',
    'AI Automation · n8n · Mistral AI · Ollama · Llama 3',
    'Next.js · Angular · Spring Boot · FastAPI · Supabase',
    'Trilingual EN · FR · ES — remote, worldwide',
  ];
  const fs = 20, cw = fs * CW;
  const pill = { x: 170, y: 280, w: 860, h: 54 };
  const x0 = pill.x + 60, baseY = pill.y + 34;

  // Typing loop: type → hold → erase → next line.
  const TYPE = 0.045, ERASE = 0.018, HOLD = 2.4, GAP = 0.35;
  let t = 0;
  const seg = lines.map((s) => {
    const n = len(s), a = t, b = a + n * TYPE, c = b + HOLD, d = c + n * ERASE, e = d + GAP;
    t = e;
    return { n, a, b, c, d, e };
  });
  const T = t;
  const pct = (v) => `${(v / T * 100).toFixed(3)}%`;
  let typeKf = '';
  for (const { n, a, b, c, d } of seg) {
    const w = r(n * cw);
    typeKf += `${pct(a)}{transform:translateX(0);animation-timing-function:steps(${n},end)}`;
    typeKf += `${pct(b)}{transform:translateX(${w}px);animation-timing-function:linear}`;
    typeKf += `${pct(c)}{transform:translateX(${w}px);animation-timing-function:steps(${n},end)}`;
    typeKf += `${pct(d)}{transform:translateX(0);animation-timing-function:linear}`;
  }
  typeKf += '100%{transform:translateX(0)}';
  const lineCss = seg.map(({ a, e }, k) => {
    const frames = k === 0 ? `0%{opacity:1}${pct(e)}{opacity:0}100%{opacity:0}` : `0%{opacity:0}${pct(a)}{opacity:1}${pct(e)}{opacity:0}100%{opacity:0}`;
    return `@keyframes l${k}{${frames}}.l${k}{opacity:${k === 0 ? 1 : 0};animation:l${k} ${r(T)}s step-end infinite}`;
  }).join('');

  const F = { x: 290, y: 34, w: 620, h: 186 };
  const gap = 400, cx = W / 2;
  const framePath = `M${cx - gap / 2} ${F.y + F.h}H${F.x}V${F.y}H${F.x + F.w}V${F.y + F.h}H${cx + gap / 2}`;

  const glyphs = [
    ['</>', 46, 70, 30, C.cyan, 7, 0], ['[ ]', 226, 76, 22, C.blue, 8, 1.2], ['{ }', 222, 186, 26, C.yellow, 9, 0.6],
    ['=>', 70, 322, 24, C.orange, 7.5, 2], ['#', 948, 74, 26, C.orange, 8.5, 0.4], ['λ', 1148, 70, 32, C.violet, 7, 1.6],
    [';', 1168, 196, 34, C.pink, 9, 0.9], ['( )', 1080, 322, 24, C.green, 8, 2.4],
  ];
  const glyphSvg = glyphs.map(([g, x, y, s, col, dur, dl]) =>
    `<text class="mono glyph" x="${x}" y="${y}" font-size="${s}" fill="${col}" style="animation-duration:${dur}s;animation-delay:-${dl}s">${esc(g)}</text>`).join('\n');

  const css = `
.glow{transform-box:fill-box;transform-origin:center;animation:pulse 9s ease-in-out infinite}
.glow.b{animation-delay:-4.5s}
@keyframes pulse{0%,100%{opacity:.65;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}
.glyph{opacity:.4;animation:float 8s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.frame{stroke-dasharray:1;stroke-dashoffset:0;animation:draw 1.8s cubic-bezier(.6,0,.2,1) both}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.device{animation:float 10s ease-in-out infinite}
.code{transform-box:fill-box;transform-origin:left center;animation:code 6s ease-in-out infinite}
@keyframes code{0%{transform:scaleX(0)}20%,80%{transform:scaleX(1)}100%{transform:scaleX(0)}}
.skel{animation:skel 2.4s ease-in-out infinite}
@keyframes skel{0%,100%{opacity:.35}50%{opacity:.8}}
.cover{transform:translateX(${r(seg[0].n * cw)}px);animation:type ${r(T)}s infinite}
@keyframes type{${typeKf}}
${lineCss}
.caret{animation:blink 1s step-end infinite}
.bar{animation:barshift 6s linear infinite}
@keyframes barshift{to{transform:translateX(-600px)}}`;

  const defs = `
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></linearGradient>
<radialGradient id="ga"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".28"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>
<radialGradient id="gb"><stop offset="0" stop-color="${C.violet}" stop-opacity=".3"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${C.muted}" opacity=".16"/></pattern>
<linearGradient id="bar" x1="0" x2="600" gradientUnits="userSpaceOnUse" spreadMethod="repeat"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".33" stop-color="${C.yellow}"/><stop offset=".66" stop-color="${C.orange}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>
<clipPath id="round"><rect width="${W}" height="${H}" rx="20"/></clipPath>
<clipPath id="pill"><rect x="${pill.x + 1}" y="${pill.y + 1}" width="${pill.w - 2}" height="${pill.h - 2}" rx="${pill.h / 2 - 1}"/></clipPath>`;

  const phone = `<g class="device" style="animation-delay:-2s" fill="none" stroke="${C.borderHi}" stroke-width="2">
<rect x="112" y="92" width="78" height="142" rx="14"/><rect x="136" y="99" width="30" height="5" rx="2.5" fill="${C.borderHi}" stroke="none"/>
<rect class="skel" x="122" y="116" width="58" height="14" rx="4" fill="${C.violet}" fill-opacity=".45" stroke="none"/>
<rect class="skel" x="122" y="138" width="58" height="36" rx="6" fill="${C.cyan}" fill-opacity=".25" stroke="none" style="animation-delay:.4s"/>
<rect class="skel" x="122" y="182" width="40" height="6" rx="3" fill="${C.muted}" fill-opacity=".5" stroke="none" style="animation-delay:.8s"/>
<rect class="skel" x="122" y="194" width="52" height="6" rx="3" fill="${C.muted}" fill-opacity=".5" stroke="none" style="animation-delay:1.2s"/>
<rect x="138" y="218" width="26" height="4" rx="2" fill="${C.borderHi}" stroke="none"/></g>`;
  const laptop = `<g class="device" fill="none" stroke="${C.borderHi}" stroke-width="2">
<rect x="982" y="100" width="156" height="98" rx="8"/>
<path d="M966 206h188l-10 12H976z" fill="${C.borderHi}" fill-opacity=".35"/>
<rect class="code" x="996" y="116" width="54" height="7" rx="3.5" fill="${C.cyan}" stroke="none"/>
<rect class="code" x="1008" y="132" width="96" height="7" rx="3.5" fill="${C.yellow}" fill-opacity=".85" stroke="none" style="animation-delay:.3s"/>
<rect class="code" x="1008" y="148" width="72" height="7" rx="3.5" fill="${C.orange}" fill-opacity=".85" stroke="none" style="animation-delay:.6s"/>
<rect class="code" x="1008" y="164" width="84" height="7" rx="3.5" fill="${C.green}" fill-opacity=".8" stroke="none" style="animation-delay:.9s"/>
<rect class="code" x="996" y="180" width="30" height="7" rx="3.5" fill="${C.cyan}" stroke="none" style="animation-delay:1.2s"/></g>`;

  const body = `<g clip-path="url(#round)">
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
<circle class="glow" cx="140" cy="40" r="300" fill="url(#ga)"/>
<circle class="glow b" cx="1080" cy="350" r="320" fill="url(#gb)"/>
${glyphSvg}
${phone}
${laptop}
<path class="frame" d="${framePath}" pathLength="1" fill="none" stroke="#F1F5F9" stroke-width="2.5"/>
<g class="rise" ${delay(0.5)}>${text(cx, 120, 66, 'RAUL GAMERO', { weight: 700, anchor: 'middle', fill: '#F8FAFC', extra: 'textLength="560" lengthAdjust="spacing"' })}</g>
<g class="rise" ${delay(0.8)}>${text(cx, 170, 19, 'FULL-STACK & MOBILE ENGINEER', { weight: 700, anchor: 'middle', fill: '#E2E8F0', extra: 'font-style="italic" textLength="470" lengthAdjust="spacing"' })}</g>
<g class="rise" ${delay(1.1)}>${text(cx, 227, 18, 'MULTIPLATFORM DEVELOPER', { weight: 700, anchor: 'middle', fill: C.cyan, extra: 'font-style="italic" textLength="360" lengthAdjust="spacing"' })}</g>
<g class="rise" ${delay(1.3)}>${text(cx, 260, 15, 'AI AUTOMATION SPECIALIST', { weight: 700, anchor: 'middle', fill: '#AFC0D8', extra: 'textLength="330" lengthAdjust="spacing"' })}</g>
<g class="fade" ${delay(1.5)}>
<rect x="${pill.x}" y="${pill.y}" width="${pill.w}" height="${pill.h}" rx="${pill.h / 2}" fill="${C.well}" stroke="#2A3A5C" stroke-width="1.5"/>
${mono(pill.x + 30, baseY, fs, [['$', C.green]])}
${lines.map((s, k) => `<g class="l${k}">${mono(x0, baseY, fs, s)}</g>`).join('\n')}
<g clip-path="url(#pill)"><g class="cover"><rect x="${x0}" y="${pill.y}" width="${pill.w}" height="${pill.h}" fill="${C.well}"/><rect class="caret" x="${x0 - 1}" y="${baseY - 19}" width="3" height="24" rx="1" fill="${C.cyan}"/></g></g>
</g>
<g class="bar"><rect width="${W + 600}" height="4" fill="url(#bar)"/></g>
</g>`;
  return svgDoc({ w: W, h: H, title: 'Raul Gamero — Full-Stack & Mobile Engineer, Multiplatform Developer and AI Automation Specialist', css, defs, body });
}

// --------------------------------------------------------------- terminal --
function buildTerminal() {
  const W = 1200, fs = 17, lh = 28, top = 84, left = 40;
  const key = (s) => [s, '#7DD3FC'], str = (s) => [`'${s}'`, '#86EFAC'], pun = (s) => [s, C.muted];
  const list = (k, vals) => [key(`  ${k}`), pun(': ['), ...vals.flatMap((v, i) => (i ? [pun(', '), str(v)] : [str(v)])), pun('],')];
  const output = [
    [pun('{')],
    [key('  name'), pun(': '), str('Raul Gamero'), pun(',')],
    list('role', ['Full-Stack & Mobile Engineer', 'AI Automation Specialist']),
    list('multiplatform', ['Flutter', 'React Native', 'Ionic', '.NET MAUI', 'Kotlin']),
    list('buildsEndToEnd', ['Web', 'Mobile', 'SaaS', 'E-commerce', 'Automation']),
    list('clients', ['Europe', 'United States']),
    [key('  languages'), pun(': { '), key('en'), pun(': '), str('C2'), pun(', '), key('fr'), pun(': '), str('C2'), pun(', '), key('es'), pun(': '), str('Native'), pun(', '), key('de'), pun(': '), str('A2'), pun(' },')],
    [key('  location'), pun(': '), str('Work From Anywhere'), pun(',')],
    [key('  openTo'), pun(': '), str('Remote & international projects')],
    [pun('}')],
  ];
  const H = top + (output.length + 3) * lh + 18;
  const cw = fs * CW;

  // Typed commands
  const cmd1 = { prompt: [['raul@gamero', C.green], [':', C.muted], ['~', C.blue], ['$ ', C.muted]], cmd: 'node', start: 0.5 };
  const cmd2 = { prompt: [['> ', C.dim]], cmd: [['console', C.cyan], ['.', C.yellow], ['log', C.orange], ['(', C.yellow], ['profile', C.violet], [')', C.yellow], [';', C.text]], start: 1.5 };
  const typed = (c, y, idx) => {
    const pLen = c.prompt.reduce((n, [s]) => n + len(s), 0);
    const runs = typeof c.cmd === 'string' ? [[c.cmd, C.text]] : c.cmd;
    const n = runs.reduce((acc, [s]) => acc + len(s), 0);
    const x0 = left + pLen * cw, w = r(n * cw), dur = r(n * 0.055);
    return {
      end: c.start + dur,
      css: `.t${idx}{transform:translateX(${w}px);animation:t${idx} ${dur}s steps(${n},end) ${c.start}s both}@keyframes t${idx}{from{transform:translateX(0)}to{transform:translateX(${w}px)}}
.c${idx}{animation:blink .9s step-end infinite,hide 0s linear ${r(c.start + dur + 0.25)}s forwards}`,
      svg: `<g class="fade" ${delay(c.start - 0.3)}>${mono(left, y, fs, [...c.prompt, ...runs])}
<g class="t${idx}"><rect x="${r(x0)}" y="${y - 20}" width="${r(w + 24)}" height="${lh}" fill="${C.well}"/><rect class="c${idx} tcaret" x="${r(x0)}" y="${y - 15}" width="9" height="19" fill="${C.cyan}" fill-opacity=".85"/></g></g>`,
    };
  };
  const l1 = typed(cmd1, top, 1), l2 = typed(cmd2, top + lh, 2);
  const outStart = l2.end + 0.35;
  const outSvg = output.map((runs, i) => `<g class="rise" ${delay(outStart + i * 0.09)}>${mono(left, top + (i + 2) * lh, fs, runs)}</g>`).join('\n');
  const lastY = top + (output.length + 2) * lh;
  const finalPrompt = `<g class="fade" ${delay(outStart + output.length * 0.09 + 0.2)}>${mono(left, lastY, fs, [['> ', C.dim]])}<rect class="caret" x="${r(left + 2 * cw)}" y="${lastY - 15}" width="9" height="19" fill="${C.cyan}" fill-opacity=".85"/></g>`;

  // Side pane with quick stats
  const pane = 900;
  const stats = [
    ['10+', 'marketplaces automated with AI', C.cyan],
    ['5', 'multiplatform frameworks', C.violet],
    ['3', 'working languages · EN FR ES', C.green],
    ['2022', 'shipping digital products since', C.orange],
  ];
  const statSvg = stats.map(([num, label, col], i) => {
    const y = top + 44 + i * 90;
    return `<g class="rise" ${delay(outStart + 0.3 + i * 0.15)}>
${text(pane + 36, y, 36, num, { weight: 800, fill: col })}
${text(pane + 36, y + 26, 15, label, { fill: C.soft })}</g>`;
  }).join('\n');

  const css = `${l1.css}${l2.css}
@keyframes hide{to{visibility:hidden}}
.caret{animation:blink .9s step-end infinite}
@media (prefers-reduced-motion:reduce){.tcaret{visibility:hidden}}`;
  const defs = `<clipPath id="win"><rect width="${W}" height="${H}" rx="16"/></clipPath>`;
  const body = `<g clip-path="url(#win)">
<rect width="${W}" height="${H}" fill="${C.well}"/>
<rect width="${W}" height="44" fill="#121B2E"/>
<circle cx="28" cy="22" r="7" fill="#FF5F56"/><circle cx="50" cy="22" r="7" fill="#FFBD2E"/><circle cx="72" cy="22" r="7" fill="#27C93F"/>
${text(W / 2, 28, 15, 'raul@gamero: ~/profile — node', { anchor: 'middle', fill: C.muted, cls: 'mono' })}
<line x1="${pane}" y1="64" x2="${pane}" y2="${H - 24}" stroke="${C.border}" stroke-dasharray="4 6"/>
${mono(pane + 36, 76, 14, [['~/stats', C.dim]])}
${l1.svg}
${l2.svg}
${outSvg}
${finalPrompt}
${statSvg}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="${C.border}"/>`;
  return svgDoc({ w: W, h: H, title: 'console.log(profile): Raul Gamero, Full-Stack & Mobile Engineer and AI Automation Specialist. Multiplatform: Flutter, React Native, Ionic, .NET MAUI, Kotlin. Languages: English C2, French C2, Spanish native, German A2. Work from anywhere.', css, defs, body });
}

// ------------------------------------------------------------ stack cards --
function chipsLayout(chips, x0, y0, maxX, label) {
  const out = [];
  let x = x0, y = y0;
  if (label) {
    out.push(mono(x, y + 22, 15, [[label, C.dim]]));
    x += len(label) * 15 * CW + 14;
  }
  const startX = x;
  chips.forEach((c, i) => {
    const w = r(len(c) * 16 * 0.58 + 30);
    if (x + w > maxX) { x = startX; y += 46; }
    out.push(`<g class="pop" style="animation-delay:${r(0.9 + i * 0.05)}s"><rect x="${r(x)}" y="${y}" width="${w}" height="34" rx="17" fill="${C.tile}" stroke="#2B3B57"/>${text(x + w / 2, y + 22.5, 16, c, { anchor: 'middle', fill: C.soft })}</g>`);
    x += w + 10;
  });
  return { svg: out.join('\n'), bottom: y + 34 };
}

function buildStack({ id, title, comment, accent, items, chips, chipLabel }) {
  const W = 1200, pad = 40, head = 78, tileS = 72, rowH = tileS + 40;
  const perRow = Math.min(items.length, 11);
  const pitch = Math.min(106, (W - 2 * pad) / perRow);
  const rows = Math.ceil(items.length / perRow);
  const tilesBottom = head + rows * rowH;
  let chipSvg = '', H = tilesBottom + 14;
  if (chips?.length) {
    const c = chipsLayout(chips, pad, tilesBottom + 4, W - pad, chipLabel);
    chipSvg = c.svg;
    H = c.bottom + 30;
  }
  const k = card(W, H, { accent, id });
  const tiles = items.map(([label, spec], i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const x = pad + col * pitch + (pitch - tileS) / 2, y = head + row * rowH;
    return `<g class="pop" ${delay(0.15 + i * 0.07)}>
<rect class="tile" x="${r(x)}" y="${y}" width="${tileS}" height="${tileS}" rx="18" fill="${C.tile}" stroke="${C.border}" stroke-width="1.5" ${delay(i * 0.12)}/>
${icon(spec, x + 16, y + 16, 40)}
${text(x + tileS / 2, y + tileS + 25, 15, label, { anchor: 'middle', fill: C.soft })}</g>`;
  }).join('\n');
  const css = `${k.css}
.tile{animation:scan 7s ease-in-out infinite}
@keyframes scan{0%,82%,100%{stroke:${C.border}}88%{stroke:${accent}}}`;
  const body = `${k.open}
<g class="rise">${text(pad, 50, 28, title, { weight: 700 })}</g>
<g class="fade" ${delay(0.3)}>${mono(W - pad - len(comment) * 17 * CW, 50, 17, [[comment, accent]])}</g>
${tiles}
${chipSvg}
${k.close}`;
  const names = [...items.map(([l]) => l), ...(chips || [])].join(', ');
  return svgDoc({ w: W, h: H, title: `${title}: ${names}`, css, defs: k.defs, body });
}

// ------------------------------------------------- multiplatform diagram --
function buildMultiplatform() {
  const W = 1200, H = 540, top = 100, pitch = 84, nodeH = 64;
  const L = { x: 40, w: 370 }, R = { x: 880, w: 280 };
  const k = card(W, H, { accent: C.violet, id: 'mp' });
  const yOf = (i) => top + i * pitch;
  const pIndex = Object.fromEntries(PLATFORMS.map((p, i) => [p.id, i]));

  let edges = '', e = 0;
  FRAMEWORKS.forEach((f, i) => {
    f.targets.forEach((t) => {
      const y1 = yOf(i) + nodeH / 2, y2 = yOf(pIndex[t]) + nodeH / 2;
      const x1 = L.x + L.w, x2 = R.x;
      // Straight edges get a gentle bow: zero-height paths can be culled by some renderers.
      const bow = y1 === y2 ? 10 : 0;
      const d = `M${x1} ${y1}C${x1 + 200} ${y1 - bow} ${x2 - 200} ${y2 + bow} ${x2} ${y2}`;
      edges += `<path d="${d}" fill="none" stroke="#22304A" stroke-width="2"/>
<path class="flow" d="${d}" fill="none" stroke="${f.color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 14" stroke-opacity=".9" style="animation-delay:${r(1 + e * 0.08)}s,0s;animation-duration:.8s,${r(1.4 + (e % 3) * 0.3)}s"/>\n`;
      e++;
    });
  });

  const fNodes = FRAMEWORKS.map((f, i) => {
    const y = yOf(i);
    return `<g class="pop" ${delay(0.2 + i * 0.1)}>
<rect x="${L.x}" y="${y}" width="${L.w}" height="${nodeH}" rx="16" fill="${C.tile}" stroke="${C.border}" stroke-width="1.5"/>
<rect x="${L.x}" y="${y + 14}" width="4" height="${nodeH - 28}" rx="2" fill="${f.color}"/>
${icon(f.icon, L.x + 20, y + 14, 36)}
${text(L.x + 72, y + 28, 20, f.name, { weight: 700 })}
${mono(L.x + 72, y + 51, 15, [[f.sub, C.muted]])}
<circle cx="${L.x + L.w}" cy="${y + nodeH / 2}" r="5" fill="${f.color}"/></g>`;
  }).join('\n');

  const pNodes = PLATFORMS.map((p, i) => {
    const y = yOf(i);
    return `<g class="pop" ${delay(0.5 + i * 0.1)}>
<rect class="pnode" x="${R.x}" y="${y}" width="${R.w}" height="${nodeH}" rx="16" fill="${C.tile}" stroke="${C.border}" stroke-width="1.5" ${delay(i * 0.5)}/>
${icon(p.icon, R.x + 20, y + 15, 34)}
${text(R.x + 70, y + 29, 20, p.name, { weight: 700 })}
${text(R.x + 70, y + 51, 15, p.sub, { fill: C.muted })}
<circle cx="${R.x}" cy="${y + nodeH / 2}" r="5" fill="${C.soft}"/></g>`;
  }).join('\n');

  const css = `${k.css}
.flow{animation:fade .8s ease both,flow 1.6s linear infinite}
@keyframes flow{to{stroke-dashoffset:-36}}
.pnode{animation:ping 5s ease-in-out infinite}
@keyframes ping{0%,70%,100%{stroke:${C.border}}80%{stroke:${C.cyan}}}`;
  const body = `${k.open}
<g class="rise">${text(40, 54, 28, 'Multiplatform Toolkit', { weight: 700 })}</g>
<g class="fade" ${delay(0.3)}>${mono(W - 40 - len('// 5 frameworks → 5 platforms') * 17 * CW, 54, 17, [['// 5 frameworks → 5 platforms', C.violet]])}</g>
${mono(L.x, 86, 14, [['FRAMEWORK', C.dim]])}
${mono(R.x, 86, 14, [['TARGET PLATFORM', C.dim]])}
${edges}
${fNodes}
${pNodes}
${k.close}`;
  const summary = FRAMEWORKS.map((f) => `${f.name} → ${f.targets.map((t) => PLATFORMS[pIndex[t]].name).join(', ')}`).join('; ');
  return svgDoc({ w: W, h: H, title: `Multiplatform toolkit: ${summary}`, css, defs: k.defs, body });
}

// ---------------------------------------------------------- project cards --
function wrap(str, max) {
  const words = str.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && len(cur) + 1 + len(w) > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildProject(p) {
  const W = 600, H = 244;
  const k = card(W, H, { id: 'pc', rx: 16, sweepEvery: 7 });
  const desc = wrap(p.desc, 60);
  if (desc.length > 3) throw new Error(`Description too long for ${p.repo}`);
  let x = 28;
  const chips = p.platforms.map((pl, i) => {
    const w = r(len(pl) * 14 * 0.6 + 24);
    const s = `<g class="pop" ${delay(0.7 + i * 0.08)}><rect x="${r(x)}" y="196" width="${w}" height="28" rx="14" fill="${C.tile}" stroke="#2B3B57"/>${text(x + w / 2, 215, 14, pl, { anchor: 'middle', fill: C.soft })}</g>`;
    x += w + 8;
    return s;
  }).join('');
  const [lang, langColor] = p.lang;
  const css = `${k.css}
.accent{animation:accent 4s ease-in-out infinite}
@keyframes accent{0%,100%{opacity:.55}50%{opacity:1}}`;
  const body = `${k.open}
<rect class="accent" width="${W}" height="3" fill="${p.accent}"/>
<g class="pop" ${delay(0.1)}><rect x="28" y="26" width="58" height="58" rx="14" fill="${C.tile}" stroke="${C.border}"/>${icon(p.icon, 40, 38, 34)}</g>
<g class="rise" ${delay(0.2)}>${text(102, 52, 23, p.repo, { weight: 700 })}
${mono(102, 77, 15, [[p.tech, p.accent]])}</g>
<g class="rise" ${delay(0.3)}><path d="M548 38h14v14M562 38l-16 16" fill="none" stroke="${C.muted}" stroke-width="2" stroke-linecap="round"/></g>
<g class="fade" ${delay(0.4)}>${desc.map((l, i) => text(28, 120 + i * 24, 17, l, { fill: C.soft })).join('\n')}</g>
${chips}
<g class="fade" ${delay(0.9)}><circle cx="${r(W - 28 - len(lang) * 15 * 0.56 - 14)}" cy="210" r="6" fill="${langColor}"/>${text(W - 28 - len(lang) * 15 * 0.56, 215, 15, lang, { fill: C.muted })}</g>
${k.close}`;
  return svgDoc({ w: W, h: H, title: `${p.repo} (${p.tech}): ${p.desc} Platforms: ${p.platforms.join(', ')}.`, css, defs: k.defs, body });
}

// -------------------------------------------------------------- languages --
function buildLanguages() {
  const W = 1200, H = 244;
  const cefr = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const langs = [
    ['EN', 'English', 'C2 · Certified', 6, C.blue],
    ['FR', 'French', 'C2 · Certified', 6, C.violet],
    ['ES', 'Spanish', 'Native', 6, C.orange],
    ['DE', 'German', 'A2 · Learning', 2, C.yellow],
  ];
  const k = card(W, H, { id: 'lg' });
  const cells = langs.map(([code, name, level, filled, col], i) => {
    const x = 48 + (i % 2) * 580, y = 38 + Math.floor(i / 2) * 104;
    const segW = 66, segGap = 6, sx = x + 78;
    const segs = cefr.map((c, j) => {
      const on = j < filled;
      return `<rect x="${sx + j * (segW + segGap)}" y="${y + 34}" width="${segW}" height="10" rx="5" fill="#1E2A44"/>
${on ? `<rect class="seg" x="${sx + j * (segW + segGap)}" y="${y + 34}" width="${segW}" height="10" rx="5" fill="${col}" ${delay(0.5 + i * 0.15 + j * 0.12)}/>` : ''}
${text(sx + j * (segW + segGap) + segW / 2, y + 66, 14, c, { anchor: 'middle', fill: on ? C.muted : '#475569', cls: 'mono' })}`;
    }).join('');
    return `<g class="rise" ${delay(i * 0.12)}>
<circle cx="${x + 28}" cy="${y + 30}" r="27" fill="${C.tile}" stroke="${col}" stroke-width="2"/>
${text(x + 28, y + 36, 17, code, { anchor: 'middle', weight: 700, fill: col, cls: 'mono' })}
${text(sx, y + 20, 23, name, { weight: 700 })}
${text(sx + 6 * (segW + segGap) - segGap, y + 20, 17, level, { anchor: 'end', fill: C.muted })}
${segs}</g>`;
  }).join('\n');
  const css = `${k.css}
.seg{transform-box:fill-box;transform-origin:left center;animation:grow .6s cubic-bezier(.2,.8,.2,1) both}
@keyframes grow{from{transform:scaleX(0)}to{transform:none}}`;
  const body = `${k.open}
${cells}
${k.close}`;
  return svgDoc({ w: W, h: H, title: 'Languages: English C2 (certified), French C2 (certified), Spanish native, German A2 (learning)', css, defs: k.defs, body });
}

// ---------------------------------------------------------------- buttons --
function buildButton({ label, iconSpec, bg, stroke }) {
  const H = 56, W = Math.round(64 + len(label) * 18 * 0.6 + 26);
  const defs = `<clipPath id="bc"><rect width="${W}" height="${H}" rx="12"/></clipPath>
<linearGradient id="bs" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const css = `.s{animation:s 5s ease-in-out 1s infinite}@keyframes s{0%{transform:translateX(0)}30%,100%{transform:translateX(${W + 200}px)}}`;
  const body = `<g clip-path="url(#bc)"><rect width="${W}" height="${H}" fill="${bg}"/>
<g class="s"><rect x="-120" y="-10" width="70" height="${H + 20}" fill="url(#bs)" transform="skewX(-20)"/></g></g>
<rect x=".75" y=".75" width="${W - 1.5}" height="${H - 1.5}" rx="11.5" fill="none" stroke="${stroke}" stroke-width="1.5"/>
${icon(iconSpec, 22, 16, 24)}
${text(60, 35, 18, label, { weight: 700, fill: '#fff' })}`;
  return svgDoc({ w: W, h: H, title: label, css, defs, body });
}

// ----------------------------------------------------------------- footer --
function wavePath(width, base, amp, period) {
  let d = `M0 ${base}`;
  for (let x = 0; x < width; x += period) {
    d += ` Q${x + period / 4} ${base - amp} ${x + period / 2} ${base} T${x + period} ${base}`;
  }
  return `${d} V400 H0 Z`;
}

function buildFooter() {
  const W = 1200, H = 190;
  const waves = [
    { base: 58, amp: 14, period: 600, fill: C.bg1, op: 0.55, dur: 16 },
    { base: 74, amp: 12, period: 400, fill: '#141E35', op: 0.85, dur: 11 },
    { base: 90, amp: 9, period: 300, fill: C.bg0, op: 1, dur: 8 },
  ];
  const css = waves.map((w, i) => `.w${i}{animation:w${i} ${w.dur}s linear infinite}@keyframes w${i}{to{transform:translateX(-${w.period}px)}}`).join('');
  const defs = `<clipPath id="fc"><rect width="${W}" height="${H}" rx="20"/></clipPath>`;
  const body = `<g clip-path="url(#fc)">
${waves.map((w, i) => `<path class="w${i}" d="${wavePath(W + w.period * 2, w.base, w.amp, w.period)}" fill="${w.fill}" fill-opacity="${w.op}"/>`).join('\n')}
<g class="rise" ${delay(0.3)}>${text(W / 2, 138, 24, 'Merci  ·  Thank you  ·  Gracias', { anchor: 'middle', weight: 700 })}</g>
<g class="fade" ${delay(0.8)}>${mono(W / 2 - len("// let's build something great together") * 14 * CW / 2, 166, 14, [["// let's build something great together", C.muted]])}</g>
</g>`;
  return svgDoc({ w: W, h: H, title: "Merci, Thank you, Gracias — let's build something great together", css, defs, body });
}

// ------------------------------------------------------------------ write --
mkdirSync(OUT, { recursive: true });
const files = {
  'header.svg': buildHeader(),
  'terminal.svg': buildTerminal(),
  ...Object.fromEntries(STACK.map((s) => [`stack-${s.id}.svg`, buildStack(s)])),
  'multiplatform.svg': buildMultiplatform(),
  ...Object.fromEntries(PROJECTS.map((p) => [`${p.file}.svg`, buildProject(p)])),
  'languages.svg': buildLanguages(),
  'btn-linkedin.svg': buildButton({ label: 'LinkedIn', iconSpec: { dev: 'linkedin/linkedin-plain.svg', color: '#fff' }, bg: '#0A66C2', stroke: '#2B83DB' }),
  'btn-email.svg': buildButton({ label: 'Email', iconSpec: { si: 'gmail' }, bg: '#1B2436', stroke: '#33415C' }),
  'btn-github.svg': buildButton({ label: 'GitHub', iconSpec: { si: 'github' }, bg: '#161B22', stroke: '#30363D' }),
  'footer.svg': buildFooter(),
};
for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(OUT, name), svg);
  console.log(`assets/${name}  ${(svg.length / 1024).toFixed(1)} KB`);
}
