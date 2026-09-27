/**
 * <np-qr-code> -- a QR code for a link (#1389, epic #1376).
 *
 * The planning session's dialog shows one for its join link, so a phone
 * joins by pointing its camera at the host's screen rather than typing an
 * address and a code. The link carries the code in its fragment
 * (`/join#code=123456`), which never reaches the server; the code is on the
 * same screen beside it anyway.
 *
 * Usage:
 *   <script type="module" src="/static/components/qr-code/np-qr-code.js"></script>
 *   <np-qr-code value="https://example.org/join#code=123456"
 *               label="Scan to join on a phone"></np-qr-code>
 *
 * Attributes: `value`, the text to encode (nothing is drawn without it);
 * `label`, the image's accessible name ("QR code"); `size`, its side in CSS
 * pixels (176).
 *
 * The code is an SVG of one path, dark modules on light paper with the
 * four-module quiet zone the standard asks for. Its colours are
 * --np-qr-ink and --np-qr-paper, which are the same in both themes: a
 * camera reads dark on light most reliably, so the code stays that way in
 * the dark theme, as a printed one would. Error correction is level M
 * (15%), enough for a screen's glare.
 *
 * The encoder is qrcode-generator, vendored by scripts/vendor-qrcode.mjs.
 */

import qrcode from '../../vendor/qrcode/qrcode.mjs';

const QUIET_ZONE = 4;

/**
 * The modules of `text`'s QR code, as rows of booleans (true is dark), or
 * null for no text.
 */
export function qrMatrix(text, level = 'M') {
  if (!text) return null;
  const code = qrcode(0, level);
  code.addData(String(text), 'Byte');
  code.make();
  const count = code.getModuleCount();
  const rows = [];
  for (let row = 0; row < count; row++) {
    const cells = [];
    for (let col = 0; col < count; col++) cells.push(code.isDark(row, col));
    rows.push(cells);
  }
  return rows;
}

/** One SVG path for the dark modules, offset by the quiet zone. */
function pathFor(matrix) {
  let d = '';
  matrix.forEach((cells, row) => {
    cells.forEach((dark, col) => {
      if (dark) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    });
  });
  return d;
}

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-block;
      line-height: 0;
    }
    :host([hidden]) { display: none; }
    svg {
      display: block;
      border-radius: var(--np-radius-control, 8px);
      background: var(--np-qr-paper, #ffffff);
    }
    .paper { fill: var(--np-qr-paper, #ffffff); }
    .modules { fill: var(--np-qr-ink, #161616); }
  </style>
  <svg role="img" part="code" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <title></title>
    <rect class="paper" width="100%" height="100%"></rect>
    <path class="modules"></path>
  </svg>
`;

export class NpQrCode extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'label', 'size'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._svg = root.querySelector('svg');
    this._title = root.querySelector('title');
    this._path = root.querySelector('path');
    this._modules = 0;
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  get value() { return this.getAttribute('value') || ''; }
  set value(text) { this.setAttribute('value', text || ''); }

  /** Modules per side, without the quiet zone; 0 with nothing to draw. */
  get modules() { return this._modules; }

  _render() {
    const label = this.getAttribute('label') || 'QR code';
    const size = Number(this.getAttribute('size')) || 176;
    this._title.textContent = label;
    this._svg.setAttribute('aria-label', label);
    this._svg.setAttribute('width', String(size));
    this._svg.setAttribute('height', String(size));
    let matrix = null;
    try {
      matrix = qrMatrix(this.value);
    } catch (_) {
      // Longer than a QR code holds: draw nothing rather than half a code.
      matrix = null;
    }
    this._modules = matrix ? matrix.length : 0;
    this._svg.style.visibility = matrix ? '' : 'hidden';
    const side = this._modules + QUIET_ZONE * 2;
    this._svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
    this._path.setAttribute('d', matrix ? pathFor(matrix) : '');
  }
}

if (!customElements.get('np-qr-code')) {
  customElements.define('np-qr-code', NpQrCode);
}
