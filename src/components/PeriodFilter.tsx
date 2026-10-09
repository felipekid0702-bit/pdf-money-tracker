import {
  FORECAST_OPTIONS,
  HISTORY_OPTIONS,
  isForecastPeriod,
  usePeriod,
  type PeriodId,
} from "@/lib/period";
import { formatDate } from "@/lib/finance";

export function PeriodFilter() {
  const {
    period,
    setPeriod,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    range,
  } = usePeriod();

  const isCustom = period === "custom" || period === "custom_forecast";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value as PeriodId)}
        className="rounded-md border border-input bg-card px-3 py-2 text-sm"
        aria-label="Período"
      >
        <optgroup label="Histórico e atual">
          {HISTORY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Vencimentos futuros">
          {FORECAST_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </select>

      {isCustom && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-input bg-card px-2 py-1.5 text-xs"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-input bg-card px-2 py-1.5 text-xs"
          />
        </div>
      )}

      <span className="text-xs text-muted-foreground">
        {range.from || range.to
          ? `${formatDate(range.from) || "…"} – ${formatDate(range.to) || "…"}`
          : "Todo o período"}
        {isForecastPeriod(period) && " · projeção"}
      </span>
      <span className="text-xs text-muted-foreground">
        O período considera a data de vencimento.
      </span>
    </div>
  );
}
