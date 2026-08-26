import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { SectionCard } from "@/components/StatCard";
import { parseBlingPdf } from "@/lib/pdf-parser";
import { importRecords, type ImportSummary } from "@/lib/data";
import { formatBRL, type MovementType } from "@/lib/finance";

export const Route = createFileRoute("/importacao")({
  head: () => ({
    meta: [
      { title: "Importação de relatórios | FP Financeiro" },
      {
        name: "description",
        content:
          "Importe os relatórios PDF de Contas a Receber e Contas a Pagar do Bling sem duplicar registros.",
      },
      { property: "og:title", content: "Importação de relatórios | FP Financeiro" },
      {
        property: "og:description",
        content: "Transforme os PDFs do Bling em movimentos financeiros estruturados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Importacao,
});

interface Result extends ImportSummary {
  type: MovementType;
  fileName: string;
  warning?: string;
}

function Importacao() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<MovementType | null>(null);
  const qc = useQueryClient();

  async function handleFile(file: File, expected: MovementType) {
    setBusy(expected);
    setError(null);
    setResult(null);
    try {
      const parsed = await parseBlingPdf(file);
      if (parsed.records.length === 0) {
        setError("Nenhum registro foi identificado neste PDF.");
        return;
      }
      const summary = await importRecords(
        parsed.records,
        parsed.pdfTotal,
        file.name,
        parsed.found,
        parsed.rejected,
      );
      setResult({
        ...summary,
        type: parsed.type,
        fileName: file.name,
        warning:
          parsed.type !== expected
            ? `O arquivo enviado foi identificado como ${
                parsed.type === "RECEITA" ? "Contas a Receber" : "Contas a Pagar"
              } e foi importado como ${parsed.type}.`
            : undefined,
      });
      await qc.invalidateQueries({ queryKey: ["movements"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao processar o PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppLayout
      title="Importar relatório do Bling"
      subtitle="Somente arquivos PDF exportados do Bling"
    >
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <UploadBox
            title="Contas a Receber"
            hint="Os registros serão importados como RECEITA."
            busy={busy === "RECEITA"}
            onFile={(f) => handleFile(f, "RECEITA")}
          />
          <UploadBox
            title="Contas a Pagar"
            hint="Os registros serão importados como DESPESA."
            busy={busy === "DESPESA"}
            onFile={(f) => handleFile(f, "DESPESA")}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/8 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <SectionCard
            title="Importação concluída"
            description={`${result.fileName} — ${result.type}`}
          >
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                Registros processados com deduplicação automática.
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Line label="Registros encontrados" value={String(result.found)} />
                <Line label="Novos" value={String(result.created)} />
                <Line label="Já existentes" value={String(result.existing)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Line label="Valor total" value={formatBRL(result.total)} />
                <Line
                  label={result.type === "RECEITA" ? "Recebido" : "Pago"}
                  value={formatBRL(result.paid)}
                />
                <Line label="Em aberto" value={formatBRL(result.open)} />
              </div>
              {result.warning && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  {result.warning}
                </div>
              )}
              {result.pdfTotal !== null &&
                result.divergence !== null &&
                Math.abs(result.divergence) >= 0.01 && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      Divergência de totais: o PDF informa{" "}
                      <strong>{formatBRL(result.pdfTotal)}</strong> e a soma dos registros
                      lidos é <strong>{formatBRL(result.total)}</strong> (diferença de{" "}
                      {formatBRL(result.divergence)}). Os valores individuais foram
                      preservados.
                    </span>
                  </div>
                )}
              {result.pdfTotal !== null &&
                result.divergence !== null &&
                Math.abs(result.divergence) < 0.01 && (
                  <p className="text-xs text-muted-foreground">
                    Total do PDF confere com o total calculado ({formatBRL(result.pdfTotal)}).
                  </p>
                )}
            </div>
          </SectionCard>
        )}
      </div>
    </AppLayout>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function UploadBox({
  title,
  hint,
  busy,
  onFile,
}: {
  title: string;
  hint: string;
  busy: boolean;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/30 px-4 py-8 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Processando PDF…
          </>
        ) : (
          <>
            <FileUp className="size-4" /> Selecionar arquivo PDF
          </>
        )}
      </button>
    </div>
  );
}
