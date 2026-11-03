export const FP_COMPANY_ID = "f0000000-0000-4000-8000-000000000001";
export const APOIO_VERTICAL_COMPANY_ID = "a0000000-0000-4000-8000-000000000001";
export const DEFAULT_COMPANY_ID = FP_COMPANY_ID;
export const COMPANY_STORAGE_KEY = "fp-finance-company-id";

export interface Company {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  cnpj: string;
  logo: "fp" | "apoio-vertical";
  registration: {
    openingDate: string | null;
    tradeName: string | null;
    size: string | null;
    legalNature: string | null;
    primaryActivity: string | null;
    secondaryActivities: string[];
    address: {
      street: string | null;
      number: string | null;
      complement: string | null;
      district: string | null;
      postalCode: string | null;
      city: string | null;
      state: string | null;
    };
    email: string | null;
    phone: string | null;
    status: string | null;
    statusDate: string | null;
    issuedAt: string | null;
  };
}

export const COMPANIES: Company[] = [
  {
    id: FP_COMPANY_ID,
    slug: "fp-solucao-em-altura",
    name: "FP Solução em Altura",
    legalName: "FP SOLUÇÃO EM ALTURA LTDA.",
    cnpj: "58.348.102/0001-82",
    logo: "fp",
    registration: {
      openingDate: null,
      tradeName: null,
      size: null,
      legalNature: null,
      primaryActivity: null,
      secondaryActivities: [],
      address: {
        street: null,
        number: null,
        complement: null,
        district: null,
        postalCode: null,
        city: null,
        state: null,
      },
      email: null,
      phone: null,
      status: null,
      statusDate: null,
      issuedAt: null,
    },
  },
  {
    id: APOIO_VERTICAL_COMPANY_ID,
    slug: "apoio-vertical",
    name: "Apoio Vertical",
    legalName: "APOIO VERTICAL EPI LTDA",
    cnpj: "64.574.363/0001-13",
    logo: "apoio-vertical",
    registration: {
      openingDate: "17/01/2026",
      tradeName: null,
      size: "ME",
      legalNature: "206-2 - Sociedade Empresária Limitada",
      primaryActivity:
        "46.42-7-02 - Comércio atacadista de roupas e acessórios para uso profissional e de segurança do trabalho",
      secondaryActivities: [
        "15.21-1-00 - Fabricação de artigos para viagem, bolsas e semelhantes de qualquer material",
        "32.92-2-02 - Fabricação de equipamentos e acessórios para segurança pessoal e profissional",
        "32.99-0-99 - Fabricação de produtos diversos não especificados anteriormente",
        "33.11-2-00 - Manutenção e reparação de tanques, reservatórios metálicos e caldeiras, exceto para veículos",
        "33.12-1-02 - Manutenção e reparação de aparelhos e instrumentos de medida, teste e controle",
        "33.14-7-02 - Manutenção e reparação de equipamentos hidráulicos e pneumáticos, exceto válvulas",
        "33.14-7-03 - Manutenção e reparação de válvulas industriais",
        "33.14-7-99 - Manutenção e reparação de outras máquinas e equipamentos para usos industriais não especificados anteriormente",
        "33.17-1-01 - Manutenção e reparação de embarcações e estruturas flutuantes",
        "33.19-8-00 - Manutenção e reparação de equipamentos e produtos não especificados anteriormente",
        "33.21-0-00 - Instalação de máquinas e equipamentos industriais",
        "41.20-4-00 - Construção de edifícios",
        "42.92-8-01 - Montagem de estruturas metálicas",
        "42.92-8-02 - Obras de montagem industrial",
        "43.21-5-00 - Instalação e manutenção elétrica",
        "43.29-1-01 - Instalação de painéis publicitários",
        "43.30-4-01 - Impermeabilização em obras de engenharia civil",
        "43.30-4-04 - Serviços de pintura de edifícios em geral",
        "43.30-4-99 - Outras obras de acabamento da construção",
        "43.99-1-02 - Montagem e desmontagem de andaimes e outras estruturas temporárias",
        "43.99-1-03 - Obras de alvenaria",
        "46.43-5-01 - Comércio atacadista de calçados",
        "46.49-4-99 - Comércio atacadista de outros equipamentos e artigos de uso pessoal e doméstico não especificados anteriormente",
        "47.13-0-02 - Lojas de variedades, exceto lojas de departamentos ou magazines",
        "47.42-3-00 - Comércio varejista de material elétrico",
        "47.44-0-01 - Comércio varejista de ferragens e ferramentas",
        "47.44-0-99 - Comércio varejista de materiais de construção em geral",
        "47.59-8-99 - Comércio varejista de outros artigos de uso pessoal e doméstico não especificados anteriormente",
        "47.63-6-02 - Comércio varejista de artigos esportivos",
        "47.63-6-04 - Comércio varejista de artigos de caça, pesca e camping",
        "47.81-4-00 - Comércio varejista de artigos do vestuário e acessórios",
        "47.82-2-01 - Comércio varejista de calçados",
        "47.89-0-99 - Comércio varejista de outros produtos não especificados anteriormente",
        "77.39-0-99 - Aluguel de outras máquinas e equipamentos comerciais e industriais não especificados anteriormente, sem operador",
        "85.99-6-04 - Treinamento em desenvolvimento profissional e gerencial",
        "93.19-1-99 - Outras atividades esportivas não especificadas anteriormente",
      ],
      address: {
        street: "AV MINAS GERAIS",
        number: "21",
        complement: null,
        district: "JARDIM ATLÂNTICO",
        postalCode: "29.175-271",
        city: "SERRA",
        state: "ES",
      },
      email: "UBIANOR@CONTALEGAL.COM.BR",
      phone: "(22) 2772-2223 / (0000) 0000-0000",
      status: "ATIVA",
      statusDate: "17/01/2026",
      issuedAt: "19/01/2026 às 14:42:11",
    },
  },
];

export function isCompanyId(value: unknown): value is string {
  return typeof value === "string" && COMPANIES.some((company) => company.id === value);
}

export function getCompany(companyId: string): Company {
  const company = COMPANIES.find((item) => item.id === companyId);
  if (!company) throw new Error("Empresa inválida.");
  return company;
}
