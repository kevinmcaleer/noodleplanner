/**
 * Read an .mpp back into the project model.
 *
 * Field-map driven exactly like the writer: every offset comes from the file's
 * own `Props` field maps and every flag from its meta bitmaps, so a file saved
 * by any MPP14-era Project (2010 through the current Microsoft 365 client)
 * reads correctly — there are no hard-coded record layouts to go stale.
 *
 * What comes back is the same `Project` the writer takes, so a file can be
 * read, edited and written again. Baselines come back on tasks, resources and
 * assignments; fields the writer does not model (costs, timephased data) do
 * not.
 */
import { Storage, readCfb } from "./cfb.js";
import * as B from "./blocks.js";
import { ASSN_BASELINE_IDS, ASSN_META_SIZE, ASSN_NATIVE, CONSTRAINT_TYPES, ESTIMATED_FLAG, NATIVE, PCT_SCALE, PRJ, REL_META_SIZE, REL_TYPES, RSC_BASELINE_IDS, RSC_META_SIZE, RSC_NATIVE, TASK_BASELINE_IDS, TASK_META2_SIZE, TASK_META_SIZE, TENTHS_PER_DAY, UNITS_CODES, WORK_SCALE, decodeRtfNotes, } from "./model.js";
/** The file is not a project we can read. */
export class MppReadError extends Error {
    constructor(message) {
        super(message);
        this.name = "MppReadError";
    }
}
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const invert = (o) => new Map(Object.entries(o).map(([k, v]) => [v, k]));
const REL_TYPE_NAMES = invert(REL_TYPES);
const CONSTRAINT_NAMES = invert(CONSTRAINT_TYPES);
const UNIT_NAMES = invert(UNITS_CODES);
/** One entity class with its records and its field map. */
class Klass {
    fm;
    bit;
    recs = [];
    metas = [];
    recs2 = [];
    metas2 = [];
    table = new Map();
    vdata = new Uint8Array(0);
    constructor(reader, storage, metaSize, meta2Size, propsKey) {
        [this.fm, this.bit] = reader.classMap(propsKey);
        const meta = reader.maybe(`${storage}/FixedMeta`);
        const data = reader.maybe(`${storage}/FixedData`);
        if (!meta || !data)
            return;
        const parsed = B.parseFixedMetaAuto(meta, metaSize);
        this.metas = parsed.items;
        this.recs = B.splitFixedData(data, parsed.items);
        const meta2 = reader.maybe(`${storage}/Fixed2Meta`);
        const data2 = reader.maybe(`${storage}/Fixed2Data`);
        if (meta2 && data2) {
            const parsed2 = B.parseFixedMetaAuto(meta2, meta2Size);
            this.metas2 = parsed2.items;
            this.recs2 = B.splitFixedData(data2, parsed2.items);
        }
        const varMeta = reader.maybe(`${storage}/VarMeta`);
        const varData = reader.maybe(`${storage}/Var2Data`);
        if (varMeta && varData) {
            this.table = B.parseVarMeta(varMeta).table;
            this.vdata = varData;
        }
    }
    src(i, it) {
        return it.block === 0 ? (this.recs[i] ?? new Uint8Array(0)) : (this.recs2[i] ?? new Uint8Array(0));
    }
    value(i, fieldId, kind) {
        const it = this.fm.get(fieldId);
        if (!it)
            return null;
        const src = this.src(i, it);
        const size = kind === "f64" ? 8 : kind === "u16" ? 2 : 4;
        if (it.offset + size > src.length)
            return null;
        const d = dv(src);
        if (kind === "u32")
            return d.getUint32(it.offset, true);
        if (kind === "i32")
            return d.getInt32(it.offset, true);
        if (kind === "u16")
            return d.getUint16(it.offset, true);
        return d.getFloat64(it.offset, true);
    }
    timestamp(i, fieldId) {
        const it = this.fm.get(fieldId);
        if (!it)
            return null;
        const src = this.src(i, it);
        if (it.offset + 4 > src.length)
            return null;
        return B.decodeTimestamp(src, it.offset);
    }
    flag(i, fieldId) {
        const idx = this.bit.get(fieldId);
        if (idx === undefined || i >= this.metas.length)
            return false;
        return Boolean(B.metaBit(this.metas[i], this.metas2[i] ?? new Uint8Array(0), idx));
    }
    var(uid, fieldId) {
        const off = this.table.get(uid)?.get(fieldId);
        return off === undefined ? null : B.readVar(this.vdata, off);
    }
    text(uid, fieldId) {
        const raw = this.var(uid, fieldId);
        return raw ? B.decodeUnicode(raw) : "";
    }
}
class Reader {
    root;
    props;
    constructor(bytes) {
        this.root = readCfb(bytes);
        const raw = this.root.get(`${PRJ}/Props`);
        if (!raw)
            throw new MppReadError(`no ${PRJ}/Props stream — not an MPP14 project file`);
        this.props = B.parseProps(raw).values;
    }
    maybe(path) {
        return this.root.get(path);
    }
    classMap(propsKey) {
        const fm = new Map();
        const bit = new Map();
        const raw = this.props.get(propsKey);
        if (!raw)
            return [fm, bit];
        B.parseFieldMap(raw).forEach((it, i) => {
            if (it.inFixed && !fm.has(it.fieldId))
                fm.set(it.fieldId, it);
            if (!bit.has(it.fieldId))
                bit.set(it.fieldId, i);
        });
        return [fm, bit];
    }
}
const round4 = (n) => Math.round(n * 10000) / 10000;
/** Read an .mpp into a Project. Throws MppReadError when it is not one. */
export function readProject(bytes) {
    const r = new Reader(bytes);
    const tasksK = new Klass(r, `${PRJ}/TBkndTask`, TASK_META_SIZE, TASK_META2_SIZE, B.PROPS_TASK_FIELD_MAP);
    const rscK = new Klass(r, `${PRJ}/TBkndRsc`, RSC_META_SIZE, 53, B.PROPS_RESOURCE_FIELD_MAP);
    const assnK = new Klass(r, `${PRJ}/TBkndAssn`, ASSN_META_SIZE, 53, B.PROPS_ASSIGNMENT_FIELD_MAP);
    const tasks = [];
    tasksK.recs.forEach((rec, i) => {
        if (rec.length <= 100)
            return; // stub rows carry no fields
        const uid = tasksK.value(i, NATIVE["UNIQUE_ID"], "u32");
        if (uid === null || uid === 0)
            return; // uid 0 is the project summary row
        const start = tasksK.timestamp(i, NATIVE["START"]);
        const finish = tasksK.timestamp(i, NATIVE["FINISH"]);
        if (!start || !finish)
            return;
        const tenths = tasksK.value(i, NATIVE["DURATION"], "i32") ?? 0;
        const unitsWord = tasksK.value(i, NATIVE["ACTUAL_DURATION_UNITS"], "u16") ?? 0;
        const constraintCode = tasksK.value(i, NATIVE["CONSTRAINT_TYPE"], "u16");
        const constraint = constraintCode === null ? undefined : CONSTRAINT_NAMES.get(constraintCode);
        const notesRaw = tasksK.var(uid, NATIVE["NOTES"]);
        const wbs = tasksK.text(uid, NATIVE["WBS"]);
        const task = {
            uid,
            name: tasksK.text(uid, NATIVE["NAME"]),
            start,
            finish,
            durationDays: round4(tenths / TENTHS_PER_DAY),
            outlineLevel: tasksK.value(i, NATIVE["OUTLINE_LEVEL"], "u16") || 1,
            parentUid: tasksK.value(i, NATIVE["PARENT_UID"], "u32") ?? 0,
            durationUnits: UNIT_NAMES.get(unitsWord & ~ESTIMATED_FLAG) ?? "d",
            estimated: Boolean(unitsWord & ESTIMATED_FLAG),
            notes: notesRaw ? decodeRtfNotes(notesRaw) : "",
            percentComplete: tasksK.value(i, NATIVE["PERCENT_COMPLETE"], "u16") ?? 0,
            priority: tasksK.value(i, NATIVE["PRIORITY"], "u16") || 500,
            manual: tasksK.flag(i, NATIVE["MANUALLY_SCHEDULED"]),
        };
        const baselines = readTaskBaselines(tasksK, uid);
        if (Object.keys(baselines).length)
            task.baselines = baselines;
        if (wbs)
            task.wbs = wbs;
        if (constraint && constraint !== "ASAP")
            task.constraint = constraint;
        const cdate = tasksK.timestamp(i, NATIVE["CONSTRAINT_DATE"]);
        if (cdate)
            task.constraintDate = cdate;
        tasks.push(task);
    });
    const resources = [];
    rscK.recs.forEach((rec, i) => {
        if (rec.length <= 100)
            return;
        const uid = rscK.value(i, RSC_NATIVE["UNIQUE_ID"], "u32");
        if (!uid)
            return; // uid 0 is Project's unnamed placeholder
        const name = rscK.text(uid, RSC_NATIVE["NAME"]);
        if (!name)
            return;
        const maxUnits = rscK.value(i, RSC_NATIVE["MAX_UNITS"], "f64");
        const res = {
            uid,
            name,
            initials: rscK.text(uid, RSC_NATIVE["INITIALS"]),
            email: rscK.text(uid, RSC_NATIVE["EMAIL_ADDRESS"]),
            maxUnits: round4((maxUnits ?? PCT_SCALE) / PCT_SCALE),
        };
        const rbl = readRscBaselines(rscK, uid);
        if (Object.keys(rbl).length)
            res.baselines = rbl;
        resources.push(res);
    });
    const assignments = [];
    assnK.recs.forEach((_, i) => {
        const taskUid = assnK.value(i, ASSN_NATIVE["TASK_UNIQUE_ID"], "u32");
        const rscUid = assnK.value(i, ASSN_NATIVE["RESOURCE_UNIQUE_ID"], "i32");
        if (!taskUid || rscUid === null || rscUid <= 0)
            return;
        const units = assnK.value(i, ASSN_NATIVE["UNITS"], "f64");
        const asn = {
            taskUid,
            resourceUid: rscUid,
            units: round4((units ?? PCT_SCALE) / PCT_SCALE),
        };
        const auid = assnK.value(i, ASSN_NATIVE["UNIQUE_ID"], "u32");
        const abl = auid ? readAssnBaselines(assnK, auid) : {};
        if (Object.keys(abl).length)
            asn.baselines = abl;
        assignments.push(asn);
    });
    const relations = readRelations(r);
    const startRaw = r.props.get(B.PROPS_PROJECT_START_DATE);
    const projectStart = (startRaw ? B.decodeTimestamp(startRaw, 0) : null) ??
        (tasks.length ? new Date(Math.min(...tasks.map((t) => t.start.getTime()))) : new Date());
    const titleRaw = r.props.get(B.PROPS_TITLE);
    return {
        title: (titleRaw ? B.decodeUnicode(titleRaw) : "") || "Project",
        start: projectStart,
        tasks,
        relations,
        resources,
        assignments,
    };
}
/** One little-endian double, or null when the entry is absent or unset. */
function readDouble(raw) {
    if (!raw || raw.length < 8)
        return null;
    const value = dv(raw).getFloat64(0, true);
    return value === -1e-6 ? null : value; // Project's "no value" double
}
/**
 * Saved baselines for one task, by slot.
 *
 * They live in var data — the fixed baseline fields stay empty in files
 * Project writes — and a cleared baseline keeps its entries with the dates at
 * NA and the numbers at zero, so those are skipped.
 */
function readTaskBaselines(k, uid) {
    const out = {};
    TASK_BASELINE_IDS.forEach((ids, slot) => {
        const startRaw = k.var(uid, ids.start);
        const finishRaw = k.var(uid, ids.finish);
        if (!startRaw && !finishRaw)
            return;
        const b = {};
        const start = startRaw ? B.decodeTimestamp(startRaw, 0) : null;
        const finish = finishRaw ? B.decodeTimestamp(finishRaw, 0) : null;
        if (start)
            b.start = start;
        if (finish)
            b.finish = finish;
        const dur = k.var(uid, ids.duration);
        b.durationDays = dur && dur.length >= 4 ? round4(dv(dur).getInt32(0, true) / TENTHS_PER_DAY) : 0;
        b.workHours = round4((readDouble(k.var(uid, ids.work)) ?? 0) / (WORK_SCALE * 600));
        b.cost = readDouble(k.var(uid, ids.cost)) ?? 0;
        // a cleared slot, not a saved one
        if (!b.start && !b.finish && !b.durationDays && !b.workHours)
            return;
        out[slot] = b;
    });
    return out;
}
/**
 * Saved baselines for one resource, by slot — work and cost only.
 *
 * Project writes no baseline start or finish on a resource, and clearing a
 * slot leaves the two numbers at zero rather than removing them. A resource
 * with nothing assigned therefore looks exactly like a cleared slot, so an
 * all-zero entry is not reported; that ambiguity is in the format.
 */
function readRscBaselines(k, uid) {
    const out = {};
    RSC_BASELINE_IDS.forEach((ids, slot) => {
        const work = readDouble(k.var(uid, ids.work));
        const cost = readDouble(k.var(uid, ids.cost));
        if (!work && !cost)
            return;
        out[slot] = { workHours: round4((work ?? 0) / (WORK_SCALE * 600)), cost: cost ?? 0 };
    });
    return out;
}
/**
 * Saved baselines for one assignment, by slot — no duration. A cleared slot
 * keeps its entries with the dates at NA and the work at zero, the same
 * convention tasks use.
 */
function readAssnBaselines(k, uid) {
    const out = {};
    ASSN_BASELINE_IDS.forEach((ids, slot) => {
        const startRaw = k.var(uid, ids.start);
        const finishRaw = k.var(uid, ids.finish);
        if (!startRaw && !finishRaw)
            return;
        const b = {};
        const start = startRaw ? B.decodeTimestamp(startRaw, 0) : null;
        const finish = finishRaw ? B.decodeTimestamp(finishRaw, 0) : null;
        if (start)
            b.start = start;
        if (finish)
            b.finish = finish;
        b.workHours = round4((readDouble(k.var(uid, ids.work)) ?? 0) / (WORK_SCALE * 600));
        b.cost = readDouble(k.var(uid, ids.cost)) ?? 0;
        if (!b.start && !b.finish && !b.workHours)
            return; // a cleared slot
        out[slot] = b;
    });
    return out;
}
/**
 * Dependencies from TBkndCons. Only the first three dwords (uid, predecessor,
 * successor) and the type word are mapped; the trailer holding lag moved
 * between eras, so it is read the way the writer writes it — 2010 files put
 * the lag units first, M365 the lag.
 */
function readRelations(r) {
    const [relFm] = r.classMap(B.PROPS_RELATION_FIELD_MAP);
    const is2010 = relFm.get(9)?.offset === 0;
    const meta = r.maybe(`${PRJ}/TBkndCons/FixedMeta`);
    const data = r.maybe(`${PRJ}/TBkndCons/FixedData`);
    if (!meta || !data)
        return [];
    const items = B.parseFixedMetaAuto(meta, REL_META_SIZE).items;
    const out = [];
    for (const rec of B.splitFixedData(data, items)) {
        if (rec.length < 20)
            continue;
        const d = dv(rec);
        const pred = d.getUint32(4, true);
        const succ = d.getUint32(8, true);
        if (!pred || !succ)
            continue;
        const kind = (REL_TYPE_NAMES.get(d.getUint16(12, true)) ?? "FS");
        const lag = d.getInt32(is2010 ? 16 : 14, true);
        out.push({
            predUid: pred,
            succUid: succ,
            type: kind,
            lagDays: round4(lag / TENTHS_PER_DAY),
        });
    }
    return out;
}
