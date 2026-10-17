"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminAgendaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      size="lg"
      title="Não foi possível abrir a agenda"
      description="Tente carregar a agenda novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
