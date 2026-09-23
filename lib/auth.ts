import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getServerSession } from "next-auth";
import { queryOne } from "@/lib/db";

// Single-user gate. Only ALLOWED_EMAIL may sign in.
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "").toLowerCase().trim();

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    // Fail closed: reject anyone who is not the single allowed operator.
    async signIn({ user }) {
      const email = (user.email || "").toLowerCase().trim();
      if (!ALLOWED_EMAIL) {
        console.error("[auth] ALLOWED_EMAIL not configured; refusing all sign-ins.");
        return false;
      }
      return email === ALLOWED_EMAIL;
    },
    async jwt({ token, profile }) {
      if (profile && (profile as any).sub) token.sub = (profile as any).sub;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).sub = token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/", // custom sign-in surfaced on the home page
  },
};

// Server-side helper: returns the operator's DB user id, or null if unauthenticated.
export async function getOperatorId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase().trim();
  const sub = (session?.user as any)?.sub as string | undefined;
  if (!email || email !== ALLOWED_EMAIL || !sub) return null;

  // Upsert the single user and return the id.
  const row = await queryOne<{ id: number }>(
    `INSERT INTO app_user (oidc_sub, email)
     VALUES ($1, $2)
     ON CONFLICT (oidc_sub) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [sub, email]
  );
  return row?.id ?? null;
}
