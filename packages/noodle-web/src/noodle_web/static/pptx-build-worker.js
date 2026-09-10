/**
 * Builds the portfolio PowerPoint deck off the main thread (issue #1068).
 *
 * html2canvas needs a live DOM to rasterise the timeline swimlanes, so image
 * capture has to stay on the main thread. But assembling the deck (dozens of
 * addTable/addText/addImage calls per project) and zipping the result with
 * JSZip is pure, DOM-free CPU work, and it's what actually freezes the UI on
 * a large portfolio -- so that part runs here instead.
 *
 * Receives { portfolioData, projectReports } and replies with progress
 * messages while building, then a final { type: 'done', filename, bytes }
 * (bytes transferred, not copied) or { type: 'error', message }.
 */
import { buildPortfolioDeck, deckBytes, pptxFilename } from "./pptx-export.js";

self.onmessage = async (event) => {
  const { portfolioData, projectReports } = event.data || {};
  try {
    const pptx = buildPortfolioDeck(portfolioData, projectReports, (done, total, label) => {
      self.postMessage({ type: "progress", done, total, label });
    });

    self.postMessage({ type: "progress", label: "Compressing PowerPoint file" });
    const bytes = await deckBytes(pptx);
    const filename = pptxFilename(portfolioData?.portfolio_name, " - Portfolio Report");

    self.postMessage({ type: "done", filename, bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: (error && error.message) || String(error) });
  }
};
