import { z } from "zod";

import {
  PROJECT_KINDS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/domain/enums";

/**
 * Contratos de entrada, compartilhados entre a API e os formulários.
 *
 * O que NÃO aparece aqui é tão importante quanto o que aparece: nenhum schema
 * aceita `organizationId`, `id`, `createdAt` ou `updatedAt`. Esses campos são
 * decididos pelo servidor. `.strict()` faz um cliente que tente enviá-los
 * receber 422 em vez de ter o campo ignorado em silêncio.
 */

const trimmed = (max: number) => z.string().trim().max(max);

/** Texto opcional: string vazia vira `null` para não gravar "" no banco. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .nullish();

/** Aceita data pura ou data e hora; a fila de tarefas ordena por texto. */
const isoDateOrDateTime = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    "Use AAAA-MM-DD ou uma data e hora ISO-8601.",
  )
  .nullish();

const cents = z
  .number()
  .int("Valores monetários são inteiros em centavos.")
  .min(0, "O valor não pode ser negativo.")
  .max(Number.MAX_SAFE_INTEGER);

/* -------------------------------------------------------------------------- */
/* Organização                                                                */
/* -------------------------------------------------------------------------- */

export const createOrganizationSchema = z
  .object({
    name: trimmed(120).min(2, "Informe o nome da empresa."),
    slug: trimmed(60)
      .min(2, "Informe um identificador com ao menos 2 caracteres.")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Use apenas letras minúsculas, números e hífen.",
      )
      .optional(),
    timezone: trimmed(60).optional(),
  })
  .strict();

export const switchOrganizationSchema = z
  .object({ organizationId: z.string().trim().min(1).max(64) })
  .strict();

/* -------------------------------------------------------------------------- */
/* Cliente                                                                    */
/* -------------------------------------------------------------------------- */

export const createClientSchema = z
  .object({
    name: trimmed(160).min(2, "Informe o nome do cliente."),
    document: optionalText(32),
    email: z
      .string()
      .trim()
      .max(160)
      .email("Informe um e-mail válido.")
      .nullish()
      .or(z.literal("").transform(() => null)),
    phone: optionalText(32),
    externalFinancialId: optionalText(64),
    notes: trimmed(2_000).default(""),
  })
  .strict();

/** Atualização parcial: só os campos enviados mudam. */
export const updateClientSchema = createClientSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Envie ao menos um campo para atualizar.",
  });

/* -------------------------------------------------------------------------- */
/* Projeto e obra                                                             */
/* -------------------------------------------------------------------------- */

export const createProjectSchema = z
  .object({
    code: trimmed(24).min(2, "Informe um código com ao menos 2 caracteres."),
    name: trimmed(160).min(3, "Informe um nome com ao menos 3 caracteres."),
    kind: z.enum(PROJECT_KINDS),
    clientId: optionalText(64),
    status: z.enum(PROJECT_STATUSES).default("active"),
    phase: trimmed(80).min(2).default("briefing"),
    progressPercent: z.number().int().min(0).max(100).default(0),
    ownerMemberId: optionalText(64),
    startDate: isoDate,
    targetDate: isoDate,
    budgetCents: cents.default(0),
    externalFinancialCostCenterId: optionalText(64),
  })
  .strict()
  .refine(
    (value) => !value.startDate || !value.targetDate || value.targetDate >= value.startDate,
    { message: "A data de entrega não pode ser anterior ao início.", path: ["targetDate"] },
  );

export const updateProjectSchema = z
  .object({
    code: trimmed(24).min(2).optional(),
    name: trimmed(160).min(3).optional(),
    kind: z.enum(PROJECT_KINDS).optional(),
    clientId: optionalText(64),
    status: z.enum(PROJECT_STATUSES).optional(),
    phase: trimmed(80).min(2).optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
    ownerMemberId: optionalText(64),
    startDate: isoDate,
    targetDate: isoDate,
    budgetCents: cents.optional(),
    externalFinancialCostCenterId: optionalText(64),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Envie ao menos um campo para atualizar.",
  });

/* -------------------------------------------------------------------------- */
/* Tarefa                                                                     */
/* -------------------------------------------------------------------------- */

export const createTaskSchema = z
  .object({
    title: trimmed(200).min(3, "Descreva a tarefa em ao menos 3 caracteres."),
    projectId: optionalText(64),
    description: trimmed(4_000).default(""),
    status: z.enum(TASK_STATUSES).default("todo"),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    assigneeMemberId: optionalText(64),
    startsAt: isoDateOrDateTime,
    dueAt: isoDateOrDateTime,
    estimatedMinutes: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: trimmed(200).min(3).optional(),
    projectId: optionalText(64),
    description: trimmed(4_000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assigneeMemberId: optionalText(64),
    startsAt: isoDateOrDateTime,
    dueAt: isoDateOrDateTime,
    estimatedMinutes: z.number().int().min(0).max(100_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Envie ao menos um campo para atualizar.",
  });

/* -------------------------------------------------------------------------- */
/* Listagens                                                                  */
/* -------------------------------------------------------------------------- */

const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const listClientsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  ...pagination,
});

export const listProjectsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  kind: z.enum(PROJECT_KINDS).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  clientId: z.string().trim().max(64).optional(),
  ...pagination,
});

export const listTasksQuerySchema = z.object({
  projectId: z.string().trim().max(64).optional(),
  assigneeMemberId: z.string().trim().max(64).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  onlyOpen: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  overdueOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  ...pagination,
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
