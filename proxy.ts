import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isOpenAccess } from "@/lib/auth/mode";

// ACCESS_MODE=open (default): no login, every request passes.
// ACCESS_MODE=google: optimistic gate — unauthenticated requests go to /login (pages) or get 401 (API).
// In google mode, layouts, pages and data modules also re-verify the session server-side (lib/auth/guard.ts).

const gated = auth((req) => {
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
}) as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response> | Response;

export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (isOpenAccess()) {
    if (req.nextUrl.pathname === "/login") return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    return NextResponse.next();
  }
  return gated(req, ev);
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
