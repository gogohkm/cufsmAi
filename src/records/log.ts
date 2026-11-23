/**
 * 기록(R1-1) · 줄 파일 — 설계 §2.1 · §2.2 · §4.5, V7-20 – 22 · 26 · 29 · 33 · 34 고침(§10.2).
 *
 * `<프로젝트>/.stcfsd/log/<종류>/<작성자>[-k][.n].jsonl` — 종류마다 · 작성자마다 덧붙이기만 하는 JSONL.
 *
 * 줄 하나 = 정규 JSON 한 줄. 서명 안에 든 것: 종류 · 판(`schema`), **프로젝트 id · 줄 파일 이름(`stream`)** · 순번(`seq`) ·
 * 앞 줄(`prev` — 앞 줄의 정규 글의 sha256) · 행위자 · 몸. 그래서 줄을 다른 프로젝트 · 다른 종류의 폴더 · 다른 줄 파일 · 다른 자리로
 * 옮기면 맞지 않는다.
 *
 *  - 읽기: 줄 끝의 CR 과 조각 맨 앞의 BOM 만 벗긴다(그 밖의 꼴은 바꾸지 않는다). 벗긴 글이 그 값의 정규 JSON 과 **같아야** 한다
 *    (겹친 키 · `1.0e0` · 2^53 을 넘는 정수 · 다른 이스케이프는 깨진 줄). 그래서 CRLF 로 바뀐 파일도 같은 해시 · 같은 서명이다.
 *  - 사슬: 서명이 맞는 줄만 사슬에 든다. 서명 없는 줄 · 꾸민 줄은 **그 줄만** 잃는다(앞뒤의 검증된 줄은 그대로 이어진다).
 *    검증된 줄의 순번이 건너뛰면 틈(`gaps`)을 알리고 그 줄에서 다시 잇는다. 같거나 앞선 순번(되풀이)은 `chain` — 세지 않는다.
 *  - 쓰기: 꼬리는 **검증된 자기 줄**에서만 잇는다 — 심은 줄이 다음 순번을 정하지 못한다. 조각 번호는 2 – 999, 다음 조각은 비어 있는
 *    번호(심은 파일은 건너뛴다). 줄 파일 소유 표지(`.owner`)는 이 PC 의 열쇠로 서명한다 — 서명 없는 표지는 무시하고 넘겨받는다.
 *  - 줄었나: 믿는 작성자마다(이 PC 의 것만이 아니라) 줄 파일의 본 끝(seq · 해시)을 열쇠 자리의 `seen/` 에 둔다(V7-26).
 *  - 행위자: `policy.ts` 의 표 밖이면 쓰지 않고, 읽은 줄은 `refused`.
 * 파일에서 읽은 것은 쓰는 자리를 정하지 않는다 — 자리는 뿌리 + 상수 + 작성자 id(이 PC 의 열쇠에서). VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { canonicalJson, FP_RE, parseCanonicalLine, sha256Hex } from './canonical';
import { assertNoLinks, assertSingleLink, mkdirInside, readBounded, writeAtomic } from './fsx';
import { ID_RE } from './names';
import { actorAllowed } from './policy';
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
export const MAX_SEGMENT = 999;
const ENVELOPE_KEYS = ['schema', 'seq', 'id', 'event', 'at', 'project', 'stream', 'actor', 'prev', 'sig'];
const STREAM_RE = /^w[a-z2-7]{20}(?:-[2-9])?$/;
const SEGMENT_RE = /^(w[a-z2-7]{20}(?:-[2-9])?)(?:\.([2-9]|[1-9][0-9]{1,2}))?\.jsonl$/;
const OWNER_PREFIX = 'stcfsd-owner/1\n';

export interface LogSpec {
    type: RecordType;
    major: number;
    events: readonly string[];
    /** 읽은 줄의 몸 — 알려진 키만 남겨 돌려준다. 맞지 않으면 null(깨진 줄로 센다) */
    sanitize?: (event: string, body: Record<string, any>) => Record<string, any> | null;
}

/**
 * ok — 서명 · 자리 · 행위자가 맞고 믿는 작성자. untrusted — 서명은 맞으나 믿지 않는 작성자. unverified — 서명이 없거나 틀림.
 * chain — 서명은 맞으나 자리가 틀림(다른 줄 파일 이름 · 되풀이된 순번). refused — 서명은 맞으나 그 행위자가 쓸 수 없는 사건.
 * **세는(접는) 것은 ok 뿐이다.**
 */
export type LineStatus = 'ok' | 'untrusted' | 'unverified' | 'chain' | 'refused';
export interface RecordLine {
    schema: string; seq: number; id: string; event: string; at: string; project: string; actor: Actor; prev: string | null;
    sig: { w: string; s: string };
    body: Record<string, any>;
    stream: string;
    status: LineStatus;
}
export interface ReadStats {
    broken: number; nonCanonical: number; oversized: number; unknownEvent: number; newer: number;
    unverified: number; untrusted: number; misplaced: number; refused: number;
    /** 검증된 줄 사이의 틈(지운 줄 · 바꿔 친 줄 · 차례를 바꾼 줄) — 그 뒤의 검증된 줄에서 다시 잇는다 */
    chainBreaks: Array<{ stream: string; atSeq: number; afterSeq?: number }>;
    shrunk: Array<{ stream: string; expectedSeq: number; foundSeq: number }>;
    skippedFiles: string[];
}
export interface ReadResult { lines: RecordLine[]; stats: ReadStats; readOnly: boolean }

/** 프로젝트 전체 읽기 한도를 여러 줄 파일이 함께 쓴다 */
export class ReadBudget { constructor(public remaining: number) {} take(n: number): boolean { if (n > this.remaining) { return false; } this.remaining -= n; return true; } }

// ── 본 끝(seen) — 열쇠 자리, 줄 파일마다 파일 하나 ─────────────────────

const SEEN_DIR = 'seen';
interface SeenEntry { seq: number; hash: string }
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

const lineHash = (canonicalText: string): string => 'sha256:' + sha256Hex(Buffer.from(canonicalText, 'utf8'));
function segName(stream: string, n: number): string { return n <= 1 ? `${stream}.jsonl` : `${stream}.${n}.jsonl`; }

/** 조각 글 → 줄들(CR · 맨 앞 BOM 만 벗긴다) */
function splitLines(text: string): string[] {
    const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return t.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.trim() !== '');
}

interface Parsed { v: any; text: string; seg: number }
type LineCheck = { kind: 'broken' | 'nonCanonical' | 'oversized' } | { kind: 'parsed'; p: Parsed };

function checkRaw(raw: string, seg: number, limits: LogLimits): LineCheck {
    if (Buffer.byteLength(raw, 'utf8') > limits.lineBytes) { return { kind: 'oversized' }; }
    const r = parseCanonicalLine(raw);
    if (!r.ok) { return { kind: r.reason === 'not JSON' ? 'broken' : 'nonCanonical' }; }
    return { kind: 'parsed', p: { v: r.value, text: raw, seg } };
}

function envelopeOk(v: any, projectId: string, type: RecordType): boolean {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { return false; }
    const sm = typeof v.schema === 'string' ? /^stcfsd-rec\/([a-z]+)\/([0-9]+)$/.exec(v.schema) : null;
    return !!sm && sm[1] === type && Number.isSafeInteger(v.seq) && v.seq >= 1 && typeof v.id === 'string' && ID_RE.test(v.id)
        && typeof v.event === 'string' && v.event.length <= 32 && typeof v.at === 'string' && v.at.length <= 40 && v.project === projectId
        && typeof v.stream === 'string' && STREAM_RE.test(v.stream)
        && !!v.actor && typeof v.actor === 'object' && !Array.isArray(v.actor) && (ACTOR_KINDS as readonly string[]).includes(v.actor.kind)
        && (v.prev === null || (typeof v.prev === 'string' && FP_RE.test(v.prev)))
        && !!v.sig && typeof v.sig === 'object' && typeof v.sig.w === 'string' && typeof v.sig.s === 'string' && v.sig.s.length <= 128;
}

interface WalkOut {
    entries: Array<{ p: Parsed; status: 'linked' | 'unverified' | 'misplaced' | 'replay' }>;
    gaps: Array<{ afterSeq: number; atSeq: number }>;
    last: { seq: number; hash: string | null; seg: number };
    hashes: Map<number, string>;
}
/**
 * 한 줄 파일의 사슬 — 서명이 맞는 줄만 잇는다. `verify` 는 서명 · 작성자 · 줄 파일 이름을 본다.
 * 심은 줄(서명 없음)은 그 줄만 잃는다. 검증된 줄이 순번을 건너뛰면 틈을 알리고 거기서 다시 잇는다.
 */
function walkChain(stream: string, parsed: Parsed[], verify: (v: any) => boolean): WalkOut {
    const out: WalkOut = { entries: [], gaps: [], last: { seq: 0, hash: null, seg: 1 }, hashes: new Map() };
    for (const p of parsed) {
        const v = p.v;
        if (!verify(v)) { out.entries.push({ p, status: 'unverified' }); continue; }
        if (v.stream !== stream || v.sig.w !== stream.split('-')[0]) { out.entries.push({ p, status: 'misplaced' }); continue; }
        if (v.seq <= out.last.seq) { out.entries.push({ p, status: 'replay' }); continue; }
        if (v.seq !== out.last.seq + 1 || (v.prev ?? null) !== out.last.hash) { out.gaps.push({ afterSeq: out.last.seq, atSeq: v.seq }); }
        const h = lineHash(p.text);
        out.last = { seq: v.seq, hash: h, seg: p.seg };
        out.hashes.set(v.seq, h);
        out.entries.push({ p, status: 'linked' });
    }
    return out;
}

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

    constructor(private readonly o: RecordLogOptions) {
        this.dir = path.join(o.rootReal, DATA_DIR, 'log', o.spec.type);
        this.limits = { ...DEFAULT_LIMITS, ...(o.limits || {}) };
    }

    get streamName(): string | null { return this.stream; }
    private get pid(): number { return this.o.pid ?? process.pid; }
    private seenKey(stream: string): string { return `${this.o.projectId}/${this.o.spec.type}/${stream}`; }
    private now(): string { return (this.o.now ?? (() => new Date().toISOString()))(); }

    /** 소유 표지 — 이 PC 의 열쇠로 서명. 서명이 맞지 않는 표지는 없는 것으로 본다(V7-29) */
    private ownerOf(owner: string, w: Writer): { pid: number; host: string } | null {
        try {
            const buf = readBounded(owner, 4096);
            const raw = buf ? JSON.parse(buf.toString('utf8')) : null;
            if (!raw || typeof raw !== 'object' || !raw.sig || typeof raw.sig !== 'string') { return null; }
            const { sig, ...body } = raw;
            if (!verifySig(w.publicKey, OWNER_PREFIX + canonicalJson(body), sig)) { return null; }
            return Number.isSafeInteger(body.pid) && typeof body.host === 'string' ? { pid: body.pid, host: body.host } : null;
        } catch { return null; }
    }

    /** 쓸 줄 파일을 쥔다. 이 PC 의 산 다른 프로세스가 서명한 표지로 쥐고 있으면 다음 이름(-2 … -9) */
    open(writer: Writer): string {
        if (this.stream) { return this.stream; }
        if (!WRITER_RE.test(writer.writerId)) { throw new Error('bad writer id'); }
        mkdirInside(this.o.rootReal, this.dir);
        for (let k = 1; k <= 9; k += 1) {
            const stream = k === 1 ? writer.writerId : `${writer.writerId}-${k}`;
            const owner = path.join(this.dir, `${stream}.owner`);
            const body = { pid: this.pid, host: this.o.host, startedAt: this.now(), stream };
            const me = JSON.stringify({ ...body, sig: writer.sign(OWNER_PREFIX + canonicalJson(body)) });
            for (let attempt = 0; attempt < 2; attempt += 1) {
                assertNoLinks(this.o.rootReal, owner);
                try {
                    fs.writeFileSync(owner, me, { flag: 'wx' });
                    this.stream = stream; this.writer = writer;
                    return stream;
                } catch (e: any) { if (e?.code !== 'EEXIST') { throw e; } }
                const held = this.ownerOf(owner, writer);
                if (held && held.host === this.o.host && held.pid === this.pid) { this.stream = stream; this.writer = writer; return stream; }
                if (held && held.host === this.o.host && pidAlive(held.pid)) { break; }   // 이 PC 의 산 다른 프로세스 — 다음 이름
                try { fs.unlinkSync(owner); } catch { /* 다른 프로세스가 먼저 */ }        // 서명 없음 · 죽은 pid · 다른 PC — 넘겨받기
            }
        }
        throw new Error('no free record stream for this writer (9 live processes of this PC hold one)');
    }

    /** 줄 파일을 놓는다(`.owner` 를 지운다 — 자기 것일 때만) */
    close(): void {
        if (!this.stream || !this.writer) { this.stream = null; this.writer = null; return; }
        const owner = path.join(this.dir, `${this.stream}.owner`);
        const held = this.ownerOf(owner, this.writer);
        if (held && held.pid === this.pid && held.host === this.o.host) { try { fs.unlinkSync(owner); } catch { /* 없음 */ } }
        this.stream = null; this.writer = null;
    }

    /** 한 줄 파일의 조각들(번호 차례) */
    private segmentsOf(stream: string, report?: string[]): Array<{ n: number; name: string }> {
        const out: Array<{ n: number; name: string }> = [];
        let ents: fs.Dirent[];
        try { ents = fs.readdirSync(this.dir, { withFileTypes: true }); } catch { return out; }
        for (const d of ents) {
            const m = SEGMENT_RE.exec(d.name);
            if (!m || m[1] !== stream) { continue; }
            if (!d.isFile()) { report?.push(d.name); continue; }
            out.push({ n: m[2] ? Number(m[2]) : 1, name: d.name });
        }
        return out.sort((a, b) => a.n - b.n);
    }

    /** 자기 줄 파일의 검증된 끝(V7-20 — 서명 없는 줄은 꼬리를 정하지 못한다) */
    private ownTail(): { seq: number; hash: string | null; seg: number } {
        const stream = this.stream!;
        const w = this.writer!;
        const parsed: Parsed[] = [];
        for (const seg of this.segmentsOf(stream)) {
            let buf: Buffer | null;
            try { buf = readBounded(path.join(this.dir, seg.name), this.limits.streamReadBytes); } catch { continue; }
            if (!buf) { continue; }
            for (const raw of splitLines(buf.toString('utf8'))) {
                const c = checkRaw(raw, seg.n, this.limits);
                if (c.kind === 'parsed' && envelopeOk(c.p.v, this.o.projectId, this.o.spec.type)) { parsed.push(c.p); }
            }
        }
        const walk = walkChain(stream, parsed, (v) => v.sig.w === w.writerId && verifySig(w.publicKey, signingBytes(v), v.sig.s));
        return walk.last;
    }

    /** 줄 하나를 쓴다. 몸에 겉모양 키가 있거나 사건을 모르거나 행위자가 표 밖이거나 너무 크면 던진다(쓰지 않는다) */
    append(entry: { id: string; event: string; actor: Actor; body: Record<string, unknown>; at?: string }): RecordLine {
        if (!this.stream || !this.writer) { throw new Error('record stream is not open'); }
        const { spec } = this.o;
        if (!spec.events.includes(entry.event)) { throw new Error(`unknown event '${entry.event}' for ${spec.type}`); }
        if (!ID_RE.test(entry.id)) { throw new Error('bad record id'); }
        if (!entry.actor || !(ACTOR_KINDS as readonly string[]).includes(entry.actor.kind)) { throw new Error('bad actor'); }
        if (!actorAllowed(spec.type, entry.event, entry.actor.kind)) { throw new Error(`actor '${entry.actor.kind}' may not write ${spec.type}/${entry.event}`); }
        for (const k of Object.keys(entry.body)) { if (ENVELOPE_KEYS.includes(k)) { throw new Error(`body may not carry '${k}'`); } }
        if (spec.sanitize && spec.sanitize(entry.event, entry.body as any) === null) { throw new Error(`body does not match ${spec.type}/${entry.event}`); }
        mkdirInside(this.o.rootReal, this.dir);
        const tail = this.ownTail();
        const unsigned: Record<string, unknown> = {
            ...entry.body,
            schema: `stcfsd-rec/${spec.type}/${spec.major}`, seq: tail.seq + 1, id: entry.id, event: entry.event,
            at: entry.at ?? this.now(), project: this.o.projectId, stream: this.stream, actor: entry.actor, prev: tail.hash,
        };
        const sig = { w: this.writer.writerId, s: this.writer.sign(signingBytes(unsigned)) };
        const text = canonicalJson({ ...unsigned, sig });
        if (!parseCanonicalLine(text).ok) { throw new Error('record line would not read back (forbidden key or unsafe integer)'); }
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > this.limits.lineBytes) { throw new Error(`record line is ${bytes} bytes (limit ${this.limits.lineBytes}) — refused, not truncated`); }
        // 조각: 검증된 끝의 조각. 차면 다음 빈 번호(심은 파일은 건너뛴다 — V7-22)
        let seg = tail.seg;
        const sizeOf = (n: number): number | null => { try { return fs.lstatSync(path.join(this.dir, segName(this.stream!, n))).size; } catch { return null; } };
        const cur = sizeOf(seg) ?? 0;
        if (cur > 0 && cur + bytes + 1 > this.limits.segmentBytes) {
            seg += 1;
            while (seg <= MAX_SEGMENT && sizeOf(seg) !== null) { seg += 1; }
        }
        if (seg > MAX_SEGMENT) { throw new Error('record stream is full (999 segments)'); }
        const file = path.join(this.dir, segName(this.stream, seg));
        assertNoLinks(this.o.rootReal, file);
        assertSingleLink(file);
        let prefix = '';
        const size = sizeOf(seg) ?? 0;
        if (size > 0) {
            const fd = fs.openSync(file, 'r');
            try { const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, size - 1); if (b[0] !== 0x0a) { prefix = '\n'; } } finally { fs.closeSync(fd); }
        }
        fs.appendFileSync(file, `${prefix}${text}\n`, { encoding: 'utf8', flag: 'a' });
        const hash = lineHash(text);
        if (this.o.keyDir) { writeSeen(this.o.keyDir, this.seenKey(this.stream), { seq: tail.seq + 1, hash }); }
        return toRecordLine(JSON.parse(text), this.stream, 'ok');
    }

    /**
     * 모든 작성자의 줄을 읽는다. 믿는 작성자의 줄 파일은 본 끝을 `seen/` 에 남긴다(`recordSeen: false` 면 남기지 않는다).
     */
    read(trust: TrustStore, cards: Map<string, WriterCard> = new Map(), budget?: ReadBudget, opts: { recordSeen?: boolean } = {}): ReadResult {
        const { spec } = this.o;
        const stats: ReadStats = { broken: 0, nonCanonical: 0, oversized: 0, unknownEvent: 0, newer: 0, unverified: 0, untrusted: 0, misplaced: 0,
            refused: 0, chainBreaks: [], shrunk: [], skippedFiles: [] };
        const out: RecordLine[] = [];
        let ents: fs.Dirent[];
        try {
            assertNoLinks(this.o.rootReal, this.dir);
            ents = fs.readdirSync(this.dir, { withFileTypes: true });
        } catch { ents = []; }
        const streams = new Set<string>();
        for (const d of ents) {
            const m = SEGMENT_RE.exec(d.name);
            if (m) { streams.add(m[1]); } else if (/^w.*\.jsonl$/.test(d.name)) { stats.skippedFiles.push(d.name); }
        }
        const projectBudget = budget ?? new ReadBudget(this.limits.projectReadBytes);
        const prefix = `${this.o.projectId}/${spec.type}/`;
        const seen = this.o.keyDir ? readSeen(this.o.keyDir, prefix) : {};
        for (const stream of [...streams].sort()) {
            const writerId = stream.split('-')[0];
            const card = cards.get(writerId);
            const key = trust.writers[writerId]?.publicKey ?? (card && card.writerId === writerId && verifyWriterCard(card) ? card.publicKey : null);
            const trusted = !!trust.writers[writerId];
            const parsed: Parsed[] = [];
            let streamBytes = 0;
            let truncatedRead = false;
            for (const seg of this.segmentsOf(stream, stats.skippedFiles)) {
                let buf: Buffer | null;
                try { buf = readBounded(path.join(this.dir, seg.name), this.limits.streamReadBytes); } catch { stats.skippedFiles.push(seg.name); truncatedRead = true; continue; }
                if (!buf) { continue; }
                streamBytes += buf.length;
                if (streamBytes > this.limits.streamReadBytes || !projectBudget.take(buf.length)) { stats.skippedFiles.push(seg.name); truncatedRead = true; break; }
                for (const raw of splitLines(buf.toString('utf8'))) {
                    const c = checkRaw(raw, seg.n, this.limits);
                    if (c.kind !== 'parsed') { stats[c.kind] += 1; if (c.kind === 'oversized') { stats.broken += 1; } continue; }
                    if (!envelopeOk(c.p.v, this.o.projectId, spec.type)) { stats.broken += 1; continue; }
                    parsed.push(c.p);
                }
            }
            const walk = walkChain(stream, parsed, (v) => v.sig.w === writerId && !!key && verifySig(key, signingBytes(v), v.sig.s));
            for (const g of walk.gaps) { stats.chainBreaks.push({ stream, atSeq: g.atSeq, afterSeq: g.afterSeq }); }
            for (const e of walk.entries) {
                const v = e.p.v;
                if (e.status !== 'linked') {
                    // 세지 않는 줄 — 보이기만(몸은 다듬은 것, 맞지 않으면 빈 몸)
                    if (e.status === 'unverified') { stats.unverified += 1; } else { stats.misplaced += 1; }
                    const l = toRecordLine(v, stream, e.status === 'unverified' ? 'unverified' : 'chain');
                    let b: Record<string, any> | null;
                    try { b = spec.sanitize ? spec.sanitize(v.event, l.body) : l.body; } catch { b = null; }
                    l.body = b ?? {};
                    out.push(l);
                    continue;
                }
                if (Number(/\/([0-9]+)$/.exec(v.schema)![1]) > spec.major) { stats.newer += 1; continue; }
                if (!spec.events.includes(v.event)) { stats.unknownEvent += 1; continue; }
                let status: LineStatus = trusted ? 'ok' : 'untrusted';
                if (!actorAllowed(spec.type, v.event, v.actor.kind)) { status = 'refused'; stats.refused += 1; }
                else if (!trusted) { stats.untrusted += 1; }
                const line = toRecordLine(v, stream, status);
                const body = spec.sanitize ? spec.sanitize(v.event, line.body) : line.body;
                if (!body) { stats.broken += 1; continue; }
                line.body = body;
                out.push(line);
            }
            // 줄었나 — 믿는 작성자의 줄 파일(이 PC 의 것 포함)
            if (trusted && this.o.keyDir) {
                const k = this.seenKey(stream);
                const s = seen[k];
                if (s && (walk.last.seq < s.seq || walk.hashes.get(s.seq) !== s.hash)) {
                    stats.shrunk.push({ stream, expectedSeq: s.seq, foundSeq: walk.last.seq });
                } else if (opts.recordSeen !== false && !truncatedRead && walk.last.hash && (!s || walk.last.seq > s.seq)) {
                    try { writeSeen(this.o.keyDir, k, { seq: walk.last.seq, hash: walk.last.hash }); } catch { /* 다음 읽기에 */ }
                }
            }
        }
        for (const [k, s] of Object.entries(seen)) {
            const st = k.slice(prefix.length);
            if (!streams.has(st)) { stats.shrunk.push({ stream: st, expectedSeq: s.seq, foundSeq: 0 }); }
        }
        out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.seq - b.seq));
        return { lines: out, stats, readOnly: stats.newer > 0 };
    }
}

function toRecordLine(v: any, stream: string, status: LineStatus): RecordLine {
    const body: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
        if (ENVELOPE_KEYS.includes(k)) { continue; }
        // 프로토타입을 바꾸지 않게 정의로 넣는다(V7-33 — 읽기 길은 그런 키를 이미 거절한다)
        Object.defineProperty(body, k, { value: val, enumerable: true, writable: true, configurable: true });
    }
    const actor: Actor = { kind: v.actor?.kind };
    for (const k of ['client', 'request', 'tool'] as const) { if (typeof v.actor?.[k] === 'string') { actor[k] = String(v.actor[k]).slice(0, 80); } }
    return { schema: v.schema, seq: v.seq, id: v.id, event: v.event, at: v.at, project: v.project, actor, prev: v.prev ?? null,
        sig: { w: String(v.sig?.w ?? ''), s: String(v.sig?.s ?? '') }, body, stream, status };
}

/** 사람만 하는 기록 · 발행을 막는 상태로 셀 수 있는 줄인가 — 검증되고 · 자리가 맞고 · 믿는 작성자 · 표 안의 행위자 */
export function countable(line: RecordLine): boolean { return line.status === 'ok'; }

/** 세지 않는 줄들 — 화면이 「검증 안 된 기록」으로 따로 보인다(사실로 보이지 않는다) */
export function unverifiedEntries(lines: RecordLine[]): Array<{ id: string; event: string; at: string; writer: string; stream: string; status: LineStatus }> {
    return lines.filter((l) => !countable(l)).map((l) => ({ id: l.id, event: l.event, at: String(l.at).slice(0, 40), writer: l.sig.w, stream: l.stream, status: l.status }));
}
