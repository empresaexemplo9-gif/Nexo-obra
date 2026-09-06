import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { projects } from "@/db/schema";

const createProjectSchema = z.object({
  clientId: z.string().min(1).nullable().optional(),
  code: z.string().trim().min(2).max(24),
  name: z.string().trim().min(3).max(160),
  kind: z.enum(["project", "work"]),
  phase: z.string().trim().min(2).max(80).default("briefing"),
  ownerMemberId: z.string().min(1).nullable().optional(),
  startDate: z.string().date().nullable().optional(),
  targetDate: z.string().date().nullable().optional(),
  budgetCents: z.number().int().nonnegative().default(0),
});

function organizationId(request: Request) {
  return request.headers.get("x-organization-id")?.trim() ?? "";
}

export async function GET(request: Request) {
  const orgId = organizationId(request);
  if (!orgId) {
    return Response.json({ error: "Missing organization context" }, { status: 401 });
  }

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(desc(projects.updatedAt))
      .limit(100);
    return Response.json({ projects: rows });
  } catch {
    return Response.json({ error: "Projects are temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const orgId = organizationId(request);
  if (!orgId) {
    return Response.json({ error: "Missing organization context" }, { status: 401 });
  }

  const parsed = createProjectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid project", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const [project] = await db.insert(projects).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      ...parsed.data,
    }).returning();
    return Response.json({ project }, { status: 201 });
  } catch {
    return Response.json({ error: "Project could not be created" }, { status: 503 });
  }
}
