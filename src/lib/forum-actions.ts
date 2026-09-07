"use server";

/**
 * Team forum writes.
 *
 * **Not a security boundary.** The only real check below is `assertMembership`
 * — it confirms the claimed author is on the team the token unlocks, nothing
 * more. Anyone holding a team's link can already see every member's name, so
 * they can post, edit, or delete as any one of them; "remember my name" in the
 * browser is a convenience for an honest student, not an identity check. Do
 * not read the `authorStudentId`/ownership checks here as authorization —
 * they stop a UI accident, not a determined teammate. Real accountability is
 * the audit log (actor name + IP on every write) and `regenerateTeamLink` to
 * rotate a leaked link.
 */

import { and, eq, gt, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { forumMessages } from "@/db/schema";
import { recordAudit } from "./auth";
import { assertMembership, getTeamByToken } from "./team-access";

const MAX_BODY_LENGTH = 4000;
const DUPLICATE_WINDOW_MS = 60_000;
const MAX_MESSAGES_PER_TEAM = 500;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => Number(form.get(key));

const back = (token: string, message: string) =>
  redirect(`/t/${token}?forumError=${encodeURIComponent(message)}#forum`);

export async function postMessage(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const ctx = await getTeamByToken(token);
  if (!ctx) notFound();

  const studentId = num(formData, "authorStudentId");
  const member = ctx.members.find((m) => m.id === studentId);
  if (!member || !(await assertMembership(ctx.team.id, studentId))) {
    back(token, "Pick your name from the list before posting.");
  }

  const body = str(formData, "body").slice(0, MAX_BODY_LENGTH);
  if (!body) back(token, "Write something before sending.");

  // A reply to a reply is flattened onto the top-level message it replies to
  // — one level deep is all the UI needs, and it keeps every query a single
  // pass with no recursion.
  const rawParentId = num(formData, "parentId");
  let parentId: number | null = null;
  if (Number.isInteger(rawParentId)) {
    const parent = await db.query.forumMessages.findFirst({
      where: and(
        eq(forumMessages.id, rawParentId),
        eq(forumMessages.teamId, ctx.team.id),
      ),
    });
    if (parent) parentId = parent.parentId ?? parent.id;
  }

  const recentDuplicate = await db.query.forumMessages.findFirst({
    where: and(
      eq(forumMessages.teamId, ctx.team.id),
      eq(forumMessages.authorStudentId, studentId),
      eq(forumMessages.body, body),
      gt(forumMessages.createdAt, Date.now() - DUPLICATE_WINDOW_MS),
    ),
  });
  if (recentDuplicate) {
    back(token, "That looks like the message you just sent.");
  }

  const countRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(forumMessages)
    .where(eq(forumMessages.teamId, ctx.team.id))
    .get();
  if (Number(countRow?.n ?? 0) >= MAX_MESSAGES_PER_TEAM) {
    back(
      token,
      "This team's board is full. Ask your course responsible for help.",
    );
  }

  await db.insert(forumMessages).values({
    teamId: ctx.team.id,
    parentId,
    authorStudentId: studentId,
    authorName: member!.name,
    body,
  });

  await recordAudit({
    action: "forum.posted",
    actorName: member!.name,
    teamId: ctx.team.id,
    detail: parentId ? "reply" : "new thread",
  });

  redirect(`/t/${token}#forum`);
}

export async function editMessage(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const ctx = await getTeamByToken(token);
  if (!ctx) notFound();

  const messageId = num(formData, "messageId");
  const message = await db.query.forumMessages.findFirst({
    where: and(eq(forumMessages.id, messageId), eq(forumMessages.teamId, ctx.team.id)),
  });
  if (!message || message.deletedAt) notFound();

  const body = str(formData, "body").slice(0, MAX_BODY_LENGTH);
  if (!body) back(token, "A message can't be edited down to nothing.");

  await db
    .update(forumMessages)
    .set({ body, editedAt: Date.now() })
    .where(eq(forumMessages.id, messageId));

  await recordAudit({
    action: "forum.edited",
    actorName: message.authorName,
    teamId: ctx.team.id,
  });

  redirect(`/t/${token}#forum`);
}

export async function deleteMessage(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const ctx = await getTeamByToken(token);
  if (!ctx) notFound();

  const messageId = num(formData, "messageId");
  const message = await db.query.forumMessages.findFirst({
    where: and(eq(forumMessages.id, messageId), eq(forumMessages.teamId, ctx.team.id)),
  });
  if (!message || message.deletedAt) notFound();

  await db
    .update(forumMessages)
    .set({ deletedAt: Date.now() })
    .where(eq(forumMessages.id, messageId));

  await recordAudit({
    action: "forum.deleted",
    actorName: message.authorName,
    teamId: ctx.team.id,
  });

  redirect(`/t/${token}#forum`);
}
