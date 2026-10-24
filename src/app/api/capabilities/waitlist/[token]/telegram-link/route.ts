import { issueTelegramLinkFromCapability } from "@/app/api/capabilities/_telegram-link";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  return issueTelegramLinkFromCapability(request, token, "waitlist");
}
