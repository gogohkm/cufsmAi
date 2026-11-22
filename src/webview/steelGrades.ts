// 재료 칸의 강종 목록 — 화면 드롭다운(값 · 표지 · data-fy/data-fu), 재료 칸의 처음 값, 호스트 초기 기준응력이
// 모두 이 표 하나에서 온다. 값은 엔진 python/design/steel_grades.py 와 같아야 한다
// (test/webview/panel_host_contract.js 가 엔진 steel_grades 응답과 대조한다).
//
// 기본 강종(사내 결정 2026-11-22): SGC400 = KS D 3506 SGC295Y, Fy 295 / Fu 400 MPa.
// "기본"은 처음 보이는 칸의 값일 뿐이다 — 계산 경로는 빠진 Fy 를 이것으로 채우지 않는다.
//
// VS Code API 에 의존하지 않는다(node 시험에서 직접 로드).

import { US_TO_SI } from '../mcp/siUnits';

const KSI_TO_MPA = US_TO_SI.stress;

/** MPa 로 정해진 값 → ksi. 반올림하지 않는다 — × KSI_TO_MPA 하면 정수 MPa 가 정확히 돌아온다. */
const mpa = (v: number): number => v / KSI_TO_MPA;

export interface UiSteelGrade {
    id: string;
    /** 설계 Fy (ksi) — §A3.1.3 강종은 감소값 */
    Fy: number;
    /** 설계 Fu (ksi) — §A3.1.3 강종은 감소값 */
    Fu: number;
    label: string;
    restricted?: boolean;
}

export const UI_STEEL_GRADES: readonly UiSteelGrade[] = [
    // KS D 3506 구조용(KDS 41 30 30 표 3.2-2). 괄호는 현행 명칭.
    { id: 'SGC340', Fy: mpa(245), Fu: mpa(340), label: 'SGC340 (245/340 MPa)' },
    { id: 'SGC400', Fy: mpa(295), Fu: mpa(400), label: 'SGC400 (295/400 MPa)' },
    { id: 'SGC440', Fy: mpa(335), Fu: mpa(440), label: 'SGC440 (335/440 MPa)' },
    { id: 'SGC490', Fy: mpa(365), Fu: mpa(490), label: 'SGC490 (365/490 MPa)' },
    // §A3.1.3 저연성 강종: 감소값 Fy = min(0.75Fsy, 60), Fu = min(0.75Fu, 62) — 엔진 LOW_DUCTILITY_GRADES 와 같음
    { id: 'SGC570', Fy: 60, Fu: 62, restricted: true, label: 'SGC570 — §A3.1.3 제한, 감소값 414/427 MPa' },
    { id: 'A653-33', Fy: 33, Fu: 45, label: 'A653-33 (33/45 ksi)' },
    { id: 'A653-50', Fy: 50, Fu: 65, label: 'A653-50 (50/65 ksi)' },
    { id: 'A653-80', Fy: 60, Fu: 61.5, restricted: true, label: 'A653-80 — §A3.1.3 제한, 감소값 60/61.5 ksi' },
];

export const DEFAULT_STEEL_GRADE = 'SGC400';

/** 기본 강종의 행 — 화면 재료 칸의 처음 값과 호스트 초기 기준응력(loadFy). */
export function defaultSteel(): UiSteelGrade {
    const g = UI_STEEL_GRADES.find((x) => x.id === DEFAULT_STEEL_GRADE);
    if (!g) { throw new Error(`default steel grade ${DEFAULT_STEEL_GRADE} is not in UI_STEEL_GRADES`); }
    return g;
}

/** 응력(ksi) → SI 화면 칸의 글(MPa, 12 자리 — 웹뷰 단위 전환 refreshUnits 와 같은 규칙). */
export function mpaField(ksi: number): string {
    return String(Number((ksi * KSI_TO_MPA).toPrecision(12)));
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 재료 드롭다운의 <option> 들. data-fy · data-fu 는 ksi(웹뷰가 강종을 고를 때 이 값을 칸에 넣는다). */
export function steelGradeOptionsHtml(): string {
    return UI_STEEL_GRADES.map((g) =>
        `<option value="${escapeAttr(g.id)}" data-fy="${g.Fy}" data-fu="${g.Fu}"`
        + `${g.restricted ? ' data-restricted="1"' : ''}${g.id === DEFAULT_STEEL_GRADE ? ' selected' : ''}>`
        + `${escapeAttr(g.label)}</option>`).join('\n');
}
