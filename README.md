# FP Cash Flow

CONSTRUIR APLICAÇÃO — FP FINANCEIRO

Crie AGORA uma aplicação web funcional chamada FP Financeiro.

NÃO faça planejamento, análise, brainstorming ou proposta de arquitetura antes de executar.

NÃO explique o que pretende fazer.

NÃO peça confirmação.

NÃO crie funcionalidades além das especificadas.

EXECUTE DIRETAMENTE A CONSTRUÇÃO DA APLICAÇÃO.

O projeto é propositalmente simples.

1. OBJETIVO

Criar um agregador financeiro para a empresa:

FP SOLUÇÃO EM ALTURA LTDA
CNPJ: 58.348.102/0001-82

A aplicação terá como única fonte de dados, nesta primeira versão:

RELATÓRIOS PDF EXPORTADOS DO BLING.

Existem somente dois tipos de dados:

CONTAS A RECEBER

Representa receitas, faturamento e valores que a empresa tem a receber.

CONTAS A PAGAR

Representa despesas e valores que a empresa precisa pagar.

O objetivo é importar esses PDFs, transformar seus registros em movimentos financeiros estruturados e apresentar dashboards, análises e previsões.

2. NÃO IMPLEMENTAR

Para economizar créditos e manter o projeto simples, NÃO implementar:

XML;

NF-e;

SEFAZ;

impostos;

SPED;

cálculo tributário;

integração bancária;

Itaú;

APIs externas;

inteligência artificial;

chatbot;

ERP;

emissão de notas;

conciliação fiscal;

conciliação bancária;

cadastro complexo;

múltiplos usuários;

permissões avançadas;

módulos contábeis.

O único objetivo é FINANCEIRO.

3. TECNOLOGIA

Utilize a stack padrão disponível no Lovable.

Criar:

interface responsiva;

banco de dados persistente;

processamento de PDF;

armazenamento dos movimentos;

deduplicação;

dashboards;

filtros;

tabelas;

gráficos.

Não adicionar bibliotecas ou serviços externos desnecessários.

4. ESTRUTURA DA APLICAÇÃO

Criar somente estas páginas:

1. DASHBOARD

Página inicial.

2. CONTAS A RECEBER

Tabela completa das receitas.

3. CONTAS A PAGAR

Tabela completa das despesas.

4. ANÁLISES

Análises por período, clientes e fornecedores.

5. IMPORTAÇÃO

Importação dos PDFs.

6. CONFIGURAÇÕES

Limpeza dos dados.

Não criar outras páginas.

5. IMPORTAÇÃO

Criar uma tela simples:

IMPORTAR RELATÓRIO DO BLING

Dois campos de upload:

CONTAS A RECEBER

Aceitar PDF.

CONTAS A PAGAR

Aceitar PDF.

O sistema deve identificar automaticamente o conteúdo.

Se o PDF for de Contas a Receber:

TIPO = RECEITA

Se o PDF for de Contas a Pagar:

TIPO = DESPESA

6. LEITURA DO PDF

Os PDFs são relatórios financeiros do Bling.

Ler os registros individualmente.

Extrair, quando disponíveis:

número/documento;

cliente ou fornecedor;

CPF/CNPJ;

descrição;

data de emissão;

vencimento;

pagamento;

valor;

valor pago/recebido;

saldo;

status.

Não inventar informações.

Se determinado campo não estiver no PDF, deixar vazio.

7. BANCO DE DADOS

Criar uma tabela principal:

financial_movements

Campos mínimos:

id

type

document

counterparty

counterparty_document

description

issue_date

due_date

payment_date

original_amount

paid_amount

open_amount

status

source

source_file

unique_key

created_at

updated_at

type

Somente:

RECEITA

DESPESA

source

Somente:

BLING_RECEBER

BLING_PAGAR

status RECEITA

RECEBIDO

EM_ABERTO

ATRASADO

PARCIALMENTE_RECEBIDO

status DESPESA

PAGO

EM_ABERTO

ATRASADO

PARCIALMENTE_PAGO

8. REGRA CRÍTICA — NÃO DUPLICAR

A aplicação deve impedir duplicidade.

O mesmo PDF pode ser importado várias vezes.

Se o usuário importar novamente o mesmo documento:

NÃO criar registros duplicados.

Criar unique_key utilizando os dados disponíveis:

TIPO + DOCUMENTO + CLIENTE/FORNECEDOR + VENCIMENTO + VALOR

Se existir identificador inequívoco do Bling, utilizar esse identificador.

Antes de inserir:

gerar unique_key;

consultar banco;

se existir, não inserir;

se não existir, inserir.

Também impedir duplicidade entre PDFs diferentes que contenham períodos sobrepostos.

9. STATUS

Usar prioritariamente o status informado pelo Bling.

Quando necessário, utilizar as datas para identificar:

EM ABERTO

Não pago e ainda não vencido.

ATRASADO

Não pago e vencimento anterior à data atual.

RECEBIDO/PAGO

Pagamento integral identificado.

PARCIAL

Valor pago menor que o valor original e maior que zero.

Nunca considerar uma receita como recebida apenas porque existe uma data de emissão.

10. TOTALIZAÇÃO

Após importar um PDF:

calcular:

quantidade de registros;

soma dos valores;

soma dos valores pagos;

soma dos valores em aberto.

Sempre preservar os valores individuais.

Se o relatório possuir total geral, comparar:

TOTAL DO PDF

versus

TOTAL CALCULADO

Se houver diferença, mostrar um alerta de divergência.

Nunca alterar valores para forçar a soma.

11. RESULTADO DA IMPORTAÇÃO

Depois de cada importação mostrar:

IMPORTAÇÃO CONCLUÍDA

registros encontrados;

registros novos;

registros já existentes;

registros atualizados;

valor total;

valor pago;

valor em aberto.

Exemplo visual:

250 registros encontrados
180 novos
70 já existentes

Total: R$ 250.000,00
Pago/Recebido: R$ 180.000,00
Em aberto: R$ 70.000,00

12. DASHBOARD

Criar um dashboard financeiro objetivo.

Cards:

RECEITAS

Faturamento

Recebido

A receber

Vencido

DESPESAS

Total

Pago

A pagar

Vencido

RESULTADO

Receitas - Despesas

Fluxo previsto

13. FILTRO DE PERÍODO

Criar filtro global:

Hoje

7 dias

15 dias

30 dias

60 dias

90 dias

6 meses

12 meses

Todo período

Personalizado

Todos os cards e gráficos devem responder ao filtro.

14. GRÁFICOS

Criar:

FATURAMENTO POR MÊS

Receitas ao longo do tempo.

DESPESAS POR MÊS

Despesas ao longo do tempo.

RECEITAS X DESPESAS

Comparação mensal.

FLUXO PREVISTO

Valores de recebimentos e pagamentos por vencimento.

STATUS FINANCEIRO

recebido/pago;

em aberto;

atrasado.

Não utilizar dados fictícios.

15. PREVISÃO

Criar previsão simples baseada exclusivamente nos lançamentos existentes.

Não utilizar IA.

PRÓXIMOS 7 DIAS

Recebimentos previstos x pagamentos previstos.

PRÓXIMOS 15 DIAS

PRÓXIMOS 30 DIAS

PRÓXIMOS 60 DIAS

PRÓXIMOS 90 DIAS

Calcular:

RECEBIMENTOS PREVISTOS - PAGAMENTOS PREVISTOS

Se não houver informação de saldo bancário inicial:

não inventar saldo de caixa.

Mostrar apenas:

FLUXO LÍQUIDO PROJETADO

16. GARGALOS FINANCEIROS

Criar uma seção:

PRESSÃO FINANCEIRA

Identificar períodos com grande concentração de pagamentos.

Mostrar:

data;

total a pagar;

total a receber;

quantidade de movimentos;

fluxo líquido.

Ordenar os períodos de maior pressão financeira.

17. CLIENTES

Na página ANÁLISES criar:

CLIENTES

Ranking por:

faturamento;

recebido;

em aberto;

vencido;

quantidade de documentos.

Mostrar participação percentual de cada cliente no faturamento.

18. FORNECEDORES

Criar:

FORNECEDORES

Ranking por:

despesas;

pago;

em aberto;

vencido;

quantidade de documentos.

19. INDICADORES

Calcular somente quando existirem dados suficientes:

ticket médio;

crescimento mensal;

variação mensal;

percentual recebido;

percentual em aberto;

percentual vencido;

concentração de receita;

concentração de despesas;

prazo médio de recebimento;

prazo médio de pagamento;

relação receitas/despesas.

Nunca inventar dados.

20. CONTAS A RECEBER

Criar tabela com:

documento;

cliente;

emissão;

vencimento;

pagamento;

valor;

recebido;

saldo;

status.

Permitir:

pesquisa;

ordenação;

filtro;

período;

status;

cliente.

Mostrar totalizadores.

21. CONTAS A PAGAR

Criar tabela com:

documento;

fornecedor;

emissão;

vencimento;

pagamento;

valor;

pago;

saldo;

status.

Permitir:

pesquisa;

ordenação;

filtro;

período;

status;

fornecedor.

Mostrar totalizadores.

22. LIMPAR DADOS

Em CONFIGURAÇÕES criar:

LIMPAR DADOS FINANCEIROS

Botão:

APAGAR TODOS OS DADOS

Ao clicar, solicitar confirmação.

Depois da confirmação:

apagar todos os movimentos;

apagar histórico de importações;

zerar dashboards;

manter a estrutura da aplicação.

Não apagar configurações do sistema.

23. DADOS FICTÍCIOS

REGRA ABSOLUTA:

Não criar dados fictícios.

Não criar:

clientes fictícios;

fornecedores fictícios;

notas fictícias;

valores fictícios;

gráficos fictícios;

movimentações fictícias.

A aplicação deve iniciar vazia.

Mostrar:

Nenhum dado financeiro importado.

24. DESIGN

Interface de sistema financeiro profissional.

Visual:

moderno;

limpo;

objetivo;

responsivo;

excelente leitura de números;

cards financeiros;

tabelas profissionais;

gráficos simples.

Priorizar informação sobre decoração.

Menu lateral:

Dashboard
Contas a Receber
Contas a Pagar
Análises
Importação
Configurações

25. ORDEM DE EXECUÇÃO

EXECUTE NESTA ORDEM:

ETAPA 1

Criar projeto e interface.

ETAPA 2

Criar banco de dados.

ETAPA 3

Criar modelo financial_movements.

ETAPA 4

Implementar upload e leitura dos PDFs.

ETAPA 5

Implementar deduplicação.

ETAPA 6

Implementar status.

ETAPA 7

Implementar totalização.

ETAPA 8

Implementar dashboard.

ETAPA 9

Implementar tabelas.

ETAPA 10

Implementar análises e previsões.

ETAPA 11

Implementar limpeza dos dados.

ETAPA 12

Testar fluxo completo.

Não começar por funcionalidades secundárias.

26. CRITÉRIO DE CONCLUSÃO

A aplicação deve estar funcional quando eu conseguir:

abrir a aplicação;

importar um PDF de Contas a Receber;

visualizar os registros;

visualizar os totais;

importar um PDF de Contas a Pagar;

visualizar os registros;

visualizar receitas e despesas no dashboard;

filtrar por período;

visualizar pagos, recebidos, abertos e vencidos;

visualizar clientes e fornecedores;

visualizar previsão de recebimentos e pagamentos;

importar novamente o mesmo PDF sem duplicar registros;

limpar os dados;

começar novamente com a base vazia.

REGRA FINAL PARA O LOVABLE

NÃO gastar tempo desenvolvendo funcionalidades que não foram solicitadas.

NÃO criar arquitetura excessivamente complexa.

NÃO implementar integrações externas.

NÃO implementar IA.

NÃO implementar XML.

NÃO implementar fiscal.

NÃO implementar banco.

NÃO criar dados de demonstração.

CONSTRUA A APLICAÇÃO AGORA, DIRETAMENTE, UTILIZANDO O MENOR NÚMERO POSSÍVEL DE COMPONENTES E DEPENDÊNCIAS.

A prioridade é entregar uma aplicação funcional no primeiro ciclo:

PDF BLING → DADOS FINANCEIROS → NÃO DUPLICAR → STATUS → DASHBOARD → ANÁLISES → PREVISÃO.

Em anexo o modelo dos arquivos que serão usados

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pdf-money-tracker.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9a6f050f-e2cb-4735-84a0-49c9893aba8f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploy

O projeto usa o comando `npm run build` e está preparado para deploy pela Vercel.

## Histórico de ações de cobrança

Os dados financeiros, os títulos importados dos PDFs e o histórico auxiliar `receivable_email_events` usam o projeto Supabase `FP Financeiro App` (`fxurtjedvjjtcvytrxvl`), na organização `ysitqagcbolnrbookiga`. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` para esse projeto; app e automações usam a mesma base. As antigas variáveis `VITE_RECEIVABLE_EVENTS_SUPABASE_*` não são mais necessárias.

O projeto novo foi provisionado com as migrations versionadas em `supabase/migrations/`. Os movimentos financeiros, lotes de importação e 143 eventos de cobrança existentes foram copiados sem recalcular valores e verificados por conteúdo e chaves únicas. O projeto Financeiro anterior na mesma organização foi preservado sem alterações.

O item **Ações de Cobrança**, separado de **Contas a Receber** na navegação, lista uma linha por título e permite filtrar pelo período e pelo tipo de ação (**Aviso de Vencimento**, **Email de título vencido** ou **Boleto enviado**). Exibe data do envio, cliente, destinatário, nota fiscal/parcela, valor e vencimento; para e-mails de títulos vencidos, também exibe os dias reais em atraso, não a faixa usada pela regra de envio. Envios de boleto registram também os nomes dos PDFs enviados. Na lista de Contas a Receber, o documento mostra um aviso ao passar o cursor quando houver confirmação inequívoca de envio de boleto para aquele título. As automações gravam primeiro a linha na planilha central, inclusive o destinatário, e depois atualizam `receivable_email_events`. A tabela de eventos é auxiliar: não cria nem atualiza títulos financeiros, cujos valores continuam sendo importados exclusivamente dos PDFs.

A migration `20261009120000_receivable_manual_payments_and_email_requests.sql` adiciona o valor recebido editável sem alterar os valores importados e a fila `receivable_email_requests`. Em **Contas a Receber**, o filtro **Vencido** exibe a última cobrança e permite solicitar uma cobrança individual; **Em aberto** exibe o último aviso e permite solicitar um aviso individual. A solicitação é processada pelo daemon local da FP Cobrança, que confirma o destinatário antes de usar o Outlook. O daemon precisa estar ativo no computador; com `MODO_RASCUNHO=1`, ele apenas abre um rascunho e não registra um envio.

Os rótulos de período seguem as datas efetivamente calculadas (trimestre/semestre/ano atuais, intervalos históricos e vencimentos futuros). Todas as telas financeiras ignoram títulos cancelados nos totais, projeções e vencidos, mas mantêm as linhas disponíveis no filtro **Cancelada**.
