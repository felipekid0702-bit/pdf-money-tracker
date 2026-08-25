import { createFileRoute } from "@tanstack/react-router";
import { MovementsPage } from "@/components/MovementsPage";

export const Route = createFileRoute("/contas-a-pagar")({
  head: () => ({
    meta: [
      { title: "Contas a Pagar | FP Financeiro" },
      {
        name: "description",
        content:
          "Tabela completa das despesas da FP Solução em Altura com valores pagos, saldo em aberto e status.",
      },
      { property: "og:title", content: "Contas a Pagar | FP Financeiro" },
      {
        property: "og:description",
        content: "Despesas importadas dos relatórios do Bling.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <MovementsPage type="DESPESA" />,
});
