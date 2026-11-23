/**
 * 사람이 읽는 날짜 · 시각 — 이 PC 의 지역 시간대(기록은 ISO 순간 그대로 두고, 도장 · 보고서 머리 · 목록에 찍을 때만 이것으로).
 * UTC 날짜를 찍으면 한국의 새벽 발행이 전날 날짜가 된다(R5-3 에서 찾은 결함).
 */
const p2 = (n: number) => String(n).padStart(2, '0');

function at(iso: string | Date): Date | null {
    const d = iso instanceof Date ? iso : new Date(String(iso));
    return Number.isFinite(d.getTime()) ? d : null;
}

/** 'YYYY-MM-DD'(지역) — 읽을 수 없으면 '' */
export function localDate(iso: string | Date): string {
    const d = at(iso);
    return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '';
}

/** 'YYYY-MM-DD HH:mm'(지역) — 읽을 수 없으면 '' */
export function localDateTime(iso: string | Date): string {
    const d = at(iso);
    return d ? `${localDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
}
