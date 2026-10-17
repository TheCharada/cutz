const e164Pattern = /^\+[1-9]\d{7,14}$/;

function asE164(digits: string) {
  const value = `+${digits}`;
  if (!e164Pattern.test(value)) {
    throw new Error("Invalid E.164 phone number");
  }
  return value;
}

export function normalizePhoneE164(input: string, defaultCountry = "BR") {
  const value = input.trim();
  if (!value) {
    throw new Error("Phone number is required");
  }

  if (value.startsWith("+")) {
    return asE164(value.slice(1).replace(/\D/g, ""));
  }

  if (value.startsWith("00")) {
    return asE164(value.slice(2).replace(/\D/g, ""));
  }

  let digits = value.replace(/\D/g, "");
  const country = defaultCountry.trim().toUpperCase();

  if (country !== "BR") {
    throw new Error(`Local phone normalization is not supported for ${country}`);
  }

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return asE164(digits);
  }

  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10 && digits.length !== 11) {
    throw new Error("Invalid Brazilian phone number");
  }

  return asE164(`55${digits}`);
}
