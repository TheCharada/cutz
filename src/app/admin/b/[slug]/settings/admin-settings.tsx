"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  bookingIntervalMinutes: number;
  customerVerificationMode: "NONE" | "WHATSAPP_OTP";
  waitlistOfferTtlMinutes: number;
  reminderOffsetMinutes: number;
};
type ApiError = { error?: { message?: string } };

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AdminSettings({ slug, initialSettings }: { slug: string; initialSettings: Settings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: settings.name,
          bookingIntervalMinutes: settings.bookingIntervalMinutes,
          customerVerificationMode: settings.customerVerificationMode,
          waitlistOfferTtlMinutes: settings.waitlistOfferTtlMinutes,
          reminderOffsetMinutes: settings.reminderOffsetMinutes,
        }),
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar as configurações."));
      const body = (await response.json()) as { settings: Settings };
      setSettings(body.settings);
      setSaved(true);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regras da barbearia</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert className="mb-5" variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {saved ? (
          <Alert className="mb-5" variant="success" role="status">
            <AlertDescription>Configurações salvas.</AlertDescription>
          </Alert>
        ) : null}

        <form className="space-y-5" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="settings-name">Nome</Label>
            <Input id="settings-name" required value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-timezone">Timezone</Label>
            <Input id="settings-timezone" value={settings.timezone} readOnly aria-describedby="timezone-help" />
            <p className="text-xs text-muted-foreground" id="timezone-help">O timezone não é editável neste MVP.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-booking-interval">Intervalo da agenda (minutos)</Label>
              <Input id="settings-booking-interval" type="number" min={1} required value={settings.bookingIntervalMinutes} onChange={(event) => setSettings({ ...settings, bookingIntervalMinutes: Number(event.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-waitlist-ttl">TTL da oferta da fila (minutos)</Label>
              <Input id="settings-waitlist-ttl" type="number" min={1} required value={settings.waitlistOfferTtlMinutes} onChange={(event) => setSettings({ ...settings, waitlistOfferTtlMinutes: Number(event.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-reminder-offset">Antecedência do lembrete (minutos)</Label>
              <Input id="settings-reminder-offset" type="number" min={0} required value={settings.reminderOffsetMinutes} onChange={(event) => setSettings({ ...settings, reminderOffsetMinutes: Number(event.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-verification">Verificação do cliente</Label>
              <select
                id="settings-verification"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                value={settings.customerVerificationMode}
                onChange={(event) => setSettings({ ...settings, customerVerificationMode: event.target.value as Settings["customerVerificationMode"] })}
              >
                <option value="NONE">Sem verificação</option>
                <option value="WHATSAPP_OTP">WhatsApp OTP</option>
              </select>
            </div>
          </div>
          <Button type="submit" disabled={saving} aria-busy={saving}>
            {saving ? "Salvando…" : "Salvar configurações"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
