import { auth } from "@/lib/auth";

// Better Auth's own endpoints: sign in, sign out, session, and anything a
// future plugin adds.
//
// Written as wrappers rather than `toNextJsHandler(auth)` so nothing touches
// the auth instance until a request arrives — `next build` evaluates this
// module, and building the instance there would need AUTH_SECRET at
// image-build time.
export async function GET(request: Request) {
  return auth.handler(request);
}

export async function POST(request: Request) {
  return auth.handler(request);
}
