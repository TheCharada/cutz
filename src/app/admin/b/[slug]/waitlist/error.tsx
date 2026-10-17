"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminWaitlistError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      size="xl"
      title="Não foi possível abrir a lista de espera"
      description="Tente carregar a operação da lista de espera novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
