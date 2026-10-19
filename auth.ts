import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { ROLE_LABEL, isRole, isSessionValid, matchRole, passwordFingerprint } from "@/lib/auth/passwords";

// Auth.js v5 — shared dashboard passwords (viewer / admin / finance). No Supabase Auth, no database writes:
// sessions are signed, encrypted JWT cookies (AUTH_SECRET).
//
// Env (server only): AUTH_SECRET, DASHBOARD_PASSWORD, DASHBOARD_PASSWORD_ADMIN, DASHBOARD_PASSWORD_FINANCE,
// optional AUTH_URL.

const FAILED_LOGIN_DELAY_MS = 800; // slows down password guessing

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        const role = await matchRole(credentials?.password, process.env);
        if (!role) {
          await new Promise((r) => setTimeout(r, FAILED_LOGIN_DELAY_MS));
          return null;
        }
        return { id: role, name: ROLE_LABEL[role], role, fp: await passwordFingerprint(role, process.env) };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12 h
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as { role?: unknown; fp?: unknown };
        token.role = u.role;
        token.fp = u.fp;
      }
      return token;
    },
    // Re-check on every session read, so changing or removing a password revokes access immediately.
    async session({ session, token }) {
      if (!(await isSessionValid(token.role, token.fp, process.env)) || !isRole(token.role)) {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      return { ...session, user: { ...session.user, name: ROLE_LABEL[token.role], role: token.role } };
    },
  },
});
