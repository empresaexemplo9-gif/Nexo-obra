import { createHash } from "node:crypto";
import { getDatabase } from "@/db";
import { abrirZip } from "@/lib/integrations/planilha-zip";
import { parseNationalPackage } from "@/lib/integrations/sinapi-mapped";
import { officialSinapiUrl, packSinapiFiles, parseSinapiCsv } from "@/lib/integrations/sinapi-import";
import { type SinapiRegime } from "@/lib/integrations/sinapi-contract";
import { activateSinapi, advanceSinapi, prepareSinapiItems, sinapiIO, sinapiStatus } from "./sinapi-sync";
export type ImportProfile = { uf: string; regime: SinapiRegime };
export type SinapiImport = { id: string; month: string; source: string; sha256: string; bytes: number; kind: "zip" | "csv";
  files: { name: string; path: string }[]; reports: string[]; profiles: ImportProfile[]; completed: string[]; createdAt: number;
  sample: { codigo: string; descricao: string; unidade: string; custoUnitarioCentavos: number; tipo: string }[]; sampleCount: number; sampleMissing: number };
const manifestPath = (id: string) => `sinapi-imports/${id}/manifest.json`;
export async function readSinapiImport(id: string): Promise<SinapiImport> { return JSON.parse((await sinapiIO.read(manifestPath(id))).toString()); }
async function writeManifest(manifest: SinapiImport) { await sinapiIO.write(manifestPath(manifest.id), Buffer.from(JSON.stringify(manifest))); }
export async function latestSinapiImport(profile?: { uf: string; regime: string }) {
  const row = await getDatabase().prepare("SELECT laudo_json FROM sinapi_competencias WHERE estado='aprovada' AND (?1='' OR uf=?1) AND (?2='' OR regime=?2) ORDER BY competencia DESC,aprovado_em DESC LIMIT 1")
    .bind(profile?.uf ?? "", profile?.regime ?? "").first<{laudo_json: string}>();
  const id = row ? JSON.parse(row.laudo_json)?.importId : null;
  return id ? readSinapiImport(id) : null;
}
async function parseProfile(manifest: SinapiImport, profile: ImportProfile) {
  const bytes = await sinapiIO.read(`sinapi-imports/${manifest.id}/source.zip`);
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw new Error("O arquivo mudou depois da conferência.");
  if (manifest.kind === "csv") {
    const zip = abrirZip(bytes);
    return parseSinapiCsv(zip.entradas.map((e) => ({ name: e.nome, bytes: zip.extrair(e.nome) })), manifest.month, profile.uf, profile.regime);
  }
  const parsed = parseNationalPackage(bytes, manifest.month, profile.uf, profile.regime);
  if (!parsed) throw new Error("O pacote não contém os relatórios nacionais de insumos e composições reconhecidos. Use o pacote XLSX completo da CAIXA.");
  return parsed;
}
export async function prepareSinapiImport(input: { id: string; month: string; url?: string; files?: string[]; profiles: ImportProfile[] }) {
  const root = `sinapi-imports/${input.id}/`;
  const files = (input.files ?? []).map((path) => ({ name: path.split("/").at(-1)!, path }));
  let bytes: Buffer, kind: "zip" | "csv" = "zip", reports: string[];
  if (input.url) { bytes = await sinapiIO.download(officialSinapiUrl(input.url, input.month)); reports = []; }
  else {
    if (!files.length || files.some((f) => !f.path.startsWith(`${root}files/`) || f.path.includes(".."))) throw new Error("Arquivos inválidos.");
    if (files.every((f) => /\.csv$/i.test(f.name))) kind = "csv";
    else if (!(files.length === 1 && /\.zip$/i.test(files[0].name)) && !files.every((f) => /\.xlsx$/i.test(f.name))) throw new Error("Selecione um ZIP, uma pasta de XLSX ou arquivos CSV. Não misture os formatos.");
    const inputs: { name: string; bytes: Buffer }[] = []; let total = 0;
    for (const file of files) {
      const data = await sinapiIO.read(file.path); total += data.length;
      if (total > 80 * 1024 * 1024) throw new Error("A seleção excede 80 MB.");
      inputs.push({ name: file.name, bytes: data });
    }
    bytes = kind === "csv" ? packSinapiFiles(inputs) : /\.zip$/i.test(files[0].name) ? inputs[0].bytes : packSinapiFiles(inputs);
    reports = files.map((f) => f.name);
  }
  reports = abrirZip(bytes).entradas.map((e) => e.nome); await sinapiIO.write(`${root}source.zip`, bytes);
  const manifest: SinapiImport = { id: input.id, month: input.month, source: input.url ?? "Arquivos enviados pelo administrador", kind, files, reports,
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, profiles: input.profiles, completed: [], createdAt: Date.now(), sample: [], sampleCount: 0, sampleMissing: 0 };
  const parsed = await parseProfile(manifest, input.profiles[0]);
  manifest.sample = [...parsed.itens.slice(0, 3), ...parsed.itens.filter((i) => i.tipo === "composicao").slice(0, 3)];
  manifest.sampleCount = parsed.itens.length; manifest.sampleMissing = parsed.semPreco;
  await writeManifest(manifest); return manifest;
}
export async function advanceSinapiImport(id: string, actor: string, token: string) {
  const manifest = await readSinapiImport(id);
  const profile = manifest.profiles.find((p) => !manifest.completed.includes(`${p.uf}:${p.regime}`));
  if (!profile) return manifest;
  const active = await getDatabase().prepare("SELECT competencia,arquivo_sha256 FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND estado='aprovada' ORDER BY competencia DESC LIMIT 1")
    .bind(profile.uf, profile.regime).first<{competencia: string; arquivo_sha256: string}>();
  const key = `${profile.uf}:${profile.regime}`;
  if (active && active.competencia >= manifest.month) {
    if (active.competencia !== manifest.month || active.arquivo_sha256 !== manifest.sha256) throw new Error(`${key}: já existe uma referência igual ou mais recente de outra fonte. A base ativa foi preservada.`);
    const status = await sinapiStatus();
    const job = status.jobs.find((j) => j.id === status.jobId);
    if (job?.estado === "aprovada" && job.uf === profile.uf && job.regime === profile.regime) await advanceSinapi(token);
  } else {
    let status = await sinapiStatus();
    if (status.jobId) {
      const job = status.jobs.find((j) => j.id === status.jobId)!;
      const report = job.report as typeof job.report & { importId?: string };
      if (report.importId !== id || job.uf !== profile.uf || job.regime !== profile.regime) throw new Error("Conclua a outra importação em andamento no painel antes de continuar.");
    } else {
      const parsed = await parseProfile(manifest, profile);
      await prepareSinapiItems(manifest.month, { ...profile, automatico: false, mapas: [], assinaturas: [] }, parsed,
        { url: manifest.source, sha256: manifest.sha256, bytes: manifest.bytes, importId: id }, token);
    }
    await advanceSinapi(token, sinapiIO, 90000);
    status = await sinapiStatus();
    const job = status.jobs.find((j) => j.id === status.jobId);
    if (job?.estado === "importando") return manifest;
    if (job?.estado === "pendente") await activateSinapi(actor, token);
    await advanceSinapi(token);
  }
  manifest.completed.push(key); await writeManifest(manifest); return manifest;
}
