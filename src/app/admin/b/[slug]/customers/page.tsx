import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAdminCustomerHistory, listAdminCustomersForAdmin } from "@/workflows/admin-customers";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string | string[]; page?: string | string[]; customer?: string | string[] }>;
};

const appointmentStatuses: Record<string, { label: string; variant: BadgeVariant }> = {
  SCHEDULED: { label: "Agendado", variant: "neutral" },
  COMPLETED: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "destructive" },
  NO_SHOW: { label: "No-show", variant: "warning" },
};

function dateTimeLabel(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function customersHref(params: { q: string; page: number; customer?: string }) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.page > 1) query.set("page", String(params.page));
  if (params.customer) query.set("customer", params.customer);
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "?";
}

export default async function AdminCustomersPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const access = await resolveServerAdminAccess(slug);
  if (access.status === "authentication-required") redirect("/admin/login");
  if (access.status !== "ok") notFound();

  const q = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  const requestedPage = typeof query.page === "string" ? Number(query.page) : 1;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const customerId = typeof query.customer === "string" ? query.customer : null;
  const pageSize = 50;

  const [result, history] = await Promise.all([
    listAdminCustomersForAdmin({
      barbershopId: access.barbershop.id,
      query: q || undefined,
      page,
      pageSize,
    }),
    customerId
      ? getAdminCustomerHistory({ barbershopId: access.barbershop.id, customerId })
      : Promise.resolve(null),
  ]);

  if (customerId && !history) notFound();
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return (
    <PageShell size="xl">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Relacionamento</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Clientes</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Pesquise por nome ou telefone e consulte o histórico de atendimentos sem carregar dados administrativos no navegador.
        </p>
      </header>

      <Card className="mt-6">
        <CardContent className="pt-5 sm:pt-6">
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="customer-search">Pesquisar cliente</Label>
              <Input id="customer-search" name="q" defaultValue={q} placeholder="Nome ou telefone" />
            </div>
            <Button type="submit">Pesquisar</Button>
          </form>
          <p className="mt-3 text-sm text-muted-foreground">
            {result.total} cliente(s) encontrado(s). Página {Math.min(page, totalPages)} de {totalPages}.
          </p>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section aria-labelledby="customer-results-title">
          <h3 id="customer-results-title" className="sr-only">Resultados da pesquisa</h3>
          <div className="space-y-2">
            {result.rows.map((customer) => (
              <Link
                key={customer.id}
                href={customersHref({ q, page, customer: customer.id })}
                aria-current={history?.customer.id === customer.id ? "true" : undefined}
                className="block rounded-xl border border-border bg-card p-4 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/35"
              >
                <strong className="block text-foreground">{customer.name}</strong>
                <span className="mt-1 block text-sm text-muted-foreground">{customer.phoneE164}</span>
              </Link>
            ))}
            {result.rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                Nenhum cliente encontrado para esta pesquisa.
              </div>
            ) : null}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="Paginação de clientes" className="mt-4 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent" href={customersHref({ q, page: page - 1 })}>
                  Página anterior
                </Link>
              ) : <span />}
              {page < totalPages ? (
                <Link className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent" href={customersHref({ q, page: page + 1 })}>
                  Próxima página
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>

        <section aria-labelledby="customer-history-title">
          {history ? (
            <Card>
              <CardContent className="pt-5 sm:pt-6">
                <h3 id="customer-history-title" className="text-lg font-semibold text-foreground">{history.customer.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{history.customer.phoneE164}</p>
                <h4 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Histórico de atendimentos</h4>
                <div className="mt-3 space-y-3">
                  {history.appointments.map((appointment) => {
                    const status = appointmentStatuses[appointment.status] ?? { label: appointment.status, variant: "neutral" as const };
                    return (
                      <article key={appointment.id} className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <strong className="text-sm text-foreground">{dateTimeLabel(appointment.startsAt, access.barbershop.timezone)}</strong>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                        {appointment.cancellationKind === "RESCHEDULED" ? (
                          <p className="mt-2 text-sm text-muted-foreground">Este atendimento foi reagendado.</p>
                        ) : null}
                      </article>
                    );
                  })}
                  {history.appointments.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">Nenhum atendimento registrado.</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <h3 id="customer-history-title" className="font-semibold text-foreground">Selecione um cliente</h3>
              <p className="mt-1 text-sm text-muted-foreground">O histórico será carregado no servidor para o cliente selecionado.</p>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
