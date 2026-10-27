export type FiscalDirection = "ENTRADA" | "SAIDA";

export interface ParsedFiscalDocument {
  direction: FiscalDirection;
  document_number: string;
  invoice_type: string | null;
  issue_date: string;
  counterparty: string;
  status: string;
  amount: number;
}

interface PdfItem {
  str: string;
  x: number;
  y: number;
}

interface HeaderColumns {
  document: number;
  invoiceType: number | null;
  date: number;
  counterparty: number | null;
  status: number | null;
  amount: number;
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MONEY_RE = /^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/;
const NUMBER_RE = /^\d[\d./-]*$/;
const STATUS_RE =
  /registrad|cancelad|autorizad|denegad|inutiliz|rejeitad|pendente|emitid|aprovad|enviad|conclu|conting|rascunho/i;
const INVOICE_TYPE_RE = /^(?:NF-e|NFC-e|NFS-e|CT-e|MDF-e|Nota Fiscal(?: de Serviço)?)$/i;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toISO(value: string): string | null {
  const match = DATE_RE.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/^R\$\s*/i, "");
  if (!MONEY_RE.test(cleaned)) return null;
  const amount = Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : null;
}

function groupLines(items: PdfItem[]): PdfItem[][] {
  const lines: PdfItem[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines[lines.length - 1];
    if (line && Math.abs((line[0]?.y ?? 0) - item.y) < 3) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

function findColumn(line: PdfItem[], match: RegExp): number | null {
  const item = line.find((entry) => match.test(normalizeText(entry.str)));
  return item?.x ?? null;
}

function findHeader(lines: PdfItem[][]): HeaderColumns | null {
  for (const line of lines) {
    const document = findColumn(line, /^(?:n[º°.]?|numero|documento|nota)/);
    const date = findColumn(line, /emissao|^data/);
    const amount = findColumn(line, /valor|total/);
    if (document === null || date === null || amount === null) continue;
    return {
      document,
      invoiceType: findColumn(line, /^tipo|esp[eé]cie/),
      date,
      counterparty: findColumn(line, /cliente|fornecedor|destinatario|emitente/),
      status: findColumn(line, /situacao|^status$/),
      amount,
    };
  }
  return null;
}

function textBetween(line: PdfItem[], lower: number, upper: number, exclude?: RegExp): string {
  return line
    .filter((item) => item.x >= lower && item.x < upper && !exclude?.test(item.str.trim()))
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export async function parseFiscalPdf(
  file: File,
  direction: FiscalDirection,
  onProgress?: (page: number, pages: number) => void,
): Promise<ParsedFiscalDocument[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const records: ParsedFiscalDocument[] = [];
  let columns: HeaderColumns | null = null;
  let identifiedDirection: FiscalDirection | null = null;
  let failedRows = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      onProgress?.(pageNumber, doc.numPages);
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items as Array<{ str?: string; transform?: number[] }>)
        .filter((item) => item.str?.trim() && item.transform)
        .map((item) => ({
          str: item.str!.trim(),
          x: item.transform![4] ?? 0,
          y: item.transform![5] ?? 0,
        }));
      const pageText = normalizeText(items.map((item) => item.str).join(" "));
      if (/notas?\s+fiscais?\s+(?:de\s+)?entrada/.test(pageText)) identifiedDirection = "ENTRADA";
      if (/notas?\s+fiscais?\s+(?:de\s+)?saida/.test(pageText)) identifiedDirection = "SAIDA";

      const lines = groupLines(items);
      columns ??= findHeader(lines);
      if (!columns) {
        page.cleanup();
        continue;
      }

      for (const line of lines) {
        const joined = line
          .map((item) => item.str)
          .join(" ")
          .trim();
        if (/^(?:total|subtotal|p[aá]gina|relat[oó]rio)\b/i.test(joined)) continue;

        const dateItem = line.find((item) => DATE_RE.test(item.str));
        const moneyItems = line
          .map((item) => ({ item, amount: parseAmount(item.str) }))
          .filter((entry): entry is { item: PdfItem; amount: number } => entry.amount !== null);
        if (!dateItem || !moneyItems.length) continue;

        const amountEntry = moneyItems[moneyItems.length - 1]!;
        const numberItem = line.find(
          (item) =>
            item.x >= columns!.document &&
            item.x < dateItem.x &&
            NUMBER_RE.test(item.str.replace(/\s/g, "")),
        );
        const issueDate = toISO(dateItem.str);
        const upperPartyBound = columns.status ? columns.status - 20 : columns.amount - 20;
        const partyStart = columns.counterparty ?? dateItem.x;
        const counterparty = textBetween(line, partyStart, upperPartyBound, INVOICE_TYPE_RE);
        const status =
          columns.status === null
            ? line
                .filter(
                  (item) =>
                    STATUS_RE.test(item.str) && item.x >= (columns!.status ?? columns!.amount) - 25,
                )
                .map((item) => item.str.trim())
                .join(" ")
            : line
                .filter(
                  (item) =>
                    item.x >= columns!.status! - 20 &&
                    item.x < columns!.amount &&
                    STATUS_RE.test(item.str),
                )
                .map((item) => item.str.trim())
                .join(" ");
        const invoiceType =
          (columns.invoiceType === null
            ? undefined
            : line
                .find(
                  (item) =>
                    item.x >= columns!.invoiceType! - 5 &&
                    item.x < (columns!.date ?? columns!.counterparty ?? columns!.amount) &&
                    !DATE_RE.test(item.str),
                )
                ?.str.trim()) ??
          line.find((item) => INVOICE_TYPE_RE.test(item.str.trim()))?.str.trim() ??
          null;

        if (!numberItem || !issueDate || !counterparty) {
          failedRows++;
          continue;
        }

        records.push({
          direction,
          document_number: numberItem.str.trim(),
          invoice_type: invoiceType,
          issue_date: issueDate,
          counterparty,
          status: status || "Não informado",
          amount: amountEntry.amount,
        });
      }
      page.cleanup();
      if (pageNumber % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await loadingTask.destroy();
  }

  if (identifiedDirection && identifiedDirection !== direction) {
    throw new Error(
      `O relatório foi identificado como Nota Fiscal de ${identifiedDirection.toLowerCase()}, mas foi selecionado em ${direction.toLowerCase()}.`,
    );
  }
  if (!columns) {
    throw new Error(
      "Não reconheci o cabeçalho do relatório. Use o relatório de Notas Fiscais do Bling com colunas de número, emissão e valor.",
    );
  }
  if (failedRows) {
    throw new Error(
      `${failedRows} linha(s) com data e valor não puderam ser identificadas com segurança. Revise o relatório e tente novamente.`,
    );
  }
  if (!records.length) {
    throw new Error("Nenhuma nota fiscal foi reconhecida neste PDF.");
  }

  return records;
}
