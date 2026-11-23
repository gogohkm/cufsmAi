// K2 0단계 — .csd 왕복 시험에 쓰는 「처음 값과 다른」 입력 한 벌(designState.FIELDS 의 저장 키마다 하나, US 내부값).
// 고른 기준: 그 칸에 사람이 실제로 넣을 만한 값 — 냉간성형강 퍼린 · 스터드 검토에서 흔한 치수와 하중
// (AISI 설계 매뉴얼 II-2A 의 8 in Z 퍼린 · 50 ksi 강재 · 5 ft 간격 · 3 / 20 / 34 psf 하중, 800S250 급 C 스터드 등)이고,
// 처음 값(HTML)과 다르며, 선택은 처음 것이 아닌 다른 선택지, 체크는 뒤집은 것.
// 처음 값과 같으면 시험이 실패한다(run.js 가 DOM 의 처음 값과 대조). 키가 FIELDS 에 새로 생기면 contract 가 실패한다.
'use strict';

const NON_DEFAULT = {
  // 재료 · 설계 방법 — A653 SS Grade 50 (Fy 50 · Fu 65 ksi): 강종 표의 값과 같아 강종 이름이 그대로 남는다
  fy: 50, fu: 65,
  designMethod: 'ASD',
  memberType: 'combined',            // 처음은 roof-purlin(자동 계산). 직접 입력의 조합(압축 + 휨)
  presteelGrade: 'A653-50',
  fyLoad: 50, fuPre: 65,
  inputE: 29000,                     // ksi — AISC 의 E (처음 29500)
  inputG: 11200,                     // ksi ≈ 29000 / 2(1 + 0.29)
  inputV: 0.29,
  plasticFy: 50,
  // 부재 구성
  spanType: 'cont-n', nSpans: 4,
  spacing: 5,                        // ft (II-2A 퍼린 간격)
  // 하중 (psf, 미계수)
  loadD: 3, loadLr: 20, loadS: 25, loadWu: 34, loadWp: 10, loadL: 40,
  chkPatternLoading: false,          // 처음 켜짐
  chkLrReduced: true,
  spanIxIn4: [9.18, 7.76, 7.76, 9.18],     // in⁴ — 경간 4개(II-2A 의 0.059 / 0.070 부재 Ix)
  // 데크 · 가새 · §I6.2.1
  deckType: 'through-fastened',
  deckTPanel: 0.019,                 // in (26 ga 지붕판 정도)
  deckFastenerSpacing: 12,           // in
  deckKphiOverride: 0.3,             // kip-in/rad/in
  deckKxOverride: 1.27,              // kip/in/in (II-1C kx 1.28 정도)
  bracePointsFt: [6.25, 12.5],
  chkI621Confirmed: true,
  lapRestrained: true, lapRestrainedLap: true,   // 계약 §6.3 랩 구속의 진술(랩 탭 칸은 거울)
  deckInsulationIn: 3,               // in
  deckRTested: 0.6,
  // 설계 길이 · 계수 · 소요강도
  KxLx: 120, KyLy: 60, KtLt: 60,     // in
  Lb: 72, Cb: 1.14,
  designLbPos: 48, designCbPos: 1.3,
  Cmx: 0.85, Cmy: 0.85,
  Pu: 5, Vu: 1.5,                    // kips
  Mux: 40, designMxPos: 30, Muy: 2,  // kip-in
  MayStrength: 10,                   // kip-in
  chkBetaDist: false,                // 처음 켜짐
  distM1M2: -0.5, distLm: 60,
  chkRFactor: true, rValue: '0.60',  // 연속 경간 0.60 (표 I6.2.1-1 의 한 값 — 0.70 은 두 선택지가 같은 값이라 피함)
  chkColdWork: false,                // 처음 켜짐
  chkInelasticReserve: true,
  // 웹 크리플링
  wcN: 3.5, wcR: 0.1875, wcP: 2,     // in, in, kips
  wcSupport: 'IOF', wcFastened: 'unfastened', wcWebConfig: 'nested_z', wcFamily: 'Z', wcFlangeCondition: 'unstiffened',
  wcLo: 2, wcEdgeDistance: 1.5, wcNWebs: 2, wcFastenerSpacing: 12,
  // 템플릿 — 8ZS2.25x059 (II-2A): H 8, B 2.25, D 0.91, t 0.059, r 0.1875, 립 50°
  templateType: 'lippedz', tplH: 8, tplB: 2.25, tplD: 0.91, tplT: 0.059, tplR: 0.1875, tplQlip: 50,
  // 해석 탭
  analysisBC: 'C-C', analysisLoadCase: 'bending_xx_pos', analysisNeigs: 12,
  analysisLenMin: 0.5, analysisLenMax: 500, analysisLenN: 40,    // in
  analysisLoadPUs: 5, analysisLoadMxxUs: 12, analysisLoadMzzUs: 1,  // kips, kip-in (custom 하중 칸 — 하중 경우가 custom 이 아니어도 저장된다)
  chkCfsmEnable: false, chkCfsmG: false, chkCfsmD: false, chkCfsmL: false, chkCfsmO: false,
  vibRho: 7.4e-7,                    // kip·s²/in⁴ (≈ 7,900 kg/m³)
  vibLengths: [50, 100],             // in
  // 접합부 탭
  connFastenerType: 'bolt', connSingleType: 'bolt', connGrooveType: 'partial',
  connLapLeft: 30, connLapRight: 42, connMu: 52.5, connVu: 0.9,   // in, in, kip-in, kips
  connLapSupport: 3,                 // V8-01: 랩이 걸친 지점(II-2A 의 첫 안쪽 지점)
  connFastenerDia: 0.5, connNRows: 3, connEdgeDist: 1, connLapPnvs: 1.2,
  connT1: 0.059, connT2: 0.075, connD: 0.5, connN: 2,
  connFy: 50, connFu: 65,
  connWeldL: 2, connWeldSize: 0.125,
  connFub: 60,                       // ksi — A307
  connFuf: 125,
  connPnvs: 1.5, connDw: 0.5, connPu: 2, connTu: 0.5, connE: 1, connS: 1.5,
  connMemberCase: 'flat_sheet', connWidth: 4, connJ63NotApplicable: true,
};

// 경간 표(spanType cont-n · nSpans 4): 길이 ft, 지점 형식, 지점마다 랩 { left, right } ft(첫 지점의 왼쪽 · 끝 지점의 오른쪽 칸은 없다 → null)
const SPAN_TABLE = {
  spans: [20, 25, 25, 20],
  supports: ['P', 'R', 'P', 'R', 'P'],
  lapsPerSupport: [
    { left: null, right: 0 },
    { left: 2.5, right: 3.5 },
    { left: 1, right: 1 },
    { left: 3.5, right: 2.5 },
    { left: 0, right: null },
  ],
};

/** 저장 파일에 넣을 designInputs(1.3 의 모양) */
function designInputs(unitSystem) {
  return { unitSystem, analysisMethod: 'DSM', ...JSON.parse(JSON.stringify(NON_DEFAULT)), ...JSON.parse(JSON.stringify(SPAN_TABLE)) };
}

module.exports = { NON_DEFAULT, SPAN_TABLE, designInputs };
