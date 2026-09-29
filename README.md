# bb-cobranca-sdk

A TypeScript client for the **Banco do Brasil Cobranças v2 API**, used to register and manage *boletos* (Brazilian bank slips) and their PIX QR codes.

- **No runtime dependencies:** it uses the `fetch` built into Node.js 18+.
- **OAuth handled for you:** tokens are cached, refreshed before they expire, and shared between concurrent calls. This matters in the sandbox, which only allows a handful of calls every 10 minutes.
- **Fully typed** requests and responses, with field names kept exactly as in BB's documentation.
- **Typed errors** that expose BB's `erros` list (code and message) instead of a raw HTTP body.
- **Multiple agreements:** one client per *convênio*, so a company with several agreements, or several companies, never mixes them up.

## Install

```sh
npm install github:brunosr3003/bb-cobranca-sdk
```

## Quick start

```ts
import { BBCobranca, buildNumeroTituloCliente, formatBBDate } from "bb-cobranca-sdk";

const bb = new BBCobranca({
  environment: "sandbox", // or "production"
  clientId: process.env.BB_CLIENT_ID!,
  clientSecret: process.env.BB_CLIENT_SECRET!,
  appKey: process.env.BB_APP_KEY!,
  agreement: {
    numeroConvenio: 3128557,
    numeroCarteira: 17,
    numeroVariacaoCarteira: 35,
    agencia: "452",
    conta: "123873",
  },
});

const boleto = await bb.createBoleto({
  numeroTituloCliente: buildNumeroTituloCliente(3128557, 1), // "00031285570000000001"
  numeroTituloBeneficiario: "INV-0001",
  codigoModalidade: 1,
  dataEmissao: formatBBDate(new Date()),
  dataVencimento: "31.12.2026",
  valorOriginal: 123.45,
  codigoAceite: "A",
  codigoTipoTitulo: 2,
  indicadorPermissaoRecebimentoParcial: "N",
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

console.log(boleto.linhaDigitavel); // payment line
console.log(boleto.qrCode?.emv);    // PIX copy-and-paste code
```

The agreement values above are BB's public sandbox test data. A runnable version is in [`examples/create-boleto.ts`](examples/create-boleto.ts).

## API

| Method | Endpoint | Description |
|---|---|---|
| `createBoleto(input)` | `POST /boletos` | Register a boleto. `numeroConvenio`, `numeroCarteira` and `numeroVariacaoCarteira` default to the client's agreement |
| `getBoleto(id)` | `GET /boletos/{id}` | Full details of a boleto, including payment status |
| `listBoletos(params)` | `GET /boletos` | One page of boletos. Branch and account default to the agreement |
| `listAllBoletos(params)` | `GET /boletos` | Async iterator over every page (`for await ... of`) |
| `updateBoleto(id, changes)` | `PATCH /boletos/{id}` | Change due date, amount, discounts, fees… |
| `writeOffBoleto(id)` | `POST /boletos/{id}/baixar` | Cancel ("baixar") an open boleto |
| `createPix(id)` | `POST /boletos/{id}/gerar-pix` | Attach a PIX QR code to an existing boleto |
| `getPix(id)` | `GET /boletos/{id}/pix` | Read the PIX QR code of a boleto |
| `cancelPix(id)` | `POST /boletos/{id}/cancelar-pix` | Remove the PIX QR code |
| `request(method, path, opts)` | any | Low-level call with auth, app key and error handling, for endpoints not wrapped above |
| `getAccessToken()` | OAuth | The current token, if you need it elsewhere |

`id` is always the 20-digit `numeroTituloCliente`.

### Helpers

- `buildNumeroTituloCliente(convenio, sequence)` builds the 20-digit identifier BB requires: `"000"` + the 7-digit agreement number + your 10-digit sequence. It must be unique within the agreement.
- `formatBBDate(date)` formats a date as `dd.mm.aaaa`, the only date format the API accepts.

### Errors

```ts
import { BBApiError, BBAuthError } from "bb-cobranca-sdk";

try {
  await bb.writeOffBoleto(id);
} catch (err) {
  if (err instanceof BBApiError) {
    console.log(err.status);  // 400
    console.log(err.details); // [{ codigo: "4874915", mensagem: "..." }]
  } else if (err instanceof BBAuthError) {
    // wrong credentials, or the app is not enabled for Cobranças
  }
}
```

A `401` from the API (a token revoked on BB's side) drops the cached token and retries the request once.

## Options

| Option | Default | Description |
|---|---|---|
| `clientId`, `clientSecret` | required | OAuth credentials from the [BB Developers portal](https://app.developers.bb.com.br) |
| `appKey` | required | Sent as `gw-dev-app-key` ("developer_application_key" in the portal) |
| `agreement` | required | `numeroConvenio`, `numeroCarteira`, `numeroVariacaoCarteira`, `agencia`, `conta` |
| `environment` | `"sandbox"` | `"sandbox"` (`*.hm.bb.com.br`) or `"production"` (`*.bb.com.br`) |
| `scope` | read + write | OAuth scopes. `""` omits the parameter |
| `fetch` | global `fetch` | Custom fetch, for example one with a client certificate (see below) |
| `oauthUrl`, `apiBaseUrl` | per environment | Override the endpoints (proxies, gateways) |
| `tokenRefreshMarginMs` | `30000` | Refresh the token this long before it expires |
| `timeoutMs` | `30000` | Timeout for every HTTP request |

### Mutual TLS

If BB requires a client certificate for your production application, pass a `fetch` that presents it, for example with [undici](https://github.com/nodejs/undici):

```ts
import { Agent, fetch as undiciFetch } from "undici";
import { readFileSync } from "node:fs";

const dispatcher = new Agent({
  connect: { cert: readFileSync("client.crt"), key: readFileSync("client.key") },
});

const bb = new BBCobranca({
  environment: "production",
  // ...credentials and agreement
  fetch: ((url, init) => undiciFetch(url, { ...init, dispatcher })) as typeof fetch,
});
```

## Things worth knowing about this API

- Every request needs **both** the OAuth token and the `gw-dev-app-key` query parameter. The client adds both.
- **Dates are `dd.mm.aaaa`** everywhere. ISO dates are rejected.
- `numeroTituloCliente` is **yours to generate** and must be unique per agreement. Reusing one returns an error even if the previous boleto was cancelled.
- The sandbox is heavily **rate limited**. Reuse one client instance instead of creating one per request, so the token cache works.
- Credentials are per application **and** per environment. Sandbox credentials do not work in production.

## Development

```sh
npm install
npm test          # unit tests with a mocked fetch, no credentials needed
npm run typecheck
npm run build
```

## License

[MIT](LICENSE) © Bruno Soares Reis

Not affiliated with or endorsed by Banco do Brasil S.A.
