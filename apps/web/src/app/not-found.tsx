import Link from "next/link";
import { Magnet, MoveLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// Static on purpose: this renders for any unmatched URL, including ones hit by
// crawlers and by devices with a stale base path, and none of that should cost
// a session lookup or a database round trip.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-subtle text-muted-foreground">
            <Magnet className="h-5 w-5" />
          </div>
          <p className="font-mono text-sm text-muted-foreground">404</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This URL does not match anything in Magnemite. It may have moved, or the link that
            brought you here is gone.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">
              <MoveLeft className="h-4 w-4" />
              Back to the dashboard
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
