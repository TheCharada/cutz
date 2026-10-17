type ClassDictionary = Record<string, boolean | null | undefined>;
type ClassValue = string | number | false | null | undefined | ClassDictionary | ClassValue[];

function appendClassValue(value: ClassValue, output: string[]) {
  if (!value) return;
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => appendClassValue(item, output));
    return;
  }
  Object.entries(value).forEach(([className, enabled]) => {
    if (enabled) output.push(className);
  });
}

export function cn(...values: ClassValue[]) {
  const output: string[] = [];
  values.forEach((value) => appendClassValue(value, output));
  return output.join(" ");
}
