// Kept apart from backend.ts so session readers (superadmin, manutenção) can raise
// API errors without importing the module that resolves the organization context.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
