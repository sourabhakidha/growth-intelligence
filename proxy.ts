import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Optimistic gate: unauthenticated requests are redirected to /login (pages) or get 401 (API).
// This is NOT the only check — layouts, pages, data modules and route handlers re-verify the session
// server-side (lib/auth/guard.ts), as the Next.js docs recommend.

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");
  if (isPublic) return NextResponse.next();

  if (!req.auth?.user?.email) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
