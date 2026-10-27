/**
 * Catálogo de planos do PDF Master Pro.
 *
 * Modelo espelhado no iLovePDF: plano Grátis (ferramentas essenciais com
 * processamento limitado) e plano Premium cobrado mensal ou anualmente.
 * Preços definidos abaixo como os mais acessíveis frente à concorrência.
 */

export type PlanId = "free" | "premium-monthly" | "premium-annual";

export type PlanLimits = {
  /** Tamanho máximo de cada arquivo, em bytes. */
  maxFileBytes: number;
  /** Quantidade máxima de arquivos por tarefa. */
  maxFilesPerTask: number;
  /** Tarefas por dia (Number.POSITIVE_INFINITY = ilimitado). */
  tasksPerDay: number;
  /** Remove os anúncios da experiência. */
  removeAds: boolean;
  /** Libera as ferramentas marcadas como premium no catálogo. */
  premiumTools: boolean;
};

export type Plan = {
  id: PlanId;
  name: string;
  interval: "free" | "month" | "year";
  /** Preço cobrado no período, em centavos. */
  priceCents: number;
  /** Equivalente mensal (para o plano anual), em centavos. */
  monthlyEquivalentCents?: number;
  tagline: string;
  features: string[];
  limits: PlanLimits;
  /** Pode ser contratado pelo checkout. */
  purchasable: boolean;
  /** Destaque visual do card. */
  featured?: boolean;
};

const MB = 1024 * 1024;

export const FREE_MAX_TASKS_PER_DAY = 10;

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Grátis",
    interval: "free",
    priceCents: 0,
    tagline: "Para tarefas pontuais, sem compromisso.",
    features: [
      "Acesso às ferramentas essenciais",
      "Até 25 MB por arquivo",
      "Até 5 arquivos por tarefa",
      `${FREE_MAX_TASKS_PER_DAY} tarefas por dia`,
      "Com anúncios",
    ],
    limits: { maxFileBytes: 25 * MB, maxFilesPerTask: 5, tasksPerDay: FREE_MAX_TASKS_PER_DAY, removeAds: false, premiumTools: false },
    purchasable: false,
  },
  {
    id: "premium-monthly",
    name: "Premium",
    interval: "month",
    priceCents: 1990,
    tagline: "Para quem trabalha com documentos toda semana.",
    features: [
      "Acesso total a todas as ferramentas",
      "Arquivos de até 100 MB",
      "Até 25 arquivos por tarefa",
      "Processamento ilimitado",
      "Sem anúncios",
      "Suporte prioritário",
    ],
    limits: { maxFileBytes: 100 * MB, maxFilesPerTask: 25, tasksPerDay: Number.POSITIVE_INFINITY, removeAds: true, premiumTools: true },
    purchasable: true,
    featured: true,
  },
  {
    id: "premium-annual",
    name: "Premium",
    interval: "year",
    priceCents: 14990,
    monthlyEquivalentCents: 1249,
    tagline: "O mesmo Premium, com dois meses e meio de desconto.",
    features: [
      "Acesso total a todas as ferramentas",
      "Arquivos de até 100 MB",
      "Até 25 arquivos por tarefa",
      "Processamento ilimitado",
      "Sem anúncios",
      "Suporte prioritário",
    ],
    limits: { maxFileBytes: 100 * MB, maxFilesPerTask: 25, tasksPerDay: Number.POSITIVE_INFINITY, removeAds: true, premiumTools: true },
    purchasable: true,
  },
];

export const FREE_PLAN: Plan = PLANS[0];
export const PREMIUM_PLAN_IDS: PlanId[] = ["premium-monthly", "premium-annual"];

export function getPlan(id: string | null | undefined): Plan {
  return PLANS.find((plan) => plan.id === id) ?? FREE_PLAN;
}

export function isPremiumPlanId(id: string | null | undefined): boolean {
  return PREMIUM_PLAN_IDS.includes(id as PlanId);
}

export function planForInterval(interval: "month" | "year"): Plan {
  return PLANS.find((plan) => plan.interval === interval)!;
}

/** Formata centavos como moeda brasileira: 1990 -> "R$ 19,90". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Desconto do plano anual frente à soma de 12 mensalidades (ex.: "37"). */
export function annualSavingsPercent(): number {
  const monthly = planForInterval("month");
  const annual = planForInterval("year");
  const fullYear = monthly.priceCents * 12;
  if (!fullYear) return 0;
  return Math.round((1 - annual.priceCents / fullYear) * 100);
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toLocaleString("pt-BR")} GB`;
  return `${Math.round(bytes / MB)} MB`;
}
