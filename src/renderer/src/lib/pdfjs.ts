/** Loads PDF.js and points it at its worker. Shared by the cover extractor and the reader. */
export async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export type PdfJs = Awaited<ReturnType<typeof loadPdfJs>>
