import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Trash2, Upload } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { SectionCard } from "@/components/StatCard";
import { NyansapoMark } from "@/components/NyansapoMark";
import { clearAllData } from "@/lib/data";
import { useMovements } from "@/hooks/useMovements";
import { useBillingSession } from "@/lib/billing-session";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | FP Financeiro" },
      {
        name: "description",
        content:
          "Limpeza total dos movimentos financeiros e do histórico de importações do FP Financeiro.",
      },
      { property: "og:title", content: "Configurações | FP Financeiro" },
      {
        property: "og:description",
        content: "Apague todos os dados financeiros importados e comece de uma base vazia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data } = useMovements();
  const { authenticated } = useBillingSession();
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contactsMessage, setContactsMessage] = useState("");

  async function wipe() {
    setBusy(true);
    setError(null);
    try {
      await clearAllData();
      setDone(true);
      setStep(0);
      await qc.invalidateQueries({ queryKey: ["movements"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao apagar os dados.");
    } finally {
      setBusy(false);
    }
  }

  async function importContacts(file: File | undefined) {
    if (!file) return;
    setContactsBusy(true);
    setContactsMessage("");
    try {
      if (file.size > 1_000_000) throw new Error("O arquivo excede o limite de 1 MB.");
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import_contacts", contents: await file.text() }),
      });
      const result = (await response.json()) as {
        error?: string;
        imported?: number;
        rejected?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível importar os contatos.");
      setContactsMessage(
        `${result.imported ?? 0} contato(s) importado(s); ${result.rejected ?? 0} registro(s) ignorado(s).`,
      );
    } catch (error) {
      setContactsMessage(
        error instanceof Error ? error.message : "Não foi possível importar os contatos.",
      );
    } finally {
      setContactsBusy(false);
    }
  }

  return (
    <AppLayout title="Configurações" subtitle="FP SOLUÇÃO EM ALTURA LTDA — CNPJ 58.348.102/0001-82">
      <div className="space-y-5">
        <SectionCard
          title="Envio de cobranças"
          description="O disparo é feito no servidor pela Microsoft Graph; não depende do painel local nem do Outlook."
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Importe o arquivo JSON de contatos da automação. Os endereços ficam em uma tabela
              privada e só são consultados pelo servidor para o envio.
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
              <Upload className="size-4" />
              {contactsBusy ? "Importando…" : "Importar contatos JSON"}
              <input
                type="file"
                accept="application/json,.json"
                disabled={!authenticated || contactsBusy}
                onChange={(event) => {
                  void importContacts(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                className="sr-only"
              />
            </label>
            {!authenticated && (
              <p className="text-xs text-muted-foreground">
                Entre pelo controle “Acesso de cobrança” no cabeçalho para importar contatos.
              </p>
            )}
            {contactsMessage && (
              <p role="status" className="text-sm text-muted-foreground">
                {contactsMessage}
              </p>
            )}
          </div>
        </SectionCard>

        <div className="flex min-h-[260px] items-center justify-center py-6">
          <div className="flex items-center gap-5 text-foreground/80">
            <NyansapoMark variant="large" className="size-[140px] text-black" />
            <div className="max-w-xs">
              <p className="text-xl italic leading-snug text-foreground/90">
                “A chuva bate na folha, mas não a quebra; você deve agir como se fosse impossível
                falhar.”
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Ditado Ashanti</p>
            </div>
          </div>
        </div>

        <SectionCard
          title="Limpar dados financeiros"
          description={`${data?.length ?? 0} movimentos armazenados atualmente`}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Esta ação apaga todos os movimentos financeiros e o histórico de importações. A
              estrutura da aplicação e as configurações são preservadas.
            </p>

            {step === 0 && (
              <button
                onClick={() => {
                  setDone(false);
                  setStep(1);
                }}
                className="inline-flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                <Trash2 className="size-4" /> Apagar todos os dados
              </button>
            )}

            {step === 1 && (
              <div className="rounded-md border border-warning/50 bg-warning/10 p-4 text-sm">
                <p className="font-medium">
                  Confirmação 1 de 2: deseja realmente apagar todos os dados financeiros?
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setStep(2)}
                    className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground"
                  >
                    Sim, continuar
                  </button>
                  <button
                    onClick={() => setStep(0)}
                    className="rounded-md border border-input px-3 py-1.5 text-xs font-medium"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
                <p className="flex items-start gap-2 font-medium text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Confirmação 2 de 2: esta operação é irreversível.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={wipe}
                    className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
                  >
                    {busy && <Loader2 className="size-3 animate-spin" />}
                    Apagar definitivamente
                  </button>
                  <button
                    onClick={() => setStep(0)}
                    className="rounded-md border border-input px-3 py-1.5 text-xs font-medium"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {done && (
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                Dados apagados. A base está vazia novamente.
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/8 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </AppLayout>
  );
}
