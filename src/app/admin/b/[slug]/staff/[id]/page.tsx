import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { getStaffAdminConfiguration, listAdminCatalog } from "@/workflows/admin-catalog";
import { catalogImageUrl } from "@/modules/catalog/image-url";
import { StaffEditor } from "./staff-editor";

type PageProps = { params: Promise<{ slug: string; id: string }> };

export default async function AdminStaffDetailPage({ params }: PageProps) {
  const { slug, id } = await params;
  const access = await resolveServerAdminAccess(slug, "OWNER");

  if (access.status === "authentication-required") {
    redirect("/admin/login");
  }
  if (access.status !== "ok") {
    notFound();
  }

  const [configuration, catalog] = await Promise.all([
    getStaffAdminConfiguration({ barbershopId: access.barbershop.id, staffId: id }),
    listAdminCatalog(access.barbershop.id),
  ]);
  if (!configuration) {
    notFound();
  }

  const staff = {
    id: configuration.staff.id,
    name: configuration.staff.name,
    active: configuration.staff.active,
    acceptsAppointments: configuration.staff.acceptsAppointments,
    imageUrl: catalogImageUrl(slug, "staff", configuration.staff.id, configuration.staff.imageKey),
  };
  const services = catalog.services.map((service) => ({
    id: service.id,
    name: service.name,
    active: service.active,
  }));
  const hours = configuration.hours.map((hour) => ({
    weekday: hour.weekday,
    startsAt: hour.startsAt,
    endsAt: hour.endsAt,
  }));
  const timeOff = configuration.timeOff.map((item) => ({
    id: item.id,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    reason: item.reason,
  }));

  return (
    <PageShell size="lg">
      <header>
        <Link className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/admin/b/${slug}/staff`}>
          ← Profissionais
        </Link>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{staff.name}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Configure os dados operacionais, serviços realizados, jornada semanal e períodos de indisponibilidade.
        </p>
      </header>
      <div className="mt-6">
        <StaffEditor
          slug={slug}
          staff={staff}
          services={services}
          initialServiceIds={configuration.serviceIds}
          initialHours={hours}
          timeOff={timeOff}
          timezone={access.barbershop.timezone}
        />
      </div>
    </PageShell>
  );
}
