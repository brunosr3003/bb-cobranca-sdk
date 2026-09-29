/**
 * Request and response shapes for the Banco do Brasil "Cobranças v2" API.
 *
 * Field names are kept exactly as the API expects them (in Portuguese), so the
 * official documentation maps 1:1 to these types. Dates use BB's `dd.mm.aaaa`
 * format; see `formatBBDate`.
 */

/** 1 = individual (CPF), 2 = company (CNPJ). */
export type TipoInscricao = 1 | 2;

export interface Pagador {
  tipoInscricao: TipoInscricao;
  /** CPF or CNPJ, digits only. */
  numeroInscricao: string;
  nome: string;
  endereco: string;
  cep: string;
  cidade: string;
  bairro: string;
  uf: string;
  telefone?: string;
  email?: string;
}

export interface BeneficiarioFinal {
  tipoInscricao: TipoInscricao;
  numeroInscricao: string;
  nome: string;
}

/** 0 = none, 1 = fixed amount until a date, 2 = percentage until a date. */
export interface Desconto {
  tipo: 0 | 1 | 2;
  dataExpiracao?: string;
  valor?: number;
  porcentagem?: number;
}

/** 0 = waived, 1 = fixed amount per day, 2 = monthly rate, 3 = exempt. */
export interface JurosMora {
  tipo: 0 | 1 | 2 | 3;
  valor?: number;
  porcentagem?: number;
}

/** 0 = none, 1 = fixed amount, 2 = percentage. */
export interface Multa {
  tipo: 0 | 1 | 2;
  data?: string;
  valor?: number;
  porcentagem?: number;
}

/** Body of `POST /boletos`. */
export interface CreateBoletoRequest {
  numeroConvenio: number;
  numeroCarteira: number;
  numeroVariacaoCarteira: number;
  /** 1 = simple, 4 = linked. */
  codigoModalidade: 1 | 4;
  dataEmissao: string;
  dataVencimento: string;
  valorOriginal: number;
  valorAbatimento?: number;
  quantidadeDiasProtesto?: number;
  quantidadeDiasNegativacao?: number;
  orgaoNegativador?: number;
  indicadorAceiteTituloVencido?: "S" | "N";
  numeroDiasLimiteRecebimento?: number;
  codigoAceite: "A" | "N";
  codigoTipoTitulo: number;
  descricaoTipoTitulo?: string;
  indicadorPermissaoRecebimentoParcial: "S" | "N";
  numeroTituloBeneficiario: string;
  campoUtilizacaoBeneficiario?: string;
  /** 20 digits: "000" + 7-digit agreement + 10-digit sequence. See `buildNumeroTituloCliente`. */
  numeroTituloCliente: string;
  mensagemBloquetoOcorrencia?: string;
  desconto?: Desconto;
  segundoDesconto?: Omit<Desconto, "tipo">;
  terceiroDesconto?: Omit<Desconto, "tipo">;
  jurosMora?: JurosMora;
  multa?: Multa;
  pagador: Pagador;
  beneficiarioFinal?: BeneficiarioFinal;
  /** "S" registers a PIX QR code together with the boleto. */
  indicadorPix?: "S" | "N";
}

/**
 * What `createBoleto` accepts: the agreement fields default to the client's
 * configured agreement, so callers usually leave them out.
 */
export type CreateBoletoInput = Omit<
  CreateBoletoRequest,
  "numeroConvenio" | "numeroCarteira" | "numeroVariacaoCarteira"
> &
  Partial<Pick<CreateBoletoRequest, "numeroConvenio" | "numeroCarteira" | "numeroVariacaoCarteira">>;

export interface QrCode {
  url?: string;
  txId?: string;
  emv?: string;
}

export interface CreateBoletoResponse {
  numero: string;
  numeroCarteira: number;
  numeroVariacaoCarteira: number;
  codigoCliente: number;
  linhaDigitavel: string;
  codigoBarraNumerico: string;
  numeroContratoCobranca: number;
  beneficiario?: Record<string, unknown>;
  qrCode?: QrCode;
  [field: string]: unknown;
}

/** Query of `GET /boletos`. */
export interface ListBoletosParams {
  /** "A" = open, "B" = settled/written off. */
  indicadorSituacao: "A" | "B";
  /** Defaults to the client's configured branch and account. */
  agenciaBeneficiario?: string | number;
  contaBeneficiario?: string | number;
  carteiraConvenio?: number;
  variacaoCarteiraConvenio?: number;
  modalidadeCobranca?: 1 | 4;
  cnpjPagador?: string;
  digitoCNPJPagador?: string;
  cpfPagador?: string;
  digitoCPFPagador?: string;
  dataInicioVencimento?: string;
  dataFimVencimento?: string;
  dataInicioRegistro?: string;
  dataFimRegistro?: string;
  dataInicioMovimento?: string;
  dataFimMovimento?: string;
  codigoEstadoTituloCobranca?: number;
  boletoVencido?: "S" | "N";
  /** Pagination cursor returned as `proximoIndice`. */
  indice?: number;
}

export interface BoletoSummary {
  numeroBoletoBB: string;
  estadoTituloCobranca: string;
  dataRegistro: string;
  dataVencimento: string;
  dataMovimento: string;
  valorOriginal: number;
  valorAtual: number;
  valorPago: number;
  [field: string]: unknown;
}

export interface ListBoletosResponse {
  indicadorContinuidade: "S" | "N";
  quantidadeRegistros: number;
  proximoIndice: number;
  boletos: BoletoSummary[];
}

/**
 * Body of `PATCH /boletos/{id}`. Each change is a pair of an `indicadorX: "S"`
 * flag plus an `alteracaoX` object, as described in the BB documentation.
 */
export interface UpdateBoletoRequest {
  numeroConvenio?: number;
  [field: string]: unknown;
}

export type BoletoDetails = Record<string, unknown>;
