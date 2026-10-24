import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isTelegramLinkingEnabled } from "@/config/telegram-linking";
import { PageHeader } from "@/components/cutz/page-header";
import { PageShell } from "@/components/cutz/page-shell";
import { customerSessionCookieName } from "@/infrastructure/http";
import {
  getPublicBarbershopForBooking,
  listPublicServicesForBarbershop,
  listPublicStaffForBarbershop,
} from "@/workflows/public-catalog";
import { resolvePublicCustomerSession } from "@/workflows/customer-session";
import { PublicBookingExperience } from "./public-booking-experience";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function PublicBookingPage({ params }: PageProps) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(customerSessionCookieName(slug))?.value ?? null;

  const [barbershop, services, staff, session] = await Promise.all([
    getPublicBarbershopForBooking(slug),
    listPublicServicesForBarbershop(slug),
    listPublicStaffForBarbershop(slug),
    sessionToken
      ? resolvePublicCustomerSession({ slug, sessionToken })
      : Promise.resolve(null),
  ]);

  if (!barbershop || !services || !staff) {
    notFound();
  }

  const initialCustomer = session?.status === "ok"
    ? { name: session.principal.name, phoneE164: session.principal.phoneE164 }
    : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cutz · agendamento online"
        title="Agendar horário"
        description="Escolha serviço, profissional e horário. Seus dados ficam lembrados neste navegador para os próximos agendamentos."
      />

      <div className="mt-8">
        <PublicBookingExperience
          slug={slug}
          timezone={barbershop.timezone}
          services={services}
          staff={staff}
          initialCustomer={initialCustomer}
          telegramEnabled={isTelegramLinkingEnabled()}
        />
      </div>
    </PageShell>
  );
}
