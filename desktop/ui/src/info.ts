/**
 * 오른쪽 정보 창 — 고른 것의 값 · 출처 · 근거만. 선택지 단추 · 요청 양식 · 메모 칸이 없다(사람만 하는 「확인 표시」는 R4 전까지 꺼 둔다).
 *
 * 출처 꼬리표(구성안 3.6): R2 전에는 「기본값인가 아닌가」까지만 — `기본값`(프로그램이 채움 · 엔진이 입력 없이 기본을 씀) /
 * `지정`(누군가 정함 — 누가인지는 R2) / `단면` · `좌굴 해석`(다른 결과에서 나옴). 엔진의 경고 · 가정 · 범위는 세 목록으로 따로 보인다.
 */
import { esc, tip } from './dom';
import { itemText, none, num, ratio, ratioText, unitOf, verdictOf } from './format';
import { BC_KO, dimNames, FAMILY_KO, LOADCASE_KO, sectionLabel, TEMPLATE_KO, TYPE_KO, VERDICT_KO } from './names';
import { isDefault, memberRuns, POINT_KO, regionLabel, rowOfKey, state, COMBO_KO, locWords } from './store';
import { demandCapacity, gaugeHtml, highestLine, qnum, ratioFormTag, unText } from './sheet';
import { BRANCH_TITLE, caseNotes, caseReady, caseTables, type Branch } from './caseView';
import { BRANCH_OF, CASE_FIELDS, caseTag } from './caseFields';
import { modeSel } from './center';
import { si, UNITS_NOTE, type Kind } from './units';

const T_DEF = '<span class="tag def" data-tip="아무도 정하지 않아 프로그램이 채웠다">기본값</span>';
const T_SET = '<span class="tag" data-tip="누군가 정한 값. 누가 정했는지(AI · 사용자)는 변경 기록(R2)부터 보인다">지정</span>';
const tagSec = '<span class="tag sec" data-tip="단면에서 나온 값">단면</span>';
const tagFsm = '<span class="tag drv" data-tip="좌굴 해석(MCP get_dsm_values)에서 나온 값">좌굴 해석</span>';
const tagEng = '<span class="tag drv" data-tip="엔진이 이 검토에서 쓴 값(결과에 함께 온 것)">엔진</span>';
const RV = `<span class="rv off"${tip('내가 확인했다는 표시. 사람만 켠다. 확인 기록은 R4 부터 남는다 — 지금은 꺼져 있다')}>확인</span>`;

const row_ = (k: string, v: string, src = '', unitCell = '') => `<tr><td>${k}</td><td class="r">${v}</td>${unitCell !== '' ? `<td class="dim">${unitCell}</td>` : ''}<td class="src">${src}</td></tr>`;
const sec = (title: string, body: string, right = '', t?: string) => `<div class="sec"><h4${tip(t)}>${title}<span class="sp"></span>${right}</h4>${body}</div>`;
const table = (rows: string) => `<table class="t"><tbody>${rows}</tbody></table>`;
const hd = (k: string, ttl: string, sub = '', right = RV) => `<div class="hd"><div class="k">${k}<span class="sp"></span>${right}</div><div class="ttl">${esc(ttl)}</div>${sub ? `<div class="dim">${sub}</div>` : ''}</div>`;

function lists(warnings: string[], assumptions: string[], scope: string[]): string {
  const li = (xs: string[]) => (xs.length ? `<ul class="notes">${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : none('없음'));
  return sec('경고', li(warnings), `<span class="badge${warnings.length ? ' warn' : ''}">${warnings.length}</span>`, '엔진이 낸 경고(warnings). 글은 엔진이 쓴 US 단위 그대로')
    + sec('가정', li(assumptions), `<span class="badge">${assumptions.length}</span>`, '엔진이 밝힌 가정(assumptions) — 보고할 때 함께 밝힌다')
    + sec('범위', li(scope), `<span class="badge">${scope.length}</span>`, '엔진이 이 검토의 범위를 밝힌 것(scope_notes)');
}

// ── 모델 ──────────────────────────────────────────────────────────
function sectionInfo(): string {
  const f = state.full;
  if (!f) { return hd('단면', '단면 없음') + sec('종류 · 치수', none('모델 읽는 중')); }
  // 템플릿 · 치수 · 하중 경우는 호스트 상태(get_full_state — K4a)에서
  const tpl = String(f.section_template ?? '');
  const p = f.section_params ?? {};
  const def = isDefault('section');
  const given = (k: string) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined && p[k] !== null;
  const tagOf = (k: string, defaultWhy?: string) => (def ? T_DEF : given(k) ? T_SET : `${T_DEF}${defaultWhy ? `<span class="why">${esc(defaultWhy)}</span>` : ''}`);
  let dims = row_('템플릿', esc(TEMPLATE_KO[tpl] ?? TYPE_KO[String(f.section_type ?? '')] ?? '임의 단면'), def ? T_DEF : T_SET);
  if (tpl && tpl !== 'custom' && tpl !== 'custom_builder') {
    for (const [k, label] of [...dimNames(tpl), ['t', '두께 t'] as [string, string]]) {
      if (!given(k) && !['D', 'tf', 'tw'].includes(k)) { dims += row_(label, none('입력 없음'), tagOf(k)); continue; }
      if (!given(k)) { continue; }
      dims += row_(label, num(si(p[k], 'length'), { src: `full:section_params.${k}`, kind: 'length' }), tagOf(k));
    }
    dims += row_('안쪽 반지름 r', given('r') ? num(si(p.r, 'length'), { src: 'full:section_params.r', kind: 'length' }) : num(0, { src: 'const:0', kind: 'length' }),
      tagOf('r', '입력 없음 — 엔진 기본 0(각진 모서리)'));
    if (['lippedc', 'lippedz', 'lipped_angle'].includes(tpl)) {
      dims += row_('립 각도', given('qlip') ? `${num(p.qlip, { src: 'full:section_params.qlip', kind: 'none', sig: 3 })}°` : `${num(90, { src: 'const:90', kind: 'none', sig: 3 })}°`,
        tagOf('qlip', '입력 없음 — 엔진 기본 90°'));
    }
  } else {
    dims += row_('치수', none('템플릿 치수 없음', '좌표 · 요소로 만든 단면 — 절점 · 요소 표가 곧 치수다'), '');
  }
  const ps = state.propsSI, cw = state.cutwpSI;
  let props = '';
  if (!ps) { props = none('단면 성질을 읽지 못함', state.propsErr); } else {
    const pr = (label: string, v: unknown, src: string, kind: Kind, t?: string) => `<tr><td${tip(t)}>${label}</td><td class="r">${num(typeof v === 'number' ? v : null, { src, kind, unit: false })}</td><td class="dim">${unitOf(typeof v === 'number' ? v : null, kind)}</td></tr>`;
    props = '<table class="t"><tbody>'
      + pr('A', ps.A, 'props:A', 'area')
      + pr('Ixx', ps.Ixx, 'props:Ixx', 'inertia', 'x 축(가로) 둘레 — 엔진의 이름')
      + pr('Izz', ps.Izz, 'props:Izz', 'inertia', 'z 축(세로) 둘레')
      + pr('Ixz', ps.Ixz, 'props:Ixz', 'inertia')
      + pr('Sx', ps.Sx, 'props:Sx', 'modulus', '전단면 · 바깥 섬유 기준')
      + pr('Sz', ps.Sz, 'props:Sz', 'modulus', '전단면 · 바깥 섬유 기준')
      + pr('rx · rz', ps.rx, 'props:rx', 'length') + pr('', ps.rz, 'props:rz', 'length')
      + pr('xcg', ps.xcg, 'props:xcg', 'length', '도심 x(절점 좌표계)') + pr('zcg', ps.zcg, 'props:zcg', 'length', '도심 z')
      + pr('θp', ps.thetap, 'props:thetap', 'none', '주축 각')
      + pr('I11 · I22', ps.I11, 'props:I11', 'inertia', '주축 둘레') + pr('', ps.I22, 'props:I22', 'inertia')
      + (cw ? pr('J', cw.J, 'cutwp:J', 'inertia', 'MCP get_cutwp') + pr('Cw', cw.Cw, 'cutwp:Cw', 'warping', 'MCP get_cutwp')
        + pr('전단 중심 Xs · Zs', cw.Xs, 'cutwp:Xs', 'length', 'MCP get_cutwp') + pr('', cw.Zs, 'cutwp:Zs', 'length') : `<tr><td>J · Cw</td><td class="r" colspan="2">${none()}</td></tr>`)
      + '</tbody></table>';
  }
  const dsm = state.dsm;
  const yv = dsm ? dsm.si?.[dsm.family]?.P_y : null;
  const ylabel = dsm?.family === 'P' ? 'Py' : 'My';
  const yrow = `<table class="t"><tbody><tr><td${tip('좌굴 해석의 기준 응력(fy_used)으로 낸 항복값. 설계 Fy 의 My · Py 는 부재 검토 결과에 있다')}>${ylabel} (해석 기준 응력)</td>`
    + `<td class="r">${dsm ? num(yv, { src: `dsm:${dsm.family}.P_y`, kind: dsm.family === 'P' ? 'force' : 'moment' }) : none('좌굴 해석 결과 없음')}</td><td class="src">${dsm ? tagFsm : ''}</td></tr></tbody></table>`;
  const mesh = table(row_('절점 · 요소', `${num(f.nnodes, { src: 'full:nnodes', kind: 'none' })} · ${num(f.nelems, { src: 'full:nelems', kind: 'none' })}`, def ? T_DEF : '')
    + row_('스프링 · 구속', `${num(f.nsprings, { src: 'full:nsprings', kind: 'none' })} · ${num(f.nconstraints, { src: 'full:nconstraints', kind: 'none' })}`,
      f.nsprings || f.nconstraints ? T_SET : `${T_DEF}<span class="why">없음 — 데크 회전 구속을 해석에 넣지 않았다</span>`));
  const tS = def ? T_DEF : '';
  return hd(`단면 · ${TEMPLATE_KO[tpl] ? `템플릿 ${esc(TEMPLATE_KO[tpl])}` : '템플릿 기록 없음'}`, sectionLabel(), esc([given('r') ? `r ${Number((si(p.r, 'length') ?? 0).toFixed(2))}` : '', LOADCASE_KO[f.load_case] ?? ''].filter(Boolean).join(' · ')))
    + sec('종류 · 치수', table(dims), tS, '템플릿 치수(바깥-바깥, r = 안쪽 반지름) — MCP get_full_state 의 section_params(K4a)')
    + sec('단면 성질', props, tagSec, `전단면 · 중심선 형상 · MCP get_section_properties 와 같은 값. ${UNITS_NOTE}`)
    + sec('항복값', yrow)
    + sec('요소 분할', mesh);
}

function materialInfo(): string {
  const f = state.full;
  const def = isDefault('material');
  const t = def ? T_DEF : T_SET;
  return hd('재료', '재료')
    + sec('탄성 상수', table(row_('E', num(si(f?.material?.E, 'stress'), { src: 'full:material.E', kind: 'stress', sig: 6 }), t)
      + row_('ν', num(f?.material?.v, { src: 'full:material.v', kind: 'none', sig: 3 }), t)
      + row_('G', num(si(f?.material?.G, 'stress'), { src: 'full:material.G', kind: 'stress', sig: 6 }), t)), '', 'MCP get_full_state 의 material')
    + caseTables('mat', null)
    + sec('해석 기준 응력', table(row_('기준 응력', typeof f?.load_fy === 'number' ? num(si(f.load_fy, 'stress'), { src: 'full:load_fy', kind: 'stress' }) : none('없음', '하중 경우에 기준 응력을 주지 않았다'),
      state.model?.loadFySource === 'ai' ? caseTag('ai') : '')), '', '좌굴 해석의 기준 응력(get_full_state.load_fy). AI 가 set_load_case 로 정하면 AI(K2 결정 3) — 설계 Fy 와 다르다');
}

/** 부재 · 하중 · 설계 조건 · 접합부 — 호스트의 검토 상태(get_case_inputs) 그대로 */
function caseInfo(b: Branch, focus: string | null): string {
  const c = state.caseIn;
  const dirty = c?.dirty ? `<span class="verdict warn" data-dirty="1"${tip(`저장하지 않은 변경이 있다(검토 상태 판 ${c.rev}${c.dirty_since ? ` · ${c.dirty_since}` : ''})`)}>저장 안 함</span>` : '';
  return hd(`모델 · ${BRANCH_TITLE[b]}`, BRANCH_TITLE[b], caseReady() ? `<span class="dim">검토 상태 판 ${esc(String(c.rev))}</span> ${dirty}` : none('읽는 중'), '')
    + caseTables(b, focus) + caseNotes();
}

function conditionsInfo(): string {
  const f = state.full;
  const t = isDefault('conditions') ? T_DEF : T_SET;
  const L = f?.lengths;
  return hd('해석 조건', '좌굴 해석 조건', esc(f ? `${f.BC} · ${BC_KO[f.BC] ?? ''}` : ''))
    + sec('조건', table(row_('경계조건', esc(f ? `${f.BC} · ${BC_KO[f.BC] ?? ''}` : ''), t)
      + row_('하중 경우', f?.load_case ? esc(LOADCASE_KO[f.load_case] ?? f.load_case) : none('정하지 않음'), f?.load_case ? t : '')
      + row_('기준 응력', typeof f?.load_fy === 'number' ? num(si(f.load_fy, 'stress'), { src: 'full:load_fy', kind: 'stress' }) : none('없음', '하중 경우에 기준 응력을 주지 않았다 — 해석은 절점 응력의 최대 |σ| 를 쓴다'), typeof f?.load_fy === 'number' ? t : '')
      + row_('고유치 수', num(typeof f?.neigs === 'number' ? f.neigs : null, { src: 'full:neigs', kind: 'none' }), t)
      + row_('반파장 수', num(L?.n, { src: 'full:lengths.n', kind: 'none' }), t)
      + row_('반파장 범위', L ? `${num(si(L.min, 'length'), { src: 'full:lengths.min', kind: 'length', unit: false })} ~ ${num(si(L.max, 'length'), { src: 'full:lengths.max', kind: 'length' })}` : none(), t)
      + row_('절점 응력', f ? `${num(si(f.stress?.min, 'stress'), { src: 'full:stress.min', kind: 'stress', unit: false })} ~ ${num(si(f.stress?.max, 'stress'), { src: 'full:stress.max', kind: 'stress' })}` : none(), '')),
    '', '모두 MCP get_full_state(경계조건 · 반파장 · 응력, 하중 경우 · 기준 응력 · 고유치 수 — K4a)');
}

function pendingInfo(title: string, why: string): string {
  return hd(title, title, '', '') + sec('지금', table(row_('값', none('편집 상태의 입력 칸에만 있다', why), '')), '', why);
}

function recordInfo(title: string, why: string): string {
  return hd(title, title, '', '') + sec('지금', table(row_('기록', none('기록 없음', why), '')), '', why);
}

function assumptionsInfo(): string {
  const items: string[] = [];
  if (isDefault('section')) { items.push(`<tr><td>단면</td><td class="r">프로그램 기본 단면</td><td class="src">${T_DEF}</td></tr>`); }
  if (isDefault('material')) { items.push(`<tr><td>재료</td><td class="r">프로그램 기본값</td><td class="src">${T_DEF}</td></tr>`); }
  if (isDefault('conditions')) { items.push(`<tr><td>해석 조건</td><td class="r">프로그램 기본값</td><td class="src">${T_DEF}</td></tr>`); }
  const eng = state.runs.flatMap(r => r.assumptions.map(a => `<li>${esc(a)} <span class="faint">· ${esc(r.label)}</span></li>`));
  return hd('모델 · 가정', '가정')
    + sec('기본값으로 채운 입력', items.length ? table(items.join('')) : none('없음'), '', '프로그램이 채운 그대로인 묶음. 누가 정했는지는 변경 기록(R2)부터')
    + sec('엔진이 밝힌 가정', eng.length ? `<ul class="notes">${eng.join('')}</ul>` : none('없음'));
}

// ── 결과 ──────────────────────────────────────────────────────────
function bucklingInfo(): string {
  const s = state.stages.fsm;
  const dsm = state.dsm;
  if (s.state !== 'ok' || !dsm) {
    const v = s.state === 'stale' ? `<span class="verdict warn">낡음</span> <span class="dim">${esc(s.note)}</span>` : s.state === 'run' ? '<span class="verdict acc">해석 중</span>' : none(state.dsmErr ? `결과 없음 — ${state.dsmErr}` : '결과 없음');
    return hd('결과 · 좌굴 해석', '좌굴 해석', v, '');
  }
  const fam = dsm.family;
  const d = dsm.si?.[fam] ?? {};
  const us = dsm.us?.[fam] ?? {};
  const k: Kind = fam === 'P' ? 'force' : 'moment';
  const sym = fam === 'P' ? 'P' : fam === 'Mxx' ? 'Mxx' : 'Mzz';
  const r3 = (label: string, cr: string, L: string, lf: string, t?: string) => `<tr><td${tip(t)}>${label}</td><td class="r">${num(d[cr], { src: `dsm:${fam}.${cr}`, kind: k, unit: false })}</td>`
    + `<td class="r">${num(d[L], { src: `dsm:${fam}.${L}`, kind: 'length', unit: false })}</td><td class="r">${num(d[lf], { src: `dsm:${fam}.${lf}`, kind: 'none', sig: 3 })}</td></tr>`;
  const tbl = `<table class="t"><thead><tr><th></th><th class="r">${sym}cr (${k === 'force' ? 'kN' : 'kN·m'})</th><th class="r">반파장 (mm)</th><th class="r">LF</th></tr></thead><tbody>`
    + r3('국부', 'crl', 'Lcrl', 'LF_local', us.local_basis ? `근거: ${us.local_basis}` : undefined)
    + r3('뒤틀림', 'crd', 'Lcrd', 'LF_dist', us.dist_basis ? `근거: ${us.dist_basis}` : undefined)
    + r3('전체', 'cre', 'Lcre', 'LF_global', us.global_is_signature_asymptote ? '유효 길이를 주지 않아 서명 곡선의 끝값(global_is_signature_asymptote)' : undefined)
    + '</tbody></table>';
  const meta = table(row_('하중 계열', esc(FAMILY_KO[fam] ?? fam), tagFsm)
    + row_(`${fam === 'P' ? 'Py' : 'My'} (기준)`, num(d.P_y, { src: `dsm:${fam}.P_y`, kind: k }), tagFsm)
    + row_('기준 응력', num(dsm.si?.fy_used, { src: 'dsm:fy_used', kind: 'stress' }), tagFsm)
    + row_('모드 식별', esc(String(us.classification_method ?? '—')), '')
    + row_('극소 수', num(us.n_minima, { src: `dsm:${fam}.n_minima`, kind: 'none' }), ''));
  return hd('결과 · 좌굴 해석', `좌굴 해석 · ${FAMILY_KO[fam] ?? fam}`, `<span class="verdict ok">일치</span> <span class="dim">MCP get_dsm_values 와 같은 값</span>`, '')
    + sec('탄성 좌굴', tbl, tagFsm) + selectedLength() + sec('해석', meta)
    + lists(arr(us.warnings), arr(us.assumptions), arr(us.scope_notes));
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(itemText) : []);

const CLSC = ['var(--clsG)', 'var(--clsD)', 'var(--clsL)', 'var(--unchk)'];

/** 고른 반파장(곡선 · 썸네일에서) — 그 길이 · 모드의 LF 와 엔진의 모드 분류 */
function selectedLength(): string {
  const an = state.analysis;
  const i = modeSel.len;
  if (!an || i === null || !an.curve[i]) { return ''; }
  const m = Math.min(modeSel.mode, an.curve[i].length - 1);
  const c = an.classes?.[i]?.[m - 1];
  const unsupported = an.classStatus?.supported === false;
  const has = Array.isArray(c) && c.some(v => typeof v === 'number');
  const why = unsupported ? (an.classStatus?.code === 'ROUNDED_CORNER' ? '둥근 모서리 단면은 cFSM 분류를 하지 않는다(엔진)' : (an.classStatus?.message ?? '엔진이 분류를 내지 않았다')) : '분류를 돌리지 않았다';
  const clsHtml = has
    ? `<div class="cls">${(c as Array<number | null>).map((v, k) => `<i style="width:${Math.max(0, Number(v) || 0)}%;background:${CLSC[k]}"></i>`).join('')}</div>`
      + `<div class="clsk">${(c as Array<number | null>).map((v, k) => `<span style="--c:${CLSC[k]}">${'GDLO'[k]} ${num(typeof v === 'number' ? v : null, { src: `cls:${i}.${m - 1}.${k}`, kind: 'none', unit: false, sig: 3 })}%</span>`).join('')}</div>`
    : `<div class="dim" data-cls="none"${tip(an.classStatus?.message ?? '')}>분류 없음 — ${esc(why)}</div>`;
  return sec('고른 반파장', table(row_('반파장', num(si(an.curve[i][0], 'length'), { src: `curve:${i}.0`, kind: 'length' }), tagFsm)
    + row_(`모드 ${m} LF`, num(an.curve[i][m], { src: `curve:${i}.${m}`, kind: 'none', sig: 4 }), tagFsm)) + clsHtml, '',
  '좌굴 곡선을 누르거나 썸네일을 고르면 바뀐다. 값은 MCP get_buckling_curve, 분류는 호스트가 보낸 해석 결과');
}

function loadInfo(): string {
  const s = state.stages.load;
  const L = state.loads;
  const v = L ? '<span class="verdict ok">결과 있음</span>' : s.state === 'stale' ? `<span class="verdict warn">낡음</span> <span class="dim">${esc(s.note)}</span>` : none('결과 없음', s.note);
  if (!L) { return hd('결과 · 하중 해석', '하중 해석', v, ''); }
  const la = L.si, us = L.us, g = la.governing ?? {};
  const tagLa = '<span class="tag drv" data-tip="하중 해석(엔진)에서 나온 값">하중 해석</span>';
  const wl: number[] = Array.isArray(g.governing_span_loads_plf) ? g.governing_span_loads_plf : [];
  const defl: any[] = Array.isArray(la.deflection?.per_span) ? la.deflection.per_span : [];
  const R: number[] = Array.isArray(g.R_envelope_max) ? g.R_envelope_max : [];
  return hd(`결과 · 하중 해석${L.from === 'purlin' ? ' · 퍼린 설계의 하중 해석' : ''}`, `지배 조합 — ${String(us.governing?.combo ?? '')}`, v, '')
    + sec('조합', table(row_('설계법', esc(String(us.design_method ?? '—')), tagLa)
      + row_('해석', esc(String(us.analysis_method ?? '—')), tagLa)
      + wl.map((w, i) => row_(`wu 경간 ${i + 1}`, num(w, { src: `loads:governing.governing_span_loads_plf.${i}`, kind: 'linload' }), tagLa)).join('')), '', '엔진의 지배 조합과 그 경간 하중(kN/m)')
    + sec('지점 반력(포락 최대)', table(R.map((r, i) => row_(`지점 ${String.fromCharCode(65 + i)}`, num(r, { src: `loads:governing.R_envelope_max.${i}`, kind: 'force' }), tagLa)).join('')))
    + sec('처짐', table(defl.map((d, i) => row_(`경간 ${d.span ?? i + 1}`, `${num(d.delta_in, { src: `loads:deflection.per_span.${i}.delta_in`, kind: 'length' })} · L/${num(d.L_over_delta, { src: `loads:deflection.per_span.${i}.L_over_delta`, kind: 'none' })}`, tagLa)).join('')), '', String(us.deflection?.basis ?? ''))
    + lists(arr(us.warnings), arr(us.assumptions), arr(us.scope_notes))
    + (arr(us.not_evaluated).length ? sec('미검토', `<ul class="notes">${arr(us.not_evaluated).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`) : '');
}

function checksInfo(key: string): string {
  const { run: r0, row: rw } = rowOfKey(key);
  const lapOrConn = rw?.scope === 'lap' || rw?.scope === 'connection';
  const s = lapOrConn ? state.stages.conn : state.stages.chk;
  if (s.state !== 'ok') {
    const v = s.state === 'stale' ? `<span class="verdict warn">낡음</span> <span class="dim">${esc(s.note)}</span>` : none('아직 평가 안 함', '부재 검토 결과가 없다 — Claude 에게 말로, 또는 편집 상태의 「설계 검토 실행」');
    return hd('결과 · 부재 검토', '부재 검토', v, '');
  }
  const run = r0 ?? memberRuns().find(r => r.rows.length) ?? memberRuns()[0];
  if (!run) { return hd('결과 · 부재 검토', '부재 검토', none('아직 평가 안 함')); }
  const r = run.result ?? {};
  const us = run.us ?? {};
  const ov = verdictOf(run.overall, '판정 없음');
  // 고른 항목이 없으면(검토 가지 자체) 그 실행의 첫 NG → 지배 → 첫 항목
  const row = rw ?? run.rows.find(x => x.pass === false) ?? run.rows.find(x => x.governs) ?? run.rows[0];
  const vv = row ? (VERDICT_KO[row.verdict] ?? VERDICT_KO.not_evaluated) : { text: ov.text, cls: ov.cls };
  const ng = row ? row.verdict === 'fail' : run.overall === false;
  const focusRatio = row ? row.ratio : run.utilization;
  const dcLine = row && row.si?.demand && row.si?.capacity && typeof row.si.demand.value === 'number' && typeof row.si.capacity.value === 'number'
    ? `${esc(String(row.si.demand.symbol ?? ''))} ${qnum(row.si.demand, `${row.src}demand.`, { sig: 3 })} / ${esc(String(row.si.capacity.symbol ?? ''))} ${qnum(row.si.capacity, `${row.src}capacity.`, { sig: 3 })}`
    : '';
  const head = `<div><span class="verdict ${vv.cls === 'na' ? 'un' : vv.cls}" data-verdict="${esc(row?.verdict ?? '')}">${vv.text}</span> <span class="big">${typeof focusRatio === 'number' ? ratio(focusRatio, ng, row ? `${row.src}ratio` : `${run.src}utilization`) : row && row.kind !== 'ls' ? `<span class="un-head" data-un-head>${esc(unText(row))}</span>` : none('판정비 없음')}</span>`
    + ` <span class="dim">${dcLine}${row?.clause ? ` · §${esc(row.clause)}` : ''}${row ? ratioFormTag(row) : ''}</span></div>`
    + (row && (row.kind === 'ne' || row.kind === 'na') ? `<div class="dim" data-reason>${esc(String(row.us?.reason ?? ''))}</div>` : '')
    + (row ? highestLine(row) : '')
    + (typeof focusRatio === 'number' ? gaugeHtml(focusRatio, ng) : '');
  const areaKo = run.area === 'lap' ? '접합부 검토 · 랩' : run.area === 'connection' ? '접합부 검토' : '부재 검토';
  const kHead = `${areaKo} · ${esc(row ? row.where : run.where)} · 검토 전체 <span class="verdict ${ov.cls}" style="font-weight:400"${tip('엔진의 전체 판정(pass): NG 가 하나라도 있으면 NG, 평가 못 한 것이 있으면 판정 없음, 모두 만족이면 OK')}>${ov.text}</span>`;
  // 엔진이 쓴 값
  const fd = r.Fcre_detail ?? {};
  const rg = state.regions.find(x => x.runKey === run.key);
  const tagLa = '<span class="tag drv" data-tip="하중 해석에서 자동으로 정한 값(엔진)">하중 해석</span>';
  const ri = rg ? state.regions.indexOf(rg) : -1;
  const loc = row?.si?.location;
  const used = table([
    loc?.x && typeof loc.x.value === 'number' ? row_('검토 위치', `x ${qnum(loc.x, `${row!.src}location.x.`)}`, `${tagLa}<span class="why">${esc(locWords(loc).join(' · '))}</span>`) : '',
    row?.combination ? row_('하중 조합', `<span data-combination="${esc(row.combination)}">${esc(COMBO_KO(row.combination))}</span>`, tagLa) : '',
    rg ? row_('검토 구간', `${num(rg.si?.start_ft, { src: `purlin:regions.${ri}.start_ft`, kind: 'length_ft', unit: false })} – ${num(rg.si?.end_ft, { src: `purlin:regions.${ri}.end_ft`, kind: 'length_ft' })}`, `${tagLa}<span class="why">${esc(regionLabel(rg.us, rg.si, ri))}</span>`) : '',
    rg && typeof rg.si?.Ly_in === 'number' ? row_('Ly · Cb', `${num(rg.si.Ly_in, { src: `purlin:regions.${ri}.Ly_in`, kind: 'length', unit: false })} mm · ${num(rg.si?.Cb, { src: `purlin:regions.${ri}.Cb`, kind: 'none', unit: false, sig: 3 })}`, tagLa) : '',
    row_('설계법', esc(String(us.design_method ?? row?.us?.design_method ?? '—')), tagEng),
    typeof r.Fy_used === 'number' ? row_('설계 Fy', num(r.Fy_used, { src: `${run.src}Fy_used`, kind: 'stress' }), tagEng) : '',
    typeof fd.Lb === 'number' ? row_('비지지 길이 Lb', num(fd.Lb, { src: `${run.src}Fcre_detail.Lb`, kind: 'length' }), tagEng) : '',
    typeof fd.Cb === 'number' ? row_('Cb', num(fd.Cb, { src: `${run.src}Fcre_detail.Cb`, kind: 'none', sig: 3 }), tagEng) : '',
    us.dsm_source ? row_('좌굴 값의 출처', esc(Object.entries(us.dsm_source).map(([a, b]) => `${a} ${b}`).join(' · ')), us.dsm_basis === 'current_analysis' ? tagFsm : '') : '',
  ].join(''));
  // 한계상태 — 같은 검토 지점의 항목, 엔진의 순서 그대로
  const here = run.rows.filter(x => !row || x.point === row.point);
  const lsRows = here.map(x => {
    const v = VERDICT_KO[x.verdict] ?? VERDICT_KO.not_evaluated;
    return `<tr${x.key === row?.key ? ' class="on"' : ''} data-k="${esc(x.key)}" data-id="${esc(x.id)}"><td><span class="dot ${v.cls === 'na' ? '' : v.cls}"></span> ${esc(x.name)} <span class="faint">§${esc(x.clause)}</span></td>`
      + `<td class="r dc">${demandCapacity(x)}</td><td class="r">${typeof x.ratio === 'number' ? ratio(x.ratio, x.verdict === 'fail', `${x.src}ratio`) : '<span class="faint">—</span>'}</td>`
      + `<td class="r verdict ${v.cls === 'na' ? 'un' : v.cls}" style="font-weight:400">${v.text}</td></tr>`;
  }).join('')
    + run.notApplicable.map(t => `<tr class="na"><td><span class="dot"></span> ${esc(t)}</td><td></td><td class="r faint">—</td><td class="r faint">해당 없음</td></tr>`).join('');
  const ls = lsRows ? `<table class="t"><thead><tr><th></th><th class="r">소요 / 설계강도</th><th class="r">판정비</th><th class="r">판정</th></tr></thead><tbody>${lsRows}</tbody></table>`
    : none('평가한 한계상태 없음', '소요강도를 주지 않으면 엔진은 강도만 내고 판정비를 내지 않는다');
  const out = run.notChecked.length ? `<ul class="notes faint">${run.notChecked.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : none('없음');
  const sheetLink = row && row.us ? `<a class="lnk" data-sheet="${esc(row.key)}"${tip('이 검토 항목의 계산 시트(Enter · 두 번 누르기)')}>계산 시트 →</a>` : '';
  return `<div class="hd"><div class="k">${kHead}<span class="sp"></span>${RV}</div><div class="ttl">${esc(row ? `${row.where} · ${row.name}` : run.label)}</div>${head}</div>`
    + sec('설계 가정', used, '', '이 판정에 엔진이 쓴 값. 입력의 출처는 모델 탭의 부재 · 하중 · 설계 조건(검토 상태) — 사람별 기록은 R2 부터')
    + sec(row?.pointName ? '한계상태 · 이 위치' : '한계상태 · 이 검토', ls, sheetLink)
    + (run.neTexts.length ? sec('엔진의 미검토 글', `<ul class="notes">${run.neTexts.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`, '', '엔진 결과의 not_evaluated 글(검토 항목과 같은 것을 글로)') : '')
    + sec('범위 밖', out, '', '엔진이 이 검토에서 하지 않은 것(not_checked) — 판정에 들어가지 않는다. 미검토(not_evaluated)와 다르다')
    + lists(run.warnings, run.assumptions, run.scope)
    + `<div class="sec chkrow"><span class="chk off"${tip('내가 확인했다는 표시. 사람만 켠다. 확인 기록은 R4 부터 남는다 — 지금은 꺼져 있다')}>확인 표시</span><span class="faint">Space</span><span class="sp"></span></div>`;
}

function connInfo(): string {
  const s = state.stages.conn;
  const lap = state.msgs.lapConnectionResult?.message?.data;
  const one = state.msgs.connectionResult?.message?.data;
  const x = lap ?? one;
  if (!x) {
    return hd('결과 · 접합부 검토', '접합부 검토', s.state === 'stale' ? `<span class="verdict warn">낡음</span> <span class="dim">${esc(s.note)}</span>` : none('아직 평가 안 함'), '');
  }
  const v = verdictOf(x.pass, '판정 없음');
  const fm = x.force_model;
  const notice = fm && fm.specification_provision === false ? `<div class="notice"><b>자체 가정</b> 패스너 힘 분배는 기준 조항이 아닌 자체 해석이다<span class="dim">${esc(String(fm.clause ?? ''))}</span></div>` : '';
  return hd('결과 · 접합부 검토', lap ? '랩 접합' : '단일 접합', `<span class="verdict ${v.cls}">${v.text}</span> ${typeof x.utilization === 'number' ? `<span class="big">${ratio(x.utilization, x.pass === false, `${lap ? 'lap' : 'conn'}:utilization`)}</span>` : ''}`
    + (s.state === 'unk' ? ` <span class="dim">${esc(s.note)}</span>` : ''), '')
    + notice
    + sec('판정비', table((typeof x.utilization === 'number' ? row_('패스너', ratio(x.utilization, x.pass === false, `${lap ? 'lap' : 'conn'}:utilization`), '') : '')
      + (typeof x.flexure_dcr === 'number' ? row_('랩 구간 휨', ratio(x.flexure_dcr, x.flexure_dcr > 1, 'lap:flexure_dcr'), '') : '')))
    + (lap ? sec('입력과 출처', table(
      row_('랩 길이', `${num(state.lap?.si.lap_left_in, { src: 'lap:lap_left_in', kind: 'length', unit: false })} | ${num(state.lap?.si.lap_right_in, { src: 'lap:lap_right_in', kind: 'length' })}`, '<span class="tag">지정</span>')
      + row_('패스너', `${esc(String(lap.fastener_label ?? ''))} · ${num(state.lap?.si.n_total, { src: 'lap:n_total', kind: 'none', unit: false })}개`, '<span class="tag drv">엔진</span>')
      + row_('단부 거리 e · 간격 s', `${num(state.lap?.si.edge_distance, { src: 'lap:edge_distance', kind: 'length', unit: false })} · ${num(state.lap?.si.spacing, { src: 'lap:spacing', kind: 'length' })}`, '<span class="tag drv">엔진</span>')
      + row_('전달 전단 V', num(state.lap?.si.V_transfer, { src: 'lap:V_transfer', kind: 'force' }), '<span class="tag def" data-tip="기준 조항이 아닌 자체 해석(force_model)">자체 가정</span>')
      + row_('패스너 용량', num(state.lap?.si.capacity, { src: 'lap:capacity', kind: 'force' }), '<span class="tag drv">엔진</span>')), '', '엔진 결과 그대로 — 표 서랍의 「계산 단계」에 식이 있다(US 글)') : '')
    + lists(arr(x.warnings), arr(x.assumptions), arr(x.scope_notes));

}

/** 검토 상태 키(case:<key>) → 가지 */
function branchOfCaseKey(k: string): Branch {
  const key = k.slice(5);
  if (['spans', 'supports', 'laps'].includes(key)) { return 'mem'; }
  const g = CASE_FIELDS.find(f => f.key === key)?.group ?? '';
  return (BRANCH_OF[g] && BRANCH_OF[g] !== 'other' ? BRANCH_OF[g] : 'dc') as Branch;
}

export function infoHtml(key: string): string {
  if (['sec', 'sdim', 'snode', 'selem', 'sspr', 'scon', 'props'].includes(key)) { return sectionInfo(); }
  if (key.startsWith('m') && ['mat', 'mE', 'mNu', 'mG'].includes(key)) { return materialInfo(); }
  if (key === 'mFy' || key === 'mFyRef') { return materialInfo(); }
  if (key.startsWith('case:')) { return caseInfo(branchOfCaseKey(key), key.slice(5)); }
  if (['cond', 'cBC', 'cLc', 'cLen', 'cStr'].includes(key)) { return conditionsInfo(); }
  if (key === 'mem') { return caseInfo('mem', null); }
  if (key === 'ld') { return caseInfo('ld', null); }
  if (key === 'cj') { return caseInfo('cj', null); }
  if (key === 'dc') { return caseInfo('dc', null); }
  if (key === 'asm' || key.startsWith('asm:')) { return assumptionsInfo(); }
  if (key === 'fsm' || key.startsWith('fsm:')) { return bucklingInfo(); }
  if (key === 'load' || key.startsWith('load:')) { return loadInfo(); }
  if (key === 'chk' || key.startsWith('chk:') || key.startsWith('design') || key.startsWith('purlin') || key.startsWith('lap#') || key.startsWith('conn#')) { return checksInfo(key); }
  if (key === 'conn' || key.startsWith('conn:')) { return connInfo(); }
  if (key === 'alt') { return recordInfo('대안', '단면 대안 비교는 기록(R4)부터 생긴다'); }
  if (key === 'ask') { return recordInfo('판단 요청', 'AI 의 판단 요청은 기록(R3)부터 남는다'); }
  if (key === 'rep') { return recordInfo('보고', 'AI 의 보고는 기록(R3)부터 남는다'); }
  if (key === 'chg') { return recordInfo('변경', '누가 · 왜 · 전 → 후 는 변경 기록(R2)부터 남는다'); }
  if (key === 'val') { return pendingInfo('점검', '검증 70항목은 K3 전까지 편집 상태의 검증 탭에서만 돈다'); }
  if (key === 'rpt' || key === 'vtab') { return pendingInfo(key === 'rpt' ? '계산서' : '검증표', '계산서 · 검증표는 K3 전까지 편집 상태의 보고서 · 검증 탭에서만 만든다'); }
  if (key === 'brpt') { return pendingInfo('좌굴 해석 보고서', '좌굴 해석 보고서는 편집 상태의 좌굴해석 탭에서 연다'); }
  if (key === 'src') { return recordInfo('원자료', '원자료(도면 · 제품 자료)는 프로젝트 기록(R1)부터'); }
  if (key === 'pub') { return recordInfo('발행', '발행은 기록(R5)부터'); }
  return hd('', '고른 것 없음', '', '');
}

/** 「Claude 가 보는 선택」의 글 */
export function shareLabel(key: string, rowText: string | undefined): string {
  if (['sec', 'sdim', 'snode', 'selem', 'sspr', 'scon'].includes(key)) { return `단면 「${sectionLabel()}」`; }
  if (key.includes('#')) { const { run, row: r } = rowOfKey(key); return r ? `${r.scope === 'lap' || r.scope === 'connection' ? '접합부 검토' : '부재 검토'} 「${r.where} · ${r.name}」${r.kind === 'ls' && typeof r.ratio === 'number' ? ` · ${ratioText(r.ratio, r.pass === false)}` : ''}` : (run?.label ?? ''); }
  return rowText ?? '없음';
}
