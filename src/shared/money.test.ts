import { describe, expect, it } from "vitest";
import { formatPriceCents } from "./money";

describe("formatPriceCents", () => {
  it("formats cent amounts in BRL", () => {
    expect(formatPriceCents(3500).replace(/\s/g, " ")).toBe("R$ 35,00");
    expect(formatPriceCents(250)).toContain("2,50");
  });

  it("distinguishes a free service from an unspecified price", () => {
    expect(formatPriceCents(0).replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(formatPriceCents(null)).toBe("Preço não informado");
  });
});
