"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function BookingError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="Não foi possível abrir a agenda"
      description="Tente novamente. Se o problema continuar, volte mais tarde."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
