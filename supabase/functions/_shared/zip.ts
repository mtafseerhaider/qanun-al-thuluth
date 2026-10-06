/**
 * Minimal ZIP writer (PKZIP 2.0, deflate via the platform `CompressionStream('deflate-raw')`), used
 * by `account-export` for the data bundle (06 §4.12). No dependency, no ZIP64: the bundle is capped
 * well below 4 GiB by the `exports` bucket limit. Entry names are UTF-8 (general purpose bit 11).
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(
  data: Uint8Array,
  stream: TransformStream<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
  const out = new Response(
    new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream),
  );
  return new Uint8Array(await out.arrayBuffer());
}

export const deflateRaw = (data: Uint8Array) =>
  pipe(
    data,
    new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>,
  );
export const inflateRaw = (data: Uint8Array) =>
  pipe(
    data,
    new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>,
  );

/** DOS date and time of `at` (UTC). */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

export async function zip(
  entries: readonly ZipEntry[],
  at: Date = new Date(),
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const { time, date } = dosTime(at);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const deflated = await deflateRaw(e.data);
    // Store when deflate does not help (already-compressed photos and PDFs).
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at2 = 0;
  for (const p of parts) {
    out.set(p, at2);
    at2 += p.length;
  }
  return out;
}

/** Reads a ZIP written by `zip` (tests and support tooling). */
export async function unzip(data: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endAt = data.length - 22;
  if (v.getUint32(endAt, true) !== 0x06054b50) throw new Error('not a zip');
  const count = v.getUint16(endAt + 10, true);
  let p = v.getUint32(endAt + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const localAt = v.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    const localNameLen = v.getUint16(localAt + 26, true);
    const start = localAt + 30 + localNameLen;
    const raw = data.subarray(start, start + size);
    const body = method === 8 ? await inflateRaw(raw) : raw.slice();
    if (crc32(body) !== crc) throw new Error(`crc mismatch: ${name}`);
    out.push({ name, data: body });
    p += 46 + nameLen;
  }
  return out;
}
