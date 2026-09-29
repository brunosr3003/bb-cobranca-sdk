import assert from "node:assert/strict";
import { test } from "node:test";
import { BBApiError, BBAuthError, BBCobranca, buildNumeroTituloCliente, formatBBDate } from "../src/index.js";

interface Call {
  url: URL;
  init: RequestInit;
}

/** A fake fetch that serves a token and then replies from `handler`. */
function fakeFetch(handler: (call: Call) => Response | Promise<Response>, tokenLifetimeS = 600) {
  const calls: Call[] = [];
  let tokens = 0;
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), init };
    calls.push(call);
    if (call.url.pathname === "/oauth/token") {
      tokens++;
      return Response.json({ access_token: `token-${tokens}`, expires_in: tokenLifetimeS });
    }
    return handler(call);
  }) as typeof fetch;
  return { impl, calls, tokenCount: () => tokens };
}

const agreement = {
  numeroConvenio: 3128557,
  numeroCarteira: 17,
  numeroVariacaoCarteira: 35,
  agencia: "452",
  conta: "123873",
};

function client(fetch: typeof globalThis.fetch, extra = {}) {
  return new BBCobranca({ clientId: "id", clientSecret: "secret", appKey: "app-key", agreement, fetch, ...extra });
}

test("createBoleto fills in the agreement and sends app key and bearer token", async () => {
  const f = fakeFetch(() => Response.json({ numero: "00031285570000000001", linhaDigitavel: "0019..." }, { status: 201 }));
  const bb = client(f.impl);
  const res = await bb.createBoleto({
    codigoModalidade: 1,
    dataEmissao: "01.10.2026",
    dataVencimento: "31.10.2026",
    valorOriginal: 123.45,
    codigoAceite: "A",
    codigoTipoTitulo: 2,
    indicadorPermissaoRecebimentoParcial: "N",
    numeroTituloBeneficiario: "INV-1",
    numeroTituloCliente: "00031285570000000001",
    pagador: {
      tipoInscricao: 2, numeroInscricao: "74910037000193", nome: "Test Payer",
      endereco: "Rua A 1", cep: "77458000", cidade: "Sucupira", bairro: "Centro", uf: "TO",
    },
  });
  assert.equal(res.numero, "00031285570000000001");

  const [auth, api] = f.calls;
  assert.equal(auth.url.href, "https://oauth.hm.bb.com.br/oauth/token");
  assert.equal((auth.init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("id:secret").toString("base64")}`);
  assert.match(String(auth.init.body), /grant_type=client_credentials/);

  assert.equal(api.url.origin + api.url.pathname, "https://api.hm.bb.com.br/cobrancas/v2/boletos");
  assert.equal(api.url.searchParams.get("gw-dev-app-key"), "app-key");
  assert.equal((api.init.headers as Record<string, string>).Authorization, "Bearer token-1");
  const body = JSON.parse(String(api.init.body));
  assert.equal(body.numeroConvenio, 3128557);
  assert.equal(body.numeroCarteira, 17);
  assert.equal(body.numeroVariacaoCarteira, 35);
});

test("production environment uses the production hosts", async () => {
  const f = fakeFetch(() => Response.json({}));
  await client(f.impl, { environment: "production" }).getBoleto("00031285570000000001");
  assert.equal(f.calls[0].url.host, "oauth.bb.com.br");
  assert.equal(f.calls[1].url.host, "api.bb.com.br");
  assert.equal(f.calls[1].url.searchParams.get("numeroConvenio"), "3128557");
});

test("the token is cached and shared by concurrent calls", async () => {
  const f = fakeFetch(() => Response.json({}));
  const bb = client(f.impl);
  await Promise.all([bb.getBoleto("1"), bb.getBoleto("2"), bb.getBoleto("3")]);
  await bb.getBoleto("4");
  assert.equal(f.tokenCount(), 1);
});

test("a token close to expiry is refreshed", async () => {
  const f = fakeFetch(() => Response.json({}), 10); // 10 s lifetime, inside the 30 s margin
  const bb = client(f.impl);
  await bb.getBoleto("1");
  await bb.getBoleto("2");
  assert.equal(f.tokenCount(), 2);
});

test("a 401 drops the token and retries once", async () => {
  let first = true;
  const f = fakeFetch(() => {
    if (first) {
      first = false;
      return new Response("", { status: 401 });
    }
    return Response.json({ ok: true });
  });
  const res = await client(f.impl).getBoleto("1");
  assert.deepEqual(res, { ok: true });
  assert.equal(f.tokenCount(), 2);
});

test("API errors become BBApiError with BB's error list", async () => {
  const f = fakeFetch(() =>
    Response.json({ erros: [{ codigo: "4874915", mensagem: "Nosso Numero ja incluido anteriormente." }] }, { status: 400 }),
  );
  await assert.rejects(client(f.impl).writeOffBoleto("1"), (err: unknown) => {
    assert.ok(err instanceof BBApiError);
    assert.equal(err.status, 400);
    assert.equal(err.details[0].codigo, "4874915");
    assert.match(err.message, /Nosso Numero ja incluido/);
    return true;
  });
});

test("OAuth failures become BBAuthError", async () => {
  const impl = (async () => Response.json({ error: "invalid_client" }, { status: 401 })) as typeof fetch;
  await assert.rejects(client(impl).getBoleto("1"), (err: unknown) => {
    assert.ok(err instanceof BBAuthError);
    assert.equal(err.status, 401);
    return true;
  });
});

test("listAllBoletos follows proximoIndice until indicadorContinuidade is N", async () => {
  const pages: Record<string, unknown> = {
    "": { indicadorContinuidade: "S", proximoIndice: 2, quantidadeRegistros: 2, boletos: [{ numeroBoletoBB: "a" }, { numeroBoletoBB: "b" }] },
    "2": { indicadorContinuidade: "N", proximoIndice: 0, quantidadeRegistros: 1, boletos: [{ numeroBoletoBB: "c" }] },
  };
  const f = fakeFetch(({ url }) => Response.json(pages[url.searchParams.get("indice") ?? ""]));
  const ids: unknown[] = [];
  for await (const b of client(f.impl).listAllBoletos({ indicadorSituacao: "A" })) ids.push(b.numeroBoletoBB);
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.equal(f.calls[1].url.searchParams.get("agenciaBeneficiario"), "452");
  assert.equal(f.calls[1].url.searchParams.get("contaBeneficiario"), "123873");
});

test("constructor validates required options", () => {
  assert.throws(() => new BBCobranca({ clientId: "", clientSecret: "s", appKey: "k", agreement }), /clientId/);
});

test("formatBBDate uses dd.mm.aaaa", () => {
  assert.equal(formatBBDate(new Date(2026, 0, 5)), "05.01.2026");
});

test("buildNumeroTituloCliente pads to 20 digits and rejects bad input", () => {
  assert.equal(buildNumeroTituloCliente(3128557, 1), "00031285570000000001");
  assert.equal(buildNumeroTituloCliente("123", "42").length, 20);
  assert.throws(() => buildNumeroTituloCliente(12345678, 1), RangeError);
  assert.throws(() => buildNumeroTituloCliente(3128557, "12345678901"), RangeError);
});
