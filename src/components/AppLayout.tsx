import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Upload,
  Settings,
  Menu,
  CalendarDays,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import logo from "@/assets/FP Logo - Fundo Branco.png";
import { NyansapoMark } from "@/components/NyansapoMark";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/contas-a-receber", label: "Contas a Receber", icon: ArrowDownCircle },
  { to: "/contas-a-pagar", label: "Contas a Pagar", icon: ArrowUpCircle },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/analises", label: "Análises", icon: BarChart3 },
  { to: "/importacao", label: "Importação", icon: Upload },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppLayout({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={() => setOpen(false)}
          activeOptions={{ exact: to === "/" }}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground data-[status=active]:font-medium"
        >
          <Icon className="size-4 shrink-0" />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        {nav}
        <Footer />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar">
            <Brand />
            {nav}
            <Footer />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-card/90 px-4 py-3 backdrop-blur sm:px-6">
          <button
            className="rounded-md border border-border p-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions}
        </header>
        <main className={cn("px-4 py-6 sm:px-6")}>
          {children}
          <SignatureBlock />
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
      <LogoMark />
      <div className="min-w-0">
        <div className="text-base font-semibold tracking-tight text-sidebar-accent-foreground">
          FP Financeiro
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-tight text-sidebar-foreground/60">
          FP SOLUÇÃO EM ALTURA LTDA
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <div
      className="flex size-11 shrink-0 items-center justify-center rounded-md bg-card p-1"
      role="img"
      aria-label="FP Solução em Altura"
    >
      <img
        src={logo}
        alt=""
        className="size-full object-contain"
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.nextElementSibling?.removeAttribute("hidden");
        }}
      />
      <svg
        hidden
        viewBox="0 0 40 40"
        aria-hidden="true"
        className="size-full"
      >
        <rect width="40" height="40" rx="7" fill="#719d6d" />
        <path d="M11 9h18v6H17v5h9v6h-9v5h-6V9Z" fill="#f6efdf" />
        <path d="M17 20h8v6h-8v-6Z" fill="#719d6d" />
      </svg>
    </div>
  );
}

function Footer() {
  return (
    <div className="mt-auto border-t border-sidebar-border px-5 py-4 text-[11px] text-sidebar-foreground/50">
      <div className="flex flex-col items-center gap-2">
        <p className="text-center leading-snug text-sidebar-foreground/60">
          Desenvolvido por Luiz Felipe Ferreira em 09/2026
        </p>
        <NyansapoMark className="text-sidebar-foreground/80" />
      </div>
    </div>
  );
}

function SignatureBlock() {
  return (
    <footer className="mt-12 flex flex-col items-center gap-2 border-t border-border py-6 text-center">
      <p className="max-w-xs text-xs leading-snug text-muted-foreground">
        Desenvolvido por Luiz Felipe Ferreira em 09/2026
      </p>
      <NyansapoMark className="text-foreground" />
    </footer>
  );
}
