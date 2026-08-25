import { createFileRoute } from "@tanstack/react-router";
import { MovementsPage } from "@/components/MovementsPage";

export const Route = createFileRoute("/contas-a-receber")({
  head: () => ({
    meta: [
      { title: "Contas a Receber | FP Financeiro" },
      {
        name: "description",
        content:
          "Tabela completa das receitas da FP Solução em Altura com valores recebidos, saldo em aberto e status.",
      },
      { property: "og:title", content: "Contas a Receber | FP Financeiro" },
      {
        property: "og:description",
        content: "Receitas importadas dos relatórios do Bling.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <MovementsPage type="RECEITA" />,
});
