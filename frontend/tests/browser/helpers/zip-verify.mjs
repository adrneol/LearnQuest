/** Minimal ZIP reader (stored entries only) used by the export browser probe. */
export function listZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65558; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const total = view.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = eocd - centralSize;
  const names = [];
  for (let n = 0; n < total; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('central directory signature mismatch');
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    names.push(dec.decode(bytes.subarray(offset + 46, offset + 46 + nameLen)));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function unzipSync(bytes, wantName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65558; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const total = view.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = eocd - centralSize;
  for (let n = 0; n < total; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('central directory signature mismatch');
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = dec.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (name === wantName) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      return bytes.slice(dataStart, dataStart + size);
    }
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry ${wantName} not found`);
}
