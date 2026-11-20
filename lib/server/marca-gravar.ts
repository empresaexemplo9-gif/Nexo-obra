import { z } from "zod";
import { ApiError } from "@/lib/server/api-error";
import { ajustarParaTextoBranco, normalizarCor } from "@/lib/empresa-config";
import { marcaDaEmpresa } from "@/lib/server/empresa-config";

// Gravação da identidade visual, usada pela tela da empresa e pelo painel do superadmin.
// Uma regra só: os dois lados validam o arquivo e ajustam as cores do mesmo jeito.

// O navegador converte PDF, SVG e fotos grandes para PNG antes de enviar; aqui só entram
// imagens de bitmap pequenas, conferidas pelos bytes iniciais e não pelo que o navegador diz.
const LOGO_MAX_BYTES = 400 * 1024;
const assinaturas: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
};

const cor = z.string().trim().max(7).nullable().transform((valor, ctx) => {
  if (valor === null || valor === "") return null;
  const normalizada = normalizarCor(valor);
  if (!normalizada) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use uma cor no formato #RRGGBB." }); return z.NEVER; }
  return normalizada;
});

export const esquemaDaMarca = z.object({
  menuColor: cor,
  accentColor: cor,
  bandColor: cor,
  // Ausente: mantém o logotipo atual. Nulo: remove. Objeto: substitui.
  logo: z.object({ mime: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(16).max(Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 8) }).strict().nullable().optional(),
  revision: z.number().int().min(0),
}).strict();

export type DadosDaMarca = z.infer<typeof esquemaDaMarca>;

function decodificar(base64: string) {
  try { return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); }
  catch { throw new ApiError(400, "invalid_logo", "O arquivo do logotipo chegou corrompido. Envie de novo."); }
}

export async function gravarMarca(
  db: D1Database,
  organizationId: string,
  data: DadosDaMarca,
  autor: { email: string; actorId: string; plataforma?: boolean },
) {
  let logo: { mime: string; base64: string } | null | undefined = data.logo;
  if (logo) {
    const bytes = decodificar(logo.base64);
    if (bytes.byteLength > LOGO_MAX_BYTES) throw new ApiError(413, "logo_too_large", "O logotipo ficou grande demais. Use uma imagem menor.");
    if (!assinaturas[logo.mime](bytes)) throw new ApiError(415, "invalid_logo", "O arquivo não é uma imagem PNG, JPEG ou WebP válida.");
    logo = { mime: logo.mime, base64: logo.base64 };
  }

  // Texto branco vai sobre as três cores; uma cor clara da marca é escurecida até ler bem.
  const cores = {
    menu: data.menuColor && ajustarParaTextoBranco(data.menuColor),
    accent: data.accentColor && ajustarParaTextoBranco(data.accentColor),
    band: data.bandColor && ajustarParaTextoBranco(data.bandColor),
  };
  const agora = Date.now();
  const trocaLogo = logo !== undefined ? 1 : 0;
  const metadados = JSON.stringify({ colors: cores, logo: logo === undefined ? "mantido" : logo === null ? "removido" : "substituído" });
  const [gravado] = await db.batch([
    db.prepare(`INSERT INTO organization_branding (
        organization_id, menu_color, accent_color, band_color, logo_mime, logo_base64, logo_version, revision, updated_by, updated_at
      ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?7 = 1 THEN 1 ELSE 0 END, 1, ?8, ?9
      WHERE ?10 = 0 OR EXISTS (SELECT 1 FROM organization_branding WHERE organization_id = ?1)
      ON CONFLICT(organization_id) DO UPDATE SET
        menu_color = excluded.menu_color, accent_color = excluded.accent_color, band_color = excluded.band_color,
        logo_mime = CASE WHEN ?7 = 1 THEN excluded.logo_mime ELSE organization_branding.logo_mime END,
        logo_base64 = CASE WHEN ?7 = 1 THEN excluded.logo_base64 ELSE organization_branding.logo_base64 END,
        logo_version = organization_branding.logo_version + ?7,
        revision = organization_branding.revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      WHERE organization_branding.revision = ?10 RETURNING revision`)
      .bind(organizationId, cores.menu, cores.accent, cores.band, logo?.mime ?? null, logo?.base64 ?? null,
        trocaLogo, autor.email, agora, data.revision),
    // Só registra se a gravação aconteceu: conflito de revisão não deixa rastro falso.
    autor.plataforma
      ? db.prepare(`INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
          SELECT ?1, ?2, ?3, 'platform.branding_changed', 'organization', ?2, ?4, ?5 WHERE changes() > 0`)
        .bind(crypto.randomUUID(), organizationId, autor.actorId, metadados, agora)
      : db.prepare(`INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
          SELECT ?1, ?2, ?3, 'organization.branding_updated', 'organization', ?2, ?4, ?5 WHERE changes() > 0`)
        .bind(crypto.randomUUID(), organizationId, autor.actorId, metadados, agora),
  ]);
  if (!(gravado.results as unknown[]).length) {
    throw new ApiError(409, "branding_conflict", "A identidade visual foi alterada em outra sessão. Atualize a página antes de salvar.");
  }
  return {
    branding: await marcaDaEmpresa(db, organizationId),
    adjusted: (["menu", "accent", "band"] as const).filter((chave) => {
      const original = { menu: data.menuColor, accent: data.accentColor, band: data.bandColor }[chave];
      return Boolean(original && original !== cores[chave]);
    }),
  };
}
