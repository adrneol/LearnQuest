/**
 * Minimal, dependency-free ZIP writer (stored, no compression).
 *
 * Used by the human-readable account export. No external package is required:
 * every entry is stored verbatim, so the produced archive opens in any modern
 * unzip tool, including the OS file manager. Deterministic output; entries are
 * written in the order given.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive, without leading slash. */
  path: string;
  /** UTF-8 text content. */
  data: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (Math.floor(date.getUTCSeconds() / 2));
  const d = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, date: d };
}

function writeUInt16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeUInt32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/** Build an uncompressed ZIP archive from UTF-8 text entries. */
export function buildZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const prepared = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.path);
    const dataBytes = encoder.encode(entry.data);
    return { nameBytes, dataBytes, crc: crc32(dataBytes) };
  });

  let offset = 0;
  const localChunks: Uint8Array[] = [];
  const centralEntries: { nameBytes: Uint8Array; crc: number; size: number; localOffset: number }[] = [];
  const { time, date } = dosDateTime(now);

  for (const item of prepared) {
    const local = new Uint8Array(30 + item.nameBytes.length);
    const view = new DataView(local.buffer);
    // Local file header signature + version + flags
    writeUInt32(view, 0, 0x04034b50);
    writeUInt16(view, 4, 20); // version needed
    writeUInt16(view, 6, 0x0800); // UTF-8 flag
    writeUInt16(view, 8, 0); // method 0 = store
    writeUInt16(view, 10, time);
    writeUInt16(view, 12, date);
    writeUInt32(view, 14, item.crc);
    writeUInt32(view, 18, item.dataBytes.length);
    writeUInt32(view, 22, item.dataBytes.length);
    writeUInt16(view, 26, item.nameBytes.length);
    writeUInt16(view, 28, 0); // extra length
    local.set(item.nameBytes, 30);
    localChunks.push(local, item.dataBytes);
    centralEntries.push({ nameBytes: item.nameBytes, crc: item.crc, size: item.dataBytes.length, localOffset: offset });
    offset += local.length + item.dataBytes.length;
  }

  let centralSize = 0;
  const centralChunks: Uint8Array[] = [];
  for (const item of centralEntries) {
    const central = new Uint8Array(46 + item.nameBytes.length);
    const view = new DataView(central.buffer);
    writeUInt32(view, 0, 0x02014b50);
    writeUInt16(view, 4, 20); // version made by
    writeUInt16(view, 6, 20); // version needed
    writeUInt16(view, 8, 0x0800);
    writeUInt16(view, 10, 0);
    writeUInt16(view, 12, time);
    writeUInt16(view, 14, date);
    writeUInt32(view, 16, item.crc);
    writeUInt32(view, 20, item.size);
    writeUInt32(view, 24, item.size);
    writeUInt16(view, 28, item.nameBytes.length);
    writeUInt16(view, 30, 0); // extra
    writeUInt16(view, 32, 0); // comment
    writeUInt16(view, 34, 0); // disk number
    writeUInt16(view, 36, 0); // internal attrs
    writeUInt32(view, 38, 0); // external attrs
    writeUInt32(view, 42, item.localOffset);
    central.set(item.nameBytes, 46);
    centralChunks.push(central);
    centralSize += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUInt32(endView, 0, 0x06054b50);
  writeUInt16(endView, 4, 0); // disk
  writeUInt16(endView, 6, 0); // central dir disk
  writeUInt16(endView, 8, centralEntries.length);
  writeUInt16(endView, 10, centralEntries.length);
  writeUInt32(endView, 12, centralSize);
  writeUInt32(endView, 16, offset);
  writeUInt16(endView, 20, 0); // comment length

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of localChunks) { out.set(chunk, cursor); cursor += chunk.length; }
  for (const chunk of centralChunks) { out.set(chunk, cursor); cursor += chunk.length; }
  out.set(end, cursor);
  return out;
}

/** Build the bytes and trigger a browser download. Replaces the unused anchor cleanly. */
export function downloadZip(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
