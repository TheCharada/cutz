"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PublicService, PublicStaffMember } from "@/modules/catalog";
import { BookingFlow } from "./booking-flow";
import type { BookingIntent } from "./booking-intent";
import type { RememberedCustomer } from "./customer-session-types";
import { WaitlistForm } from "./waitlist-form";

export function PublicBookingExperience({
  slug,
  timezone,
  services,
  staff,
  initialCustomer,
  telegramEnabled,
}: {
  slug: string;
  timezone: string;
  services: PublicService[];
  staff: PublicStaffMember[];
  initialCustomer: RememberedCustomer | null;
  telegramEnabled: boolean;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<RememberedCustomer | null>(initialCustomer);
  const [switchingCustomer, setSwitchingCustomer] = useState(false);
  const [bookingIntent, setBookingIntent] = useState<BookingIntent | null>(null);
  const nextRequestId = useRef(0);

  function selectAvailableSlot(slot: Omit<BookingIntent, "requestId">) {
    nextRequestId.current += 1;
    setBookingIntent({ ...slot, requestId: nextRequestId.current });
    requestAnimationFrame(() => document.getElementById("booking-flow")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function switchCustomer() {
    setSwitchingCustomer(true);
    try {
      await fetch(`/api/b/${slug}/customer-session`, { method: "DELETE" });
    } finally {
      setCustomer(null);
      setSwitchingCustomer(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-10">
      <section id="booking-flow" className="scroll-mt-6" aria-label="Agendamento">
        <BookingFlow
          bookingIntent={bookingIntent}
          telegramEnabled={telegramEnabled}
          slug={slug}
          timezone={timezone}
          services={services}
          staff={staff}
          customer={customer}
          switchingCustomer={switchingCustomer}
          onCustomerSessionReady={setCustomer}
          onCustomerSessionInvalid={() => setCustomer(null)}
          onSwitchCustomer={switchCustomer}
        />
      </section>
      <WaitlistForm
        onBookAvailableSlot={selectAvailableSlot}
        timezone={timezone}
        telegramEnabled={telegramEnabled}
        slug={slug}
        services={services}
        staff={staff}
        customer={customer}
        switchingCustomer={switchingCustomer}
        onCustomerSessionReady={setCustomer}
        onCustomerSessionInvalid={() => setCustomer(null)}
        onSwitchCustomer={switchCustomer}
      />
    </div>
  );
}
