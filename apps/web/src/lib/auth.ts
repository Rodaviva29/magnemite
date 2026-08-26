import "server-only";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@magnemite/db";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Better Auth, wired to the same Postgres the rest of the app uses.
 *
 * Two deliberate choices:
 *
 *  - Sign-up is disabled. This is an internal tool for a known set of
 *    operators; accounts are created from Settings by an admin, never by
 *    whoever finds the login page.
 *  - Passwords are hashed with bcrypt rather than Better Auth's default
 *    scrypt, so `pnpm db:seed` can create the first admin without pulling
 *    Better Auth into the database package.
 */
function createAuth() {
  return betterAuth({
    appName: "Magnemite",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: required("AUTH_SECRET"),
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.MAGNEMITE_DASHBOARD_URL,
    trustedOrigins: [process.env.BETTER_AUTH_URL, process.env.MAGNEMITE_DASHBOARD_URL].filter(
      (v): v is string => Boolean(v),
    ),

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      password: {
        hash: (password) => bcrypt.hash(password, 12),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Reading the session on every server render would otherwise be a query
      // per request; the dashboard renders a lot of them.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "VIEWER",
          // Never settable through the auth API — role changes go through the
          // Settings page, which checks the caller is an admin.
          input: false,
        },
      },
    },

    // Must stay last: it is what lets a server action set the session cookie.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Built on first use rather than at import.
 *
 * `next build` evaluates route modules to collect page data, and constructing
 * Better Auth there would demand AUTH_SECRET at image-build time — a secret
 * that only exists at run time. The proxy keeps every call site written as
 * plain `auth.api.…` while deferring construction to the first request.
 */
let instance: Auth | null = null;

export const auth = new Proxy({} as Auth, {
  get(_target, property, receiver) {
    instance ??= createAuth();
    return Reflect.get(instance, property, receiver);
  },
});
