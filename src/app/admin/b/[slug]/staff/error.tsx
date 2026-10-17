"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminStaffError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      size="lg"
      title="Não foi possível abrir os profissionais"
      description="Tente carregar a equipe e suas configurações novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
