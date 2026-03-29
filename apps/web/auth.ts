import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authenticateUser } from "@/lib/users";
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
        token.sub = user.id;

        if ("role" in user && isUserRole(user.role)) {
          token.role = user.role;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email =
          typeof token.email === "string" ? token.email : session.user.email ?? "";
        session.user.id = typeof token.sub === "string" ? token.sub : "";
        session.user.name = typeof token.name === "string" ? token.name : null;
        session.user.organizationId =
          typeof token.organizationId === "string" ? token.organizationId : "";
        session.user.organizationName =
          typeof token.organizationName === "string" ? token.organizationName : "";
        session.user.organizationSlug =
          typeof token.organizationSlug === "string" ? token.organizationSlug : "";
        session.user.role = isUserRole(token.role) ? token.role : "intern";
      }

      return session;
    },
  },
});
