"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicService, PublicStaffMember } from "@/modules/catalog";
import { BookingFlow } from "./booking-flow";
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
      <BookingFlow
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
      <WaitlistForm
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
