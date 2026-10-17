type AppointmentCapabilityView = {
  barbershop: { slug: string; timezone: string };
  customer: { name: string };
  service: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string };
  appointment: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
    cancelledAt: Date | null;
    cancelledBy: "CUSTOMER" | "STAFF" | null;
    cancellationKind: "CANCELLATION" | "RESCHEDULED" | null;
    cancellationReason: string | null;
    rescheduledFromId: string | null;
  };
};

export function serializeAppointmentCapability(view: AppointmentCapabilityView) {
  return {
    barbershop: view.barbershop,
    customer: view.customer,
    service: view.service,
    staff: view.staff,
    appointment: {
      ...view.appointment,
      startsAt: view.appointment.startsAt.toISOString(),
      endsAt: view.appointment.endsAt.toISOString(),
      cancelledAt: view.appointment.cancelledAt?.toISOString() ?? null,
    },
  };
}
