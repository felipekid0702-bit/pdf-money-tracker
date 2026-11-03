import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Presentation, Printer } from "lucide-react";
import { toast } from "sonner";
import fpLogo from "@/assets/FP Logo - Fundo Branco.png";
import apoioVerticalLogo from "@/assets/Apoio Vertical Logo.jpeg";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState, SectionCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { useCompany } from "@/lib/company-context";
import { todayISO, formatDate } from "@/lib/finance";
import {
  aging,
  attentionPoints,
  namedProjections,
  openPosition,
  periodKpis,
  rankParties,
  timeSeries,
} from "@/lib/analytics";
import { usePeriod } from "@/lib/period";
import type { PresentationData } from "@/lib/presentation-export";

export const Route = createFileRoute("/apresentacoes")({
  head: () => ({
    meta: [
      { title: "Apresentações financeiras | FP Financeiro" },
      {
        name: "description",
        content:
          "Exporte um resumo financeiro de uma página ou um deck conciso para reuniões de conselho.",
      },
    ],
  }),
  component: Apresentacoes,
});

function Apresentacoes() {
  const { data, isLoading, isError, error } = useMovements();
  const { company } = useCompany();
  const { filter, label, range } = usePeriod();
  const [exporting, setExporting] = useState(false);
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => filter(all), [all, filter]);
  const today = todayISO();
  const kpis = useMemo(() => periodKpis(rows, today), [rows, today]);
  const position = useMemo(() => openPosition(all, today), [all, today]);
  const projections = useMemo(
    () =>
      namedProjections(
        all,
        [
          { id: "next30", label: "Próximos 30 dias" },
          { id: "next60", label: "Próximos 60 dias" },
          { id: "next90", label: "Próximos 90 dias" },
        ],
        today,
      ),
    [all, today],
  );
  const monthlyTrend = useMemo(() => timeSeries(all, "month", today).slice(-6), [all, today]);
  const topClients = useMemo(() => rankParties(rows, "RECEITA", today).slice(0, 5), [rows, today]);
  const topSuppliers = useMemo(
    () => rankParties(rows, "DESPESA", today).slice(0, 5),
    [rows, today],
  );
  const overdueReceivables = useMemo(() => aging(all, "RECEITA", "past", today), [all, today]);
  const overduePayables = useMemo(() => aging(all, "DESPESA", "past", today), [all, today]);
  const alerts = useMemo(() => attentionPoints(all, today), [all, today]);

  async function exportPdf(kind: "email" | "board") {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("O navegador bloqueou a nova janela. Permita pop-ups para gerar o PDF.");
      return;
    }

    setExporting(true);
    try {
      const { renderPresentation } = await import("@/lib/presentation-export");
      const payload: PresentationData = {
        companyName: company.name,
        legalName: company.legalName,
        cnpj: company.cnpj,
        logoUrl: company.logo === "apoio-vertical" ? apoioVerticalLogo : fpLogo,
        periodLabel: label,
        range,
        generatedAt: new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date()),
        kpis,
        position,
        projections,
        monthlyTrend,
        topClients,
        topSuppliers,
        overdueReceivables,
        overduePayables,
        alerts,
      };
      printWindow.document.open();
      printWindow.document.write(renderPresentation(payload, kind));
      printWindow.document.close();
    } catch (cause) {
      printWindow.close();
      console.error("[apresentacoes] falha ao gerar a apresentação", cause);
      toast.error("Não foi possível gerar a apresentação. Tente novamente.");
    } finally {
      setExporting(false);
    }
  }

  const periodDescription =
    range.from || range.to
      ? `${label} · ${formatDate(range.from) || "…"} a ${formatDate(range.to) || "…"}`
      : label;

  return (
    <AppLayout
      title="Apresentações"
      subtitle={`${company.name} · ${periodDescription}`}
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando os dados financeiros…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os dados para a apresentação:{" "}
          {error instanceof Error ? error.message : "erro inesperado"}.
        </p>
      ) : all.length === 0 ? (
        <EmptyState message="Importe um relatório do Bling para gerar uma apresentação." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <SectionCard
            title="Resumo por e-mail"
            description="Uma página com indicadores principais, tendência e pontos de atenção. O PDF fica leve para anexar ou compartilhar."
          >
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Inclui o período selecionado, receitas e despesas por títulos, saldo em aberto e
                alertas relevantes.
              </p>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportPdf("email")}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileText className="size-4" />
                {exporting ? "Preparando…" : "Gerar resumo em PDF"}
              </button>
            </div>
          </SectionCard>
          <SectionCard
            title="Board Deck"
            description="Apresentação de sete páginas com resumo executivo, desempenho por títulos, concentração, projeção, aging, riscos e próximos passos."
          >
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Estruturada para reunião de conselho, com gráficos e explicações concisas. Sem
                orçamento, saldo bancário ou classificação contábil inventados.
              </p>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportPdf("board")}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Presentation className="size-4" />
                {exporting ? "Preparando…" : "Gerar Board Deck em PDF"}
              </button>
            </div>
          </SectionCard>
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground xl:col-span-2">
            <div className="flex items-start gap-3">
              <Printer className="mt-0.5 size-4 shrink-0" />
              <p>
                A exportação abre a janela de impressão do navegador. Escolha{" "}
                <strong>Salvar como PDF</strong> para anexar o resumo a um e-mail ou compartilhar o
                deck. A apresentação respeita a empresa e o período selecionados. Orçamento, margem
                bruta, EBITDA, saldo bancário e runway dependem de dados que ainda não existem na
                aplicação e serão identificados como indisponíveis.
              </p>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
