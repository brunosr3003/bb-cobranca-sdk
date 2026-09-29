import { BBApiError, BBAuthError, extractErrorDetails } from "./errors.js";
import type {
  BoletoDetails,
  CreateBoletoInput,
  CreateBoletoResponse,
  ListBoletosParams,
  ListBoletosResponse,
  QrCode,
  UpdateBoletoRequest,
} from "./types.js";

export type Environment = "sandbox" | "production";

const ENDPOINTS: Record<Environment, { oauth: string; api: string }> = {
  sandbox: {
    oauth: "https://oauth.hm.bb.com.br/oauth/token",
    api: "https://api.hm.bb.com.br/cobrancas/v2",
  },
  production: {
    oauth: "https://oauth.bb.com.br/oauth/token",
    api: "https://api.bb.com.br/cobrancas/v2",
  },
};

const DEFAULT_SCOPE = "cobrancas.boletos-info cobrancas.boletos-requisicao";

/** The collection agreement ("convênio de cobrança") boletos are issued under. */
export interface Agreement {
  numeroConvenio: number;
  numeroCarteira: number;
  numeroVariacaoCarteira: number;
  agencia: string | number;
  conta: string | number;
}

export interface BBCobrancaOptions {
  /** OAuth credentials from the BB Developers portal. */
  clientId: string;
  clientSecret: string;
  /** `gw-dev-app-key` (called "developer_application_key" in the portal). */
  appKey: string;
  agreement: Agreement;
  /** Default: "sandbox". */
  environment?: Environment;
  /** Override the OAuth token URL (e.g. for a proxy). */
  oauthUrl?: string;
  /** Override the API base URL. */
  apiBaseUrl?: string;
  /** Custom fetch, e.g. one configured with a client certificate for mutual TLS. */
  fetch?: typeof fetch;
  /**
   * OAuth scopes to request. Default: "cobrancas.boletos-info cobrancas.boletos-requisicao"
   * (read and write). Pass an empty string to omit the parameter.
   */
  scope?: string;
  /** Refresh tokens this many ms before they expire. Default: 30 000. */
  tokenRefreshMarginMs?: number;
  /** Per-request timeout. Default: 30 000 ms. */
  timeoutMs?: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

type Query = Record<string, string | number | undefined>;

/**
 * Client for one Banco do Brasil collection agreement. To issue boletos under
 * several agreements or companies, create one instance for each; tokens are
 * cached per instance.
 */
export class BBCobranca {
  readonly agreement: Agreement;
  private readonly opts: Required<Pick<BBCobrancaOptions, "tokenRefreshMarginMs" | "timeoutMs">> & BBCobrancaOptions;
  private readonly oauthUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token?: CachedToken;
  private pendingToken?: Promise<CachedToken>;

  constructor(options: BBCobrancaOptions) {
    for (const key of ["clientId", "clientSecret", "appKey"] as const) {
      if (!options[key]) throw new TypeError(`BBCobranca: "${key}" is required`);
    }
    if (!options.agreement) throw new TypeError(`BBCobranca: "agreement" is required`);
    const env = options.environment ?? "sandbox";
    if (!(env in ENDPOINTS)) throw new TypeError(`BBCobranca: unknown environment "${env}"`);

    this.opts = { tokenRefreshMarginMs: 30_000, timeoutMs: 30_000, ...options };
    this.agreement = options.agreement;
    this.oauthUrl = options.oauthUrl ?? ENDPOINTS[env].oauth;
    this.apiBaseUrl = (options.apiBaseUrl ?? ENDPOINTS[env].api).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new TypeError("BBCobranca: no fetch available. Use Node.js 18+ or pass `fetch`.");
    }
  }

  /**
   * Returns a valid access token, requesting a new one only when the cached one
   * is about to expire. Concurrent callers share a single token request, which
   * matters in the sandbox (rate limited to a few calls per 10 minutes).
   */
  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    this.pendingToken ??= this.requestToken().finally(() => {
      this.pendingToken = undefined;
    });
    this.token = await this.pendingToken;
    return this.token.value;
  }

  /** Registers a new boleto (`POST /boletos`). */
  createBoleto(input: CreateBoletoInput): Promise<CreateBoletoResponse> {
    return this.request("POST", "/boletos", {
      body: {
        numeroConvenio: this.agreement.numeroConvenio,
        numeroCarteira: this.agreement.numeroCarteira,
        numeroVariacaoCarteira: this.agreement.numeroVariacaoCarteira,
        ...input,
      },
    });
  }

  /** Full details of one boleto (`GET /boletos/{id}`). */
  getBoleto(numeroTituloCliente: string): Promise<BoletoDetails> {
    return this.request("GET", `/boletos/${encodeURIComponent(numeroTituloCliente)}`, {
      query: { numeroConvenio: this.agreement.numeroConvenio },
    });
  }

  /** One page of boletos (`GET /boletos`). Use `listAllBoletos` to walk every page. */
  listBoletos(params: ListBoletosParams): Promise<ListBoletosResponse> {
    return this.request("GET", "/boletos", {
      query: {
        agenciaBeneficiario: this.agreement.agencia,
        contaBeneficiario: this.agreement.conta,
        ...params,
      },
    });
  }

  /** Iterates over every boleto matching `params`, following `proximoIndice`. */
  async *listAllBoletos(params: Omit<ListBoletosParams, "indice">) {
    let indice: number | undefined;
    for (;;) {
      const page = await this.listBoletos({ ...params, indice });
      yield* page.boletos ?? [];
      if (page.indicadorContinuidade !== "S") return;
      indice = page.proximoIndice;
    }
  }

  /** Changes an open boleto (`PATCH /boletos/{id}`): due date, amount, discounts, etc. */
  updateBoleto(numeroTituloCliente: string, changes: UpdateBoletoRequest): Promise<Record<string, unknown>> {
    return this.request("PATCH", `/boletos/${encodeURIComponent(numeroTituloCliente)}`, {
      body: { numeroConvenio: this.agreement.numeroConvenio, ...changes },
    });
  }

  /** Writes off (cancels) an open boleto (`POST /boletos/{id}/baixar`). */
  writeOffBoleto(numeroTituloCliente: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/boletos/${encodeURIComponent(numeroTituloCliente)}/baixar`, {
      body: { numeroConvenio: this.agreement.numeroConvenio },
    });
  }

  /** Adds a PIX QR code to an existing boleto (`POST /boletos/{id}/gerar-pix`). */
  createPix(numeroTituloCliente: string): Promise<QrCode & Record<string, unknown>> {
    return this.request("POST", `/boletos/${encodeURIComponent(numeroTituloCliente)}/gerar-pix`, {
      body: { numeroConvenio: this.agreement.numeroConvenio },
    });
  }

  /** Reads the PIX QR code attached to a boleto (`GET /boletos/{id}/pix`). */
  getPix(numeroTituloCliente: string): Promise<QrCode & Record<string, unknown>> {
    return this.request("GET", `/boletos/${encodeURIComponent(numeroTituloCliente)}/pix`, {
      query: { numeroConvenio: this.agreement.numeroConvenio },
    });
  }

  /** Removes the PIX QR code from a boleto (`POST /boletos/{id}/cancelar-pix`). */
  cancelPix(numeroTituloCliente: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/boletos/${encodeURIComponent(numeroTituloCliente)}/cancelar-pix`, {
      body: { numeroConvenio: this.agreement.numeroConvenio },
    });
  }

  /** Low-level call to any Cobranças v2 endpoint, with auth and error handling. */
  async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.apiBaseUrl + path);
    url.searchParams.set("gw-dev-app-key", this.opts.appKey);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const send = async () =>
      this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.getAccessToken()}`,
          Accept: "application/json",
          ...(opts.body !== undefined && { "Content-Type": "application/json" }),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });

    let res = await send();
    if (res.status === 401) {
      // Token revoked or expired early on BB's side: drop it and retry once.
      this.token = undefined;
      res = await send();
    }

    const body = await readBody(res);
    if (!res.ok) {
      const details = extractErrorDetails(body);
      const summary = details.map((d) => [d.codigo, d.mensagem].filter(Boolean).join(" ")).join("; ");
      throw new BBApiError(
        `BB Cobranças ${method} ${path} failed with ${res.status}${summary ? `: ${summary}` : ""}`,
        res.status,
        method,
        path,
        body,
        details,
      );
    }
    return body as T;
  }

  private async requestToken(): Promise<CachedToken> {
    const scope = this.opts.scope ?? DEFAULT_SCOPE;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(this.oauthUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        ...(scope && { scope }),
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const body = (await readBody(res)) as { access_token?: string; expires_in?: number } | undefined;
    if (!res.ok || !body?.access_token) {
      throw new BBAuthError(`BB OAuth token request failed with ${res.status}`, res.status, body);
    }
    const lifetimeMs = (body.expires_in ?? 600) * 1000;
    return {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(lifetimeMs - this.opts.tokenRefreshMarginMs, 0),
    };
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
