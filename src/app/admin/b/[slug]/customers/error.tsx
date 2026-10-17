"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminCustomersError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      size="xl"
      title="Não foi possível abrir os clientes"
      description="Tente carregar a consulta de clientes novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
