import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useImportQueue } from "@/lib/import-context";

/** Barra flutuante global: a importação continua mesmo trocando de tela. */
export function ImportStatusBar() {
  const { jobs } = useImportQueue();
  const active = jobs.filter((j) => j.phase !== "concluido" && j.phase !== "erro");
  if (active.length === 0) return null;
  const current = active[0]!;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="truncate">{current.fileName}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.round(current.progress * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {current.detail}
        {active.length > 1 ? ` · +${active.length - 1} na fila` : ""}
      </p>
      <Link to="/importacao" className="mt-2 inline-block text-xs text-primary underline">
        Ver detalhes da importação
      </Link>
    </div>
  );
}
