#!/usr/bin/env node
// Pasarela SOLO PARA PRUEBAS E2E (nunca en producción). Imita la parte de
// Supabase que la app usa, para probar las pantallas con sesión en un navegador:
//   - /rest/v1/*     -> PostgREST real sobre la base de pruebas (RLS real).
//   - /auth/v1/*     -> Auth simulado: contraseña de pruebas fija, JWT HS256 con
//                       aal1/aal2 y un factor TOTP verificado para los roles que
//                       exigen MFA (código de pruebas fijo).
//   - /storage/v1/*  -> Storage simulado: registra el objeto en storage.objects a
//                       través de PostgREST con la sesión de la persona (las
//                       políticas de Storage se aplican igual) y guarda los bytes
//                       en memoria; firma URL que caducan a los 60 s.
// Usa solo módulos de Node. Los datos son las semillas sintéticas de supabase/seeds.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.E2E_GATEWAY_PORT ?? 54321);
const POSTGREST = process.env.E2E_POSTGREST_URL ?? "http://127.0.0.1:54322";
const SECRET = process.env.E2E_JWT_SECRET;
// Credenciales de PRUEBA del entorno E2E (no existen fuera de él).
const TEST_PASSWORD = "Prueba-E2E-2026";
const TEST_TOTP_CODE = "123456";
// Cuentas sintéticas con roles que exigen segundo factor (ADR-053).
const MFA_EMAILS = new Set([
  "admin.grupo@grupo-demo.example",
  "admin@alfa-demo.example",
  "rrhh@alfa-demo.example",
  "contabilidad@alfa-demo.example",
  "auditoria@alfa-demo.example",
  "admin@beta-demo.example",
]);

if (!SECRET || SECRET.length < 32) {
  console.error("Falta E2E_JWT_SECRET (mínimo 32 caracteres).");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payload) => {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
function verify(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}

const SERVICE_TOKEN = sign({
  role: "service_role",
  iss: "e2e",
  exp: Math.floor(Date.now() / 1000) + 86400 * 30,
});
const factorId = (userId) => `f${userId.slice(1)}`;

async function profileBy(field, value) {
  const res = await fetch(
    `${POSTGREST}/profiles?select=id,email,full_name&${field}=eq.${encodeURIComponent(value)}`,
    {
      headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
    },
  );
  const rows = res.ok ? await res.json() : [];
  return rows[0] ?? null;
}

function userObject(p) {
  const mfa = MFA_EMAILS.has(p.email);
  return {
    id: p.id,
    aud: "authenticated",
    role: "authenticated",
    email: p.email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: p.full_name },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    factors: mfa
      ? [
          {
            id: factorId(p.id),
            friendly_name: "Aplicación de pruebas",
            factor_type: "totp",
            status: "verified",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]
      : [],
  };
}

function session(p, aal) {
  const now = Math.floor(Date.now() / 1000);
  const amr =
    aal === "aal2"
      ? [
          { method: "totp", timestamp: now },
          { method: "password", timestamp: now },
        ]
      : [{ method: "password", timestamp: now }];
  const access = sign({
    sub: p.id,
    email: p.email,
    role: "authenticated",
    aud: "authenticated",
    aal,
    amr,
    session_id: randomUUID(),
    iat: now,
    exp: now + 3600,
  });
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `rt.${b64url(JSON.stringify({ id: p.id, aal, n: randomUUID() }))}`,
    user: userObject(p),
  };
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const authError = (res, status, code, msg) =>
  json(res, status, { code: status, error_code: code, msg });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

// Bytes de los objetos subidos (memoria del proceso de pruebas).
const blobs = new Map();
const signed = new Map();

async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/token" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const p = body.email ? await profileBy("email", String(body.email).toLowerCase()) : null;
      if (!p || body.password !== TEST_PASSWORD)
        return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      return json(res, 200, session(p, "aal1"));
    }
    if (grant === "refresh_token") {
      const raw = String(body.refresh_token ?? "");
      if (!raw.startsWith("rt."))
        return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      const data = JSON.parse(Buffer.from(raw.slice(3), "base64url").toString());
      const p = await profileBy("id", data.id);
      if (!p) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      return json(res, 200, session(p, data.aal));
    }
    return authError(res, 400, "unsupported_grant_type", "Unsupported grant type");
  }
  const claims = verify(bearer(req));
  if (path === "/logout") return json(res, 204);
  if (!claims?.sub) return authError(res, 401, "bad_jwt", "invalid JWT");
  const p = await profileBy("id", claims.sub);
  if (!p) return authError(res, 404, "user_not_found", "User not found");
  if (path === "/user" && req.method === "GET") return json(res, 200, userObject(p));
  if (path === "/user" && req.method === "PUT") return json(res, 200, userObject(p));
  const challenge = /^\/factors\/([^/]+)\/challenge$/.exec(path);
  if (challenge && req.method === "POST") {
    return json(res, 200, {
      id: randomUUID(),
      type: "totp",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
  }
  const verifyMatch = /^\/factors\/([^/]+)\/verify$/.exec(path);
  if (verifyMatch && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (verifyMatch[1] !== factorId(p.id) || body.code !== TEST_TOTP_CODE)
      return authError(res, 422, "mfa_verification_failed", "Invalid TOTP code entered");
    return json(res, 200, session(p, "aal2"));
  }
  if (path === "/factors" && req.method === "POST") {
    return json(res, 200, {
      id: randomUUID(),
      type: "totp",
      friendly_name: "Nueva",
      totp: {
        qr_code:
          "data:image/svg+xml;utf-8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>",
        secret: "PRUEBASE2E",
        uri: "otpauth://totp/pruebas",
      },
    });
  }
  if (/^\/factors\/[^/]+$/.test(path) && req.method === "DELETE")
    return json(res, 200, { id: path.slice(9) });
  return authError(res, 404, "not_found", "Not found");
}

async function postgrest(method, path, token, body, profile = "storage") {
  return fetch(`${POSTGREST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Profile": profile,
      "Content-Profile": profile,
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function handleStorage(req, res, url) {
  const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  const token = bearer(req);
  const claims = verify(token);
  const signedGet = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(path);
  if (signedGet && req.method === "GET") {
    const entry = signed.get(url.searchParams.get("token") ?? "");
    if (!entry || entry.exp < Date.now())
      return json(res, 400, { error: "InvalidJWT", message: "Token caducado" });
    const blob = blobs.get(`${entry.bucket}/${entry.name}`);
    res.writeHead(200, { "Content-Type": blob?.type ?? "application/octet-stream" });
    return res.end(blob?.bytes ?? Buffer.alloc(0));
  }
  if (!claims?.sub) return json(res, 400, { error: "Unauthorized", message: "invalid JWT" });
  if (signedGet && req.method === "POST") {
    const [, bucket, name] = signedGet;
    const check = await fetch(
      `${POSTGREST}/objects?select=name&bucket_id=eq.${encodeURIComponent(bucket)}&name=eq.${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${token}`, "Accept-Profile": "storage" } },
    );
    const rows = check.ok ? await check.json() : [];
    if (rows.length === 0)
      return json(res, 400, { error: "not_found", message: "Object not found" });
    const t = randomUUID();
    signed.set(t, { bucket, name, exp: Date.now() + 60_000 });
    return json(res, 200, {
      signedURL: `/object/sign/${bucket}/${encodeURIComponent(name)}?token=${t}`,
    });
  }
  const upload = /^\/object\/([^/]+)\/(.+)$/.exec(path);
  if (upload && (req.method === "POST" || req.method === "PUT")) {
    const [, bucket, name] = upload;
    const bytes = await readBody(req);
    const r = await postgrest("POST", "/objects", token, {
      bucket_id: bucket,
      name,
      owner: claims.sub,
    });
    if (!r.ok) {
      const exists = r.status === 409;
      return json(res, exists ? 409 : 403, {
        statusCode: exists ? "409" : "403",
        error: exists ? "Duplicate" : "Unauthorized",
        message: exists
          ? "The resource already exists"
          : "new row violates row-level security policy",
      });
    }
    blobs.set(`${bucket}/${name}`, {
      bytes,
      type: req.headers["content-type"] ?? "application/octet-stream",
    });
    return json(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
  }
  return json(res, 404, { error: "not_found", message: "Not found" });
}

async function proxyRest(req, res, url) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (["host", "connection", "content-length", "apikey"].includes(k)) continue;
    headers[k] = v;
  }
  // Sin sesión, los clientes envían la clave publicable como Bearer: es anónimo.
  if (headers.authorization && !/^Bearer\s+eyJ/i.test(String(headers.authorization)))
    delete headers.authorization;
  const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await readBody(req);
  const upstream = await fetch(
    `${POSTGREST}${url.pathname.replace(/^\/rest\/v1/, "")}${url.search}`,
    {
      method: req.method,
      headers,
      body,
    },
  );
  const out = {};
  upstream.headers.forEach((v, k) => {
    if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v;
  });
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

// Consultas a la API de datos por persona (sub del JWT): presupuesto de consultas por
// página sin que interfieran otras pruebas que corren en paralelo.
const restCalls = new Map();
const bearerSub = (req) => {
  const m = /^Bearer\s+(eyJ\S+)$/i.exec(String(req.headers.authorization ?? ""));
  return m ? (verify(m[1])?.sub ?? null) : null;
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    // Equivalente a la comprobación de salud de Supabase Auth (GoTrue).
    if (url.pathname === "/auth/v1/health") return json(res, 200, { name: "pasarela-e2e" });
    if (url.pathname === "/__e2e/consultas") {
      const p = await profileBy("email", String(url.searchParams.get("email") ?? "").toLowerCase());
      if (!p) return json(res, 404, { message: "Not found" });
      if (req.method === "DELETE") restCalls.set(p.id, 0);
      return json(res, 200, { count: restCalls.get(p.id) ?? 0 });
    }
    if (url.pathname.startsWith("/rest/v1")) {
      const sub = bearerSub(req);
      if (sub) restCalls.set(sub, (restCalls.get(sub) ?? 0) + 1);
      return await proxyRest(req, res, url);
    }
    if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url);
    if (url.pathname.startsWith("/storage/v1")) return await handleStorage(req, res, url);
    return json(res, 404, { message: "Not found" });
  } catch (error) {
    console.error("Error en la pasarela E2E", error instanceof Error ? error.name : "desconocido");
    json(res, 500, { message: "Error de la pasarela de pruebas" });
  }
}).listen(PORT, "127.0.0.1", () => console.warn(`Pasarela E2E en http://127.0.0.1:${PORT}`));
