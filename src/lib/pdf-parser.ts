import type { MovementType } from "./finance";
import { todayISO } from "./finance";

export interface ParsedRecord {
  type: MovementType;
  document: string | null;
  counterparty: string | null;
  counterparty_document: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  original_amount: number;
  paid_amount: number;
  open_amount: number;
  status: string;
  source: "BLING_RECEBER" | "BLING_PAGAR";
  source_file: string;
  unique_key: string;
}

export interface ParseResult {
  type: MovementType;
  records: ParsedRecord[];
  pdfTotal: number | null;
  /** total de linhas candidatas encontradas no PDF */
  found: number;
  /** linhas descartadas: duplicadas no próprio arquivo ou inválidas */
  rejected: number;
}

interface Item {
  str: string;
  x: number;
  y: number;
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MONEY_RE = /^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/;

function toISO(br: string): string | null {
  const m = DATE_RE.exec(br);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toNumber(br: string): number {
  return Number(br.replace(/\./g, "").replace(",", ".")) || 0;
}

function normalizeKeyPart(v: string | null): string {
  return (v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

function mapStatus(
  raw: string,
  type: MovementType,
  dueDate: string | null,
): { status: string; paidFull: boolean } {
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const settled = type === "RECEITA" ? "RECEBIDO" : "PAGO";
  const partial =
    type === "RECEITA" ? "PARCIALMENTE_RECEBIDO" : "PARCIALMENTE_PAGO";

  if (s.includes("parcial")) return { status: partial, paidFull: false };
  if (s.includes("pago") || s.includes("paga") || s.includes("recebid"))
    return { status: settled, paidFull: true };
  if (s.includes("atras")) return { status: "ATRASADO", paidFull: false };
  if (s.includes("abert") || s.includes("cancel") || s === "") {
    if (dueDate && dueDate < todayISO())
      return { status: "ATRASADO", paidFull: false };
    return { status: "EM_ABERTO", paidFull: false };
  }
  if (dueDate && dueDate < todayISO())
    return { status: "ATRASADO", paidFull: false };
  return { status: "EM_ABERTO", paidFull: false };
}

export async function parseBlingPdf(
  file: File,
  onProgress?: (page: number, pages: number) => void,
): Promise<ParseResult> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;

  let kind: MovementType | null = null;
  let histX: number | null = null;
  let pdfTotal: number | null = null;
  const records: ParsedRecord[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items as Array<{
      str?: string;
      transform?: number[];
    }>) {
      const str = (it.str ?? "").trim();
      if (!str || !it.transform) continue;
      items.push({ str, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0 });
    }
    if (!items.length) continue;

    const pageText = items.map((i) => i.str).join(" ");
    if (!kind) {
      if (/Contas a Receber/i.test(pageText)) kind = "RECEITA";
      else if (/Contas a Pagar/i.test(pageText)) kind = "DESPESA";
    }
    if (histX === null) {
      const h = items.find((i) => /^Hist/i.test(i.str));
      if (h) histX = h.x;
    }

    // group items into lines by y
    const lines: Item[][] = [];
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs((last[0]?.y ?? 0) - it.y) < 3) last.push(it);
      else lines.push([it]);
    }
    for (const l of lines) l.sort((a, b) => a.x - b.x);

    const boundary = histX ?? 200;

    interface Row {
      rec: ParsedRecord;
      y: number;
    }
    const pageRows: Row[] = [];
    const leftovers: Item[][] = [];

    for (const line of lines) {
      const texts = line.map((i) => i.str);
      const joined = texts.join(" ");

      if (/^Total/i.test(joined) || /Total\s*=/.test(joined)) {
        const money = texts.filter((t) => MONEY_RE.test(t.replace(/^R\$\s*/, "")));
        const last = money[money.length - 1];
        if (last) pdfTotal = toNumber(last.replace(/^R\$\s*/, ""));
        continue;
      }
      if (/Rel[aá]t[oó]rio de Contas|^Per[ií]odo /i.test(joined)) continue;
      if (
        /^(Cliente|Fornecedor|Hist|Vencimento|Situa|Valor|valor|Forma de|pagamento|Nro\.|documento)$/i.test(
          joined,
        )
      )
        continue;

      const dateIdx: number[] = [];
      let valueIdx = -1;
      texts.forEach((t, i) => {
        if (DATE_RE.test(t)) dateIdx.push(i);
        if (MONEY_RE.test(t)) valueIdx = i;
      });

      if (!dateIdx.length || valueIdx === -1 || valueIdx < dateIdx[0]!) {
        leftovers.push(line);
        continue;
      }

      const dueIdx = dateIdx[dateIdx.length - 1]!;
      const dueDate = toISO(texts[dueIdx]!);
      const issueDate =
        dateIdx.length > 1 ? toISO(texts[dateIdx[0]!]!) : null;

      const statusRaw = texts.slice(dueIdx + 1, valueIdx).join(" ");
      const amount = toNumber(texts[valueIdx]!);

      // document = token right before the first date, ignoring the fixed
      // "Conta a receber/pagar" payment-method column
      let document: string | null = null;
      for (let i = dueIdx - 1; i >= 0; i--) {
        const t = texts[i]!;
        if (/^(Conta|a|receber\/pagar|receber|pagar)$/i.test(t)) continue;
        document = t;
        break;
      }

      const nameParts: string[] = [];
      const descParts: string[] = [];
      const docTokenIndex = document ? texts.lastIndexOf(document) : -1;
      line.forEach((it, i) => {
        if (i >= dueIdx) return;
        if (i === docTokenIndex) return;
        if (/^(Conta a|Conta|receber\/pagar)$/i.test(it.str)) return;
        if (it.x < boundary - 5) nameParts.push(it.str);
        else descParts.push(it.str);
      });

      const { status, paidFull } = mapStatus(statusRaw, kind ?? "RECEITA", dueDate);
      const paid = paidFull ? amount : 0;

      const rec: ParsedRecord = {
        type: kind ?? "RECEITA",
        document,
        counterparty: nameParts.join(" ").trim() || null,
        counterparty_document: null,
        description: descParts.join(" ").trim() || null,
        issue_date: issueDate,
        due_date: dueDate,
        payment_date: null,
        original_amount: amount,
        paid_amount: paid,
        open_amount: Number((amount - paid).toFixed(2)),
        status,
        source: (kind ?? "RECEITA") === "RECEITA" ? "BLING_RECEBER" : "BLING_PAGAR",
        source_file: file.name,
        unique_key: "",
      };
      pageRows.push({ rec, y: line[0]!.y });
    }

    // attach wrapped counterparty / description fragments to nearest record row
    for (const line of leftovers) {
      if (!pageRows.length) continue;
      const y = line[0]!.y;
      let best = pageRows[0]!;
      for (const r of pageRows)
        if (Math.abs(r.y - y) < Math.abs(best.y - y)) best = r;
      for (const it of line) {
        if (/^(Conta a|Conta|receber\/pagar)$/i.test(it.str)) continue;
        if (it.x < boundary - 5)
          best.rec.counterparty = `${best.rec.counterparty ?? ""} ${it.str}`.trim();
        else
          best.rec.description = `${best.rec.description ?? ""} ${it.str}`.trim();
      }
    }

    for (const r of pageRows) records.push(r.rec);
    page.cleanup();
    if (p % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await loadingTask.destroy();


  const type: MovementType = kind ?? "RECEITA";
  for (const r of records) {
    r.type = type;
    r.source = type === "RECEITA" ? "BLING_RECEBER" : "BLING_PAGAR";
    r.unique_key = [
      type,
      normalizeKeyPart(r.document),
      normalizeKeyPart(r.counterparty),
      r.due_date ?? "",
      r.original_amount.toFixed(2),
    ].join("|");
  }

  // drop duplicates inside the same file and rows without value/vencimento
  const seen = new Set<string>();
  const unique = records.filter((r) => {
    if (!r.due_date || !(r.original_amount > 0)) return false;
    if (seen.has(r.unique_key)) return false;
    seen.add(r.unique_key);
    return true;
  });

  return {
    type,
    records: unique,
    pdfTotal,
    found: records.length,
    rejected: records.length - unique.length,
  };
}
