/**
 * SYLPH FUSION — CANONICAL ENCODING V1 (CROSS-LANGUAGE BINARY ENCODING)
 * Specifications: Blueprint Section 12 (Cross-Language Canonical Encoding)
 *
 * Provides bit-exact, locale-independent, cross-language binary encoding
 * between TypeScript and Rust for all canonical hash roots and proof verification.
 */
import { createHash } from 'node:crypto';
export const TYPE_TAGS = {
    NULL: 0x00,
    BOOL_FALSE: 0x01,
    BOOL_TRUE: 0x02,
    U64: 0x03,
    I64: 0x04,
    BIGINT: 0x05,
    STRING_UTF8: 0x06,
    BYTE_STRING: 0x07,
    ARRAY: 0x08,
    MAP: 0x09,
    SET: 0x0a,
};
export function encodeCanonicalV1(value) {
    if (value === null || value === undefined) {
        return Buffer.from([TYPE_TAGS.NULL]);
    }
    if (typeof value === 'boolean') {
        return Buffer.from([value ? TYPE_TAGS.BOOL_TRUE : TYPE_TAGS.BOOL_FALSE]);
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            if (value >= 0) {
                const buf = Buffer.alloc(9);
                buf[0] = TYPE_TAGS.U64;
                buf.writeBigUInt64BE(BigInt(value), 1);
                return buf;
            }
            else {
                const buf = Buffer.alloc(9);
                buf[0] = TYPE_TAGS.I64;
                buf.writeBigInt64BE(BigInt(value), 1);
                return buf;
            }
        }
        // Floating point numbers encoded as 8-byte IEEE 754 BE
        const buf = Buffer.alloc(9);
        buf[0] = 0x0b; // FLOAT64
        buf.writeDoubleBE(value, 1);
        return buf;
    }
    if (typeof value === 'bigint') {
        const isNeg = value < 0n;
        const absVal = isNeg ? -value : value;
        let hex = absVal.toString(16);
        if (hex.length % 2 !== 0)
            hex = '0' + hex;
        const mag = Buffer.from(hex, 'hex');
        const header = Buffer.alloc(6);
        header[0] = TYPE_TAGS.BIGINT;
        header[1] = isNeg ? 0x01 : 0x00;
        header.writeUInt32BE(mag.length, 2);
        return Buffer.concat([header, mag]);
    }
    if (typeof value === 'string') {
        const utf8 = Buffer.from(value, 'utf-8');
        const header = Buffer.alloc(5);
        header[0] = TYPE_TAGS.STRING_UTF8;
        header.writeUInt32BE(utf8.length, 1);
        return Buffer.concat([header, utf8]);
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const bytes = Buffer.from(value);
        const header = Buffer.alloc(5);
        header[0] = TYPE_TAGS.BYTE_STRING;
        header.writeUInt32BE(bytes.length, 1);
        return Buffer.concat([header, bytes]);
    }
    if (Array.isArray(value)) {
        const encodedItems = value.map((item) => encodeCanonicalV1(item));
        const header = Buffer.alloc(5);
        header[0] = TYPE_TAGS.ARRAY;
        header.writeUInt32BE(encodedItems.length, 1);
        return Buffer.concat([header, ...encodedItems]);
    }
    if (value instanceof Set) {
        const encodedItems = Array.from(value).map((item) => encodeCanonicalV1(item));
        // Sort strictly by byte comparison
        encodedItems.sort((a, b) => a.compare(b));
        const header = Buffer.alloc(5);
        header[0] = TYPE_TAGS.SET;
        header.writeUInt32BE(encodedItems.length, 1);
        return Buffer.concat([header, ...encodedItems]);
    }
    if (typeof value === 'object') {
        const entries = [];
        const keys = Object.keys(value);
        for (const k of keys) {
            const v = value[k];
            entries.push({
                keyBuf: encodeCanonicalV1(k),
                valBuf: encodeCanonicalV1(v),
            });
        }
        // Sort by key byte comparison
        entries.sort((a, b) => a.keyBuf.compare(b.keyBuf));
        const pairs = [];
        for (const e of entries) {
            pairs.push(e.keyBuf, e.valBuf);
        }
        const header = Buffer.alloc(5);
        header[0] = TYPE_TAGS.MAP;
        header.writeUInt32BE(entries.length, 1);
        return Buffer.concat([header, ...pairs]);
    }
    throw new Error(`CANONICAL_ENCODING_UNSUPPORTED_TYPE: ${typeof value}`);
}
export function hashCanonicalV1(value) {
    const bytes = encodeCanonicalV1(value);
    return createHash('sha256').update(bytes).digest('hex');
}
//# sourceMappingURL=canonical-encoding-v1.js.map