const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatPriceCents(priceCents: number | null): string {
  return priceCents === null ? "Preço não informado" : brl.format(priceCents / 100);
}
