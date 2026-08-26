import { redirect } from "next/navigation";
import { Magnet } from "lucide-react";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

// This page reads the session cookie, so it can never be prerendered — and
// trying to would build the auth instance at image-build time, where
// AUTH_SECRET does not exist.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Magnet className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Magnemite</h1>
          <p className="mt-1 text-sm text-muted-foreground">Android TV fleet updater</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
