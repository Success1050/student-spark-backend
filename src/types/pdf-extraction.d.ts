declare module 'pdf-extraction' {
  export interface PdfExtractResult {
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
  }
  export default function pdfExtract(dataBuffer: Buffer): Promise<PdfExtractResult>;
}
