"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      size="xl"
      title="Não foi possível abrir os indicadores"
      description="Ocorreu um erro ao carregar esta página."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
