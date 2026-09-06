import { and, desc, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { auditEvents, organizationMembers, projects } from '@/db/schema';

export const dynamic = 'force-dynamic';

async function resolveOrganization(userId: string) {
  const db = getDb();
  const [membership] = await db
    .select({ organizationId: organizationMembers.organizationId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);
  return membership ?? null;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Autenticação necessária.' }, { status: 401 });
  const membership = await resolveOrganization(user.userId);
  if (!membership) return Response.json({ error: 'Usuário sem organização.' }, { status: 403 });

  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.organizationId, membership.organizationId))
    .orderBy(desc(projects.updatedAt));
  return Response.json({ projects: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Autenticação necessária.' }, { status: 401 });
  const membership = await resolveOrganization(user.userId);
  if (!membership || !['owner', 'admin', 'manager', 'member'].includes(membership.role)) {
    return Response.json({ error: 'Sem permissão para criar projetos.' }, { status: 403 });
  }

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const type = typeof input?.type === 'string' ? input.type.trim() : '';
  const code = typeof input?.code === 'string' ? input.code.trim().toUpperCase() : '';
  if (!name || !type || !code || name.length > 120 || code.length > 24) {
    return Response.json({ error: 'Nome, tipo e código válidos são obrigatórios.' }, { status: 400 });
  }

  const now = new Date();
  const id = crypto.randomUUID();
  const db = getDb();
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.organizationId, membership.organizationId), eq(projects.code, code)))
    .limit(1);
  if (existing) return Response.json({ error: 'Já existe um projeto com este código.' }, { status: 409 });

  await db.batch([
    db.insert(projects).values({ id, organizationId: membership.organizationId, name, type, code, createdAt: now, updatedAt: now }),
    db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorUserId: user.userId, action: 'project.created', entityType: 'project', entityId: id, createdAt: now }),
  ]);
  return Response.json({ id, name, code, status: 'active' }, { status: 201 });
}
