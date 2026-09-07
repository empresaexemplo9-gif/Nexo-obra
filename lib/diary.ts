import { z } from "zod";

export const weatherLabels = { clear: "Ensolarado", cloudy: "Nublado", rain: "Chuva", mixed: "Variável", unreported: "Não informado" };
export const occurrenceLabels = { none: "Sem ocorrência", general: "Geral", delay: "Atraso / impedimento", safety: "Segurança", materials: "Materiais / equipamentos", weather: "Condições climáticas" };
export type DiaryWeather = keyof typeof weatherLabels;
export type OccurrenceType = keyof typeof occurrenceLabels;

export const diaryFieldsSchema = z.object({
  entryDate: z.string().date(),
  weather: z.enum(["clear", "cloudy", "rain", "mixed", "unreported"]),
  workforceCount: z.number().int().min(0).max(10000),
  summary: z.string().trim().min(3).max(10000),
  blockers: z.string().trim().max(5000),
  occurrenceType: z.enum(["none", "general", "delay", "safety", "materials", "weather"]),
});
const validOccurrence = (value: DiaryFields) => value.occurrenceType === "none" ? !value.blockers : Boolean(value.blockers);
const occurrenceError = { message: "Informe o tipo e a descrição da ocorrência, ou escolha Sem ocorrência.", path: ["blockers"] };
export const createDiarySchema = diaryFieldsSchema.extend({ id: z.string().uuid(), projectId: z.string().uuid() }).strict().refine(validOccurrence, occurrenceError);
export const updateDiarySchema = diaryFieldsSchema.extend({ revision: z.number().int().positive(), reason: z.string().trim().min(5).max(500) }).strict().refine(validOccurrence, occurrenceError);
export const diaryQuerySchema = z.object({
  projectId: z.string().uuid().optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  q: z.string().trim().max(100).default(""), occurrencesOnly: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "O início do período deve ser anterior ao fim.", path: ["from"] });

export type DiaryFields = z.infer<typeof diaryFieldsSchema>;
export type DiaryProject = { id: string; name: string; code: string };
export type DiaryEntry = DiaryFields & {
  id: string; projectId: string; projectName: string; projectCode: string;
  authorName: string; revision: number; createdAt: string; updatedAt: string; photoCount: number;
};
export type DiaryPhoto = { id: string; name: string; caption: string; mimeType: string; sizeBytes: number; sha256: string; uploadedByName: string; createdAt: string; url: string };
export type DiaryRevision = { revision: number; snapshot: DiaryFields; editorName: string; reason: string; createdAt: string };
export type DiaryDetail = { entry: DiaryEntry; photos: DiaryPhoto[]; revisions: DiaryRevision[]; nextHistoryBefore: number | null };
export const MAX_DIARY_PHOTOS = 12;
export const MAX_DIARY_PHOTO_BYTES = 5 * 1024 * 1024;
export const DIARY_PAGE_SIZE = 20;

// Only raster formats: an extension or client-provided MIME alone is not evidence of an image.
export function detectedPhotoType(bytes: Uint8Array): string | null {
  if (bytes.length < 32) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function diaryDate(value: string) { return value.slice(0, 10).split("-").reverse().join("/"); }
