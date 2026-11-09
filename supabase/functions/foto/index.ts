// ══════════════════════════════════════════════════════════════════
// FOTO — Edge Function de Supabase (Tecsul S.A.E.) · SQL 102 / v20261106
//
// Las fotos de la app viven en la unidad compartida «Fotos Tecsul» de
// Drive, que es PRIVADA. La app no puede mostrarlas directo (operadores y
// despachadores no tienen cuenta de Google), así que se las pide a esta
// función:
//
//   GET /functions/v1/foto?id=<id de Drive>&w=<ancho>
//   Authorization: Bearer <sesión del usuario>      (la manda la app)
//
// La función lee Drive con una CUENTA DE SERVICIO de Google que es
// miembro (Lector) de esa unidad compartida, y devuelve la imagen.
//   · w < 1000 → miniatura de Drive de ese tamaño (rápido, liviano)
//   · si no    → el archivo (ya achicado a 1600 px al copiarlo)
// Solo responde a usuarios con sesión iniciada y solo archivos de la
// unidad compartida de fotos.
//
// Secretos (Supabase › Edge Functions › Secrets):
//   GOOGLE_SA_JSON   el JSON completo de la clave de la cuenta de servicio
//   FOTOS_DRIVE_ID   el ID de la unidad compartida (lo que sigue a
//                    /drive/folders/ en la dirección de la unidad)
// ══════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const texto = (msg: string, estado: number) =>
  new Response(msg, { status: estado, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });

const SA = (() => {
  try { return JSON.parse(Deno.env.get('GOOGLE_SA_JSON') ?? ''); } catch { return null; }
})();
const DRIVE_FOTOS = (Deno.env.get('FOTOS_DRIVE_ID') ?? '').trim();
const API = 'https://www.googleapis.com/drive/v3/files/';

// ── Token de Google de la cuenta de servicio (se reusa ~55 min) ──────
let token: { t: string; vence: number } | null = null;

function b64url(datos: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : new Uint8Array(datos);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function tokenGoogle(): Promise<string> {
  if (token && token.vence > Date.now() + 60_000) return token.t;
  const pem = String(SA.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const clave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600,
  }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(cuerpo));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: cuerpo + '.' + b64url(firma) }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('Google no dio el token: ' + (j.error_description || j.error || r.status));
  token = { t: j.access_token, vence: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.t;
}

// ── Datos del archivo (se recuerdan 50 min: el link de miniatura vence) ─
type Meta = { mimeType: string; driveId?: string; thumbnailLink?: string; trashed?: boolean; vence: number };
const metas = new Map<string, Meta>();

async function meta(id: string, t: string): Promise<Meta | null> {
  const m = metas.get(id);
  if (m && m.vence > Date.now()) return m;
  const r = await fetch(`${API}${id}?fields=mimeType,driveId,thumbnailLink,trashed&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const nuevo: Meta = { ...j, vence: Date.now() + 50 * 60_000 };
  if (metas.size > 5000) metas.clear();
  metas.set(id, nuevo);
  return nuevo;
}

// ── Quién pide: solo sesiones de usuario (la anon key no alcanza) ────
function esUsuario(req: Request): boolean {
  const a = req.headers.get('authorization') || '';
  const jwt = a.replace(/^Bearer\s+/i, '');
  try {
    const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.role === 'authenticated' && (!p.exp || p.exp * 1000 > Date.now());
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return texto('Solo GET', 405);
  // La firma del token la verifica Supabase antes de llegar acá (verify_jwt)
  if (!esUsuario(req)) return texto('Iniciá sesión para ver la foto', 401);
  if (!SA) return texto('Falta el secreto GOOGLE_SA_JSON', 500);

  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  if (!/^[\w-]{10,200}$/.test(id)) return texto('id inválido', 400);
  const w = Math.max(64, Math.min(2000, parseInt(u.searchParams.get('w') || '1600', 10) || 1600));

  try {
    const t = await tokenGoogle();
    const m = await meta(id, t);
    if (!m || m.trashed) return texto('No está la foto', 404);
    if (DRIVE_FOTOS && m.driveId !== DRIVE_FOTOS) return texto('Esa foto no es de la unidad de fotos', 403);

    let r: Response | null = null;
    if (w < 1000 && m.thumbnailLink) {
      r = await fetch(m.thumbnailLink.replace(/=s\d+[^/]*$/, `=s${w}`), { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) { await r.body?.cancel(); r = null; }
    }
    if (!r) {
      r = await fetch(`${API}${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) { metas.delete(id); return texto('Drive no devolvió la foto (' + r.status + ')', 502); }
    }
    return new Response(r.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': r.headers.get('content-type') || m.mimeType || 'image/jpeg',
        'Cache-Control': 'private, max-age=2592000, immutable',   // la foto de un id no cambia
      },
    });
  } catch (e) {
    return texto('Error: ' + (e instanceof Error ? e.message : String(e)), 500);
  }
});
