import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { COMPANIES, COMPANY_STORAGE_KEY, DEFAULT_COMPANY_ID, isCompanyId } from "@/lib/companies";
import type { Company } from "@/lib/companies";

interface CompanyContextValue {
  company: Company;
  companies: Company[];
  ready: boolean;
  setCompanyId: (companyId: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companyId, setCompanyIdState] = useState(DEFAULT_COMPANY_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(COMPANY_STORAGE_KEY);
    if (isCompanyId(stored)) setCompanyIdState(stored);
    else window.localStorage.removeItem(COMPANY_STORAGE_KEY);
    setReady(true);
  }, []);

  const setCompanyId = useCallback((nextCompanyId: string) => {
    if (!isCompanyId(nextCompanyId)) throw new Error("Empresa inválida.");
    setCompanyIdState(nextCompanyId);
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
  }, [companyId, ready]);

  const company = COMPANIES.find((item) => item.id === companyId) ?? COMPANIES[0]!;
  const value = useMemo(
    () => ({ company, companies: COMPANIES, ready, setCompanyId }),
    [company, ready, setCompanyId],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const context = useContext(CompanyContext);
  if (!context) throw new Error("useCompany precisa do CompanyProvider");
  return context;
}
