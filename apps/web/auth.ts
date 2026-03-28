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
        session.user.role = isUserRole(token.role) ? token.role : "intern";
      }

      return session;
    },
  },
});
