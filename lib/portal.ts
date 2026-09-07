import { z } from "zod";

export const portalAccessSchema = z.object({
  projectId: z.string().uuid(), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(160).transform((value) => value.toLowerCase()),
  viewProgress: z.boolean(), canApprove: z.boolean(),
}).strict();
export const portalAccessChangeSchema = z.object({
  revision: z.number().int().positive(), action: z.enum(["permissions", "revoke", "renew"]),
  viewProgress: z.boolean().optional(), canApprove: z.boolean().optional(),
}).strict().refine((value) => value.action !== "permissions" || (value.viewProgress !== undefined && value.canApprove !== undefined), { message: "Informe as permissões do cliente." });
export const portalPublishSchema = z.object({
  id: z.string().uuid(), accessId: z.string().uuid(), kind: z.enum(["update", "approval"]),
  title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(10000),
  dueDate: z.string().date().nullable().default(null), sourceDiaryId: z.string().uuid().nullable().default(null),
  photoIds: z.array(z.string().uuid()).max(12).default([]),
}).strict().refine((value) => !value.photoIds.length || Boolean(value.sourceDiaryId), { message: "Selecione o registro de origem das fotos." })
  .refine((value) => new Set(value.photoIds).size === value.photoIds.length, { message: "Selecione cada foto apenas uma vez." });
export const portalDecisionSchema = z.object({
  id: z.string().uuid(), choice: z.enum(["approved", "changes_requested"]), comment: z.string().trim().max(3000), confirmed: z.literal(true),
}).strict().refine((value) => value.choice !== "changes_requested" || value.comment.length >= 5, { message: "Descreva o ajuste necessário (ao menos 5 caracteres).", path: ["comment"] });
export const PORTAL_PAGE_SIZE = 20;
export const portalStatusLabels = { open: "Aguardando resposta", approved: "Aprovado", changes_requested: "Ajustes solicitados", withdrawn: "Retirado pela empresa" };
export type PortalProject = { id: string; name: string; code: string };
export type PortalAccess = {
  id: string; projectId: string; projectName: string; projectCode: string; organizationName: string; name: string; email: string;
  status: "pending" | "active" | "revoked"; viewProgress: boolean; canApprove: boolean; revision: number; expiresAt: number; termsAccepted: boolean;
};
export type PortalPhoto = { id: string; caption: string; name: string; url: string };
export type PortalItem = {
  id: string; accessId: string; projectId: string; kind: "update" | "approval"; title: string; body: string; dueDate: string | null;
  status: keyof typeof portalStatusLabels; authorName: string; createdAt: string; updatedAt: string;
  withdrawalReason: string; withdrawnByName: string; photos: PortalPhoto[];
  decision: { id: string; choice: "approved" | "changes_requested"; comment: string; actorName: string; createdAt: string } | null;
};
export type PortalPage = { items: PortalItem[]; total: number; page: number; pageSize: number; pending: number };
export type PortalProgress = { status: string; phase: string; progressPercent: number; startDate: string | null; targetDate: string | null };
