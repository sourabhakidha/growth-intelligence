import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3, ShieldCheck } from "lucide-react";
import { signInWithGoogle } from "@/app/actions";
import { getUser } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "This Google account is not on the dashboard allow-list.",
  Configuration: "Sign-in is not configured yet. Ask an admin to set the Auth environment variables.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getUser()) redirect("/");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "Sign-in failed. Try again.") : null;
  const next = typeof sp.next === "string" ? sp.next : "/";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface-1 p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white">
            <BarChart3 size={18} aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-semibold text-ink">Growth Intelligence</h1>
            <p className="text-xs text-ink-3">Akidha · internal dashboard</p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-5 rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-xs text-ink">
            {error}
          </p>
        ) : null}
        <form action={signInWithGoogle} className="mt-6">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Continue with Google
          </button>
        </form>
        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
          <ShieldCheck size={13} className="mt-px shrink-0" aria-hidden />
          Access is limited to approved accounts. Customer-level details are never shown on this dashboard.
        </p>
      </div>
    </main>
  );
}
