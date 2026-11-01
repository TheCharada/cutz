"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ImageUploader } from "@/components/cutz/image-uploader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductStockPanel } from "./product-stock-panel";

export type ProductRow = {
  id: string; name: string; description: string | null; priceCents: number;
  stockQuantity: number; minimumStock: number; imageUrl: string | null; active: boolean;
};
type ApiError = { error?: { message?: string } };
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function money(value: number) { return currency.format(value / 100); }
function asMoneyInput(value: number) { return (value / 100).toFixed(2).replace(".", ","); }

function priceCents(value: string) {
  const raw = value.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(raw)) throw Error("Informe um preço válido.");
  const cents = Math.round(Number(raw.replace(",", ".")) * 100);
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000)
    throw Error("Preço fora do limite permitido.");
  return cents;
}

function minimumStock(value: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000)
    throw Error("Informe um estoque mínimo válido.");
  return n;
}

async function readError(response: Response) {
  try { return ((await response.json()) as ApiError).error?.message ?? "Não foi possível salvar."; }
  catch { return "Não foi possível salvar."; }
}

function ProductCard({ slug, product }: { slug: string; product: ProductRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endpoint = `/api/admin/b/${slug}/products/${product.id}`;

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? "").trim(),
          description: String(data.get("description") ?? "").trim() || null,
          priceCents: priceCents(String(data.get("price") ?? "")),
          minimumStock: minimumStock(String(data.get("minimumStock") ?? "")),
          active: data.has("active"),
        }),
      });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      if (!response.ok) throw Error(await readError(response));
      setNotice("Produto atualizado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o produto.");
    } finally {
      setBusy(false);
    }
  }

  const lowStock = product.stockQuantity > 0 && product.stockQuantity <= product.minimumStock;
  const soldOut = product.stockQuantity === 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{product.name}</h3>
            <p className="text-sm text-muted-foreground">
              {money(product.priceCents)} · {product.stockQuantity} unidade(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={product.active ? "success" : "neutral"}>{product.active ? "Ativo" : "Inativo"}</Badge>
            {soldOut ? <Badge variant="neutral">Esgotado</Badge> : null}
            {lowStock ? <Badge variant="warning">Estoque baixo</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImageUploader
          imageUrl={product.imageUrl} name={product.name} label="Fotografia do produto"
          uploadUrl={`${endpoint}/image`}
        />
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void update(event)}>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`name-${product.id}`}>Nome</Label>
            <Input id={`name-${product.id}`} name="name" defaultValue={product.name}
              maxLength={120} required disabled={busy} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`desc-${product.id}`}>Descrição</Label>
            <textarea id={`desc-${product.id}`} name="description" rows={2}
              defaultValue={product.description ?? ""} maxLength={2000} disabled={busy}
              className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`price-${product.id}`}>Preço (R$)</Label>
            <Input id={`price-${product.id}`} name="price" inputMode="decimal"
              defaultValue={asMoneyInput(product.priceCents)} required disabled={busy} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`min-${product.id}`}>Estoque mínimo</Label>
            <Input id={`min-${product.id}`} name="minimumStock" type="number"
              min={0} max={1000000} step={1} defaultValue={product.minimumStock} required disabled={busy} />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="active" defaultChecked={product.active} disabled={busy} />
            Produto ativo
          </label>
          <div className="sm:col-span-2">
            <Button disabled={busy} type="submit" variant="secondary">
              {busy ? "Salvando…" : "Salvar alterações"}
            </Button>
          </div>
        </form>
        {error ? <Alert role="alert" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {notice ? <Alert role="status" variant="success"><AlertDescription>{notice}</AlertDescription></Alert> : null}
        <ProductStockPanel slug={slug} productId={product.id} quantity={product.stockQuantity} />
      </CardContent>
    </Card>
  );
}

export function ProductManager({ slug, products }: { slug: string; products: ProductRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? "").trim(),
          description: String(data.get("description") ?? "").trim() || null,
          priceCents: priceCents(String(data.get("price") ?? "")),
          minimumStock: minimumStock(String(data.get("minimumStock") ?? "0")),
        }),
      });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      if (!response.ok) throw Error(await readError(response));
      form.reset();
      setNotice("Produto cadastrado. Registre uma entrada para informar o estoque inicial.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o produto.");
    } finally {
      setBusy(false);
    }
  }

  const active = products.filter((product) => product.active);
  const low = active.filter((product) => product.stockQuantity > 0 &&
    product.stockQuantity <= product.minimumStock).length;
  const empty = active.filter((product) => product.stockQuantity === 0).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Produtos ativos", active.length],
          ["Estoque baixo", low],
          ["Esgotados", empty],
        ].map(([label, value]) => (
          <Card key={label}><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Novo produto</h3>
          <p className="text-sm text-muted-foreground">
            O estoque começa em zero. Registre uma entrada após o cadastro para informar as unidades disponíveis.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="new-product-name">Nome</Label>
              <Input id="new-product-name" name="name" maxLength={120} required disabled={busy} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="new-product-description">Descrição</Label>
              <textarea id="new-product-description" name="description" rows={2}
                maxLength={2000} disabled={busy}
                className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-product-price">Preço (R$)</Label>
              <Input id="new-product-price" name="price" inputMode="decimal"
                placeholder="Ex.: 45,00" required disabled={busy} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-product-minimum">Estoque mínimo</Label>
              <Input id="new-product-minimum" name="minimumStock" type="number"
                min={0} max={1000000} step={1} defaultValue={0} required disabled={busy} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? "Cadastrando…" : "Cadastrar produto"}</Button>
            </div>
          </form>
          {error ? <Alert role="alert" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {notice ? <Alert role="status" variant="success"><AlertDescription>{notice}</AlertDescription></Alert> : null}
        </CardContent>
      </Card>

      <section aria-labelledby="product-list-title" className="space-y-4">
        <h3 id="product-list-title" className="text-lg font-semibold">Produtos cadastrados ({products.length})</h3>
        {products.length === 0
          ? <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
          : <div className="grid items-start gap-4 lg:grid-cols-2">
            {products.map((product) => <ProductCard key={product.id} slug={slug} product={product} />)}
          </div>}
      </section>
    </div>
  );
}
