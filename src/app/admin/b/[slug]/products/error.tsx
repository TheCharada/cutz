"use client";
import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";
export default function AdminProductsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState size="lg" title="Não foi possível abrir os produtos"
    description="Tente carregar o catálogo de produtos novamente."
    action={<Button type="button" onClick={reset}>Tentar novamente</Button>} />;
}
