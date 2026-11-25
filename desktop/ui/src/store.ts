/**
 * 화면 상태 한 곳. 값은 모두 다리로 읽는다 — 계산하지 않고 지어내지 않는다.
 *
 * | 무엇 | 어디서 |
 * |---|---|
 * | 모델 요약(절점 · 요소 수, BC, 길이, 재료 E · ν · G, 응력 범위), 단면 템플릿 · 치수 · 요소 자리, 하중 경우 · 기준 응력,
 * |   고유치 수, 해석의 하중 계열, 남은 결과(`results`)와 무효 장부(`invalidated`) | MCP `get_full_state`(= get_status — K4a 경계) |
 * | 프로그램의 기본 모델(「기본값」 꼬리표만) | 마지막 · 첫 `modelLoaded`(`/api/wv/<id>/last|first`) — 지금 모델이 시작 때 채운 것과 같은가 |
 * | 단면 성질 · cutwp | MCP `get_section_properties` · `get_cutwp` 와 같은 호스트 액션(`get_properties` · `cutwp`) |
 * | 절점 · 요소 | MCP `get_nodes` · `get_elements`(`get_nodes` · `get_elements`) |
 * | 좌굴 해석 DSM 값 | MCP `get_dsm_values`(`get_dsm`, 해석의 하중 계열 — `dsmResult.load_family`) |
 * | 부재 검토 · 퍼린 검토 · 접합부 · 하중 해석 | 호스트가 보낸 마지막 `designResult` · `designPurlinResult` · `lapConnectionResult` · `connectionResult` · `loadAnalysisComplete` |
 * | 파일 · 테마 · 웹뷰 | `/api/state` · `file:current` |
 *
 * 낡음: 호스트의 무효 장부(`get_full_state.invalidated` — kind · reason · cause · invalidated_at)가 말한다. 결과가 있으면 「일치」,
 * 그 종류가 장부에 있으면 「낡음」(까닭 = 장부의 reason), 둘 다 없으면 「아직 안 함」. 화면은 무엇을 봤는지 기억하지 않는다.
 *
 * 검토 항목(U3): 결과마다 엔진의 `design_checks`(검토 항목 계약 — docs/implementation/20261123-check-contract.md)를 한 줄씩.
 * 퍼린은 구간의 검토 지점(`result.checks[p]` — 지점마다 location · combination · design_checks)마다. 값은 그 결과 묶음을
 * 제품 표로 통째로 SI 로 바꾼 것(quantity 로) — 줄은 그 자리를 가리키기만 한다.
 */
import { api, last, mcp, type LastEntry } from './bridge';
import { utilInvalid, utilShown } from './format';
import { loadRecords } from './records';
import { loadChanges } from './changes';
import { loadRecordsWork, prefetchOpenQuestions } from './work';
import { loadReviews } from './reviews';
import { loadDocs } from './docs';
import { loadDamage } from './damage';
import { loadAlts } from './alts';
import { connSI, cutwpSI, dsmSI, loadsSI, memberSI, mmToM, propsSI, purlinSI } from './units';
import { fieldText, finder, looseList, noteList, pageOf, type Finder, type Note } from './notices';

export type Stage = 'sec' | 'fsm' | 'load' | 'chk' | 'conn' | 'val';
export type StageState = 'ok' | 'stale' | 'none' | 'run' | 'unk';

export const CMDS = ['modelLoaded', 'dsmResult', 'designResult', 'designPurlinResult', 'loadAnalysisComplete',
  'lapConnectionResult', 'connectionResult', 'analysisInvalidated', 'resultsCleared', 'restoreDesignInputs', 'analysisError', 'classifyResult', 'validationResult'];

/**
 * 좌굴 해석의 곡선 · 모드 형상 · 모드 분류(U2). 곡선은 MCP get_buckling_curve(`get_curve`), 모드 형상 · 분류는 호스트가 설계 패널에
 * 보낸 마지막 `analysisComplete`(크다 — 해석이 바뀔 때만 읽는다)와 `classifyResult`. 길이는 in(엔진), 하중계수는 무차원.
 */
export interface Analysis {
  seq: number;
  /** get_curve 의 행 그대로: [반파장 in, 모드 1 LF, 모드 2 LF, …] */
  curve: number[][];
  /** shapes[길이][자유도][모드] — 자유도 차례 [u1 v1 … un vn | w1 θ1 … wn θn](전역 x · 축 · 전역 z · 회전) */
  shapes: number[][][] | null;
  /** 모드 분류 [길이][모드][G, D, L, O](%) — 엔진이 낼 때만. 아니면 null 과 status */
  classes: Array<Array<Array<number | null>>> | null;
  classStatus: { status?: string; supported?: boolean; code?: string; message?: string } | null;
  /** 해석에 쓴 절점(모드 형상의 기준) — 해석 뒤 모델이 바뀌면 낡음이라 쓰지 않는다 */
  nodes: number[][];
  elems: number[][];
}

export type Scope = 'member' | 'purlin' | 'connection' | 'lap';
export type Verdict = 'pass' | 'fail' | 'not_evaluated' | 'not_applicable';

/** 검토 항목 하나(design_checks 의 한 항목, 퍼린은 그 검토 지점의 것) */
export interface CheckRow {
  key: string;          // 트리 · 표 · 시트의 키 — `design#<id>` · `purlin:<i>#<p>:<id>` · `lap#<id>` · `conn#<id>`
  run: string;          // Run.key
  scope: Scope;
  id: string;           // 엔진의 고정 id(등록표)
  point: number | null; // 퍼린 검토 지점의 차례(result.checks[p])
  pointName: string | null; // 엔진의 check_point(M_max · V_max · support 2)
  where: string;        // 위치 글(부재 · 정모멘트 0.00–4.68 m · M 최대 …)
  name: string;         // name_ko(정해 둔 한글 이름 — 화면이 옮기지 않는다)
  clause: string;
  verdict: Verdict;
  ratio: number | null;
  pass: boolean | null; // 색 · 무리용: pass true · fail false · 그 밖 null
  kind: 'ls' | 'ne' | 'na'; // ls = 평가함(pass · fail) · ne = 미검토 · na = 해당 없음
  governs: boolean;
  counts: boolean;
  us: any; si: any;     // 그 항목(US · SI)
  src: string;          // data-src 앞부분 — 그 항목의 경로(`design:design_checks.3.`)
  location: any; locUS: any; combination: string | null;
  xm: number | null;    // 검토 위치 x(m) — location.x 가 있을 때
  /** 퍼린 검토 지점 하나의 알림 글(`regions[i].result.checks[j]` 의 warnings · assumptions · scope_notes · not_checked — 보기 계약 4a). 지점이 없으면 null */
  pointNotes?: PointNotes | null;
  /** 검토 항목이 없는 옛 결과의 미검토 줄 — 그 알림의 code */
  noteCode?: string | null;
}
export interface PointNotes { warnings: Note[]; assumptions: Note[]; scope: Note[]; notChecked: Note[] }

/** 퍼린 구간의 검토 지점(띠의 막대 하나) */
export interface CheckPoint { index: number; name: string; xm: number | null; ratio: number | null; pass: boolean | null; src: string }

export interface Run {
  key: string;
  /** 결과의 갈래(get_view 의 scope) */
  area: Scope;
  label: string;
  where: string;
  result: any;          // SI
  us: any;
  src: string;          // data-src 앞부분(이 결과의 뿌리 — `design:` · `purlin:regions.0.result.` 처럼 뒤에 경로를 바로 붙인다)
  overall: boolean | null;
  utilization: number | null;
  /** 엔진이 utilization_valid: false 를 달았고 NG 가 아니다 — 이용률은 판정비가 아니다(「판정 없음」) */
  utilInvalid: boolean;
  governing: string | null;
  rows: CheckRow[];
  /** 퍼린 구간의 검토 지점 */
  points: CheckPoint[];
  /** design_checks 가 있는 결과의 not_evaluated 알림(정보 창에 — notices.js 로 그린 한국어 · SI 글과 code) */
  neTexts: Note[];
  notChecked: Note[];
  notApplicable: string[];
  warnings: Note[];
  assumptions: Note[];
  scope: Note[];
}

export interface State {
  designerId: string | null;
  theme: 'dark' | 'light';
  file: { path: string | null; name: string | null };
  ready: boolean;
  full: any | null;
  fullErr?: string;
  model: any | null;
  modelSeq: number;
  initialModel: any | null;
  props: any | null; propsSI: any | null; propsErr?: string;
  cutwp: any | null; cutwpSI: any | null;
  nodes: number[][]; elems: number[][];
  dsm: { family: string; us: any; si: any; seq: number } | null;
  dsmErr?: string;
  msgs: Record<string, LastEntry | null>;
  /** 설계 패널 통로의 마지막 순서 번호(읽은 때) */
  msgSeq: number;
  runs: Run[];
  stages: Record<Stage, { state: StageState; note: string }>;
  running: { fsm: boolean };
  lastChange: { at: number; text: string } | null;
  analysis: Analysis | null;
  analysisErr?: string;
  /** 하중 해석(analyze_loads 의 결과 모양) — 마지막 loadAnalysisComplete, 없으면 마지막 퍼린 설계의 load_analysis */
  loads: { us: any; si: any; from: 'loads' | 'purlin' } | null;
  /** 퍼린 설계의 구간(엔진 순서) — us · si */
  regions: Array<{ us: any; si: any; runKey: string }>;
  lap: { us: any; si: any } | null;
  conn: { us: any; si: any } | null;
  /** 시험 · 진단 — 마지막 다시 그리기의 시간(ms) */
  renderMs: number;
  /**
   * 검토 상태(K2 — 호스트가 쥔 설계 · 하중 · 접합 입력). MCP get_case_inputs 와 같은 호스트 동작(US) 그대로:
   * inputs · spans · unit_of · sources · model_inputs · mcp_only · rev · dirty · dirty_since. 화면은 SI 로 보이기만 한다(units.caseSI)
   */
  caseIn: any | null;
  caseErr?: string;
  /**
   * AI 가 바꾼 사람의 값 — 앞 판에서 출처가 지정 · 파일 · 하중 해석이던 칸이 다음 판에 출처 ai 가 되면(호스트 상태 두 판의 차이,
   * MCP 응답의 case_inputs_replaced 와 같은 뜻). 늦은 것부터 20 개
   */
  caseReplaced: Array<{ key: string; was: unknown; wasSrc: string; now: unknown; rev: number; at: number }>;
  /**
   * 점검(K3 — 호스트가 만든 검증 항목, 호스트 동작 validate_design detail 'full' · SI — MCP 와 같은 목록). 호스트는 마지막 점검을
   * 쥐지 않는다(결과 · 무효 장부에 없다) — 화면이 마지막으로 물은 답과 그때의 기준(입력 판 · 남은 결과의 시각 · 장부 길이)을 둔다
   */
  val: ValState | null;
  valRunning: boolean;
  valErr?: string;
  /** 계산서 · 좌굴 해석 보고서(K3 — 호스트가 쓴 파일, 다리의 /api/report). 화면이 마지막으로 만든 것 */
  reports: Partial<Record<'design' | 'buckling', ReportState>>;
}

/** 점검 항목 하나 — 호스트 그대로(webview/js/review.js withIds): id(val.*) · 분류 · 이름 · 판정(pass · warn · fail) · 값 · 기준 · 주석 */
export interface ValItem { id: string | null; category: string; item: string; status: string; value: string; criterion: string; note: string; source?: unknown }
/**
 * 마지막 점검 — 호스트가 쥔다(4b99968): get_full_state.results.validation {at, case_rev, counts, units, by}(지금 것), 입력 · 모델이 바뀌면
 * 장부의 kind 'validation'(낡음 · 까닭). 항목은 호스트가 설계 패널에 보낸 마지막 `validationResult {items, unitSystem, case_rev, by}` —
 * 다리가 그 판이 지금 것인 동안 남긴다(호스트가 kinds ['validation'] 로 지우면 사라진다). 화면은 다시 판정하지 않는다
 */
export interface ValState { items: ValItem[]; counts: Record<string, number>; caseRev: number | null; units: string; at: string | null; by: string; seq: number }
export interface ReportState { reply: any; html: string | null; sha256: string | null; at: number; caseRev: number | null; format: string; error?: string; pdfAt?: number }

export const state: State = {
  designerId: null, theme: 'dark', file: { path: null, name: null }, ready: false,
  full: null, model: null, modelSeq: -1, initialModel: null,
  props: null, propsSI: null, cutwp: null, cutwpSI: null, nodes: [], elems: [],
  dsm: null, msgs: {}, msgSeq: 0, runs: [],
  stages: {
    sec: { state: 'none', note: '' }, fsm: { state: 'none', note: '' }, load: { state: 'none', note: '' },
    chk: { state: 'none', note: '' }, conn: { state: 'none', note: '' }, val: { state: 'none', note: '' },
  },
  running: { fsm: false }, lastChange: null,
  analysis: null, loads: null, regions: [], lap: null, conn: null, renderMs: 0, caseIn: null, caseReplaced: [], val: null, valRunning: false, reports: {},
};

const MEMBER_KO: Record<string, string> = { flexure: '휨 부재', compression: '압축 부재', combined: '조합 부재', tension: '인장 부재', connection: '접합' };
const CONN_KO: Record<string, string> = { bolt: '볼트', screw: '나사', fillet_weld: '필릿 용접', arc_spot: '아크 스폿 용접', arc_seam: '아크 심 용접', groove: '그루브 용접', paf: 'PAF' };


/** 검토 지점의 조합 — 호스트가 어느 조합인지 말할 수 없는 포락선 값이면 문자 그대로 'envelope'(보기 계약 4a) → 「포락선」 */
export const COMBO_KO = (c: string | null | undefined): string => (c === 'envelope' ? '포락선' : String(c ?? ''));
/** 검토 위치의 말 — 지점 · 경간은 1 부터(호스트가 채운 그대로), 구간이 딸린 지점, 소요의 근거(보기 계약 4a) */
export function locWords(loc: any): string[] {
  if (!loc || typeof loc !== 'object') { return []; }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return [
    loc.region ? `구간 ${loc.region}` : '',
    loc.check_point ? POINT_KO(String(loc.check_point)) : '',
    loc.segment ? String(loc.segment) : '',
    n(loc.support) !== null && !/^support\s/.test(String(loc.check_point ?? '')) ? `지점 ${loc.support}` : '',
    n(loc.span) !== null ? `경간 ${loc.span}` : '',
    n(loc.region_support) !== null ? `구간의 지점 ${loc.region_support}` : '',
    loc.demand_basis === 'envelope' ? '소요 = 포락선' : loc.demand_basis === 'combination' ? '소요 = 지배 조합의 도표' : '',
  ].filter(Boolean);
}
const POINT_KO = (p: string): string => (p === 'M_max' ? 'M 최대' : p === 'V_max' ? 'V 최대' : /^support\s+/.test(p) ? `지점 ${p.replace(/^support\s+/, '')}` : p);
export { POINT_KO };

function verdictOfCheck(c: any): Verdict {
  const v = String(c?.verdict ?? '');
  return v === 'pass' || v === 'fail' || v === 'not_applicable' ? v : 'not_evaluated';
}

/** location.x(SI 로 바꾼 {value, quantity:'length'} — mm) → 부재 축의 m */
function xmOf(loc: any): number | null {
  const x = loc?.x;
  const v = x && typeof x === 'object' ? x.value : null;
  return typeof v === 'number' && Number.isFinite(v) && x.quantity === 'length' ? mmToM(v) : null;
}

/** design_checks 한 목록 → 줄 */
function checkRows(run: string, scope: Scope, where: string, us: any[], si: any[], src: string, point: number | null, pointName: string | null): CheckRow[] {
  return us.map((c: any, j: number) => {
    const s = si?.[j] ?? c;
    const verdict = verdictOfCheck(c);
    const id = String(c?.id ?? `item${j}`);
    return {
      key: `${run}#${point === null ? '' : `${point}:`}${id}`, run, scope, id, point, pointName,
      where: pointName ? `${where} · ${POINT_KO(pointName)}` : where,
      name: String(c?.name_ko ?? c?.name ?? id), clause: String(c?.clause ?? ''),
      verdict, ratio: typeof s?.ratio === 'number' ? s.ratio : null,
      pass: verdict === 'pass' ? true : verdict === 'fail' ? false : null,
      kind: verdict === 'pass' || verdict === 'fail' ? 'ls' : verdict === 'not_applicable' ? 'na' : 'ne',
      governs: c?.governs === true, counts: c?.counts !== false,
      us: c, si: s, src: `${src}design_checks.${j}.`,
      location: s?.location ?? null, locUS: c?.location ?? null, combination: typeof c?.combination === 'string' ? c.combination : null,
      xm: xmOf(s?.location),
    } as CheckRow;
  });
}

/** 엔진 결과 하나 → 판정 줄. 엔진의 design_checks(없으면 옛 limit_state_checks · not_evaluated)를 그 차례대로 옮긴다 */
function runOf(key: string, scope: Scope, label: string, where: string, us: any, si: any, src: string, find: Finder, extraNe: Note[] = []): Run {
  let rows: CheckRow[] = [];
  const points: CheckPoint[] = [];
  const neTexts: Note[] = [];
  const pts = Array.isArray(us?.checks) && us.checks.some((c: any) => Array.isArray(c?.design_checks)) ? us.checks : null;
  if (pts) {
    pts.forEach((pt: any, p: number) => {
      const sp = si?.checks?.[p] ?? pt;
      const name = String(pt?.check_point ?? `지점 ${p + 1}`);
      const notes: PointNotes = { warnings: noteList(pt, 'warnings', find), assumptions: noteList(pt, 'assumptions', find), scope: noteList(pt, 'scope_notes', find), notChecked: looseList(pt?.not_checked, find) };
      rows.push(...checkRows(key, scope, where, Array.isArray(pt.design_checks) ? pt.design_checks : [], sp?.design_checks ?? [], `${src}checks.${p}.`, p, name).map(r => ({ ...r, pointNotes: notes })));
      points.push({ index: p, name, xm: xmOf(sp?.location), ratio: typeof sp?.utilization === 'number' ? sp.utilization : null,
        pass: pt?.pass === true ? true : pt?.pass === false ? false : null, src: `${src}checks.${p}.utilization` });
    });
  } else if (Array.isArray(us?.design_checks)) {
    rows = checkRows(key, scope, where, us.design_checks, si?.design_checks ?? [], src, null, null);
  } else {
    // 계약 전의 결과(옛 파일) — limit_state_checks · not_evaluated 를 그대로
    const lsc = Array.isArray(si?.limit_state_checks) ? si.limit_state_checks : [];
    lsc.forEach((x: any, i: number) => {
      const pass = x?.pass === true ? true : x?.pass === false ? false : null;
      rows.push({ key: `${key}#ls${i}`, run: key, scope, id: `ls${i}`, point: null, pointName: null, where, name: String(x?.name ?? `한계상태 ${i + 1}`), clause: '',
        verdict: pass === true ? 'pass' : pass === false ? 'fail' : 'not_evaluated', ratio: typeof x?.ratio === 'number' ? x.ratio : null, pass,
        kind: pass === null ? 'ne' : 'ls', governs: false, counts: true, us: x, si: x, src: `${src}limit_state_checks.${i}.`, location: null, locUS: null, combination: null, xm: null });
    });
  }
  const neList = [...noteList(us, 'not_evaluated', find), ...extraNe];
  if (rows.length && !rows[0].id.startsWith('ls')) { neTexts.push(...neList); } else {
    neList.forEach((t, i) => {
      rows.push({ key: `${key}#ne${i}`, run: key, scope, id: `ne${i}`, point: null, pointName: null, where, name: t.text, clause: '', verdict: 'not_evaluated', ratio: null, pass: null,
        kind: 'ne', governs: false, counts: true, us: null, si: null, src: '', location: null, locUS: null, combination: null, xm: null, noteCode: t.code });
    });
  }
  const warnings: Note[] = [];
  const assumptions: Note[] = [];
  const scopeNotes: Note[] = [];
  const pre = (prefix: string) => (n: Note): Note => ({ text: prefix + n.text, code: n.code });
  const collect = (o: any, prefix: string) => {
    if (!o || typeof o !== 'object') { return; }
    warnings.push(...noteList(o, 'warnings', find).map(pre(prefix)));
    assumptions.push(...noteList(o, 'assumptions', find).map(pre(prefix)));
    scopeNotes.push(...noteList(o, 'scope_notes', find).map(pre(prefix)));
  };
  collect(us, '');
  if (typeof us?.dsm_warning === 'string' && us.dsm_warning) { warnings.push(pre('[DSM] ')(find(us.dsm_warning))); }
  for (const [k, v] of Object.entries(us ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !['region', 'force_model', 'request'].includes(k)) { collect(v, `[${k}] `); }
  }
  const notApplicable: string[] = [];
  if (!rows.some(r => r.kind === 'na') && us?.distortional_applicable === false) { notApplicable.push('뒤틀림좌굴(§F4 · §E4)'); }
  return {
    key, area: scope, label, where, result: si, us, src,
    overall: us?.pass === true ? true : us?.pass === false ? false : null,
    // 계약 §6.4: utilization_valid: false(NG 아님)면 판정비가 아니다 — 수를 두지 않고 utilInvalid 로(화면은 「판정 없음」)
    utilization: utilShown(us, si?.utilization),
    utilInvalid: utilInvalid(us),
    // 지배 검토의 이름 — 그 id 의 name_ko(notices.js forPage)
    governing: typeof us?.governing_check === 'string' ? String(pageOf(us)?.governing_check ?? us.governing_check) : null,
    rows, points, neTexts, notChecked: looseList(us?.not_checked, find), notApplicable, warnings, assumptions, scope: scopeNotes,
  };
}

function buildRuns(): Run[] {
  const runs: Run[] = [];
  // 호스트의 부재 검토는 하나(get_full_state.results.member_design — 퍼린이거나 부재). 다리의 기록에 앞의 다른 쪽 메시지가 남아 있어도
  // 호스트가 지금 것으로 아는 쪽만 보인다. 결과가 없으면(지워졌으면) 어느 쪽도 보이지 않는다 — 진행 띠가 낡음 · 없음을 말한다.
  const rt: string | null = state.full ? (state.full.results?.member_design?.result_type ?? null) : 'unknown';
  const showPurlin = rt === 'purlin' || rt === 'unknown';
  const showDesign = rt !== null && rt !== 'purlin';
  const d = showDesign ? state.msgs.designResult?.message?.data : null;
  if (d && typeof d === 'object' && !d.error) {
    const si = memberSI(d);
    const mt = String(d.member_type ?? '');
    runs.push(runOf('design', 'member', `부재 검토 · ${MEMBER_KO[mt] ?? mt}`, MEMBER_KO[mt] ?? '부재', d, si, 'design:', finder(d)));
  }
  const p = showPurlin ? state.msgs.designPurlinResult?.message?.data : null;
  if (p && typeof p === 'object' && !p.error) {
    const si = purlinSI(p);
    const regions = Array.isArray(p.regions) ? p.regions : [];
    const findP = finder(p);
    regions.forEach((rg: any, i: number) => {
      if (!rg?.result) { return; }
      // 엔진의 구간 이름은 ft 로 적혀 있다 — 화면은 m 이므로 그 숫자 자리만 SI 값으로 바꿔 적는다(값은 엔진의 start_ft · end_ft)
      const lab = regionLabel(rg, si.regions?.[i], i);
      runs.push(runOf(`purlin:${i}`, 'purlin', `퍼린 구간 · ${lab}`, lab, rg.result, si.regions?.[i]?.result, `purlin:regions.${i}.result.`, findP));
    });
    // 퍼린 묶음 전체의 미검토 · 경고 · 가정(구간에 붙지 않은 것)
    const top = runOf('purlin', 'purlin', '퍼린 설계 · 전체', '퍼린 전체', { ...p, limit_state_checks: [], regions: undefined, design_positive: undefined,
      design_negative: undefined, design_lap: undefined, design_uplift: undefined, load_analysis: undefined, props: undefined, cutwp: undefined, design_checks: undefined, checks: undefined },
    { ...si, limit_state_checks: [] }, 'purlin:', findP, looseList(p.load_not_evaluated, findP));
    runs.push(top);
  }
  if (state.lap) { runs.push(runOf('lap', 'lap', '랩 접합', '랩 접합', state.lap.us, state.lap.si, 'lap:', finder(state.lap.us))); }
  if (state.conn) {
    const ct = String(state.conn.us.connection_type ?? '');
    runs.push(runOf('conn', 'connection', `단일 접합 · ${CONN_KO[ct] ?? ct}`, `접합 · ${CONN_KO[ct] ?? ct}`, state.conn.us, state.conn.si, 'conn:', finder(state.conn.us)));
  }
  return runs;
}

/** 부재 검토(부재 · 퍼린)의 실행만 — 접합은 접합부 가지에 */
export const memberRuns = (): Run[] => state.runs.filter(r => r.area === 'member' || r.area === 'purlin');

/**
 * E5 — 부재 검토가 FSM 없이(해석식 좌굴값으로) 계산됐는가. 호스트가 결과에 적은 하중군마다의 출처(dsm_basis_by_family: P · Mxx →
 * prepared · current_analysis · none)에서 none 인 하중군만 — 화면이 짐작하지 않는다. 그 키가 없으면(인장 — 하중군 없음 · 퍼린 · 옛 결과) ·
 * 엔진이 DSM 비적용이라 밝혔으면(원형관 — member.scope.round_tube_dsm_not_applicable) null.
 * none 이어도 엔진의 출처(dsm_source)가 모두 「없음」 이면 해석식도 아니다(FSM 좌굴값 없음)
 */
const DSM_NA_CODE = 'member.scope.round_tube_dsm_not_applicable';
const FAM_KEYS: Record<string, { syms: string; keys: string[]; sub: string }> = {
  P: { syms: 'Pcrℓ · Pcrd', keys: ['Pcrl', 'Pcrd'], sub: 'compression' },
  Mxx: { syms: 'Mcrℓ · Mcrd', keys: ['Mcrl', 'Mcrd'], sub: 'flexure_x' },
};
export interface NoFsm { fams: string[]; syms: string; sources: string; analytic: boolean }
export function noFsmOf(r: Run | undefined): NoFsm | null {
  const us = r?.us;
  const by = us?.dsm_basis_by_family;
  if (!us || !by || typeof by !== 'object' || Array.isArray(by)) { return null; }
  const na = r!.scope.some(n => n.code === DSM_NA_CODE)
    || (Array.isArray(us.notices) && us.notices.some((n: any) => n && typeof n === 'object' && n.code === DSM_NA_CODE));
  if (na) { return null; }
  const fams = Object.entries(by as Record<string, unknown>).filter(([, b]) => b === 'none').map(([f]) => f);
  if (!fams.length) { return null; }
  // 엔진이 그 하중군의 국부 · 뒤틀림 값을 어디서 얻었는지(그대로 — 압축 · 휨은 { Pcrl, Pcrd } · { Mcrl, Mcrd }, 조합은 { compression, flexure_x })
  const ds = us.dsm_source && typeof us.dsm_source === 'object' ? us.dsm_source : {};
  const vals: Array<[string, string]> = [];
  for (const f of fams) {
    const fk = FAM_KEYS[f];
    if (!fk) { continue; }
    const src = ds[fk.sub] && typeof ds[fk.sub] === 'object' ? ds[fk.sub] : ds;
    for (const k of fk.keys) { if (typeof src[k] === 'string' && src[k]) { vals.push([k, src[k]]); } }
  }
  const isNone = (v: string) => /^(none|없음)$/i.test(v.trim());
  return {
    fams, syms: fams.map(f => FAM_KEYS[f]?.syms ?? f).join(' · '),
    sources: vals.map(([k, v]) => `${k} ${v}`).join(' · '),
    analytic: !vals.length || vals.some(([, v]) => !isNone(v)),
  };
}
/** 지금 부재 검토 가운데 FSM 없이 계산된 것(E5 — 결과 › 부재 검토 · 업무 › 점검의 표시) */
export const noFsmRuns = (): Array<{ run: Run; nf: NoFsm }> => memberRuns().map(run => ({ run, nf: noFsmOf(run) })).filter((x): x is { run: Run; nf: NoFsm } => !!x.nf);

/** 모든 검토 항목(엔진 순서 — 실행 차례대로) */
export const allRows = (): CheckRow[] => state.runs.flatMap(r => r.rows);

/** 키 → 줄 · 실행 */
export function rowOfKey(key: string): { run?: Run; row?: CheckRow } {
  for (const r of state.runs) {
    const rw = r.rows.find(x => x.key === key);
    if (rw) { return { run: r, row: rw }; }
  }
  return {};
}

/**
 * 엔진이 밝힌 가정 — 줄마다 어느 결과 · 구간 · 검토 지점의 것인지(글은 엔진이 쓴 그대로 — 번역하지 않는다).
 * 실행(run)의 가정(맨 위 · 하위 묶음 — 「[deck]」처럼 묶음 이름이 앞에 붙는다)과 퍼린 검토 지점마다의 가정(regions[i].result.checks[j].assumptions).
 * 같은 자리 · 같은 글은 한 번
 */
export function assumptionLines(): Array<{ key: string; where: string; text: string; code: string | null }> {
  const out: Array<{ key: string; where: string; text: string; code: string | null }> = [];
  const seen = new Set<string>();
  const push = (key: string, where: string, n: Note) => { const id = `${where}\u0000${n.text}`; if (!seen.has(id)) { seen.add(id); out.push({ key, where, text: n.text, code: n.code }); } };
  for (const r of state.runs) {
    r.assumptions.forEach((t, i) => push(`asm:${r.key}:${i}`, r.label, t));
    const pts = new Map<number, { name: string; notes: Note[] }>();
    for (const row of r.rows) { if (row.point !== null && row.pointNotes && !pts.has(row.point)) { pts.set(row.point, { name: row.pointName ?? String(row.point + 1), notes: row.pointNotes.assumptions }); } }
    for (const [p, x] of pts) { x.notes.forEach((t, i) => push(`asm:${r.key}:p${p}:${i}`, `${r.label} · ${POINT_KO(x.name)}`, t)); }
  }
  return out;
}

/** 무효 장부(호스트) — 그 종류의 가장 늦은 항목 */
export function ledgerOf(kinds: string[]): any | null {
  const inv: any[] = Array.isArray(state.full?.invalidated) ? state.full.invalidated : [];
  const hit = inv.filter(e => kinds.includes(String(e?.kind)));
  return hit.length ? hit[hit.length - 1] : null;
}

function staleNote(e: any): string {
  const act = e?.cause?.action ? ` · ${String(e.cause.action)}` : '';
  return `입력이 바뀌어 호스트가 결과를 지웠다 — ${String(e?.reason_ko ?? e?.reason ?? '')}${act}`;
}

/** 진행 띠 — 결과가 지금 입력과 맞는가. 계산하지 않는다: 호스트의 `results`(남은 결과)와 무효 장부만 본다 */
function buildStages(): void {
  buildVal();
  const f = state.full;
  const res = f?.results ?? {};
  const st = (present: boolean, kinds: string[], okNote: string, noneNote: string): { state: StageState; note: string } => {
    if (present) { return { state: 'ok', note: okNote }; }
    const e = ledgerOf(kinds);
    if (e) { return { state: 'stale', note: staleNote(e) }; }
    return { state: 'none', note: noneNote };
  };
  state.stages.sec = f?.hasModel ? { state: 'ok', note: `절점 ${f.nnodes} · 요소 ${f.nelems}` } : { state: 'none', note: '단면 없음' };
  state.stages.fsm = state.running.fsm ? { state: 'run', note: '해석 중' }
    : st(!!res.buckling_analysis?.current, ['buckling_analysis'], `${state.dsm ? `${state.dsm.family} · ` : ''}길이 ${f?.lengths?.n ?? '—'}점`, '실행 안 함');
  state.stages.load = st(!!res.load_analysis && !!state.loads, ['load_analysis'], '결과 있음', '실행 안 함');
  const nChk = memberRuns().reduce((a, r) => a + r.rows.length, 0);
  state.stages.chk = st(!!res.member_design && memberRuns().length > 0, ['member_design'], `${nChk} 항목`, '실행 안 함');
  state.stages.conn = st(!!(res.lap || res.connection) && !!(state.lap || state.conn), ['lap', 'connection'], state.lap ? '랩 접합 결과 있음' : '단일 접합 결과 있음', '실행 안 함');
  state.stages.val = valStage();
}

// ── 점검(K3) ─────────────────────────────────────────────────────────
/** 호스트의 마지막 점검(지금 것) — results.validation */
export function hostValidation(): any | null { const v = state.full?.results?.validation; return v && typeof v === 'object' ? v : null; }
/** 호스트의 마지막 점검을 읽는다 — 항목은 설계 패널에 간 마지막 validationResult(다리가 지금 것인 동안 남긴다) */
function buildVal(): void {
  const hv = hostValidation();
  const m = state.msgs.validationResult;
  const d = m?.message?.data;
  if (!hv || !d || !Array.isArray(d.items)) { state.val = null; return; }
  const items: ValItem[] = d.items.map((x: any) => ({ id: typeof x?.id === 'string' ? x.id : null, category: String(x?.category ?? ''), item: String(x?.item ?? ''),
    status: String(x?.status ?? ''), value: String(x?.value ?? ''), criterion: String(x?.criterion ?? ''), note: String(x?.note ?? ''), ...(x?.source ? { source: x.source } : {}) }));
  const counts: Record<string, number> = { ...(hv.counts ?? {}) };
  if (!('total' in counts)) { counts.total = items.length; }
  state.val = { items, counts, caseRev: typeof hv.case_rev === 'number' ? hv.case_rev : typeof d.case_rev === 'number' ? d.case_rev : null,
    units: String(d.unitSystem ?? hv.units ?? ''), at: hv.at ?? null, by: String(hv.by ?? d.by ?? ''), seq: m?.seq ?? -1 };
}
/** 마지막 점검 뒤 바뀐 것 — 호스트의 장부(kind 'validation')가 말한다 */
export function valChanges(): string[] {
  if (hostValidation()) { return []; }
  const e = ledgerOf(['validation']);
  return e ? [`${String(e.reason_ko ?? e.reason ?? '입력이 바뀜')}${e.cause?.action ? ` · ${String(e.cause.action)}` : ''}`] : [];
}
function valStage(): { state: StageState; note: string } {
  if (state.valRunning) { return { state: 'run', note: '점검 중' }; }
  const hv = hostValidation();
  if (hv) {
    const c = hv.counts ?? {};
    return { state: 'ok', note: `통과 ${c.pass ?? 0} · 주의 ${c.warn ?? 0} · 실패 ${c.fail ?? 0}${hv.by === 'ai' ? ' · AI 가 돌림' : ''}` };
  }
  const e = ledgerOf(['validation']);
  if (e) { return { state: 'stale', note: `점검 뒤 바뀌었다 — ${String(e.reason_ko ?? e.reason ?? '')}` }; }
  return { state: 'none', note: state.valErr ? `점검을 하지 못함 — ${state.valErr}` : '실행 안 함 — 결과 탭의 점검에서 「점검 실행」(편집 화면의 「설계 검증 실행」과 같은 길)' };
}
/** 「점검 실행」을 눌렀다 — 끝은 호스트의 validationResult(이벤트)가 알린다 */
export function setValRunning(on: boolean, err?: string): void { state.valRunning = on; state.valErr = err; buildStages(); }

/** 계산서 · 좌굴 해석 보고서를 호스트가 쓴다(다리의 /api/report — 자리 · 이름은 호스트가 정한다). format: html(미리보기) · pdf */
export async function makeReport(kind: 'design' | 'buckling', format: 'html' | 'pdf'): Promise<void> {
  // 프로젝트에서는 만들 때마다 새 초안(D-n) — PDF 는 HTML 과 같은 초안으로(both)
  const inProj = !!state.full?.project?.inProject;
  const r = await api<any>('POST', '/api/report', { kind, format: inProj && format === 'pdf' ? 'both' : format, units: 'SI' });
  const prev = state.reports[kind];
  const reply = r.data?.reply;
  const caseRev = typeof reply?.case_rev === 'number' ? reply.case_rev : null;
  if (!r.success) {
    state.reports[kind] = { reply: prev?.reply ?? null, html: prev?.html ?? null, sha256: prev?.sha256 ?? null, caseRev: prev?.caseRev ?? caseRev, format: prev?.format ?? format,
      at: prev?.at ?? Date.now(), error: String(r.error ?? '보고서를 만들지 못했다') };
    return;
  }
  // PDF 만 쓴 답은 미리보기(앞의 HTML)를 그대로 두고 파일 · 쪽 수만 더한다(같은 판일 때)
  if (format === 'pdf' && !inProj && prev?.html && prev.caseRev === caseRev) {
    state.reports[kind] = { ...prev, reply: { ...prev.reply, files: { ...(prev.reply?.files ?? {}), ...(reply?.files ?? {}) }, pages: reply?.pages ?? null, pdf_note: reply?.pdf_note }, error: undefined, pdfAt: Date.now() };
    return;
  }
  state.reports[kind] = { reply, html: r.data?.html ?? null, sha256: r.data?.sha256 ?? null, at: Date.now(), caseRev, format, ...(format === 'pdf' ? { pdfAt: Date.now() } : {}) };
}

let busy = false;
let again = false;

/** 다리에서 다시 읽는다. 바뀐 것만 다시 묻는다. 돌아오면 onDone */
export async function refresh(onDone: () => void): Promise<void> {
  if (!state.designerId) { return; }
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      await load();
      onDone();
    } while (again);
  } finally { busy = false; }
}

async function load(): Promise<void> {
  const id = state.designerId!;
  const [full, msgs, ci] = await Promise.all([mcp('get_full_state'), last(id, CMDS), mcp('get_case_inputs')]);
  if (ci && !ci.error && ci.inputs) {
    const prev = state.caseIn;
    if (prev?.inputs && ci.rev !== prev.rev) {
      for (const [k, src] of Object.entries(ci.sources ?? {})) {
        const was = prev.sources?.[k];
        if (src === 'ai' && ['user', 'file', 'load-analysis'].includes(String(was)) && JSON.stringify(prev.inputs[k]) !== JSON.stringify(ci.inputs[k])) {
          state.caseReplaced.unshift({ key: k, was: prev.inputs[k], wasSrc: String(was), now: ci.inputs[k], rev: ci.rev, at: Date.now() });
        }
      }
      state.caseReplaced = state.caseReplaced.slice(0, 20);
    }
    state.caseIn = ci; state.caseErr = undefined;
  } else { state.caseErr = ci?.error ?? '응답 없음'; }
  if (full && !full.error) { state.full = full; state.fullErr = undefined; } else { state.fullErr = full?.error ?? '응답 없음'; }
  if (msgs) { state.msgs = msgs.data; state.msgSeq = msgs.seq; }
  buildVal();
  // R1-3: 프로젝트 · 검토 대상(호스트의 list_cases · get_case_status) — 프로젝트가 열려 있을 때만
  await loadRecords();
  await loadChanges();
  // R3-3: 업무 · 가정 · 원자료 — 대상이 바뀌었을 때만(그 밖에는 recordsChanged 가 말한 종류만)
  await loadRecordsWork();
  await prefetchOpenQuestions();
  // R4: 확인 표시는 결과 · 입력이 바뀔 때마다 유효성이 바뀐다 — 새로 고칠 때마다(지문도 그때의 것). 대안은 대상이 바뀌었을 때 · recordsChanged 에
  await loadReviews();
  await loadAltsIfCaseChanged();
  await loadDocs();
  // V9b-04 · D1: 믿는 작성자의 손상된 줄 파일(다리의 사람 얼굴) — 띠 · 문서 탭의 「기록 손상」
  await loadDamage(!!state.full?.project?.inProject);
  if (!state.initialModel) {
    const first = await last(id, ['modelLoaded'], 'first');
    state.initialModel = first?.data.modelLoaded?.message?.data ?? null;
  }
  const ml = state.msgs.modelLoaded;
  if (ml && ml.seq !== state.modelSeq) {
    state.model = ml.message.data;
    state.modelSeq = ml.seq;
    const [props, cutwp, nodes, elems] = await Promise.all([mcp('get_properties'), mcp('cutwp'), mcp('get_nodes'), mcp('get_elements')]);
    if (props && !props.error) { state.props = props; state.propsSI = propsSI(props); state.propsErr = undefined; } else { state.props = null; state.propsSI = null; state.propsErr = props?.error; }
    if (cutwp && !cutwp.error) { state.cutwp = cutwp; state.cutwpSI = cutwpSI(cutwp); } else { state.cutwp = null; state.cutwpSI = null; }
    state.nodes = Array.isArray(nodes?.nodes) ? nodes.nodes : [];
    state.elems = Array.isArray(elems?.elements) ? elems.elements : [];
  }
  // 좌굴 해석 DSM — 해석이 최신일 때만, 그 해석의 하중 계열로(get_full_state.analysis_load_family — K4a)
  const fam = state.full?.analysis_load_family ?? state.msgs.dsmResult?.message?.data?.load_family;
  const dsmSeq = state.msgs.dsmResult?.seq ?? -1;
  if (state.full?.hasAnalysis && typeof fam === 'string' && ['P', 'Mxx', 'Mzz'].includes(fam)) {
    if (!state.dsm || state.dsm.seq !== dsmSeq || state.dsm.family !== fam) {
      const r = await mcp('get_dsm', { load_type: fam });
      if (r && !r.error) { state.dsm = { family: fam, us: r, si: dsmSI(r), seq: dsmSeq }; state.dsmErr = undefined; } else { state.dsm = null; state.dsmErr = r?.error ?? '응답 없음'; }
    }
  } else {
    state.dsm = null;
    state.dsmErr = state.full?.hasAnalysis ? '해석의 하중 계열을 호스트가 알리지 않았다(get_full_state.analysis_load_family 없음)' : undefined;
  }
  // 곡선 · 모드 형상 · 분류 — 해석이 최신이고 바뀌었을 때만(analysisComplete 는 크다)
  if (state.full?.hasAnalysis) {
    if (!state.analysis || state.analysis.seq !== dsmSeq) {
      const [curve, ac] = await Promise.all([mcp('get_curve'), last(id, ['analysisComplete'])]);
      const a = ac?.data.analysisComplete?.message?.data;
      if (curve && !curve.error && Array.isArray(curve.curve)) {
        state.analysis = {
          seq: dsmSeq, curve: curve.curve,
          shapes: Array.isArray(a?.shapes) ? a.shapes : null,
          classes: Array.isArray(a?.classifications) ? a.classifications : null,
          classStatus: a?.classification_status ?? null,
          nodes: state.nodes, elems: state.elems,
        };
        state.analysisErr = undefined;
      } else { state.analysis = null; state.analysisErr = curve?.error ?? '곡선 없음'; }
    }
    const cr = state.msgs.classifyResult;
    if (state.analysis && cr && cr.seq > state.analysis.seq && Array.isArray(cr.message?.data?.classification)) {
      state.analysis.classes = cr.message.data.classification;
      state.analysis.classStatus = { status: cr.message.data.status, supported: cr.message.data.supported, code: cr.message.data.code, message: cr.message.data.message };
    }
  } else { state.analysis = null; state.analysisErr = undefined; }
  // 하중 해석 · 퍼린 구간 · 접합 — 호스트가 지금 결과로 아는 것만(get_full_state.results). 다리의 기록에 남은 옛 메시지는 쓰지 않는다
  const res = state.full?.results;
  const known = (k: string) => !state.full || !!res?.[k];
  const la = known('load_analysis') ? state.msgs.loadAnalysisComplete?.message?.data : null;
  const pr = res && res.member_design?.result_type !== 'purlin' ? null : state.msgs.designPurlinResult?.message?.data;
  if (la && typeof la === 'object' && !la.error) { state.loads = { us: la, si: loadsSI(la), from: 'loads' }; }
  else if (pr && typeof pr === 'object' && !pr.error && pr.load_analysis) { state.loads = { us: pr.load_analysis, si: loadsSI(pr.load_analysis), from: 'purlin' }; }
  else { state.loads = null; }
  if (pr && typeof pr === 'object' && !pr.error && Array.isArray(pr.regions)) {
    const prSI = purlinSI(pr);
    state.regions = pr.regions.map((r: any, i: number) => ({ us: r, si: prSI.regions?.[i], runKey: `purlin:${i}` }));
  } else { state.regions = []; }
  const lap = known('lap') ? state.msgs.lapConnectionResult?.message?.data : null;
  state.lap = lap && typeof lap === 'object' && !lap.error ? { us: lap, si: connSI(lap) } : null;
  const cn = known('connection') ? state.msgs.connectionResult?.message?.data : null;
  state.conn = cn && typeof cn === 'object' && !cn.error ? { us: cn, si: connSI(cn) } : null;
  state.runs = buildRuns();
  buildStages();
  state.ready = true;
}

/** 해석 시작 · 끝(이벤트) — 진행 띠의 「실행 중」만 바꾼다 */
export function setRunning(on: boolean): void { state.running.fsm = on; }

// ── 「기본값」 꼬리표 — 지금 모델의 묶음이 프로그램이 시작할 때 채운 것과 같고, 그 뒤 파일을 연 적이 없으면 ─────────
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function opened(): boolean { return !!state.file.path || !!state.msgs.resultsCleared; }

export function isDefault(group: 'section' | 'material' | 'conditions'): boolean {
  const a = state.model;
  const b = state.initialModel;
  if (!a || !b || opened()) { return false; }
  if (group === 'section') {
    const geo = (m: any) => ({ n: (m.node ?? []).map((x: number[]) => [x[1], x[2]]), e: (m.elem ?? []).map((x: number[]) => [x[1], x[2], x[3]]),
      t: m.sectionType ?? null, p: m.sectionParams ?? null });
    return same(geo(a), geo(b));
  }
  if (group === 'material') { return same(a.prop, b.prop); }
  return same([a.BC, a.lengths, a.loadCase, a.neigs ?? null], [b.BC, b.lengths, b.loadCase, b.neigs ?? null]);
}

export function setTheme(t: 'dark' | 'light'): void { state.theme = t; }

export function regionLabel(us: any, _si: any, i: number): string {
  // 구간 이름표 — 호스트의 label_* 옆 필드(host.region.* 알림)를 이 화면의 단위(m)로(notices.js — 화면은 숫자 자리를 고쳐 쓰지 않는다)
  if (us?.label !== undefined && us?.label !== null) { return fieldText(us, 'label'); }
  return String(us?.id ?? `구간 ${i + 1}`);
}

let altsFor = '';
async function loadAltsIfCaseChanged(): Promise<void> {
  const c = state.full?.project?.case?.caseId ?? '';
  if (c === altsFor) { return; }
  altsFor = c;
  await loadAlts();
}
