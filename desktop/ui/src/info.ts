/**
 * 오른쪽 정보 창 — 고른 것의 값 · 출처 · 근거만. 선택지 단추 · 요청 양식 · 메모 칸이 없다(사람만 하는 「확인 표시」는 R4 전까지 꺼 둔다).
 *
 * 출처 꼬리표(구성안 3.6): R2 전에는 「기본값인가 아닌가」까지만 — `기본값`(프로그램이 채움 · 엔진이 입력 없이 기본을 씀) /
 * `지정`(누군가 정함 — 누가인지는 R2) / `단면` · `좌굴 해석`(다른 결과에서 나옴). 엔진의 경고 · 가정 · 범위는 세 목록으로 따로 보인다.
 */
import { esc, tip } from './dom';
import { hhmm, lengthAssumed, none, num, ratio, ratioText, refRatio, sigText, unitOf, utilInvalid, utilShown, verdictOf } from './format';
import { BC_KO, dimNames, FAMILY_KO, LOADCASE_KO, sectionLabel, TEMPLATE_KO, TYPE_KO, VERDICT_KO } from './names';
import { assumptionLines, isDefault, memberRuns, noFsmOf, POINT_KO, regionLabel, rowOfKey, state, COMBO_KO, locWords } from './store';
import { noFsmTag } from './tree';
import { demandCapacity, gaugeHtml, highestLine, qnum, ratioFormTag, unText } from './sheet';
import { BRANCH_TITLE, caseNotes, caseReady, caseTables, type Branch } from './caseView';
import { BRANCH_OF, CASE_FIELDS, caseTag } from './caseFields';
import { modeSel } from './center';
import { LABEL as LABEL_OF, si, UNITS_NOTE, type Kind } from './units';
import { isValKey, reportInfo, reportKindOf, valInfo } from './checklist';
import { checkPanel, docs, draftInfo, issueInfo, lastIssue } from './docs';
import { damageInfo } from './damage';
import { fastenerText, fieldText, finder, FORCE_MODEL_WHY, noVerdictWhy, comboStandard, comboStandardTip, forceModelConfirmed, forceModelTag, noteLi, noteList, pageOf, reasonNote, unconfirmedModel, utilHtml, type Note } from './notices';
import { actorOf, actorTag, baseOf, changeOf, chg, groupName, history, KIND_RESULT_KO, LINK_TIP, linkOf, modelTag, runName, aroundOf, runsAround, staleCause, timeline, valText, whoText, type Change, type FieldRec } from './changes';
import { asmInfo, questionsAbout, srcInfo, srcs, work, workInfo } from './work';
import { BRANCH_GROUPS, groupMarkButton, itemOfRow, markButton, markOf, markTip, meaningHtml, othersHtml, rv } from './reviews';
import { alts, altInfo, altRootInfo, visibleAlts } from './alts';
import type { CheckRow } from './store';
import { stageNow } from './center';

const T_DEF = '<span class="tag def" data-tip="아무도 정하지 않아 프로그램이 채웠다">기본값</span>';
const T_SET = '<span class="tag" data-tip="누군가 정한 값. 누가 정했는지(AI · 사람)는 변경 기록(R2)부터 보인다">지정</span>';
const tagSec = '<span class="tag sec" data-tip="단면에서 나온 값">단면</span>';
const tagFsm = '<span class="tag drv" data-tip="좌굴 해석(MCP get_dsm_values)에서 나온 값">좌굴 해석</span>';
const tagEng = '<span class="tag drv" data-tip="엔진이 이 검토에서 쓴 값(결과에 함께 온 것)">엔진</span>';
const RV = `<span class="rv off"${tip('내가 확인했다는 표시. 사람만 켠다. 확인 기록은 R4 부터 남는다 — 지금은 꺼져 있다')}>확인</span>`;

const row_ = (k: string, v: string, src = '', unitCell = '') => `<tr><td>${k}</td><td class="r">${v}</td>${unitCell !== '' ? `<td class="dim">${unitCell}</td>` : ''}<td class="src">${src}</td></tr>`;
const sec = (title: string, body: string, right = '', t?: string) => `<div class="sec"><h4${tip(t)}>${title}<span class="sp"></span>${right}</h4>${body}</div>`;
const table = (rows: string) => `<table class="t"><tbody>${rows}</tbody></table>`;
const hd = (k: string, ttl: string, sub = '', right = RV) => `<div class="hd"><div class="k">${k}<span class="sp"></span>${right}</div><div class="ttl">${esc(ttl)}</div>${sub ? `<div class="dim">${sub}</div>` : ''}</div>`;

const ul = (xs: Note[], cls = 'notes') => `<ul class="${cls}">${xs.map(x => noteLi(x, esc)).join('')}</ul>`;
function lists(warnings: Note[], assumptions: Note[], scope: Note[]): string {
  const li = (xs: Note[]) => (xs.length ? ul(xs) : none('없음'));
  return sec('경고', li(warnings), `<span class="badge${warnings.length ? ' warn' : ''}">${warnings.length}</span>`, '엔진이 낸 경고(warnings) — 엔진의 알림(code)을 제품의 그리기(notices.js)로: 한국어 · 이 화면의 단위')
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
  const tagOf = (k: string, defaultWhy?: string) => modelTag(`model.sectionParams.${k}`, def ? T_DEF : given(k) ? T_SET : `${T_DEF}${defaultWhy ? `<span class="why">${esc(defaultWhy)}</span>` : ''}`);
  let dims = row_('템플릿', esc(TEMPLATE_KO[tpl] ?? TYPE_KO[String(f.section_type ?? '')] ?? '임의 단면'), modelTag('model.sectionTemplate', def ? T_DEF : T_SET));
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
  return hd(`단면 · ${TEMPLATE_KO[tpl] ? `템플릿 ${esc(TEMPLATE_KO[tpl])}` : '템플릿 기록 없음'}`, sectionLabel(), esc([given('r') ? `r ${Number((si(p.r, 'length') ?? 0).toFixed(2))}` : '', LOADCASE_KO[f.load_case] ?? ''].filter(Boolean).join(' · ')), groupMarkButton(BRANCH_GROUPS.section))
    + sec('종류 · 치수', table(dims), tS, '템플릿 치수(바깥-바깥, r = 안쪽 반지름) — MCP get_full_state 의 section_params(K4a)')
    + sec('단면 성질', props, tagSec, `전단면 · 중심선 형상 · MCP get_section_properties 와 같은 값. ${UNITS_NOTE}`)
    + sec('항복값', yrow)
    + sec('요소 분할', mesh);
}

function materialInfo(): string {
  const f = state.full;
  const def = isDefault('material');
  const t = def ? T_DEF : T_SET;
  return hd('재료', '재료', '', groupMarkButton(BRANCH_GROUPS.material_model))
    + sec('탄성 상수', table(row_('E', num(si(f?.material?.E, 'stress'), { src: 'full:material.E', kind: 'stress', sig: 6 }), modelTag('model.prop.E', t))
      + row_('ν', num(f?.material?.v, { src: 'full:material.v', kind: 'none', sig: 3 }), modelTag('model.prop.nu', t))
      + row_('G', num(si(f?.material?.G, 'stress'), { src: 'full:material.G', kind: 'stress', sig: 6 }), modelTag('model.prop.G', t))), '', 'MCP get_full_state 의 material · 꼬리표의 전 → 후 는 변경 기록(list_changes)')
    + caseTables('mat', null)
    + sec('해석 기준 응력', table(row_('기준 응력', typeof f?.load_fy === 'number' ? num(si(f.load_fy, 'stress'), { src: 'full:load_fy', kind: 'stress' }) : none('없음', '하중 경우에 기준 응력을 주지 않았다'),
      state.model?.loadFySource === 'ai' ? caseTag('ai') : '')), '', '좌굴 해석의 기준 응력(get_full_state.load_fy). AI 가 set_load_case 로 정하면 AI(K2 결정 3) — 설계 Fy 와 다르다');
}

/** 부재 · 하중 · 설계 조건 · 접합부 — 호스트의 검토 상태(get_case_inputs) 그대로 */
function caseInfo(b: Branch, focus: string | null): string {
  const c = state.caseIn;
  const dirty = c?.dirty ? `<span class="verdict warn" data-dirty="1"${tip(`저장하지 않은 변경이 있다(검토 상태 판 ${c.rev}${c.dirty_since ? ` · ${c.dirty_since}` : ''})`)}>저장 안 함</span>` : '';
  return hd(`모델 · ${BRANCH_TITLE[b]}`, BRANCH_TITLE[b], caseReady() ? `<span class="dim">검토 상태 판 ${esc(String(c.rev))}</span> ${dirty}` : none('읽는 중'), groupMarkButton(BRANCH_GROUPS[b] ?? []))
    + caseTables(b, focus) + caseNotes();
}

function conditionsInfo(): string {
  const f = state.full;
  const t = isDefault('conditions') ? T_DEF : T_SET;
  const L = f?.lengths;
  return hd('해석 조건', '좌굴 해석 조건', esc(f ? `${f.BC} · ${BC_KO[f.BC] ?? ''}` : ''))
    + sec('조건', table(row_('경계조건', esc(f ? `${f.BC} · ${BC_KO[f.BC] ?? ''}` : ''), modelTag('model.BC', t))
      + row_('하중 경우', f?.load_case ? esc(LOADCASE_KO[f.load_case] ?? f.load_case) : none('정하지 않음'), modelTag('model.loadCase', f?.load_case ? t : ''))
      + row_('기준 응력', typeof f?.load_fy === 'number' ? num(si(f.load_fy, 'stress'), { src: 'full:load_fy', kind: 'stress' }) : none('없음', '하중 경우에 기준 응력을 주지 않았다 — 해석은 절점 응력의 최대 |σ| 를 쓴다'), typeof f?.load_fy === 'number' ? t : '')
      + row_('고유치 수', num(typeof f?.neigs === 'number' ? f.neigs : null, { src: 'full:neigs', kind: 'none' }), modelTag('model.neigs', t))
      + row_('반파장 수', num(L?.n, { src: 'full:lengths.n', kind: 'none' }), modelTag('model.lengths', t))
      + row_('반파장 범위', L ? `${num(si(L.min, 'length'), { src: 'full:lengths.min', kind: 'length', unit: false })} ~ ${num(si(L.max, 'length'), { src: 'full:lengths.max', kind: 'length' })}` : none(), t)
      + row_('절점 응력', f ? `${num(si(f.stress?.min, 'stress'), { src: 'full:stress.min', kind: 'stress', unit: false })} ~ ${num(si(f.stress?.max, 'stress'), { src: 'full:stress.max', kind: 'stress' })}` : none(), '')),
    '', '모두 MCP get_full_state(경계조건 · 반파장 · 응력, 하중 경우 · 기준 응력 · 고유치 수 — K4a)');
}

function recordInfo(title: string, why: string): string {
  return hd(title, title, '', '') + sec('지금', table(row_('기록', none('기록 없음', why), '')), '', why);
}

function assumptionsInfo(): string {
  const items: string[] = [];
  if (isDefault('section')) { items.push(`<tr><td>단면</td><td class="r">프로그램 기본 단면</td><td class="src">${T_DEF}</td></tr>`); }
  if (isDefault('material')) { items.push(`<tr><td>재료</td><td class="r">프로그램 기본값</td><td class="src">${T_DEF}</td></tr>`); }
  if (isDefault('conditions')) { items.push(`<tr><td>해석 조건</td><td class="r">프로그램 기본값</td><td class="src">${T_DEF}</td></tr>`); }
  const eng = assumptionLines().map(a => `<li data-asm-where="${esc(a.where)}"${a.code ? ` data-code="${esc(a.code)}"` : ''}><b>${esc(a.where)}</b> — ${esc(a.text)}</li>`);
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
    + r3('국부', 'crl', 'Lcrl', 'LF_local', us.local_basis ? `근거: ${fieldText(us, 'local_basis')}` : undefined)
    + r3('뒤틀림', 'crd', 'Lcrd', 'LF_dist', us.dist_basis ? `근거: ${fieldText(us, 'dist_basis')}` : undefined)
    + r3('전체', 'cre', 'Lcre', 'LF_global', us.global_is_signature_asymptote ? '유효 길이를 주지 않아 서명 곡선의 끝값(global_is_signature_asymptote)' : undefined)
    + '</tbody></table>';
  const meta = table(row_('하중 계열', esc(FAMILY_KO[fam] ?? fam), tagFsm)
    + row_(`${fam === 'P' ? 'Py' : 'My'} (기준)`, num(d.P_y, { src: `dsm:${fam}.P_y`, kind: k }), tagFsm)
    + row_('기준 응력', num(dsm.si?.fy_used, { src: 'dsm:fy_used', kind: 'stress' }), tagFsm)
    + row_('모드 식별', esc(us.classification_method ? fieldText(us, 'classification_method') : '—'), '')
    + row_('극소 수', num(us.n_minima, { src: `dsm:${fam}.n_minima`, kind: 'none' }), ''));
  return hd('결과 · 좌굴 해석', `좌굴 해석 · ${FAMILY_KO[fam] ?? fam}`, `<span class="verdict ok">일치</span> <span class="dim">MCP get_dsm_values 와 같은 값</span>`, resultMark('buckling_analysis'))
    + sec('탄성 좌굴', tbl, tagFsm) + selectedLength() + sec('해석', meta)
    + resultLists(dsm.us, us);
}

/** 결과 하나(알림이 붙은 묶음)의 경고 · 가정 · 범위 — 같은 결과 나무에서 알림을 찾는다 */
function resultLists(tree: any, o: any): string {
  const f = finder(tree);
  return lists(noteList(o, 'warnings', f), noteList(o, 'assumptions', f), noteList(o, 'scope_notes', f));
}

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
  return hd(`결과 · 하중 해석${L.from === 'purlin' ? ' · 퍼린 설계의 하중 해석' : ''}`, `지배 조합 — ${String(us.governing?.combo ?? '')}`, v, resultMark('load_analysis'))
    + sec('조합', table(row_('설계법', esc(String(us.design_method ?? '—')), tagLa)
      + ((c) => (c ? row_('하중조합 기준', `<span data-combo-std="${esc(c.key ?? '')}"${tip(comboStandardTip(c))}>${esc(c.edition || '—')}</span>`, `${tagLa}${c.key ? '' : '<span class="why">처음 값</span>'}`) : ''))(comboStandard(us))
      + row_('해석', esc(us.analysis_method ? fieldText(us, 'analysis_method') : '—'), tagLa)
      + wl.map((w, i) => row_(`wu 경간 ${i + 1}`, num(w, { src: `loads:governing.governing_span_loads_plf.${i}`, kind: 'linload' }), tagLa)).join('')), '', '엔진의 지배 조합과 그 경간 하중(kN/m)')
    + sec('지점 반력(포락 최대)', table(R.map((r, i) => row_(`지점 ${String.fromCharCode(65 + i)}`, num(r, { src: `loads:governing.R_envelope_max.${i}`, kind: 'force' }), tagLa)).join('')))
    + sec('처짐', table(defl.map((d, i) => row_(`경간 ${d.span ?? i + 1}`, `${num(d.delta_in, { src: `loads:deflection.per_span.${i}.delta_in`, kind: 'length' })} · L/${num(d.L_over_delta, { src: `loads:deflection.per_span.${i}.L_over_delta`, kind: 'none' })}`, tagLa)).join('')), '', us.deflection?.basis ? fieldText(us.deflection, 'basis') : '')
    + resultLists(us, us)
    + ((ne => (ne.length ? sec('미검토', ul(ne)) : ''))(noteList(us, 'not_evaluated', finder(us))));
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
  const head = `<div><span class="verdict ${vv.cls === 'na' ? 'un' : vv.cls}" data-verdict="${esc(row?.verdict ?? '')}">${vv.text}</span> <span class="big">${typeof focusRatio === 'number' ? ratio(focusRatio, ng, row ? `${row.src}ratio` : `${run.src}utilization`) : row && row.kind !== 'ls' ? `<span class="un-head" data-un-head>${esc(unText(row))}</span>` : utilHtml(run.us, run.result?.utilization, `${run.src}utilization`, none('판정비 없음'))}</span>`
    + ` <span class="dim">${dcLine}${row?.clause ? ` · §${esc(row.clause)}` : ''}${row ? ratioFormTag(row) : ''}</span></div>`
    + (row && (row.kind === 'ne' || row.kind === 'na') ? ((rn => `<div class="dim" data-reason${rn?.code ? ` data-code="${esc(rn.code)}"` : ''}>${esc(rn?.text ?? '')}</div>`)(reasonNote(row.us))) : '')
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
    us.dsm_source || us.dsm_basis_by_family ? row_('좌굴 값의 출처', esc(Object.entries(us.dsm_source ?? {}).map(([a, b]) => `${a} ${b && typeof b === 'object' ? Object.entries(b).map(([c, d]) => `${c} ${d}`).join(' · ') : b}`).join(' · ')), dsmBasisTag(us) + noFsmTag(noFsmOf(run))) : '',
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
  const out = run.notChecked.length ? ul(run.notChecked, 'notes faint') : none('없음');
  const sheetLink = row && row.us ? `<a class="lnk" data-sheet="${esc(row.key)}"${tip('이 검토 항목의 계산 시트(Enter · 두 번 누르기)')}>계산 시트 →</a>` : '';
  const rvIt = row && rv.loaded ? itemOfRow(row) : null;
  const rvBtn = !row?.us ? RV : !rv.loaded ? markButton(null, '', '확인 표시는 프로젝트의 검토 대상에서만 — 이 파일은 프로젝트 밖이다') : !rvIt ? markButton(null, '', '이 줄의 항목이 확인 목록(get_reviews)에 없다')
    : markButton(rvIt, `data-rv-check="${esc(row.key)}"`);
  // E5: FSM 없이 계산했으면(호스트의 dsm_basis_by_family) 머리 아래에 눈에 띄게
  const nf = noFsmOf(run);
  const nfNotice = nf ? `<div class="notice" data-no-fsm-notice>${noFsmTag(nf)} 이 검토는 FSM 좌굴값 없이 계산했다 — 호스트가 설계 Fy 의 S-S 서명곡선 FSM 값을 준비하지 못했다(까닭은 경고의 [DSM] 줄). ${esc(nf.analytic ? `해석식의 ${nf.syms} 를 썼다` : `엔진이 ${nf.syms} 를 정하지 못했다`)}</div>` : '';
  return `<div class="hd"><div class="k">${kHead}<span class="sp"></span>${rvBtn}</div><div class="ttl">${esc(row ? `${row.where} · ${row.name}` : run.label)}</div>${head}</div>`
    + nfNotice
    + sec('설계 가정', used, '', '이 판정에 엔진이 쓴 값. 입력의 출처는 모델 탭의 부재 · 하중 · 설계 조건(검토 상태) — 사람별 기록은 R2 부터')
    + sec(row?.pointName ? '한계상태 · 이 위치' : '한계상태 · 이 검토', ls, sheetLink)
    + (run.neTexts.length ? sec('엔진의 미검토 글', ul(run.neTexts), '', '엔진 결과의 not_evaluated 알림(검토 항목과 같은 것을 글로)') : '')
    + sec('범위 밖', out, '', '엔진이 이 검토에서 하지 않은 것(not_checked) — 판정에 들어가지 않는다. 미검토(not_evaluated)와 다르다')
    + lists(run.warnings, run.assumptions, run.scope)
    + (row?.us && rv.loaded ? `<div class="sec chkrow"><span class="chk${rvIt?.state === 'reviewed' ? ' on' : ''}" data-rv-check="${esc(row.key)}"${tip(markTip(rvIt))}>확인 표시</span><span class="faint">Space</span><span class="sp"></span>`
      + `<span class="faint">확인 ${rv.reviewed}/${rv.total}${rv.again ? ` · 다시 확인 ${rv.again}` : ''}</span></div>` + meaningHtml() + othersHtml()
      : `<div class="sec chkrow"><span class="chk off"${tip('확인 표시는 프로젝트의 검토 대상에서만(기록이 그곳에 남는다)')}>확인 표시</span><span class="faint">Space</span><span class="sp"></span></div>`)
    + (row?.us && alts.items.length ? altSeeAlso(row) : '');
}

/**
 * 좌굴 값의 출처 꼬리표 — 하중군마다의 것(dsm_basis_by_family: P · Mxx → prepared · current_analysis · none)이 있으면 그것으로,
 * 지금 해석에서 온 하중군이 있으면 「좌굴 해석」(그 하중군을 적는다). 없으면 dsm_basis(current_analysis · prepared+current_analysis)
 */
const BASIS_KO: Record<string, string> = { prepared: '서명곡선 FSM(설계 Fy)', current_analysis: '지금 해석', none: '없음' };
function dsmBasisTag(us: any): string {
  const by = us?.dsm_basis_by_family && typeof us.dsm_basis_by_family === 'object' ? Object.entries(us.dsm_basis_by_family as Record<string, string>) : [];
  if (by.length) {
    const cur = by.filter(([, b]) => b === 'current_analysis').map(([f]) => f);
    return `${cur.length ? tagFsm : ''}<span class="why" data-dsm-basis="${esc(by.map(([f, b]) => `${f}=${b}`).join(','))}">${esc(by.map(([f, b]) => `${f} ${BASIS_KO[b] ?? b}`).join(' · '))}</span>`;
  }
  return us?.dsm_basis === 'current_analysis' || us?.dsm_basis === 'prepared+current_analysis' ? tagFsm : '';
}

/** 같이 볼 것 · 대안 — 그 검토 열쇠의 판정비를 대안마다(호스트의 compare 그대로 — 순위를 짓지 않는다) */
function altSeeAlso(row: CheckRow): string {
  const it = itemOfRow(row);
  const list = visibleAlts();
  const cells = list.map(a => {
    const c = alts.cmp.get(a.item);
    if (!c) { return `<li class="faint">${esc(a.label)} · 읽는 중</li>`; }
    const r = (Array.isArray(c.rows) ? c.rows : []).find((x: any) => x.key === it?.key);
    const x = r?.alt ?? null;
    return `<li data-alt-see="${esc(a.item)}"><a class="lnk" data-ref-go="${esc(`result|alt:${a.item}`)}">${esc(a.label)}</a> · ${x && typeof x.ratio === 'number' ? `${ratioText(x.ratio, x.verdict === 'fail')} ${x.verdict === 'fail' ? 'NG' : x.verdict === 'pass' ? 'OK' : '미검토'}` : '없음'}</li>`;
  }).join('');
  return `<div class="sec"><h4${tip('이 검토 항목(같은 열쇠)의 판정비를 대안마다 — 호스트의 비교. 프로그램은 대안의 순위를 짓지 않는다')}>같이 볼 것 · 대안<span class="sp"></span></h4><ul class="notes">${cells}</ul></div>`;
}
function unusedRowCloser(): void {}

/** 낡음 표지 — 풍선에 그 결과를 무효로 만든 변경의 때 · 전 → 후(R2-3 · 템플릿 06). 기록에 없으면 장부의 까닭만 */
function staleBalloon(kinds: string[]): string {
  const sc = staleCause(kinds);
  return `<span class="verdict warn" data-stale-cause="${esc(sc?.c.id ?? '')}"${tip(sc ? `${sc.text} — 누르면 업무 › 변경의 그 줄` : '입력이 바뀌어 호스트가 결과를 지웠다(변경 기록에 그 묶음이 없다)')}${sc ? ` data-chg-go="${esc(sc.c.id)}"` : ''}>● 낡음</span>`
    + (sc ? ` <span class="why" data-stale-text>${esc(sc.text)}</span>` : '');
}

// ── 업무 › 변경(R2-3 · 템플릿 07 정보 창) ─────────────────────────────
function changeInfo(key: string): string {
  const c: Change | undefined = key.startsWith('chg:') ? changeOf(key.slice(4)) : chg.list[0];
  if (!c) { return hd('업무 · 변경', '변경', chg.err ? none('변경을 읽지 못함', chg.err) : none('변경 없음', '이 대상에 기록된 변경 묶음이 없다'), ''); }
  // ① 머리 — 행위자 배지 · 시각 · 제목 · [확인]
  const RVc = rv.loaded ? markButton(markOf('change', c.id), `data-rv-change="${esc(c.id)}"`) : markButton(null, '', '확인 표시는 프로젝트의 검토 대상에서만');
  const head = `<div class="hd"><div class="k">${actorTag(c)}${linkOf(c) ? `<span class="tag def" data-link="${esc(String(c.trigger))}"${tip(LINK_TIP)}>${esc(linkOf(c)!)}</span>` : ''}변경 · ${esc(hhmm(c.at))}${c.by.client ? ` <span class="faint">${esc(c.by.client)}</span>` : ''}<span class="sp"></span>${RVc}</div>`
    + `<div class="ttl" data-chg-title${tip('제목은 프로그램이 바뀐 칸에서 지었다. 되돌리려면 Claude 에게 말한다 — 되돌리기도 새 변경으로 이 목록에 남는다')}>${esc(c.title || '(제목 없음)')}</div>`
    + `${chg.persisted ? '' : `<div class="dim" data-memory${tip('프로젝트 밖(또는 읽기 전용) — 이 세션의 메모리에만 있다')}>이 세션 · 저장되지 않음</div>`}</div>`;
  const i = chg.list.indexOf(c);
  const prev = chg.list.slice(i + 1).find(x => x.by.kind === c.by.kind) ?? null;
  const next = i > 0 ? [...chg.list.slice(0, i)].reverse().find(x => x.by.kind === c.by.kind) ?? null : null;
  const r2 = (v: unknown) => (typeof v === 'number' ? sigText(v, 3) : '—');
  const ar = aroundOf(c);
  // ② 왜 — 이유 / 관련 업무(Q-n · I-n) / 원자료(S-n)
  const wi = c.work ? work.items.find(w => w.item === c.work) : null;
  const src = c.source ? srcs.items.find(s => s.item === c.source) : null;
  const why = `<dl class="kv">${c.reason ? `<dt>이유</dt><dd data-reason-text>${esc(c.reason)}</dd>` : `<dt>이유</dt><dd class="faint"${tip(c.by.kind === 'person' ? '사람의 묶음에는 이유 칸이 없다' : '도구의 reason 인자를 주지 않았다')}>밝히지 않음</dd>`}`
    + (c.work ? `<dt>관련 업무</dt><dd data-work="${esc(c.work)}">${wi ? `<a class="lnk" data-ref-go="${esc(`work|work:${c.work}`)}">${esc(c.work)} · ${esc(wi.title)}</a>` : `${esc(c.work)} <span class="faint">목록에 없음</span>`}</dd>` : '')
    + (c.source ? `<dt>원자료</dt><dd>${src ? `<a class="lnk" data-ref-go="${esc(`doc|srcr:${c.source}`)}">${esc(c.source)} · ${esc(src.title)}</a>` : esc(c.source)}</dd>` : '') + '</dl>';
  // ③ 바뀐 것 — 항목 · 이전 · 이후 · 단위(호스트의 구조) + 그 앞 · 뒤 실행이 쓴 단면 성질(실행 이력의 props, 엔진 US → 이 화면의 변환)
  const fs = c.field_changes ?? [];
  const fRow = (f: FieldRec) => (f.summary || !('from' in f || 'to' in f)
    ? `<tr data-path="${esc(f.path)}"><td colspan="5">${esc(f.text)}</td></tr>`
    : `<tr data-path="${esc(f.path)}"><td>${esc(f.label_ko || f.key)}</td><td class="r num dim">${esc(valText(f.from))}</td><td class="r">→</td><td class="r num" style="color:var(--mod)">${esc(valText(f.to))}</td><td class="dim">${f.unit ? ` ${esc(f.unit)}` : ''}</td></tr>`);
  const PROP_KIND: Array<[string, Kind]> = [['A', 'area'], ['Ixx', 'inertia'], ['Izz', 'inertia'], ['Sx', 'modulus'], ['Sxx', 'modulus'], ['Sf', 'modulus'], ['J', 'inertia'], ['Cw', 'warping']];
  const pb = ar.before?.props ?? null, pa = ar.after?.props ?? null;
  const propRows = pb && pa ? PROP_KIND.filter(([k]) => typeof pb[k] === 'number' && typeof pa[k] === 'number' && pb[k] !== pa[k]).map(([k, kind]) =>
    `<tr data-prop="${esc(k)}"><td>${esc(k)}</td><td class="r num dim">${esc(sigText(si(pb[k], kind) ?? pb[k], 4))}</td><td class="r">→</td><td class="r num">${esc(sigText(si(pa[k], kind) ?? pa[k], 4))}</td><td class="dim"> ${esc(LABEL_OF[kind])}</td></tr>`).join('') : '';
  const changed = fs.length || propRows ? `<table class="t" data-chg-fields><thead><tr><th>항목</th><th class="r">이전</th><th></th><th class="r">이후</th><th>단위</th></tr></thead><tbody>${fs.map(fRow).join('')}${c.fields > fs.length ? `<tr><td class="faint" colspan="5">외 ${c.fields - fs.length} 칸</td></tr>` : ''}${propRows}</tbody></table>`
    : none(`바뀐 칸 ${c.fields}`, '칸 글이 없다');
  // ④ 결과에 미친 영향 — 판정 이전 → 이후 · 지배 항목 · 낡게 한 결과(+ 다시 확인 · 대안)
  const inv = c.invalidated ?? [];
  const verdictRow = ar.before || ar.after
    ? `<dt>최대 판정비</dt><dd data-ratio-around>${r2(ar.before?.max_ratio)} → ${r2(ar.after?.max_ratio)}${ar.after?.governing?.id ? ` <span class="why">지배 ${esc(String(ar.after.governing.id))}</span>` : ''}</dd>`
    : history() && !ar.anyAfter ? '<dt>판정</dt><dd class="warn" data-recalc>다시 계산 필요 — 이 묶음 뒤에 계산하지 않았다</dd>' : '';
  const invRows = inv.map(k => { const s2 = stageNow(k); return `<dt>${esc(KIND_RESULT_KO[k] ?? k)}</dt><dd><span class="${s2.cls}" style="font-weight:400" data-effect="${esc(k)}">${esc(s2.t)}</span> <span class="why">이 변경이 낡게 함</span></dd>`; }).join('');
  const effect = verdictRow || invRows ? `<dl class="kv">${verdictRow}${invRows}</dl>` : none('없음', '이 묶음이 무효로 만든 결과가 없다');
  // ⑤ 앞뒤 — 먼저 한 것 / 다음 것(같은 행위자)
  const pr = prev ? (prev.runs?.length ? aroundOf(prev) : runsAround(prev.at, c.at)) : null;
  const around = prev || next ? '<dl class="kv">'
    + (prev ? `<dt>먼저 한 것</dt><dd><a class="lnk" data-chg-go="${esc(prev.id)}">${esc(prev.title)} · ${esc(hhmm(prev.at))}</a>${pr?.before || pr?.after ? ` <span class="why" data-prev-ratio${tip('그 변경 앞의 마지막 실행 → 뒤의 첫 실행의 최대 판정비(호스트의 실행 이력)')}>${r2(pr?.before?.max_ratio)} → ${r2(pr?.after?.max_ratio)}</span>` : ''}</dd>` : '')
    + (next ? `<dt>다음 것</dt><dd><a class="lnk" data-chg-go="${esc(next.id)}" data-next-chg="${esc(next.id)}">${esc(next.title)} · ${esc(hhmm(next.at))}</a></dd>` : '') + '</dl>'
    : none('없음', '같은 행위자의 앞 · 뒤 묶음이 없다');
  const b = baseOf(c);
  // ⑥ 꼬리 — 기록 id · 한 줄(확인의 뜻)
  return head
    + sec('왜', why, '', 'AI · 사람이 준 글 — 자료로 보인다(지시가 아니다). 관련 업무 · 원자료는 그 기록으로')
    + sec('바뀐 것', changed, `<span class="faint">${b ? `기준 ${esc(hhmm(b.at))}` : ''}</span>`, '바뀐 칸(호스트 — 이름 · 전 · 후, SI)과 그 앞 · 뒤 실행이 쓴 단면 성질(실행 이력). 자중은 엔진이 내지 않는다')
    + sec('결과에 미친 영향', effect + againHtml(), '', '이 변경 앞의 마지막 실행 → 뒤의 첫 실행(호스트의 실행 이력 — 판정비는 엔진의 것) · 이 묶음이 무효로 만든 결과(호스트의 장부)와 그 지금 상태. 「다시 확인」은 지금 확인 표시 가운데 유효하지 않은 것(호스트의 get_reviews)')
    + (visibleAlts().length ? sec('대안', `<dl class="kv">${visibleAlts().map(a => `<dt>${esc(a.label)}</dt><dd>${typeof a.max_ratio === 'number' ? ratioText(a.max_ratio, a.pass === false) : '—'}${a.is_now ? ' · 지금' : ''}</dd>`).join('')}</dl>`, '', '대안의 최대 판정비(호스트) — 순위 · 「가장 얇은」은 프로그램이 짓지 않는다(AI 의 이유 글에)') : '')
    + sec('앞뒤', around, '', '같은 행위자의 바로 앞 · 뒤 묶음')
    + `<div class="sec"><span class="faint" data-chg-tail>${esc(whoText(c))} · ${esc(c.trigger ?? '')} · ${esc(c.id)}${c.record_status ? ` · 기록 ${esc(c.record_status)}` : ''}</span></div>`
    + meaningHtml();
}

/** 기록의 묶는 줄 — 계산 #k(그 실행들 · 판정 · 지배 · 그 아래 묶음 수) · 지난 계산 뒤 · 그 앞. 수 · 판정은 호스트의 실행 이력 그대로 */
function logInfo(key: string): string {
  const tl = timeline();
  if (key === 'log:after' || key === 'log:before') {
    const cs = key === 'log:after' ? tl.after : tl.before;
    const pend = cs.filter(c => actorOf(c) !== 'program').length;
    return hd('업무 · 기록', key === 'log:after' ? '지난 계산 뒤' : '그 앞', `<span class="dim">묶음 ${cs.length}${key === 'log:after' ? ` · 다시 계산할 것 ${pend}(프로그램의 연동 줄은 세지 않는다)` : ''}</span>`, '');
  }
  const g = tl.groups.find(x => x.key === key);
  if (!g) { return hd('업무 · 기록', '계산', none('그 실행이 이력에 없다', '실행 이력은 새 것부터 20'), ''); }
  const v = g.verdict;
  const rows = g.runs.slice().reverse().map(r => `<tr data-run="${esc(String(r.run ?? ''))}"><td>${esc(runName(r))}</td><td>${esc(KIND_RESULT_KO[r.kind] ?? r.kind)}</td><td class="dim">${esc(hhmm(r.at))}</td><td class="dim">${esc(r.by ? (r.by === 'person' ? '사람' : r.by === 'ai' ? 'AI' : r.by) : '')}</td>`
    + `<td class="r">${r.pass === true ? 'OK' : r.pass === false ? 'NG' : ''} ${typeof r.max_ratio === 'number' ? esc(sigText(r.max_ratio, 3)) : ''}</td></tr>`).join('');
  return hd('업무 · 기록', groupName(g), v ? `<span class="verdict ${v.pass === true ? 'ok' : v.pass === false ? 'ng' : 'un'}">${v.pass === true ? 'OK' : v.pass === false ? 'NG' : '판정 없음'}</span>${typeof v.max_ratio === 'number' ? ` <span class="big">${esc(sigText(v.max_ratio, 3))}</span>` : ''}${v.governing?.id ? ` <span class="dim">지배 ${esc(String(v.governing.id))}</span>` : ''}` : none('판정 없음'), '')
    + sec('실행', table(rows), '', '실행 하나 = 머리줄 하나(잇단 실행을 접지 않는다) — 호스트의 실행 이력(get_case_status detail runs)')
    + sec('이 계산에 들어간 묶음', g.changes.length ? `<ul class="notes">${g.changes.map(c => `<li><a class="lnk" data-chg-go="${esc(c.id)}">${esc(c.title)} · ${esc(whoText(c))} · ${esc(hhmm(c.at))}</a></li>`).join('')}</ul>` : none('입력 변경 없음', '앞 계산 뒤에 바뀐 입력이 없다'), '', '이 계산에 처음 들어간 묶음 — MCP work_log 의 연결과 같다(다시 계산해도 뒤 계산으로 옮겨 가지 않는다)');
}

function connInfo(): string {
  const s = state.stages.conn;
  const lap = state.msgs.lapConnectionResult?.message?.data;
  const one = state.msgs.connectionResult?.message?.data;
  const x = lap ?? one;
  // 06: 이 결과(랩 · 접합)를 가리키는 열린 판단 요청 — 「판단 요청 「제목」 · 답 기다림 →」(R3-3). 결과가 낡아 지워졌어도 보인다
  const qs = questionsAbout(['lap', 'connection'], ['lap', 'connection']);
  const qNotice = qs.map(({ w }) => `<div class="notice" data-q-notice="${esc(w.item)}" data-ref-go="${esc(`work|work:${w.item}`)}"><b>판단 요청</b> 「${esc(w.title)}」 · 답 기다림 <a class="lnk">→</a></div>`).join('');
  if (!x) {
    return hd('결과 · 접합부 검토', '접합부 검토', s.state === 'stale' ? `${staleBalloon(['lap', 'connection'])} <span class="dim">${esc(s.note)}</span>` : none('아직 평가 안 함'), '') + qNotice;
  }
  const v = verdictOf(x.pass, '판정 없음');
  const fm = x.force_model;
  const fmc = forceModelConfirmed(x);
  const notice = qNotice + (fm && fm.specification_provision === false ? `<div class="notice" data-force-model-notice="${fmc === true ? 'confirmed' : fmc === false ? 'unconfirmed' : 'unknown'}"><b>자체 가정</b> 패스너 힘 분배는 기준 조항이 아닌 자체 해석이다${fmc === true ? ' — 사람이 그 모델(모든 패스너가 고르게)로 판정한다고 밝혔다' : fmc === false ? ' — 사람이 그 모델로 판정한다고 밝히지 않았다: 패스너 무리 · 개수는 그 모델로도 넘을 때만 NG, 아니면 평가하지 못함(판정 없음)' : ''}<span class="dim">${esc(String(fm.clause ?? ''))}</span></div>` : '');
  return hd('결과 · 접합부 검토', lap ? '랩 접합' : '단일 접합', `${s.state === 'stale' ? `${staleBalloon(['lap', 'connection'])} ` : ''}<span class="verdict ${v.cls}"${x.pass === null || x.pass === undefined ? tip(noVerdictWhy(x)) : ''}>${v.text}</span> ${((h) => (h ? `<span class="big">${h}</span>` : ''))(x.pass === null || x.pass === undefined ? (lengthAssumed(x) && typeof x.utilization === 'number' ? refRatio(x.utilization) : '') : utilHtml(x, x.utilization, `${lap ? 'lap' : 'conn'}:utilization`))}`
    + (s.state === 'unk' ? ` <span class="dim">${esc(s.note)}</span>` : ''), '')
    + notice
    + sec('판정비', table(lapRatios(x, !!lap)))
    + (lap ? sec('입력과 출처', table(
      row_('랩 길이', `${num(state.lap?.si.lap_left_in, { src: 'lap:lap_left_in', kind: 'length', unit: false })} | ${num(state.lap?.si.lap_right_in, { src: 'lap:lap_right_in', kind: 'length' })}`, '<span class="tag">지정</span>')
      + row_('패스너', `${esc(fastenerText(lap, ''))} · ${num(state.lap?.si.n_total, { src: 'lap:n_total', kind: 'none', unit: false })}개`, '<span class="tag drv">엔진</span>')
      + row_('단부 거리 e · 간격 s', `${num(state.lap?.si.edge_distance, { src: 'lap:edge_distance', kind: 'length', unit: false })} · ${num(state.lap?.si.spacing, { src: 'lap:spacing', kind: 'length' })}`, '<span class="tag drv">엔진</span>')
      + row_('전달 전단 V', num(state.lap?.si.V_transfer, { src: 'lap:V_transfer', kind: 'force' }), forceModelTag(lap) || '<span class="tag def" data-tip="기준 조항이 아닌 자체 해석(force_model)">자체 가정</span>')
      + row_('패스너 용량', num(state.lap?.si.capacity, { src: 'lap:capacity', kind: 'force' }), '<span class="tag drv">엔진</span>')
      + lapSectionRows(lap.section_source)), '', '엔진 결과 그대로 — 표 서랍의 「계산 단계」에 식이 있다(US 글)') : '')
    + resultLists(x, x);

}

/**
 * 판정비 줄 — 랩(733c18e 뒤): `utilization` 은 판정이 난 랩 강도 검토 가운데 가장 큰 비(지배 = governing_check), 패스너 무리의 비는
 * `fastener_utilization`(그 키가 없는 옛 결과만 utilization 이 패스너). 단일 접합은 utilization 그대로
 */
function lapRatios(x: any, lap: boolean): string {
  const pre = lap ? 'lap' : 'conn';
  if (!lap) { return ((h) => (h ? row_('패스너', h, '') : ''))(utilHtml(x, x.utilization, `${pre}:utilization`)); }
  const newShape = 'fastener_utilization' in x;
  const fast = newShape ? x.fastener_utilization : x.utilization;
  return (newShape && utilInvalid(x) ? row_('지배', utilHtml(x, x.utilization, 'lap:utilization'), '<span class="tag drv">엔진</span>') : '') + (newShape && utilShown(x) !== null ? row_('지배', `${ratio(x.utilization, x.pass === false, 'lap:utilization')} <span class="faint" data-governing>${esc(String(pageOf(x)?.governing_check ?? ''))}</span>`, '<span class="tag drv">엔진</span>') : '')
    + (typeof fast === 'number' ? row_('패스너 무리', unconfirmedModel(x) && !(fast > 1) ? refRatio(fast, FORCE_MODEL_WHY) : ratio(fast, fast > 1, newShape ? 'lap:fastener_utilization' : 'lap:utilization'), unconfirmedModel(x) ? forceModelTag(x) : '') : '')
    + (typeof x.flexure_dcr === 'number' ? row_('랩 구간 휨', ratio(x.flexure_dcr, x.flexure_dcr > 1, 'lap:flexure_dcr'), '') : '');
}
/** 랩 단면 강도의 출처(section_source — daca0ac): Se · Vn · 어디서(지점 · 랩 구간), 짓지 않았으면 그 까닭 그대로 */
function lapSectionRows(ss: any): string {
  if (!ss || typeof ss !== 'object') { return ''; }
  const v = (x: unknown, kind: Kind) => (typeof x === 'number' ? `${sigText(si(x, kind) ?? x, 4)} <span class="u">${esc(LABEL_OF[kind])}</span>` : '<span class="faint">없음</span>');
  const where = [ss.support !== null && ss.support !== undefined ? `지점 ${esc(ss.support)}` : '', Array.isArray(ss.regions) && ss.regions.length ? `랩 구간 ${esc(ss.regions.join(', '))}` : ''].filter(Boolean).join(' · ');
  return row_('랩 단면 Se · Vn', `${v(ss.Se, 'modulus')} · ${v(ss.Vn, 'force')}`, `<span class="tag drv" data-section-source>${ss.Se === null || ss.Se === undefined ? '짓지 않음' : '퍼린 결과'}</span>`)
    + row_('Se 의 출처', `<span data-section-from>${ss.Se === null || ss.Se === undefined ? esc(fieldText(ss, 'reason')) : esc(fieldText(ss, 'from'))}</span>${where ? ` <span class="faint">${where}</span>` : ''}`, '');
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
  if (key === 'chg' || key.startsWith('chg:')) { return changeInfo(key); }
  if (key.startsWith('work:')) { return workInfo(key); }
  if (key.startsWith('asmr:')) { return asmInfo(key); }
  if (key.startsWith('srcr:')) { return srcInfo(key); }
  if (key.startsWith('alt:')) { return altInfo(key); }
  if (key === 'fsm' || key.startsWith('fsm:')) { return bucklingInfo(); }
  if (key === 'load' || key.startsWith('load:')) { return loadInfo(); }
  if (key === 'chk' || key.startsWith('chk:') || key.startsWith('design') || key.startsWith('purlin') || key.startsWith('lap#') || key.startsWith('conn#')) { return checksInfo(key); }
  if (key === 'conn' || key.startsWith('conn:')) { return connInfo(); }
  if (key === 'alt') { return altRootInfo(); }
  if (key.startsWith('log:')) { return logInfo(key); }
  if (['todo', 'insp', 'ask:done'].includes(key) || /^(todo|insp):/.test(key)) {
    const T: Record<string, [string, string]> = { todo: ['할 일', '사람이 처리할 것 — 판단 요청 · 확인 대기 · 임시 가정'], 'todo:rv': ['확인 대기', 'AI 가 바꾼 묶음 가운데 사람의 확인 표시가 없는 것 — 묶음을 고르고 「확인」'],
      'todo:asm': ['임시 가정', '닫히지 않은 임시 가정 — 사람의 확인 전까지 발행을 막는다'], insp: ['점검', '지금 결과의 상태 — 줄을 누르면 그 탭의 줄로'], 'ask:done': ['지난 판단 요청', '답한 · 닫힌 판단 요청'] };
    const [t, w] = T[key] ?? ['업무', '줄을 누르면 그 탭의 줄로'];
    return hd(`업무 · ${t}`, t, `<span class="dim">${esc(w)}</span>`, '');
  }
  if (key === 'ask') { return recordInfo('판단 요청', 'AI 의 판단 요청은 기록(R3)부터 남는다'); }
  if (key === 'rep') { return recordInfo('보고', 'AI 의 보고는 기록(R3)부터 남는다'); }
  if (key === 'chg') { return recordInfo('변경', '누가 · 왜 · 전 → 후 는 변경 기록(R2)부터 남는다'); }
  if (isValKey(key) || key === 'vtab') { return valInfo(key === 'vtab' ? 'val' : key); }
  if (reportKindOf(key)) { return reportInfo(key); }
  if (key.startsWith('doc:')) { return draftInfo(key) + (docs.loaded ? checkPanel() : ''); }
  if (key.startsWith('iss:')) { return issueInfo(key); }
  if (key === 'dmg') { return damageInfo(); }
  if (key === 'pub' || key.startsWith('pubf:')) {
    const l = lastIssue();
    return `<div class="hd"><div class="k">발행<span class="sp"></span></div><div class="ttl">${l ? `마지막 R${l.revision} — ${l.state_ko}` : '발행 없음'}</div></div>` + (docs.loaded ? checkPanel() : '');
  }
  if (key === 'src') { return recordInfo('원자료', '원자료(도면 · 제품 자료)는 프로젝트 기록(R1)부터'); }
  if (key === 'pub') { return recordInfo('발행', '발행은 기록(R5)부터'); }
  return hd('', '고른 것 없음', '', '');
}

/** 「Claude 가 보는 선택」의 글 */
export function shareLabel(key: string, rowText: string | undefined): string {
  if (['sec', 'sdim', 'snode', 'selem', 'sspr', 'scon'].includes(key)) { return `단면 「${sectionLabel()}」`; }
  if (isValKey(key)) { return rowText ? `점검 「${rowText}」` : '점검'; }
  if (key.includes('#')) { const { run, row: r } = rowOfKey(key); return r ? `${r.scope === 'lap' || r.scope === 'connection' ? '접합부 검토' : '부재 검토'} 「${r.where} · ${r.name}」${r.kind === 'ls' && typeof r.ratio === 'number' ? ` · ${ratioText(r.ratio, r.pass === false)}` : ''}` : (run?.label ?? ''); }
  return rowText ?? '없음';
}

/** 결과(02 좌굴 해석 · 03 하중 해석)의 확인 — 그린 결과의 지문(get_reviews.result_fps) */
function resultMark(kind: string): string {
  if (!rv.loaded) { return ''; }
  const fp = rv.resultFps[kind];
  return fp ? markButton(markOf('result', kind), `data-rv-result="${esc(kind)}" data-rv-fp="${esc(fp)}"`) : markButton(null, '', '지금 이 결과가 기록에 없다(다시 돌린 뒤 확인)');
}
/** 「다시 확인」 줄 — 지금 유효하지 않은 표시(호스트의 get_reviews: why_ko · 다른 곳) */
function againHtml(): string {
  const xs = rv.items.filter(x => x.state === 'review-again');
  if (!xs.length) { return ''; }
  return `<dl class="kv" data-review-again="${xs.length}"><dt>다시 확인</dt><dd>${xs.length} · ${xs.slice(0, 4).map(x => `<span${tip(markTip(x))}>${esc(String(x.id ?? x.kind ?? x.item ?? x.change ?? ''))} — ${esc(x.why_ko ?? '')}</span>`).join(' · ')}</dd></dl>`;
}
