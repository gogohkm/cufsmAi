/* global Buffer, module */
// K3 0단계 — PDF 의 쪽 수와 글(패키지 없이). Edge(Skia)가 --print-to-pdf 로 만든 PDF 를 읽는다:
// 객체를 나누고, Flate 흐름을 풀고, 글꼴의 ToUnicode CMap(bfchar · bfrange)으로 글리프 번호를 글자로 바꾼다.
// 글꼴은 둘: Type0(Identity-H, 2 바이트 코드 — Segoe UI 의 라틴 글자)과 Type3(1 바이트 코드 — 한글 Noto Sans KR 의 조각).
// 글은 <hex> 또는 (literal). 줄바꿈은 글 객체(BT…ET)의 끝에서, TJ 의 큰 띄움(< -200)은 빈칸으로. 다른 PDF 생성기는 대상이 아니다.
'use strict';
const zlib = require('zlib');

function hexToStr(h) {
  let o = '';
  for (let i = 0; i + 4 <= h.length; i += 4) { o += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); }
  return o;
}

function parseCmap(txt) {
  const map = new Map();
  for (const b of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) { map.set(parseInt(p[1], 16), hexToStr(p[2])); }
  }
  for (const b of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16), base = parseInt(p[3], 16);
      for (let c = lo; c <= hi; c++) { map.set(c, String.fromCodePoint(base + c - lo)); }
    }
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g)) {
      const lo = parseInt(p[1], 16);
      [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((d, i) => map.set(lo + i, hexToStr(d[1])));
    }
  }
  return map;
}

function hexBytes(hex) {
  const b = [];
  for (let i = 0; i + 2 <= hex.length; i += 2) { b.push(parseInt(hex.slice(i, i + 2), 16)); }
  return b;
}

function litBytes(lit) {
  const b = [];
  const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 };
  for (let i = 0; i < lit.length; i++) {
    const ch = lit[i];
    if (ch !== '\\') { b.push(ch.charCodeAt(0) & 255); continue; }
    const n = lit[++i];
    if (n === undefined) { break; }
    if (esc[n] !== undefined) { b.push(esc[n]); continue; }
    if (/[0-7]/.test(n)) {
      let o = n;
      while (o.length < 3 && /[0-7]/.test(lit[i + 1] || '')) { o += lit[++i]; }
      b.push(parseInt(o, 8));
      continue;
    }
    b.push(n.charCodeAt(0) & 255);
  }
  return b;
}

/** @returns {{pages: number, texts: string[]}} */
function pdfText(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+) 0 obj([\s\S]*?)endobj/g;
  let m;
  while ((m = re.exec(s))) { objs.set(Number(m[1]), m[2]); }
  const streamOf = (body) => {
    if (!body) { return null; }
    const i = body.indexOf('stream');
    if (i < 0) { return null; }
    let start = i + 6;
    if (body[start] === '\r') { start++; }
    if (body[start] === '\n') { start++; }
    const end = body.lastIndexOf('endstream');
    const raw = Buffer.from(body.slice(start, end), 'latin1');
    if (/\/FlateDecode/.test(body.slice(0, i))) {
      try { return zlib.inflateSync(raw).toString('latin1'); } catch { try { return zlib.inflateRawSync(raw.slice(2)).toString('latin1'); } catch { return ''; } }
    }
    return raw.toString('latin1');
  };
  const fonts = new Map();
  for (const [n, body] of objs) {
    const tu = /\/ToUnicode (\d+) 0 R/.exec(body);
    if (tu && /\/Type \/Font/.test(body)) {
      fonts.set(n, { map: parseCmap(streamOf(objs.get(Number(tu[1]))) || ''), bytes: /\/Subtype \/Type0/.test(body) ? 2 : 1 });
    }
  }
  const pages = [...objs.entries()].filter(([, b]) => /\/Type \/Page\b(?!s)/.test(b));
  const texts = [];
  for (const [, body] of pages) {
    const fontsRef = {};
    const resM = /\/Resources (\d+) 0 R/.exec(body);
    const res = resM ? objs.get(Number(resM[1])) : body;
    const fm = /\/Font\s*<<([\s\S]*?)>>/.exec(res || '');
    if (fm) { for (const f of fm[1].matchAll(/\/(\w+) (\d+) 0 R/g)) { fontsRef[f[1]] = Number(f[2]); } }
    const cRefs = [];
    const cm = /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/.exec(body);
    if (cm) { for (const r of cm[1].matchAll(/(\d+) 0 R/g)) { cRefs.push(Number(r[1])); } }
    let out = '';
    for (const cr of cRefs) {
      const content = streamOf(objs.get(cr)) || '';
      let cur = null;
      const codes = (bytes) => {
        let o = '';
        const w = cur ? cur.bytes : 1;
        for (let i = 0; i + w <= bytes.length; i += w) {
          const c = w === 2 ? bytes[i] * 256 + bytes[i + 1] : bytes[i];
          if (cur && cur.map.has(c)) { o += cur.map.get(c); }
        }
        return o;
      };
      const tokRe = /\/(\w+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj|\(((?:[^)\\]|\\.)*)\)\s*Tj|\[((?:[^\]\\]|\\.)*)\]\s*TJ|\bET\b/g;
      for (const tok of content.matchAll(tokRe)) {
        if (tok[1]) { cur = fonts.get(fontsRef[tok[1]]) || null; continue; }
        if (tok[2] !== undefined) { out += codes(hexBytes(tok[2])); continue; }
        if (tok[3] !== undefined) { out += codes(litBytes(tok[3])); continue; }
        if (tok[4] !== undefined) {
          for (const part of tok[4].matchAll(/<([0-9A-Fa-f]*)>|\(((?:[^)\\]|\\.)*)\)|(-?[\d.]+)/g)) {
            if (part[1] !== undefined) { out += codes(hexBytes(part[1])); } else if (part[2] !== undefined) { out += codes(litBytes(part[2])); } else if (Number(part[3]) < -200) { out += ' '; }
          }
          continue;
        }
        out += '\n';
      }
    }
    texts.push(out.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim());
  }
  return { pages: pages.length, texts };
}

module.exports = { pdfText };
