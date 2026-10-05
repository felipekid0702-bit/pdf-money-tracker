import { createFileRoute } from "@tanstack/react-router";
import { ReceivableActionsPage } from "@/components/ReceivableActionsPage";

export const Route = createFileRoute("/acoes-de-cobranca")({
  head: () => ({
    meta: [
      { title: "Ações de Cobrança | FP Financeiro" },
      {
        name: "description",
        content: "Histórico auxiliar dos e-mails de cobrança e avisos enviados pela automação.",
      },
    ],
  }),
  component: ReceivableActionsPage,
});
