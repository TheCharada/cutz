import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { localDateForInstant } from "@/shared/time";
import { listAdminCustomersForAdmin } from "@/workflows/admin-customers";
import { listAdminWaitlist } from "@/workflows/admin-waitlist";
import { listPublicServicesForBarbershop, listPublicStaffForBarbershop } from "@/workflows/public-catalog";
import { WaitlistManager } from "./waitlist-manager";

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminWaitlistPage({ params }: PageProps) {
  const { slug } = await params;
  const access = await resolveServerAdminAccess(slug);
  if (access.status === "authentication-required") redirect("/admin/login");
  if (access.status !== "ok") notFound();

  const [items, customerResult, services, staff] = await Promise.all([
    listAdminWaitlist(access.barbershop.id),
    listAdminCustomersForAdmin({ barbershopId: access.barbershop.id, page: 1, pageSize: 100 }),
    listPublicServicesForBarbershop(slug),
    listPublicStaffForBarbershop(slug),
  ]);

  const serializedItems = items.map((item) => ({
    id: item.id,
    customerId: item.customerId,
    serviceId: item.serviceId,
    staffId: item.staffId,
    customerName: item.customerName,
    customerPhoneE164: item.customerPhoneE164,
    serviceName: item.serviceName,
    staffName: item.staffName,
    desiredDate: item.desiredDate,
    earliestTime: item.earliestTime,
    latestTime: item.latestTime,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  }));

  return (
    <PageShell size="xl">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Operação</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Lista de espera</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Consulte a fila, adicione clientes a uma janela desejada e cancele entradas ativas quando necessário.
        </p>
      </header>
      <div className="mt-6">
        <WaitlistManager
          slug={slug}
          minDate={localDateForInstant(new Date(), access.barbershop.timezone)}
          items={serializedItems}
          customers={customerResult.rows.map((customer) => ({ id: customer.id, name: customer.name, phoneE164: customer.phoneE164 }))}
          services={(services ?? []).map((service) => ({ id: service.id, name: service.name }))}
          staff={(staff ?? []).map((member) => ({ id: member.id, name: member.name }))}
        />
      </div>
    </PageShell>
  );
}
