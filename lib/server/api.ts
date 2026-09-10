import "server-only";

import { ZodError, type TypeOf, type ZodTypeAny } from "zod";

import { ForbiddenError } from "@/lib/auth/roles";
import {
  DatabaseUnavailableError,
  NoOrganizationError,
  UnauthorizedError,
} from "@/lib/auth/session";

/**
 * Respostas de erro padronizadas.
 *
 * `code` existe para a interface reagir sem depender do texto: `no_organization`
 * leva ao onboarding, `unauthorized` leva ao login, `forbidden` explica.
 */
export type ApiErrorCode =
  | "unauthorized"
  | "no_organization"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_body"
  | "invalid_input"
  | "unavailable"
  | "internal";

export function apiError(status: number, code: ApiErrorCode, message: string, extra?: object) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

/** 422 com a lista de campos, no formato que o formulário destaca direto. */
export function validationError(error: ZodError) {
  return Response.json(
    {
      error: {
        code: "invalid_input" satisfies ApiErrorCode,
        message: "Confira os campos destacados.",
        fields: error.issues.map((issue) => ({
          field: issue.path.join(".") || "(raiz)",
          message: issue.message,
        })),
      },
    },
    { status: 422 },
  );
}

/**
 * Converte os erros tipados de autenticação/autorização em respostas.
 *
 * Envolver cada rota nisso garante que uma exceção não tratada nunca vire 200
 * com corpo vazio nem vaze detalhe interno para o cliente.
 */
export async function handleRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(error.status, "unauthorized", error.message);
    }
    if (error instanceof NoOrganizationError) {
      return apiError(error.status, "no_organization", error.message);
    }
    if (error instanceof DatabaseUnavailableError) {
      return apiError(error.status, "unavailable", error.message);
    }
    if (error instanceof ForbiddenError) {
      return apiError(error.status, "forbidden", error.message);
    }
    if (error instanceof ZodError) {
      return validationError(error);
    }

    console.error("[api] erro não tratado", error);
    return apiError(500, "internal", "Não foi possível concluir a operação.");
  }
}

/**
 * Lê e valida o corpo JSON. Corpo inválido é 400, campo errado é 422.
 *
 * O genérico é o SCHEMA, não o tipo de saída: schemas com `.default()` têm
 * entrada e saída diferentes, e `ZodSchema<T>` (que exige as duas iguais) os
 * rejeitaria. `TypeOf<S>` devolve o tipo já validado, com defaults aplicados.
 */
export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: TypeOf<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(400, "invalid_body", "O corpo da requisição não é JSON válido."),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: validationError(parsed.error) };
  return { ok: true, data: parsed.data };
}

export function parseSearchParams<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): { ok: true; data: TypeOf<S> } | { ok: false; response: Response } {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: validationError(parsed.error) };
  return { ok: true, data: parsed.data };
}
