import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { listAdminCatalog } from "@/workflows/admin-catalog";
import { catalogImageUrl } from "@/modules/catalog/image-url";
import { StaffManager } from "./staff-manager";

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminStaffPage({ params }: PageProps) {
  const { slug } = await params;
  const access = await resolveServerAdminAccess(slug, "OWNER");

  if (access.status === "authentication-required") {
    redirect("/admin/login");
  }
  if (access.status !== "ok") {
    notFound();
  }

  const { staff } = await listAdminCatalog(access.barbershop.id);
  const rows = staff.map((member) => ({
    id: member.id,
    name: member.name,
    active: member.active,
    acceptsAppointments: member.acceptsAppointments,
    userId: member.userId,
    imageUrl: catalogImageUrl(slug, "staff", member.id, member.imageKey),
  }));

  return (
    <PageShell size="lg">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Catálogo</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Profissionais</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Cadastre profissionais e abra o detalhe de cada pessoa para configurar serviços, jornada e indisponibilidades.
        </p>
      </header>
      <div className="mt-6">
        <StaffManager slug={slug} staff={rows} />
      </div>
    </PageShell>
  );
}
