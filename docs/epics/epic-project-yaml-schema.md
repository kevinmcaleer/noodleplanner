# Epic: YAML Schema for Projects

Epic ID: EPIC-YAML-001
Status: Proposed
Author: Team
Date Created: 2025-08-26

## Objective
Define and adopt a compact, simple, human-readable YAML representation for projects that is standards-compliant (notably ISO 8601 for dates) and supports dual editing paths: via the UX and via a Markdown file that stores the project structure. The Markdown must be editable and validated in the browser.

## Background
- Current projects are stored in SQL tables. We want a portable, versionable format for projects.
- YAML is well-suited for human-readable configuration; dates must follow ISO 8601.
- Users should be able to switch between UI-based editing and Markdown-in-browser editing of the same project data.

## Success Criteria
- YAML schema is defined and documented (with examples and JSON Schema for validation).
- Round-trip: Editing via UI or Markdown produces the same project state.
- Browser-based Markdown editor with live validation against the schema.
- Import/export endpoints: YAML <-> DB with full fidelity (IDs stable or deterministically mapped).
- Dates are ISO 8601 and validated.
- Automated tests for schema validation and round-trip integrity.

## Deliverables
- docs/schemas/project.schema.json (JSON Schema for validation)
- docs/examples/project.sample.yaml (example conforming YAML)
- Browser Markdown editor page with validation (frontend + endpoint)
- Import/export endpoints in FastAPI
- Tests covering parse, validate, import, export, and round-trip equivalence
- Developer docs: mapping rules between DB and YAML

## Stakeholders
- Product owners, developers, power users

## Milestones
| Milestone | Target Date | Owner |
|-----------|-------------|-------|
| Draft schema and example YAML | 2025-09-02 | Dev |
| JSON Schema + validator (server + client) | 2025-09-09 | Dev |
| Import/export endpoints | 2025-09-13 | Dev |
| Browser Markdown editor with live validation | 2025-09-17 | Dev |
| Tests and documentation complete | 2025-09-20 | Dev |

## User Stories
- As a user, I can export my project to a YAML file and import it back without losing structure.
- As a user, I can edit the project structure in a Markdown file rendered in the browser, with validation feedback.
- As an admin/dev, I can validate a YAML project file via API and see detailed errors.
- As a user, dates I enter in the UI or YAML remain valid ISO 8601 and consistent across views.

## Risks & Mitigations
- Ambiguity in ID mapping: Use stable UUIDs in YAML; map to DB IDs on import. Provide deterministic mapping.
- YAML parsing quirks: Use strict loaders and schema validation to avoid surprises.
- Large projects: Provide streaming import/export and chunked validation.

## Notes
- Consider CommonMark + fenced YAML block in Markdown, or a dedicated YAML file; both should be supported.
- Prefer RFC 3339/ISO 8601 timestamps.
