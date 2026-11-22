/**
 * 기록(R1-1) · 정규 JSON 과 지문 — docs/implementation/20261124-records-design.md §2.2 · §2.3.
 *
 *  - 정규 JSON: 객체의 키를 정렬, 공백 없음, 수는 JS `JSON.stringify` 의 꼴. NaN · ±∞ · bigint · 함수 · 심볼은 던진다
 *    (조용히 null 로 바꾸면 다른 값이 같은 지문이 된다). 객체 안의 `undefined` 는 JSON 처럼 뺀다, 배열 안의 `undefined` 는 던진다.
 *  - 글은 바꾸지 않는다(NFC 정규화는 경로 · 이름에만 — names.ts).
 *  - fp(ns, v) = "sha256:" + hex(sha256(정규JSON({ns, v}))) — 이름공간이 달라 다른 종류의 지문이 같아지지 않는다.
 * VS Code 를 쓰지 않는다. 파일을 읽거나 쓰지 않는다.
 */
import { createHash } from 'crypto';

export class CanonicalError extends Error {}

function enc(v: unknown, path: string): string {
    if (v === null) { return 'null'; }
    switch (typeof v) {
        case 'string': return JSON.stringify(v);
        case 'boolean': return v ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(v)) { throw new CanonicalError(`not a finite number at ${path || '(root)'}`); }
            return JSON.stringify(v);
        case 'object': {
            if (Array.isArray(v)) {
                return '[' + v.map((x, i) => {
                    if (x === undefined) { throw new CanonicalError(`undefined in array at ${path}[${i}]`); }
                    return enc(x, `${path}[${i}]`);
                }).join(',') + ']';
            }
            const proto = Object.getPrototypeOf(v);
            if (proto !== Object.prototype && proto !== null) {
                throw new CanonicalError(`not a plain object at ${path || '(root)'}`);
            }
            const keys = Object.keys(v as object).filter((k) => (v as any)[k] !== undefined).sort();
            return '{' + keys.map((k) => JSON.stringify(k) + ':' + enc((v as any)[k], path ? `${path}.${k}` : k)).join(',') + '}';
        }
        default:
            throw new CanonicalError(`unsupported ${typeof v} at ${path || '(root)'}`);
    }
}

/** 정규 JSON 글 */
export function canonicalJson(v: unknown): string { return enc(v, ''); }

export function sha256Hex(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

export const FP_RE = /^sha256:[0-9a-f]{64}$/;

/** 지문 — 이름공간 ns 와 값 */
export function fp(ns: string, v: unknown): string {
    return 'sha256:' + sha256Hex(canonicalJson({ ns, v }));
}

/** 정규 JSON 으로 깊게 복제(지문과 같은 규칙 — 던질 수 있다) */
export function canonicalClone<T>(v: T): T { return JSON.parse(canonicalJson(v)) as T; }
