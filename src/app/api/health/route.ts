import { NextResponse } from "next/server";

import { sqlite } from "@/db";

/**
 * Liveness probe for the container healthcheck and for the university's
 * monitoring. Touches the database so a healthy response means the app can
 * actually serve a request, not just that the process is alive.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    sqlite.prepare("select 1").get();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
