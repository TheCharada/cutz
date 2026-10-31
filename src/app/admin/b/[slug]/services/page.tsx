import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { listAdminCatalog } from "@/workflows/admin-catalog";
import { catalogImageUrl } from "@/modules/catalog/image-url";
import { ServiceManager } from "./service-manager";

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminServicesPage({ params }: PageProps) {
  const { slug } = await params;
  const access = await resolveServerAdminAccess(slug, "OWNER");

  if (access.status === "authentication-required") {
    redirect("/admin/login");
  }
  if (access.status !== "ok") {
    notFound();
  }

  const { services } = await listAdminCatalog(access.barbershop.id);
  const rows = services.map((service) => ({
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
    active: service.active,
    imageUrl: catalogImageUrl(slug, "services", service.id, service.imageKey),
  }));

  return (
    <PageShell size="lg">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Catálogo</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Serviços</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Cadastre os serviços oferecidos, ajuste duração e preço e desative opções sem apagar o histórico.
        </p>
      </header>
      <div className="mt-6">
        <ServiceManager slug={slug} services={rows} />
      </div>
    </PageShell>
  );
}
