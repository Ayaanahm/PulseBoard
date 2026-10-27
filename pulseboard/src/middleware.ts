import { NextResponse, type NextRequest } from "next/server";

// Edge-cheap gate: bounce anonymous users early. Real authz (membership + RBAC)
// happens server-side in requireTenant()/apiTenant() on every request.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.includes("authjs.session-token"));
  if (!hasSession) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
}
export const config = { matcher: ["/t/:path*"] };
