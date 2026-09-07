import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { forumMessages, type ForumMessage } from "@/db/schema";

/**
 * Team forum reads.
 *
 * Threading is flattened to one level (see forum-actions.ts), so assembling a
 * tree is one query plus one pass: bucket every reply by its parent, then hand
 * each root its bucket. No N+1, no recursion.
 */

export interface ForumNode {
  message: ForumMessage;
  replies: ForumMessage[];
}

export async function getTeamForum(teamId: number): Promise<ForumNode[]> {
  const rows = await db
    .select()
    .from(forumMessages)
    .where(eq(forumMessages.teamId, teamId))
    .orderBy(asc(forumMessages.createdAt));

  const byParent = new Map<number, ForumMessage[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    const list = byParent.get(row.parentId);
    if (list) list.push(row);
    else byParent.set(row.parentId, [row]);
  }

  return rows
    .filter((row) => row.parentId == null)
    .map((message) => ({
      message,
      replies: byParent.get(message.id) ?? [],
    }));
}

/** Non-deleted message counts per team, for the admin teams list. */
export async function getForumCounts(
  teamIds: number[],
): Promise<Map<number, number>> {
  if (teamIds.length === 0) return new Map();

  const rows = await db
    .select({ teamId: forumMessages.teamId, id: forumMessages.id })
    .from(forumMessages)
    .where(
      and(
        inArray(forumMessages.teamId, teamIds),
        isNull(forumMessages.deletedAt),
      ),
    );

  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.teamId, (counts.get(row.teamId) ?? 0) + 1);
  }
  return counts;
}
