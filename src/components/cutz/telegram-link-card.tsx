"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  isValidTelegramDeepLink,
  telegramLinkEndpoint,
  type TelegramLinkScope,
} from "./telegram-link-utils";

type TelegramLinkResponse = { url?: unknown; expiresAt?: unknown };

export function TelegramLinkCard({
  scope,
  managementUrl,
}: {
  scope: TelegramLinkScope;
  managementUrl: string;
}) {
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createLink() {
    if (loading) return;
    setLoading(true);
    setLink(null);
    setError(null);

    const endpoint = telegramLinkEndpoint(managementUrl, scope, window.location.origin);
    if (!endpoint) {
      setError("Não foi possível validar o link de gerenciamento. Acesse novamente esta página.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Muitas tentativas. Aguarde um pouco e tente novamente.");
        }
        if (response.status === 503) {
          throw new Error("A vinculação com Telegram está indisponível no momento.");
        }
        throw new Error("Não foi possível gerar o link. Tente novamente.");
      }

      const body = await response.json() as TelegramLinkResponse;
      if (!isValidTelegramDeepLink(body.url) ||
          typeof body.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(body.expiresAt)) ||
          Date.parse(body.expiresAt) <= Date.now()) {
        throw new Error("O link recebido é inválido. Gere outro link.");
      }
      setLink({ url: body.url, expiresAt: body.expiresAt });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar o link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border bg-muted/25 p-5 shadow-none sm:p-6">
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Receber avisos pelo Telegram</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Opcional. Vincule seu Telegram para receber notificações
            {scope === "appointment" ? " deste agendamento" : " desta lista de espera"}.
            Seu horário ou posição na fila não depende desta etapa.
          </p>
        </div>

        <Button type="button" variant="outline" disabled={loading}
          aria-busy={loading} onClick={() => void createLink()}>
          {loading ? "Gerando link…" : link ? "Gerar outro link" : "Conectar Telegram"}
        </Button>

        {link ? (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4" role="status">
            <p className="text-sm text-foreground">
              Abra o bot e toque em <strong>Iniciar</strong>. A confirmação aparecerá no próprio Telegram.
            </p>
            <a href={link.url} target="_blank" rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
              Abrir Telegram
              <span className="sr-only"> (abre em uma nova aba)</span>
            </a>
            <p className="text-xs text-muted-foreground">
              Link de uso único, válido até {new Date(link.expiresAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit", minute: "2-digit",
              })}. Se expirar, gere outro. Avisos anteriores à vinculação não serão reenviados.
            </p>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Para parar de receber mensagens, envie /stop ao bot.
        </p>
      </div>
    </Card>
  );
}
