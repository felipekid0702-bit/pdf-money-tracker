import { formatBRL, formatPercent } from "@/lib/finance";
import type { AgingBucket, Alert, PartyRow, ProjectionRow, SeriesPoint } from "@/lib/analytics";
import type { PeriodRange } from "@/lib/period";
import type { PeriodKpis, OpenPosition } from "@/lib/analytics";

export interface PresentationData {
  companyName: string;
  legalName: string;
  cnpj: string;
  logoUrl: string;
  periodLabel: string;
  range: PeriodRange;
  generatedAt: string;
  kpis: PeriodKpis;
  position: OpenPosition;
  projections: ProjectionRow[];
  monthlyTrend: SeriesPoint[];
  topClients: PartyRow[];
  topSuppliers: PartyRow[];
  overdueReceivables: AgingBucket[];
  overduePayables: AgingBucket[];
  alerts: Alert[];
}

type PresentationKind = "email" | "board";

const COLORS = {
  ink: "#172b4d",
  muted: "#5b6b82",
  blue: "#2878c8",
  green: "#168a65",
  red: "#cf4b4b",
  amber: "#d79525",
  pale: "#edf3f8",
  grid: "#d7e0e8",
};

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateLabel(value: string | null): string {
  if (!value) return "Sem limite";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function periodText(data: PresentationData): string {
  const { from, to } = data.range;
  return from || to
    ? `${data.periodLabel} · ${dateLabel(from)} a ${dateLabel(to)}`
    : data.periodLabel;
}

function moneyAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)} mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return `R$ ${value.toFixed(0)}`;
}

function metric(label: string, value: string, hint: string, tone = "blue"): string {
  return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${esc(value)}</div><div class="metric-hint">${esc(hint)}</div></div>`;
}

function sectionTitle(title: string, subtitle: string): string {
  return `<div class="section-title"><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>`;
}

function companyBrand(data: PresentationData, descriptor: string): string {
  return `<div class="brand"><img class="brand-logo" src="${esc(data.logoUrl)}" alt=""><div><div class="eyebrow">${esc(data.companyName)} · ${esc(descriptor)}</div><div class="brand-name">${esc(data.legalName)}</div></div></div>`;
}

function formatCurrency(value: number): string {
  return formatBRL(value);
}

function horizontalBars(
  rows: Array<{ label: string; value: number }>,
  color = COLORS.blue,
): string {
  if (!rows.length || rows.every((row) => row.value <= 0)) {
    return `<p class="empty">Sem valores para exibir nesta seção.</p>`;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  return `<div class="bars">${rows
    .map(
      (row) => `<div class="bar-row">
        <div class="bar-label">${esc(row.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, (row.value / max) * 100)}%;background:${color}"></div></div>
        <div class="bar-value">${esc(formatCurrency(row.value))}</div>
      </div>`,
    )
    .join("")}</div>`;
}

function trendChart(points: SeriesPoint[]): string {
  if (!points.length)
    return `<p class="empty">Não há série temporal suficiente para o gráfico.</p>`;
  const visible = points.slice(-6);
  const width = 760;
  const height = 290;
  const pad = { left: 62, right: 18, top: 16, bottom: 42 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(
    ...visible.flatMap((point) => [point.recebido, point.pago, point.aReceber, point.aPagar]),
    1,
  );
  const groupWidth = plotWidth / visible.length;
  const barWidth = Math.min(20, groupWidth * 0.22);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const grid = Array.from({ length: 4 }, (_, index) => {
    const value = (max * index) / 3;
    const yy = y(value);
    return `<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="${COLORS.grid}"/><text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end" class="axis-label">${esc(moneyAxis(value))}</text>`;
  }).join("");
  const bars = visible
    .map((point, index) => {
      const center = pad.left + groupWidth * (index + 0.5);
      const series = [
        { value: point.recebido, color: COLORS.green, offset: -barWidth * 2 - 6 },
        { value: point.aReceber, color: "#8bc8ac", offset: -barWidth - 2 },
        { value: point.pago, color: COLORS.red, offset: 2 },
        { value: point.aPagar, color: "#e8a3a0", offset: barWidth + 6 },
      ];
      const rects = series
        .map((item) => {
          if (item.value <= 0) return "";
          const x = center + item.offset;
          const top = y(item.value);
          return `<rect x="${x}" y="${top}" width="${barWidth}" height="${Math.max(1, pad.top + plotHeight - top)}" fill="${item.color}" rx="2"><title>${esc(formatCurrency(item.value))}</title></rect>`;
        })
        .join("");
      return `${rects}<text x="${center}" y="${height - 26}" text-anchor="middle" class="axis-label">${esc(point.label)}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Receitas e despesas por vencimento, realizadas e em aberto">
    ${grid}${bars}
    <g class="legend">
      <rect x="${pad.left}" y="${height - 15}" width="9" height="9" fill="${COLORS.green}"/><text x="${pad.left + 13}" y="${height - 6}">Recebido</text>
      <rect x="${pad.left + 100}" y="${height - 15}" width="9" height="9" fill="#8bc8ac"/><text x="${pad.left + 113}" y="${height - 6}">A receber</text>
      <rect x="${pad.left + 205}" y="${height - 15}" width="9" height="9" fill="${COLORS.red}"/><text x="${pad.left + 218}" y="${height - 6}">Pago</text>
      <rect x="${pad.left + 286}" y="${height - 15}" width="9" height="9" fill="#e8a3a0"/><text x="${pad.left + 299}" y="${height - 6}">A pagar</text>
    </g>
  </svg>`;
}

function agingChart(receivables: AgingBucket[], payables: AgingBucket[]): string {
  const rows = receivables.map((bucket, index) => ({
    label: bucket.label,
    receive: bucket.amount,
    pay: payables[index]?.amount ?? 0,
  }));
  const max = Math.max(...rows.flatMap((row) => [row.receive, row.pay]), 1);
  return `<div class="aging">${rows
    .map(
      (row) => `<div class="aging-row">
        <div class="aging-label">${esc(row.label)}</div>
        <div class="aging-track"><div class="aging-fill" style="width:${Math.max(row.receive ? 1 : 0, (row.receive / max) * 100)}%;background:${COLORS.blue}"></div></div>
        <div class="aging-value">${esc(formatCurrency(row.receive))}</div>
        <div class="aging-track"><div class="aging-fill" style="width:${Math.max(row.pay ? 1 : 0, (row.pay / max) * 100)}%;background:${COLORS.amber}"></div></div>
        <div class="aging-value">${esc(formatCurrency(row.pay))}</div>
      </div>`,
    )
    .join("")}
    <div class="aging-legend"><span><i style="background:${COLORS.blue}"></i>Receber vencido</span><span><i style="background:${COLORS.amber}"></i>Pagar vencido</span></div>
  </div>`;
}

function partyTable(rows: PartyRow[], side: "cliente" | "fornecedor"): string {
  const visible = rows.slice(0, 5);
  if (!visible.length) return `<p class="empty">Sem ${side}s identificados no período.</p>`;
  return `<table><thead><tr><th>${side === "cliente" ? "Cliente" : "Fornecedor"}</th><th>Total</th><th>Em aberto</th><th>Vencido</th><th>Concentração</th></tr></thead><tbody>${visible
    .map(
      (row) =>
        `<tr><td>${esc(row.name)}</td><td>${esc(formatCurrency(row.total))}</td><td>${esc(formatCurrency(row.open))}</td><td>${esc(formatCurrency(row.overdue))}</td><td>${esc(formatPercent(row.share))}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function projectionTable(rows: ProjectionRow[]): string {
  return `<table><thead><tr><th>Janela</th><th>Recebimentos previstos</th><th>Pagamentos previstos</th><th>Saldo líquido previsto</th><th>Títulos</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${esc(row.label)}</td><td>${esc(formatCurrency(row.inflow))}</td><td>${esc(formatCurrency(row.outflow))}</td><td class="${row.net >= 0 ? "green" : "red"}">${esc(formatCurrency(row.net))}</td><td>${row.count}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function slide(
  number: number,
  title: string,
  takeaway: string,
  content: string,
  data: PresentationData,
): string {
  return `<section class="page slide">
    <div class="slide-head">${companyBrand(data, "BOARD DECK")}<div class="slide-number">${number.toString().padStart(2, "0")} / 07</div></div>
    <h1>${esc(title)}</h1><p class="takeaway">${esc(takeaway)}</p>
    <div class="slide-content">${content}</div>
    <footer><span>${esc(data.legalName)} · CNPJ ${esc(data.cnpj)}</span><span>${esc(periodText(data))}</span></footer>
  </section>`;
}

function emailDocument(data: PresentationData): string {
  const { receita, despesa } = data.kpis;
  const titleResult = receita.original - despesa.original;
  const alerts = data.alerts.slice(0, 2);
  const highlights = alerts.length
    ? alerts
        .map((alert) => `<li><strong>${esc(alert.title)}:</strong> ${esc(alert.detail)}</li>`)
        .join("")
    : "<li>Não há alertas automáticos relevantes para a posição atual.</li>";
  return `<section class="page email-page">
    ${companyBrand(data, "RESUMO FINANCEIRO")}
    <h1>Resumo executivo</h1>
    <p class="subtitle">${esc(periodText(data))} · Gerado em ${esc(data.generatedAt)}</p>
    <div class="metrics four">
      ${metric("Receitas em títulos", formatCurrency(receita.original), `${receita.count} títulos no período`)}
      ${metric("Despesas em títulos", formatCurrency(despesa.original), `${despesa.count} títulos no período`, "red")}
      ${metric("Resultado por títulos", formatCurrency(titleResult), "Receitas menos despesas; não é EBITDA", titleResult >= 0 ? "green" : "red")}
      ${metric("Saldo líquido em aberto", formatCurrency(data.position.net), "Receber menos pagar; sem saldo bancário", data.position.net >= 0 ? "green" : "red")}
    </div>
    ${sectionTitle("Movimentação por vencimento", "Últimos seis períodos disponíveis; inclui valores realizados e títulos ainda em aberto")}
    ${trendChart(data.monthlyTrend)}
    <div class="highlight"><strong>Pontos para acompanhamento</strong><ul>${highlights}</ul></div>
    <div class="caveat"><strong>Orçamento e indicadores contábeis:</strong> comparação orçamentária, margem bruta, EBITDA, saldo bancário e runway não são calculados porque essas informações não estão na base atual. O saldo líquido em aberto é uma projeção de títulos, não caixa disponível.</div>
    <footer><span>${esc(data.legalName)} · CNPJ ${esc(data.cnpj)}</span><span>Fonte: títulos importados do Bling · ${esc(data.generatedAt)}</span></footer>
  </section>`;
}

function boardDocument(data: PresentationData): string {
  const { receita, despesa } = data.kpis;
  const titleResult = receita.original - despesa.original;
  const ratio = despesa.original > 0 ? receita.original / despesa.original : null;
  const receivableTotal = data.position.receivableTotal;
  const overdueShare = receivableTotal > 0 ? data.position.receivableOverdue / receivableTotal : 0;
  const firstAlert = data.alerts[0];
  const summaryBullets = [
    `Receitas em títulos: ${formatCurrency(receita.original)}; despesas em títulos: ${formatCurrency(despesa.original)}.`,
    `Resultado simples por títulos: ${formatCurrency(titleResult)}; não representa margem contábil nem EBITDA.`,
    `Saldo líquido de títulos em aberto: ${formatCurrency(data.position.net)}; não representa saldo bancário.`,
    firstAlert
      ? `Atenção prioritária: ${firstAlert.title.toLocaleLowerCase("pt-BR")}.`
      : "Sem alertas automáticos prioritários na posição atual.",
  ];
  const executive = `<div class="metrics four">
      ${metric("Receitas em títulos", formatCurrency(receita.original), `${receita.count} títulos`)}
      ${metric("Despesas em títulos", formatCurrency(despesa.original), `${despesa.count} títulos`, "red")}
      ${metric("Resultado simples", formatCurrency(titleResult), "Receitas − despesas; não é EBITDA", titleResult >= 0 ? "green" : "red")}
      ${metric("Títulos em aberto · líquido", formatCurrency(data.position.net), "Sem caixa/bancos", data.position.net >= 0 ? "green" : "red")}
    </div><ul class="takeaway-list">${summaryBullets.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    <div class="caveat"><strong>Orçamento vs. realizado:</strong> indisponível — não há orçamento cadastrado na base. Nenhuma variação foi estimada.</div>`;
  const pnl = `<div class="metrics two">
      ${metric("Recebido no período", formatCurrency(receita.settled), `${receita.settledCount} títulos realizados`, "green")}
      ${metric("Pago no período", formatCurrency(despesa.settled), `${despesa.settledCount} títulos realizados`, "red")}
      ${metric("Em aberto a receber", formatCurrency(receita.open), `${receita.openCount} títulos`)}
      ${metric("Em aberto a pagar", formatCurrency(despesa.open), `${despesa.openCount} títulos`, "amber")}
    </div><div class="two-col"><div><h3>Receitas e despesas por vencimento</h3>${horizontalBars([
      { label: "Receitas", value: receita.original },
      { label: "Despesas", value: despesa.original },
    ])}</div><div class="note"><strong>Leitura:</strong> relação receitas/despesas ${ratio === null ? "indisponível" : `${ratio.toFixed(2).replace(".", ",")}x`}. Valores representam títulos classificados por vencimento no período; não são uma demonstração de resultados contábil.</div></div>`;
  const revenue = `<div class="two-col"><div><h3>Tendência dos títulos</h3>${trendChart(data.monthlyTrend)}</div><div><h3>Principais clientes no período</h3>${partyTable(data.topClients, "cliente")}</div></div>`;
  const expenses = `<div class="two-col"><div><h3>Principais fornecedores no período</h3>${partyTable(data.topSuppliers, "fornecedor")}</div><div><h3>Indicadores de carteira</h3><div class="metrics two compact">
      ${metric("Títulos a receber", String(receita.count), "No período selecionado")}
      ${metric("Títulos a pagar", String(despesa.count), "No período selecionado")}
      ${metric("Concentração do maior cliente", formatPercent(data.topClients[0]?.share ?? 0), data.topClients[0]?.name ?? "Sem dados")}
      ${metric("Concentração do maior fornecedor", formatPercent(data.topSuppliers[0]?.share ?? 0), data.topSuppliers[0]?.name ?? "Sem dados")}
    </div></div></div>`;
  const liquidity = `<div class="metrics three">
      ${metric("A receber em aberto", formatCurrency(data.position.receivableTotal), `Vencido: ${formatCurrency(data.position.receivableOverdue)}`)}
      ${metric("A pagar em aberto", formatCurrency(data.position.payableTotal), `Vencido: ${formatCurrency(data.position.payableOverdue)}`, "amber")}
      ${metric("Saldo líquido de títulos", formatCurrency(data.position.net), "A receber − a pagar; sem caixa bancário", data.position.net >= 0 ? "green" : "red")}
    </div><h3>Projeção determinística de títulos em aberto</h3>${projectionTable(data.projections)}
    <div class="caveat">Esta projeção considera somente títulos registrados com saldo em aberto. Não há saldo inicial de caixa; por isso, liquidez bancária e runway não podem ser calculados.</div>`;
  const risks = `<div class="two-col"><div><h3>Vencidos por faixa de atraso</h3>${agingChart(data.overdueReceivables, data.overduePayables)}</div><div><h3>Alertas objetivos</h3>${
    data.alerts.length
      ? `<ul class="alert-list">${data.alerts
          .slice(0, 5)
          .map(
            (alert) =>
              `<li class="${alert.level}"><strong>${esc(alert.title)}</strong><span>${esc(alert.detail)}</span></li>`,
          )
          .join("")}</ul>`
      : `<p class="empty">Nenhum alerta automático identificado.</p>`
  }<p class="small-note">A inadimplência sobre a carteira a receber é ${esc(formatPercent(overdueShare))}.</p></div></div>`;
  const actions = `<div class="action-grid">
      <div><span class="action-number">01</span><h3>Validar orçamento</h3><p>Registrar orçamento por período para habilitar variações Real vs. Budget.</p></div>
      <div><span class="action-number">02</span><h3>Completar visão de caixa</h3><p>Integrar saldo bancário inicial e movimentos de caixa antes de estimar liquidez ou runway.</p></div>
      <div><span class="action-number">03</span><h3>Detalhar resultado</h3><p>Classificar custos, CMV e despesas operacionais para apurar margem bruta e EBITDA.</p></div>
    </div><div class="caveat"><strong>Escopo dos dados:</strong> relatórios financeiros do Bling importados para a empresa e o período selecionados. KPIs operacionais como ARR, churn, CAC, LTV, headcount e pipeline não estão disponíveis nesta base.</div>`;

  return [
    slide(
      1,
      "A posição financeira exige leitura por títulos, não por caixa",
      "Resumo executivo · números limitados ao que foi importado do Bling.",
      executive,
      data,
    ),
    slide(
      2,
      "Receitas e despesas mostram o fluxo de títulos do período",
      "Valores por vencimento; recebimentos e pagamentos realizados aparecem separados do saldo em aberto.",
      pnl,
      data,
    ),
    slide(
      3,
      "A carteira de receitas concentra-se nos principais clientes",
      "Tendência mensal e exposição por contraparte no período selecionado.",
      revenue,
      data,
    ),
    slide(
      4,
      "A carteira de despesas evidencia os principais fornecedores",
      "Concentração e quantidade de títulos ajudam a orientar a revisão da carteira.",
      expenses,
      data,
    ),
    slide(
      5,
      "O saldo líquido não substitui a posição bancária",
      "Projeção determinística de recebíveis e pagamentos em aberto para os próximos 30, 60 e 90 dias.",
      liquidity,
      data,
    ),
    slide(
      6,
      "Vencidos e alertas indicam onde acompanhar primeiro",
      "Aging calculado sobre a posição atual; sinalizações seguem regras objetivas do aplicativo.",
      risks,
      data,
    ),
    slide(
      7,
      "Orçamento e dados de caixa são os próximos passos para uma visão CFO",
      "Limitações atuais e ações para tornar futuras apresentações comparáveis e completas.",
      actions,
      data,
    ),
  ].join("");
}

function styles(kind: PresentationKind): string {
  const isBoard = kind === "board";
  return `
    @page { size: A4 ${isBoard ? "landscape" : "portrait"}; margin: ${isBoard ? "12mm" : "13mm"}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #e7edf3; color: ${COLORS.ink}; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toolbar { position: sticky; top: 0; z-index: 1; display: flex; justify-content: center; gap: 12px; padding: 12px; background: #172b4d; color: white; font-size: 13px; }
    .toolbar button { border: 0; border-radius: 6px; padding: 9px 14px; cursor: pointer; font-weight: 700; }
    .toolbar .print { background: #7ed5ae; color: #12392d; }
    .page { width: ${isBoard ? "273mm" : "184mm"}; min-height: ${isBoard ? "190mm" : "271mm"}; margin: 18px auto; padding: ${isBoard ? "9mm" : "8mm"}; background: white; box-shadow: 0 2px 14px #22344a24; overflow: hidden; position: relative; }
    .slide { page-break-after: always; break-after: page; display: flex; flex-direction: column; }
    .slide:last-of-type { page-break-after: auto; break-after: auto; }
    h1 { margin: 4px 0 7px; color: ${COLORS.ink}; font-size: ${isBoard ? "28px" : "26px"}; line-height: 1.15; letter-spacing: -.4px; }
    h2 { margin: 0; font-size: 17px; }
    h3 { margin: 0 0 10px; font-size: 13px; }
    p { margin: 0; }
    .brand { display: flex; align-items: center; gap: 9px; }
    .brand-logo { width: 42px; height: 38px; object-fit: contain; }
    .brand-name { margin-top: 3px; color: ${COLORS.muted}; font-size: 8px; }
    .eyebrow { color: ${COLORS.blue}; font-size: 9px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; }
    .subtitle { margin: 0 0 17px; color: ${COLORS.muted}; font-size: 11px; }
    .section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 15px 0 5px; }
    .section-title p { color: ${COLORS.muted}; font-size: 9px; text-align: right; }
    .metrics { display: grid; gap: 9px; margin: 12px 0; }
    .metrics.four { grid-template-columns: repeat(4, 1fr); }
    .metrics.three { grid-template-columns: repeat(3, 1fr); }
    .metrics.two { grid-template-columns: repeat(2, 1fr); }
    .metric { min-width: 0; padding: 10px 11px; background: ${COLORS.pale}; border-left: 3px solid ${COLORS.blue}; border-radius: 4px; }
    .metric-label { color: ${COLORS.muted}; font-size: 8px; line-height: 1.3; text-transform: uppercase; letter-spacing: .45px; }
    .metric-value { margin: 6px 0 2px; color: ${COLORS.blue}; font-size: ${isBoard ? "19px" : "17px"}; font-weight: 700; overflow-wrap: anywhere; }
    .metric-hint { color: ${COLORS.muted}; font-size: 8px; line-height: 1.3; }
    .blue { color: ${COLORS.blue} !important; } .green { color: ${COLORS.green} !important; } .red { color: ${COLORS.red} !important; } .amber { color: ${COLORS.amber} !important; }
    .chart { display: block; width: 100%; max-height: 200px; overflow: visible; }
    .axis-label { fill: ${COLORS.muted}; font: 9px Arial, sans-serif; }
    .legend { fill: ${COLORS.muted}; font: 9px Arial, sans-serif; }
    .highlight, .caveat, .note { margin-top: 10px; padding: 10px 12px; background: #f5f8fb; border-radius: 4px; font-size: 10px; line-height: 1.45; }
    .caveat { border-left: 3px solid ${COLORS.amber}; }
    .highlight ul { margin: 5px 0 0; padding-left: 17px; }
    .highlight li { margin: 2px 0; }
    footer { display: flex; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 8px; color: ${COLORS.muted}; font-size: 8px; border-top: 1px solid ${COLORS.grid}; }
    .slide-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .slide-number { color: ${COLORS.muted}; font-size: 9px; font-weight: 700; letter-spacing: 1px; }
    .takeaway { margin: 0 0 11px; color: ${COLORS.muted}; font-size: 12px; }
    .slide-content { flex: 1; min-height: 0; }
    .takeaway-list { margin: 12px 0; padding-left: 21px; font-size: 12px; line-height: 1.65; }
    .takeaway-list li { margin-bottom: 4px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; margin-top: 9px; }
    .two-col > div { min-width: 0; }
    .bars { display: grid; gap: 10px; }
    .bar-row { display: grid; grid-template-columns: 115px minmax(40px, 1fr) 92px; gap: 9px; align-items: center; }
    .bar-label, .bar-value, .aging-label, .aging-value { font-size: 9px; }
    .bar-value, .aging-value { text-align: right; white-space: nowrap; }
    .bar-track, .aging-track { height: 11px; background: ${COLORS.pale}; border-radius: 10px; overflow: hidden; }
    .bar-fill, .aging-fill { height: 100%; border-radius: inherit; }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th { padding: 7px 5px; background: ${COLORS.pale}; color: ${COLORS.muted}; text-align: left; font-size: 8px; text-transform: uppercase; }
    td { padding: 7px 5px; border-bottom: 1px solid ${COLORS.grid}; }
    td:not(:first-child), th:not(:first-child) { text-align: right; }
    .aging { display: grid; gap: 9px; }
    .aging-row { display: grid; grid-template-columns: 74px 1fr 75px 1fr 75px; gap: 6px; align-items: center; }
    .aging-legend { display: flex; gap: 15px; margin-top: 7px; color: ${COLORS.muted}; font-size: 9px; }
    .aging-legend i { display: inline-block; width: 9px; height: 9px; margin-right: 5px; }
    .alert-list { display: grid; gap: 8px; padding: 0; list-style: none; }
    .alert-list li { display: grid; gap: 4px; padding: 9px; border-left: 3px solid ${COLORS.amber}; background: #f7f8fa; font-size: 9px; line-height: 1.4; }
    .alert-list li.critico { border-color: ${COLORS.red}; }
    .alert-list li.info { border-color: ${COLORS.blue}; }
    .small-note, .empty { color: ${COLORS.muted}; font-size: 9px; line-height: 1.5; }
    .action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 24px 0; }
    .action-grid > div { padding: 14px; border: 1px solid ${COLORS.grid}; border-radius: 5px; }
    .action-number { color: ${COLORS.blue}; font-size: 10px; font-weight: 700; letter-spacing: 1px; }
    .action-grid h3 { margin: 10px 0 7px; font-size: 14px; }
    .action-grid p { color: ${COLORS.muted}; font-size: 10px; line-height: 1.5; }
    .compact .metric-value { font-size: 14px; }
    @media print {
      body { background: white; }
      .toolbar { display: none; }
      .page { width: auto; min-height: 0; height: ${isBoard ? "185mm" : "268mm"}; margin: 0; padding: 0; box-shadow: none; }
      .slide { page-break-after: always; break-after: page; }
      .slide:last-of-type { page-break-after: auto; break-after: auto; }
    }
    @media screen {
      .email-page { min-height: 271mm; }
    }
  `;
}

export function renderPresentation(data: PresentationData, kind: PresentationKind): string {
  const board = kind === "board";
  const title = board ? "Board Deck" : "Resumo executivo";
  const body = board ? boardDocument(data) : emailDocument(data);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · ${esc(data.companyName)}</title><style>${styles(kind)}</style></head><body>
    <div class="toolbar"><span>Apresentação pronta · ${board ? "7 páginas" : "1 página"} · No diálogo, escolha “Salvar como PDF” para guardar ou anexar ao e-mail.</span><button class="print" onclick="window.print()">Imprimir / Salvar em PDF</button><button onclick="window.close()">Fechar</button></div>
    ${body}
    <script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},350)})</script>
  </body></html>`;
}
