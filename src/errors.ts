/** One entry of the `erros` array BB returns on failed requests. */
export interface BBErrorDetail {
  codigo?: string | number;
  versao?: string;
  mensagem?: string;
  ocorrencia?: string;
  [field: string]: unknown;
}

/** Base class for every error thrown by this library. */
export class BBError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The OAuth server refused the credentials or returned no token. */
export class BBAuthError extends BBError {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** The Cobranças API answered with a 4xx/5xx status. */
export class BBApiError extends BBError {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
    /** Parsed `erros` array when BB returned one. */
    readonly details: BBErrorDetail[],
  ) {
    super(message);
  }
}

/** Pulls BB's error list out of the several shapes the API uses. */
export function extractErrorDetails(body: unknown): BBErrorDetail[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  for (const key of ["erros", "errors"]) {
    if (Array.isArray(b[key])) return b[key] as BBErrorDetail[];
  }
  if (typeof b.message === "string" || typeof b.mensagem === "string") {
    return [{ mensagem: (b.mensagem ?? b.message) as string }];
  }
  return [];
}
