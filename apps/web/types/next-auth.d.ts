import type { DefaultSession } from "next-auth";

import type { UserRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      email: string;
      id: string;
      name: string | null;
      role: UserRole;
    };
  }

  interface User {
    email: string;
    id: string;
    name: string | null;
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
  }
}
