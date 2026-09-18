# Epic: Export project to PDF

Epic ID: ISSUE-1261
Status: Proposed
Parent issue: `kevinmcaleer/noodleplanner#1261`

## Objective

Break issue #1261 into a small set of linked sub-issues that can be delivered
incrementally without losing the intended PDF structure for Snakie projects.

## Context

NoodlePlanner already has a browser-built PDF export for the scheduled project
report. Issue #1261 is a different piece of work: a structured PDF export for a
Snakie project, including code sections, a wiring diagram, and a closing
support page.

## Proposed linked sub-issues

### 1. Define the Snakie PDF export contract

**Suggested title:** `Snakie PDF export: define source data and section order`

**Why first**
- Confirms which fields the exporter receives for the project name, Blockly
  blocks, generated MicroPython, and wiring-diagram asset.
- Fixes the document order before layout work starts.

**Acceptance criteria**
- The export path has a defined payload or adapter for all required sections.
- The section order is fixed as: title page, blocks/functions, main code,
  MicroPython listing, wiring diagram, closing support page.
- Missing optional assets fail gracefully with user-visible messaging.

**Link back to the epic**
```text
Parent: #1261
Blocks: #2, #3, #4, #5
```

### 2. Add the PDF title page

**Suggested title:** `Snakie PDF export: add project title page`

**Depends on**
- `Snakie PDF export: define source data and section order`

**Acceptance criteria**
- The first page contains the project name as the document title.
- The title page renders correctly for short and long project names.
- Existing non-Snakie PDF export behaviour is not regressed.

**Link back to the epic**
```text
Parent: #1261
Depends on: define source data and section order
```

### 3. Render Blockly blocks and generated code sections

**Suggested title:** `Snakie PDF export: render blocks, functions, and main code`

**Depends on**
- `Snakie PDF export: define source data and section order`

**Acceptance criteria**
- The PDF shows the code in block order, with functions before main code.
- Page layout tries not to split a block section across pages unless it cannot
  fit on one page.
- Long code still exports completely and remains readable.

**Link back to the epic**
```text
Parent: #1261
Depends on: define source data and section order
```

### 4. Add the MicroPython listing section

**Suggested title:** `Snakie PDF export: include MicroPython listing`

**Depends on**
- `Snakie PDF export: define source data and section order`
- `Snakie PDF export: render blocks, functions, and main code`

**Acceptance criteria**
- The PDF includes a dedicated MicroPython code listing section.
- Listing formatting remains stable for multi-page code samples.
- Unicode or unsupported glyph handling is defined and tested.

**Link back to the epic**
```text
Parent: #1261
Depends on: render blocks, functions, and main code
```

### 5. Add the electronics wiring diagram page

**Suggested title:** `Snakie PDF export: include electronics wiring diagram`

**Depends on**
- `Snakie PDF export: define source data and section order`

**Acceptance criteria**
- The PDF includes the electronics wiring diagram as its own section or page.
- The diagram exports at a readable size and aspect ratio.
- If no diagram is available, the export handles that state predictably.

**Link back to the epic**
```text
Parent: #1261
Depends on: define source data and section order
```

### 6. Add the closing support page and end-to-end coverage

**Suggested title:** `Snakie PDF export: add support page, docs, and export tests`

**Depends on**
- `Snakie PDF export: add project title page`
- `Snakie PDF export: render blocks, functions, and main code`
- `Snakie PDF export: include MicroPython listing`
- `Snakie PDF export: include electronics wiring diagram`

**Acceptance criteria**
- The last page says the project was made with Snakie and links to
  `app.snakie.org`.
- The closing page includes the support / Buy Me a Coffee call to action from
  issue #1261.
- Export coverage exercises the full document order end to end.
- User-facing documentation explains the new PDF export.

**Link back to the epic**
```text
Parent: #1261
Depends on: title page, code sections, MicroPython listing, wiring diagram
```

## Recommended delivery order

1. Define the export contract
2. Add the title page
3. Render blocks/functions/main code
4. Add the MicroPython listing
5. Add the wiring diagram
6. Finish with the support page, tests, and docs

## Definition of done for the epic

- All six sub-issues are created and linked back to #1261.
- The implementation preserves the existing project-report PDF export unless
  the replacement is intentional and documented.
- Tests cover the final section order and failure handling for missing assets.
