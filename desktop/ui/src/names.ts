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

/** 「립 C 100×50×20×2.3」 — 템플릿 치수가 있을 때. 없으면 종류 이름(또는 「단면」) */
export function sectionLabel(m: any = state.model): string {
  if (!m) { return '단면 없음'; }
  const tpl = String(m.sectionTemplate ?? '');
  const name = TEMPLATE_KO[tpl] ?? TYPE_KO[String(m.sectionType ?? '')] ?? '임의 단면';
  const p = m.sectionParams ?? {};
  const keys = tpl === 'chs' ? ['OD', 't'] : tpl === 'hat' ? ['H', 'B', 'D', 't'] : ['H', 'B', 'D', 't'];
  const dims = keys.map(k => mmText(p[k])).filter(Boolean);
  if (tpl && tpl !== 'custom' && tpl !== 'custom_builder' && dims.length >= 2) { return `${name} ${dims.join('×')}`; }
  return name;
}
