import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/StatCard";
import { useBillingSession } from "@/lib/billing-session";
import { formatBRL, formatDate } from "@/lib/finance";
import {
  parseFiscalPdf,
  type FiscalDirection,
  type ParsedFiscalDocument,
} from "@/lib/fiscal-pdf-parser";

interface StoredFiscalDocument extends ParsedFiscalDocument {
  id: string;
  source_file: string;
  imported_at: string;
}

interface ImportResult {
  created: number;
  existing: number;
}

const DIRECTION_LABEL: Record<FiscalDirection, string> = {
  ENTRADA: "Notas Fiscais de Entrada",
  SAIDA: "Notas Fiscais de Saída",
};

export function FiscalReportsImport() {
  const { authenticated } = useBillingSession();
  const [documents, setDocuments] = useState<StoredFiscalDocument[]>([]);
  const [busyDirection, setBusyDirection] = useState<FiscalDirection | null>(null);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inputRefs = useRef<Record<FiscalDirection, HTMLInputElement | null>>({
    ENTRADA: null,
    SAIDA: null,
  });

  const loadDocuments = useCallback(async () => {
    if (!authenticated) {
      setDocuments([]);
      return;
    }
    const response = await fetch("/api/billing?resource=fiscal");
    const result = (await response.json()) as {
      error?: string;
      documents?: StoredFiscalDocument[];
    };
    if (!response.ok)
      throw new Error(result.error ?? "Não foi possível carregar as notas fiscais.");
    setDocuments(result.documents ?? []);
  }, [authenticated]);

  useEffect(() => {
    void loadDocuments().catch((loadError: unknown) => {
      console.error("[fiscal-import]", loadError);
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar os documentos.",
      );
    });
  }, [loadDocuments]);

  async function importFile(file: File | undefined, direction: FiscalDirection) {
    if (!file) return;
    setBusyDirection(direction);
    setError("");
    setMessage("");
    try {
      if (file.size > 10_000_000) throw new Error("O PDF excede o limite de 10 MB.");
      setProgress("Lendo páginas do PDF…");
      const records = await parseFiscalPdf(file, direction, (page, pages) => {
        setProgress(`Lendo página ${page} de ${pages}…`);
      });
      setProgress(`Validando ${records.length} documento(s)…`);
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import_fiscal",
          sourceFile: file.name,
          records,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        created?: number;
        existing?: number;
      } & ImportResult;
      if (!response.ok) throw new Error(result.error ?? "Não foi possível importar o relatório.");
      setMessage(
        `${result.created ?? 0} nova(s) nota(s) e ${result.existing ?? 0} já existente(s) processada(s).`,
      );
      await loadDocuments();
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "Falha ao processar o relatório.",
      );
    } finally {
      setBusyDirection(null);
      setProgress("");
    }
  }

  return (
    <SectionCard
      title="Notas Fiscais de entrada e saída"
      description="Importação fiscal separada dos títulos financeiros. Estes documentos não alteram Contas a Receber, Contas a Pagar nem seus saldos."
    >
      <div className="space-y-4">
        {!authenticated ? (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Entre em <strong>Acesso de cobrança</strong>, no cabeçalho, para importar relatórios.
              A credencial é configurada como variável privada na Vercel.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {(["ENTRADA", "SAIDA"] as const).map((direction) => (
                <div key={direction} className="rounded-lg border border-border bg-muted/20 p-4">
                  <h3 className="text-sm font-semibold">{DIRECTION_LABEL[direction]}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Selecione o relatório correspondente exportado do Bling.
                  </p>
                  <input
                    ref={(element) => {
                      inputRefs.current[direction] = element;
                    }}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    disabled={busyDirection !== null}
                    onChange={(event) => {
                      void importFile(event.currentTarget.files?.[0], direction);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    type="button"
                    disabled={busyDirection !== null}
                    onClick={() => inputRefs.current[direction]?.click()}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyDirection === direction ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileUp className="size-4" />
                    )}
                    {busyDirection === direction ? "Processando…" : "Selecionar PDF"}
                  </button>
                </div>
              ))}
            </div>
            {progress && (
              <p role="status" className="text-xs text-muted-foreground">
                {progress}
              </p>
            )}
            {message && (
              <p role="status" className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {message}
              </p>
            )}
            {error && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
            <FiscalDocumentList documents={documents} />
          </>
        )}
      </div>
    </SectionCard>
  );
}

function FiscalDocumentList({ documents }: { documents: StoredFiscalDocument[] }) {
  if (!documents.length) {
    return <p className="text-xs text-muted-foreground">Nenhuma nota fiscal importada ainda.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[700px] text-left text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Número</th>
            <th className="px-3 py-2 font-medium">Emissão</th>
            <th className="px-3 py-2 font-medium">Cliente / Fornecedor</th>
            <th className="px-3 py-2 font-medium">Situação</th>
            <th className="px-3 py-2 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id} className="border-t border-border/60">
              <td className="px-3 py-2">
                {document.direction === "ENTRADA" ? "Entrada" : "Saída"}
                {document.invoice_type ? ` · ${document.invoice_type}` : ""}
              </td>
              <td className="px-3 py-2 font-medium">{document.document_number}</td>
              <td className="px-3 py-2">{formatDate(document.issue_date)}</td>
              <td className="px-3 py-2">{document.counterparty}</td>
              <td className="px-3 py-2">{document.status}</td>
              <td className="num px-3 py-2 text-right">{formatBRL(document.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {documents.length >= 100 && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Exibindo as 100 notas fiscais mais recentes.
        </p>
      )}
    </div>
  );
}
