import { commonEnvSchema } from "./env";

export function getWebEnv() {
  return commonEnvSchema.parse(process.env);
}
