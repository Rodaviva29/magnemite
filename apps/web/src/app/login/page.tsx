import { redirect } from "next/navigation";
import { Magnet } from "lucide-react";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

// This page reads the session cookie, so it can never be prerendered — and
// trying to would build the auth instance at image-build time, where
// AUTH_SECRET does not exist.
export const dynamic = "force-dynamic";

/**
 * The scattered magnets behind the form.
 *
 * Fixed coordinates rather than `Math.random()`: this renders on the server
 * first, and a random layout would differ on the client and trip a hydration
 * mismatch — for decoration that nobody would ever notice was random.
 */
const MAGNETS = [
  { top: 8, left: 6, size: 44, rotate: -18 },
  { top: 16, left: 78, size: 64, rotate: 24 },
  { top: 26, left: 22, size: 28, rotate: 40 },
  { top: 34, left: 90, size: 36, rotate: -8 },
  { top: 44, left: 12, size: 56, rotate: 12 },
  { top: 52, left: 68, size: 30, rotate: -34 },
  { top: 62, left: 32, size: 40, rotate: 8 },
  { top: 70, left: 84, size: 48, rotate: -22 },
  { top: 78, left: 16, size: 32, rotate: 30 },
  { top: 86, left: 58, size: 52, rotate: -12 },
  { top: 12, left: 44, size: 34, rotate: 16 },
  { top: 92, left: 36, size: 26, rotate: -40 },
  { top: 4, left: 62, size: 30, rotate: 6 },
  { top: 58, left: 4, size: 26, rotate: -28 },
  { top: 40, left: 52, size: 30, rotate: 34 },
  { top: 24, left: 60, size: 24, rotate: -6 },
];

function MagnetField() {
  return (
    <div
      aria-hidden
      // Masked towards the middle so the field thins out behind the card and
      // never competes with the form for attention.
      className="pointer-events-none absolute inset-0 overflow-hidden mask-[radial-gradient(ellipse_at_center,transparent_25%,black_75%)]"
    >
      {MAGNETS.map((magnet, i) => (
        <Magnet
          key={i}
          className="absolute text-foreground/6"
          style={{
            top: `${magnet.top}%`,
            left: `${magnet.left}%`,
            width: magnet.size,
            height: magnet.size,
            transform: `rotate(${magnet.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <MagnetField />

      {/* A single warm glow behind the card, so the middle of the page is not
          flat grey once the magnets fade out there. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-128 w-128 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src="/magnemite-256.png"
            alt=""
            width={96}
            height={96}
            className="mb-4 h-24 w-24 rounded-2xl shadow-lg shadow-black/20"
          />
          <h1 className="font-display text-2xl font-semibold tracking-tight">Magnemite</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gotta magnet ’em all.</p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
