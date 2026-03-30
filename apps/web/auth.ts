import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { isMembershipStatus } from "@/lib/access-control";
import { authenticateUser, getAuthenticatedUserByEmail } from "@/lib/users";
import { isUserRole } from "@/lib/roles";

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: {
          label: "Email",
          type: "email",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },
      async authorize(credentials) {
        const email =
          credentials && typeof credentials.email === "string"
            ? credentials.email.trim()
            : "";
        const password =
          credentials && typeof credentials.password === "string"
            ? credentials.password
            : "";

        if (!email || !password) {
          return null;
        }

        const user = await authenticateUser(email, password);

        if (!user) {
          return null;
        }

        return {
          email: user.email,
          id: user.id,
          membershipStatus: user.membershipStatus,
          name: user.name,
          organizationId: user.organizationId,
          organizationName: user.organizationName,
          organizationSlug: user.organizationSlug,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
        token.name = user.name;
        token.organizationId =
          "organizationId" in user && typeof user.organizationId === "string"
            ? user.organizationId
            : undefined;
        token.organizationName =
          "organizationName" in user && typeof user.organizationName === "string"
            ? user.organizationName
            : undefined;
        token.organizationSlug =
          "organizationSlug" in user && typeof user.organizationSlug === "string"
            ? user.organizationSlug
            : undefined;
        token.membershipStatus =
          "membershipStatus" in user && isMembershipStatus(user.membershipStatus)
            ? user.membershipStatus
            : undefined;
        token.sub = user.id;

        if ("role" in user && isUserRole(user.role)) {
          token.role = user.role;
        }
      }

      return token;
    },
    async session({ session, token }) {
      const refreshedUser =
        typeof token.email === "string"
          ? await getAuthenticatedUserByEmail(token.email)
          : null;

      if (session.user) {
        session.user.email = refreshedUser?.email ?? (
          typeof token.email === "string" ? token.email : session.user.email ?? ""
        );
        session.user.id = refreshedUser?.id ?? (
          typeof token.sub === "string" ? token.sub : ""
        );
        session.user.name = refreshedUser?.name ?? (
          typeof token.name === "string" ? token.name : null
        );
        session.user.organizationId = refreshedUser?.organizationId ?? (
          typeof token.organizationId === "string" ? token.organizationId : ""
        );
        session.user.organizationName = refreshedUser?.organizationName ?? (
          typeof token.organizationName === "string" ? token.organizationName : ""
        );
        session.user.organizationSlug = refreshedUser?.organizationSlug ?? (
          typeof token.organizationSlug === "string" ? token.organizationSlug : ""
        );
        session.user.membershipStatus = refreshedUser?.membershipStatus ?? (
          isMembershipStatus(token.membershipStatus) ? token.membershipStatus : "active"
        );
        session.user.role = refreshedUser?.role ?? (isUserRole(token.role) ? token.role : "member");
      }

      return session;
    },
  },
});
