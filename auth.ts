import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isEmailAllowed } from "@/lib/auth/allowlist";

// Auth.js v5 — Google sign-in, restricted to ALLOWED_EMAILS. No Supabase Auth, no database writes:
// sessions are signed JWT cookies (AUTH_SECRET).
//
// Env (server only): AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ALLOWED_EMAILS, optional AUTH_URL.

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12 h
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ profile, user }) {
      // Require a Google-verified email that is on the allow-list.
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      const email = profile?.email ?? user?.email;
      return verified && isEmailAllowed(email, process.env.ALLOWED_EMAILS);
    },
    // Re-check the allow-list on every session read, so removing an email revokes access immediately.
    session({ session }) {
      if (!isEmailAllowed(session.user?.email, process.env.ALLOWED_EMAILS)) {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      return session;
    },
  },
});
