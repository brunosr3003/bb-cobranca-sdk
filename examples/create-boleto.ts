/**
 * Registers a boleto in the BB sandbox and prints its payment line and PIX code.
 *
 *   BB_CLIENT_ID=... BB_CLIENT_SECRET=... BB_APP_KEY=... \
 *   BB_CONVENIO=3128557 BB_CARTEIRA=17 BB_VARIACAO=35 BB_AGENCIA=452 BB_CONTA=123873 \
 *   npx tsx examples/create-boleto.ts
 *
 * The agreement values above are BB's public sandbox test data.
 */
import { BBApiError, BBCobranca, buildNumeroTituloCliente, formatBBDate } from "../src/index.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const bb = new BBCobranca({
  environment: "sandbox",
  clientId: env("BB_CLIENT_ID"),
  clientSecret: env("BB_CLIENT_SECRET"),
  appKey: env("BB_APP_KEY"),
  agreement: {
    numeroConvenio: Number(env("BB_CONVENIO")),
    numeroCarteira: Number(env("BB_CARTEIRA")),
    numeroVariacaoCarteira: Number(env("BB_VARIACAO")),
    agencia: env("BB_AGENCIA"),
    conta: env("BB_CONTA"),
  },
});

const today = new Date();
const dueDate = new Date(today.getTime() + 7 * 86_400_000);
// Use your own unique sequence (e.g. an invoice id). A timestamp is fine for a sandbox test.
const numeroTituloCliente = buildNumeroTituloCliente(bb.agreement.numeroConvenio, Date.now() % 1e10);

try {
  const boleto = await bb.createBoleto({
    codigoModalidade: 1,
    dataEmissao: formatBBDate(today),
    dataVencimento: formatBBDate(dueDate),
    valorOriginal: 123.45,
    codigoAceite: "A",
    codigoTipoTitulo: 2,
    indicadorPermissaoRecebimentoParcial: "N",
    numeroTituloBeneficiario: "INV-0001",
    numeroTituloCliente,
    indicadorPix: "S",
    pagador: {
      tipoInscricao: 2,
      numeroInscricao: "74910037000193",
      nome: "Test Payer Ltda",
      endereco: "Avenida Dias Gomes 1970",
      cep: "77458000",
      cidade: "Sucupira",
      bairro: "Centro",
      uf: "TO",
    },
  });
  console.log("Boleto:", boleto.numero);
  console.log("Payment line:", boleto.linhaDigitavel);
  console.log("PIX copy-and-paste:", boleto.qrCode?.emv ?? "(none)");
} catch (err) {
  if (err instanceof BBApiError) console.error(err.status, err.details);
  throw err;
}
