/**
 * 기록(R1-2) · 검토 대상의 잠금 — 설계 §2.4.11 · §2.4.12 · §4.2.
 *
 * `<프로젝트>/.stcfsd/locks/<caseId>.lock` = `{schema, caseId, writer, name, host, pid, at, sig}` — 이 PC 의 작성자 열쇠로 서명한다
 * (줄 파일의 `.owner` 와 같은 까닭 — V7-29). 대상을 열 때 `wx` 로 만든다.
 *  - 이미 있으면: 내 서명 · 같은 PC · 같은 pid → 내 것. 내 서명 · 같은 PC · **죽은 pid** → 이 PC 의 지난 실행이 남긴 것 — 지우고 쥔다.
 *    그 밖(다른 PC · 다른 작성자 · 서명 없음 · 읽을 수 없음 · 산 pid)은 **쥐지 않는다** — 그 대상은 읽기 전용으로 열린다.
 *    심은 잠금은 귀찮음뿐이다(사람이 넘겨받는다 — `takeOver`). 지우지도 바꾸지도 않는다(그래서 꾸민 폴더를 열어도 아무것도 쓰지 않는다).
 *  - 다른 PC 의 12 시간 넘은 잠금은 `stale` — 사람만 넘겨받는다.
 *  - 잠금은 확인 · 발행을 막지 않는다(확인은 `.csd` 를 쓰지 않는다).
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { canonicalJson } from './canonical';
import { assertNoLinks, mkdirInside, readBounded, writeAtomic, writeExclusive } from './fsx';
import { DATA_DIR } from './log';
import { cleanHeaderText } from './names';
import { CASE_ID_RE } from './project';
import { verifySig, Writer, WRITER_RE } from './writer';

export const LOCK_DIR = 'locks';
export const LOCK_SCHEMA = 'stcfsd-lock/1';
export const LOCK_STALE_MS = 12 * 60 * 60 * 1000;
const LOCK_PREFIX = 'stcfsd-lock-sig/1\n';

export interface LockInfo { caseId: string; writer: string; name: string; host: string; pid: number; at: string }
export interface LockMe { writer: Writer; name: string; host: string; pid: number; now: string; pidAlive?: (pid: number) => boolean }

export type LockResult =
    | { held: true; info: LockInfo; tookOverOwnStale: boolean }
    | { held: false; by: LockInfo | null; reason: 'held-here' | 'held-elsewhere' | 'held-by-other-writer' | 'unreadable'; stale: boolean };

export function lockPath(rootReal: string, caseId: string): string {
    if (!CASE_ID_RE.test(caseId)) { throw new Error('bad case id'); }
    return path.join(rootReal, DATA_DIR, LOCK_DIR, `${caseId}.lock`);
}

function defaultPidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

function signed(me: LockMe, caseId: string): string {
    const body: LockInfo & { schema: string } = {
        schema: LOCK_SCHEMA, caseId, writer: me.writer.writerId, name: cleanHeaderText(me.name, 60) ?? '', host: cleanHeaderText(me.host, 64) ?? '',
        pid: me.pid, at: me.now,
    };
    return JSON.stringify({ ...body, sig: me.writer.sign(LOCK_PREFIX + canonicalJson(body)) });
}

/** 잠금 파일을 읽는다 — 서명이 `writer` 의 것이면 `mine: true`. 읽을 수 없으면 null */
export function readLock(rootReal: string, caseId: string, writer?: Writer): { info: LockInfo; mine: boolean } | null {
    let buf: Buffer | null;
    try { buf = readBounded(lockPath(rootReal, caseId), 4096); } catch { return null; }
    if (!buf) { return null; }
    let raw: any;
    try { raw = JSON.parse(buf.toString('utf8')); } catch { return null; }
    if (!raw || typeof raw !== 'object' || raw.schema !== LOCK_SCHEMA || raw.caseId !== caseId) { return null; }
    const { sig, ...body } = raw;
    if (typeof body.writer !== 'string' || !WRITER_RE.test(body.writer) || !Number.isSafeInteger(body.pid)) { return null; }
    const info: LockInfo = { caseId, writer: body.writer, name: cleanHeaderText(body.name, 60) ?? '', host: cleanHeaderText(body.host, 64) ?? '',
        pid: body.pid, at: typeof body.at === 'string' ? body.at.slice(0, 40) : '' };
    const mine = !!writer && body.writer === writer.writerId && typeof sig === 'string'
        && verifySig(writer.publicKey, LOCK_PREFIX + canonicalJson(body), sig);
    return { info, mine };
}

function isStale(info: LockInfo, now: string): boolean {
    const t = Date.parse(info.at), n = Date.parse(now);
    return Number.isFinite(t) && Number.isFinite(n) && n - t > LOCK_STALE_MS;
}

/** 대상을 쥔다(규칙은 머리말). 쥐지 못하면 아무것도 쓰지 않는다 */
export function acquireLock(rootReal: string, caseId: string, me: LockMe): LockResult {
    const file = lockPath(rootReal, caseId);
    const alive = me.pidAlive ?? defaultPidAlive;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const cur = (() => { try { fs.lstatSync(file); return true; } catch { return false; } })();
        if (!cur) {
            mkdirInside(rootReal, path.dirname(file));
            try {
                writeExclusive(rootReal, file, signed(me, caseId));
                return { held: true, info: readLock(rootReal, caseId, me.writer)!.info, tookOverOwnStale: attempt > 0 };
            } catch (e: any) { if (e?.code !== 'EEXIST') { throw e; } }
        }
        const got = readLock(rootReal, caseId, me.writer);
        if (!got) { return { held: false, by: null, reason: 'unreadable', stale: false }; }
        const { info, mine } = got;
        if (!mine) { return { held: false, by: info, reason: 'held-by-other-writer', stale: isStale(info, me.now) }; }
        if (info.host !== me.host) { return { held: false, by: info, reason: 'held-elsewhere', stale: isStale(info, me.now) }; }
        if (info.pid === me.pid) { return { held: true, info, tookOverOwnStale: false }; }
        if (alive(info.pid)) { return { held: false, by: info, reason: 'held-here', stale: false }; }
        // 이 PC 의 지난 실행이 남긴 내 잠금 — 지우고 다시
        assertNoLinks(rootReal, file);
        try { fs.unlinkSync(file); } catch { /* 다른 프로세스가 먼저 */ }
    }
    const got = readLock(rootReal, caseId, me.writer);
    return { held: false, by: got?.info ?? null, reason: got ? 'held-here' : 'unreadable', stale: false };
}

/** 놓는다 — 내 것(서명 · 같은 PC · 같은 pid)일 때만 지운다 */
export function releaseLock(rootReal: string, caseId: string, me: Pick<LockMe, 'writer' | 'host' | 'pid'>): boolean {
    const got = readLock(rootReal, caseId, me.writer);
    if (!got || !got.mine || got.info.host !== me.host || got.info.pid !== me.pid) { return false; }
    const file = lockPath(rootReal, caseId);
    assertNoLinks(rootReal, file);
    try { fs.unlinkSync(file); return true; } catch { return false; }
}

/** 사람만 — 남의 잠금을 넘겨받는다(데스크의 `person` 얼굴에서만 부른다) */
export function takeOver(rootReal: string, caseId: string, me: LockMe): LockInfo {
    const file = lockPath(rootReal, caseId);
    mkdirInside(rootReal, path.dirname(file));
    writeAtomic(rootReal, file, signed(me, caseId));
    return readLock(rootReal, caseId, me.writer)!.info;
}
