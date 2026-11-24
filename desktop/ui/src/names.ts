/** 엔진 · 호스트의 이름 → 화면의 한국어 이름. 값은 바꾸지 않는다(이름만). */
import { state } from './store';
import { si } from './units';

export const TEMPLATE_KO: Record<string, string> = {
  lippedc: '립 C', lippedz: '립 Z', track: '트랙', hat: '햇', rhs: '각형 강관', chs: '원형 강관', angle: '앵글',
  isect: 'I 형', tee: 'T 형', lipped_angle: '립 앵글', custom: '임의 단면', custom_builder: '임의 단면',
};
export const TYPE_KO: Record<string, string> = {
  C: '립 C', Z: '립 Z', Track: '트랙', Hat: '햇', RHS: '각형 강관', CHS: '원형 강관', Angle: '앵글', I: 'I 형', Tee: 'T 형',
  LippedAngle: '립 앵글', Sigma: '시그마', custom: '임의 단면',
};
export const LOADCASE_KO: Record<string, string> = {
  compression: '압축 P', bending_xx: '정휨 Mxx', bending_xx_pos: '정휨 M+', bending_xx_neg: '부휨 M−',
  bending_zz: '약축 휨 Mzz', bending_zz_pos: '약축 휨 Mzz+', bending_zz_neg: '약축 휨 Mzz−', custom: '임의 하중', unknown: '정하지 않음',
};
export const FAMILY_KO: Record<string, string> = { P: '압축 P', Mxx: '강축 휨 Mxx', Mzz: '약축 휨 Mzz' };
export const BC_KO: Record<string, string> = {
  'S-S': '단순-단순', 'C-C': '고정-고정', 'S-C': '단순-고정', 'C-F': '고정-자유', 'C-G': '고정-가이드',
};

/** 템플릿 치수의 이름(종류마다 뜻이 다르다 — MCP set_section_template 설명과 같게) */
export function dimNames(template: string): Array<[string, string]> {
  switch (template) {
    case 'hat': return [['H', '윗면 폭 H'], ['B', '전체 높이 B'], ['D', '챙 D']];
    case 'chs': return [['OD', '바깥 지름 OD']];
    case 'angle': return [['H', '세로 다리 H'], ['B', '가로 다리 B']];
    case 'lipped_angle': return [['H', '다리 H'], ['B', '다리 B'], ['D', '립 D']];
    case 'track': case 'rhs': return [['H', '높이 H'], ['B', '폭 B']];
    case 'isect': case 'tee': return [['H', '전체 높이 H'], ['B', '플랜지 폭 B'], ['tf', '플랜지 두께 tf'], ['tw', '웨브 두께 tw']];
    default: return [['H', '웨브 높이 H'], ['B', '플랜지 폭 B'], ['D', '립 D']];
  }
}

const mmText = (inch: unknown) => { const v = si(inch, 'length'); return v === null ? '' : String(Number(v.toFixed(2))); };

/**
 * 「립 C 100×50×20×2.3」 — 템플릿 치수가 있을 때. 없으면 종류 이름(또는 「단면」).
 * 기본은 호스트 상태(get_full_state 의 section_template · section_type · section_params — K4a). 모델 메시지(modelLoaded 모양)도 받는다.
 */
export function sectionLabel(m: any = state.full): string {
  if (!m || (m.hasModel === false)) { return '단면 없음'; }
  const tpl = String(m.section_template ?? m.sectionTemplate ?? '');
  const name = TEMPLATE_KO[tpl] ?? TYPE_KO[String(m.section_type ?? m.sectionType ?? '')] ?? '임의 단면';
  const p = m.section_params ?? m.sectionParams ?? {};
  const keys = tpl === 'chs' ? ['OD', 't'] : tpl === 'hat' ? ['H', 'B', 'D', 't'] : ['H', 'B', 'D', 't'];
  const dims = keys.map(k => mmText(p[k])).filter(Boolean);
  if (tpl && tpl !== 'custom' && tpl !== 'custom_builder' && dims.length >= 2) { return `${name} ${dims.join('×')}`; }
  return name;
}

/** 단면 요소의 자리(element_roles — 검토 항목 계약 7절) */
export const ROLE_KO: Record<string, string> = {
  bottom_lip: '아래 립', bottom_flange: '아래 플랜지', web: '웨브', top_flange: '위 플랜지', top_lip: '위 립', corner: '모서리',
  brim: '챙', wall: '관벽', leg: '다리', lip: '립',
};

/** 계산 과정 단계의 kind(계약 3.1) → 시트 왼쪽 칸의 이름(템플릿 05) */
export const STEP_KO: Record<string, string> = {
  yield: '항복', elastic_buckling: '탄성', slenderness: '세장비', branch: '갈래', equation: '식', modifier: '보정',
  demand: '소요', design_strength: '설계강도', verdict: '판정',
};

/** 판정 어휘(계약 2절) */
export const VERDICT_KO: Record<string, { text: string; cls: 'ok' | 'ng' | 'un' | 'na' }> = {
  pass: { text: 'OK', cls: 'ok' }, fail: { text: 'NG', cls: 'ng' }, not_evaluated: { text: '미검토', cls: 'un' }, not_applicable: { text: '해당 없음', cls: 'na' },
};

/** 값의 출처(계약 3.3) → 꼬리표 글 · 모양 */
export const SOURCE_KO: Record<string, { t: string; cls: string; tip: string }> = {
  step: { t: '앞 단계', cls: '', tip: '같은 검토의 앞 단계 결과' },
  check: { t: '다른 검토', cls: 'drv', tip: '다른 검토 항목의 결과' },
  section_property: { t: '단면', cls: 'sec', tip: '단면 성질(엔진)' },
  material: { t: '재료', cls: '', tip: '재료 강도 — 누가 정했는지는 변경 기록(R2)부터' },
  buckling_analysis: { t: '좌굴 해석', cls: 'drv', tip: '좌굴 해석 또는 그 대체(method 참조)' },
  load_analysis: { t: '하중 해석', cls: 'drv', tip: '하중 해석의 소요(그 조합)' },
  user_input: { t: '지정', cls: '', tip: '입력으로 준 값 — 누가 정했는지(AI · 사람)는 변경 기록(R2)부터' },
  engine_default: { t: '기본값', cls: 'def', tip: '입력이 없어 엔진이 채운 값(경고 · 가정에 밝힘)' },
  specification: { t: '기준', cls: '', tip: 'AISI S100-16 의 상수 · 계수 · 표값' },
};

/** 좌굴 값의 얻은 법(계약 3.3 buckling_analysis.method) */
export const BUCKLING_METHOD_KO: Record<string, string> = {
  fsm_minimum: '서명곡선 극소', fsm_single_minimum: '극소 하나를 이 모드로', analytic: '해석식(부록 1 · 2)',
  analytic_raised_to_floor: '해석식 → 곡선 하한으로 올림', closed_form: '닫힌 식', user_supplied: '입력값',
};
