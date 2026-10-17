export type MembershipRole = "OWNER" | "STAFF";

export type UserIdentity = {
  id: string;
  email: string;
};

export type UserMembership = {
  barbershopId: string;
  slug: string;
  name: string;
  role: MembershipRole;
};

export type AdminPrincipal = {
  user: UserIdentity;
  memberships: UserMembership[];
};

export type IssuedUserSession = {
  token: string;
  expiresAt: Date;
  principal: AdminPrincipal;
};
