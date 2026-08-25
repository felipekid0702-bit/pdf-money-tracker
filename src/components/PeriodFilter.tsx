import { PERIOD_OPTIONS, usePeriod } from "@/lib/period";
import { cn } from "@/lib/utils";

export function PeriodFilter() {
  const { period, setPeriod, customFrom, customTo, setCustomFrom, setCustomTo } =
    usePeriod();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => setPeriod(o.id)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              period === o.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-input bg-card px-2 py-1 text-xs"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-input bg-card px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}
