"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  try {
    // The nextCookies plugin is what lets a server action set the session
    // cookie Better Auth returns here.
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) {
      // Never distinguish "no such account" from "wrong password".
      return { error: "Wrong email or password." };
    }
    throw err;
  }

  redirect("/");
}

export async function logout() {
  await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
  redirect("/login");
}
