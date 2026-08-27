import type { AgentUpdateState, JobState, RolloutStatus, VersionStatus } from "@magnemite/db";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info";

const JOB_TONE: Record<JobState, Tone> = {
  QUEUED: "outline",
  DISPATCHED: "info",
  DOWNLOADING: "info",
  EXTRACTING: "info",
  INSTALLING: "info",
  VERIFYING: "info",
  SUCCESS: "success",
  FAILED: "danger",
  CANCELLED: "secondary",
  SKIPPED: "secondary",
};

const JOB_LABEL: Record<JobState, string> = {
  QUEUED: "queued",
  DISPATCHED: "dispatched",
  DOWNLOADING: "downloading",
  EXTRACTING: "extracting",
  INSTALLING: "installing",
  VERIFYING: "verifying",
  SUCCESS: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "up to date",
};

export function JobStateBadge({ state }: { state: JobState }) {
  return <Badge variant={JOB_TONE[state]}>{JOB_LABEL[state]}</Badge>;
}

const AGENT_UPDATE_TONE: Record<AgentUpdateState, Tone> = {
  SENT: "info",
  SUCCESS: "success",
  FAILED: "danger",
};

const AGENT_UPDATE_LABEL: Record<AgentUpdateState, string> = {
  SENT: "updating",
  SUCCESS: "done",
  FAILED: "failed",
};

export function AgentUpdateStateBadge({ state }: { state: AgentUpdateState }) {
  return <Badge variant={AGENT_UPDATE_TONE[state]}>{AGENT_UPDATE_LABEL[state]}</Badge>;
}

const ROLLOUT_TONE: Record<RolloutStatus, Tone> = {
  PENDING: "outline",
  CANARY: "info",
  SOAKING: "warning",
  RUNNING: "info",
  PAUSED: "danger",
  COMPLETED: "success",
  CANCELLED: "secondary",
};

const ROLLOUT_LABEL: Record<RolloutStatus, string> = {
  PENDING: "pending",
  CANARY: "canary",
  SOAKING: "soaking",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export function RolloutStatusBadge({ status }: { status: RolloutStatus }) {
  return <Badge variant={ROLLOUT_TONE[status]}>{ROLLOUT_LABEL[status]}</Badge>;
}

const VERSION_TONE: Record<VersionStatus, Tone> = {
  DISCOVERED: "outline",
  CACHING: "info",
  READY: "success",
  FAILED: "danger",
};

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  return <Badge variant={VERSION_TONE[status]}>{status.toLowerCase()}</Badge>;
}

export function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        online ? "bg-success pulse-dot" : "bg-muted-foreground/40",
      )}
      title={online ? "online" : "offline"}
    />
  );
}

/** States where the job is actively working and worth animating. */
export const ACTIVE_JOB_STATES: JobState[] = [
  "DISPATCHED",
  "DOWNLOADING",
  "EXTRACTING",
  "INSTALLING",
  "VERIFYING",
];
