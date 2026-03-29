import type { DefaultSession } from "next-auth";

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
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    organizationId?: string;
    organizationName?: string;
    organizationSlug?: string;
    role?: UserRole;
  }
}
