"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="Não foi possível carregar a lista de espera"
      description="Tente carregar esta página novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
