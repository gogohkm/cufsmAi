/**
 * 왼쪽 트리 — 탭 4개(업무 · 모델 · 결과 · 문서). 한 줄에 이름과 오른쪽 끝의 값 · 개수 · 상태만. 고르면 가운데와 오른쪽이 따라온다.
 * 가지는 호스트에 있는 것만 만든다. 호스트에 아직 없는 것(설계 입력 · 기록 · 검증)은 그 까닭을 값 자리에 적는다 — 빈칸이 아니다.
 */
import { esc, tip } from './dom';
import { num, ratio } from './format';
import { BC_KO, FAMILY_KO, LOADCASE_KO, sectionLabel } from './names';
import { isDefault, memberRuns, state, type CheckRow, type Run } from './store';
import { si } from './units';

export type Tab = 'work' | 'model' | 'result' | 'doc';
export const TABS: Array<[Tab, string]> = [['work', '업무'], ['model', '모델'], ['result', '결과'], ['doc', '문서']];

export interface TNode {
  k: string; t: string;
  v?: string; vCls?: string; vHtml?: string;
  dot?: string; tip?: string; faint?: boolean; tag?: string;
  kids?: TNode[]; open?: boolean;
}

const n = (k: string, t: string, o: Partial<TNode> = {}): TNode => ({ k, t, ...o });
const K2 = '설계 · 하중 · 접합 입력은 K2 전까지 편집 상태(F2)의 입력 칸에만 있다 — 호스트도 MCP 도구도 이 값을 알지 못한다';

const STATE_V: Record<string, [string, string, string]> = {
  ok: ['일치', 'ok', 'ok'], stale: ['낡음', 'warn', 'warn'], none: ['결과 없음', 'un', ''], run: ['해석 중', 'acc', 'acc'], unk: ['결과 있음', '', ''],
};

function stageNode(k: string, t: string, st: keyof typeof state.stages, extra: Partial<TNode> = {}): TNode {
  const s = state.stages[st];
  const [v, cls, dot] = STATE_V[s.state];
  return n(k, t, { v, vCls: cls, dot: dot || undefined, tip: s.note, ...extra });
}

/** 「이 위치만 보기」 — 한 실행 · 검토 지점의 항목만 트리에 둔다(우클릭 메뉴 · I). null = 모두 */
export let treeFilter: { run: string; point: number | null; label: string } | null = null;
export function setTreeFilter(f: typeof treeFilter): void { treeFilter = f; }
const passFilter = (r: CheckRow) => !treeFilter || (r.run === treeFilter.run && r.point === treeFilter.point);

function rowNode(r: CheckRow): TNode {
  const ng = r.pass === false;
  const dot = r.pass === true ? 'ok' : r.pass === false ? 'ng' : 'un';
  const ratioCell = r.kind === 'ls' && typeof r.ratio === 'number' ? ratio(r.ratio, ng, `${r.src}ratio`)
    : r.kind === 'na' ? '<span class="vl faint">해당 없음</span>' : r.kind === 'ls' ? '<span class="vl faint">비 없음</span>' : '<span class="vl un">미검토</span>';
  return n(r.key, `${r.where} · ${r.name}`, {
    dot: r.kind === 'na' ? undefined : dot, vHtml: ratioCell, faint: r.kind === 'na' || !r.counts,
    tip: r.kind === 'ne' ? `엔진이 평가하지 못한 항목 — 합격이 아니다: ${String(r.us?.reason ?? r.name)}`
      : r.kind === 'na' ? `해당 없음: ${String(r.us?.reason ?? '')}` : !r.counts ? '적용 조건 — 판정에 들지 않는다(counts: false)' : `${r.id} · §${r.clause}`,
  });
}

export function buildTree(tab: Tab): TNode[] {
  const f = state.full;
  if (tab === 'model') {
    const def = isDefault('section');
    const nlen = f?.lengths;
    return [
      n('sec', '단면', { v: sectionLabel(), tip: def ? '프로그램이 시작할 때 채운 기본 단면. 아무도 정하지 않았다' : undefined, open: true, kids: [
        n('sdim', '치수', { tag: def ? '기본값' : undefined, v: def ? '' : f?.section_params && f?.section_template && !String(f.section_template).startsWith('custom') ? '템플릿 치수' : '템플릿 치수 없음',
          vCls: f?.section_params && f?.section_template ? '' : 'un' }),
        n('snode', '절점', { vHtml: num(f?.nnodes, { src: 'full:nnodes', kind: 'none' }) }),
        n('selem', '요소', { vHtml: num(f?.nelems, { src: 'full:nelems', kind: 'none' }) }),
        n('sspr', '스프링', { vHtml: num(f?.nsprings, { src: 'full:nsprings', kind: 'none' }) }),
        n('scon', '구속', { vHtml: num(f?.nconstraints, { src: 'full:nconstraints', kind: 'none' }) }),
      ] }),
      n('mat', '재료', { vHtml: f ? `E ${num(si(f.material?.E, 'stress'), { src: 'full:material.E', kind: 'stress', sig: 6 })}` : undefined, kids: [
        n('mE', '탄성계수 E', { vHtml: num(si(f?.material?.E, 'stress'), { src: 'full:material.E', kind: 'stress', sig: 6 }) }),
        n('mNu', '푸아송비 ν', { vHtml: num(f?.material?.v, { src: 'full:material.v', kind: 'none', sig: 3 }) }),
        n('mG', '전단탄성계수 G', { vHtml: num(si(f?.material?.G, 'stress'), { src: 'full:material.G', kind: 'stress', sig: 6 }) }),
        n('mFy', '설계 Fy · Fu', { v: '편집 상태에서', vCls: 'un', tip: K2 }),
      ] }),
      n('cond', '해석 조건', { v: f ? (BC_KO[f.BC] ?? f.BC) : '', kids: [
        n('cBC', '경계조건', { v: f ? `${f.BC} · ${BC_KO[f.BC] ?? ''}` : '' }),
        n('cLc', '하중 경우', { v: f?.load_case ? (LOADCASE_KO[f.load_case] ?? f.load_case) : '정하지 않음', vCls: f?.load_case ? '' : 'un',
          tip: 'MCP get_status 의 load_case · load_fy(K4a)' }),
        n('cLen', '반파장', { vHtml: nlen ? `${num(nlen.n, { src: 'full:lengths.n', kind: 'none' })}점` : '<span class="vl un">없음</span>' }),
        n('cStr', '절점 응력', { vHtml: f ? `${num(si(f.stress?.min, 'stress'), { src: 'full:stress.min', kind: 'stress', unit: false })} ~ ${num(si(f.stress?.max, 'stress'), { src: 'full:stress.max', kind: 'stress' })}` : '' }),
      ] }),
      n('mem', '부재', { v: '편집 상태에서', vCls: 'un', tip: `스팬 · 지점 · 랩 · 간격 · 데크 — ${K2}` }),
      n('ld', '하중', { v: '편집 상태에서', vCls: 'un', tip: `하중 케이스 · 조합 — ${K2}` }),
      n('dc', '설계 조건', designCondNode()),
      n('cj', '접합부', { v: '편집 상태에서', vCls: 'un', tip: `접합 입력 — ${K2}` }),
      n('asm', '가정', assumptionsNode()),
    ];
  }
  if (tab === 'result') {
    const runs = memberRuns();
    const rows = runs.flatMap(r => r.rows).filter(passFilter);
    const ng = rows.filter(r => r.kind === 'ls' && r.pass === false), ok = rows.filter(r => r.kind === 'ls' && r.pass === true), un = rows.filter(r => r.kind === 'ne');
    const naRows = rows.filter(r => r.kind === 'na');
    const out = runs.flatMap(r => r.notChecked.map(t => ({ run: r, t })));
    const na = runs.flatMap(r => r.notApplicable.map(t => ({ run: r, t })));
    const chkStage = state.stages.chk;
    const p = state.propsSI;
    const dsm = state.dsm;
    const fam = dsm?.family;
    const d = dsm?.si?.[fam ?? ''];
    const kind = fam === 'P' ? 'force' : 'moment';
    const crit = (k: string, t: string, key: string, L: string) => n(k, t, {
      vHtml: d ? `${num(d[key], { src: `dsm:${fam}.${key}`, kind, unit: false })} @ ${num(d[L], { src: `dsm:${fam}.${L}`, kind: 'length' })}` : undefined,
    });
    return [
      n('props', '단면 성질', { vHtml: p ? `A ${num(p.A, { src: 'props:A', kind: 'area' })}` : '<span class="vl un">결과 없음</span>' }),
      stageNode('fsm', '좌굴 해석', 'fsm', { kids: dsm ? [
        n('fsm:fam', '하중 계열', { v: FAMILY_KO[fam!] ?? fam }),
        crit('fsm:l', '국부', 'crl', 'Lcrl'), crit('fsm:d', '뒤틀림', 'crd', 'Lcrd'), crit('fsm:g', '전체', 'cre', 'Lcre'),
      ] : undefined }),
      stageNode('load', '하중 해석', 'load', state.loads ? { v: '결과 있음', vCls: 'ok', dot: 'ok', kids: [
        n('load:gov', '지배 조합', { v: String(state.loads.us.governing?.combo ?? '') }),
        n('load:loc', '위치', { v: String((state.loads.us.governing?.locations ?? []).length) }),
        n('load:def', '처짐', { vHtml: (state.loads.si.deflection?.per_span ?? []).map((d: any, i: number) => `L/${num(d.L_over_delta, { src: `loads:deflection.per_span.${i}.L_over_delta`, kind: 'none' })}`).join(' · ') || '<span class="vl un">없음</span>' }),
      ], tip: state.loads.from === 'purlin' ? '퍼린 설계가 함께 돌린 하중 해석' : '마지막 하중 해석' } : {}),
      n('chk', '부재 검토', {
        v: chkStage.state === 'ok' ? `NG ${ng.length} · 미검토 ${un.length} · OK ${ok.length}` : STATE_V[chkStage.state][0],
        vCls: chkStage.state === 'ok' ? (ng.length ? 'ng' : un.length ? 'un' : 'ok') : STATE_V[chkStage.state][1],
        dot: chkStage.state === 'stale' ? 'warn' : undefined, tip: chkStage.state === 'ok' ? '판정 차례: NG > 미검토 > OK. 미검토는 합격이 아니다' : chkStage.note,
        open: true,
        kids: chkStage.state === 'ok' ? [
          ...(treeFilter ? [n('chk:filter', `이 위치만 — ${treeFilter.label}`, { v: '풀기', vCls: 'acc', tip: '「이 위치만 보기」를 풀고 모든 항목으로(Esc)' })] : []),
          n('chk:NG', 'NG', { v: String(ng.length), vCls: ng.length ? 'ng' : '', open: true, kids: ng.map(rowNode) }),
          n('chk:UN', '미검토', { v: String(un.length), vCls: un.length ? 'un' : '', open: true, tip: '합격이 아니다', kids: un.map(rowNode) }),
          n('chk:OK', 'OK', { v: String(ok.length), vCls: '', open: ok.length <= 40, kids: ok.map(rowNode) }),
          ...(naRows.length || na.length ? [n('chk:NA', '해당 없음', { v: String(naRows.length + na.length), faint: true, tip: '이 단면 · 하중에 적용되지 않는 한계상태. 미검토와 다르다', kids: naRows.map(rowNode) })] : []),
          ...(out.length ? [n('chk:OUT', '범위 밖', { v: String(out.length), faint: true, tip: '엔진이 이 검토의 범위 밖으로 둔 것(구현 안 됨 · 입력 없음) — 판정에 들어가지 않는다' })] : []),
        ] : undefined,
      }),
      stageNode('conn', '접합부 검토', 'conn', state.lap || state.conn ? { kids: [
        ...(state.lap ? [n('conn:lap', `랩 · ${String(state.lap.us.fastener_label ?? '패스너')}`, { dot: state.lap.us.pass === true ? 'ok' : state.lap.us.pass === false ? 'ng' : 'un', tag: state.lap.us.force_model?.specification_provision === false ? '자체 가정' : undefined,
          vHtml: typeof state.lap.us.utilization === 'number' ? ratio(state.lap.us.utilization, state.lap.us.pass === false, 'lap:utilization') : undefined,
          kids: (state.runs.find(r => r.key === 'lap')?.rows ?? []).filter(passFilter).map(rowNode) })] : []),
        ...(state.conn ? [n('conn:one', `단일 접합 · ${String(state.runs.find(r => r.key === 'conn')?.where.replace(/^접합 · /, '') ?? state.conn.us.connection_type ?? '')}`, { dot: state.conn.us.pass === true ? 'ok' : state.conn.us.pass === false ? 'ng' : 'un',
          vHtml: typeof state.conn.us.utilization === 'number' ? ratio(state.conn.us.utilization, state.conn.us.pass === false, 'conn:utilization') : undefined,
          kids: (state.runs.find(r => r.key === 'conn')?.rows ?? []).filter(passFilter).map(rowNode) })] : []),
      ] } : {}),
      n('alt', '대안', { v: '기록 없음', vCls: 'un', tip: '단면 대안 비교는 기록(R4)부터 생긴다' }),
    ];
  }
  if (tab === 'work') {
    return [
      n('ask', '판단 요청', { v: '기록 없음', vCls: 'un', tip: 'AI 의 판단 요청은 기록(R3)부터 남는다' }),
      n('rep', '보고', { v: '기록 없음', vCls: 'un', tip: 'AI 의 보고는 기록(R3)부터 남는다' }),
      n('chg', '변경', { v: '기록 없음', vCls: 'un', tip: '누가 · 왜 · 전 → 후 는 변경 기록(R2)부터 남는다' }),
      n('val', '점검', { v: '편집 상태에서', vCls: 'un', tip: '검증 70항목은 K3 전까지 편집 상태의 검증 탭에서만 돈다' }),
    ];
  }
  return [
    n('rpt', '계산서', { v: '편집 상태에서', vCls: 'un', tip: '계산서는 K3 전까지 편집 상태의 보고서 탭에서만 만든다' }),
    n('brpt', '좌굴 해석 보고서', { v: '편집 상태에서', vCls: 'un', tip: '좌굴 해석 보고서는 편집 상태의 좌굴해석 탭에서 연다' }),
    n('vtab', '검증표', { v: '편집 상태에서', vCls: 'un', tip: '검증표는 K3 전까지 편집 상태의 검증 탭에서만 만든다' }),
    n('src', '원자료', { v: '기록 없음', vCls: 'un', tip: '원자료(도면 · 제품 자료)는 프로젝트 기록(R1)부터' }),
    n('pub', '발행', { v: '기록 없음', vCls: 'un', tip: '발행은 기록(R5)부터' }),
  ];
}

function lastRun(): Run | undefined { return memberRuns().find(r => r.rows.length || r.overall !== null); }

function designCondNode(): Partial<TNode> {
  const r = lastRun();
  if (!r) { return { v: '검토 결과 없음', vCls: 'un', tip: '설계 조건 입력은 편집 상태의 칸에만 있다(K2). 검토 결과가 있으면 그 검토에 쓴 값을 보인다' }; }
  const us = r.us, s = r.result;
  return { v: String(us.design_method ?? ''), tip: '마지막 검토에 엔진이 쓴 값', kids: [
    n('dc:m', '설계법', { v: String(us.design_method ?? '—') }),
    n('dc:fy', '설계 Fy', { vHtml: num(s?.Fy_used, { src: `${r.src}Fy_used`, kind: 'stress' }) }),
    ...(s?.Fcre_detail ? [n('dc:lb', '비지지 길이 Lb', { vHtml: num(s.Fcre_detail.Lb, { src: `${r.src}Fcre_detail.Lb`, kind: 'length' }) }),
      n('dc:cb', 'Cb', { vHtml: num(s.Fcre_detail.Cb, { src: `${r.src}Fcre_detail.Cb`, kind: 'none', sig: 3 }) })] : []),
  ] };
}

function assumptionsNode(): Partial<TNode> {
  const kids: TNode[] = [];
  if (isDefault('section')) { kids.push(n('asm:sec', '단면 — 프로그램 기본 단면', { tag: '기본값' })); }
  if (isDefault('material')) { kids.push(n('asm:mat', '재료 — 프로그램 기본값', { tag: '기본값' })); }
  if (isDefault('conditions')) { kids.push(n('asm:cond', '해석 조건 — 프로그램 기본값', { tag: '기본값' })); }
  state.runs.forEach(r => r.assumptions.forEach((t, i) => kids.push(n(`asm:${r.key}:${i}`, t, { tip: `${r.label} · 엔진이 밝힌 가정`, v: '엔진' }))));
  return { v: kids.length ? String(kids.length) : '없음', vCls: kids.length ? 'warn' : '', tip: '기본값으로 채운 입력과 엔진이 밝힌 가정. 누가 정했는지는 변경 기록(R2)부터', open: true, kids };
}

// ── 그리기 ────────────────────────────────────────────────────────
export function treeHtml(nodes: TNode[], sel: string, closed: Set<string>, opened: Set<string> = new Set()): string {
  const has = (x: TNode): boolean => x.k === sel || (x.kids ?? []).some(has);
  const row = (x: TNode, d: number): string => {
    const kids = x.kids ?? [];
    const open = kids.length > 0 && !closed.has(x.k) && (x.open || opened.has(x.k) || has(x));
    const v = x.vHtml !== undefined ? `<span class="vl${x.vCls ? ` ${x.vCls}` : ''}">${x.vHtml}</span>`
      : x.v ? `<span class="vl${x.vCls ? ` ${x.vCls}` : ''}">${esc(x.v)}</span>` : '';
    const tag = x.tag ? `<span class="tag def"${tip(x.tag === '자체 가정' ? '기준 조항이 아닌 자체 해석(§A1.2(c)) — 힘 분배 모델' : '아무도 정하지 않아 프로그램이 채웠다')}>${esc(x.tag)}</span>` : '';
    let h = `<div class="row${d === 0 ? ' top' : ''}${x.k === sel ? ' on' : ''}${x.faint ? ' faint' : ''}" role="treeitem" data-k="${esc(x.k)}" style="padding-left:${8 + d * 14}px"${tip(x.tip)}>`
      + `<span class="tw">${kids.length ? (open ? '▾' : '▸') : ''}</span>${x.dot ? `<span class="dot ${x.dot}"></span>` : ''}`
      + `<span class="nm">${esc(x.t)}</span>${tag}${v}</div>`;
    if (open) { h += kids.map(k => row(k, d + 1)).join(''); }
    return h;
  };
  return nodes.map(x => row(x, 0)).join('');
}

/** 키 → 줄(그 탭에서) */
export function findNode(nodes: TNode[], key: string): TNode | undefined {
  for (const x of nodes) {
    if (x.k === key) { return x; }
    const f = findNode(x.kids ?? [], key);
    if (f) { return f; }
  }
  return undefined;
}

/** 그 줄 아래의 모든 키(자신 포함) — 「모두 펼치기 · 접기」 */
export function keysUnder(nodes: TNode[], key: string): string[] {
  const n = findNode(nodes, key);
  const out: string[] = [];
  const walk = (x: TNode) => { out.push(x.k); (x.kids ?? []).forEach(walk); };
  if (n) { walk(n); }
  return out;
}

/** 트리에 보이는 차례의 검토 항목 키(NG → 미검토 → OK → 해당 없음, 그다음 접합) — 다음 · 앞 줄로 */
export function visibleKeys(nodes: TNode[]): string[] {
  const out: string[] = [];
  const walk = (x: TNode) => { out.push(x.k); (x.kids ?? []).forEach(walk); };
  nodes.forEach(walk);
  return out;
}
