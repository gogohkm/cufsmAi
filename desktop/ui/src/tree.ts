/**
 * 왼쪽 트리 — 탭 4개(업무 · 모델 · 결과 · 문서). 한 줄에 이름과 오른쪽 끝의 값 · 개수 · 상태만. 고르면 가운데와 오른쪽이 따라온다.
 * 가지는 호스트에 있는 것만 만든다. 호스트에 아직 없는 것(설계 입력 · 기록 · 검증)은 그 까닭을 값 자리에 적는다 — 빈칸이 아니다.
 */
import { esc, tip } from './dom';
import { hhmm, num, ratio } from './format';
import { BC_KO, FAMILY_KO, LOADCASE_KO, sectionLabel } from './names';
import { assumptionLines, isDefault, memberRuns, state, type CheckRow } from './store';
import { blankByAi, branchKids, branchSummary, caseReady, type Branch } from './caseView';
import { caseTag } from './caseFields';
import { si } from './units';
import { reportSummary, valCountsText, valGroups, valLabel } from './checklist';
import { afterBase, BY_KO, chg } from './changes';
import { asm, instructions, openQuestions, questions, reports, srcs, work } from './work';
import { fastenerText, reasonNote } from './notices';

export type Tab = 'work' | 'model' | 'result' | 'doc';
export const TABS: Array<[Tab, string]> = [['work', '업무'], ['model', '모델'], ['result', '결과'], ['doc', '문서']];

export interface TNode {
  k: string; t: string;
  v?: string; vCls?: string; vHtml?: string;
  /** 출처 꼬리표(검토 상태의 sources — caseFields.caseTag) */
  tagHtml?: string;
  dot?: string; tip?: string; faint?: boolean; tag?: string;
  kids?: TNode[]; open?: boolean;
}

const n = (k: string, t: string, o: Partial<TNode> = {}): TNode => ({ k, t, ...o });

const STATE_V: Record<string, [string, string, string]> = {
  ok: ['일치', 'ok', 'ok'], stale: ['낡음', 'warn', 'warn'], none: ['결과 없음', 'un', ''], run: ['해석 중', 'acc', 'acc'], unk: ['결과 있음', '', ''],
};

/** 문서 탭 — 보고서의 상태(만들지 않음 · 초안 · 낡음) */
function docV(kind: 'design' | 'buckling'): Partial<TNode> { const s = reportSummary(kind); return { v: s.v, vCls: s.cls }; }

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
  return n(r.key, `${r.where} · ${r.name}`, {
    dot: r.kind === 'na' ? undefined : dot, vHtml: ratioCell, faint: r.kind === 'na' || !r.counts,
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
        ...(state.lap ? [n('conn:lap', `랩 · ${fastenerText(state.lap.us)}`, { dot: state.lap.us.pass === true ? 'ok' : state.lap.us.pass === false ? 'ng' : 'un', tag: state.lap.us.force_model?.specification_provision === false ? '자체 가정' : undefined,
          vHtml: typeof state.lap.us.utilization === 'number' ? ratio(state.lap.us.utilization, state.lap.us.pass === false, 'lap:utilization') : undefined,
          kids: (state.runs.find(r => r.key === 'lap')?.rows ?? []).filter(passFilter).map(rowNode) })] : []),
        ...(state.conn ? [n('conn:one', `단일 접합 · ${String(state.runs.find(r => r.key === 'conn')?.where.replace(/^접합 · /, '') ?? state.conn.us.connection_type ?? '')}`, { dot: state.conn.us.pass === true ? 'ok' : state.conn.us.pass === false ? 'ng' : 'un',
          vHtml: typeof state.conn.us.utilization === 'number' ? ratio(state.conn.us.utilization, state.conn.us.pass === false, 'conn:utilization') : undefined,
          kids: (state.runs.find(r => r.key === 'conn')?.rows ?? []).filter(passFilter).map(rowNode) })] : []),
      ] } : {}),
      valNode(),
      n('alt', '대안', { v: '기록 없음', vCls: 'un', tip: '단면 대안 비교는 기록(R4)부터 생긴다' }),
    ];
  }
  if (tab === 'work') {
    return [
      // R3-3: 업무 항목(work_items) — 판단 요청(열린 수 · 주황) · 보고 · 지시. 글은 쓴 쪽의 것(자료), 이름 옆에 쓴 쪽
      n('ask', '판단 요청', { v: work.err ? '읽지 못함' : String(openQuestions().length || questions().length), vCls: openQuestions().length ? 'warn' : '', open: true,
        tip: `AI 가 사람에게 묻는 것(work_items question) — 답은 Claude Desktop 대화에서(AI 가 옮겨 적는다). 열린 것 ${openQuestions().length}${workTail()}`,
        kids: questions().map(w => n(`work:${w.item}`, w.title, { dot: w.state === 'closed' ? undefined : w.answered ? 'ok' : 'warn', v: w.state === 'closed' ? '닫힘' : w.answered ? '답함' : '답 기다림',
          vCls: w.answered || w.state === 'closed' ? 'faint' : 'warn', tip: `${w.item} · ${w.written_by} · ${hhmm(w.created_at)}${w.basis_differs_from_now ? ' · 기준과 다름' : ''}` })) }),
      n('rep', '보고', { v: work.err ? '읽지 못함' : String(reports().length), open: true, tip: `AI 의 보고(work_items report) — 항목마다 완료 · 가정 · 미결${workTail()}`,
        kids: reports().map(w => n(`work:${w.item}`, w.title, { v: `${w.items ? `항목 ${w.items} · ` : ''}${hhmm(w.created_at)}`, tip: `${w.item} · ${w.written_by}${w.basis_differs_from_now ? ' · 기준과 다름' : ''}` })) }),
      ...(instructions().length ? [n('ins', '지시', { v: String(instructions().length), tip: '사람의 지시를 AI 가 옮겨 적은 것(work_items instruction) — 변경이 그 지시를 가리킨다',
        kids: instructions().map(w => n(`work:${w.item}`, w.title, { v: hhmm(w.created_at), tip: `${w.item} · ${w.written_by} · AI 가 옮겨 적음` })) })] : []),
      n('chg', '변경', { v: chg.err ? '읽지 못함' : String(chg.total), vCls: chg.err ? 'un' : '', open: true,
        tip: `누가 · 언제 · 전 → 후 — 호스트의 변경 묶음(list_changes). 사람 · AI · 프로그램 · 밖에서가 한 목록(꼬리표로 가른다). 새 것이 위, 마지막 실행 뒤의 것에 점${chg.persisted ? '' : ' · 프로젝트 밖 — 이 세션만(저장되지 않음)'}`,
        kids: chg.list.map(c => n(`chg:${c.id}`, c.title || '(제목 없음)', { dot: afterBase(c) ? 'acc' : undefined, v: `${BY_KO[c.by.kind] ?? c.by.kind} · ${hhmm(c.at)}`,
          tip: `${BY_KO[c.by.kind] ?? c.by.kind}${c.by.client ? ` (${c.by.client})` : ''} · ${hhmm(c.at)} · 바뀐 칸 ${c.fields}${c.invalidated?.length ? ` · 낡게 한 결과 ${c.invalidated.join(', ')}` : ''}${c.reason ? ` · 이유: ${c.reason}` : ''}` })) }),
    ];
  }
  return [
    n('rpt', '계산서', { ...docV('design'), tip: '호스트가 만든 계산서(generate_report) — 열린 .csd 의 폴더 · 없으면 임시 폴더에 쓴다' }),
    n('brpt', '좌굴 해석 보고서', { ...docV('buckling'), tip: '호스트가 만든 좌굴 해석 보고서(generate_report kind buckling)' }),
    n('vtab', '검증표', { v: state.val ? valCountsText(state.val.counts) : '점검 안 함', vCls: state.val ? (state.stages.val.state === 'stale' ? 'warn' : state.val.counts.fail ? 'ng' : '') : 'un', tip: '점검(validate_design)의 항목을 문서 꼴로 — 결과 탭의 점검과 같은 목록' }),
    n('src', '원자료', { v: srcs.err ? '읽지 못함' : String(srcs.items.length), vCls: srcs.items.some(s => s.state !== 'same') ? 'warn' : '', open: true,
      tip: `프로젝트의 01_원자료(sources) — 이름 · 해시 · 상태만, 내용은 읽지 않는다${srcs.unregistered.length ? ` · 등록 안 된 파일 ${srcs.unregistered.length}` : ''}`,
      kids: [...srcs.items.map(s => n(`srcr:${s.item}`, s.title, { dot: s.state === 'same' ? 'ok' : s.state === 'missing' ? 'ng' : 'warn', v: s.state === 'same' ? '같음' : s.state === 'changed' ? '바뀜' : s.state === 'missing' ? '없음' : '모름',
        tip: `${s.item} · ${s.file} · ${s.written_by}` })),
        ...(srcs.unregistered.length ? [n('src:unreg', `등록 안 된 파일 ${srcs.unregistered.length}`, { faint: true, tip: srcs.unregistered.slice(0, 10).join(', ') })] : [])] }),
    n('pub', '발행', { v: '기록 없음', vCls: 'un', tip: '발행은 기록(R5)부터' }),
  ];
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
