/**
 * 검토 상태(K2 — 호스트가 쥔 설계 · 하중 · 접합 입력)의 칸 — 이름 · 묶음 · 단위 종류 · 출처 꼬리표.
 *
 * 칸의 표는 제품의 하나뿐인 표(`webview/js/designState.js` 의 FIELDS — 호스트 · 설계 화면 · `.csd` · MCP 가 같이 쓴다)를 그대로 묶는다.
 * 여기에는 그 표에 없는 **화면의 한국어 이름**만 둔다. 값은 호스트의 `get_case_inputs`(US)를 제품의 `caseValueToSI` 로 바꿔 보인다
 * (units.ts — 이 화면의 하나뿐인 변환 자리). 값을 고치는 길은 없다(편집 상태의 설계 화면만 고친다).
 */
// @ts-expect-error — UMD(CommonJS) 모듈, 형 정보 없음. 표만 읽는다
import * as DS from '../../../webview/js/designState.js';

type Meta = { owner?: string; group?: string; def?: unknown; opts?: string[] };
type Row = [string, string, string | null, string, Meta?];
const FIELDS: Row[] = (DS as { FIELDS: Row[] }).FIELDS ?? (DS as { default?: { FIELDS: Row[] } }).default?.FIELDS ?? [];

export interface CaseField { key: string; group: string; kind: string | null; type: string; opts?: string[] }
/** 검토 상태의 칸(모델 칸 · 보기 칸 제외) — 표의 차례 그대로 */
export const CASE_FIELDS: CaseField[] = FIELDS.filter(r => r[4]?.owner === 'case')
  .map(r => ({ key: r[0], group: String(r[4]?.group ?? ''), kind: r[2], type: r[3], opts: r[4]?.opts }));
export const fieldOf = (key: string): CaseField | undefined => CASE_FIELDS.find(f => f.key === key);

/** 묶음 → 트리 가지(템플릿 01 의 부재 · 하중 · 설계 조건 · 접합부) */
export const BRANCH_OF: Record<string, 'mem' | 'ld' | 'dc' | 'cj' | 'mat' | 'other'> = {
  member: 'mem', deck: 'mem', loads: 'ld', material: 'mat', method: 'dc', design: 'dc', required: 'dc', options: 'dc', webCrippling: 'dc',
  lap: 'cj', connection: 'cj', vibration: 'other',
};
export const GROUP_KO: Record<string, string> = {
  member: '부재 구성', deck: '데크 · 가새', loads: '사용하중 · 면압', material: '재료', method: '설계법', design: '설계 길이 · 계수', required: '소요강도',
  options: '보정 · 선택', webCrippling: '웹 크리플링', lap: '랩 접합', connection: '단일 접합', vibration: '진동',
};

/** 칸의 한국어 이름(설계 화면 칸의 이름을 줄인 것) */
export const CASE_KO: Record<string, string> = {
  fy: '설계 Fy', fu: '설계 Fu', presteelGrade: '강종', designMethod: '설계법',
  // 17ad004 다음 — 랩 구간의 구속 진술(없으면 엔진이 퍼린의 랩 구간 · 랩 검토를 「검토 안 함」으로 낸다)
  lap_restrained: '랩 구간 구속 진술',
  // daca0ac — 랩 탭의 「지점」(하중 해석의 자동 채움은 부모멘트가 가장 큰 지점과 그 지점의 랩 길이)
  connLapSupport: '랩 지점',
  memberType: '부재 유형', spanType: '스팬 형식', nSpans: '스팬 수', spacing: '간격',
  loadD: 'D 고정', loadLr: 'Lr 지붕 활', loadS: 'S 적설', loadWu: 'W↑ 양압', loadWp: 'W↓ 정압', loadL: 'L 활하중',
  chkPatternLoading: '활하중 부분재하', chkLrReduced: '지붕 활하중 감소', spanIxIn4: '경간별 Ix',
  deckType: '데크 형식', deckTPanel: '데크 두께', deckFastenerSpacing: '체결 간격', deckKphiOverride: 'kφ 직접 입력', deckKxOverride: 'kx 직접 입력',
  bracePointsFt: '이산 브레이스 위치', chkI621Confirmed: '§I6.2.1 조건 확인', deckInsulationIn: '단열재 두께', deckRTested: '스탠딩심 시험 R',
  KxLx: 'KxLx', KyLy: 'KyLy', KtLt: 'KtLt', Lb: 'Lb 비지지 길이', Cb: 'Cb', designLbPos: 'Lb 정모멘트', designCbPos: 'Cb 정모멘트', Cmx: 'Cmx', Cmy: 'Cmy',
  Pu: 'Pu', Vu: 'Vu', Mux: 'Mux', designMxPos: 'Mx 정', Muy: 'Muy', MayStrength: 'May 강도',
  chkBetaDist: 'β 모멘트 구배', distM1M2: 'M1/M2', distLm: 'Lm', chkRFactor: '§I6.2.1 R', rValue: 'R 값', chkColdWork: '냉간가공 강도 증가', chkInelasticReserve: '비탄성 여유',
  wcN: '지압 길이 N', wcR: '안쪽 반지름 R', wcP: '집중하중 P', wcSupport: '지지 조건', wcFastened: '체결', wcWebConfig: '웹 형식', wcFamily: '단면 종류',
  wcFlangeCondition: '플랜지 조건', wcLo: 'Lo', wcEdgeDistance: '끝 거리', wcNWebs: '웹 수', wcFastenerSpacing: '체결 간격',
  vibRho: '밀도 ρ', vibLengths: '진동 길이',
  connFastenerType: '패스너', connLapLeft: '랩 좌', connLapRight: '랩 우', connMu: '지점 Mu', connVu: '지점 Vu', connFastenerDia: '패스너 지름',
  connNRows: '열 수', connEdgeDist: '단부 거리', connLapPnvs: '패스너 강도 Pnvs',
  connSingleType: '접합 종류', connGrooveType: '그루브 종류', connT1: 't1', connT2: 't2', connD: '지름 d', connN: '개수 n', connFy: '판 Fy', connFu: '판 Fu',
  connWeldL: '용접 길이', connWeldSize: '용접 치수', connFub: '볼트 Fub', connFuf: 'Fuf', connPnvs: 'Pnvs', connDw: 'dw', connPu: 'Pu', connTu: 'Tu', connE: '끝 거리 e',
  connS: '간격 s', connMemberCase: '판 종류', connWidth: '판 폭', connJ63NotApplicable: 'J6.3 해당 없음',
};

/** 선택지 값 → 화면 글(값 그대로를 옆에 함께 — 템플릿의 「지붕 퍼린 · roof-purlin」) */
export const OPTION_KO: Record<string, string> = {
  'roof-purlin': '지붕 퍼린', 'floor-joist': '바닥 장선', 'wall-girt': '벽 거트', 'wall-stud': '벽 스터드', flexure: '휨 부재', compression: '압축 부재', combined: '조합 부재', tension: '인장 부재',
  simple: '단순', 'cont-2': '2연속', 'cont-3': '3연속', 'cont-4': '4연속', 'cont-5': '5연속', cantilever: '캔틸레버',
  'through-fastened': '관통 체결', 'standing-seam': '스탠딩심', none: '없음', bolt: '볼트', screw: '나사', LRFD: 'LRFD', ASD: 'ASD',
};

/** 출처(get_case_inputs.sources) → 꼬리표 글 · 모양 · 풍선 */
export const CASE_SOURCE: Record<string, { t: string; cls: string; tip: string }> = {
  default: { t: '기본값', cls: 'def', tip: '아무도 정하지 않아 프로그램의 처음 값(표의 기본값)이다' },
  user: { t: '지정', cls: '', tip: '사람이 편집 상태의 칸에서 정했다' },
  ai: { t: 'AI', cls: 'ai', tip: 'AI 가 MCP 도구로 정했다(그 도구의 입력 묶음 — 주지 않은 칸은 빈칸)' },
  file: { t: '파일', cls: '', tip: '연 .csd 파일에서 왔다' },
  'load-analysis': { t: '하중 해석', cls: 'drv', tip: '하중 해석 결과가 채웠다' },
  // K2 의 'mirror' 는 「화면이 다른 칸을 따라 채운 값」 — 재료의 거울(① Fy → 설계 · 소성 · 접합)만이 아니라 강종 → Fy · Fu, E · ν → G,
  // 모드 전환의 비우기, β 를 켤 때의 채우기 같은 화면의 연동 모두(K2 설계 표 「화면 JS 의 파생」). 그래서 「재료」가 아니라 「연동」
  mirror: { t: '연동', cls: 'sec', tip: '화면이 다른 칸을 따라 채운 값(재료의 거울 · 강종 → Fy · Fu · 모드 전환 등 화면의 연동) — 사람이 고치면 지정' },
};

export function caseTag(src: string | undefined, blankByAi = false): string {
  const s = CASE_SOURCE[String(src)] ?? { t: String(src ?? '—'), cls: '', tip: '출처' };
  const tip = blankByAi ? 'AI 가 이 도구의 입력 묶음을 정할 때 이 칸을 주지 않았다 — 빈칸(엔진이 그 칸 없이 계산했다)' : s.tip;
  return `<span class="tag ${s.cls}" data-source="${String(src ?? '')}" data-tip="${tip}">${s.t}</span>`;
}

/** 엔진 요청의 인자 이름 → 검토 상태의 키(계산 시트의 「설계 가정과 출처」가 그 값의 출처를 찾을 때) */
export const ENGINE_TO_CASE: Record<string, string> = {
  Fy: 'fy', Fu: 'fu', Lb: 'Lb', Cb: 'Cb', KxLx: 'KxLx', KyLy: 'KyLy', KtLt: 'KtLt', Pu: 'Pu', Vu: 'Vu', Mu: 'Mux', Mx: 'Mux', My: 'Muy', Cmx: 'Cmx', Cmy: 'Cmy',
  wc_N: 'wcN', wc_R: 'wcR', wc_P: 'wcP', dist_Lm: 'distLm', R_uplift: 'rValue',
};
