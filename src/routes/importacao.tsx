import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { SectionCard } from "@/components/StatCard";
import { useImportQueue, type ImportJob } from "@/lib/import-context";
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

function Importacao() {
  const { jobs, enqueue, clearFinished } = useImportQueue();

  return (
    <AppLayout
      title="Importar relatório do Bling"
      subtitle="Qualquer arquivo PDF do Bling, de qualquer tamanho ou nome. A importação continua mesmo se você mudar de tela."
    >
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <UploadBox
            title="Contas a Receber"
            hint="Os registros serão importados como RECEITA."
            onFiles={(f) => enqueue(f, "RECEITA")}
          />
          <UploadBox
            title="Contas a Pagar"
            hint="Os registros serão importados como DESPESA."
            onFiles={(f) => enqueue(f, "DESPESA")}
          />
        </div>

        {jobs.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={clearFinished}
              className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <Trash2 className="size-3.5" /> Limpar concluídos
            </button>
          </div>
        )}

        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

function JobCard({ job }: { job: ImportJob }) {
  if (job.phase === "erro") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/8 p-4 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong>{job.fileName}</strong> — {job.error}
        </span>
      </div>
    );
  }

  if (job.phase !== "concluido") {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-primary" />
          {job.fileName}
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{job.detail}</p>
      </div>
    );
  }

  const r = job.summary!;
  return (
    <SectionCard title="Importação concluída" description={`${job.fileName} — ${r.type}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          Registros processados com deduplicação automática.
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Line label="Registros encontrados" value={String(r.found)} />
          <Line label="Registros válidos" value={String(r.valid)} />
          <Line label="Rejeitados" value={String(r.rejected)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Line label="Novos" value={String(r.created)} />
          <Line label="Já existentes" value={String(r.existing)} />
          <Line label="Atualizados" value={String(r.updated)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Line label="Valor total" value={formatBRL(r.total)} />
          <Line
            label={r.type === "RECEITA" ? "Recebido" : "Pago"}
            value={formatBRL(r.paid)}
          />
          <Line label="Em aberto" value={formatBRL(r.open)} />
        </div>
        {r.warning && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            {r.warning}
          </div>
        )}
        {r.pdfTotal !== null && r.divergence !== null && Math.abs(r.divergence) >= 0.01 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              Divergência de totais: o PDF informa <strong>{formatBRL(r.pdfTotal)}</strong>{" "}
              e a soma dos registros lidos é <strong>{formatBRL(r.total)}</strong>{" "}
              (diferença de {formatBRL(r.divergence)}). Os valores individuais foram
              preservados.
            </span>
          </div>
        )}
        {r.pdfTotal !== null && r.divergence !== null && Math.abs(r.divergence) < 0.01 && (
          <p className="text-xs text-muted-foreground">
            Total do PDF confere com o total calculado ({formatBRL(r.pdfTotal)}).
          </p>
        )}
      </div>
    </SectionCard>
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
  onFiles,
}: {
  title: string;
  hint: string;
  onFiles: (f: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <input
        ref={ref}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => ref.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files).filter((f) =>
            /\.pdf$/i.test(f.name),
          );
          if (files.length) onFiles(files);
        }}
        onDragOver={(e) => e.preventDefault()}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/30 px-4 py-8 text-sm font-medium transition-colors hover:bg-muted"
      >
        <FileUp className="size-4" /> Selecionar ou arrastar PDFs
      </button>
    </div>
  );
}

export type { MovementType };
