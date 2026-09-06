/* Build full plan workbooks off the UI thread. */
self.onmessage = async function (event) {
    try {
        importScripts(event.data.excelJsUrl);
        if (!self.ExcelJS) {
            throw new Error('ExcelJS did not initialise in the export worker');
        }

        const module = await import('./browser-excel.js');
        const options = event.data.options || {};
        const workbook = await module.createPlanWorkbook(event.data.parseResult, {
            ExcelJS: self.ExcelJS,
            projectName: options.projectName,
            budgetItems: options.budgetItems,
            now: options.now ? new Date(options.now) : new Date(),
        });
        const buffer = await workbook.xlsx.writeBuffer();
        const transferable = buffer instanceof ArrayBuffer
            ? buffer
            : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        self.postMessage({ buffer: transferable }, [transferable]);
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
