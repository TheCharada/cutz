import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "./phone";

describe("normalizePhoneE164", () => {
  it.each([
    ["(14) 99999-9999", "+5514999999999"],
    ["+55 14 99999-9999", "+5514999999999"],
    ["0055 14 99999-9999", "+5514999999999"],
    ["55 14 99999-9999", "+5514999999999"],
    ["014999999999", "+5514999999999"],
  ])("normalizes %s to E.164", (input, expected) => {
    expect(normalizePhoneE164(input, "BR")).toBe(expected);
  });

  it("accepts an explicit E.164 number independently from the default country", () => {
    expect(normalizePhoneE164("+14155552671", "US")).toBe("+14155552671");
  });

  it("rejects malformed local numbers", () => {
    expect(() => normalizePhoneE164("123", "BR")).toThrow("Invalid Brazilian phone number");
  });

  it("does not guess local numbering rules for unsupported countries", () => {
    expect(() => normalizePhoneE164("4155552671", "US")).toThrow(
      "Local phone normalization is not supported for US",
    );
  });
});
