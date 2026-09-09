/**
 * Programme-owned data store (#954's decision).
 *
 * #910 removed the programme file: a programme is *inferred* from a
 * `programme:` slug on its member projects' front matter (deriveProgrammes(),
 * portfolio-projects-table.js) -- fine for anything that's a roll-up (risk,
 * dependencies, resourcing, RAG), which has nowhere it needs to live because
 * it's recomputed from the member projects every time. It doesn't work for
 * data a programme *owns* that has no project to derive it from -- an SRO
 * name, a vision statement, the outcomes a programme exists to deliver.
 * #954 decided that data gets a new, lazily-created, per-programme record
 * here: one localStorage key (or IndexedDB meta entry, see below), holding
 * an object keyed by the same programme slug deriveProgrammes() computes.
 * A programme that only has inferred membership -- no owned data written
 * yet -- has no entry; the record for a slug is created on its first write,
 * not when the programme itself first appears.
 *
 * This is the FIRST issue to build this store -- #735 populates `sro`,
 * `vision`, `outcomes` (per #734's previously-stubbed fields) and
 * `benefitLinks` (this issue's own scope, see below). It's deliberately
 * generic: #738 (finance/funding envelope), #740 (stakeholder register),
 * #741 (information register) and #742 (export, which reads the whole
 * record) each add their own top-level slice later. There's no placeholder
 * for those slices here -- an absent key is simpler to reason about than a
 * pre-declared `null`/`[]` nobody's populated yet, and getProgrammeData()
 * callers already have to handle a missing record either way.
 *
 * Storage convention matches portfolio-dependencies.js's
 * getAllProgrammeDependencies()/saveAllProgrammeDependencies(): read/write
 * the whole thing, IndexedDB-backed via NoodleStore's generic meta store
 * when project-store.js has it active (NoodleStore.PROGRAMME_DATA_META_KEY),
 * falling back to a single localStorage key otherwise. Riding the same meta
 * store as programme dependencies means this data is automatically included
 * in NoodleStore's export/import/backup handling (project-store.js) without
 * any special-casing there.
 */

const PROGRAMME_DATA_KEY = 'noodleplanner_programme_data';

// ---------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------

/** Load the whole { [slug]: record } object. Never returns null/undefined. */
function getAllProgrammeData() {
    if (typeof projectStoreActive === 'function' && projectStoreActive()) {
        const data = NoodleStore.getMeta(NoodleStore.PROGRAMME_DATA_META_KEY);
        return (data && typeof data === 'object') ? Object.assign({}, data) : {};
    }
    try {
        const raw = localStorage.getItem(PROGRAMME_DATA_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.error('Error loading programme data:', err);
        return {};
    }
}

function saveAllProgrammeData(data) {
    if (typeof projectStoreActive === 'function' && projectStoreActive()) {
        NoodleStore.setMeta(NoodleStore.PROGRAMME_DATA_META_KEY, data);
        return true;
    }
    try {
        localStorage.setItem(PROGRAMME_DATA_KEY, JSON.stringify(data));
        return true;
    } catch (err) {
        console.error('Error saving programme data:', err);
        return false;
    }
}

/**
 * The record for one programme slug, or null when it has none yet --
 * reading never creates an entry.
 */
function getProgrammeData(slug) {
    if (!slug) return null;
    const all = getAllProgrammeData();
    return Object.prototype.hasOwnProperty.call(all, slug) ? all[slug] : null;
}

/**
 * Merge a partial update into a programme's record, creating it lazily on
 * first write. Returns the merged record.
 */
function setProgrammeData(slug, partialUpdate) {
    if (!slug) return null;
    const all = getAllProgrammeData();
    const merged = Object.assign({}, all[slug] || {}, partialUpdate || {});
    all[slug] = merged;
    saveAllProgrammeData(all);
    return merged;
}

/** Remove a programme's whole record. Returns false when it had none. */
function deleteProgrammeData(slug) {
    if (!slug) return false;
    const all = getAllProgrammeData();
    if (!Object.prototype.hasOwnProperty.call(all, slug)) return false;
    delete all[slug];
    saveAllProgrammeData(all);
    return true;
}

/**
 * Drop any record whose slug isn't in `activeSlugs` -- the orphan-cleanup
 * hook #954 asked for: a programme's data record shouldn't outlive every
 * project that named it. Callers pass the currently-derived programme
 * slugs (deriveProgrammes() in portfolio-projects-table.js, mapped to
 * `.slug`); this is a defensive sweep, not the primary cleanup path -- see
 * project-storage.js's deleteProject() and portfolio-projects-table.js's
 * removeSelectedFromProgramme()/renameProgramme() for the point-of-change
 * hooks that call deleteProgrammeData() directly when a programme loses
 * its last member. Returns the slugs removed.
 */
function pruneOrphanedProgrammeData(activeSlugs) {
    const keep = new Set(activeSlugs || []);
    const all = getAllProgrammeData();
    const removed = [];
    Object.keys(all).forEach((slug) => {
        if (!keep.has(slug)) {
            delete all[slug];
            removed.push(slug);
        }
    });
    if (removed.length) saveAllProgrammeData(all);
    return removed;
}

// ---------------------------------------------------------------------
// Outcomes (#734's previously-stubbed SRO/vision/outcomes fields; #735
// links project benefits to these -- see below)
// ---------------------------------------------------------------------

/** Add an outcome, generating an id unique within this programme's record. */
function addProgrammeOutcome(slug, outcome) {
    if (!slug || !outcome || !outcome.name) return null;
    const data = getProgrammeData(slug) || {};
    const outcomes = (data.outcomes || []).slice();
    const nextId = outcomes.reduce((max, o) => Math.max(max, o.id || 0), 0) + 1;
    const record = { id: nextId, name: outcome.name, description: outcome.description || '' };
    outcomes.push(record);
    setProgrammeData(slug, { outcomes: outcomes });
    return record;
}

function updateProgrammeOutcome(slug, outcomeId, updates) {
    const data = getProgrammeData(slug);
    if (!data || !Array.isArray(data.outcomes)) return null;
    const idx = data.outcomes.findIndex((o) => o.id === outcomeId);
    if (idx === -1) return null;
    const outcomes = data.outcomes.slice();
    outcomes[idx] = Object.assign({}, outcomes[idx], updates || {});
    setProgrammeData(slug, { outcomes: outcomes });
    return outcomes[idx];
}

/**
 * Delete an outcome and any benefit links that pointed to it -- an
 * outcome-less link would just be a dangling reference on the rollup.
 */
function deleteProgrammeOutcome(slug, outcomeId) {
    const data = getProgrammeData(slug);
    if (!data || !Array.isArray(data.outcomes)) return false;
    const outcomes = data.outcomes.filter((o) => o.id !== outcomeId);
    if (outcomes.length === data.outcomes.length) return false;
    const benefitLinks = (data.benefitLinks || []).filter((l) => l.outcomeId !== outcomeId);
    setProgrammeData(slug, { outcomes: outcomes, benefitLinks: benefitLinks });
    return true;
}

// ---------------------------------------------------------------------
// Benefit-to-outcome links (#735's actual scope)
//
// A project's own benefits map (benefits.js) already has a linked_to +
// contribution_percent chain (enabler -> change -> benefit -> objective,
// see benefits.js's header comment) -- but it's entirely intra-project:
// every id in it refers to another row in that SAME project's own
// benefits table, so it has no way to name a programme outcome living
// outside that project. This mirrors #737's dependency links: a
// relationship that crosses from a project into its programme lives in a
// dedicated store here, not inside either side's own content (the same
// reasoning portfolio-dependencies.js's header comment gives for why
// dependencies aren't stored in front matter either).
//
// A benefit item's id is only unique within its own project's benefits
// table, so a link is identified by the (projectId, benefitItemId) pair.
// A benefit links to at most one outcome at a time -- linking it again
// replaces the previous link, the same "one of those programme outcomes"
// singular relationship the issue describes.
// ---------------------------------------------------------------------

function linkBenefitToOutcome(slug, link) {
    if (!slug || !link || !link.projectId || link.benefitItemId == null || link.outcomeId == null) return null;
    const data = getProgrammeData(slug) || {};
    const links = (data.benefitLinks || []).filter((l) =>
        !(l.projectId === link.projectId && l.benefitItemId === link.benefitItemId));
    const record = {
        projectId: link.projectId,
        benefitItemId: link.benefitItemId,
        benefitTitle: link.benefitTitle || '',
        outcomeId: link.outcomeId,
        contributionPercent: Math.max(0, Math.min(100, parseInt(link.contributionPercent, 10) || 0)),
    };
    links.push(record);
    setProgrammeData(slug, { benefitLinks: links });
    return record;
}

function unlinkBenefitFromOutcome(slug, projectId, benefitItemId) {
    const data = getProgrammeData(slug);
    if (!data || !Array.isArray(data.benefitLinks)) return false;
    const links = data.benefitLinks.filter((l) => !(l.projectId === projectId && l.benefitItemId === benefitItemId));
    if (links.length === data.benefitLinks.length) return false;
    setProgrammeData(slug, { benefitLinks: links });
    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PROGRAMME_DATA_KEY,
        getAllProgrammeData,
        saveAllProgrammeData,
        getProgrammeData,
        setProgrammeData,
        deleteProgrammeData,
        pruneOrphanedProgrammeData,
        addProgrammeOutcome,
        updateProgrammeOutcome,
        deleteProgrammeOutcome,
        linkBenefitToOutcome,
        unlinkBenefitFromOutcome,
    };
}
