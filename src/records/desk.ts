/**
 * 기록(R1-2) · 데스크 — 순수 모듈과 패널 사이의 상태 층(설계 §3.1 `desk.ts`, §2.4.2 · 2.4.3 · 2.4.11 · 2.4.12 · 2.5 · 3.5).
 *
 * 패널은 한 줄씩 부른다(2 걸음): 열기 뒤 `afterOpen`, 쓰기 앞 `beforeSave` · 뒤 `afterSave`, 결과를 받는 자리 `onRun`, 상태 `status` ·
 * `caseStatus`, `.csd` 의 `record` 키 `recordKey`. MCP 의 기록 도구는 `listProjects` · `openProject` · `listCases` · `openCase` ·
 * `newCase` 를 부른다. **사람만 하는 일**(폴더 열기 · 프로젝트 만들기(사람) · 잠금 넘겨받기 · 보관)은 `person` 얼굴에만 있고,
 * MCP 문맥 안에서 부르면 던진다(§3.5 층 6 — 문맥은 `currentContext` 로 주입).
 *
 * 규칙:
 *  - 모든 것은 주입된다: 열쇠 자리, 뿌리 · 최근 · 보호 폴더, 시계, 엔진 id, 파일 읽기 · 새 파일 쓰기, pid 살았나. 이 모듈은 사용자 폴더를
 *    스스로 고르지 않는다(사용자 · 설정 폴더를 환경에서 읽지 않는다 — 열쇠 자리는 호스트가 정해 넘긴다).
 *  - **프로젝트가 없으면 아무 일도 하지 않는다**(쓰지 않는다 — 지금의 길 그대로).
 *  - 읽기 전용으로 여는 경우(발행본 · 남이 쥔 잠금 · 읽을 수 없는 잠금 · 높은 주 판 · 하드 링크 · 보호 폴더 안 · 열쇠를 쓸 수 없음)에는
 *    **어디에도 쓰지 않는다** — 꾸민 프로젝트 폴더를 열어도 파일이 생기거나 바뀌지 않는다.
 *  - 쓰는 자리는 프로젝트 뿌리 + 상수(`.stcfsd/…` · `02_검토대상/`) + 이름 규칙을 지난 이름뿐(선언 · 줄 · 색인에서 읽은 경로를 쓰지 않는다).
 *  - 저장 전 대조(프로젝트에서만): 지금 디스크의 `.csd` 가 열 때 · 마지막 저장 때의 바이트와 다르면 쓰지 않는다.
 *  - AI 에게 가는 답에는 절대 경로가 없다(`abs` 는 패널에만 — 그 함수의 답 꼴을 보라).
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './canonical';
import { CaseEntry, CASES_SPEC, caseFileOk, foldCases, lastKnown } from './cases';
import { readIndex, summarizeCsd, writeIndex, CSD_MAX_BYTES } from './caseIndex';
import { ActorContext, isMcpContext, toActor } from './context';
import { contentFp, normalizeEngineId, requestFp, resultFp } from './fp';
import { assertNoLinks, assertSingleLink, mkdirInside, projectRelative, readBounded, realRoot, RecordsPathError, writeExclusive } from './fsx';
import { acquireLock, LockInfo, LockResult, readLock, releaseLock, takeOver } from './locks';
/** 열쇠 자리의 작성자 이름 파일 */
export const WRITER_NAME_FILE = 'writer-name.json';
import { DATA_DIR, ReadBudget, ReadResult, RecordLine, RecordLog, RecordType, Actor, LogSpec } from './log';
import { checkName, cleanHeaderText, nameKey } from './names';
import { plainSpec } from './policy';
import {
    caseFileFor, createProject, Declaration, findProjectByName, findProjectFor as findProjectDirFor, FOLDERS, newId, readDeclaration,
    CASE_ID_RE, DECLARATION_FILE,
} from './project';
import { foldRuns, lastRunByKind, RunEntry, RunKind, RUN_KINDS, runSummary, RUNS_SPEC } from './runs';
import { getBlob, putBlob } from './blobs';
import { Assumption, ASSUMPTION_SPEC, foldAssumptions, prepareAssumption } from './assumptions';
import { WORK_SPEC, foldWork, prepareWork, WorkItem } from './work';
import { foldSources, listUnregistered, prepareSource, Source, SOURCE_SPEC, sourceState } from './sources';
import { KeyUnavailableError, loadOrCreateWriter, makeWriterCard, readTrust, readWriterCard, trustSelf, TrustStore, Writer, WriterCard } from './writer';

/** 데스크가 받는 것 — 모두 주입(시험은 임시 폴더와 가짜 시계로) */
export interface DeskEnv {
    /** 작성자 열쇠 · 믿음 · `seen/` 의 자리(제품: 호스트가 writer 모듈의 기본 자리를 넘긴다; 시험: 임시 폴더) */
    keyDir: string;
    /** 사람이 고른 프로젝트 뿌리(제품: 문서\StCFSD 프로젝트). AI 는 이 아래와 최근 목록의 **이름**으로만 고른다 */
    roots(): string[];
    /** 사람이 「폴더에서 열기」로 연 프로젝트 폴더(최근 — 절대 경로, AI 에게는 이름만) */
    recentProjects?(): string[];
    /** 프로젝트를 두지 않는 폴더(시스템 · 프로그램 · 앱 설정 — 진짜 경로). 그 안의 프로젝트는 열지 않는다 */
    protectedRoots?(): string[];
    /** 보호 폴더 안이지만 쓸 수 있는 곳(호스트의 규칙 — 임시 폴더가 사용자 앱 설정 폴더 아래인 경우) */
    protectedExceptions?(): string[];
    now(): string;
    host: string;
    pid?: number;
    version: string;
    /** 엔진 소스의 지문(`selftest.engine_id`) — 없으면 null */
    engineId(): string | null;
    /** 작성자 소개 · 잠금에 적는 이름 */
    writerName?: string;
    /** 지금 행동의 문맥(2 걸음: `AsyncLocalStorage`) */
    currentContext?(): ActorContext | undefined;
    /** `.csd` 읽기 · 새 `.csd` 쓰기(시험이 바꿔 끼운다) */
    files?: { read(abs: string, maxBytes: number): Buffer | null; writeNew(rootReal: string, abs: string, data: Buffer): void };
    pidAlive?(pid: number): boolean;
}

export const CSD_HASH_MAX_BYTES = 256 * 1024 * 1024;
export const LIST_LIMIT = { default: 20, max: 100 } as const;

/** 대상을 읽기 전용으로 연 까닭 */
export type ReadOnlyReason =
    | 'issued-copy' | 'locked-here' | 'locked-elsewhere' | 'locked-by-other-writer' | 'lock-unreadable' | 'newer-records'
    | 'declaration-newer' | 'hard-link' | 'link' | 'protected-folder' | 'not-a-case-file' | 'records-unavailable';

export interface ProjectSummary { name: string; projectId: string; readOnly: boolean; warnings: string[]; cases: number }
export interface OpenOutcome {
    /** 프로젝트 안의 파일인가 */
    inProject: boolean;
    /** 밖에서 바뀌었고 마지막 저장의 사본이 있으면 그 해시(호스트가 변경 줄을 짓는다) */
    externalFrom?: string;
    project: { name: string; projectId: string } | null;
    case: { caseId: string; name: string; file: string; kind: string } | null;
    readOnly: boolean;
    readOnlyReason: ReadOnlyReason | null;
    lock: LockInfo | null;
    /** 쓴 줄(사건 이름 — `discovered` · `opened` · `external`) */
    wrote: string[];
    notices: string[];
}
export type SaveCheck = { ok: true; inProject: boolean } | { ok: false; error: string; reason: 'changed-outside' | 'missing' | 'read-only' | 'hard-link' | 'link' };

export interface OnRunExtra {
    model?: unknown;
    caseState?: { inputs?: unknown; spans?: unknown; mcpOnly?: unknown } | null;
    props?: unknown;
    caseRev?: number | null;
    ms?: number | null;
    error?: string | null;
    /** 문맥 대신 이 행위자(패널이 아는 경우 — 웹뷰 단추는 person, 자동 채움은 program) */
    actor?: ActorContext;
}
export interface RunRecorded { runId: string; blob: string | null; blobBytes: number | null; blobStored: number | null; snapshot: string | null }

export interface RecordsHealth { unverified: number; untrusted: number; broken: number; chainBreaks: number; shrunk: number; readOnly: boolean }
export interface DeskStatus {
    inProject: boolean;
    project: { name: string; projectId: string | null; readOnly: boolean } | null;
    /** 대상이 아닌 채로 읽기 전용으로 연 파일(발행본 …) */
    file_read_only?: { reason: ReadOnlyReason; detail: string };
    case: { name: string; caseId: string; kind: string; readOnly: boolean; readOnlyReason: ReadOnlyReason | null; lock: { name: string; host: string; since: string } | null } | null;
    note: string;
}
export type ResultState = 'match' | 'differs' | 'stale' | 'none' | 'other-engine';
export interface CaseStatusData {
    status: DeskStatus;
    results: Partial<Record<RunKind, { state: ResultState; lastRun: { at: string; by: string; client: string | null; engine: string | null; status: string } | null }>>;
    saved: { at: string; by: string } | null;
    externalSinceSave: boolean;
    openQuestions: { count: number; items: Array<{ id: string; title: string }> };
    provisionalAssumptions: number;
    records: RecordsHealth;
    runs?: Array<{ kind: RunKind; at: string; by: string; client: string | null; engine: string | null; status: string; ms: number | null }>;
    /** 이 대상의 실행 이력(새 것부터 20) — 실행마다 요약(판정 · 최대 판정비 · 지배 항목 · 단면 성질 몇 개). R2-3: 07 의 「먼저 한 것」 */
    history?: Array<{ run: string; kind: RunKind; at: string; by: string; client: string | null; status: string;
        pass: boolean | null; maxRatio: number | null; governing: { id: string; ratio: number | null; verdict: string } | null; props: Record<string, number> | null }>;
}

interface OpenProject { dir: string; decl: Declaration; readOnly: boolean; warnings: string[] }
interface OpenCase {
    caseId: string; name: string; rel: string; abs: string; kind: string;
    readOnly: boolean; readOnlyReason: ReadOnlyReason | null; lock: LockInfo | null; lockHeld: boolean;
    /** 지금 디스크에 있어야 할 바이트의 해시(열 때 · 마지막 저장 뒤) */
    knownSha: string;
}

function isInside(child: string, root: string): boolean {
    const rel = path.relative(root, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class PersonOnlyError extends Error {}

/** 사람만 하는 일 — MCP 문맥 안이면 던진다 */
export interface PersonFace {
    openFolder(dirAbs: string): ProjectSummary;
    createProject(rootAbs: string, name: string): ProjectSummary;
    takeLock(caseId: string): LockInfo;
    archive(caseId: string, archived: boolean): void;
    /** 뿌리 · 최근의 프로젝트(폴더 경로 — 사람의 화면에만. MCP 답에는 경로가 없다) */
    projects(): Array<{ name: string; dir: string; cases: number; lastWork: string | null; open: boolean }>;
    /** 지금 프로젝트(이름 · 폴더 경로) */
    currentProject(): { name: string; dir: string; readOnly: boolean } | null;
    /** 파일을 옮긴 · 이름을 바꾼 대상을 그 파일에 다시 잇는다(02_검토대상 안의 .csd — 사람이 고른 파일) */
    relink(caseId: string, fileAbs: string): { caseId: string; file: string };
    /** 작성자 이름(기본: OS 사용자 이름) — 잠금 · 작성자 소개 · 믿는 작성자 표에 쓰인다 */
    writerName(): string;
    setWriterName(name: string): string;
    /** 밖에서 바뀐 파일을 덮어써도 된다고(사람이 「덮어쓰기」) — external 줄을 남기고 다음 저장의 대조를 지금 파일로 */
    allowOverwrite(): { fileSha: string };
}

export class RecordsDesk {
    private writerObj: Writer | null = null;
    private logs = new Map<RecordType, RecordLog>();
    private cardWritten = false;
    private proj: OpenProject | null = null;
    private cur: OpenCase | null = null;
    readonly person: PersonFace;

    constructor(private readonly env: DeskEnv) {
        const guard = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
            if (isMcpContext(this.env.currentContext?.())) { throw new PersonOnlyError('this is a person-only action and cannot run inside an MCP request'); }
            return fn(...a);
        };
        this.person = Object.freeze({
            openFolder: guard((dirAbs: string) => this.openDir(dirAbs)),
            createProject: guard((rootAbs: string, name: string) => this.createIn(rootAbs, name)),
            takeLock: guard((caseId: string) => this.takeLock(caseId)),
            archive: guard((caseId: string, archived: boolean) => this.archive(caseId, archived)),
            projects: guard(() => this.projectList()),
            currentProject: guard(() => (this.proj ? { name: path.basename(this.proj.dir), dir: this.proj.dir, readOnly: this.proj.readOnly } : null)),
            relink: guard((caseId: string, fileAbs: string) => this.relink(caseId, fileAbs)),
            writerName: guard(() => this.nameOfWriter()),
            setWriterName: guard((name: string) => this.setWriterName(name)),
            allowOverwrite: guard(() => this.allowOverwrite()),
        });
    }

    // ── 바탕 ──────────────────────────────────────────────────────────

    private get pid(): number { return this.env.pid ?? process.pid; }

    // ── 작성자 이름(열쇠 자리의 writer-name.json — 없으면 호스트가 준 이름, 그것도 없으면 빈 글) ──
    private writerNameCache: string | null = null;
    private nameOfWriter(): string {
        if (this.writerNameCache !== null) { return this.writerNameCache; }
        let n: string | null = null;
        try {
            const buf = readBounded(path.join(this.env.keyDir, WRITER_NAME_FILE), 4096);
            if (buf) { n = cleanHeaderText(JSON.parse(buf.toString('utf8')).name, 60); }
        } catch { /* 없음 */ }
        this.writerNameCache = n ?? cleanHeaderText(this.env.writerName ?? '', 60) ?? '';
        return this.writerNameCache;
    }
    private setWriterName(name: string): string {
        const n = cleanHeaderText(name, 60);
        if (!n) { throw new Error('a writer name of 1 – 60 characters is required'); }
        fs.mkdirSync(this.env.keyDir, { recursive: true });
        const file = path.join(this.env.keyDir, WRITER_NAME_FILE);
        const tmp = file + '.tmp-' + this.pid;
        fs.writeFileSync(tmp, JSON.stringify({ name: n }) + '\n');
        fs.renameSync(tmp, file);
        this.writerNameCache = n;
        return n;
    }

    /** 대상이 아닌 채로 읽기 전용으로 연 파일(발행본 · 02 밖의 .csd · 보호 폴더 …) — status 의 file_read_only */
    private roFile: { reason: ReadOnlyReason; detail: string; projectName: string } | null = null;
    private ctx(): ActorContext | undefined { return this.env.currentContext?.(); }
    private readFile(abs: string, max: number): Buffer | null { return (this.env.files?.read ?? readBounded)(abs, max); }

    private writer(): Writer {
        if (!this.writerObj) {
            this.writerObj = loadOrCreateWriter(this.env.keyDir);
            trustSelf(this.env.keyDir, this.writerObj, this.nameOfWriter(), this.env.now());
        }
        return this.writerObj;
    }

    private protectedHit(real: string): boolean {
        const realOf = (d: string): string => { try { return fs.realpathSync.native(d); } catch { return path.resolve(d); } };
        const exceptions = (this.env.protectedExceptions?.() ?? []).map(realOf);
        for (const p of this.env.protectedRoots?.() ?? []) {
            const pr = realOf(p);
            if (!isInside(real, pr)) { continue; }
            // 예외(임시 폴더)는 「그 예외가 이 보호 폴더 아래라서」 생기는 막힘만 푼다 — 호스트의 _projectPathError(V5c-04)와 같은 규칙
            if (exceptions.some((xr) => isInside(real, xr) && isInside(xr, pr) && path.relative(pr, xr) !== '')) { continue; }
            return true;
        }
        return false;
    }

    private specOf(type: RecordType): LogSpec {
        if (type === 'cases') { return CASES_SPEC; }
        if (type === 'runs') { return RUNS_SPEC; }
        if (type === 'work') { return WORK_SPEC; }
        if (type === 'assumptions') { return ASSUMPTION_SPEC; }
        if (type === 'sources') { return SOURCE_SPEC; }
        return plainSpec(type);
    }

    private log(type: RecordType): RecordLog {
        const p = this.proj!;
        let l = this.logs.get(type);
        if (!l) {
            l = new RecordLog({ rootReal: p.dir, projectId: p.decl.projectId, spec: this.specOf(type), host: this.env.host, pid: this.pid,
                keyDir: this.env.keyDir, now: () => this.env.now() });
            this.logs.set(type, l);
        }
        return l;
    }

    private trust(): TrustStore { return readTrust(this.env.keyDir).store; }

    /** 프로젝트의 작성자 소개들(믿지 않는 작성자의 줄을 「검증됨 · 믿지 않음」 으로 가르는 데에만) */
    private cards(): Map<string, WriterCard> {
        const out = new Map<string, WriterCard>();
        const dir = path.join(this.proj!.dir, DATA_DIR, 'writers');
        let names: string[];
        try { assertNoLinks(this.proj!.dir, dir); names = fs.readdirSync(dir).filter((n) => /^w[a-z2-7]{20}\.json$/.test(n)).slice(0, 64); } catch { return out; }
        for (const n of names) {
            try {
                const buf = readBounded(path.join(dir, n), 16 * 1024);
                const c = buf ? readWriterCard(JSON.parse(buf.toString('utf8'))) : null;
                if (c && `${c.writerId}.json` === n) { out.set(c.writerId, c); }
            } catch { /* 건너뜀 */ }
        }
        return out;
    }

    private read(type: RecordType, budget?: ReadBudget): ReadResult {
        return this.log(type).read(this.trust(), this.cards(), budget);
    }

    /** 줄 하나 — 프로젝트가 쓸 수 있을 때만. 처음이면 줄 파일을 쥐고 작성자 소개를 둔다 */
    private append(type: RecordType, entry: { id: string; event: string; actor: Actor; body: Record<string, unknown> }): RecordLine {
        const p = this.proj;
        if (!p || p.readOnly) { throw new Error('the project is read-only'); }
        const w = this.writer();
        const l = this.log(type);
        l.open(w);
        if (!this.cardWritten) {
            const dir = path.join(p.dir, DATA_DIR, 'writers');
            mkdirInside(p.dir, dir);
            const file = path.join(dir, `${w.writerId}.json`);
            try { writeExclusive(p.dir, file, JSON.stringify(makeWriterCard(w, this.nameOfWriter(), this.env.host, this.env.now()), null, 1)); }
            catch (e: any) { if (e?.code !== 'EEXIST') { throw e; } }
            this.cardWritten = true;
        }
        return l.append(entry);
    }

    private newLineId(prefix: string): string { return `${prefix}-${newId('c').slice(1, 13)}`; }

    // ── 프로젝트 ──────────────────────────────────────────────────────

    /** 폴더를 프로젝트로 연다(검사만 — 쓰지 않는다). 보호 폴더 · 선언 없음 · 링크인 선언은 던진다 */
    private openDir(dirAbs: string): ProjectSummary {
        const real = realRoot(dirAbs);
        if (this.protectedHit(real)) { throw new RecordsPathError('a project inside a protected folder (system, programs, application settings) is not opened'); }
        // 이미 연 프로젝트면 그대로(열린 대상 · 잠금을 놓지 않는다)
        if (this.proj && this.proj.dir === real) { return this.summary(); }
        const d = readDeclaration(real);
        if (!d.ok) { throw new RecordsPathError(d.error); }
        this.closeProject();
        this.proj = { dir: real, decl: d.decl, readOnly: d.readOnly, warnings: d.warnings };
        return this.summary();
    }

    private createIn(rootAbs: string, name: string): ProjectSummary {
        const root = realRoot(rootAbs);
        if (this.protectedHit(root)) { throw new RecordsPathError('a project root inside a protected folder is not used'); }
        const { dir } = createProject(root, name, { now: this.env.now(), version: this.env.version });
        return this.openDir(dir);
    }

    private summary(): ProjectSummary {
        const p = this.proj!;
        let cases = 0;
        try { cases = [...foldCases(this.read('cases').lines).values()].filter((c) => !c.archived).length; } catch { /* 0 */ }
        return { name: path.basename(p.dir), projectId: p.decl.projectId, readOnly: p.readOnly, warnings: [...p.warnings], cases };
    }

    /** 뿌리 · 최근의 프로젝트 폴더(진짜 경로, 겹침 없이). 보호 폴더 안은 뺀다 */
    private projectDirs(): Array<{ dir: string; name: string }> {
        const out = new Map<string, { dir: string; name: string }>();
        const add = (dir: string) => {
            try {
                const real = realRoot(dir);
                if (this.protectedHit(real) || out.has(real.toLowerCase())) { return; }
                const st = fs.lstatSync(path.join(real, DECLARATION_FILE));
                if (!st.isFile() || st.isSymbolicLink() || !readDeclaration(real).ok) { return; }
                out.set(real.toLowerCase(), { dir: real, name: path.basename(real) });
            } catch { /* 없음 · 읽을 수 없음 */ }
        };
        for (const root of this.env.roots()) {
            let real: string;
            try { real = realRoot(root); } catch { continue; }
            if (this.protectedHit(real)) { continue; }
            let ents: fs.Dirent[];
            try { ents = fs.readdirSync(real, { withFileTypes: true }).slice(0, 2000); } catch { continue; }
            for (const e of ents) { if (e.isDirectory()) { add(path.join(real, e.name)); } }
        }
        for (const r of this.env.recentProjects?.() ?? []) { add(r); }
        return [...out.values()].sort((a, b) => (nameKey(a.name) < nameKey(b.name) ? -1 : nameKey(a.name) > nameKey(b.name) ? 1 : 0));
    }

    /** AI · 화면의 목록 — 이름 · 검토 대상 수 · 마지막 작업(경로 없음) */
    listProjects(opts: { limit?: number; cursor?: string } = {}): { projects: Array<{ name: string; cases: number; lastWork: string | null; open: boolean }>; next: string | null; total: number } {
        const all = this.projectDirs();
        const limit = Math.max(1, Math.min(LIST_LIMIT.max, Number.isSafeInteger(opts.limit) ? opts.limit! : LIST_LIMIT.default));
        const start = opts.cursor && /^[0-9]{1,6}$/.test(opts.cursor) ? Number(opts.cursor) : 0;
        const page = all.slice(start, start + limit).map(({ dir, name }) => {
            let cases = 0, lastWork: number | null = null;
            try {
                cases = fs.readdirSync(path.join(dir, FOLDERS.cases)).filter((n) => /\.csd$/i.test(n)).length;
            } catch { /* 없음 */ }
            try {
                const logDir = path.join(dir, DATA_DIR, 'log');
                for (const t of fs.readdirSync(logDir)) {
                    for (const f of fs.readdirSync(path.join(logDir, t))) {
                        const m = fs.lstatSync(path.join(logDir, t, f)).mtimeMs;
                        if (lastWork === null || m > lastWork) { lastWork = m; }
                    }
                }
            } catch { /* 기록 없음 */ }
            return { name, cases, lastWork: lastWork === null ? null : new Date(lastWork).toISOString(), open: !!this.proj && this.proj.dir === dir };
        });
        return { projects: page, next: start + limit < all.length ? String(start + limit) : null, total: all.length };
    }

    /** 이름으로 연다(뿌리 · 최근). `create` 면 없을 때 첫 뿌리 아래에 만든다. 쓰지 않는다(만들 때의 선언 · 폴더 넷만) */
    openProject(name: string, opts: { create?: boolean } = {}): ProjectSummary {
        const n = checkName(name);
        if (!n.ok) { throw new RecordsPathError(n.error); }
        const hit = this.projectDirs().find((p) => nameKey(p.name) === n.key);
        if (hit) { return this.openDir(hit.dir); }
        for (const root of this.env.roots()) {
            try { const d = findProjectByName(root, n.name); if (d) { return this.openDir(d); } } catch { /* 다음 뿌리 */ }
        }
        if (!opts.create) { throw new RecordsPathError(`no project named '${n.name}' under the project roots or in the recent list`); }
        const root = this.env.roots()[0];
        if (!root) { throw new RecordsPathError('no project root is set'); }
        return this.createIn(root, n.name);
    }

    get project(): ProjectSummary | null { return this.proj ? this.summary() : null; }

    closeProject(): void {
        this.closeCase();
        for (const l of this.logs.values()) { try { l.close(); } catch { /* 없음 */ } }
        this.logs.clear();
        this.cardWritten = false;
        this.proj = null;
    }

    // ── 검토 대상 ────────────────────────────────────────────────────

    private casesFold(): Map<string, CaseEntry> { return foldCases(this.read('cases').lines); }

    /** 열린 프로젝트의 검토 대상(이름 · 종류 · 색인 · 저장 · 보관)과 등록 안 된 `.csd`(충돌 사본일 수 있음) */
    listCases(opts: { includeArchived?: boolean } = {}): {
        cases: Array<{ name: string; caseId: string; kind: string; file: string; archived: boolean; lastSaved: string | null; open: boolean; missing: boolean;
            lock: { name: string; host: string; since: string; mine: boolean } | null;
            index: { memberType: string | null; section: string | null; steel: string | null; maxRatio: number | null; pass: boolean | null;
                results: string[]; outline: { paths: number[][]; aspect: number } | null } | null }>;
        unregistered: Array<{ name: string; maybeConflictCopy: boolean }>;
    } {
        if (!this.proj) { throw new Error('no project is open'); }
        const p = this.proj;
        const fold = this.casesFold();
        const cases = [];
        const registered = new Set<string>();
        for (const e of fold.values()) {
            registered.add(e.file.toLowerCase());
            if (e.archived && !opts.includeArchived) { continue; }
            const abs = path.join(p.dir, ...e.file.split('/'));
            let index = null, missing = false;
            try {
                assertNoLinks(p.dir, abs);
                const buf = this.readFile(abs, CSD_MAX_BYTES);
                if (!buf) { missing = true; } else {
                    const sha = sha256Hex(buf);
                    const ix = readIndex(p.dir, e.caseId, sha) ?? (() => { const s = summarizeCsd(buf); return s ? { ...s, savedAt: null } : null; })();
                    if (ix) { index = { memberType: ix.memberType, section: ix.section, steel: ix.steel, maxRatio: ix.maxRatio, pass: ix.pass, results: ix.results, outline: ix.outline }; }
                }
            } catch { missing = true; }
            // R2-3: 잠금을 쥔 쪽(이 창이 쥔 지금 대상은 빼고) — 이름 · 호스트 · 때. mine = 이 PC 의 같은 작성자(다른 창일 수 있다)
            let lock: { name: string; host: string; since: string; mine: boolean } | null = null;
            if (!(this.cur?.caseId === e.caseId && this.cur.lockHeld)) {
                const lk = readLock(p.dir, e.caseId, this.writerObj ?? undefined);
                if (lk) { lock = { name: lk.info.name, host: lk.info.host, since: lk.info.at, mine: lk.mine }; }
            }
            cases.push({ name: e.name, caseId: e.caseId, kind: e.kind, file: e.file, archived: e.archived, lastSaved: e.lastSaved?.at ?? null,
                open: this.cur?.caseId === e.caseId, missing, lock, index });
        }
        const unregistered: Array<{ name: string; maybeConflictCopy: boolean }> = [];
        try {
            const dir = path.join(p.dir, FOLDERS.cases);
            assertNoLinks(p.dir, dir);
            const names = [...fold.values()].map((e) => nameKey(e.name));
            for (const f of fs.readdirSync(dir).filter((n) => /\.csd$/i.test(n)).slice(0, 2000)) {
                if (registered.has(`${FOLDERS.cases}/${f}`.toLowerCase())) { continue; }
                const stem = f.replace(/\.csd$/i, '');
                const k = nameKey(stem);
                const maybe = names.some((nm) => k !== nm && k.startsWith(nm) && /^[\s_-]*(\(\d+\)|-?[a-z0-9]+[-\s]?\d*|충돌|conflict)/i.test(k.slice(nm.length)));
                unregistered.push({ name: cleanHeaderText(stem, 60) ?? '', maybeConflictCopy: maybe });
            }
        } catch { /* 폴더 없음 */ }
        cases.sort((a, b) => (nameKey(a.name) < nameKey(b.name) ? -1 : 1));
        return { cases, unregistered };
    }

    /** 대상 파일의 자리(패널이 이것을 열고 `afterOpen` 을 부른다). 등록 안 된 파일도 이름으로 연다 */
    openCase(name: string): { abs: string; file: string; caseId: string | null } {
        if (!this.proj) { throw new Error('no project is open'); }
        const { abs, rel, name: nm } = caseFileFor(this.proj.dir, name);
        assertSingleLink(abs);
        let st: fs.Stats;
        try { st = fs.lstatSync(abs); } catch { throw new RecordsPathError(`no case named '${nm}'`); }
        if (!st.isFile()) { throw new RecordsPathError(`'${nm}' is not a plain file`); }
        const e = [...this.casesFold().values()].find((c) => c.file.toLowerCase() === rel.toLowerCase());
        return { abs, file: rel, caseId: e?.caseId ?? null };
    }

    /**
     * 새 대상(`create`) 또는 지금 파일의 사본(`import` — `from` 을 준다). `build(record)` 가 `.csd` 바이트를 짓는다(패널 — 처음 값 상태 또는
     * 지금 상태 + `record` 키). `wx` 로 쓴다(있으면 오류).
     */
    newCase(name: string, kind: string, build: (record: { caseId: string; projectId: string }) => string | Buffer,
        from?: { sourceName: string; sourceSha: string }): { caseId: string; name: string; file: string; abs: string } {
        const p = this.proj;
        if (!p) { throw new Error('no project is open'); }
        if (p.readOnly) { throw new Error('the project is read-only'); }
        const { abs, rel, name: nm } = caseFileFor(p.dir, name);
        mkdirInside(p.dir, path.dirname(abs));
        const caseId = newId('c');
        const data = build({ caseId, projectId: p.decl.projectId });
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        (this.env.files?.writeNew ?? writeExclusive)(p.dir, abs, bytes);
        const actor = toActor(this.ctx(), 'person');
        const body: Record<string, unknown> = { caseId, name: nm, file: rel, kind: String(kind) };
        if (from) { body.sourceName = cleanHeaderText(from.sourceName, 120) ?? ''; if (/^[0-9a-f]{64}$/.test(from.sourceSha)) { body.sourceSha = from.sourceSha; } }
        this.append('cases', { id: this.newLineId('case'), event: from ? 'import' : 'create', actor, body });
        return { caseId, name: nm, file: rel, abs };
    }

    // ── 열기 · 저장 훅 ────────────────────────────────────────────────

    /** 파일 위의 프로젝트(위로 3 단계 — 발행본까지) */
    findProjectFor(abs: string): { dir: string; issued: boolean } | null { return findProjectDirFor(abs); }

    /**
     * 패널이 `.csd` 를 연 뒤(그 바이트로). 프로젝트 안이면 대상을 찾거나(`record` 키 → 경로) 등록(`discovered`)하고, 잠금을 쥐고, `opened` ·
     * (마지막으로 알려진 바이트와 다르면) `external` 줄을 쓴다. 읽기 전용이면 아무것도 쓰지 않는다.
     */
    afterOpen(abs: string, bytes: Buffer, info: { contentFp?: string | null; record?: unknown; snapshot?: unknown } = {}): OpenOutcome {
        this.closeCase();
        this.roFile = null;
        const out: OpenOutcome = { inProject: false, project: null, case: null, readOnly: false, readOnlyReason: null, lock: null, wrote: [], notices: [] };
        const found = findProjectDirFor(abs);
        if (!found) { if (this.proj && !isInside(path.resolve(abs), this.proj.dir)) { this.closeProject(); } return out; }
        let real: string;
        try { real = realRoot(found.dir); } catch { return out; }
        out.inProject = true;
        const ro = (reason: ReadOnlyReason, notice: string): OpenOutcome => {
            out.readOnly = true; out.readOnlyReason = reason; out.notices.push(notice);
            // 대상이 열리지 않은 읽기 전용(잠금은 대상이 열려 그 요약이 말한다)
            if (!this.cur) { this.roFile = { reason, detail: notice, projectName: path.basename(found.dir) }; }
            return out;
        };
        if (found.issued) { return ro('issued-copy', 'an issued copy — opened read-only, nothing is recorded'); }
        if (this.protectedHit(real)) { return ro('protected-folder', 'the project is inside a protected folder — opened read-only, nothing is recorded'); }
        if (!this.proj || this.proj.dir !== real) {
            const d = readDeclaration(real);
            if (!d.ok) { out.inProject = false; out.notices.push(`the folder's project declaration cannot be read (${d.error}) — opened as a plain file`); return out; }
            this.closeProject();
            this.proj = { dir: real, decl: d.decl, readOnly: d.readOnly, warnings: d.warnings };
        }
        const p = this.proj!;
        out.project = { name: path.basename(p.dir), projectId: p.decl.projectId };
        if (p.readOnly) { return ro('declaration-newer', 'the project declaration is from a newer version — read-only'); }
        const rel = projectRelative(p.dir, abs);
        if (!rel || !caseFileOk(rel)) { return ro('not-a-case-file', `only files in ${FOLDERS.cases}/ are review cases — opened read-only, nothing is recorded`); }
        try { assertNoLinks(p.dir, path.resolve(abs)); } catch { return ro('link', 'the file is reached through a link or junction — opened read-only'); }
        try { assertSingleLink(abs); } catch { return ro('hard-link', 'the file has more than one hard link — opened read-only'); }
        const fileSha = sha256Hex(bytes);
        let caseRead: ReadResult;
        try { caseRead = this.read('cases'); } catch { return ro('records-unavailable', 'the case records cannot be read — read-only'); }
        if (caseRead.readOnly) { return ro('newer-records', 'records written by a newer version — read-only'); }
        const fold = foldCases(caseRead.lines);
        const rec = info.record && typeof info.record === 'object' ? info.record as Record<string, unknown> : null;
        let entry = rec && rec.projectId === p.decl.projectId && typeof rec.caseId === 'string' && CASE_ID_RE.test(rec.caseId)
            ? fold.get(rec.caseId) ?? null : null;
        if (entry && entry.file.toLowerCase() !== rel.toLowerCase()) {
            out.notices.push(`the file carries the id of the case '${entry.name}' (${entry.file}) — treated by its own path`);
            entry = null;
        }
        if (!entry) { entry = [...fold.values()].find((c) => c.file.toLowerCase() === rel.toLowerCase()) ?? null; }
        // 잠금 — 쥐지 못하면 읽기 전용(아무것도 쓰지 않는다). 열쇠를 쓸 수 없어도 읽기 전용
        let w: Writer;
        try { w = this.writer(); } catch (e) {
            if (e instanceof KeyUnavailableError) { return ro('records-unavailable', `the writer key is unavailable (${e.message}) — read-only`); }
            throw e;
        }
        const caseId = entry?.caseId ?? newId('c');
        const lock: LockResult = acquireLock(p.dir, caseId, { writer: w, name: this.nameOfWriter(), host: this.env.host, pid: this.pid,
            now: this.env.now(), pidAlive: this.env.pidAlive });
        const name = entry?.name ?? path.basename(rel).replace(/\.csd$/i, '');
        out.case = { caseId, name, file: rel, kind: entry?.kind ?? 'section-only' };
        if (!lock.held) {
            out.lock = lock.by;
            const reason: ReadOnlyReason = lock.reason === 'held-here' ? 'locked-here' : lock.reason === 'held-elsewhere' ? 'locked-elsewhere'
                : lock.reason === 'held-by-other-writer' ? 'locked-by-other-writer' : 'lock-unreadable';
            this.cur = { caseId, name, rel, abs: path.resolve(abs), kind: out.case.kind, readOnly: true, readOnlyReason: reason, lock: lock.by, lockHeld: false, knownSha: fileSha };
            return ro(reason, lock.by ? `open on ${lock.by.host || 'another PC'}${lock.by.name ? ` by ${lock.by.name}` : ''} since ${lock.by.at}${lock.stale ? ' (an old lock — a person can take it over)' : ''} — read-only`
                : 'a lock file that cannot be read holds this case — read-only (a person can take it over)');
        }
        out.lock = lock.info;
        const actor: Actor = { kind: 'program' };
        if (!entry) {
            this.append('cases', { id: this.newLineId('case'), event: 'discovered', actor, body: { caseId, name: checkName(name).ok ? name : cleanHeaderText(name, 60) ?? 'case', file: rel, kind: 'section-only' } });
            out.wrote.push('discovered');
        }
        // 연 바이트의 모델 · 입력 사본 — 다음에 밖에서 바뀐 것을 비교할 기준(저장 없이 연 대상도 — R2-3 고침)
        let openSnap: string | null = null;
        if (info.snapshot !== undefined) { try { openSnap = putBlob(p.dir, info.snapshot).sha256; } catch { openSnap = null; } }
        const known = entry ? lastKnown(entry) : null;
        this.append('cases', { id: this.newLineId('case'), event: 'opened', actor, body: { caseId, fileSha, ...(openSnap ? { snapshot: openSnap } : {}) } });
        out.wrote.push('opened');
        if (known && known.fileSha !== fileSha) {
            this.append('cases', { id: this.newLineId('case'), event: 'external', actor: { kind: 'program' },
                body: { caseId, fileSha, ...(info.contentFp ? { contentFp: info.contentFp } : {}), ...(openSnap ? { snapshot: openSnap } : {}) } });
            out.wrote.push('external');
            // R2-2: 밖에서 바뀐 것의 변경 줄 — 마지막으로 알려진 파일의 사본(저장 · 열기)과 비교한다(호스트가)
            if (known.snapshot) { out.externalFrom = known.snapshot; }
            out.notices.push('the file changed outside StCFSD since it was last saved or opened here');
        }
        this.cur = { caseId, name, rel, abs: path.resolve(abs), kind: out.case.kind, readOnly: false, readOnlyReason: null, lock: lock.info, lockHeld: true, knownSha: fileSha };
        return out;
    }

    /** 저장 전 대조 — 프로젝트의 대상일 때만. 지금 디스크의 바이트가 열 때 · 마지막 저장 때와 다르면 쓰지 않는다 */
    beforeSave(abs: string): SaveCheck {
        const c = this.cur;
        if (!c || path.resolve(abs).toLowerCase() !== c.abs.toLowerCase()) { return { ok: true, inProject: !!findProjectDirFor(abs) && !!this.proj }; }
        if (c.readOnly) { return { ok: false, reason: 'read-only', error: `this case is open read-only (${c.readOnlyReason}) — not saved` }; }
        try { assertNoLinks(this.proj!.dir, c.abs); } catch { return { ok: false, reason: 'link', error: 'the case file is now reached through a link — not saved' }; }
        try { assertSingleLink(c.abs); } catch { return { ok: false, reason: 'hard-link', error: 'the case file now has more than one hard link — not saved' }; }
        let buf: Buffer | null;
        try { buf = this.readFile(c.abs, CSD_HASH_MAX_BYTES); } catch (e: any) { return { ok: false, reason: 'changed-outside', error: `the case file cannot be read (${e?.message || e}) — not saved` }; }
        if (!buf) { return { ok: false, reason: 'missing', error: 'the case file was removed outside StCFSD — not saved (save under another name, or restore the file)' }; }
        if (sha256Hex(buf) !== c.knownSha) {
            return { ok: false, reason: 'changed-outside', error: 'the case file changed outside StCFSD since it was opened or last saved here — not saved (reopen it, or save under another name)' };
        }
        return { ok: true, inProject: true };
    }

    /** `.csd` 의 최상위 `record` 키(프로젝트의 대상을 쓸 수 있을 때만) */
    recordKey(abs?: string): { caseId: string; projectId: string } | null {
        const c = this.cur;
        if (!c || c.readOnly || !this.proj || (abs && path.resolve(abs).toLowerCase() !== c.abs.toLowerCase())) { return null; }
        return { caseId: c.caseId, projectId: this.proj.decl.projectId };
    }

    /** 저장 뒤 — `saved` 줄, 스냅숏 사본, 색인 */
    afterSave(abs: string, bytes: Buffer, info: { contentFp?: string | null; snapshot?: unknown } = {}): { fileSha: string; snapshot: string | null } | null {
        const c = this.cur;
        if (!c || c.readOnly || !this.proj || path.resolve(abs).toLowerCase() !== c.abs.toLowerCase()) { return null; }
        const fileSha = sha256Hex(bytes);
        let snapshot: string | null = null;
        if (info.snapshot !== undefined) { try { snapshot = putBlob(this.proj.dir, info.snapshot).sha256; } catch { snapshot = null; } }
        // 행위자 표(§2.6): saved 는 program — 누가 저장했는가는 변경 기록(R2)의 몫
        this.append('cases', { id: this.newLineId('case'), event: 'saved', actor: { kind: 'program' },
            body: { caseId: c.caseId, fileSha, bytes: bytes.length, ...(info.contentFp ? { contentFp: info.contentFp } : {}), ...(snapshot ? { snapshot } : {}) } });
        c.knownSha = fileSha;
        const s = summarizeCsd(bytes);
        if (s) { try { writeIndex(this.proj.dir, c.caseId, fileSha, { ...s, savedAt: this.env.now() }); } catch { /* 색인은 다시 지을 수 있다 */ } }
        return { fileSha, snapshot };
    }

    // ── 변경 묶음 `log/changes`(R2-2) ───────────────────────────────────

    /** 변경 줄 하나 — 열린 쓸 수 있는 대상의 것만(아니면 null: 호스트가 메모리에 둔다) */
    appendChange(body: Record<string, unknown> & { caseId: string }, actor: Actor): { id: string; at: string } | null {
        const c = this.cur, p = this.proj;
        if (!c || c.readOnly || !p || p.readOnly || body.caseId !== c.caseId) { return null; }
        const line = this.append('changes', { id: this.newLineId('chg'), event: 'change', actor, body });
        return { id: line.id, at: line.at };
    }

    /** 대상의 변경 줄(세는 줄 · 검증 안 된 줄은 status 로) — 오래된 것부터 */
    changesOf(caseId?: string | null): Array<{ id: string; at: string; actor: Actor; status: string; body: Record<string, any> }> {
        if (!this.proj) { return []; }
        const id = caseId === undefined ? this.cur?.caseId ?? null : caseId;
        if (!id) { return []; }
        let lines: RecordLine[];
        try { lines = this.read('changes').lines; } catch { return []; }
        return lines.filter((l) => l.event === 'change' && l.body && l.body.caseId === id)
            .map((l) => ({ id: l.id, at: l.at, actor: l.actor, status: l.status, body: l.body }));
    }

    /** 사본(스냅숏) 하나를 읽는다 — 이 프로젝트의 것 */
    readSnapshot(sha: string): unknown | null {
        if (!this.proj) { return null; }
        const g = getBlob(this.proj.dir, sha);
        return g.ok ? g.value : null;
    }

    /** 대상을 놓는다(잠금 — 내 것일 때만) */
    closeCase(): void {
        const c = this.cur;
        if (c && c.lockHeld && this.proj && this.writerObj) {
            try { releaseLock(this.proj.dir, c.caseId, { writer: this.writerObj, host: this.env.host, pid: this.pid }); } catch { /* 다음 실행이 넘겨받는다 */ }
        }
        this.cur = null;
    }

    // ── 실행 이력 ────────────────────────────────────────────────────

    /**
     * 결과를 받아들인 자리에서(여섯 + 셋). 프로젝트의 쓸 수 있는 대상이 열려 있을 때만 — 아니면 null(아무것도 쓰지 않는다).
     * `requestText` 는 엔진에 보낸 요청의 바이트(글) 그대로.
     */
    onRun(kind: RunKind, requestText: string | Buffer, result: unknown, extra: OnRunExtra = {}): RunRecorded | null {
        const c = this.cur, p = this.proj;
        if (!c || c.readOnly || !p || p.readOnly) { return null; }
        if (!(RUN_KINDS as readonly string[]).includes(kind)) { throw new Error(`unknown run kind '${kind}'`); }
        let blob: string | null, blobBytes: number | null = null, blobStored: number | null = null, snapshot: string | null = null;
        let rFp: string | null;
        try { rFp = resultFp(result); } catch { rFp = null; }
        try { const b = putBlob(p.dir, result ?? null); blob = b.sha256; blobBytes = b.bytes; blobStored = b.stored; } catch { blob = null; }
        let mFp: string | null = null, cFp: string | null = null;
        if (extra.model !== undefined) {
            try { const f = contentFp(extra.model, extra.caseState ?? null); mFp = f.modelFp; cFp = f.caseFp; } catch { /* 지문 없음 */ }
            try { snapshot = putBlob(p.dir, { model: extra.model, case: extra.caseState ? { inputs: extra.caseState.inputs ?? null, spans: extra.caseState.spans ?? null, mcpOnly: extra.caseState.mcpOnly ?? null } : null, props: extra.props ?? null }).sha256; }
            catch { snapshot = null; }
        }
        const failed = !!extra.error || !!(result && typeof result === 'object' && (result as any).error);
        const body: Record<string, unknown> = {
            caseId: c.caseId, kind, engineId: normalizeEngineId(this.env.engineId()), modelFp: mFp, caseFp: cFp, requestFp: requestFp(requestText),
            resultFp: rFp, blob, snapshot, caseRev: Number.isSafeInteger(extra.caseRev) ? extra.caseRev : null,
            ms: Number.isSafeInteger(extra.ms) && extra.ms! >= 0 ? extra.ms : null, status: failed ? 'failed' : 'ok',
            summary: failed ? null : runSummary(result, extra.props),
        };
        if (failed) { body.error = cleanHeaderText(extra.error ?? (result as any)?.error, 300) ?? ''; }
        const line = this.append('runs', { id: this.newLineId('run'), event: 'run', actor: toActor(extra.actor ?? this.ctx(), 'program'), body });
        return { runId: line.id, blob, blobBytes, blobStored, snapshot };
    }

    // ── 상태 ─────────────────────────────────────────────────────────

    /** `getStatus()` · `get_full_state` 의 `project` 요약(덧붙이기만 — 경로 없음) */
    status(): DeskStatus {
        const p = this.proj, c = this.cur;
        const fro = !c && this.roFile ? { file_read_only: { reason: this.roFile.reason, detail: this.roFile.detail } } : {};
        if (!p && this.roFile) {
            // 발행본처럼 프로젝트 안이지만 대상이 아닌 파일 — 프로젝트를 열지 않고 그 이름과 까닭만
            return { inProject: true, project: { name: this.roFile.projectName, projectId: null, readOnly: true }, case: null, ...fro,
                note: `read-only (${this.roFile.reason}) — nothing is recorded for this file` };
        }
        if (!p) { return { inProject: false, project: null, case: null, note: 'outside a project — no work records are kept (make it a project to keep them)' }; }
        return {
            inProject: true,
            project: { name: path.basename(p.dir), projectId: p.decl.projectId, readOnly: p.readOnly },
            case: c ? { name: c.name, caseId: c.caseId, kind: c.kind, readOnly: c.readOnly, readOnlyReason: c.readOnlyReason,
                lock: !c.lockHeld && c.lock ? { name: c.lock.name, host: c.lock.host, since: c.lock.at } : null } : null,
            ...fro,
            note: c ? (c.readOnly ? `read-only (${c.readOnlyReason})` : 'records are kept for this case') : (this.roFile ? `read-only (${this.roFile.reason}) — nothing is recorded for this file` : 'a project is open — no case is open'),
        };
    }

    /**
     * `get_case_status` 의 자료. `current` = 호스트가 지금 쥔 결과마다의 지문(없으면 그 종류의 결과가 없다) · 낡음 표시.
     * 결과 상태: 실행 기록이 없으면 'none', 지금 결과가 없거나 낡았으면 'stale', 마지막 실행의 엔진이 지금과 다르면 'other-engine',
     * 지문이 같으면 'match', 다르면 'differs'(기록 밖에서 만든 결과 — 예: 저장 파일에서 되살린 것).
     */
    caseStatus(opts: { current?: Partial<Record<RunKind, { resultFp: string | null; stale?: boolean }>>; detail?: 'runs' } = {}): CaseStatusData {
        const st = this.status();
        const empty: RecordsHealth = { unverified: 0, untrusted: 0, broken: 0, chainBreaks: 0, shrunk: 0, readOnly: false };
        const data: CaseStatusData = { status: st, results: {}, saved: null, externalSinceSave: false, openQuestions: { count: 0, items: [] },
            provisionalAssumptions: 0, records: empty };
        if (!this.proj) { return data; }
        const budget = new ReadBudget(256 * 1024 * 1024);
        const health = { ...empty };
        const reads: Partial<Record<RecordType, ReadResult>> = {};
        for (const t of ['cases', 'runs', 'work', 'assumptions'] as RecordType[]) {
            try {
                const r = this.read(t, budget);
                reads[t] = r;
                health.unverified += r.stats.unverified; health.untrusted += r.stats.untrusted;
                health.broken += r.stats.broken + r.stats.nonCanonical; health.chainBreaks += r.stats.chainBreaks.length; health.shrunk += r.stats.shrunk.length;
                health.readOnly = health.readOnly || r.readOnly;
            } catch { health.broken += 1; }
        }
        data.records = health;
        const caseId = this.cur?.caseId ?? null;
        const runs: RunEntry[] = reads.runs ? foldRuns(reads.runs.lines) : [];
        const last = lastRunByKind(runs, caseId);
        const engineNow = normalizeEngineId(this.env.engineId());
        for (const kind of RUN_KINDS) {
            const lr = last.get(kind);
            const curr = opts.current?.[kind];
            if (!lr && !curr) { continue; }
            let state: ResultState;
            if (!lr) { state = 'none'; } else if (!curr || curr.resultFp === null || curr.stale) { state = 'stale'; }
            else if (engineNow && lr.engineId && lr.engineId !== engineNow) { state = 'other-engine'; }
            else { state = curr.resultFp === lr.resultFp ? 'match' : 'differs'; }
            data.results[kind] = { state, lastRun: lr ? { at: lr.at, by: lr.actor, client: lr.client, engine: lr.engineId ? lr.engineId.slice(7, 19) : null, status: lr.status } : null };
        }
        if (caseId && reads.cases) {
            const e = foldCases(reads.cases.lines).get(caseId);
            if (e?.lastSaved) { data.saved = { at: e.lastSaved.at, by: e.lastSaved.writer }; }
            data.externalSinceSave = !!(e?.lastExternal && (!e.lastSaved || e.lastExternal.at > e.lastSaved.at));
        }
        if (reads.work) {
            const open = foldWork(reads.work.lines).filter((w) => w.kind === 'question' && w.state === 'open' && (w.caseId === null || w.caseId === caseId));
            data.openQuestions = { count: open.length, items: open.slice(0, 5).map((w) => ({ id: w.key, title: [...w.title].slice(0, 120).join('') })) };
        }
        if (reads.assumptions) {
            data.provisionalAssumptions = foldAssumptions(reads.assumptions.lines)
                .filter((a) => (a.caseId === null || a.caseId === caseId) && (a.status === 'provisional' || a.status === 'field-check') && !a.closed).length;
        }
        if (opts.detail === 'runs') {
            data.runs = [...last.values()].map((r) => ({ kind: r.kind, at: r.at, by: r.actor, client: r.client, engine: r.engineId ? r.engineId.slice(7, 19) : null, status: r.status, ms: r.ms }));
            data.history = runs.filter((r) => r.caseId === caseId).slice(-20).reverse().map((r) => {
                const g = r.summary?.governing?.[0] ?? null;
                return { run: r.runId, kind: r.kind, at: r.at, by: r.actor, client: r.client, status: r.status, pass: r.summary?.pass ?? null,
                    maxRatio: r.summary?.maxRatio ?? null, governing: g ? { id: g.id, ratio: g.ratio, verdict: g.verdict } : null, props: r.summary?.props ?? null };
            });
        }
        return data;
    }

    /** 실행 기록(대상 하나 — 보기 · 시험용) */
    runsOf(caseId?: string | null): RunEntry[] {
        if (!this.proj) { return []; }
        const all = foldRuns(this.read('runs').lines);
        const id = caseId === undefined ? this.cur?.caseId ?? null : caseId;
        return all.filter((r) => r.caseId === id);
    }

    // ── 업무 · 가정 · 원자료(R3-2 — 설계 §2.4.5 – 2.4.7 · §4.3 · §4.4) ─────────────────────

    /** 쓸 수 있는 프로젝트(아니면 던진다 — 아무것도 쓰지 않는다) */
    private writableProject(): OpenProject {
        const p = this.proj;
        if (!p) { throw new Error('no project is open'); }
        if (p.readOnly) { throw new Error('the project is read-only'); }
        return p;
    }
    /** 이 PC 의 작성자 id(열쇠가 없으면 만들지 않고 null) */
    private myWriterId(): string | null {
        if (this.writerObj) { return this.writerObj.writerId; }
        try { return this.writer().writerId; } catch { return null; }
    }
    /** 기록 하나의 줄 · 세지 않은 줄 수 · 항목(add · register 줄)마다 쓴 쪽 */
    private recordLines(type: 'work' | 'assumptions' | 'sources'): { lines: RecordLine[]; uncounted: number; firstActor: Map<string, { kind: string; writer: string }> } {
        if (!this.proj) { return { lines: [], uncounted: 0, firstActor: new Map() }; }
        let r: ReadResult;
        try { r = this.read(type); } catch { return { lines: [], uncounted: 0, firstActor: new Map() }; }
        const firstActor = new Map<string, { kind: string; writer: string }>();
        for (const l of r.lines) {
            if (l.status !== 'ok' || (l.event !== 'add' && l.event !== 'register') || typeof l.body?.item !== 'string') { continue; }
            const key = firstActor.has(l.body.item) && firstActor.get(l.body.item)!.writer !== l.sig.w ? `${l.body.item}~${l.sig.w.slice(1, 5)}` : l.body.item;
            if (!firstActor.has(key)) { firstActor.set(key, { kind: l.actor.kind, writer: l.sig.w }); }
        }
        return { lines: r.lines, uncounted: r.lines.filter((l) => l.status !== 'ok').length, firstActor };
    }
    private stamp<T extends { writer: string }>(items: Array<T & { key?: string; item: string }>, first: Map<string, { kind: string; writer: string }>):
    Array<T & { writtenBy: string; own: boolean }> {
        const me = this.myWriterId();
        return items.map((x) => ({ ...x, writtenBy: first.get(x.key ?? x.item)?.kind ?? 'unverified', own: !!me && x.writer === me }));
    }

    /** 업무 항목(세는 줄로 접은 것) — 쓴 쪽 · 이 PC 의 작성자인가 · 지금 내용과 다른 기준인가 */
    workItems(nowContentFp?: string): Array<WorkItem & { writtenBy: string; own: boolean }> {
        const v = this.recordLines('work');
        return this.stamp(foldWork(v.lines, nowContentFp ? { nowContentFp } : {}), v.firstActor);
    }
    assumptionItems(): Array<Assumption & { writtenBy: string; own: boolean }> {
        const v = this.recordLines('assumptions');
        return this.stamp(foldAssumptions(v.lines), v.firstActor);
    }
    sourceItems(): Array<Source & { writtenBy: string; own: boolean }> {
        const v = this.recordLines('sources');
        return this.stamp(foldSources(v.lines) as Array<Source & { item: string }>, v.firstActor);
    }
    /** 세지 않은 줄(서명 없음 · 믿지 않는 작성자 · 자리 틀림 · 표 밖) 수 */
    uncountedLines(type: 'work' | 'assumptions' | 'sources'): number { return this.recordLines(type).uncounted; }

    /** 업무 항목 쓰기(행위자 = 지금 문맥 — 표가 AI 만 허락한다). 틀리면 던진다(아무것도 쓰지 않는다) */
    writeWork(event: string, args: any): { item: string; event: string } {
        this.writableProject();
        const lines = this.read('work').lines;
        const prep = prepareWork(event, args, lines);
        this.append('work', { id: prep.id, event: prep.event, actor: toActor(this.ctx(), 'program'), body: prep.body as any });
        return { item: prep.id, event: prep.event };
    }
    /** 가정 쓰기 — AI(문맥) 또는 프로그램의 자동 가정(origin program-*, 행위자 program) */
    writeAssumption(event: string, args: any, origin: 'ai' | 'program-default' | 'program-engine' = 'ai'): { item: string; event: string } {
        this.writableProject();
        const lines = this.read('assumptions').lines;
        const prep = prepareAssumption(event, args, lines, origin);
        const actor: Actor = origin === 'ai' ? toActor(this.ctx(), 'program') : { kind: 'program' };
        this.append('assumptions', { id: prep.id, event: prep.event, actor, body: prep.body as any });
        return { item: prep.id, event: prep.event };
    }
    /** 프로그램이 닫는 자동 가정(원인이 사라짐 — 그 변경 · 실행 id) */
    closeProgramAssumption(item: string, closedBy?: string): void {
        this.writableProject();
        const lines = this.read('assumptions').lines;
        const prep = prepareAssumption('close', { item, ...(closedBy ? { closedBy } : {}) }, lines, 'program-default');
        this.append('assumptions', { id: prep.id, event: prep.event, actor: { kind: 'program' }, body: prep.body as any });
    }
    /** 원자료 등록 · 갱신(`01_원자료/` 안의 상대경로만 — 내용은 읽지 않고 해시만) */
    writeSource(event: string, args: any): { item: string; event: string } {
        const p = this.writableProject();
        const lines = this.read('sources').lines;
        const prep = prepareSource(p.dir, event, args, lines);
        this.append('sources', { id: prep.id, event: prep.event, actor: toActor(this.ctx(), 'program'), body: prep.body as any });
        return { item: prep.id, event: prep.event };
    }
    /** 원자료마다 지금 파일과 견준 상태 · 등록 안 된 파일(상대경로) — 내용은 주지 않는다 */
    sourceStates(): { states: Map<string, 'same' | 'changed' | 'missing' | 'unreadable'>; unregistered: string[] } {
        const p = this.proj;
        if (!p) { return { states: new Map(), unregistered: [] }; }
        const items = foldSources(this.recordLines('sources').lines);
        const states = new Map(items.map((s) => [s.item, sourceState(p.dir, s)] as [string, 'same' | 'changed' | 'missing' | 'unreadable']));
        return { states, unregistered: listUnregistered(p.dir, items) };
    }
    /** 지금 대상 id(쓸 수 있을 때) */
    writableCaseId(): string | null { const c = this.cur; return c && !c.readOnly && this.proj && !this.proj.readOnly ? c.caseId : null; }
    /** 지금 대상 · 종류의 실행 id(새 것부터) — 업무 항목의 기준 */
    recentRunIds(limit = 5): string[] {
        if (!this.proj || !this.cur) { return []; }
        try { return foldRuns(this.read('runs').lines).filter((r) => r.caseId === this.cur!.caseId).slice(-limit).reverse().map((r) => r.runId); } catch { return []; }
    }

    // ── 사람만(얼굴 `person` 이 감싼다) ─────────────────────────────────

    private takeLock(caseId: string): LockInfo {
        const p = this.proj;
        if (!p || p.readOnly) { throw new Error('no writable project is open'); }
        const info = takeOver(p.dir, caseId, { writer: this.writer(), name: this.nameOfWriter(), host: this.env.host, pid: this.pid, now: this.env.now() });
        if (this.cur && this.cur.caseId === caseId) { this.cur.lockHeld = true; this.cur.readOnly = false; this.cur.readOnlyReason = null; this.cur.lock = info; }
        return info;
    }

    private projectList(): Array<{ name: string; dir: string; cases: number; lastWork: string | null; open: boolean }> {
        const all = this.projectDirs();
        const page = this.listProjects({ limit: 100 }).projects;
        return all.slice(0, 100).map((p, i) => ({ name: p.name, dir: p.dir, cases: page[i]?.cases ?? 0, lastWork: page[i]?.lastWork ?? null, open: !!this.proj && this.proj.dir === p.dir }));
    }

    private relink(caseId: string, fileAbs: string): { caseId: string; file: string } {
        const p = this.proj;
        if (!p || p.readOnly) { throw new Error('no writable project is open'); }
        if (!CASE_ID_RE.test(caseId)) { throw new Error('bad case id'); }
        const fold = this.casesFold();
        const e = fold.get(caseId);
        if (!e) { throw new Error('no such case'); }
        const rel = projectRelative(p.dir, fileAbs);
        if (!rel || !caseFileOk(rel)) { throw new RecordsPathError(`only a .csd in ${FOLDERS.cases}/ of this project can be linked`); }
        assertNoLinks(p.dir, path.resolve(fileAbs));
        assertSingleLink(fileAbs);
        const st = fs.lstatSync(fileAbs);
        if (!st.isFile()) { throw new RecordsPathError('not a plain file'); }
        const other = [...fold.values()].find((c) => c.caseId !== caseId && c.file.toLowerCase() === rel.toLowerCase());
        if (other) { throw new Error(`that file belongs to the case '${other.name}'`); }
        this.append('cases', { id: this.newLineId('case'), event: 'relink', actor: { kind: 'person' }, body: { caseId, file: rel } });
        return { caseId, file: rel };
    }

    private allowOverwrite(): { fileSha: string } {
        const c = this.cur, p = this.proj;
        if (!c || !p || c.readOnly || p.readOnly) { throw new Error('no writable case is open'); }
        const buf = this.readFile(c.abs, CSD_HASH_MAX_BYTES);
        if (!buf) { throw new Error('the case file is missing — save under another name'); }
        const fileSha = sha256Hex(buf);
        if (fileSha !== c.knownSha) {
            this.append('cases', { id: this.newLineId('case'), event: 'external', actor: { kind: 'program' }, body: { caseId: c.caseId, fileSha } });
            c.knownSha = fileSha;
        }
        return { fileSha };
    }

    private archive(caseId: string, archived: boolean): void {
        if (!CASE_ID_RE.test(caseId)) { throw new Error('bad case id'); }
        if (!this.casesFold().has(caseId)) { throw new Error('no such case'); }
        this.append('cases', { id: this.newLineId('case'), event: archived ? 'archive' : 'unarchive', actor: { kind: 'person' }, body: { caseId } });
    }

    /** 놓기 — 잠금 · 줄 파일 */
    dispose(): void { this.closeProject(); }
}
