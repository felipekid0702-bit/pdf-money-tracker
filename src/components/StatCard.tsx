import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  period,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  period?: string;
  tone?: "default" | "success" | "danger" | "warning" | "info";
  icon?: ReactNode;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    danger: "text-destructive",
    warning: "text-warning",
    info: "text-info",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon}
      </div>
      <div className={cn("num mt-2 text-xl font-semibold sm:text-2xl", toneClass)}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      {period && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          Período: {period}
        </div>
      )}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card shadow-xs", className)}
    >
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
      <p className="text-sm font-medium">Nenhum dado financeiro importado.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {message ?? "Importe um relatório PDF do Bling para começar."}
      </p>
    </div>
  );
}

/** KPI com nome, valor, unidade, período, explicação, fórmula e interpretação. */
export function KpiCard({
  name,
  value,
  unit,
  period,
  explanation,
  formula,
  interpretation,
  tone = "default",
  insufficient,
}: {
  name: string;
  value: string;
  unit?: string;
  period?: string;
  explanation: string;
  formula: string;
  interpretation?: string;
  tone?: "default" | "success" | "danger" | "warning" | "info";
  insufficient?: boolean;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    danger: "text-destructive",
    warning: "text-warning",
    info: "text-info",
  }[tone];

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {name}
      </span>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={cn(
            "num text-xl font-semibold sm:text-2xl",
            insufficient ? "text-muted-foreground" : toneClass,
          )}
        >
          {insufficient ? "Dados insuficientes para cálculo" : value}
        </span>
        {!insufficient && unit && (
          <span className="text-xs text-muted-foreground">{unit}</span>
        )}
      </div>
      {period && <p className="mt-1 text-[11px] text-muted-foreground">Período: {period}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{explanation}</p>
      <p className="mt-1 text-[11px] text-muted-foreground/80">
        <span className="font-medium">Fórmula:</span> {formula}
      </p>
      {!insufficient && interpretation && (
        <p className="mt-1 text-[11px] text-muted-foreground/80">
          <span className="font-medium">Leitura:</span> {interpretation}
        </p>
      )}
    </div>
  );
}
