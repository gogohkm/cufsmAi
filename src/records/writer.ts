/**
 * 기록(R1-1) · 작성자 열쇠 · 서명 · 믿음 — 설계 §2.2 · §3.5, 결정 D5.
 *
 * 열쇠의 자리(`keyDir`)는 **늘 주입한다**. 독립 프로그램 · 확장은 `defaultKeyDir()`(`%LOCALAPPDATA%\StCFSD\records` —
 * Roaming 이 아닌 Local: PC 마다 다른 작성자)을 넘기고, 시험은 임시 폴더를 넘긴다. 이 모듈은 스스로 그 자리를 고르지 않는다.
 *
 *  - 처음 쓸 때: `writer.key` 가 없으면 Ed25519 열쇠 쌍을 만들어 PKCS8 PEM 으로 `wx`(0600) 로 쓴다. 폴더는 열쇠 자리 하나만 만든다.
 *  - 열쇠 파일을 읽을 수 없거나(깨짐 · 링크 · 폴더 · 너무 큼 · Ed25519 가 아님) → `KeyUnavailableError`. **새로 만들지 않는다**
 *    (말없이 바꾸면 작성자가 바뀌어 이 PC 의 기록이 남의 것처럼 된다). 호스트는 기록을 쓰지 않고 알린다.
 *  - 다른 올바른 열쇠로 바뀌었으면 → 작성자 id 가 바뀐다(공개 열쇠의 해시). 옛 작성자의 줄은 `trust.json` 에 남은 옛 공개 열쇠로
 *    계속 검증된다. 새 열쇠는 처음 열 때 `self` 로 믿음에 오른다(열쇠 폴더를 쓸 수 있는 것은 위협 모델 밖 — 설계 §3.5).
 *  - 비밀 열쇠는 이 모듈의 닫힌 변수에만 있다. `Writer` 는 `writerId` · `publicKey`(SPKI base64) · `sign(bytes)` 만 내놓고,
 *    비밀 열쇠를 돌려주는 함수는 없다. 객체를 JSON 으로 만들어도 열쇠가 나오지 않는다.
 * VS Code 를 쓰지 않는다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify, KeyObject } from 'crypto';
import { canonicalJson, sha256Hex } from './canonical';
import { readBounded, writeAtomic } from './fsx';
import { cleanHeaderText } from './names';

export const KEY_FILE = 'writer.key';
export const TRUST_FILE = 'trust.json';
export const SIG_PREFIX = 'stcfsd-rec-sig/1\n';
export const WRITER_RE = /^w[a-z2-7]{20}$/;

export class KeyUnavailableError extends Error {}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** base32(소문자, 채움 없음) */
export function base32(buf: Buffer): string {
    let bits = 0, value = 0, out = '';
    for (const b of buf) {
        value = (value << 8) | b; bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) { out += B32[(value << (5 - bits)) & 31]; }
    return out;
}

/** 작성자 id = `w` + base32(sha256(공개 열쇠 SPKI DER)) 앞 20자 */
export function writerIdOf(publicKeySpkiB64: string): string {
    return 'w' + base32(Buffer.from(sha256Hex(Buffer.from(publicKeySpkiB64, 'base64')), 'hex')).slice(0, 20);
}

/** 기본 열쇠 자리 — 호출하는 쪽(호스트)만 쓴다. 이 함수는 폴더를 만들지 않는다 */
export function defaultKeyDir(env: NodeJS.ProcessEnv = process.env): string {
    const base = env.LOCALAPPDATA || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local') : path.join(os.homedir(), '.local', 'share'));
    return path.join(base, 'StCFSD', 'records');
}

export interface Writer {
    readonly writerId: string;
    readonly publicKey: string;
    /** 서명(base64). 비밀 열쇠는 닫힌 변수에만 */
    sign(data: string | Buffer): string;
}

function makeWriter(priv: KeyObject): Writer {
    const pub = createPublicKey(priv).export({ type: 'spki', format: 'der' }).toString('base64');
    const id = writerIdOf(pub);
    const w: Writer = Object.freeze({
        writerId: id,
        publicKey: pub,
        sign: (data: string | Buffer) => edSign(null, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), priv).toString('base64'),
    });
    return w;
}

function ensureKeyDir(keyDir: string): string {
    const abs = path.resolve(keyDir);
    try {
        const st = fs.lstatSync(abs);
        if (st.isSymbolicLink() || !st.isDirectory()) { throw new KeyUnavailableError('the key folder is not a plain folder'); }
    } catch (e: any) {
        if (e instanceof KeyUnavailableError) { throw e; }
        if (e?.code !== 'ENOENT') { throw new KeyUnavailableError(`the key folder cannot be opened (${e?.code || e})`); }
        fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
    }
    return fs.realpathSync.native(abs);
}

/** 열쇠를 읽거나(있으면) 처음이면 만든다. 읽을 수 없으면 던진다 — 새로 만들지 않는다 */
export function loadOrCreateWriter(keyDir: string): Writer {
    const dir = ensureKeyDir(keyDir);
    const file = path.join(dir, KEY_FILE);
    let pem: Buffer | null;
    try { pem = readBounded(file, 16 * 1024); } catch (e: any) { throw new KeyUnavailableError(`the writer key cannot be read (${e?.message || e})`); }
    if (pem === null) {
        // V7-28: 다 쓴 임시 파일을 링크(있으면 실패 — 원자적)로 그 이름에 건다. 반쯤 쓴 열쇠를 남이 읽거나, 쓰다 죽어 빈 열쇠가
        // 남는 일이 없다. 링크를 못 거는 파일 시스템이면 같은 폴더의 rename 으로(그때는 없을 때만 — 겹친 순간에는 한쪽이 진다).
        const { privateKey } = generateKeyPairSync('ed25519');
        const out = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const tmp = path.join(dir, `.${KEY_FILE}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
        try {
            const fd = fs.openSync(tmp, 'wx', 0o600);
            try { fs.writeSync(fd, String(out)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            try { fs.linkSync(tmp, file); } catch (e: any) {
                if (e?.code === 'EEXIST') { return loadOrCreateWriter(keyDir); }   // 다른 프로세스가 먼저 — 그 열쇠를 쓴다
                if (!['EPERM', 'ENOTSUP', 'EXDEV', 'EINVAL', 'ENOSYS'].includes(e?.code) || fs.existsSync(file)) { throw e; }
                fs.renameSync(tmp, file);
            }
        } catch (e: any) {
            throw new KeyUnavailableError(`the writer key cannot be created (${e?.code || e?.message || e})`);
        } finally {
            try { fs.unlinkSync(tmp); } catch { /* 이미 옮겨졌다 */ }
        }
        return makeWriter(privateKey);
    }
    let priv: KeyObject;
    const recovery = ` — ${file}. Records are not written until it is fixed: restore it from a backup, or delete it to start a new writer `
        + '(lines written with the old key stay verifiable through trust.json).';
    if (pem.length === 0 || !/-----END PRIVATE KEY-----\s*$/.test(pem.toString('utf8'))) {
        throw new KeyUnavailableError(`the writer key file is empty or incomplete${recovery}`);
    }
    try { priv = createPrivateKey({ key: pem, format: 'pem' }); } catch { throw new KeyUnavailableError(`the writer key file is not a key${recovery}`); }
    if (priv.asymmetricKeyType !== 'ed25519') { throw new KeyUnavailableError('the writer key is not an Ed25519 key'); }
    return makeWriter(priv);
}

/** 서명할 바이트 — 줄에서 `sig` 를 뺀 정규 JSON */
export function signingBytes(line: Record<string, unknown>): string {
    const { sig: _sig, ...rest } = line;
    return SIG_PREFIX + canonicalJson(rest);
}

export function verifySig(publicKeySpkiB64: string, data: string, sigB64: string): boolean {
    try {
        const key = createPublicKey({ key: Buffer.from(publicKeySpkiB64, 'base64'), format: 'der', type: 'spki' });
        if (key.asymmetricKeyType !== 'ed25519') { return false; }
        return edVerify(null, Buffer.from(data, 'utf8'), key, Buffer.from(sigB64, 'base64'));
    } catch { return false; }
}

// ── 믿음 ─────────────────────────────────────────────────────────────

export interface TrustEntry { publicKey: string; name: string; trustedAt: string; by: 'self' | 'person' }
export interface TrustStore { schema: 'stcfsd-trust/1'; writers: Record<string, TrustEntry> }

/** `trust.json` — 알려진 키만 읽는다. 없거나 깨졌으면 빈 것(깨진 것은 `broken`) */
export function readTrust(keyDir: string): { store: TrustStore; broken: boolean } {
    const empty: TrustStore = { schema: 'stcfsd-trust/1', writers: {} };
    let buf: Buffer | null;
    try { buf = readBounded(path.join(path.resolve(keyDir), TRUST_FILE), 256 * 1024); } catch { return { store: empty, broken: true }; }
    if (!buf) { return { store: empty, broken: false }; }
    try {
        const raw = JSON.parse(buf.toString('utf8'));
        if (!raw || raw.schema !== 'stcfsd-trust/1' || typeof raw.writers !== 'object' || raw.writers === null) { return { store: empty, broken: true }; }
        const writers: Record<string, TrustEntry> = {};
        for (const [id, e] of Object.entries(raw.writers as Record<string, any>)) {
            if (!WRITER_RE.test(id) || !e || typeof e.publicKey !== 'string' || writerIdOf(e.publicKey) !== id) { continue; }
            if (e.by !== 'self' && e.by !== 'person') { continue; }
            writers[id] = { publicKey: e.publicKey, name: cleanHeaderText(e.name, 60) ?? '', trustedAt: String(e.trustedAt ?? ''), by: e.by };
        }
        return { store: { schema: 'stcfsd-trust/1', writers }, broken: false };
    } catch { return { store: empty, broken: true }; }
}

function writeTrust(keyDir: string, store: TrustStore): void {
    const dir = fs.realpathSync.native(path.resolve(keyDir));
    writeAtomic(dir, path.join(dir, TRUST_FILE), JSON.stringify(store, null, 1), 0o600);
}

/** 자기 작성자를 믿음에 올린다(처음 열 때). 이미 있으면 그대로 */
export function trustSelf(keyDir: string, w: Writer, name: string, at: string): TrustStore {
    const { store } = readTrust(keyDir);
    if (!store.writers[w.writerId]) {
        store.writers[w.writerId] = { publicKey: w.publicKey, name: cleanHeaderText(name, 60) ?? '', trustedAt: at, by: 'self' };
        writeTrust(keyDir, store);
    }
    return store;
}

/** 사람이 다른 작성자를 믿거나 거둔다(R4 의 사람만 하는 길에서만 부른다) */
export function setTrust(keyDir: string, card: WriterCard, trust: boolean, at: string): TrustStore {
    if (!verifyWriterCard(card)) { throw new Error('the writer card does not verify'); }
    const { store } = readTrust(keyDir);
    if (trust) { store.writers[card.writerId] = { publicKey: card.publicKey, name: card.name, trustedAt: at, by: 'person' }; }
    else if (store.writers[card.writerId]?.by === 'person') { delete store.writers[card.writerId]; }
    writeTrust(keyDir, store);
    return store;
}

// ── 작성자 소개(프로젝트의 .stcfsd/writers/<id>.json) ─────────────────

export interface WriterCard {
    schema: 'stcfsd-writer/1'; writerId: string; publicKey: string; name: string; host: string; createdAt: string;
    sig: { w: string; s: string };
}

export function makeWriterCard(w: Writer, name: string, host: string, at: string): WriterCard {
    const body = { schema: 'stcfsd-writer/1' as const, writerId: w.writerId, publicKey: w.publicKey,
        name: cleanHeaderText(name, 60) ?? '', host: cleanHeaderText(host, 64) ?? '', createdAt: at };
    return { ...body, sig: { w: w.writerId, s: w.sign(signingBytes(body)) } };
}

/** 소개 카드 — 알려진 키만, 자기 서명 확인. 맞지 않으면 null */
export function readWriterCard(raw: unknown): WriterCard | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const r = raw as any;
    if (r.schema !== 'stcfsd-writer/1' || typeof r.writerId !== 'string' || !WRITER_RE.test(r.writerId) || typeof r.publicKey !== 'string'
        || r.publicKey.length > 200 || !r.sig || typeof r.sig.s !== 'string' || r.sig.w !== r.writerId) { return null; }
    const card: WriterCard = {
        schema: 'stcfsd-writer/1', writerId: r.writerId, publicKey: r.publicKey,
        name: cleanHeaderText(r.name, 60) ?? '', host: cleanHeaderText(r.host, 64) ?? '', createdAt: String(r.createdAt ?? '').slice(0, 40),
        sig: { w: r.sig.w, s: String(r.sig.s).slice(0, 128) },
    };
    return verifyWriterCard(card) && card.name === r.name && card.host === r.host ? card : null;
}

export function verifyWriterCard(card: WriterCard): boolean {
    if (writerIdOf(card.publicKey) !== card.writerId) { return false; }
    return verifySig(card.publicKey, signingBytes(card as any), card.sig.s);
}
