import { z } from "zod";
import { isValidLocalDate } from "@/shared/time";

const localDate = z.string().refine(isValidLocalDate, { message: "Data inválida." });

const analyticsRangeSchema = z
  .object({
    from: localDate.optional(),
    to: localDate.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.from && !value.to) || (!value.from && value.to)) {
      ctx.addIssue({
        code: "custom",
        message: "Informe from e to juntos.",
        path: value.from ? ["to"] : ["from"],
      });
      return;
    }
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({ code: "custom", message: "to deve ser igual ou posterior a from.", path: ["to"] });
    }
  });

export function parseAnalyticsRange(request: Request) {
  return analyticsRangeSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
}
