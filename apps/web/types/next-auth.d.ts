import type { DefaultSession } from "next-auth";

import type { MembershipStatus } from "@/lib/access-control";
import type { UserRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      email: string;
      id: string;
      name: string | null;
      organizationId: string;
      organizationName: string;
      organizationSlug: string;
      membershipStatus: MembershipStatus;
      role: UserRole;
    };
  }

  interface User {
    email: string;
    id: string;
    name: string | null;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    membershipStatus: MembershipStatus;
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    organizationId?: string;
    organizationName?: string;
    organizationSlug?: string;
    membershipStatus?: MembershipStatus;
    role?: UserRole;
  }
}
