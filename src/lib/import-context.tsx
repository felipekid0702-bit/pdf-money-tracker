import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseBlingPdf, type RejectedRecord } from "./pdf-parser";
import type { ImportSummary } from "./data";
import type { MovementType } from "./finance";
import { useCompany } from "@/lib/company-context";

export type JobPhase = "fila" | "lendo" | "gravando" | "concluido" | "erro";

export interface ImportJob {
  id: string;
  fileName: string;
  companyId: string;
  companyName: string;
  expected: MovementType;
  phase: JobPhase;
  progress: number; // 0..1
  detail: string;
  summary?: ImportSummary & {
    type: MovementType;
    warning?: string;
    rejectedItems: RejectedRecord[];
  };
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
  const { company, ready } = useCompany();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const queueRef = useRef<
    Array<{
      id: string;
      file: File;
      expected: MovementType;
      companyId: string;
      companyName: string;
    }>
  >([]);
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
        const { id, file, expected, companyId, companyName } = next;
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
          const response = await fetch("/api/billing", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "import_records",
              companyId,
              records: parsed.records,
              pdfTotal: parsed.pdfTotal,
              fileName: file.name,
              found: parsed.found,
              rejected: parsed.rejected,
            }),
          });
          const result = (await response.json()) as ImportSummary & { error?: string };
          if (!response.ok) {
            throw new Error(result.error ?? "Falha ao gravar os registros financeiros.");
          }
          const summary: ImportSummary = result;
          patch(id, {
            phase: "concluido",
            progress: 1,
            detail: `Importação concluída para ${companyName}`,
            summary: {
              ...summary,
              type: parsed.type,
              rejectedItems: parsed.rejectedItems,
              ...(parsed.type !== expected
                ? {
                    warning: `O arquivo foi identificado como ${
                      parsed.type === "RECEITA" ? "Contas a Receber" : "Contas a Pagar"
                    } e importado como ${parsed.type}.`,
                  }
                : {}),
            },
          });
          await qc.invalidateQueries({ queryKey: ["movements", companyId] });
          await qc.invalidateQueries({ queryKey: ["partial-balances", companyId] });
        } catch (e) {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "object" && e && "message" in e
                ? String((e as { message: unknown }).message)
                : "Falha ao processar o PDF.";
          console.error("[importacao]", file.name, e);
          patch(id, { phase: "erro", progress: 1, error: msg });
        }
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      await qc.invalidateQueries({ queryKey: ["movements"] });
      await qc.invalidateQueries({ queryKey: ["partial-balances"] });
    }
  }, [patch, qc]);

  const enqueue = useCallback(
    (files: File[], expected: MovementType) => {
      if (!ready) {
        throw new Error("Aguarde a identificação da empresa ativa antes de importar.");
      }
      if (
        !window.confirm(
          `Você está importando dados para: ${company.name.toLocaleUpperCase("pt-BR")}. Deseja continuar?`,
        )
      ) {
        return;
      }
      const created = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        expected,
        companyId: company.id,
        companyName: company.name,
      }));
      setJobs((prev) => [
        ...prev,
        ...created.map<ImportJob>(({ id, file }) => ({
          id,
          fileName: file.name,
          companyId: company.id,
          companyName: company.name,
          expected,
          phase: "fila",
          progress: 0,
          detail: "Na fila",
        })),
      ]);
      queueRef.current.push(...created);
      void drain();
    },
    [company, drain, ready],
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
