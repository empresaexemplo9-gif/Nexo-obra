import { z } from "zod";

import { podeAdministrarEmpresa } from "@/lib/permissions";
import { ApiError, auditStatement, type OrganizationContext } from "@/lib/server/backend";
import { fileResponse, purgeIfOrphan, requireReadableFile, type OrgFileRow } from "@/lib/server/org-files";

// Comunicação interna de cada empresa: canais abertos a todos os membros, conversas
// diretas entre duas pessoas, lembretes e anexos no formato original.
//
// Tudo filtra a empresa da sessão. Conversa direta só é visível a quem participa dela;
// para quem não participa, responde como inexistente.

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_ATTACHMENTS = 10;
const PAGE = 60;
// O cursor de atualização volta alguns segundos: uma mensagem gravada durante a leitura
// anterior chega na seguinte, e o navegador descarta a repetida pelo id.
const CURSOR_OVERLAP_MS = 5000;

type ChannelRow = { id: string; kind: "canal" | "direta"; key: string; name: string | null; created_by_member_id: string; created_at: string; last_message_at: string | null };

type MessageRow = {
  id: string; channel_id: string; author_member_id: string; author_name: string; client_key: string; body: string; kind: string;
  created_at: string; edited_at: string | null; deleted_at: string | null;
  reminder_id: string | null; reminder_text: string | null; reminder_due_day: string | null; reminder_target_member_id: string | null;
  reminder_target_name: string | null; reminder_done_at: string | null; reminder_done_by_name: string | null; reminder_created_by_member_id: string | null;
};

const now = () => new Date().toISOString();

export const channelSchema = z.object({ name: z.string().trim().min(2, "Dê um nome ao canal.").max(60) }).strict();
export const directSchema = z.object({ memberId: z.string().trim().min(1).max(120) }).strict();
export const messageSchema = z.object({
  clientKey: z.string().trim().min(8).max(80),
  body: z.string().max(MAX_MESSAGE_CHARS, `A mensagem pode ter até ${MAX_MESSAGE_CHARS} caracteres.`).default(""),
  fileIds: z.array(z.string().trim().min(1).max(80)).max(MAX_ATTACHMENTS, `Envie até ${MAX_ATTACHMENTS} arquivos por mensagem.`).default([]),
  reminder: z.object({
    text: z.string().trim().min(2, "Descreva o lembrete.").max(300),
    dueDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do lembrete."),
    targetMemberId: z.string().trim().min(1).max(120).nullable().optional(),
  }).strict().optional(),
}).strict();
export const editSchema = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }).strict();

function slug(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "canal";
}

function validDay(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Todo membro chega a uma empresa que já tem o canal Geral. */
export async function ensureGeneralChannel(context: OrganizationContext) {
  await context.db.prepare(
    `INSERT INTO chat_channels (id, organization_id, kind, key, name, created_by_member_id, created_at)
     VALUES (?1, ?2, 'canal', 'canal:geral', 'Geral', ?3, ?4) ON CONFLICT(organization_id, key) DO NOTHING`,
  ).bind(crypto.randomUUID(), context.organization.id, context.member.id, now()).run();
}

async function activeMembers(context: OrganizationContext) {
  const rows = await context.db.prepare(
    "SELECT id, name FROM members WHERE organization_id = ?1 AND active = 1 ORDER BY name COLLATE NOCASE LIMIT 500",
  ).bind(context.organization.id).all<{ id: string; name: string }>();
  return rows.results;
}

export async function listConversations(context: OrganizationContext) {
  await ensureGeneralChannel(context);
  const me = context.member.id;
  const rows = await context.db.prepare(
    `SELECT c.id, c.kind, c.name, c.created_at, c.last_message_at, c.created_by_member_id, mine.last_read_at,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.organization_id = c.organization_id AND m.channel_id = c.id
          AND m.deleted_at IS NULL AND m.author_member_id != ?2
          AND (mine.last_read_at IS NULL OR m.created_at > mine.last_read_at)) AS unread,
       (SELECT other.member_id FROM chat_participants other WHERE other.channel_id = c.id AND other.member_id != ?2 AND other.is_member = 1 LIMIT 1) AS other_member_id,
       (SELECT m.body FROM chat_messages m WHERE m.organization_id = c.organization_id AND m.channel_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_body,
       (SELECT m.author_name FROM chat_messages m WHERE m.organization_id = c.organization_id AND m.channel_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_author
     FROM chat_channels c
     LEFT JOIN chat_participants mine ON mine.channel_id = c.id AND mine.member_id = ?2
     WHERE c.organization_id = ?1 AND (c.kind = 'canal' OR mine.is_member = 1)
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 200`,
  ).bind(context.organization.id, me).all<{
    id: string; kind: "canal" | "direta"; name: string | null; created_at: string; last_message_at: string | null; created_by_member_id: string;
    last_read_at: string | null; unread: number; other_member_id: string | null; last_body: string | null; last_author: string | null;
  }>();
  const members = await activeMembers(context);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const conversations = rows.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.kind === "canal" ? row.name ?? "Canal" : names.get(row.other_member_id ?? "") ?? "Pessoa removida",
    otherMemberId: row.kind === "direta" ? row.other_member_id : null,
    lastMessageAt: row.last_message_at,
    lastPreview: row.last_body === null ? null : `${row.last_author ?? ""}: ${row.last_body || "Arquivo"}`.slice(0, 140),
    unread: Number(row.unread ?? 0),
    canDelete: row.kind === "canal" && row.name !== "Geral" && (row.created_by_member_id === me || podeAdministrarEmpresa(context.member.role)),
  }));
  return {
    me,
    conversations,
    members: members.filter((member) => member.id !== me),
    unreadTotal: conversations.reduce((sum, item) => sum + item.unread, 0),
  };
}

export async function createChannel(context: OrganizationContext, name: string) {
  const key = `canal:${slug(name)}`;
  const id = crypto.randomUUID();
  const inserted = await context.db.prepare(
    `INSERT INTO chat_channels (id, organization_id, kind, key, name, created_by_member_id, created_at)
     VALUES (?1, ?2, 'canal', ?3, ?4, ?5, ?6) ON CONFLICT(organization_id, key) DO NOTHING`,
  ).bind(id, context.organization.id, key, name.trim(), context.member.id, now()).run();
  if (!Number(inserted.meta?.changes ?? 0)) throw new ApiError(409, "channel_exists", "Já existe um canal com esse nome.");
  await auditStatement(context, "chat.channel_created", "chat_channel", id, { name: name.trim() }).run();
  return id;
}

/** Abre (ou reabre) a conversa direta com outra pessoa da mesma empresa. */
export async function openDirect(context: OrganizationContext, memberId: string) {
  if (memberId === context.member.id) throw new ApiError(400, "invalid_member", "Escolha outra pessoa.");
  const target = await context.db.prepare("SELECT id FROM members WHERE id = ?1 AND organization_id = ?2 AND active = 1")
    .bind(memberId, context.organization.id).first<{ id: string }>();
  if (!target) throw new ApiError(404, "member_not_found", "Pessoa não encontrada nesta empresa.");
  const key = `direta:${[context.member.id, memberId].sort().join(":")}`;
  await context.db.prepare(
    `INSERT INTO chat_channels (id, organization_id, kind, key, name, created_by_member_id, created_at)
     VALUES (?1, ?2, 'direta', ?3, NULL, ?4, ?5) ON CONFLICT(organization_id, key) DO NOTHING`,
  ).bind(crypto.randomUUID(), context.organization.id, key, context.member.id, now()).run();
  const channel = await context.db.prepare("SELECT id FROM chat_channels WHERE organization_id = ?1 AND key = ?2")
    .bind(context.organization.id, key).first<{ id: string }>();
  for (const participant of [context.member.id, memberId]) {
    await context.db.prepare(
      `INSERT INTO chat_participants (id, channel_id, organization_id, member_id, is_member) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(channel_id, member_id) DO UPDATE SET is_member = 1`,
    ).bind(crypto.randomUUID(), channel!.id, context.organization.id, participant).run();
  }
  return channel!.id;
}

export async function requireChannel(context: OrganizationContext, channelId: string) {
  const channel = await context.db.prepare(
    `SELECT c.id, c.kind, c.key, c.name, c.created_by_member_id, c.created_at, c.last_message_at FROM chat_channels c
     LEFT JOIN chat_participants mine ON mine.channel_id = c.id AND mine.member_id = ?3 AND mine.is_member = 1
     WHERE c.id = ?1 AND c.organization_id = ?2 AND (c.kind = 'canal' OR mine.id IS NOT NULL)`,
  ).bind(channelId, context.organization.id, context.member.id).first<ChannelRow>();
  if (!channel) throw new ApiError(404, "channel_not_found", "Conversa não encontrada.");
  return channel;
}

async function markRead(context: OrganizationContext, channelId: string, at: string) {
  await context.db.prepare(
    `INSERT INTO chat_participants (id, channel_id, organization_id, member_id, is_member, last_read_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)
     ON CONFLICT(channel_id, member_id) DO UPDATE SET last_read_at = MAX(COALESCE(last_read_at, ''), excluded.last_read_at)`,
  ).bind(crypto.randomUUID(), channelId, context.organization.id, context.member.id, at).run();
}

const messageSelect = `SELECT m.id, m.channel_id, m.author_member_id, m.author_name, m.client_key, m.body, m.kind, m.created_at, m.edited_at, m.deleted_at,
  r.id AS reminder_id, r.text AS reminder_text, r.due_day AS reminder_due_day, r.target_member_id AS reminder_target_member_id,
  tm.name AS reminder_target_name, r.done_at AS reminder_done_at, r.done_by_name AS reminder_done_by_name, r.created_by_member_id AS reminder_created_by_member_id
  FROM chat_messages m
  LEFT JOIN chat_reminders r ON r.message_id = m.id AND r.organization_id = m.organization_id
  LEFT JOIN members tm ON tm.id = r.target_member_id AND tm.organization_id = m.organization_id`;

async function withAttachments(context: OrganizationContext, rows: MessageRow[]) {
  const ids = rows.filter((row) => !row.deleted_at).map((row) => row.id);
  const attachments = new Map<string, ReturnType<typeof fileResponse>[]>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const slice = ids.slice(offset, offset + 50);
    const marks = slice.map((_, index) => `?${index + 2}`).join(",");
    const files = await context.db.prepare(
      `SELECT mf.message_id, mf.position, f.id, f.organization_id, f.project_id, NULL AS project_name, NULL AS project_code, f.name, f.extension,
         f.mime_type, f.size_bytes, f.chunk_size, f.chunk_count, f.status, f.in_library, f.source_file_id, f.conversion,
         f.uploaded_by_member_id, f.uploaded_by_name, f.created_at, f.ready_at
       FROM chat_message_files mf INNER JOIN org_files f ON f.id = mf.file_id AND f.organization_id = mf.organization_id
       WHERE mf.organization_id = ?1 AND mf.message_id IN (${marks}) ORDER BY mf.position`,
    ).bind(context.organization.id, ...slice).all<OrgFileRow & { message_id: string }>();
    for (const file of files.results) {
      const list = attachments.get(file.message_id) ?? [];
      list.push(fileResponse(file));
      attachments.set(file.message_id, list);
    }
  }
  const me = context.member.id;
  const admin = podeAdministrarEmpresa(context.member.role);
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    authorMemberId: row.author_member_id,
    authorName: row.author_name,
    clientKey: row.author_member_id === me ? row.client_key : null,
    body: row.deleted_at ? "" : row.body,
    kind: row.kind,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted: Boolean(row.deleted_at),
    mine: row.author_member_id === me,
    canEdit: row.author_member_id === me && !row.deleted_at && row.kind === "mensagem",
    canDelete: !row.deleted_at && (row.author_member_id === me || admin),
    files: row.deleted_at ? [] : attachments.get(row.id) ?? [],
    reminder: row.reminder_id && !row.deleted_at ? {
      id: row.reminder_id, text: row.reminder_text!, dueDay: row.reminder_due_day!, targetMemberId: row.reminder_target_member_id,
      targetName: row.reminder_target_member_id ? row.reminder_target_name ?? "Pessoa removida" : null,
      doneAt: row.reminder_done_at, doneByName: row.reminder_done_by_name,
      canComplete: !row.reminder_target_member_id || row.reminder_target_member_id === me || row.reminder_created_by_member_id === me,
    } : null,
  }));
}

export type ChatMessage = Awaited<ReturnType<typeof withAttachments>>[number];

/**
 * Sem `since`: a página mais recente (ou a anterior a `before`). Com `since`: tudo que foi
 * criado, editado, apagado ou teve lembrete concluído depois do cursor.
 */
export async function listMessages(context: OrganizationContext, channelId: string, options: { since?: string | null; before?: string | null }) {
  await requireChannel(context, channelId);
  const serverTime = now();
  let rows: MessageRow[];
  if (options.since) {
    const result = await context.db.prepare(
      `${messageSelect} WHERE m.organization_id = ?1 AND m.channel_id = ?2
       AND (m.created_at > ?3 OR m.edited_at > ?3 OR m.deleted_at > ?3 OR r.done_at > ?3)
       ORDER BY m.created_at, m.id LIMIT 500`,
    ).bind(context.organization.id, channelId, options.since).all<MessageRow>();
    rows = result.results;
  } else {
    const result = await context.db.prepare(
      `${messageSelect} WHERE m.organization_id = ?1 AND m.channel_id = ?2 AND (?3 IS NULL OR m.created_at < ?3)
       ORDER BY m.created_at DESC, m.id DESC LIMIT ${PAGE + 1}`,
    ).bind(context.organization.id, channelId, options.before ?? null).all<MessageRow>();
    rows = result.results.slice(0, PAGE).reverse();
    const more = result.results.length > PAGE;
    await markRead(context, channelId, serverTime);
    return { messages: await withAttachments(context, rows), cursor: cursorFrom(serverTime), hasMore: more };
  }
  await markRead(context, channelId, serverTime);
  return { messages: await withAttachments(context, rows), cursor: cursorFrom(serverTime), hasMore: false };
}

function cursorFrom(serverTime: string) {
  return new Date(new Date(serverTime).getTime() - CURSOR_OVERLAP_MS).toISOString();
}

export async function postMessage(context: OrganizationContext, channelId: string, input: z.infer<typeof messageSchema>) {
  const channel = await requireChannel(context, channelId);
  const body = input.body.trim();
  const fileIds = [...new Set(input.fileIds)];
  if (!body && !fileIds.length && !input.reminder) throw new ApiError(400, "empty_message", "Escreva uma mensagem ou anexe um arquivo.");

  // Reenvio depois de falha de rede: a mesma chave devolve a mensagem já gravada.
  const repeated = await context.db.prepare(
    `${messageSelect} WHERE m.organization_id = ?1 AND m.author_member_id = ?2 AND m.client_key = ?3`,
  ).bind(context.organization.id, context.member.id, input.clientKey).first<MessageRow>();
  if (repeated) {
    if (repeated.channel_id !== channelId) throw new ApiError(409, "client_key_reused", "Chave de envio repetida em outra conversa.");
    return { message: (await withAttachments(context, [repeated]))[0], created: false };
  }

  for (const fileId of fileIds) {
    const file = await requireReadableFile(context, fileId);
    if (file.status !== "ready") throw new ApiError(409, "upload_incomplete", `O envio de “${file.name}” ainda não terminou.`);
  }

  let reminder: { text: string; dueDay: string; target: string | null } | null = null;
  if (input.reminder) {
    if (!validDay(input.reminder.dueDay)) throw new ApiError(400, "invalid_day", "Data do lembrete inválida.");
    const target = input.reminder.targetMemberId ?? null;
    if (target) {
      const member = await context.db.prepare("SELECT id FROM members WHERE id = ?1 AND organization_id = ?2 AND active = 1")
        .bind(target, context.organization.id).first();
      if (!member) throw new ApiError(404, "member_not_found", "Pessoa não encontrada nesta empresa.");
      if (channel.kind === "direta") {
        const participant = await context.db.prepare("SELECT 1 AS ok FROM chat_participants WHERE channel_id = ?1 AND member_id = ?2 AND is_member = 1")
          .bind(channelId, target).first();
        if (!participant) throw new ApiError(400, "invalid_member", "O lembrete só pode ser para quem participa desta conversa.");
      }
    }
    reminder = { text: input.reminder.text, dueDay: input.reminder.dueDay, target };
  }

  const id = crypto.randomUUID();
  const createdAt = now();
  const statements = [
    context.db.prepare(
      `INSERT INTO chat_messages (id, organization_id, channel_id, author_member_id, author_name, client_key, body, kind, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(id, context.organization.id, channelId, context.member.id, context.user.displayName, input.clientKey,
      reminder ? reminder.text : body, reminder ? "lembrete" : "mensagem", createdAt),
    ...fileIds.map((fileId, position) => context.db.prepare(
      "INSERT INTO chat_message_files (id, message_id, organization_id, file_id, position) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(crypto.randomUUID(), id, context.organization.id, fileId, position)),
    context.db.prepare("UPDATE chat_channels SET last_message_at = ?3 WHERE id = ?1 AND organization_id = ?2")
      .bind(channelId, context.organization.id, createdAt),
  ];
  if (reminder) {
    statements.push(context.db.prepare(
      `INSERT INTO chat_reminders (id, organization_id, channel_id, message_id, created_by_member_id, created_by_name, target_member_id, text, due_day, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(crypto.randomUUID(), context.organization.id, channelId, id, context.member.id, context.user.displayName,
      reminder.target, reminder.text, reminder.dueDay, createdAt));
  }
  try {
    await context.db.batch(statements);
  } catch (error) {
    // Duas abas enviando a mesma mensagem ao mesmo tempo: a segunda cai no índice único.
    const again = await context.db.prepare(`${messageSelect} WHERE m.organization_id = ?1 AND m.author_member_id = ?2 AND m.client_key = ?3`)
      .bind(context.organization.id, context.member.id, input.clientKey).first<MessageRow>();
    if (again) return { message: (await withAttachments(context, [again]))[0], created: false };
    throw error;
  }
  await markRead(context, channelId, createdAt);
  const row = await context.db.prepare(`${messageSelect} WHERE m.id = ?1 AND m.organization_id = ?2`).bind(id, context.organization.id).first<MessageRow>();
  return { message: (await withAttachments(context, [row!]))[0], created: true };
}

async function ownedMessage(context: OrganizationContext, messageId: string) {
  const row = await context.db.prepare(
    "SELECT id, channel_id, author_member_id, kind, deleted_at FROM chat_messages WHERE id = ?1 AND organization_id = ?2",
  ).bind(messageId, context.organization.id).first<{ id: string; channel_id: string; author_member_id: string; kind: string; deleted_at: string | null }>();
  if (!row) throw new ApiError(404, "message_not_found", "Mensagem não encontrada.");
  await requireChannel(context, row.channel_id);
  return row;
}

export async function editMessage(context: OrganizationContext, messageId: string, body: string) {
  const row = await ownedMessage(context, messageId);
  if (row.author_member_id !== context.member.id || row.deleted_at || row.kind !== "mensagem") {
    throw new ApiError(403, "message_edit_denied", "Só quem escreveu pode editar a mensagem.");
  }
  await context.db.prepare("UPDATE chat_messages SET body = ?3, edited_at = ?4 WHERE id = ?1 AND organization_id = ?2")
    .bind(messageId, context.organization.id, body, now()).run();
}

/** Apaga texto, anexos e lembrete. Quem administra a empresa também pode apagar. */
export async function deleteMessage(context: OrganizationContext, messageId: string) {
  const row = await ownedMessage(context, messageId);
  if (row.deleted_at) return;
  const own = row.author_member_id === context.member.id;
  if (!own && !podeAdministrarEmpresa(context.member.role)) throw new ApiError(403, "message_delete_denied", "Só quem escreveu ou quem administra a empresa pode apagar.");
  const files = await context.db.prepare("SELECT file_id FROM chat_message_files WHERE message_id = ?1 AND organization_id = ?2")
    .bind(messageId, context.organization.id).all<{ file_id: string }>();
  const statements = [
    context.db.prepare("DELETE FROM chat_message_files WHERE message_id = ?1 AND organization_id = ?2").bind(messageId, context.organization.id),
    context.db.prepare("DELETE FROM chat_reminders WHERE message_id = ?1 AND organization_id = ?2").bind(messageId, context.organization.id),
    context.db.prepare("UPDATE chat_messages SET body = '', deleted_at = ?3 WHERE id = ?1 AND organization_id = ?2").bind(messageId, context.organization.id, now()),
  ];
  if (!own) statements.push(auditStatement(context, "chat.message_removed", "chat_message", messageId, { authorMemberId: row.author_member_id }));
  await context.db.batch(statements);
  for (const file of files.results) await purgeIfOrphan(context, file.file_id);
}

export async function deleteChannel(context: OrganizationContext, channelId: string) {
  const channel = await requireChannel(context, channelId);
  if (channel.kind !== "canal" || channel.key === "canal:geral") throw new ApiError(400, "channel_protected", "Este canal não pode ser excluído.");
  if (channel.created_by_member_id !== context.member.id && !podeAdministrarEmpresa(context.member.role)) {
    throw new ApiError(403, "channel_delete_denied", "Só quem criou o canal ou quem administra a empresa pode excluí-lo.");
  }
  const files = await context.db.prepare("SELECT DISTINCT mf.file_id FROM chat_message_files mf INNER JOIN chat_messages m ON m.id = mf.message_id WHERE m.channel_id = ?1 AND mf.organization_id = ?2")
    .bind(channelId, context.organization.id).all<{ file_id: string }>();
  const org = context.organization.id;
  await context.db.batch([
    context.db.prepare("DELETE FROM chat_message_files WHERE organization_id = ?2 AND message_id IN (SELECT id FROM chat_messages WHERE channel_id = ?1 AND organization_id = ?2)").bind(channelId, org),
    context.db.prepare("DELETE FROM chat_reminders WHERE channel_id = ?1 AND organization_id = ?2").bind(channelId, org),
    context.db.prepare("DELETE FROM chat_messages WHERE channel_id = ?1 AND organization_id = ?2").bind(channelId, org),
    context.db.prepare("DELETE FROM chat_participants WHERE channel_id = ?1 AND organization_id = ?2").bind(channelId, org),
    context.db.prepare("DELETE FROM chat_channels WHERE id = ?1 AND organization_id = ?2").bind(channelId, org),
    auditStatement(context, "chat.channel_deleted", "chat_channel", channelId, { name: channel.name }),
  ]);
  for (const file of files.results) await purgeIfOrphan(context, file.file_id);
}

export async function setReminderDone(context: OrganizationContext, reminderId: string, done: boolean) {
  const reminder = await context.db.prepare(
    "SELECT id, channel_id, target_member_id, created_by_member_id FROM chat_reminders WHERE id = ?1 AND organization_id = ?2",
  ).bind(reminderId, context.organization.id).first<{ id: string; channel_id: string; target_member_id: string | null; created_by_member_id: string }>();
  if (!reminder) throw new ApiError(404, "reminder_not_found", "Lembrete não encontrado.");
  await requireChannel(context, reminder.channel_id);
  const me = context.member.id;
  if (reminder.target_member_id && reminder.target_member_id !== me && reminder.created_by_member_id !== me) {
    throw new ApiError(403, "reminder_denied", "Só a pessoa lembrada ou quem criou o lembrete pode concluí-lo.");
  }
  await context.db.prepare("UPDATE chat_reminders SET done_at = ?3, done_by_name = ?4 WHERE id = ?1 AND organization_id = ?2")
    .bind(reminderId, context.organization.id, done ? now() : null, done ? context.user.displayName : null).run();
}

/** Lembretes da conversa que valem para esta pessoa até `horizon`, para "Lembretes do dia". */
export async function pendingChatReminders(context: OrganizationContext, horizon: string) {
  const rows = await context.db.prepare(
    `SELECT r.id, r.text, r.due_day, r.created_by_name, r.target_member_id, c.kind, c.name AS channel_name, c.id AS channel_id
     FROM chat_reminders r
     INNER JOIN chat_channels c ON c.id = r.channel_id AND c.organization_id = r.organization_id
     LEFT JOIN chat_participants mine ON mine.channel_id = c.id AND mine.member_id = ?2 AND mine.is_member = 1
     WHERE r.organization_id = ?1 AND r.done_at IS NULL AND r.due_day <= ?3
       AND (r.target_member_id = ?2 OR (r.target_member_id IS NULL AND (c.kind = 'canal' OR mine.id IS NOT NULL)))
     ORDER BY r.due_day LIMIT 200`,
  ).bind(context.organization.id, context.member.id, horizon).all<{
    id: string; text: string; due_day: string; created_by_name: string; target_member_id: string | null; kind: string; channel_name: string | null; channel_id: string;
  }>();
  return rows.results;
}
