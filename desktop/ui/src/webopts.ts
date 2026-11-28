/**
 * 결정 T7(2026-11-26) — 부재 검토 정보 창의 「웹 구멍」 · 전단(곡선 · kv · qs) · 웹 크리플링(Rc) · 「횡방향 웹 보강재 §G4.1」 · 「휨 + 비틀림 §H4」 묶음.
 *
 * 결과에 그 묶음이 있을 때만 그린다(입력이 없으면 아무것도 없다 — 결정 T4). 값은 엔진 결과를 이 화면의 하나뿐인 변환(units.ts memberSI —
 * MCP 의 units:"SI" 와 같은 표, 반올림 전 값)으로 바꾼 것 그대로이고 수마다 data-src 를 단다. 판정 · 비를 셈하지 않는다 — 엔진의 것만.
 * 평가하지 못한 것은 「평가하지 못함」 과 엔진의 까닭(한국어 · SI). 구멍 없는 값은 참고 · 상한으로만 적는다(판정비가 아니다).
 * 꼴은 제품의 설계 요약(webview/js/app.js _webOptionsHtml)과 같은 차례.
 */
import { esc, tip } from './dom';
import { none, num, ratio } from './format';
import { VERDICT_KO } from './names';
import { checkRatioHtml, fieldText, holeReasons, reasonNote } from './notices';
import type { CheckRow, Run } from './store';
import type { Kind } from './units';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const tr = (k: string, v: string, attrs = '') => `<tr${attrs}><td>${k}</td><td class="r">${v}</td></tr>`;
const box = (key: string, title: string, rows: string, t: string, right = '') =>
  `<div class="sec" data-web-block="${esc(key)}"><h4${tip(t)}>${esc(title)}<span class="sp"></span>${right}</h4><table class="t"><tbody>${rows}</tbody></table></div>`;

/** 그 실행의 검토 항목(id) — 판정 글 · 비 · 까닭 */
function verdictOfRow(row: CheckRow | undefined, withWhy = true): string {
  if (!row) { return none('없음'); }
  const v = VERDICT_KO[row.verdict] ?? VERDICT_KO.not_evaluated;
  const why = row.kind !== 'ls' && withWhy ? reasonNote(row.us) : null;
  return `<span class="verdict ${v.cls === 'na' ? 'un' : v.cls}" style="font-weight:400" data-web-verdict="${esc(row.id)}">${esc(row.kind === 'ne' ? '평가하지 못함' : v.text)}</span>`
    + (row.kind === 'ls' && fin(row.ratio) ? ` ${checkRatioHtml(row.us, row.ratio, row.verdict === 'fail', `${row.src}ratio`, true)}` : '')
    + (why ? `<div class="dim" data-reason${why.code ? ` data-code="${esc(why.code)}"` : ''}>${esc(why.text)}</div>` : '');
}

export function webOptionBlocks(run: Run, row: CheckRow | undefined): string {
  const us = run.us ?? {};
  const si = run.result ?? {};
  const base = run.src;
  const q = (path: string, kind: Kind, sig = 4) => {
    const v = path.split('.').reduce((o: any, k) => (o && typeof o === 'object' ? o[k] : undefined), si);
    return fin(v) ? num(v, { src: `${base}${path}`, kind, sig }) : none('—', '결과에 없다');
  };
  const has = (path: string) => fin(path.split('.').reduce((o: any, k) => (o && typeof o === 'object' ? o[k] : undefined), si));
  const rowOf = (id: string) => run.rows.find(x => x.id === id && (!row || x.point === row.point));
  const id = row?.id ?? '';
  const all = !row;
  let h = '';

  // ── 웹 구멍 — 구멍이 있는 실행이면 어느 항목을 골라도(구멍은 압축 · 휨 · 전단 · 웹 크리플링 모두에 닿는다)
  const ho = us.holes && typeof us.holes === 'object' ? us.holes : null;
  if (ho) {
    const shape = ho.shape === 'circular' ? '원형' : ho.shape === 'noncircular' ? '비원형(슬롯 · 사각)' : String(ho.shape ?? '—');
    let r = tr('구멍', `${esc(shape)} · dh ${q('holes.dh', 'length')}${ho.shape !== 'circular' ? ` · Lh ${q('holes.Lh', 'length')}` : ''}`
      + ` · ${ho.single_hole || !has('holes.s') ? `<span data-single-hole="1"${tip('중심 간격 s 를 주지 않았다 — 이웃 구멍이 없는 구멍 하나(엔진이 가정으로 밝힌다)')}>구멍 하나</span>` : `s ${q('holes.s', 'length')}`}`
      + (fin(ho.web_offset) && ho.web_offset !== 0 ? ` · 치우침 ${q('holes.web_offset', 'length')}` : ''));
    const fam: string[] = [];
    const ev = (b: unknown) => (b === true ? '<span class="ok" data-holes-eval="1">평가함</span>' : '<span class="un" data-holes-eval="0">평가하지 못함</span>');
    if ('compression_evaluated' in ho) { fam.push(`압축(§E2.5 · §E3.2.2 · §E4.2) ${ev(ho.compression_evaluated)}`); }
    if ('flexure_evaluated' in ho) { fam.push(`휨(§F2.2 · §F3.2.2 · §F4.2) ${ev(ho.flexure_evaluated)}`); }
    const why = holeReasons(ho);
    r += tr('평가', `${fam.length ? fam.join(' · ') : ev(ho.evaluated)}${why.map(n => `<div class="dim" data-hole-reason${n.code ? ` data-code="${esc(n.code)}"` : ''}>${esc(n.text)}</div>`).join('')}`, ` data-holes-evaluated="${ho.evaluated === true ? 1 : 0}"`);
    const ap = rowOf('member.applicability.holes');
    // 까닭이 위의 구멍 까닭과 같은 글이면 한 번만
    if (ap) { const apWhy = reasonNote(ap.us)?.text ?? ''; r += tr('적용 범위', verdictOfRow(ap, !why.some(n => apWhy.includes(n.text)))); }
    if (has('holes.Anet') || has('holes.Sfnet')) {
      r += tr(`순단면 <span class="faint">(구멍 자리)</span>`, `Anet ${q('holes.Anet', 'area')} <span class="faint">· 구멍 없는 A ${q('holes.A_gross_model', 'area')}</span>`
        + `<br>Sfnet ${q('holes.Sfnet', 'modulus')} <span class="faint">· 구멍 없는 Sf ${q('holes.Sf_gross_model', 'modulus')}</span>`);
    }
    const ny: string[] = [];
    if (has('holes.Pynet') || has('Pynet')) { ny.push(`Pynet ${has('Pynet') ? q('Pynet', 'force') : q('holes.Pynet', 'force')}${has('Py') ? ` <span class="faint">· Py ${q('Py', 'force')}</span>` : ''}`); }
    if (has('holes.Mynet') || has('Mynet')) { ny.push(`Mynet ${has('Mynet') ? q('Mynet', 'moment') : q('holes.Mynet', 'moment')}${has('My') ? ` <span class="faint">· My ${q('My', 'moment')}</span>` : ''}`); }
    if (ny.length) { r += tr('순단면 항복', ny.join('<br>'), ' data-net-yield'); }
    // 구멍의 탄성 좌굴값 — 구멍 없는 값은 그 국부 검토의 첫 단계(엔진이 쓴 구멍 없는 Mcrℓ · Pcrℓ)에서
    const grossOf = (rid: string, sym: RegExp): string => {
      const rw = rowOf(rid);
      const steps: any[] = Array.isArray(rw?.si?.steps) ? rw!.si.steps : [];
      for (let k = 0; k < steps.length; k++) {
        const ins: any[] = Array.isArray(steps[k]?.inputs) ? steps[k].inputs : [];
        const j = ins.findIndex(x => x && sym.test(String(x.symbol ?? '')) && fin(x.value) && x.source?.kind === 'buckling_analysis');
        if (j >= 0) { return ` <span class="faint">· 구멍 없는 ${esc(String(ins[j].symbol))} ${num(ins[j].value, { src: `${rw!.src}steps.${k}.inputs.${j}.value`, kind: ins[j].quantity === 'force' ? 'force' : 'moment' })}</span>`; }
      }
      return '';
    };
    const el: string[] = [];
    if (has('holes.Pcrl_h')) { el.push(`Pcrℓ,h ${q('holes.Pcrl_h', 'force')}${grossOf('member.compression.local', /^Pcrl$/)}`); }
    if (has('holes.Mcrl_h')) { el.push(`Mcrℓ,h ${q('holes.Mcrl_h', 'moment')}${grossOf('member.flexure.local', /^Mcrl$/)}`); }
    if (has('holes.Pcrd_h')) { el.push(`Pcrd,h ${q('holes.Pcrd_h', 'force')}${has('holes.tr_P') ? ` <span class="faint">· tr ${q('holes.tr_P', 'length')} · Lcrd ${q('holes.Lcrd_P', 'length')}</span>` : ''}`); }
    if (has('holes.Mcrd_h')) { el.push(`Mcrd,h ${q('holes.Mcrd_h', 'moment')}${has('holes.tr_M') ? ` <span class="faint">· tr ${q('holes.tr_M', 'length')} · Lcrd ${q('holes.Lcrd_M', 'length')}</span>` : ''}`); }
    if (el.length) { r += tr('구멍의 탄성 좌굴값', el.join('<br>'), ' data-hole-elastic'); }
    if (ho.props_mismatch) { r += tr('단면 성질', `<span class="warn" data-props-mismatch="1"${tip('받은 단면 성질(A · Sf)이 지금 단면의 구멍 모델과 맞지 않는다 — 구멍 조항을 평가하지 않았다(까닭은 위)')}>받은 단면 성질이 구멍 모델과 다르다</span>`); }
    h += box('holes', '웹 구멍 — 부록 2 · 구멍이 있는 부재', r, '엔진 결과의 holes 묶음(순단면 · 구멍의 탄성값 · 평가한 것과 까닭). 구멍 없는 값은 견주어 보라고 옆에 — 판정에 쓰지 않는다');
  }

  // ── 전단(§G2 · §G3) — 전단 · 휨+전단 · 보강재 항목을 고르면
  const sh = us.shear && typeof us.shear === 'object' && ('curve' in us.shear || 'evaluated' in us.shear) ? us.shear : null;
  if (sh && (all || ['member.shear', 'member.bending_shear', 'member.web_stiffeners'].includes(id))) {
    let r = tr('곡선', `${esc(String(sh.curve ?? '—'))}${sh.equation ? ` <span class="faint">· ${esc(fieldText(sh, 'equation'))}</span>` : ''}`, ` data-shear-curve="${esc(String(sh.curve ?? ''))}"`);
    r += tr('kv', `${q('shear.kv', 'none')}${sh.kv_equation ? ` <span class="faint">(${esc(String(sh.kv_equation))})</span>` : ''}`);
    if (fin(sh.qs) || has('shear.c')) { r += tr('qs <span class="faint">(§G3)</span>', `${q('shear.qs', 'none', 3)}${has('shear.c') ? ` <span class="faint">· c ${q('shear.c', 'length')}${has('shear.c_over_t') ? ` · c/t ${q('shear.c_over_t', 'none', 3)}` : ''}</span>` : ''}`, ' data-shear-qs'); }
    if (sh.evaluated === false) {
      const rn = sh.reason ? fieldText(sh, 'reason') : '';
      r += tr('평가', `<span class="un" data-shear-evaluated="0">평가하지 못함</span>${rn ? `<div class="dim">${esc(rn)}</div>` : ''}`);
    }
    if (sh.reference_only) { r += tr('참고값', `Vn ${q('shear.Vn', 'force')} <span class="faint">— 보강하지 않은 웹(§G2.1, kv 5.34) — 판정에 쓰지 않음</span>`, ' data-shear-reference'); }
    const bw = sh.bound_without_holes;
    if (bw && typeof bw === 'object') {
      r += tr('구멍 없는 강도', `Vn ${q('shear.bound_without_holes.Vn', 'force')} · 설계강도 ${q('shear.bound_without_holes.design_strength', 'force')} · 비 ${ratio(bw.ratio, bw.fails === true, `${base}shear.bound_without_holes.ratio`)}`
        + ` <span class="faint"${tip('§G3 은 이 강도에 qs ≤ 1 을 곱한다 — 소요가 넘을 때만 판정한다(구멍이 있어도 넘는다)')}>${bw.fails ? '넘음 — 구멍이 있어도 NG' : '넘지 않음 — 판정 없음'}</span>`, ' data-shear-bound');
    }
    const sc = rowOf('member.shear');
    if (sc) { r += tr('전단 판정', verdictOfRow(sc)); }
    h += box('shear', `전단 — ${sc?.clause ? `§${sc.clause}` : '§G2'}`, r, '엔진 결과의 shear 묶음 — 곡선(§G2.1 · §G2.2) · kv · §G3 의 qs');
  }

  // ── 웹 크리플링(§G5 · §G6) — Rc
  const wc = us.web_crippling && typeof us.web_crippling === 'object' ? us.web_crippling : null;
  const g6 = wc?.g6 && typeof wc.g6 === 'object' ? wc.g6 : null;
  if (wc && (g6 || wc.bound_without_holes || 'Pn_without_holes' in wc) && (all || ['member.web_crippling', 'member.bending_web_crippling'].includes(id))) {
    let r = '';
    if (g6) {
      r += tr('Rc <span class="faint">(§G6)</span>', g6.evaluated === false
        ? `<span class="un" data-wc-rc="none">평가하지 못함</span>${g6.reason ? `<div class="dim">${esc(fieldText(g6, 'reason'))}</div>` : ''}`
        : `${q('web_crippling.g6.Rc', 'none', 3)}${fin(g6.Rc_raw) && g6.Rc_raw !== g6.Rc ? ` <span class="faint">· 식의 값 ${q('web_crippling.g6.Rc_raw', 'none', 3)} → 1.0 이하</span>` : ''}${g6.equation ? ` <span class="faint">(${esc(String(g6.equation))})</span>` : ''}`, ' data-wc-rc');
    }
    if (has('web_crippling.Pn_without_holes')) { r += tr('Pn <span class="faint">(구멍 없음, §G5)</span>', q('web_crippling.Pn_without_holes', 'force')); }
    if (has('web_crippling.Pn')) { r += tr('Pn', q('web_crippling.Pn', 'force')); }
    const bw = wc.bound_without_holes;
    if (bw && typeof bw === 'object') {
      r += tr('구멍 없는 강도', `Pn ${q('web_crippling.bound_without_holes.Pn', 'force')} · 설계강도 ${q('web_crippling.bound_without_holes.design_strength', 'force')} · 비 ${ratio(bw.ratio, bw.fails === true, `${base}web_crippling.bound_without_holes.ratio`)}`
        + ` <span class="faint"${tip('§G6 은 이 강도에 Rc ≤ 1 을 곱한다 — 소요가 넘을 때만 판정한다')}>${bw.fails ? '넘음 — 구멍이 있어도 NG' : '넘지 않음'}</span>`, ' data-wc-bound');
    }
    const wr = rowOf('member.web_crippling');
    if (wr) { r += tr('웹 크리플링 판정', verdictOfRow(wr)); }
    h += box('web_crippling', `웹 크리플링 — ${wr?.clause ? `§${wr.clause}` : '§G5'}`, r, '엔진 결과의 web_crippling 묶음 — §G6 의 Rc(구멍이 있는 웹), 구멍 없는 강도');
  }

  // ── 횡방향 웹 보강재 §G4.1
  const st = us.web_stiffeners && typeof us.web_stiffeners === 'object' ? us.web_stiffeners : null;
  if (st && (all || ['member.web_stiffeners', 'member.shear', 'member.bending_shear'].includes(id))) {
    const KIND: Record<string, string> = { pair: '쌍', single_angle: '한쪽 ㄱ형강', single_plate: '한쪽 판', nonconforming: '§G4.2 (프레스 · 압연 등)' };
    let r = '';
    if (has('web_stiffeners.a')) { r += tr('간격 a', `${q('web_stiffeners.a', 'length')}${has('web_stiffeners.a_over_h') ? ` <span class="faint">· a/h ${q('web_stiffeners.a_over_h', 'none', 3)} ≤ ${q('web_stiffeners.a_over_h_limit', 'none', 3)}</span>` : ''}`); }
    if (st.kind) { r += tr('종류', `${esc(KIND[String(st.kind)] ?? String(st.kind))}${has('web_stiffeners.D') ? ` <span class="faint">· D ${q('web_stiffeners.D', 'none', 3)}</span>` : ''}`); }
    if (has('web_stiffeners.Is') || has('web_stiffeners.Is_min')) { r += tr('Is ≥ Is,min <span class="faint">(Eq. G4.1-1)</span>', `${q('web_stiffeners.Is', 'inertia')} / ${q('web_stiffeners.Is_min', 'inertia')}`); }
    if (has('web_stiffeners.As') || has('web_stiffeners.Ast_min')) { r += tr('Ast ≥ 최소 <span class="faint">(Eq. G4.1-2)</span>', `${q('web_stiffeners.As', 'area')} / ${q('web_stiffeners.Ast_min', 'area')}`); }
    if (Array.isArray(st.missing) && st.missing.length) { r += tr('주지 않은 자료', `<span class="un" data-stiffener-missing="${esc(st.missing.join(','))}">${esc(st.missing.join(', '))}</span>`); }
    const conf = st.conforming === true ? '<span class="ok">맞음</span>' : st.conforming === false ? '<span class="ng">맞지 않음</span>' : '<span class="un">평가하지 못함</span>';
    r += tr('§G4.1', `${conf}${fin(st.ratio) ? ` <span class="faint">· 요건 비 ${q('web_stiffeners.ratio', 'none', 3)}</span>` : ''}${st.reason ? `<div class="dim">${esc(fieldText(st, 'reason'))}</div>` : ''}`, ` data-stiffener-conforming="${st.conforming === true ? 1 : st.conforming === false ? 0 : ''}"`);
    const sr = rowOf('member.web_stiffeners');
    if (sr) { r += tr('보강재 판정', verdictOfRow(sr)); }
    h += box('web_stiffeners', '횡방향 웹 보강재 — §G4.1', r, '엔진 결과의 web_stiffeners 묶음 — §G4.1 의 간격 · Is · Ast 요건');
  }

  // ── 휨 + 비틀림 §H4
  const to = us.torsion && typeof us.torsion === 'object' ? us.torsion : null;
  if (to && (all || id === 'member.bending_torsion' || /^member\.flexure\./.test(id))) {
    let r = tr('길', to.route === 'computed' ? '편심 하중으로(비틀림 단순 지지 한 경간)' : to.route === 'direct' ? '응력을 직접' : esc(String(to.route ?? '—')));
    if (to.evaluated) {
      r += tr('R', `${q('torsion.R', 'none', 4)}${to.increased_15pct ? ` <span class="faint" data-torsion-15="1"${tip('§H4: 가장자리 보강 C 단면에서 그 점이 웹–플랜지 이음이면 R 을 15 % 올린다')}>웹–플랜지 이음 15 % 증가 · 증가 전 ${q('torsion.R_raw', 'none', 4)}</span>` : ''}`, ' data-torsion-r');
      r += tr('Mn = R·Mnℓo', `${q('torsion.Mn', 'moment')} <span class="faint">· Mnℓo ${q('torsion.Mnlo', 'moment')}</span> → 설계강도 ${q('torsion.design_strength', 'moment')} · 소요 ${q('torsion.Mu', 'moment')}`);
      if (to.route === 'computed') {
        r += tr('지배 점', `절점 ${esc(String(to.node ?? '—'))} · 경간의 ${q('torsion.y', 'length')}${has('torsion.e') ? ` <span class="faint">· e ${q('torsion.e', 'length')} · L ${q('torsion.L', 'length')}${to.load ? ` · ${to.load === 'uniform' ? '등분포' : to.load === 'midspan_point' ? '중앙 집중' : esc(String(to.load))}` : ''}</span>` : ''}`, ' data-torsion-node');
      }
      r += tr('그 점의 응력', `fb ${q('torsion.f_bending', 'stress')} · fw ${q('torsion.f_torsion', 'stress')}${has('torsion.f_bending_max') ? ` <span class="faint">· fb,max ${q('torsion.f_bending_max', 'stress')}</span>` : ''}${has('torsion.f_combined') ? ` <span class="faint">· 합 ${q('torsion.f_combined', 'stress')}</span>` : ''}`, ' data-torsion-stress');
    } else if (to.reason || to.reason_ko) {
      r += tr('평가', `<span class="un">평가하지 못함</span><div class="dim">${esc(fieldText(to, 'reason'))}</div>`);
    }
    const hr = rowOf('member.bending_torsion');
    if (hr) { r += tr('§H4 판정', verdictOfRow(hr)); }
    h += box('torsion', '휨 + 비틀림 — §H4', r, '엔진 결과의 torsion 묶음 — R = 그 점의 휨 응력 / (휨 + 뒤틀림 응력), Mn = R·Mnℓo(Eq. H4-1)');
  }
  return h;
}
