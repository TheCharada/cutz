export type CustomerVerificationLevel = "UNVERIFIED" | "PHONE_VERIFIED";

export type CustomerIdentity = {
  id: string;
  barbershopId: string;
  name: string;
  phoneE164: string;
};

export type CustomerPrincipal = CustomerIdentity & {
  verificationLevel: CustomerVerificationLevel;
};

export type IssuedCustomerSession = {
  principal: CustomerPrincipal;
  token: string;
  expiresAt: Date;
};
