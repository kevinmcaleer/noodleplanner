/**
 * The block structures inside an MPP14 file: Props, field maps, fixed records
 * and their meta bitmaps, var blocks, OLE property sets, calendar data.
 *
 * Layouts derived from the public behaviour of the LGPL MPXJ reader and from
 * diffing files saved by Microsoft Project; a port of the Python `blocks.py`,
 * kept structurally identical so the two produce the same bytes.
 */
export const MAGIC = 0xfadfadba;
/** 1983-12-31, the epoch every timestamp in the format counts from. */
export const EPOCH_MS = Date.UTC(1983, 11, 31);
const DAY_MS = 86_400_000;
export const PROPS_TASK_FIELD_MAP = 131092;
export const PROPS_RESOURCE_FIELD_MAP = 131093;
export const PROPS_RELATION_FIELD_MAP = 131094;
export const PROPS_ASSIGNMENT_FIELD_MAP = 131095;
export const PROPS_PROJECT_START_DATE = 37748738;
export const PROPS_PROJECT_FINISH_DATE = 37748739; // 0x2400003
export const PROPS_TITLE = 37748744;
export const PROPS_DEFAULT_CALENDAR_NAME = 37748750; // UTF-16 name + 4 NUL bytes
export const PROPS_CURRENCY_SYMBOL = 37748752; // 0x2400010
export const PROPS_STATUS_DATE = 37748805; // 0x2400045; 0xFFFFFFFF = NA
export const PROPS_CURRENCY_CODE = 37753787; // 0x24013BB, e.g. "USD"
/** 0x24000AE: 2010-era only; stale values make Project renumber task uids. */
export const PROPS_LEGACY_NEXT_UIDS = 37748910;
/** 0x800001: base calendars carrying custom data. */
export const PROPS_EDITED_BASE_CALENDARS = 8388609;
/**
 * Var2Data byte length per storage — Project truncates its var-data read at
 * the declared length, so a stale value silently hides entries.
 */
export const PROPS_VAR2DATA_SIZE = {
    TBkndTask: 65537,
    TBkndRsc: 65538,
    TBkndCal: 65539,
    TBkndAssn: 65540,
};
/** Record counts: Project sizes its tables from these and drops the rest. */
export const PROPS_TASK_RECORD_COUNT = 16777217; // 0x1000001, includes stubs + the uid-0 summary
export const PROPS_RESOURCE_RECORD_COUNT = 16777218;
export const PROPS_ASSN_RECORD_COUNT = 16777220;
export const PROPS_REL_RECORD_COUNT = 16777221;
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function concat(parts) {
    let n = 0;
    for (const p of parts)
        n += p.length;
    const out = new Uint8Array(n);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}
// ------------------------------------------------------------------ Props --
/** key -> type code (the third dword of each entry; 0/2/4/9 observed). */
export const propsTypes = new Map();
export function parseProps(data) {
    const dv = view(data);
    const header = data.subarray(0, 16);
    const count = dv.getUint16(12, true);
    const values = new Map();
    const order = [];
    let pos = 16;
    for (let i = 0; i < count; i++) {
        if (data.length - pos < 12)
            break;
        const size = dv.getUint32(pos, true);
        const key = dv.getUint32(pos + 4, true);
        const ptype = dv.getUint32(pos + 8, true);
        pos += 12;
        values.set(key, data.subarray(pos, pos + size));
        propsTypes.set(key, ptype);
        order.push(key);
        pos += size + (size & 1); // 2-byte alignment
    }
    return { header, values, order };
}
export function buildProps(header, values, order) {
    const hdr = new Uint8Array(header);
    const parts = [];
    for (const key of order) {
        const val = values.get(key);
        if (!val)
            throw new Error(`build_props: no value for key ${key}`);
        const head = new Uint8Array(12);
        const hv = view(head);
        hv.setUint32(0, val.length, true);
        hv.setUint32(4, key, true);
        hv.setUint32(8, propsTypes.get(key) ?? 0, true);
        parts.push(head, val);
        if (val.length & 1)
            parts.push(new Uint8Array(1));
    }
    const body = concat(parts);
    const hv = view(hdr);
    hv.setUint16(12, order.length, true);
    const total = hdr.length + body.length;
    hv.setUint32(0, total - 4, true); // header dwords 0,1 = stream size - 4
    hv.setUint32(4, total - 4, true);
    return concat([hdr, body]);
}
export function parseFieldMap(data) {
    const dv = view(data);
    const items = [];
    let last = 0;
    let block = 0;
    for (let i = 0; i + 28 <= data.length; i += 28) {
        const mask = dv.getUint32(i, true);
        const offset = dv.getUint16(i + 4, true);
        const varKey = data[i + 6];
        const typeValue = dv.getUint32(i + 12, true);
        const category = dv.getUint16(i + 20, true);
        const meta = category === 0x0b || category === 0x64;
        if (!meta && offset !== 65535) {
            if (offset < last)
                block += 1;
            last = offset;
        }
        items.push({
            typeValue,
            fieldId: typeValue & 0xffff,
            block,
            offset,
            varKey,
            category,
            mask,
            inFixed: !meta && offset !== 65535,
            inMeta: meta,
        });
    }
    return items;
}
export function parseFixedMeta(data, itemSize) {
    const dv = view(data);
    const magic = dv.getUint32(0, true);
    if (magic !== MAGIC)
        throw new Error(`bad FixedMeta magic 0x${magic.toString(16)}`);
    const count = dv.getUint32(8, true);
    const n = Math.floor((data.length - 16) / itemSize);
    const items = [];
    for (let i = 0; i < n; i++)
        items.push(data.subarray(16 + i * itemSize, 16 + (i + 1) * itemSize));
    return { header: data.subarray(0, 16), count, items };
}
/**
 * parseFixedMeta with the item size derived from the header count, so files of
 * any Project vintage parse: M365 uses 96/51/10-byte Fixed2Meta items where
 * 2010-era files use 92/50/9.
 */
export function parseFixedMetaAuto(data, defaultSize) {
    const count = view(data).getUint32(8, true);
    let size = defaultSize;
    if (count && (data.length - 16) % count === 0)
        size = (data.length - 16) / count;
    return parseFixedMeta(data, size);
}
export function buildFixedMeta(header, items, dataLen) {
    const hdr = new Uint8Array(header);
    const hv = view(hdr);
    hv.setUint32(8, items.length, true);
    if (dataLen !== undefined)
        hv.setUint32(12, dataLen, true); // dword 3 = FixedData byte length
    return concat([hdr, ...items]);
}
export function splitFixedData(data, metaItems) {
    const out = [];
    for (let i = 0; i < metaItems.length; i++) {
        const off = view(metaItems[i]).getUint32(4, true);
        const next = i + 1 < metaItems.length ? view(metaItems[i + 1]).getUint32(4, true) : data.length;
        out.push(data.subarray(off, next));
    }
    return out;
}
// -------------------------------------------------------- meta bitmaps ----
// A FixedMeta / Fixed2Meta item is: uint32 flags, uint32 offset-in-FixedData,
// then a bitmap with one bit per field-map entry (little-endian bit order).
// FixedMeta carries entries 0..(item_size-8)*8-1; Fixed2Meta continues from
// there. Boolean fields store their value in their bit; for other fields the
// bit marks the field as populated.
export function metaBit(meta, meta2, entryIndex) {
    const nbits0 = (meta.length - 8) * 8;
    const useFirst = entryIndex < nbits0;
    const buf = useFirst ? meta : meta2;
    const i = useFirst ? entryIndex : entryIndex - nbits0;
    const byte = 8 + Math.floor(i / 8);
    if (byte >= buf.length)
        return null;
    return (buf[byte] >> i % 8) & 1;
}
export function setMetaBit(meta, meta2, entryIndex, value) {
    const nbits0 = (meta.length - 8) * 8;
    const useFirst = entryIndex < nbits0;
    const buf = useFirst ? meta : meta2;
    const i = useFirst ? entryIndex : entryIndex - nbits0;
    const byte = 8 + Math.floor(i / 8);
    if (byte >= buf.length)
        return;
    if (value)
        buf[byte] |= 1 << i % 8;
    else
        buf[byte] &= ~(1 << i % 8) & 0xff;
}
/** VarMeta12: a 24-byte header then 12-byte entries (uid, offset, type, unk). */
export function parseVarMeta(data) {
    const dv = view(data);
    const count = dv.getUint32(8, true);
    const table = new Map();
    const entries = [];
    let pos = 24;
    for (let i = 0; i < count; i++) {
        if (data.length - pos < 12)
            break;
        const uid = dv.getUint32(pos, true);
        const offset = dv.getUint32(pos + 4, true);
        const type = dv.getUint16(pos + 8, true);
        const unk = dv.getUint16(pos + 10, true);
        pos += 12;
        let byType = table.get(uid);
        if (!byType) {
            byType = new Map();
            table.set(uid, byType);
        }
        byType.set(type, offset);
        entries.push({ uid, offset, type, unk });
    }
    return { header: data.subarray(0, 24), table, entries };
}
export function readVar(data, offset) {
    const size = view(data).getUint32(offset, true);
    return data.subarray(offset + 4, offset + 4 + size);
}
/** Native field-class prefixes, the high word of a var entry's field id. */
export const TASK_FIELD_HI = 0x0b40;
export const RESOURCE_FIELD_HI = 0x0c40;
export const ASSIGNMENT_FIELD_HI = 0x0f40;
/** Entries must end up ordered by (uid, fieldId), which this does for you. */
export function buildVarBlocks(header, values, fieldHi = TASK_FIELD_HI) {
    const meta = new Uint8Array(header);
    const sorted = [...values].sort((a, b) => a.uid - b.uid || a.type - b.type);
    const varParts = [];
    const entryParts = [];
    let varLen = 0;
    for (const { uid, type, payload } of sorted) {
        const entry = new Uint8Array(12);
        const ev = view(entry);
        ev.setUint32(0, uid, true);
        ev.setUint32(4, varLen, true);
        ev.setUint16(8, type, true);
        ev.setUint16(10, fieldHi, true);
        entryParts.push(entry);
        const chunk = new Uint8Array(4 + payload.length);
        view(chunk).setUint32(0, payload.length, true);
        chunk.set(payload, 4);
        varParts.push(chunk);
        varLen += chunk.length;
    }
    const mv = view(meta);
    mv.setUint32(8, values.length, true);
    mv.setUint32(20, varLen, true);
    return { meta: concat([meta, ...entryParts]), data: concat(varParts) };
}
// --------------------------------------- OLE property sets (MS-OLEPS) -----
export const VT_LPSTR = 30;
/** cp1252 differs from Latin-1 only in 0x80-0x9F; JS has no codec for it. */
const CP1252_HIGH = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
    0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
    0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
export function encodeCp1252(s, replacement = 0x3f) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        const cp = s.charCodeAt(i);
        if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) {
            out[i] = cp;
            continue;
        }
        const high = CP1252_HIGH.indexOf(cp);
        out[i] = high >= 0 ? 0x80 + high : replacement;
    }
    return out;
}
/**
 * Replace or add VT_LPSTR properties in one section of an OLE property set
 * stream (SummaryInformation / DocumentSummaryInformation), keeping every
 * other property byte for byte.
 */
export function updatePropertySetStrings(data, updates, section = 0) {
    const dv = view(data);
    const nsec = dv.getUint32(24, true);
    const header = data.subarray(0, 28);
    const secs = [];
    for (let s = 0; s < nsec; s++) {
        const fmtid = data.subarray(28 + s * 20, 44 + s * 20);
        const off = dv.getUint32(44 + s * 20, true);
        const size = dv.getUint32(off, true);
        const cnt = dv.getUint32(off + 4, true);
        const entries = [];
        for (let i = 0; i < cnt; i++) {
            entries.push([dv.getUint32(off + 8 + i * 8, true), dv.getUint32(off + 12 + i * 8, true)]);
        }
        const bounds = [...entries.map((e) => e[1]), size].sort((a, b) => a - b);
        const raw = new Map();
        const order = [];
        for (const [pid, poff] of entries) {
            const next = bounds.find((b) => b > poff) ?? size;
            raw.set(pid, data.subarray(off + poff, off + next));
            order.push(pid);
        }
        secs.push({ fmtid, order, raw });
    }
    const target = secs[section];
    if (!target)
        throw new Error(`property set has no section ${section}`);
    for (const [pid, val] of updates) {
        const text = encodeCp1252(val);
        const body = new Uint8Array(8 + text.length + 1);
        const bv = view(body);
        bv.setUint32(0, VT_LPSTR, true);
        bv.setUint32(4, text.length + 1, true);
        body.set(text, 8);
        const padded = new Uint8Array(body.length + ((-body.length % 4) + 4) % 4);
        padded.set(body);
        target.raw.set(pid, padded);
        if (!target.order.includes(pid))
            target.order.push(pid);
    }
    const outSecs = [];
    for (const { fmtid, order, raw } of secs) {
        const base = 8 + order.length * 8;
        const bodyParts = [];
        const entries = [];
        let bodyLen = 0;
        for (const pid of order) {
            const v = raw.get(pid);
            const padded = new Uint8Array(v.length + ((-v.length % 4) + 4) % 4);
            padded.set(v);
            entries.push([pid, base + bodyLen]);
            bodyParts.push(padded);
            bodyLen += padded.length;
        }
        const head = new Uint8Array(8 + entries.length * 8);
        const hv = view(head);
        hv.setUint32(0, base + bodyLen, true);
        hv.setUint32(4, order.length, true);
        entries.forEach(([pid, poff], i) => {
            hv.setUint32(8 + i * 8, pid, true);
            hv.setUint32(12 + i * 8, poff, true);
        });
        outSecs.push([fmtid, concat([head, ...bodyParts])]);
    }
    const dirParts = [];
    let pos = 28 + outSecs.length * 20;
    for (const [fmtid, sec] of outSecs) {
        const entry = new Uint8Array(20);
        entry.set(fmtid, 0);
        view(entry).setUint32(16, pos, true);
        dirParts.push(entry);
        pos += sec.length;
    }
    return concat([header, ...dirParts, ...outSecs.map(([, sec]) => sec)]);
}
// ---------------------------------------------------------- calendar -----
export const CAL_DAY_NONWORKING = 0;
export const CAL_DAY_DEFAULT = 1;
export const CAL_DAY_WORKING = 2;
/**
 * A calendar definition blob (var-data key 8 on a TBkndCal record), in the
 * dialect Project M365 writes — an earlier form using day type 2 for working
 * days is readable by MPXJ but ignored by Project.
 *
 * days: 7 (type, ranges) entries, **Sunday first**; ranges are
 * (startMinute, endMinute) from midnight, at most 5 a day.
 */
export function buildCalendarData(days, exceptions = []) {
    if (days.length !== 7)
        throw new Error("days must have exactly 7 entries, Sunday first");
    const parts = [];
    for (const [dtype, ranges] of days) {
        const b = new Uint8Array(60);
        const bv = view(b);
        bv.setUint16(0, dtype === CAL_DAY_DEFAULT ? 1 : 0, true);
        if (dtype === CAL_DAY_WORKING) {
            const use = ranges.slice(0, 5);
            bv.setUint16(2, use.length, true);
            bv.setUint32(4, use.reduce((t, [s, e]) => t + (e - s), 0) * 10, true);
            let cumulative = 0;
            use.forEach(([start, end], i) => {
                bv.setUint16(8 + 2 * i, start * 10, true);
                bv.setUint32(20 + 4 * i, (end - start) * 10, true);
                cumulative += (end - start) * 10;
                bv.setUint32(40 + 4 * i, cumulative, true);
            });
        }
        parts.push(b);
    }
    if (exceptions.length) {
        const count = new Uint8Array(4);
        view(count).setUint32(0, exceptions.length, true);
        parts.push(count);
        exceptions.forEach(([from, to, name], i) => {
            const rec = new Uint8Array(92);
            const rv = view(rec);
            const d1 = Math.round((from.getTime() - EPOCH_MS) / DAY_MS);
            const d2 = Math.round((to.getTime() - EPOCH_MS) / DAY_MS);
            rv.setUint16(0, d1, true);
            rv.setUint16(2, d2, true);
            rv.setUint16(4, d2 - d1 + 1, true);
            rv.setUint32(72, 1, true);
            rv.setUint32(80, 1, true);
            rv.setUint32(84, 0x4000, true);
            const nb = encodeUtf16le(name + "\0");
            rv.setUint32(88, nb.length, true);
            parts.push(rec, nb, new Uint8Array(((-nb.length % 4) + 4) % 4));
            if (i === exceptions.length - 1)
                parts.push(new Uint8Array(4)); // closes the blob
        });
    }
    return concat(parts);
}
// -------------------------------------------------------- primitives -----
export function decodeTimestamp(b, offset) {
    const dv = view(b);
    let time = dv.getUint16(offset, true);
    const days = dv.getUint16(offset + 2, true);
    if (days <= 1 || days === 65535)
        return null;
    if (time === 65535)
        time = 0;
    return new Date(EPOCH_MS + days * DAY_MS + time * 6000);
}
export function encodeTimestamp(dt) {
    const out = new Uint8Array(4);
    if (dt === null)
        return out.fill(0xff);
    const delta = dt.getTime() - EPOCH_MS;
    const days = Math.floor(delta / DAY_MS);
    const tenths = Math.floor((delta - days * DAY_MS) / 6000);
    const ov = view(out);
    ov.setUint16(0, tenths, true);
    ov.setUint16(2, days, true);
    return out;
}
export function encodeUtf16le(s) {
    const out = new Uint8Array(s.length * 2);
    const dv = view(out);
    for (let i = 0; i < s.length; i++)
        dv.setUint16(i * 2, s.charCodeAt(i), true);
    return out;
}
/** A Project string: UTF-16LE with a two-byte terminator. */
export function encodeUnicode(s) {
    return concat([encodeUtf16le(s), new Uint8Array(2)]);
}
export function decodeUnicode(b) {
    const dv = view(b);
    let s = "";
    for (let i = 0; i + 1 < b.length; i += 2) {
        const code = dv.getUint16(i, true);
        if (code === 0)
            break;
        s += String.fromCharCode(code);
    }
    return s;
}
/** MS Project duration unit codes -> [label, tenths-of-a-minute divisor]. */
export const DURATION_UNITS = {
    3: ["m", 10],
    5: ["h", 600],
    7: ["d", 4800],
    9: ["w", 24000],
    11: ["mo", 96000],
};
