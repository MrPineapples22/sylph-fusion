import { createHash } from 'node:crypto';

// Minimal independent implementation of the published v1 canonical codec.
export function encode(value) {
  if (value === null) return 'null;';
  if (typeof value === 'boolean') return value ? 'boolean:true;' : 'boolean:false;';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('number');
    return `number:${JSON.stringify(Object.is(value, -0) ? 0 : value)};`;
  }
  if (typeof value === 'string') return `string:${JSON.stringify(value)};`;
  if (Array.isArray(value)) return `array:${value.map(encode).join('')}end-array;`;
  if (value && typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `object:{${Object.keys(value).sort().map(key => `${encode(key)}${encode(value[key])}`).join('')}}end-object;`;
  }
  throw new TypeError('unsupported value');
}

export function instructionHash(sourceFields) {
  return createHash('sha256').update('SYLPH_CPI_INSTRUCTION\0v1\0').update(encode(sourceFields), 'utf8').digest('hex');
}

export function traceHash(payload) {
  return createHash('sha256').update('SYLPH_CPI_TRACE\0v1\0').update(encode(payload), 'utf8').digest('hex');
}
