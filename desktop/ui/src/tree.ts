/**
 * 왼쪽 트리 — 탭 4개(업무 · 모델 · 결과 · 문서). 한 줄에 이름과 오른쪽 끝의 값 · 개수 · 상태만. 고르면 가운데와 오른쪽이 따라온다.
 * 가지는 호스트에 있는 것만 만든다. 호스트에 아직 없는 것(설계 입력 · 기록 · 검증)은 그 까닭을 값 자리에 적는다 — 빈칸이 아니다.
 */
import { esc, tip } from './dom';
import { hhmm, lengthAssumed, num, ratio, ratioText, sigText } from './format';
import { BC_KO, FAMILY_KO, LOADCASE_KO, sectionLabel } from './names';
import { assumptionLines, isDefault, memberRuns, noFsmRuns, state, type CheckRow, type NoFsm } from './store';
import { blankByAi, branchKids, branchSummary, caseReady, type Branch } from './caseView';
import { caseTag } from './caseFields';
import { si } from './units';
import { reportSummary, valCountsText, valGroups, valLabel } from './checklist';
import { actorOf, actorTag, afterBase, basePointAt, BY_KO, chg, groupName, history, KIND_RESULT_KO, LINK_TIP, linkOf, aroundOf, timeline, whoText, type Change, type Hist } from './changes';
import { glyph, itemOfRow, markOf, rv } from './reviews';
import { alts, visibleAlts } from './alts';
import { asm, instructions, openQuestions, questions, reports, srcs, work } from './work';
import { comboStandard, comboStandardTip, fastenerText, forceModelTag, lengthBoundHtml, reasonNote, utilHtml } from './notices';
import { docs, draftLabel, draftsOf, issueCls, issueLabel } from './docs';
import { dmg } from './damage';

export type Tab = 'work' | 'model' | 'result' | 'doc';
export const TABS: Array<[Tab, string]> = [['work', '업무'], ['model', '모델'], ['result', '결과'], ['doc', '문서']];

export interface TNode {
  k: string; t: string;
  v?: string; vCls?: string; vHtml?: string;
  /** 출처 꼬리표(검토 상태의 sources — caseFields.caseTag) */
  tagHtml?: string;
  dot?: string; tip?: string; faint?: boolean; tag?: string;
  kids?: TNode[]; open?: boolean;
  /** 이름 앞의 HTML(기록 줄의 행위자 배지) */
  preHtml?: string;
  /** 누르면 다른 탭의 그 줄로(`탭|키` — data-ref-go) */
  go?: string;
}

const n = (k: string, t: string, o: Partial<TNode> = {}): TNode => ({ k, t, ...o });

/**
 * E5 — FSM 없이 계산한 부재 검토의 표시(결과 › 부재 검토 · 업무 › 점검 › 판정 요약 · 정보 창). 호스트가 결과에 적은 하중군의 출처(dsm_basis_by_family)가
 * none 인 것만(store.noFsmOf). 없으면 ''. 결정 R1(2026-11-25) 뒤로 호스트는 부재 검토 안에서 설계 Fy 의 S-S 서명곡선 FSM 값을 늘 준비한다 —
 * none 은 그 준비가 안 된 대체(준비 실패)에서만 난다(원형관은 엔진이 DSM 비적용을 밝혀 이 표시를 내지 않는다)
 */
export function noFsmTag(nf: NoFsm | null = noFsmRuns()[0]?.nf ?? null): string {
  if (!nf) { return ''; }
  const label = nf.analytic ? '해석식 좌굴값' : 'FSM 좌굴값 없음';
  const t = nf.analytic
    ? `호스트가 이 검토의 S-S 서명곡선 FSM 값을 준비하지 못해 해석식의 ${nf.syms} 로 계산했다(${nf.fams.join(' · ')} — 호스트의 dsm_basis_by_family: none${nf.sources ? ` · 엔진이 쓴 값: ${nf.sources}` : ''}). 까닭은 경고의 [DSM] 줄`
    : `호스트가 이 검토의 S-S 서명곡선 FSM 값을 준비하지 못했고 엔진도 ${nf.syms} 를 정하지 못했다(${nf.sources}). 까닭은 경고의 [DSM] 줄`;
  return `<span class="tag warn" data-no-fsm="${esc(nf.fams.join(','))}" data-no-fsm-kind="${nf.analytic ? 'analytic' : 'none'}"${tip(t)}>${label}</span>`;
}

const STATE_V: Record<string, [string, string, string]> = {
  ok: ['일치', 'ok', 'ok'], stale: ['낡음', 'warn', 'warn'], none: ['결과 없음', 'un', ''], run: ['해석 중', 'acc', 'acc'], unk: ['결과 있음', '', ''],
};

/** 문서 탭 — 보고서의 상태(만들지 않음 · 초안 · 낡음) */
function docV(kind: 'design' | 'buckling'): Partial<TNode> {
  // R5-3: 프로젝트의 대상이면 호스트의 documents list(초안 — 일치 · 낡음), 아니면 이 화면이 만든 보고서
  if (docs.loaded) {
    const ds = draftsOf(kind === 'design' ? 'calc' : 'buckling');
    // S2: 디스크의 초안 파일이 기록된 해시와 다르면 「고쳐짐」 · 「없어짐」 이 먼저(호스트의 file_state)
    const kids = ds.map(d => { const bad = !!d.file_state && d.file_state !== 'same'; return n(`doc:${d.item}`, draftLabel(d), { dot: !bad && d.state === 'current' ? 'ok' : 'warn',
      v: bad ? (d.file_state === 'missing' ? '없어짐' : '고쳐짐') : d.state === 'current' ? '일치' : '낡음', vCls: !bad && d.state === 'current' ? '' : 'warn',
      tip: `${d.files.join(' · ')}${d.state === 'stale' ? ' — 지금과 다름' : ''}` }); });
    const last = ds[0];
    return last ? { v: last.state === 'current' ? `초안 ${last.item}` : `낡음 · ${last.item}`, vCls: last.state === 'current' ? '' : 'warn', open: true, kids } : { v: '초안 없음', vCls: 'un' };
  }
  const s = reportSummary(kind); return { v: s.v, vCls: s.cls };
}
/** 발행 — 호스트의 documents list(R<n> · 날짜 · 발행한 사람 · 그대로 / 고쳐짐 / 없어짐), 실패한 발행 */
function pubNode(): TNode {
  if (!docs.loaded) { return n('pub', '발행', { v: '프로젝트 밖', vCls: 'un', tip: '발행은 프로젝트의 검토 대상에서만(기록이 있어야 한다)' }); }
  const last = docs.issues[0];
  return n('pub', '발행', { v: last ? `R${last.revision} · ${last.state_ko}` : '아직 없음', vCls: last ? issueCls(last) : 'un', open: true,
    tip: '발행본은 04_발행본 안 — 볼 때마다 목록 파일 · 파일의 해시를 견준다(호스트)',
    kids: [...docs.issues.map(x => n(`iss:${x.item}`, issueLabel(x), { dot: issueCls(x), v: x.state_ko, vCls: x.state === 'same' ? '' : 'warn', tip: `${x.folder}/ · 초안 ${x.from}` })),
      ...docs.failed.map(f => n(`pubf:${String(f.label ?? f.revision)}`, `${String(f.label ?? '')} · 실패한 발행`, { faint: true, v: hhmm(f.at), tip: '세지 않는다 — 다음 발행이 그 폴더를 옮기고 같은 차수를 쓴다' }))] });
}

/** 결과 탭의 점검 — 진행 띠와 같은 상태, 분류마다 수, 항목마다 호스트의 판정 */
function valNode(): TNode {
  const v = state.val;
  const stale = state.stages.val.state === 'stale';
  return stageNode('val', '점검', 'val', v ? {
    v: `${stale ? '낡음 · ' : ''}${valCountsText(v.counts)}`, vCls: stale ? 'warn' : v.counts.fail ? 'ng' : v.counts.warn ? 'un' : 'ok', dot: stale ? 'warn' : v.counts.fail ? 'ng' : v.counts.warn ? 'warn' : 'ok',
    open: true,
    kids: valGroups().map(g => n(`val:cat:${g.idx}`, g.cat, { v: valCountsText(g.counts), vCls: g.counts.fail ? 'ng' : g.counts.warn ? 'un' : '', open: !!(g.counts.fail || g.counts.warn),
      kids: g.items.map(({ it, key }) => n(key, it.item, { dot: it.status === 'pass' ? 'ok' : it.status === 'fail' ? 'ng' : 'warn', v: valLabel(it.status), vCls: it.status === 'fail' ? 'ng' : it.status === 'warn' ? 'un' : 'faint', tip: it.note || it.criterion })) })),
  } : {});
}

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
  // R4-2: 확인 표시 ✓ · ◌(호스트의 get_reviews — 그 줄의 항목)
  const g = rv.loaded ? glyph(itemOfRow(r)) : '';
  return n(r.key, `${r.where} · ${r.name}`, {
    dot: r.kind === 'na' ? undefined : dot, vHtml: ratioCell, faint: r.kind === 'na' || !r.counts, ...(g ? { tagHtml: g } : {}),
    tip: r.kind === 'ne' ? `엔진이 평가하지 못한 항목 — 합격이 아니다: ${reasonNote(r.us)?.text ?? r.name}`
      : r.kind === 'na' ? `해당 없음: ${reasonNote(r.us)?.text ?? ''}` : !r.counts ? '적용 조건 — 판정에 들지 않는다(counts: false)' : `${r.id} · §${r.clause}`,
  });
}

const workTail = (): string => `${work.othersOmitted ? ` · 다른 작성자의 항목 ${work.othersOmitted}(빼고 보인다)` : ''}${work.unverified ? ` · 세지 않은 줄 ${work.unverified}` : ''}`;

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
        ...caseKidNodes('mat'),
        n('mFyRef', '해석 기준 응력', { vHtml: typeof f?.load_fy === 'number' ? num(si(f.load_fy, 'stress'), { src: 'full:load_fy', kind: 'stress' }) : '<span class="vl un">없음</span>',
          tagHtml: refStressTag(), tip: '좌굴 해석의 기준 응력(get_full_state.load_fy) — 설계 Fy 와 다르다' }),
      ] }),
      n('cond', '해석 조건', { v: f ? (BC_KO[f.BC] ?? f.BC) : '', kids: [
        n('cBC', '경계조건', { v: f ? `${f.BC} · ${BC_KO[f.BC] ?? ''}` : '' }),
        n('cLc', '하중 경우', { v: f?.load_case ? (LOADCASE_KO[f.load_case] ?? f.load_case) : '정하지 않음', vCls: f?.load_case ? '' : 'un',
          tip: 'MCP get_status 의 load_case · load_fy(K4a)' }),
        n('cLen', '반파장', { vHtml: nlen ? `${num(nlen.n, { src: 'full:lengths.n', kind: 'none' })}점` : '<span class="vl un">없음</span>' }),
        n('cStr', '절점 응력', { vHtml: f ? `${num(si(f.stress?.min, 'stress'), { src: 'full:stress.min', kind: 'stress', unit: false })} ~ ${num(si(f.stress?.max, 'stress'), { src: 'full:stress.max', kind: 'stress' })}` : '' }),
      ] }),
      caseBranch('mem', '부재'),
      caseBranch('ld', '하중'),
      caseBranch('dc', '설계 조건'),
      caseBranch('cj', '접합부'),
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
        ...((c) => (c ? [n('load:std', '조합 기준', { v: c.edition, tip: comboStandardTip(c) })] : []))(comboStandard(state.loads.us)),
        n('load:gov', '지배 조합', { v: String(state.loads.us.governing?.combo ?? '') }),
        n('load:loc', '위치', { v: String((state.loads.us.governing?.locations ?? []).length) }),
        n('load:def', '처짐', { vHtml: (state.loads.si.deflection?.per_span ?? []).map((d: any, i: number) => `L/${num(d.L_over_delta, { src: `loads:deflection.per_span.${i}.L_over_delta`, kind: 'none' })}`).join(' · ') || '<span class="vl un">없음</span>' }),
      ], tip: state.loads.from === 'purlin' ? '퍼린 설계가 함께 돌린 하중 해석' : '마지막 하중 해석' } : {}),
      n('chk', '부재 검토', {
        v: chkStage.state === 'ok' ? `NG ${ng.length} · 미검토 ${un.length} · OK ${ok.length}${rv.loaded ? ` · 확인 ${rv.reviewed}/${rv.total}${rv.again ? ` · 다시 확인 ${rv.again}` : ''}` : ''}` : STATE_V[chkStage.state][0],
        vCls: chkStage.state === 'ok' ? (ng.length ? 'ng' : un.length ? 'un' : 'ok') : STATE_V[chkStage.state][1],
        dot: chkStage.state === 'stale' ? 'warn' : undefined, tip: chkStage.state === 'ok' ? '판정 차례: NG > 미검토 > OK. 미검토는 합격이 아니다' : chkStage.note,
        ...(chkStage.state === 'ok' && noFsmRuns().length ? { tagHtml: noFsmTag() } : {}),
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
        ...(state.lap ? [n('conn:lap', `랩 · ${fastenerText(state.lap.us)}`, { dot: state.lap.us.pass === true ? 'ok' : state.lap.us.pass === false ? 'ng' : 'un', tagHtml: forceModelTag(state.lap.us, true) || undefined,
          vHtml: utilHtml(state.lap.us, state.lap.us.utilization, 'lap:utilization') || undefined,
          kids: (state.runs.find(r => r.key === 'lap')?.rows ?? []).filter(passFilter).map(rowNode) })] : []),
        ...(state.conn ? [n('conn:one', `단일 접합 · ${String(state.runs.find(r => r.key === 'conn')?.where.replace(/^접합 · /, '') ?? state.conn.us.connection_type ?? '')}`, { dot: state.conn.us.pass === true ? 'ok' : state.conn.us.pass === false ? 'ng' : 'un',
          vHtml: utilHtml(state.conn.us, state.conn.us.utilization, 'conn:utilization') || undefined,
          kids: (state.runs.find(r => r.key === 'conn')?.rows ?? []).filter(passFilter).map(rowNode) })] : []),
      ] } : {}),
      valNode(),
      // R4-3: 대안(alternatives list) — 라벨(AI 의 글) · 최대 판정비 · 「지금」. 프로그램은 순위를 짓지 않는다
      n('alt', '대안', { v: alts.err ? '읽지 못함' : String(visibleAlts().length), open: true, tip: '실행 묶음에 붙인 이름(대안) — 고르면 검토 열쇠마다 지금 | 대안. 「이 대안으로」는 변경 묶음 하나',
        kids: visibleAlts().map(a => n(`alt:${a.item}`, a.label, { faint: !!a.hidden, vHtml: `${typeof a.max_ratio === 'number' ? `<span class="num${a.pass === false ? ' ng' : ''}">${ratioText(a.max_ratio, a.pass === false)}</span>` : '<span class="vl faint">—</span>'}${a.is_now ? ' <span class="tag">지금</span>' : ''}`,
          tip: `${a.item} · ${a.written_by} · 실행 ${a.runs.join(', ')}` })) }),
    ];
  }
  if (tab === 'work') { return workTree(); }
  return [
    n('rpt', '계산서', { ...docV('design'), tip: '호스트가 만든 계산서(generate_report) — 열린 .csd 의 폴더 · 없으면 임시 폴더에 쓴다' }),
    n('brpt', '좌굴 해석 보고서', { ...docV('buckling'), tip: '호스트가 만든 좌굴 해석 보고서(generate_report kind buckling)' }),
    n('vtab', '검증표', { v: state.val ? valCountsText(state.val.counts) : '점검 안 함', vCls: state.val ? (state.stages.val.state === 'stale' ? 'warn' : state.val.counts.fail ? 'ng' : '') : 'un', tip: '점검(validate_design)의 항목을 문서 꼴로 — 결과 탭의 점검과 같은 목록' }),
    n('src', '원자료', { v: srcs.err ? '읽지 못함' : String(srcs.items.length), vCls: srcs.items.some(s => s.state !== 'same') ? 'warn' : '', open: true,
      tip: `프로젝트의 01_원자료(sources) — 이름 · 해시 · 상태만, 내용은 읽지 않는다${srcs.unregistered.length ? ` · 등록 안 된 파일 ${srcs.unregistered.length}` : ''}`,
      kids: [...srcs.items.map(s => n(`srcr:${s.item}`, s.title, { dot: s.state === 'same' ? 'ok' : s.state === 'missing' ? 'ng' : 'warn', v: s.state === 'same' ? '같음' : s.state === 'changed' ? '바뀜' : s.state === 'missing' ? '없음' : '모름',
        tip: `${s.item} · ${s.file} · ${s.written_by}` })),
        ...(srcs.unregistered.length ? [n('src:unreg', `등록 안 된 파일 ${srcs.unregistered.length}`, { faint: true, tip: srcs.unregistered.slice(0, 10).join(', ') })] : [])] }),
    // V9b-04 · D1: 기록 손상 — 있을 때만(풀 때까지 발행이 막힌다)
    ...(dmg.items.length ? [n('dmg', '기록 손상', { dot: 'ng', v: `줄 파일 ${dmg.items.length}`, vCls: 'ng', tip: '믿는 작성자의 손상된 기록 줄 파일 — 격리 · 받아들이기(사람만)' })] : []),
    pubNode(),
  ];
}

// ── 업무 탭 — 할 일 · 기록 · 점검(통일안 6.2) ───────────────────────────
const r3 = (v: unknown): string => (typeof v === 'number' ? sigText(v, 3) : '—');
/** 기록 한 줄 — [행위자 배지] 제목 … 시각 [판정 변화] [✓ 확인](통일안 6.4). 판정 변화는 그 묶음 앞의 마지막 실행 → 뒤의 첫 실행(호스트의 실행 이력) */
function chgNode(c: Change): TNode {
  const hist = history();
  const ar = aroundOf(c);
  const delta = ar.after ? `${r3(ar.before?.max_ratio)}→${r3(ar.after.max_ratio)}`
    : hist ? (ar.anyAfter ? '' : '다시 계산 필요') : basePointAt() && afterBase(c) && !c.runs?.length ? '다시 계산 필요' : '';
  const g = rv.loaded ? glyph(markOf('change', c.id)) : '';
  return n(`chg:${c.id}`, c.title || '(제목 없음)', {
    preHtml: actorTag(c),
    vHtml: `<span class="faint">${esc(hhmm(c.at))}</span>${delta ? ` <span class="${ar.after ? 'num' : 'warn'}" data-delta${tip(ar.after ? '그 묶음 앞의 마지막 실행 → 뒤의 첫 실행의 최대 판정비(호스트의 실행 이력)' : '이 묶음 뒤에 계산하지 않았다')}>${esc(delta)}</span>` : ''}${g ? ` ${g}` : ''}`,
    tip: `${whoText(c)}${linkOf(c) ? ` — ${LINK_TIP}` : ''}${c.by.client ? ` (${c.by.client})` : ''} · ${hhmm(c.at)} · 바뀐 칸 ${c.fields}${c.invalidated?.length ? ` · 낡게 한 결과 ${c.invalidated.join(', ')}` : ''}${c.reason ? ` · 이유: ${c.reason}` : ''}`,
  });
}
/** 계산 머리줄의 판정 — 「OK 0.809」(엔진의 판정 · 최대 판정비 그대로) */
function runVerdictHtml(v: Hist | null): string {
  if (!v) { return '<span class="vl faint">판정 없음</span>'; }
  const t = v.pass === true ? 'OK' : v.pass === false ? 'NG' : '판정 없음';
  const cls = v.pass === true ? 'ok' : v.pass === false ? 'ng' : 'un';
  return `<span class="verdict ${cls}" style="font-weight:400" data-run-verdict="${v.pass === true ? 'ok' : v.pass === false ? 'ng' : 'none'}">${t}</span>${typeof v.max_ratio === 'number' ? ` <span class="num">${esc(ratioText(v.max_ratio, v.pass === false))}</span>` : ''}`;
}
function workTree(): TNode[] {
  const f = state.full;
  // 프로젝트 밖(파일만 열었거나 아무것도 열지 않았다) — 판단 요청 · 보고 · 가정은 프로젝트의 검토 대상에만 남는다(호스트가 AI 의 work_items 를 거절한다).
  // 「0」 이 아니라 그 까닭을 값 자리에 적는다(빈 목록이 「AI 가 아무것도 하지 않았다」 로 읽히지 않게). 변경은 프로젝트 밖에서도 이 세션 동안 보인다
  const outside = !!f && !f.project?.inProject;
  const outsideTip = '프로젝트 밖 — 판단 요청 · 보고 · 가정은 프로젝트의 검토 대상에만 남는다(프로젝트 밖에서는 AI 가 쓸 수 없다). 시작 화면에서 프로젝트를 만들거나 「프로젝트로 만들기」. AI · 사람이 바꾼 것은 아래 「기록」 에 이 세션 동안 보인다';
  const OUT = { v: '프로젝트 밖', vCls: 'un', tip: outsideTip };
  // 할 일 — 사람이 처리할 것
  const oq = openQuestions();
  const waiting = rv.loaded ? chg.list.filter(c => actorOf(c) === 'ai' && markOf('change', c.id)?.state !== 'reviewed') : [];
  const prov = asm.items.filter(a => !a.closed && a.status === 'provisional');
  const nTodo = outside ? 0 : oq.length + waiting.length + prov.length;
  const todo = n('todo', '할 일', {
    v: outside ? '프로젝트 밖' : String(nTodo), vCls: outside ? 'un' : nTodo ? 'ng' : '', dot: nTodo ? 'ng' : undefined, open: true,
    tip: outside ? outsideTip : '사람이 처리할 것 — 답을 기다리는 판단 요청 · AI 가 바꾼 것 가운데 확인 표시가 없는 묶음 · 확정 안 된 임시 가정',
    kids: [
      n('ask', '판단 요청', outside ? OUT : { v: work.err ? '읽지 못함' : String(oq.length), vCls: oq.length ? 'warn' : '', open: true,
        tip: `AI 가 사람에게 묻는 것(work_items question) — 답은 Claude Desktop 대화에서(AI 가 옮겨 적는다). 답한 · 닫힌 것은 기록의 「지난 판단 요청」${workTail()}`,
        kids: oq.map(w => n(`work:${w.item}`, w.title, { dot: 'warn', v: '답 기다림', vCls: 'warn', tip: `${w.item} · ${w.written_by} · ${hhmm(w.created_at)}${w.basis_differs_from_now ? ' · 기준과 다름' : ''}` })) }),
      n('todo:rv', '확인 대기', outside || !rv.loaded ? { ...OUT, ...(outside ? {} : { v: '읽는 중', tip: '확인 표시(get_reviews)를 읽는 중' }) } : { v: String(waiting.length), vCls: waiting.length ? 'warn' : '', open: true,
        tip: 'AI 가 바꾼 묶음 가운데 사람의 확인 표시가 없는 것(호스트의 get_reviews) — 사람 · 프로그램 · 파일의 묶음은 넣지 않는다', kids: waiting.map(chgNode) }),
      n('todo:asm', '임시 가정', outside ? OUT : { v: asm.err ? '읽지 못함' : String(prov.length), vCls: prov.length ? 'warn' : '', open: true,
        tip: '가정 등록부(assumptions)에서 닫히지 않은 임시 가정 — 사람의 확인 전까지 발행을 막는다',
        kids: prov.map(a => n(`asmr:${a.item}`, `${a.item} ${a.text}`, { tagHtml: `<span class="tag def">임시</span>`, v: a.written_by.startsWith('program') ? '프로그램' : a.written_by.startsWith('ai') ? 'AI' : a.written_by, tip: `${a.item} · ${a.written_by} · 발행 ${a.blocks_issue ? '막음' : '막지 않음'}` })) }),
    ],
  });
  // 기록 — 시간순(새 것이 위). 실행 하나 = 접히는 머리줄, 그 아래에 그 계산에 들어간 묶음
  const tl = timeline();
  const pend = tl.after.filter(c => actorOf(c) !== 'program').length;
  const based = tl.hasRuns || !!basePointAt();
  const after = n('log:after', based ? '지난 계산 뒤' : '아직 계산 없음', { v: String(tl.after.length), vCls: pend ? 'warn' : '', open: true,
    tip: based ? `마지막 실행 뒤의 묶음 — 다시 계산해야 하는 것 ${pend}(프로그램의 연동 줄은 세지 않는다)` : '이 대상에 실행이 없다', kids: tl.after.map(chgNode) });
  // 실행 하나 = 머리줄 하나(E6). 묶음이 없는 실행은 아래 줄 없는 한 줄 「계산 #n (입력 변경 없음)」
  // 펼쳐 두는 것 — 묶음이 있는 머리줄 가운데 새 것 셋(묶음 없는 머리줄은 아래 줄이 없다 — 그것이 최근 묶음을 접어 버리지 않게)
  const openKeys = new Set(tl.groups.filter(g => g.changes.length).slice(0, 3).map(g => g.key));
  const runNodes = tl.groups.map(g => n(g.key, groupName(g), { vHtml: runVerdictHtml(g.verdict), open: openKeys.has(g.key),
    tip: `${KIND_RESULT_KO[g.head.kind] ?? g.head.kind} · ${hhmm(g.head.at)}${g.head.by ? ` · ${BY_KO[g.head.by] ?? g.head.by}` : ''} — ${g.changes.length ? `그 아래는 이 계산에 처음 들어간 묶음 ${g.changes.length}(앞 계산 뒤 ~ 이 계산 앞)` : '앞 계산 뒤에 바뀐 입력이 없다'}${g.verdict?.governing?.id ? ` · 지배 ${g.verdict.governing.id}` : ''}`,
    kids: g.changes.length ? g.changes.map(chgNode) : undefined }));
  const before = tl.before.length ? [n('log:before', tl.hasRuns ? '계산 기록 앞' : '그 앞', { v: String(tl.before.length), open: !tl.hasRuns,
    tip: tl.hasRuns ? '실행 이력(새 것부터 20)의 가장 오래된 실행 앞의 묶음' : '지난 계산 앞의 묶음', kids: tl.before.map(chgNode) })] : [];
  const pastQ = questions().filter(w => w.state === 'closed' || w.answered);
  const log = n('chg', '기록', { v: chg.err ? '읽지 못함' : `${chg.total}${chg.persisted || !chg.total ? '' : ' · 이 세션만'}`, vCls: chg.err ? 'un' : '', open: true,
    tip: `누가 · 언제 · 전 → 후 — 호스트의 변경 묶음(list_changes)을 실행(get_case_status 의 history)으로 접는다. 새 것이 위${chg.persisted ? '' : ' · 프로젝트 밖 — 이 세션만(저장되지 않음)'}`,
    kids: [after, ...runNodes, ...before,
      ...(instructions().length ? [n('ins', '지시', { v: String(instructions().length), tip: '사람의 지시를 AI 가 옮겨 적은 것(work_items instruction) — 변경이 그 지시를 가리킨다',
        kids: instructions().map(w => n(`work:${w.item}`, w.title, { v: hhmm(w.created_at), tip: `${w.item} · ${w.written_by} · AI 가 옮겨 적음` })) })] : []),
      ...(pastQ.length ? [n('ask:done', '지난 판단 요청', { v: String(pastQ.length), tip: '답한 · 닫힌 판단 요청',
        kids: pastQ.map(w => n(`work:${w.item}`, w.title, { dot: w.state === 'closed' ? undefined : 'ok', v: w.state === 'closed' ? '닫힘' : '답함', vCls: 'faint', tip: `${w.item} · ${w.written_by} · ${hhmm(w.created_at)}` })) })] : [])] });
  // 점검 — 지금 결과의 상태(결과 탭의 부재 검토 · 가정과 같은 수). 누르면 그 줄로
  const runs = memberRuns();
  const rows = runs.flatMap(r => r.rows);
  const un = rows.filter(r => r.kind === 'ne').length;
  const gov = runs.filter(r => typeof r.utilization === 'number').sort((a, b) => (b.utilization as number) - (a.utilization as number))[0] ?? null;
  const chkOk = state.stages.chk.state === 'ok';
  const nWarn = state.runs.reduce((a, r) => a + r.warnings.length, 0);
  const nOut = runs.reduce((a, r) => a + r.notChecked.length, 0);
  const asmV = assumptionsNode().v ?? '없음';
  const insp = n('insp', '점검', { open: true, tip: '지금 결과의 상태 — 결과 탭 · 모델 탭의 그 줄과 같은 수', kids: [
    n('insp:sum', '판정 요약', { go: 'result|chk', vHtml: chkOk && runs.length ? `${gov?.governing ? `지배 ${esc(gov.governing)} · ` : ''}최대 ${typeof gov?.utilization === 'number' ? (gov.bound ? lengthBoundHtml(gov.us, gov.bound, `${gov.src}${gov.utilPath}`, gov.utilRef) : ratio(gov.utilization, gov.overall === false, `${gov.src}utilization`)) : ((inv) => (inv ? utilHtml(inv.us, inv.result?.utilization, `${inv.src}utilization`, '—') : '—'))(runs.find(r => r.utilInvalid || lengthAssumed(r.us)))} · <span class="${un ? 'un' : ''}">미검토 ${un}</span>` : `<span class="vl un">${esc(STATE_V[state.stages.chk.state][0])}</span>`,
      ...(chkOk && noFsmRuns().length ? { tagHtml: noFsmTag() } : {}),
      tip: '지배 항목 · 최대 판정비(엔진) · 미검토 수(결과 탭의 부재 검토와 같은 수) — 누르면 결과 › 부재 검토' }),
    n('insp:warn', '엔진 알림', { go: 'result|chk', v: String(nWarn), vCls: nWarn ? 'warn' : '', tip: '엔진이 낸 경고(warnings) — 누르면 결과 › 부재 검토(정보 창의 경고)' }),
    n('insp:asm', '가정', { go: 'model|asm', v: asmV, tip: '기본값으로 채운 입력 · 엔진이 밝힌 가정 · 가정 등록부 — 누르면 모델 › 가정' }),
    n('insp:out', '범위 밖', { go: nOut ? 'result|chk:OUT' : 'result|chk', v: String(nOut), tip: '엔진이 이 검토의 범위 밖으로 둔 것(not_checked) — 누르면 결과 › 부재 검토의 범위 밖' }),
    n('rep', '보고', outside ? OUT : { v: work.err ? '읽지 못함' : `${reports().length}${reports().length ? ` · ${reports().filter(w => markOf('work', w.item)?.state !== 'reviewed').length} 미확인` : ''}`, open: true, tip: `AI 의 보고(work_items report) — 한 것 · 가정한 것 · 남은 것${workTail()}`,
      kids: reports().map(w => n(`work:${w.item}`, w.title, { v: `${w.items ? `항목 ${w.items} · ` : ''}${hhmm(w.created_at)}`, tip: `${w.item} · ${w.written_by}${w.basis_differs_from_now ? ' · 기준과 다름' : ''}` })) }),
  ] });
  return [todo, log, insp];
}

/** 검토 상태(K2 — get_case_inputs)의 가지 하나: 값 · 출처 꼬리표 */
function caseKidNodes(b: Branch): TNode[] {
  return branchKids(b).map(k => n(k.k, k.t, { vHtml: k.vHtml, tagHtml: k.src ? caseTag(k.src, blankByAi(k.k.slice(5))) : undefined }));
}
function caseBranch(b: Branch, t: string): TNode {
  if (!caseReady()) { return n(b, t, { v: '읽는 중', vCls: 'un', tip: state.caseErr ? `검토 상태를 읽지 못함 — ${state.caseErr}` : '호스트의 검토 상태(get_case_inputs)를 읽는 중' }); }
  return n(b, t, { v: branchSummary(b), tip: '호스트의 검토 상태(MCP get_case_inputs 와 같은 값). 고치는 곳은 편집 상태(F2)의 설계 화면', kids: caseKidNodes(b) });
}
/** 해석 기준 응력의 출처 — AI 가 set_load_case 로 정했으면 AI(모델 메시지의 loadFySource — K2 결정 3) */
function refStressTag(): string | undefined {
  const src = state.model?.loadFySource;
  return src === 'ai' ? caseTag('ai') : undefined;
}


function assumptionsNode(): Partial<TNode> {
  const kids: TNode[] = [];
  if (isDefault('section')) { kids.push(n('asm:sec', '단면 — 프로그램 기본 단면', { tag: '기본값' })); }
  if (isDefault('material')) { kids.push(n('asm:mat', '재료 — 프로그램 기본값', { tag: '기본값' })); }
  if (isDefault('conditions')) { kids.push(n('asm:cond', '해석 조건 — 프로그램 기본값', { tag: '기본값' })); }
  // 줄마다 어느 결과 · 구간 · 검토 지점의 것인지 앞에 적는다(글은 엔진이 쓴 그대로)
  assumptionLines().forEach(a => kids.push(n(a.key, `${a.where} — ${a.text}`, { tip: `${a.where} · 엔진이 밝힌 가정 — ${a.text}`, v: '엔진' })));
  // R3-3: 가정 등록부(assumptions) — 줄마다 상태(임시 · 확정 · 현장 확인 · 해당 없음) · 쓴 쪽(프로그램의 자동 가정 · AI). 사람의 확인은 R4 부터(늘 없음)
  const reg = asm.items.map(a => n(`asmr:${a.item}`, `${a.item} ${a.text}`, { faint: a.closed, tagHtml: a.closed ? undefined : a.status === 'provisional' ? `<span class="tag def"${tip('임시 가정 — 사람의 확인 전까지 발행을 막는다')}>임시</span>` : a.status === 'field-check' ? `<span class="tag def"${tip('현장 확인이 필요한 가정')}>현장 확인</span>` : undefined,
    v: a.closed ? '닫힘' : a.written_by.startsWith('program') ? '프로그램' : a.written_by.startsWith('ai') ? 'AI' : a.written_by, tip: `${a.item} · ${a.written_by} · 발행 ${a.blocks_issue ? '막음' : '막지 않음'} · 사람의 확인 없음(R4 부터)` }));
  const all = [...(reg.length ? [n('asm:reg', '가정 등록부', { v: String(asm.items.filter(a => !a.closed).length), open: true, tip: '기록의 가정(assumptions) — 프로그램 · AI 가 쓴 것', kids: reg })] : []), ...kids];
  return { v: all.length ? String(asm.items.filter(a => !a.closed).length + kids.length) : '없음', vCls: all.length ? 'warn' : '', tip: '기본값으로 채운 입력 · 엔진이 밝힌 가정 · 가정 등록부', open: true, kids: all };
}

// ── 그리기 ────────────────────────────────────────────────────────
export function treeHtml(nodes: TNode[], sel: string, closed: Set<string>, opened: Set<string> = new Set()): string {
  const has = (x: TNode): boolean => x.k === sel || (x.kids ?? []).some(has);
  const row = (x: TNode, d: number): string => {
    const kids = x.kids ?? [];
    const open = kids.length > 0 && !closed.has(x.k) && (x.open || opened.has(x.k) || has(x));
    const v = x.vHtml !== undefined ? `<span class="vl${x.vCls ? ` ${x.vCls}` : ''}">${x.vHtml}</span>`
      : x.v ? `<span class="vl${x.vCls ? ` ${x.vCls}` : ''}">${esc(x.v)}</span>` : '';
    const tag = x.tagHtml ?? (x.tag ? `<span class="tag def"${tip(x.tag === '자체 가정' ? '기준 조항이 아닌 자체 해석(§A1.2(c)) — 힘 분배 모델' : '아무도 정하지 않아 프로그램이 채웠다')}>${esc(x.tag)}</span>` : '');
    let h = `<div class="row${d === 0 ? ' top' : ''}${x.k === sel ? ' on' : ''}${x.faint ? ' faint' : ''}" role="treeitem" data-k="${esc(x.k)}"${x.go ? ` data-ref-go="${esc(x.go)}"` : ''} style="padding-left:${8 + d * 14}px"${tip(x.tip)}>`
      + `<span class="tw">${kids.length ? (open ? '▾' : '▸') : ''}</span>${x.dot ? `<span class="dot ${x.dot}"></span>` : ''}`
      + `${x.preHtml ?? ''}<span class="nm">${esc(x.t)}</span>${tag}${v}</div>`;
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
