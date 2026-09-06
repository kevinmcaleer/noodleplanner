/**
 * Communications-plan Word export, entirely in the browser (issue #792).
 *
 * A port of `noodle_core.format_converter.export_comms_to_docx` to the
 * vendored `docx` library: a landscape section with 1.5 cm margins, a
 * "Heading 1" title, and a bordered eight-column table with a shaded,
 * white-on-blue header row and 9pt left-aligned cells. The styles python-docx
 * gets from its default template (Calibri 11pt body, 14pt bold #365F91
 * headings, "Table Grid" borders) are declared explicitly here so both files
 * open looking the same. No plan data goes to the backend.
 *
 * `buildCommsDocument` is pure (no DOM); tests/test_pdf_docx_browser_export.mjs
 * unzips its output next to the Python one and compares text, table shape,
 * orientation and borders. Beyond the Python: the header row is marked as a
 * repeating table header, so a plan that runs past one page keeps its column
 * headings on every page.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "./vendor/docx/index.mjs";

export const HEADERS = ["#", "Activity", "Audience", "Content", "Frequency", "Channel", "Owner", "Status"];
export const COLUMN_KEYS = ["id", "activity", "audience", "content", "frequency", "channel", "owner", "status"];
export const COLUMN_WIDTHS_CM = [1, 4, 3.5, 5, 2.5, 2.5, 3, 2];
export const HEADER_FILL = "4A90D9";
export const EMPTY_MESSAGE = "No communications plan items defined.";

// python-docx's Cm() is 360000 EMU and its twips conversion rounds EMU/635
const cmToTwips = (cm) => Math.round((cm * 360000) / 635);
const CELL_FONT_HALF_POINTS = 18; // Pt(9)

// python-docx's default template is US Letter; the Python swaps the two
// dimensions for landscape, and the docx library does the same swap itself
// when given the portrait size with a landscape orientation.
const PAGE = { width: 12240, height: 15840 };
const PAGE_MARGIN = cmToTwips(1.5); // 850
const HEADER_FOOTER = 720;

const GRID_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "auto" };

function cellParagraph(text, { bold = false, color } = {}) {
  // python-docx writes '\n' inside a cell as a line break
  const lines = String(text ?? "").split("\n");
  const runs = lines.map(
    (line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, bold, color, size: CELL_FONT_HALF_POINTS }),
  );
  return new Paragraph({ alignment: AlignmentType.LEFT, children: runs });
}

function cell(text, index, options = {}) {
  const width = cmToTwips(COLUMN_WIDTHS_CM[index]);
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: options.fill ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill } : undefined,
    children: [cellParagraph(text, options)],
  });
}

/**
 * The Word document. Pure: no DOM.
 * @param {Array<object>} items comms plan items ({id, activity, audience, ...})
 * @param {string} projectName
 */
export function buildCommsDocument(items, projectName = "Project") {
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      children: [new TextRun(`${projectName} — Communications Plan`)],
    }),
  ];

  if (!items || items.length === 0) {
    children.push(new Paragraph({ children: [new TextRun(EMPTY_MESSAGE)] }));
  } else {
    const headerRow = new TableRow({
      tableHeader: true,
      children: HEADERS.map((h, i) => cell(h, i, { bold: true, color: "FFFFFF", fill: HEADER_FILL })),
    });
    const rows = items.map(
      (item, idx) =>
        new TableRow({
          children: COLUMN_KEYS.map((key, i) =>
            cell(key === "id" ? String(item.id ?? idx + 1) : item[key] ?? "", i),
          ),
        }),
    );
    children.push(
      new Table({
        alignment: AlignmentType.LEFT,
        width: { size: 0, type: WidthType.AUTO },
        columnWidths: COLUMN_WIDTHS_CM.map(cmToTwips),
        borders: {
          top: GRID_BORDER,
          bottom: GRID_BORDER,
          left: GRID_BORDER,
          right: GRID_BORDER,
          insideHorizontal: GRID_BORDER,
          insideVertical: GRID_BORDER,
        },
        margins: { top: 0, bottom: 0, left: 108, right: 108 },
        rows: [headerRow, ...rows],
      }),
    );
  }

  return new Document({
    creator: "NoodlePlanner",
    title: `${projectName} — Communications Plan`,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
          paragraph: { spacing: { after: 200, line: 276 } },
        },
        // python-docx's "Heading 1": 14pt bold in the theme's dark blue
        heading1: {
          run: { font: "Cambria", bold: true, size: 28, color: "365F91" },
          paragraph: { keepNext: true, keepLines: true, spacing: { before: 480, after: 0 }, outlineLevel: 0 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height, orientation: PageOrientation.LANDSCAPE },
            margin: {
              top: PAGE_MARGIN,
              right: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
              header: HEADER_FOOTER,
              footer: HEADER_FOOTER,
              gutter: 0,
            },
          },
        },
        children,
      },
    ],
  });
}

/** The .docx bytes. Pure. */
export async function buildCommsDocx(items, projectName) {
  const buffer = await Packer.toArrayBuffer(buildCommsDocument(items, projectName));
  return new Uint8Array(buffer);
}

/**
 * `<Project Name> - Communications Plan.docx`, keeping only letters, digits,
 * spaces, hyphens and underscores from the name as the server route does.
 */
export function docxFilename(projectName) {
  const safe = Array.from(String(projectName ?? "Project"))
    .filter((c) => /[\p{L}\p{N}]/u.test(c) || " -_".includes(c))
    .join("")
    .trim();
  return `${safe} - Communications Plan.docx`;
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export in the browser. Makes no request at all.
 * @param {Array<object>} items
 * @param {string} projectName
 * @param {{download?: Function}} [io] overridable for tests
 * @returns {Promise<{filename: string, bytes: Uint8Array}>}
 */
export async function exportCommsDocxInBrowser(items, projectName, io = {}) {
  const bytes = await buildCommsDocx(items, projectName);
  const filename = docxFilename(projectName);
  (io.download || downloadBytes)(bytes, filename);
  return { filename, bytes };
}
