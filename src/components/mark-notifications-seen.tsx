"use client";

import { useEffect } from "react";

import { markNotificationsSeen } from "@/lib/admin-actions";

/**
 * Fires once, after the overview has painted, to clear the notification
 * badge. Not wired into the page's own render — see the comment on
 * `markNotificationsSeen` in admin-actions.ts for why.
 */
export function MarkNotificationsSeen() {
  useEffect(() => {
    void markNotificationsSeen();
  }, []);

  return null;
}
