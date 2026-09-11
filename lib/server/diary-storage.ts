import { runtimeEnv as platformEnv } from "@/lib/server/runtime";
import { ApiError } from "@/lib/server/backend";

export function diaryBucket(): R2Bucket {
  const bucket = (platformEnv() as unknown as { FILES?: R2Bucket }).FILES;
  if (!bucket) throw new ApiError(503, "storage_unavailable", "O armazenamento de fotos está indisponível. O registro em texto continua salvo.");
  return bucket;
}
