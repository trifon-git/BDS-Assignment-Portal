import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { STATE_LABEL, type DeliveryState } from "@/lib/deadline";
import { cn } from "@/lib/utils";

/**
 * The delivery status chip, used identically on the student dashboard and in
 * the admin delivery matrix so the two never disagree about what a state looks
 * like.
 *
 * Every state carries an icon and a word as well as a colour. A teacher
 * scanning a matrix of thirty rows for red should not be the only way this
 * works — it has to survive being printed in greyscale or read by someone with
 * a colour vision deficiency.
 */

const STYLES: Record<
  DeliveryState,
  { icon: typeof CheckCircle2; className: string }
> = {
  delivered: {
    icon: CheckCircle2,
    className: "bg-status-delivered-bg text-status-delivered",
  },
  approved: {
    icon: CheckCircle2,
    className: "bg-status-delivered-bg text-status-delivered",
  },
  late: {
    icon: AlertTriangle,
    className: "bg-status-late-bg text-status-late",
  },
  missing: {
    icon: XCircle,
    className: "bg-status-missing-bg text-status-missing",
  },
  pending: {
    icon: Clock,
    className: "bg-muted text-muted-foreground",
  },
  rework: {
    icon: RotateCcw,
    className: "bg-status-rework-bg text-status-rework",
  },
};

export function StatusBadge({
  state,
  className,
  size = "default",
}: {
  state: DeliveryState;
  className?: string;
  size?: "default" | "sm";
}) {
  const { icon: Icon, className: tone } = STYLES[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        tone,
        className,
      )}
    >
      <Icon
        className={size === "sm" ? "size-3.5" : "size-4"}
        aria-hidden="true"
      />
      {STATE_LABEL[state]}
    </span>
  );
}
