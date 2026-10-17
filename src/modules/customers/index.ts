export {
  createOrReuseCustomer,
  customerSessionSatisfiesVerificationMode,
  getCustomerByPhone,
  getCustomerIdentity,
  issuePhoneVerifiedCustomerSession,
  issueUnverifiedCustomerSession,
  PHONE_VERIFIED_CUSTOMER_SESSION_TTL_MS,
  resolveCustomerPrincipal,
  revokeCustomerSession,
  UNVERIFIED_CUSTOMER_SESSION_TTL_MS,
} from "./customer.service";
export { getAdminCustomer, getAdminCustomers } from "./admin.service";
export {
  createOtpChallenge,
  getOtpChallengeById,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_INTERVAL_MS,
  OTP_TTL_MS,
  resendOtpChallenge,
  verifyOtpChallenge,
} from "./otp.service";
export { normalizePhoneE164 } from "./phone";
export type {
  CustomerIdentity,
  CustomerPrincipal,
  CustomerVerificationLevel,
  IssuedCustomerSession,
} from "./types";
