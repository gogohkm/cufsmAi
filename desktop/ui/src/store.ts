/**
 * 화면 상태 한 곳. 값은 모두 다리로 읽는다 — 계산하지 않고 지어내지 않는다.
 *
 * | 무엇 | 어디서 |
 * |---|---|
 * | 모델 요약(절점 · 요소 수, BC, 길이, 재료 E · ν · G, 응력 범위, 해석이 최신인가) | MCP `get_full_state`(= get_status + 곡선 요약) |
 * | 모델 전체(단면 템플릿 · 치수 · 하중 경우 · 고유치 수 …) | 호스트가 설계 패널에 보낸 마지막 `modelLoaded`(`/api/wv/<id>/last`) — MCP 도구는 이것을 돌려주지 않는다(K4) |
 * | 프로그램의 기본 모델 | 첫 `modelLoaded`(`/api/wv/<id>/first`) — 다리가 보낸 webviewReady 에 호스트가 채운 것 |
 * | 단면 성질 · cutwp | MCP `get_section_properties` · `get_cutwp` 와 같은 호스트 액션(`get_properties` · `cutwp`) |
 * | 절점 · 요소 | MCP `get_nodes` · `get_elements`(`get_nodes` · `get_elements`) |
 * | 좌굴 해석 DSM 값 | MCP `get_dsm_values`(`get_dsm`, 해석의 하중 계열 — `dsmResult.load_family`) |
 * | 부재 검토 · 퍼린 검토 · 접합부 · 하중 해석 | 호스트가 보낸 마지막 `designResult` · `designPurlinResult` · `lapConnectionResult` · `connectionResult` · `loadAnalysisComplete` |
 * | 파일 · 테마 · 웹뷰 | `/api/state` · `file:current` |
 *
 * 낡음: 호스트는 결과가 무효가 되면 지운다(`analysisInvalidated` — 다리의 다시 보내기 기록에서도 빠진다). 이 화면은 이번 세션에서
 * 본 결과가 그렇게 지워지면 그 단계를 「낡음」으로 둔다(까닭 = 호스트가 보낸 reason). 다른 파일을 열면(`resultsCleared`) 「아직 안 함」.
 */
import { last, mcp, type LastEntry } from './bridge';
import { connSI, cutwpSI, dsmSI, loadsSI, memberSI, propsSI, purlinSI } from './units';
import { itemText } from './format';

export type Stage = 'sec' | 'fsm' | 'load' | 'chk' | 'conn' | 'val';
export type StageState = 'ok' | 'stale' | 'none' | 'run' | 'unk';

export const CMDS = ['modelLoaded', 'dsmResult', 'designResult', 'designPurlinResult', 'loadAnalysisComplete',
  'lapConnectionResult', 'connectionResult', 'analysisInvalidated', 'resultsCleared', 'restoreDesignInputs', 'analysisError', 'classifyResult'];

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

export interface CheckRow {
  key: string;          // 트리 · 표의 키
  run: string;          // Run.key
  where: string;        // 위치(부재 · 정모멘트 0.00–6.10 m …)
  name: string;         // 엔진의 한계상태 이름
  ratio: number | null;
  pass: boolean | null;
  kind: 'ls' | 'ne';    // ls = 엔진이 평가한 한계상태(limit_state_checks) · ne = 평가하지 못함(not_evaluated)
  src: string;          // data-src 의 앞부분(ratio 의 경로)
}

export interface Run {
  key: string;
  label: string;
  where: string;
  result: any;          // SI
  us: any;
  src: string;          // data-src 앞부분(이 결과의 뿌리 — `design:` · `purlin:regions.0.result.` 처럼 뒤에 경로를 바로 붙인다)
  overall: boolean | null;
  utilization: number | null;
  governing: string | null;
  rows: CheckRow[];
  notChecked: string[];
  notApplicable: string[];
  warnings: string[];
  assumptions: string[];
  scope: string[];
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
  stale: Partial<Record<Stage, { reason: string; at: number }>>;
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
}

export const state: State = {
  designerId: null, theme: 'dark', file: { path: null, name: null }, ready: false,
  full: null, model: null, modelSeq: -1, initialModel: null,
  props: null, propsSI: null, cutwp: null, cutwpSI: null, nodes: [], elems: [],
  dsm: null, msgs: {}, msgSeq: 0, runs: [],
  stages: {
    sec: { state: 'none', note: '' }, fsm: { state: 'none', note: '' }, load: { state: 'none', note: '' },
    chk: { state: 'none', note: '' }, conn: { state: 'none', note: '' }, val: { state: 'none', note: '' },
  },
  stale: {}, running: { fsm: false }, lastChange: null,
  analysis: null, loads: null, regions: [], lap: null, conn: null, renderMs: 0,
};

// ── 이번 세션에서 본 결과(낡음 판정용). 새로 고침해도 남게 sessionStorage 에(없어도 화면은 돈다) ──
const SEEN_KEY = 'stcfsd.ui.seen.v1';
type Seen = Partial<Record<Stage, number>>;
function readSeen(): { seen: Seen; stale: State['stale'] } {
  try { const j = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? 'null'); if (j && typeof j === 'object') { return { seen: j.seen ?? {}, stale: j.stale ?? {} }; } } catch { /* 없음 */ }
  return { seen: {}, stale: {} };
}
function writeSeen(seen: Seen, stale: State['stale']): void {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify({ seen, stale })); } catch { /* 저장 못 해도 화면은 돈다 */ }
}
let seenBox = readSeen();
state.stale = seenBox.stale;

const MEMBER_KO: Record<string, string> = { flexure: '휨 부재', compression: '압축 부재', combined: '조합 부재', tension: '인장 부재', connection: '접합' };

function list(v: unknown): string[] { return Array.isArray(v) ? v.map(itemText).filter(Boolean) : []; }

/** 엔진 결과 하나 → 판정 줄. 엔진의 pass · ratio · not_evaluated 를 그대로 옮긴다 */
function runOf(key: string, label: string, where: string, us: any, si: any, src: string, extraNe: unknown[] = []): Run {
  const rows: CheckRow[] = [];
  const lsc = Array.isArray(si?.limit_state_checks) ? si.limit_state_checks : [];
  lsc.forEach((x: any, i: number) => {
    rows.push({ key: `${key}#ls${i}`, run: key, where, name: String(x?.name ?? `한계상태 ${i + 1}`),
      ratio: typeof x?.ratio === 'number' ? x.ratio : null, pass: x?.pass === true ? true : x?.pass === false ? false : null,
      kind: 'ls', src: `${src}limit_state_checks.${i}.ratio` });
  });
  [...list(si?.not_evaluated), ...list(extraNe)].forEach((t, i) => {
    rows.push({ key: `${key}#ne${i}`, run: key, where, name: t, ratio: null, pass: null, kind: 'ne', src: '' });
  });
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const scope: string[] = [];
  const collect = (o: any, prefix: string) => {
    if (!o || typeof o !== 'object') { return; }
    warnings.push(...list(o.warnings).map(t => prefix + t));
    assumptions.push(...list(o.assumptions).map(t => prefix + t));
    scope.push(...list(o.scope_notes).map(t => prefix + t));
  };
  collect(us, '');
  if (typeof us?.dsm_warning === 'string' && us.dsm_warning) { warnings.push(`[DSM] ${us.dsm_warning}`); }
  for (const [k, v] of Object.entries(us ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'region' && k !== 'force_model') { collect(v, `[${k}] `); }
  }
  const notApplicable: string[] = [];
  if (us?.distortional_applicable === false) { notApplicable.push('뒤틀림 좌굴(§F4 · §E4)'); }
  return {
    key, label, where, result: si, us, src,
    overall: us?.pass === true ? true : us?.pass === false ? false : null,
    utilization: typeof si?.utilization === 'number' ? si.utilization : null,
    governing: typeof us?.governing_check === 'string' ? us.governing_check : null,
    rows, notChecked: list(us?.not_checked), notApplicable, warnings, assumptions, scope,
  };
}

function buildRuns(): Run[] {
  const runs: Run[] = [];
  const d = state.msgs.designResult?.message?.data;
  if (d && typeof d === 'object' && !d.error) {
    const si = memberSI(d);
    const mt = String(d.member_type ?? '');
    runs.push(runOf('design', `부재 검토 · ${MEMBER_KO[mt] ?? mt}`, MEMBER_KO[mt] ?? '부재', d, si, 'design:'));
  }
  const p = state.msgs.designPurlinResult?.message?.data;
  if (p && typeof p === 'object' && !p.error) {
    const si = purlinSI(p);
    const regions = Array.isArray(p.regions) ? p.regions : [];
    regions.forEach((rg: any, i: number) => {
      if (!rg?.result) { return; }
      // 엔진의 구간 이름은 ft 로 적혀 있다 — 화면은 m 이므로 그 숫자 자리만 SI 값으로 바꿔 적는다(값은 엔진의 start_ft · end_ft)
      const lab = regionLabel(rg, si.regions?.[i], i);
      runs.push(runOf(`purlin:${i}`, `퍼린 구간 · ${lab}`, lab,
        rg.result, si.regions?.[i]?.result, `purlin:regions.${i}.result.`));
    });
    // 퍼린 묶음 전체의 미검토 · 경고 · 가정(구간에 붙지 않은 것)
    const top = runOf('purlin', '퍼린 설계 · 전체', '퍼린 전체', { ...p, limit_state_checks: [], regions: undefined, design_positive: undefined,
      design_negative: undefined, design_lap: undefined, design_uplift: undefined, load_analysis: undefined, props: undefined, cutwp: undefined },
    { ...si, limit_state_checks: [] }, 'purlin:', list(p.load_not_evaluated));
    runs.push(top);
  }
  return runs;
}

/** 진행 띠 — 결과가 지금 입력과 맞는가. 계산하지 않는다: 호스트가 지운 것 · 남긴 것 · 알린 것만 본다 */
function buildStages(): void {
  const m = state.msgs;
  const f = state.full;
  const has = {
    fsm: !!f?.hasAnalysis,
    load: !!m.loadAnalysisComplete?.message?.data && !m.loadAnalysisComplete.message.data.error,
    chk: state.runs.length > 0,
    lap: !!m.lapConnectionResult?.message?.data,
    conn: !!m.connectionResult?.message?.data,
  };
  const cleared = m.resultsCleared?.seq ?? -1;
  const inval = m.analysisInvalidated;
  const now = Date.now();
  const seen = seenBox.seen;
  const mark = (st: Stage, present: boolean, seq: number) => {
    if (present) { seen[st] = seq; delete state.stale[st]; return; }
    const s = seen[st];
    if (s === undefined) { return; }
    if (cleared > s) { delete seen[st]; delete state.stale[st]; return; }      // 다른 파일을 열었다 — 낡음이 아니라 없음
    if (inval && inval.seq > s && !state.stale[st]) {
      state.stale[st] = { reason: String(inval.message?.data?.reason ?? '입력이 바뀜'), at: now };
    }
  };
  const at = state.msgSeq;
  mark('fsm', has.fsm, at);
  mark('load', has.load, at);
  mark('chk', has.chk, at);
  mark('conn', has.lap || has.conn, at);
  writeSeen(seen, state.stale);

  const st = (k: Stage, present: boolean, okNote: string, noneNote: string) => {
    if (present) { return { state: 'ok' as StageState, note: okNote }; }
    const s = state.stale[k];
    if (s) { return { state: 'stale' as StageState, note: `입력이 바뀌어 호스트가 결과를 지웠다 — ${s.reason}` }; }
    return { state: 'none' as StageState, note: noneNote };
  };
  state.stages.sec = f?.hasModel ? { state: 'ok', note: `절점 ${f.nnodes} · 요소 ${f.nelems}` } : { state: 'none', note: '단면 없음' };
  state.stages.fsm = state.running.fsm ? { state: 'run', note: '해석 중' }
    : st('fsm', has.fsm, `${state.dsm ? `${state.dsm.family} · ` : ''}길이 ${f?.lengths?.n ?? '—'}점`, '실행 안 함');
  state.stages.load = st('load', has.load, '결과 있음', '실행 안 함 · AI 의 analyze_loads 결과는 화면에 오지 않는다(K4)');
  const nChk = state.runs.reduce((a, r) => a + r.rows.length, 0);
  state.stages.chk = st('chk', has.chk, `${nChk} 항목`, '실행 안 함');
  if (has.lap) { state.stages.conn = { state: 'ok', note: '랩 접합 결과 있음' }; } else if (has.conn) {
    state.stages.conn = { state: 'unk', note: '단일 접합 결과 있음 · 호스트가 최신 여부를 판정하지 않는다' };
  } else { state.stages.conn = st('conn', false, '', '실행 안 함'); }
  state.stages.val = { state: 'none', note: '점검(검증 70항목)은 편집 상태의 검증 탭에서만 돈다 — 호스트로 옮기는 것은 K3' };
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
  const [full, msgs] = await Promise.all([mcp('get_full_state'), last(id, CMDS)]);
  if (full && !full.error) { state.full = full; state.fullErr = undefined; } else { state.fullErr = full?.error ?? '응답 없음'; }
  if (msgs) { state.msgs = msgs.data; state.msgSeq = msgs.seq; }
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
  // 좌굴 해석 DSM — 해석이 최신일 때만, 그 해석의 하중 계열로
  const fam = state.msgs.dsmResult?.message?.data?.load_family;
  const dsmSeq = state.msgs.dsmResult?.seq ?? -1;
  if (state.full?.hasAnalysis && typeof fam === 'string' && ['P', 'Mxx', 'Mzz'].includes(fam)) {
    if (!state.dsm || state.dsm.seq !== dsmSeq || state.dsm.family !== fam) {
      const r = await mcp('get_dsm', { load_type: fam });
      if (r && !r.error) { state.dsm = { family: fam, us: r, si: dsmSI(r), seq: dsmSeq }; state.dsmErr = undefined; } else { state.dsm = null; state.dsmErr = r?.error ?? '응답 없음'; }
    }
  } else {
    state.dsm = null;
    state.dsmErr = state.full?.hasAnalysis ? '해석의 하중 계열을 호스트가 알리지 않았다' : undefined;
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
  // 하중 해석 · 퍼린 구간 · 접합
  const la = state.msgs.loadAnalysisComplete?.message?.data;
  const pr = state.msgs.designPurlinResult?.message?.data;
  if (la && typeof la === 'object' && !la.error) { state.loads = { us: la, si: loadsSI(la), from: 'loads' }; }
  else if (pr && typeof pr === 'object' && !pr.error && pr.load_analysis) { state.loads = { us: pr.load_analysis, si: loadsSI(pr.load_analysis), from: 'purlin' }; }
  else { state.loads = null; }
  if (pr && typeof pr === 'object' && !pr.error && Array.isArray(pr.regions)) {
    const prSI = purlinSI(pr);
    state.regions = pr.regions.map((r: any, i: number) => ({ us: r, si: prSI.regions?.[i], runKey: `purlin:${i}` }));
  } else { state.regions = []; }
  const lap = state.msgs.lapConnectionResult?.message?.data;
  state.lap = lap && typeof lap === 'object' && !lap.error ? { us: lap, si: connSI(lap) } : null;
  const cn = state.msgs.connectionResult?.message?.data;
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

/** 퍼린 구간 이름 — 엔진의 이름에서 「a–b ft」 만 SI 응답의 구간 끝(m)으로 바꾼다(값은 SI 응답 그대로) */
export function regionLabel(us: any, si: any, i: number): string {
  const a = si?.start_ft, b = si?.end_ft;
  return String(us?.label ?? us?.id ?? `구간 ${i + 1}`).replace(/[\d.]+\s*[–-]\s*[\d.]+\s*ft/, typeof a === 'number' && typeof b === 'number' ? `${a.toFixed(2)}–${b.toFixed(2)} m` : '$&');
}
