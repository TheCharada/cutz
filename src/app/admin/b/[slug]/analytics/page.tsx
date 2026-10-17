import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addLocalDays, isValidLocalDate, localDateForInstant } from "@/shared/time";
import {
  getAdminAnalyticsOverview,
  getAdminCancellationAnalytics,
  getAdminNoShowAnalytics,
  getAdminWaitlistAnalytics,
} from "@/workflows/admin-analytics";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
};

const weekdayLabels: Record<string, string> = {
  SUNDAY: "Domingo",
  MONDAY: "Segunda-feira",
  TUESDAY: "Terça-feira",
  WEDNESDAY: "Quarta-feira",
  THURSDAY: "Quinta-feira",
  FRIDAY: "Sexta-feira",
  SATURDAY: "Sábado",
};

function rateLabel(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function explicitRange(query: Awaited<PageProps["searchParams"]>) {
  const from = typeof query.from === "string" ? query.from : undefined;
  const to = typeof query.to === "string" ? query.to : undefined;
  const hasInput = from !== undefined || to !== undefined;
  if (!hasInput) return { status: "default" as const };
  if (!from || !to || !isValidLocalDate(from) || !isValidLocalDate(to) || from > to) {
    return { status: "invalid" as const, from: from ?? "", to: to ?? "" };
  }
  return { status: "valid" as const, from, to };
}

export default async function AdminAnalyticsPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const access = await resolveServerAdminAccess(slug, "OWNER");
  if (access.status === "authentication-required") redirect("/admin/login");
  if (access.status !== "ok") notFound();

  const requestedRange = explicitRange(query);
  const today = localDateForInstant(new Date(), access.barbershop.timezone);
  const selectedRange = requestedRange.status === "valid"
    ? { from: requestedRange.from, to: requestedRange.to }
    : requestedRange.status === "default"
      ? { from: addLocalDays(today, -29), to: today }
      : null;

  const analyticsParams = selectedRange
    ? { barbershop: access.barbershop, ...selectedRange }
    : null;
  const reports = analyticsParams
    ? await Promise.all([
        getAdminAnalyticsOverview(analyticsParams),
        getAdminCancellationAnalytics(analyticsParams),
        getAdminNoShowAnalytics(analyticsParams),
        getAdminWaitlistAnalytics(analyticsParams),
      ])
    : null;

  const overview = reports?.[0] ?? null;
  const cancellations = reports?.[1] ?? null;
  const noShows = reports?.[2] ?? null;
  const waitlist = reports?.[3] ?? null;
  const from = selectedRange?.from ?? (requestedRange.status === "invalid" ? requestedRange.from : "");
  const to = selectedRange?.to ?? (requestedRange.status === "invalid" ? requestedRange.to : "");
  const empty = overview
    ? overview.cancellations === 0 && overview.noShows === 0 && overview.completed === 0 && overview.waitlist.offersCreated === 0
    : false;

  return (
    <PageShell size="xl">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Operação</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Indicadores</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Acompanhe cancelamentos, no-shows e recuperação de vagas pela lista de espera no período selecionado.
        </p>
      </header>

      <Card className="mt-6">
        <CardContent className="pt-5 sm:pt-6">
          <form method="get" className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="analytics-from">De</Label>
              <Input id="analytics-from" name="from" type="date" required defaultValue={from} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analytics-to">Até</Label>
              <Input id="analytics-to" name="to" type="date" required defaultValue={to} />
            </div>
            <Button type="submit">Atualizar período</Button>
          </form>
        </CardContent>
      </Card>

      {requestedRange.status === "invalid" ? (
        <Alert className="mt-4" variant="destructive" role="alert">
          <AlertDescription>
            Período inválido. Informe as duas datas e mantenha a data inicial igual ou anterior à data final.
          </AlertDescription>
        </Alert>
      ) : null}

      {overview ? (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo dos indicadores">
            <Card><CardContent className="pt-5 sm:pt-6"><p className="text-sm text-muted-foreground">Cancelamentos</p><p className="mt-2 text-3xl font-semibold text-foreground">{overview.cancellations}</p></CardContent></Card>
            <Card><CardContent className="pt-5 sm:pt-6"><p className="text-sm text-muted-foreground">No-shows</p><p className="mt-2 text-3xl font-semibold text-foreground">{overview.noShows}</p></CardContent></Card>
            <Card><CardContent className="pt-5 sm:pt-6"><p className="text-sm text-muted-foreground">Taxa de no-show</p><p className="mt-2 text-3xl font-semibold text-foreground">{rateLabel(overview.noShowRate)}</p></CardContent></Card>
            <Card><CardContent className="pt-5 sm:pt-6"><p className="text-sm text-muted-foreground">Vagas recuperadas</p><p className="mt-2 text-3xl font-semibold text-foreground">{rateLabel(overview.waitlist.recoveryRate)}</p></CardContent></Card>
          </section>

          {empty ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Não há dados operacionais no período selecionado.
            </div>
          ) : null}

          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cancelamentos por horário</CardTitle>
                <p className="text-sm text-muted-foreground">Reagendamentos não entram nesta métrica.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-border"><th className="py-2 pr-4">Horário</th><th className="py-2">Cancelamentos</th></tr></thead>
                  <tbody>
                    {cancellations?.items.filter((item) => item.count > 0).map((item) => (
                      <tr className="border-b border-border/60" key={item.hour}><td className="py-2 pr-4">{item.hour.toString().padStart(2, "0")}:00</td><td className="py-2">{item.count}</td></tr>
                    ))}
                    {cancellations?.total === 0 ? <tr><td className="py-3 text-muted-foreground" colSpan={2}>Nenhum cancelamento.</td></tr> : null}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>No-shows por dia da semana</CardTitle>
                <p className="text-sm text-muted-foreground">Base: {noShows?.completed ?? 0} concluídos + {noShows?.total ?? 0} no-shows.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-border"><th className="py-2 pr-4">Dia</th><th className="py-2">No-shows</th></tr></thead>
                  <tbody>
                    {noShows?.items.map((item) => (
                      <tr className="border-b border-border/60" key={item.weekday}><td className="py-2 pr-4">{weekdayLabels[item.weekday] ?? item.weekday}</td><td className="py-2">{item.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>

          <Card className="mt-6">
            <CardHeader><CardTitle>Lista de espera</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-sm text-muted-foreground">Ofertas criadas</p><p className="mt-1 text-2xl font-semibold text-foreground">{waitlist?.offersCreated ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Ofertas aceitas</p><p className="mt-1 text-2xl font-semibold text-foreground">{waitlist?.offersAccepted ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Oportunidades</p><p className="mt-1 text-2xl font-semibold text-foreground">{waitlist?.opportunities ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Oportunidades recuperadas</p><p className="mt-1 text-2xl font-semibold text-foreground">{waitlist?.opportunitiesRecovered ?? 0}</p></div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
