"use client";

import { useActionState, useTransition } from "react";
import { KeyRound, Plus } from "lucide-react";
import { createEnrollmentToken, revokeEnrollmentToken } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/lib/format";

export type TokenRow = {
  id: string;
  label: string;
  prefix: string;
  autoApprove: boolean;
  uses: number;
  maxUses: number | null;
  revoked: boolean;
  createdAt: string;
};

type TokenState = ActionState & { token?: string };

export function EnrollmentSection({
  tokens,
  publicUrl,
  disabled,
}: {
  tokens: TokenRow[];
  publicUrl: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<TokenState, FormData>(createEnrollmentToken, {});
  const [pending, startTransition] = useTransition();

  const sample = `{
  "serverUrl": "${publicUrl}",
  "enrollmentToken": "${state.token ?? "<enrollment token>"}"
}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enrollment tokens</CardTitle>
        <CardDescription>
          A new box presents one of these once and gets a token of its own back. Only the hash is
          stored, so a token is shown exactly one time.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {state.token ? (
          <div className="flex flex-col gap-2 rounded-md border border-success/40 bg-success/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4" />
              Copy this now — it is not shown again
            </div>
            <code className="block break-all rounded bg-background p-2 font-mono text-xs">
              {state.token}
            </code>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label>Put this on the box at /data/adb/magnemite/config.json</Label>
          <pre className="overflow-x-auto rounded-lg border border-border bg-subtle p-3 font-mono text-xs">
            {sample}
          </pre>
          <p className="text-xs text-muted-foreground">
            Or bake the same file into the Magisk module zip before flashing a batch: see
            scripts/enroll.sh.
          </p>
        </div>

        {tokens.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Auto-approve</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell>
                    <span className={token.revoked ? "text-muted-foreground line-through" : ""}>
                      {token.label}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{token.prefix}…</TableCell>
                  <TableCell className="font-mono text-xs">
                    {token.uses}
                    {token.maxUses ? ` / ${token.maxUses}` : ""}
                  </TableCell>
                  <TableCell>
                    {token.autoApprove ? (
                      <Badge variant="success">yes</Badge>
                    ) : (
                      <Badge variant="outline">manual</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatRelative(token.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {!token.revoked && !disabled ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => startTransition(() => void revokeEnrollmentToken(token.id))}
                      >
                        Revoke
                      </Button>
                    ) : token.revoked ? (
                      <Badge variant="secondary">revoked</Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {!disabled ? (
          <form action={formAction} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="token-label">Label</Label>
              <Input id="token-label" name="label" placeholder="batch-2" className="w-48" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="token-uses">Max uses</Label>
              <Input
                id="token-uses"
                name="maxUses"
                type="number"
                min={1}
                placeholder="unlimited"
                className="w-32"
              />
            </div>
            <div className="flex items-center gap-2 pb-2.5">
              <Checkbox id="token-auto-approve" name="autoApprove" defaultChecked />
              <Label htmlFor="token-auto-approve" className="font-normal">
                Auto-approve devices
              </Label>
            </div>
            <Button type="submit" variant="outline">
              <Plus />
              New token
            </Button>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
