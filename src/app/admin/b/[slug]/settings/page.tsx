import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { getAdminSettings } from "@/workflows/admin-settings";
import { AdminSettings } from "./admin-settings";

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const access = await resolveServerAdminAccess(slug, "OWNER");
  if (access.status === "authentication-required") redirect("/admin/login");
  if (access.status !== "ok") notFound();

  const settings = await getAdminSettings(access.barbershop.id);
  if (!settings) notFound();

  const initialSettings = {
    id: settings.id,
    name: settings.name,
    slug: settings.slug,
    timezone: settings.timezone,
    bookingIntervalMinutes: settings.bookingIntervalMinutes,
    customerVerificationMode: settings.customerVerificationMode,
    waitlistOfferTtlMinutes: settings.waitlistOfferTtlMinutes,
    reminderOffsetMinutes: settings.reminderOffsetMinutes,
  };

  return (
    <PageShell size="md">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Administração</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Configurações</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Ajuste as regras gerais de agendamento, verificação do cliente, lista de espera e lembretes da barbearia.
        </p>
      </header>
      <div className="mt-6">
        <AdminSettings slug={slug} initialSettings={initialSettings} />
      </div>
    </PageShell>
  );
}
