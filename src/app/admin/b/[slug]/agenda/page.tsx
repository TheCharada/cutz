import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { isValidLocalDate, localDateForInstant } from "@/shared/time";
import { listAdminAgenda } from "@/workflows/admin-appointments";
import { AdminAgenda } from "./admin-agenda";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
};

export default async function AdminAgendaPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const access = await resolveServerAdminAccess(slug);

  if (access.status === "authentication-required") {
    redirect("/admin/login");
  }
  if (access.status !== "ok") {
    notFound();
  }

  const requestedDate = typeof query.date === "string" ? query.date : null;
  const date =
    requestedDate && isValidLocalDate(requestedDate)
      ? requestedDate
      : localDateForInstant(new Date(), access.barbershop.timezone);
  const rows = await listAdminAgenda({ barbershop: access.barbershop, date });
  const appointments = rows.map((appointment) => ({
    id: appointment.id,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    customer: {
      id: appointment.customer.id,
      name: appointment.customer.name,
      phoneE164: appointment.customer.phoneE164,
    },
    service: {
      id: appointment.service.id,
      name: appointment.service.name,
      durationMinutes: appointment.service.durationMinutes,
    },
    bookedService: appointment.bookedService,
    staff: {
      id: appointment.staff.id,
      name: appointment.staff.name,
    },
  }));

  return (
    <PageShell size="lg">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Agenda</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Consulte os atendimentos do dia e execute as ações operacionais da barbearia.
        </p>
      </header>
      <div className="mt-6">
        <AdminAgenda
          key={date}
          slug={slug}
          initialDate={date}
          timezone={access.barbershop.timezone}
          appointments={appointments}
        />
      </div>
    </PageShell>
  );
}
