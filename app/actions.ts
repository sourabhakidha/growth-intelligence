"use server";

import { signIn, signOut } from "@/auth";

export async function signInWithGoogle(formData: FormData) {
  const next = String(formData.get("next") ?? "/");
  // Only allow same-site relative paths as the post-login destination.
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  await signIn("google", { redirectTo: safe });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
