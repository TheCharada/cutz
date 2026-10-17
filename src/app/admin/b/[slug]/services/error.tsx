"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminServicesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      size="lg"
      title="Não foi possível abrir os serviços"
      description="Tente carregar o catálogo de serviços novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
