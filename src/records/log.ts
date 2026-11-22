/**
 * 기록(R1-1) · 줄 파일 — 설계 §2.1 · §2.2 · §4.5.
 *
 * `<프로젝트>/.stcfsd/log/<종류>/<작성자>[-k][.n].jsonl` — 종류마다 · 작성자마다 덧붙이기만 하는 JSONL.
 *  - 쓰기: 이 프로세스가 가진 줄 파일 하나(`.owner` 를 `wx` 로 — 같은 작성자의 다른 프로세스가 쥐고 있으면 `-2` … `-9`).
 *    줄마다 `seq`(1부터 빠짐없이) · `prev`(앞 줄 바이트의 sha256) · Ed25519 서명. 줄은 정규 JSON 한 줄, 64 KB 까지(넘으면 거절 —
 *    자르지 않는다). 파일 끝이 줄바꿈이 아니면(반쯤 쓴 줄) 줄을 바꿔 쓴다. 조각이 8 MB 를 넘으면 다음 조각(`.2.jsonl`)으로
 *    잇는다(사슬은 이어진다).
 *  - 읽기: 이름 꼴이 맞는 보통 파일만(링크 무시), 크기 한도. 줄마다 겉모양 → 사슬(조각을 이어서) → 서명 → 종류의 몸 검사.
 *    깨진 줄 · 모르는 사건 · 높은 주 판 · 검증 안 됨 · 사슬 끊김을 센다. 이 PC 가 쓴 줄 파일은 `seen.json`(열쇠 자리)과
 *    대조해 줄었는지 본다.
 *  - 파일에서 읽은 것은 쓰는 자리를 정하지 않는다 — 자리는 뿌리 + 상수 + 작성자 id(이 PC 의 열쇠에서).
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { canonicalJson, FP_RE, sha256Hex } from './canonical';
import { assertNoLinks, mkdirInside, readBounded, writeAtomic } from './fsx';
import { ID_RE } from './names';
import { signingBytes, verifySig, verifyWriterCard, Writer, WriterCard, TrustStore, WRITER_RE } from './writer';

export const DATA_DIR = '.stcfsd';
export const RECORD_TYPES = ['cases', 'changes', 'runs', 'work', 'assumptions', 'sources', 'reviews', 'alternatives', 'documents'] as const;
export type RecordType = typeof RECORD_TYPES[number];
export const ACTOR_KINDS = ['ai', 'person', 'screen', 'program', 'file', 'external'] as const;
export type ActorKind = typeof ACTOR_KINDS[number];
export interface Actor { kind: ActorKind; client?: string; request?: string; tool?: string }

export interface LogLimits { lineBytes: number; segmentBytes: number; streamReadBytes: number; projectReadBytes: number }
export const DEFAULT_LIMITS: LogLimits = {
    lineBytes: 64 * 1024, segmentBytes: 8 * 1024 * 1024, streamReadBytes: 32 * 1024 * 1024, projectReadBytes: 256 * 1024 * 1024,
};
const ENVELOPE_KEYS = ['schema', 'seq', 'id', 'event', 'at', 'project', 'actor', 'prev', 'sig'];
const SEGMENT_RE = /^(w[a-z2-7]{20}(?:-[2-9])?)(?:\.([2-9]|[1-9][0-9]{1,3}))?\.jsonl$/;

export interface LogSpec {
    type: RecordType;
    major: number;
    events: readonly string[];
    /** 읽은 줄의 몸 — 알려진 키만 남겨 돌려준다. 맞지 않으면 null(깨진 줄로 센다) */
    sanitize?: (event: string, body: Record<string, any>) => Record<string, any> | null;
}

export type LineStatus = 'ok' | 'untrusted' | 'unverified' | 'chain';
export interface RecordLine {
    schema: string; seq: number; id: string; event: string; at: string; project: string; actor: Actor; prev: string | null;
    sig: { w: string; s: string };
    body: Record<string, any>;
    stream: string;
    status: LineStatus;
}
export interface ReadStats {
    broken: number; oversized: number; unknownEvent: number; newer: number; unverified: number; untrusted: number;
    chainBreaks: Array<{ stream: string; atSeq: number }>;
    shrunk: Array<{ stream: string; expectedSeq: number; foundSeq: number }>;
    skippedFiles: string[];
}
export interface ReadResult { lines: RecordLine[]; stats: ReadStats; readOnly: boolean }

/** 프로젝트 전체 읽기 한도를 여러 줄 파일이 함께 쓴다 */
export class ReadBudget { constructor(public remaining: number) {} take(n: number): boolean { if (n > this.remaining) { return false; } this.remaining -= n; return true; } }

// ── 이 PC 가 본 마지막 줄(seen.json — 열쇠 자리) ─────────────────────

const SEEN_DIR = 'seen';
interface SeenEntry { seq: number; hash: string }
/**
 * 줄 파일마다 파일 하나(`<열쇠 자리>/seen/<projectId>.<종류>.<줄 파일>.json`) — 그 줄 파일을 쥔 프로세스만 쓴다
 * (한 파일을 여러 프로세스가 바꿔 쓰면 Windows 의 rename 이 부딪친다 — 두 프로세스 시험에서 봄).
 */
const seenName = (key: string): string => key.split('/').join('.') + '.json';
function readSeen(keyDir: string, prefix: string): Record<string, SeenEntry> {
    const out: Record<string, SeenEntry> = {};
    const dir = path.join(path.resolve(keyDir), SEEN_DIR);
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return out; }
    const filePrefix = prefix.split('/').join('.');
    for (const name of names) {
        if (!name.startsWith(filePrefix) || !name.endsWith('.json')) { continue; }
        try {
            const buf = readBounded(path.join(dir, name), 4096);
            const raw = buf ? JSON.parse(buf.toString('utf8')) : null;
            if (raw && raw.schema === 'stcfsd-seen/1' && typeof raw.key === 'string' && raw.key.startsWith(prefix) && seenName(raw.key) === name
                && Number.isSafeInteger(raw.seq) && typeof raw.hash === 'string' && FP_RE.test(raw.hash)) {
                out[raw.key] = { seq: raw.seq, hash: raw.hash };
            }
        } catch { /* 깨진 표지는 없는 것으로 */ }
    }
    return out;
}
function writeSeen(keyDir: string, key: string, e: SeenEntry): void {
    const base = fs.realpathSync.native(path.resolve(keyDir));
    const dir = path.join(base, SEEN_DIR);
    mkdirInside(base, dir);
    writeAtomic(base, path.join(dir, seenName(key)), JSON.stringify({ schema: 'stcfsd-seen/1', key, seq: e.seq, hash: e.hash }), 0o600);
}

function pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

const lineHash = (text: string): string => 'sha256:' + sha256Hex(Buffer.from(text, 'utf8'));
function segName(stream: string, n: number): string { return n <= 1 ? `${stream}.jsonl` : `${stream}.${n}.jsonl`; }

export interface RecordLogOptions {
    rootReal: string;
    projectId: string;
    spec: LogSpec;
    host: string;
    pid?: number;
    keyDir?: string;
    limits?: Partial<LogLimits>;
    now?: () => string;
}

export class RecordLog {
    readonly dir: string;
    private readonly limits: LogLimits;
    private stream: string | null = null;
    private writer: Writer | null = null;
    private tail: { seq: number; hash: string | null; seg: number; size: number; mtimeMs: number } | null = null;

    constructor(private readonly o: RecordLogOptions) {
        this.dir = path.join(o.rootReal, DATA_DIR, 'log', o.spec.type);
        this.limits = { ...DEFAULT_LIMITS, ...(o.limits || {}) };
    }

    get streamName(): string | null { return this.stream; }
    private get pid(): number { return this.o.pid ?? process.pid; }
    private seenKey(stream: string): string { return `${this.o.projectId}/${this.o.spec.type}/${stream}`; }

    /** 쓸 줄 파일을 쥔다(`.owner` 를 `wx`). 같은 작성자의 산 프로세스가 쥐고 있으면 다음 이름 */
    open(writer: Writer): string {
        if (this.stream) { return this.stream; }
        if (!WRITER_RE.test(writer.writerId)) { throw new Error('bad writer id'); }
        mkdirInside(this.o.rootReal, this.dir);
        for (let k = 1; k <= 9; k += 1) {
            const stream = k === 1 ? writer.writerId : `${writer.writerId}-${k}`;
            const owner = path.join(this.dir, `${stream}.owner`);
            const me = JSON.stringify({ pid: this.pid, host: this.o.host, startedAt: (this.o.now ?? (() => new Date().toISOString()))() });
            for (let attempt = 0; attempt < 2; attempt += 1) {
                assertNoLinks(this.o.rootReal, owner);
                try {
                    fs.writeFileSync(owner, me, { flag: 'wx' });
                    this.stream = stream; this.writer = writer; this.tail = null;
                    return stream;
                } catch (e: any) {
                    if (e?.code !== 'EEXIST') { throw e; }
                }
                let held: any;
                try { held = JSON.parse((readBounded(owner, 4096) || Buffer.from('null')).toString('utf8')); } catch { held = null; }
                const sameHost = held && held.host === this.o.host;
                if (sameHost && held.pid === this.pid) { this.stream = stream; this.writer = writer; this.tail = null; return stream; }
                if (sameHost && Number.isSafeInteger(held.pid) && !pidAlive(held.pid)) {
                    try { fs.unlinkSync(owner); } catch { /* 다른 프로세스가 먼저 */ }
                    continue;   // 한 번 더
                }
                break;          // 산 프로세스 · 다른 PC · 읽을 수 없는 표지 — 다음 이름
            }
        }
        throw new Error('no free record stream for this writer (9 in use)');
    }

    /** 줄 파일을 놓는다(`.owner` 를 지운다 — 자기 것일 때만) */
    close(): void {
        if (!this.stream) { return; }
        const owner = path.join(this.dir, `${this.stream}.owner`);
        try {
            const held = JSON.parse((readBounded(owner, 4096) || Buffer.from('null')).toString('utf8'));
            if (held && held.pid === this.pid && held.host === this.o.host) { fs.unlinkSync(owner); }
        } catch { /* 없음 */ }
        this.stream = null; this.writer = null; this.tail = null;
    }

    /** 자기 줄 파일의 끝(순번 · 마지막 줄 해시 · 조각). 바뀌었으면 다시 읽는다 */
    private ownTail(): { seq: number; hash: string | null; seg: number; size: number; mtimeMs: number } {
        const stream = this.stream!;
        let maxSeg = 1;
        for (const name of fs.readdirSync(this.dir)) {
            const m = SEGMENT_RE.exec(name);
            if (m && m[1] === stream) { maxSeg = Math.max(maxSeg, m[2] ? Number(m[2]) : 1); }
        }
        const file = path.join(this.dir, segName(stream, maxSeg));
        let st: fs.Stats | null;
        try { st = fs.lstatSync(file); } catch { st = null; }
        if (this.tail && st && this.tail.seg === maxSeg && this.tail.size === st.size && this.tail.mtimeMs === st.mtimeMs) { return this.tail; }
        let seq = 0;
        let hash: string | null = null;
        for (let n = 1; n <= maxSeg; n += 1) {
            const buf = readBounded(path.join(this.dir, segName(stream, n)), this.limits.streamReadBytes);
            if (!buf) { continue; }
            for (const raw of buf.toString('utf8').split('\n')) {
                if (!raw.trim()) { continue; }
                try {
                    const v = JSON.parse(raw);
                    if (v && Number.isSafeInteger(v.seq) && v.seq > seq) { seq = v.seq; hash = lineHash(raw); }
                } catch { /* 반쯤 쓴 줄 — 사슬에 들지 않는다 */ }
            }
        }
        this.tail = { seq, hash, seg: maxSeg, size: st ? st.size : 0, mtimeMs: st ? st.mtimeMs : 0 };
        return this.tail;
    }

    /** 줄 하나를 쓴다. 몸에 겉모양 키가 있거나 사건을 모르거나 너무 크면 던진다(쓰지 않는다) */
    append(entry: { id: string; event: string; actor: Actor; body: Record<string, unknown>; at?: string }): RecordLine {
        if (!this.stream || !this.writer) { throw new Error('record stream is not open'); }
        const { spec } = this.o;
        if (!spec.events.includes(entry.event)) { throw new Error(`unknown event '${entry.event}' for ${spec.type}`); }
        if (!ID_RE.test(entry.id)) { throw new Error('bad record id'); }
        if (!entry.actor || !(ACTOR_KINDS as readonly string[]).includes(entry.actor.kind)) { throw new Error('bad actor'); }
        for (const k of Object.keys(entry.body)) { if (ENVELOPE_KEYS.includes(k)) { throw new Error(`body may not carry '${k}'`); } }
        if (spec.sanitize && spec.sanitize(entry.event, entry.body as any) === null) { throw new Error(`body does not match ${spec.type}/${entry.event}`); }
        mkdirInside(this.o.rootReal, this.dir);
        const tail = this.ownTail();
        const unsigned: Record<string, unknown> = {
            ...entry.body,
            schema: `stcfsd-rec/${spec.type}/${spec.major}`, seq: tail.seq + 1, id: entry.id, event: entry.event,
            at: entry.at ?? (this.o.now ?? (() => new Date().toISOString()))(), project: this.o.projectId,
            actor: entry.actor, prev: tail.hash,
        };
        const sig = { w: this.writer.writerId, s: this.writer.sign(signingBytes(unsigned)) };
        const text = canonicalJson({ ...unsigned, sig });
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > this.limits.lineBytes) { throw new Error(`record line is ${bytes} bytes (limit ${this.limits.lineBytes}) — refused, not truncated`); }
        let seg = tail.seg;
        if (tail.size > 0 && tail.size + bytes + 1 > this.limits.segmentBytes) { seg += 1; }
        const file = path.join(this.dir, segName(this.stream, seg));
        assertNoLinks(this.o.rootReal, file);
        let prefix = '';
        if (seg === tail.seg && tail.size > 0) {
            const fd = fs.openSync(file, 'r');
            try { const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, tail.size - 1); if (b[0] !== 0x0a) { prefix = '\n'; } } finally { fs.closeSync(fd); }
        }
        fs.appendFileSync(file, `${prefix}${text}\n`, { encoding: 'utf8', flag: 'a' });
        const st = fs.lstatSync(file);
        const hash = lineHash(text);
        this.tail = { seq: tail.seq + 1, hash, seg, size: st.size, mtimeMs: st.mtimeMs };
        if (this.o.keyDir) {
            writeSeen(this.o.keyDir, this.seenKey(this.stream), { seq: tail.seq + 1, hash });
        }
        const line = JSON.parse(text);
        return toRecordLine(line, this.stream, 'ok');
    }

    /** 모든 작성자의 줄을 읽는다 */
    read(trust: TrustStore, cards: Map<string, WriterCard> = new Map(), budget?: ReadBudget): ReadResult {
        const { spec } = this.o;
        const stats: ReadStats = { broken: 0, oversized: 0, unknownEvent: 0, newer: 0, unverified: 0, untrusted: 0, chainBreaks: [], shrunk: [], skippedFiles: [] };
        const out: RecordLine[] = [];
        let entries: fs.Dirent[];
        try {
            assertNoLinks(this.o.rootReal, this.dir);
            entries = fs.readdirSync(this.dir, { withFileTypes: true });
        } catch { entries = []; }
        const streams = new Map<string, Array<{ n: number; name: string }>>();
        for (const d of entries) {
            const m = SEGMENT_RE.exec(d.name);
            if (!m) { continue; }
            if (!d.isFile()) { stats.skippedFiles.push(d.name); continue; }   // 링크 · 폴더
            const list = streams.get(m[1]) || [];
            list.push({ n: m[2] ? Number(m[2]) : 1, name: d.name });
            streams.set(m[1], list);
        }
        const projectBudget = budget ?? new ReadBudget(this.limits.projectReadBytes);
        const seen = this.o.keyDir ? readSeen(this.o.keyDir, `${this.o.projectId}/${spec.type}/`) : {};
        const seenStreams = new Set<string>();
        for (const [stream, segs] of streams) {
            seenStreams.add(stream);
            segs.sort((a, b) => a.n - b.n);
            const writerId = stream.split('-')[0];
            const key = trust.writers[writerId]?.publicKey ?? (cards.get(writerId) && verifyWriterCard(cards.get(writerId)!) ? cards.get(writerId)!.publicKey : null);
            const trusted = !!trust.writers[writerId];
            let streamBytes = 0;
            let expectSeq = 1;
            let prevHash: string | null = null;
            let broken = false;
            const hashes = new Map<number, string>();
            for (const seg of segs) {
                let buf: Buffer | null;
                try { buf = readBounded(path.join(this.dir, seg.name), this.limits.streamReadBytes); } catch { stats.skippedFiles.push(seg.name); broken = true; continue; }
                if (!buf) { continue; }
                streamBytes += buf.length;
                if (streamBytes > this.limits.streamReadBytes || !projectBudget.take(buf.length)) { stats.skippedFiles.push(seg.name); if (!broken) { stats.chainBreaks.push({ stream, atSeq: expectSeq }); } break; }
                for (const raw of buf.toString('utf8').split('\n')) {
                    if (!raw.trim()) { continue; }
                    if (Buffer.byteLength(raw, 'utf8') > this.limits.lineBytes) { stats.oversized += 1; stats.broken += 1; continue; }
                    let v: any;
                    try { v = JSON.parse(raw); } catch { stats.broken += 1; continue; }
                    const env = envelopeError(v, this.o.projectId);
                    if (env === 'type' || env === 'shape') { stats.broken += 1; continue; }
                    const sm = /^stcfsd-rec\/([a-z]+)\/([0-9]+)$/.exec(v.schema);
                    if (!sm || sm[1] !== spec.type) { stats.broken += 1; continue; }
                    // 사슬 — 겉모양이 맞는 줄은 모두 사슬에 든다(모르는 사건 · 높은 판 포함)
                    const h = lineHash(raw);
                    if (!broken && (v.seq !== expectSeq || (v.prev ?? null) !== prevHash)) {
                        broken = true;
                        stats.chainBreaks.push({ stream, atSeq: v.seq });
                    }
                    if (!broken) { hashes.set(v.seq, h); }
                    expectSeq = v.seq + 1;
                    prevHash = h;
                    if (Number(sm[2]) > spec.major) { stats.newer += 1; continue; }
                    if (!spec.events.includes(v.event)) { stats.unknownEvent += 1; continue; }
                    // 서명
                    let status: LineStatus;
                    const sigOk = v.sig.w === writerId && !!key && verifySig(key, signingBytes(v), v.sig.s);
                    if (!sigOk) { status = 'unverified'; stats.unverified += 1; }
                    else if (broken) { status = 'chain'; }
                    else if (!trusted) { status = 'untrusted'; stats.untrusted += 1; }
                    else { status = 'ok'; }
                    const line = toRecordLine(v, stream, status);
                    const body = spec.sanitize ? spec.sanitize(v.event, line.body) : line.body;
                    if (!body) { stats.broken += 1; continue; }
                    line.body = body;
                    out.push(line);
                }
            }
            // 이 PC 가 쓴 줄 파일 — 줄었나
            const s = seen[this.seenKey(stream)];
            if (s) {
                const found = Math.max(0, ...hashes.keys());
                if (found < s.seq || hashes.get(s.seq) !== s.hash) { stats.shrunk.push({ stream, expectedSeq: s.seq, foundSeq: found }); }
            }
        }
        const prefix = `${this.o.projectId}/${spec.type}/`;
        for (const [k, s] of Object.entries(seen)) {
            if (k.startsWith(prefix) && !seenStreams.has(k.slice(prefix.length))) { stats.shrunk.push({ stream: k.slice(prefix.length), expectedSeq: s.seq, foundSeq: 0 }); }
        }
        out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.sig.w < b.sig.w ? -1 : a.sig.w > b.sig.w ? 1 : a.seq - b.seq));
        return { lines: out, stats, readOnly: stats.newer > 0 };
    }
}

function envelopeError(v: any, projectId: string): null | 'type' | 'shape' {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { return 'type'; }
    if (typeof v.schema !== 'string' || !Number.isSafeInteger(v.seq) || v.seq < 1 || typeof v.id !== 'string' || !ID_RE.test(v.id)
        || typeof v.event !== 'string' || v.event.length > 32 || typeof v.at !== 'string' || v.at.length > 40 || v.project !== projectId
        || !v.actor || typeof v.actor !== 'object' || !(ACTOR_KINDS as readonly string[]).includes(v.actor.kind)
        || !(v.prev === null || (typeof v.prev === 'string' && FP_RE.test(v.prev)))
        || !v.sig || typeof v.sig.w !== 'string' || typeof v.sig.s !== 'string' || v.sig.s.length > 128) { return 'shape'; }
    return null;
}

function toRecordLine(v: any, stream: string, status: LineStatus): RecordLine {
    const body: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) { if (!ENVELOPE_KEYS.includes(k)) { body[k] = val; } }
    const actor: Actor = { kind: v.actor.kind };
    for (const k of ['client', 'request', 'tool'] as const) { if (typeof v.actor[k] === 'string') { actor[k] = String(v.actor[k]).slice(0, 80); } }
    return { schema: v.schema, seq: v.seq, id: v.id, event: v.event, at: v.at, project: v.project, actor, prev: v.prev ?? null,
        sig: { w: v.sig.w, s: v.sig.s }, body, stream, status };
}

/** 사람만 하는 기록으로 셀 수 있는 줄인가(검증되고 믿는 작성자 · 사슬이 이어짐) */
export function countable(line: RecordLine): boolean { return line.status === 'ok'; }
