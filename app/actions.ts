"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

export async function signInWithPassword(formData: FormData) {
  const next = String(formData.get("next") ?? "/");
  // Only allow same-site relative paths as the post-login destination.
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  try {
    await signIn("credentials", { password: String(formData.get("password") ?? ""), redirectTo: safe });
  } catch (err) {
    // Success throws Next's redirect, which must propagate; only auth failures are handled here.
    if (err instanceof AuthError) {
      const qs = new URLSearchParams({ error: err.type === "CredentialsSignin" ? "CredentialsSignin" : "Configuration" });
      if (safe !== "/") qs.set("next", safe);
      redirect(`/login?${qs}`);
    }
    throw err;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
