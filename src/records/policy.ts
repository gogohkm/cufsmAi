/**
 * 기록 · 누가 어느 기록을 쓸 수 있나(V7-23 — 설계 §2.6).
 *
 * 줄의 `actor.kind` 는 서명 안에 있다. 이 표는 두 곳에서 쓴다:
 *  - 쓰기(`RecordLog.append`): 표 밖의 (종류, 사건, 행위자)는 쓰지 않는다 — 코드 길의 실수를 막는다.
 *  - 읽기: 서명은 맞지만 표 밖인 줄은 `refused` — 접기 · 세기에 들지 않는다.
 *
 * **주의 — 서명이 증명하는 것**: 「이 PC 의 StCFSD 프로그램(또는 같은 사용자 권한의 다른 프로세스)이 썼다」 까지다.
 * `actor.kind: 'person'` 은 그 줄을 쓴 코드가 사람의 길이라고 **말한 것**이다 — 사람의 클릭을 증명하지 않는다(설계 §3.5).
 * 사람만 하는 기록(확인 · 발행 · 잠금 넘겨받기 · 보관 · 다시 잇기)은 사람만 하는 경로(R1-3 · R4 · R5 의 다리)에서만 쓴다.
 */
import type { RecordType, ActorKind, LogSpec } from './log';

type Policy = Record<string, readonly ActorKind[]>;

/** (종류 → 사건 → 쓸 수 있는 행위자) */
export const WRITE_POLICY: Record<RecordType, Policy> = {
    cases: {
        create: ['ai', 'person'], import: ['ai', 'person'],
        discovered: ['program'], opened: ['program'], saved: ['program'], external: ['program'],
        relink: ['person'], archive: ['person'], unarchive: ['person'],
        // V9b-04: 손상된 기록의 사람의 길 — 줄 파일을 옆으로(격리) · 줄어든 끝을 받아들임(백업에서 되살림)
        quarantine: ['person'], 'accept-shrunk': ['person'],
    },
    // 변경 줄의 행위자 = 그 변경을 한 쪽(호스트가 대신 쓴다)
    changes: { change: ['ai', 'person', 'program', 'file', 'external'] },
    runs: { run: ['ai', 'person', 'program'], prune: ['program'] },
    work: { add: ['ai'], answer: ['ai'], update: ['ai'], close: ['ai'], reopen: ['ai'] },
    assumptions: { add: ['ai', 'program'], update: ['ai'], close: ['ai', 'program'] },
    sources: { register: ['ai'], update: ['ai'] },
    reviews: { mark: ['person'], unmark: ['person'] },
    // 대안: AI(alternatives 도구) · 사람(화면의 「대안으로 두기」 · 이름 · 숨기기 — person.alternative)
    alternatives: { keep: ['ai', 'person'], rename: ['ai', 'person'], drop: ['ai', 'person'], undrop: ['ai', 'person'] },
    documents: { draft: ['ai', 'person'], export: ['person'], issue: ['person'], 'issue-failed': ['program'] },
};

export function actorAllowed(type: RecordType, event: string, kind: string): boolean {
    const p = WRITE_POLICY[type];
    if (!p || !Object.prototype.hasOwnProperty.call(p, event)) { return false; }
    return (p[event] as readonly string[]).includes(kind);
}

/** 사건 목록(표의 열쇠) */
export function eventsOf(type: RecordType): string[] { return Object.keys(WRITE_POLICY[type]); }

/** 몸을 다듬지 않는 기본 spec(R1-2 이후 종류마다 다듬기를 단다) */
export function plainSpec(type: RecordType): LogSpec { return { type, major: 1, events: eventsOf(type) }; }

/**
 * 발행(사람만 하는 일)을 막는 상태를 무엇이 풀 수 있나 — AI 의 줄(검증된)은 내용을 바꿀 수 있지만 막는 것을 풀지 못한다.
 *  - 가정 「확정」: 사람이 그 판에 확인 표시(`assumptions.blocksIssue`, 결정 D7)
 *  - 판단 요청: 답이 있고 사람이 그 판에 확인 표시(`work.questionBlocksIssue`)
 *  - 검토 항목의 확인 · 발행: 사람의 줄만(reviews · documents.issue)
 */
export const GATE_RULES = {
    assumption: 'person mark on the current version',
    question: 'an answer and a person mark on the current version',
    review: 'person line',
    issue: 'person line',
} as const;
