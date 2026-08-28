import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseBlingPdf } from "./pdf-parser";
import { importRecords, type ImportSummary } from "./data";
import type { MovementType } from "./finance";

export type JobPhase = "fila" | "lendo" | "gravando" | "concluido" | "erro";

export interface ImportJob {
  id: string;
  fileName: string;
  expected: MovementType;
  phase: JobPhase;
  progress: number; // 0..1
  detail: string;
  summary?: ImportSummary & { type: MovementType; warning?: string };
  error?: string;
}

interface ImportContextValue {
  jobs: ImportJob[];
  running: boolean;
  enqueue: (files: File[], expected: MovementType) => void;
  clearFinished: () => void;
}

const ImportContext = createContext<ImportContextValue | null>(null);

export function useImportQueue(): ImportContextValue {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error("useImportQueue precisa do ImportProvider");
  return ctx;
}

export function ImportProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const queueRef = useRef<Array<{ id: string; file: File; expected: MovementType }>>([]);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();

  const patch = useCallback((id: string, p: Partial<ImportJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...p } : j)));
  }, []);

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      for (;;) {
        const next = queueRef.current.shift();
        if (!next) break;
        const { id, file, expected } = next;
        try {
          patch(id, { phase: "lendo", detail: "Lendo PDF…", progress: 0 });
          const parsed = await parseBlingPdf(file, (page, pages) => {
            patch(id, {
              progress: (page / pages) * 0.5,
              detail: `Lendo página ${page} de ${pages}`,
            });
          });
          if (parsed.records.length === 0) {
            patch(id, {
              phase: "erro",
              error: "Nenhum registro financeiro foi identificado neste PDF.",
              progress: 1,
            });
            continue;
          }
          patch(id, {
            phase: "gravando",
            detail: `Gravando ${parsed.records.length} registros…`,
            progress: 0.5,
          });
          const summary = await importRecords(
            parsed.records,
            parsed.pdfTotal,
            file.name,
            parsed.found,
            parsed.rejected,
            (done, total) => {
              patch(id, {
                progress: 0.5 + (total ? done / total : 1) * 0.5,
                detail: `Gravando ${done} de ${total} registros`,
              });
            },
          );
          patch(id, {
            phase: "concluido",
            progress: 1,
            detail: "Importação concluída",
            summary: {
              ...summary,
              type: parsed.type,
              ...(parsed.type !== expected
                ? {
                    warning: `O arquivo foi identificado como ${
                      parsed.type === "RECEITA" ? "Contas a Receber" : "Contas a Pagar"
                    } e importado como ${parsed.type}.`,
                  }
                : {}),
            },
          });
          await qc.invalidateQueries({ queryKey: ["movements"] });
        } catch (e) {
          patch(id, {
            phase: "erro",
            progress: 1,
            error: e instanceof Error ? e.message : "Falha ao processar o PDF.",
          });
        }
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      await qc.invalidateQueries({ queryKey: ["movements"] });
    }
  }, [patch, qc]);

  const enqueue = useCallback(
    (files: File[], expected: MovementType) => {
      const created = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        expected,
      }));
      setJobs((prev) => [
        ...prev,
        ...created.map<ImportJob>(({ id, file }) => ({
          id,
          fileName: file.name,
          expected,
          phase: "fila",
          progress: 0,
          detail: "Na fila",
        })),
      ]);
      queueRef.current.push(...created);
      void drain();
    },
    [drain],
  );

  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.phase !== "concluido" && j.phase !== "erro"));
  }, []);

  const value = useMemo(
    () => ({ jobs, running, enqueue, clearFinished }),
    [jobs, running, enqueue, clearFinished],
  );

  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}
