import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { abrirDb, ahora, hoy, SUCURSALES } from './db.js';
import { crearApi, catalogoPublico, registrarConsulta, ErrorApi } from './api.js';
import { extensionImagen } from './imagenes.js';
import { sincronizar, intercambiarCodigoPorTokens } from './drive.js';

const BASE = path.dirname(fileURLToPath(import.meta.url));
const DIR_DATOS = path.resolve(process.env.IZEL_DATOS || path.join(BASE, 'data'));
const DIR_CATALOGO = path.resolve(BASE, '..', 'catalogo');
const DIR_ADMIN = path.join(BASE, 'public');
const DIR_UPLOADS = path.join(DIR_DATOS, 'uploads');
const DIR_BACKUPS = path.join(DIR_DATOS, 'backups');
const PUERTO = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DETRAS_DE_PROXY = process.env.TRUST_PROXY === '1';
const DIAS_SESION = 14;
const ORIGEN_CATALOGO = process.env.CATALOGO_ORIGEN || '*';

// Login con Google: se activa solo si están las dos variables. Si no, el sistema sigue
// funcionando exactamente como antes (clave única y código de instalación).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CORREOS_AUTORIZADOS = String(process.env.IZEL_CORREOS_AUTORIZADOS || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const GOOGLE_ACTIVO = Boolean(GOOGLE_CLIENT_ID && CORREOS_AUTORIZADOS.length);
const GOOGLE_TOKENINFO_URL = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';

// Catálogo desde Google Drive: también opt-in, independiente del login con Google de arriba
// (usa el mismo Client ID, pero necesita además el Client Secret porque pide un refresh token).
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DRIVE_ACTIVO = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API_URL = process.env.GOOGLE_DRIVE_API_URL || 'https://www.googleapis.com/drive/v3';

const db = abrirDb(DIR_DATOS, path.join(DIR_CATALOGO, 'data', 'productos.json'));
const api = crearApi(db);

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

/* ---- Contraseña y sesiones ---- */
function hashClave(clave, sal = crypto.randomBytes(16).toString('hex')) {
  return `${sal}:${crypto.scryptSync(clave, sal, 64).toString('hex')}`;
}
function claveCorrecta(clave, guardada) {
  const [sal, hash] = guardada.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(clave, sal, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Igual que con X-Forwarded-For: sólo se confía en este header si de verdad hay un proxy
// delante (TRUST_PROXY=1) que lo esté poniendo él mismo. Sin eso, cualquiera podría mandarlo
// mintiendo que la conexión es HTTPS cuando en realidad no pasó por ningún proxy.
function esHttps(req) {
  return DETRAS_DE_PROXY && req.headers['x-forwarded-proto'] === 'https';
}
function crearSesion(req, res, email = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = Date.now() + DIAS_SESION * 864e5;
  db.run('INSERT INTO sesiones (token, expira, email) VALUES (?, ?, ?)', hashToken(token), expira, email);
  db.run('DELETE FROM sesiones WHERE expira < ?', Date.now());
  const seguro = esHttps(req) ? '; Secure' : '';
  res.setHeader('set-cookie', `izel_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DIAS_SESION * 86400}${seguro}`);
}
function tokenDe(req) {
  return /(?:^|;\s*)izel_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
}
function logueado(req) {
  const t = tokenDe(req);
  return Boolean(t && db.get('SELECT 1 x FROM sesiones WHERE token = ? AND expira > ?', hashToken(t), Date.now()));
}
// La sucursal activa se guarda en la sesión: se puede cambiar en cualquier momento sin volver a loguearse.
function sucursalDeSesion(req) {
  const t = tokenDe(req);
  return db.get('SELECT sucursal FROM sesiones WHERE token = ? AND expira > ?', hashToken(t), Date.now())?.sucursal || SUCURSALES[0];
}
// Con login de Google, la sesión queda atada al mail con el que se entró.
function emailDeSesion(req) {
  const t = tokenDe(req);
  return db.get('SELECT email FROM sesiones WHERE token = ? AND expira > ?', hashToken(t), Date.now())?.email || '';
}

// Valida un ID token de Google Identity Services contra el propio Google (sin ninguna
// librería: un GET al endpoint público de verificación) y devuelve el mail si es válido,
// es de este sistema (aud) y está en la lista de autorizados.
function verificarCredencialGoogle(credential) {
  return new Promise((resolver, rechazar) => {
    if (!credential) return rechazar(new ErrorApi(400, 'Falta la credencial de Google'));
    const urlVerificacion = new URL(GOOGLE_TOKENINFO_URL);
    urlVerificacion.searchParams.set('id_token', credential);
    // En producción esto siempre es https (el endpoint real de Google); el módulo http sólo
    // se usa cuando las pruebas apuntan GOOGLE_TOKENINFO_URL a un servidor de prueba en http.
    const cliente = urlVerificacion.protocol === 'http:' ? http : https;
    cliente.get(urlVerificacion, (r) => {
      const partes = [];
      r.on('data', (c) => partes.push(c));
      r.on('end', () => {
        let datos;
        try { datos = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { datos = {}; }
        if (r.statusCode !== 200 || !datos.email) return rechazar(new ErrorApi(401, 'No se pudo verificar la cuenta de Google'));
        if (datos.aud !== GOOGLE_CLIENT_ID) return rechazar(new ErrorApi(401, 'La cuenta de Google no es para este sistema'));
        if (datos.email_verified !== 'true' && datos.email_verified !== true) return rechazar(new ErrorApi(401, 'El mail de Google no está verificado'));
        const email = String(datos.email).toLowerCase();
        if (!CORREOS_AUTORIZADOS.includes(email)) return rechazar(new ErrorApi(403, 'Esta cuenta no está autorizada'));
        resolver(email);
      });
    }).on('error', () => rechazar(new ErrorApi(502, 'No se pudo contactar a Google')));
  });
}

// Código que se muestra sólo en la consola del servidor: evita que un extraño cree la clave en un sistema recién publicado.
function codigoInstalacion() {
  let c = db.conf('codigo_instalacion');
  if (!c) {
    c = process.env.IZEL_CODIGO_INSTALACION || crypto.randomBytes(4).toString('hex');
    db.setConf('codigo_instalacion', c);
  }
  return c;
}

// Si se define IZEL_CLAVE_INICIAL, el sistema arranca con esa contraseña ya puesta: no pide código de instalación
// y nadie que entre primero puede elegir su propia clave.
if (!db.conf('clave') && process.env.IZEL_CLAVE_INICIAL) {
  db.setConf('clave', hashClave(process.env.IZEL_CLAVE_INICIAL));
}

/* ---- Límites de intentos ---- */
const intentos = new Map();
// Si hay un solo proxy de confianza adelante (como en Render), el ÚLTIMO valor de X-Forwarded-For
// es el que ese proxy vio de verdad; el primero lo puede escribir cualquiera con el cliente
// (mandando su propio header), así que usarlo dejaría rotar la IP y saltarse el límite de intentos.
const ipDe = (req) => (DETRAS_DE_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress;
function limite(clave, max, ms) {
  const ahoraMs = Date.now();
  const e = intentos.get(clave);
  if (!e || e.hasta < ahoraMs) { intentos.set(clave, { n: 1, hasta: ahoraMs + ms }); return true; }
  e.n += 1;
  return e.n <= max;
}
setInterval(() => {
  for (const [k, e] of intentos) if (e.hasta < Date.now()) intentos.delete(k);
}, 36e5).unref();

// Estado de un solo uso del flujo OAuth de Google Drive (ver /api/drive/conectar y /callback):
// la cookie de sesión es SameSite=Strict, así que no llega en la vuelta desde accounts.google.com
// (navegación cross-site). Por eso esta autorización se valida con este token, no con la cookie.
const estadosDrive = new Map();
let sincronizandoDrive = false;
setInterval(() => {
  for (const [k, vencimiento] of estadosDrive) if (vencimiento < Date.now()) estadosDrive.delete(k);
}, 6e4).unref();

/* ---- Utilidades HTTP ---- */
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function leerCuerpo(req, max) {
  const partes = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > max) throw new ErrorApi(413, 'El archivo es demasiado grande');
    partes.push(c);
  }
  return Buffer.concat(partes);
}
async function leerJson(req, max = 1e6) {
  const crudo = await leerCuerpo(req, max);
  if (!crudo.length) return {};
  try { return JSON.parse(crudo.toString('utf8')); } catch { throw new ErrorApi(400, 'Datos no válidos'); }
}
function servirArchivo(res, raiz, relativo, extra = {}) {
  const ruta = path.resolve(raiz, `.${relativo}`);
  if (ruta !== raiz && !ruta.startsWith(raiz + path.sep)) return false;
  let info;
  try { info = fs.statSync(ruta); } catch { return false; }
  if (!info.isFile()) return false;
  const tipo = TIPOS[path.extname(ruta).toLowerCase()];
  if (!tipo) return false;
  res.writeHead(200, { 'content-type': tipo, 'content-length': info.size, 'x-content-type-options': 'nosniff', ...extra });
  fs.createReadStream(ruta).pipe(res);
  return true;
}
function origenValido(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try { return new URL(origen).host === req.headers.host; } catch { return false; }
}

/* ---- Copias de seguridad ---- */
function copiaDe(destino) {
  fs.rmSync(destino, { force: true });
  db.raw.prepare('VACUUM INTO ?').run(destino);
}
function copiaDiaria() {
  // Nunca deja que un backup que falla (disco lleno, etc.) tire abajo el servidor: si algo sale
  // mal acá, sólo se pierde la copia de hoy, no las ventas ni el catálogo. Se escribe primero a un
  // nombre temporal y recién se renombra al definitivo si VACUUM INTO terminó bien, para que un
  // backup cortado a la mitad no quede "dado por hecho" durante 14 días.
  try {
    fs.mkdirSync(DIR_BACKUPS, { recursive: true });
    const destino = path.join(DIR_BACKUPS, `izel-${hoy()}.db`);
    if (!fs.existsSync(destino)) {
      const temporal = `${destino}.tmp`;
      copiaDe(temporal);
      fs.renameSync(temporal, destino);
    }
    const copias = fs.readdirSync(DIR_BACKUPS).filter((n) => n.endsWith('.db')).sort();
    for (const vieja of copias.slice(0, -14)) fs.rmSync(path.join(DIR_BACKUPS, vieja));
  } catch (e) {
    console.error('La copia de seguridad diaria falló (se reintenta en la próxima corrida):', e.message);
  }
}

/* ---- Catálogo desde Google Drive ---- */
// Revisa una vez por día si es sábado y todavía no sincronizó hoy; si hace falta, dispara
// sincronizar() en segundo plano (no bloquea el arranque ni el resto del servidor).
function sincronizacionSemanal() {
  if (!DRIVE_ACTIVO || sincronizandoDrive) return;
  const h = hoy();
  const esSabado = new Date(`${h}T12:00:00Z`).getUTCDay() === 6;
  if (!esSabado || db.conf('drive_ultima_sincronizacion', '').slice(0, 10) === h) return;
  sincronizandoDrive = true;
  sincronizar(db, {
    dirUploads: DIR_UPLOADS, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET,
    tokenUrl: GOOGLE_OAUTH_TOKEN_URL, driveApiUrl: GOOGLE_DRIVE_API_URL,
  })
    .catch((e) => console.error('Sincronización de Google Drive falló:', e.message))
    .finally(() => { sincronizandoDrive = false; });
}

/* ---- Rutas ---- */
async function rutaPublica(req, res, ruta) {
  if (!['/api/catalogo', '/api/consultas', '/api/acceso-gestion'].includes(ruta)) return false;
  res.setHeader('access-control-allow-origin', ORIGEN_CATALOGO);
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  if (ruta === '/api/catalogo' && req.method === 'GET') { json(res, 200, catalogoPublico(db)); return true; }
  if (ruta === '/api/consultas' && req.method === 'POST') {
    if (!limite(`consulta:${ipDe(req)}`, 30, 36e5)) throw new ErrorApi(429, 'Demasiadas consultas');
    registrarConsulta(db, (await leerJson(req, 5000)).codigos);
    json(res, 200, { ok: true });
    return true;
  }
  // El catálogo público pregunta esto para saber si le muestra o no el link a gestión:
  // no crea sesión ni toca contraseñas, sólo confirma si ese mail de Google está autorizado.
  if (ruta === '/api/acceso-gestion' && req.method === 'POST') {
    if (!GOOGLE_ACTIVO) { json(res, 200, { autorizada: false }); return true; }
    if (!limite(`acceso-gestion:${ipDe(req)}`, 30, 36e5)) throw new ErrorApi(429, 'Demasiados intentos');
    try {
      await verificarCredencialGoogle(String((await leerJson(req, 5000)).credential || ''));
      json(res, 200, { autorizada: true });
    } catch {
      json(res, 200, { autorizada: false });
    }
    return true;
  }
  throw new ErrorApi(405, 'Método no permitido');
}

async function rutaSesion(req, res, ruta) {
  if (ruta === '/api/sesion' && req.method === 'GET') {
    const estaLogueado = logueado(req);
    json(res, 200, {
      configurado: GOOGLE_ACTIVO || Boolean(db.conf('clave')),
      logueado: estaLogueado,
      sucursal: estaLogueado ? sucursalDeSesion(req) : null,
      google: GOOGLE_ACTIVO,
      googleClientId: GOOGLE_ACTIVO ? GOOGLE_CLIENT_ID : null,
      email: estaLogueado ? emailDeSesion(req) : null,
      driveActivo: DRIVE_ACTIVO,
      driveConectado: DRIVE_ACTIVO && Boolean(db.conf('drive_refresh_token')),
    });
    return true;
  }
  if (ruta === '/api/instalar' && req.method === 'POST') {
    if (GOOGLE_ACTIVO) throw new ErrorApi(404, 'Ruta inexistente');
    if (db.conf('clave')) throw new ErrorApi(409, 'El sistema ya tiene contraseña');
    if (!limite(`login:${ipDe(req)}`, 5, 9e5)) throw new ErrorApi(429, 'Demasiados intentos. Probá en 15 minutos');
    const b = await leerJson(req);
    if (b.codigo !== codigoInstalacion()) throw new ErrorApi(403, 'El código de instalación no es correcto');
    if (String(b.clave || '').length < 8) throw new ErrorApi(400, 'La contraseña debe tener al menos 8 caracteres');
    db.setConf('clave', hashClave(b.clave));
    intentos.delete(`login:${ipDe(req)}`);
    crearSesion(req, res);
    json(res, 200, { ok: true });
    return true;
  }
  if (ruta === '/api/login' && req.method === 'POST') {
    if (GOOGLE_ACTIVO) throw new ErrorApi(404, 'Ruta inexistente');
    const clave = `login:${ipDe(req)}`;
    if (!limite(clave, 5, 9e5)) throw new ErrorApi(429, 'Demasiados intentos. Probá en 15 minutos');
    const b = await leerJson(req);
    const guardada = db.conf('clave');
    if (!guardada || !claveCorrecta(String(b.clave || ''), guardada)) throw new ErrorApi(401, 'Contraseña incorrecta');
    intentos.delete(clave);
    crearSesion(req, res);
    json(res, 200, { ok: true });
    return true;
  }
  if (ruta === '/api/login-google' && req.method === 'POST') {
    if (!GOOGLE_ACTIVO) throw new ErrorApi(404, 'Ruta inexistente');
    const b = await leerJson(req);
    const email = await verificarCredencialGoogle(String(b.credential || ''));
    const clave = `login:${email}`;
    if (!limite(clave, 5, 9e5)) throw new ErrorApi(429, 'Demasiados intentos. Probá en 15 minutos');
    const fila = db.get('SELECT clave FROM usuarios WHERE email = ?', email);
    if (!fila) {
      // Primera vez que entra este mail: todavía no eligió contraseña.
      if (!b.clave) { json(res, 200, { email, nueva: true }); return true; }
      if (String(b.clave).length < 8) throw new ErrorApi(400, 'La contraseña debe tener al menos 8 caracteres');
      db.run('INSERT INTO usuarios (email, clave, creado) VALUES (?, ?, ?)', email, hashClave(b.clave), ahora());
      intentos.delete(clave);
      crearSesion(req, res, email);
      json(res, 200, { ok: true });
      return true;
    }
    if (!b.clave) { json(res, 200, { email, nueva: false }); return true; }
    if (!claveCorrecta(String(b.clave), fila.clave)) throw new ErrorApi(401, 'Contraseña incorrecta');
    intentos.delete(clave);
    crearSesion(req, res, email);
    json(res, 200, { ok: true });
    return true;
  }
  // Google vuelve acá después de que alguien autoriza el acceso a Drive (ver /api/drive/conectar,
  // en rutaPrivada). Es una navegación de nivel superior entre sitios: la cookie de sesión no llega
  // (SameSite=Strict), así que esto se autoriza con el "state" de un solo uso, no con la cookie.
  if (ruta === '/api/drive/callback' && req.method === 'GET') {
    const q = new URL(req.url, 'http://local').searchParams;
    if (q.get('error')) { res.writeHead(302, { location: '/gestion/#/ajustes?drive=cancelado' }); res.end(); return true; }
    const state = q.get('state') || '';
    const vencimiento = estadosDrive.get(state);
    estadosDrive.delete(state);
    if (!vencimiento || vencimiento < Date.now()) throw new ErrorApi(400, 'El enlace de conexión con Google Drive venció o ya se usó. Probá de nuevo desde Ajustes');
    const redirectUri = `${esHttps(req) ? 'https' : 'http'}://${req.headers.host}/api/drive/callback`;
    const tokens = await intercambiarCodigoPorTokens(String(q.get('code') || ''), {
      clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri, tokenUrl: GOOGLE_OAUTH_TOKEN_URL,
    });
    if (!tokens.refresh_token) {
      throw new ErrorApi(409, 'Google no devolvió un acceso permanente (puede pasar si ya se había conectado antes). Entrá a myaccount.google.com/permissions, quitale el acceso a este sistema y volvé a intentar');
    }
    db.setConf('drive_refresh_token', tokens.refresh_token);
    res.writeHead(302, { location: '/gestion/#/ajustes' });
    res.end();
    return true;
  }
  return false;
}

async function rutaPrivada(req, res, ruta, url) {
  if (req.method !== 'GET' && !origenValido(req)) throw new ErrorApi(403, 'Origen no permitido');
  if (!logueado(req)) throw new ErrorApi(401, 'Tenés que iniciar sesión');

  if (ruta === '/api/logout' && req.method === 'POST') {
    db.run('DELETE FROM sesiones WHERE token = ?', hashToken(tokenDe(req)));
    res.setHeader('set-cookie', 'izel_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/sucursal' && req.method === 'POST') {
    const b = await leerJson(req);
    if (!SUCURSALES.includes(b.sucursal)) throw new ErrorApi(400, 'Sucursal no válida');
    db.run('UPDATE sesiones SET sucursal = ? WHERE token = ?', b.sucursal, hashToken(tokenDe(req)));
    return json(res, 200, { sucursal: b.sucursal });
  }
  if (ruta === '/api/clave' && req.method === 'POST') {
    const b = await leerJson(req);
    if (String(b.nueva || '').length < 8) throw new ErrorApi(400, 'La contraseña debe tener al menos 8 caracteres');
    if (GOOGLE_ACTIVO) {
      const email = emailDeSesion(req);
      const fila = db.get('SELECT clave FROM usuarios WHERE email = ?', email);
      if (!fila || !claveCorrecta(String(b.actual || ''), fila.clave)) throw new ErrorApi(403, 'La contraseña actual no es correcta');
      db.run('UPDATE usuarios SET clave = ? WHERE email = ?', hashClave(b.nueva), email);
      db.run('DELETE FROM sesiones WHERE email = ?', email);
      crearSesion(req, res, email);
      return json(res, 200, { ok: true });
    }
    if (!claveCorrecta(String(b.actual || ''), db.conf('clave'))) throw new ErrorApi(403, 'La contraseña actual no es correcta');
    db.setConf('clave', hashClave(b.nueva));
    db.run('DELETE FROM sesiones');
    crearSesion(req, res);
    return json(res, 200, { ok: true });
  }
  if (ruta === '/api/imagenes' && req.method === 'POST') {
    const crudo = await leerCuerpo(req, 8e6);
    const ext = extensionImagen(crudo);
    if (!ext) throw new ErrorApi(400, 'El archivo no es una imagen válida');
    const nombre = crypto.randomBytes(12).toString('hex') + ext;
    fs.writeFileSync(path.join(DIR_UPLOADS, nombre), crudo);
    return json(res, 200, { imagen: `uploads/${nombre}` });
  }
  if (ruta === '/api/drive/conectar' && req.method === 'GET') {
    if (!DRIVE_ACTIVO) throw new ErrorApi(404, 'Ruta inexistente');
    const state = crypto.randomBytes(24).toString('hex');
    estadosDrive.set(state, Date.now() + 6e5);
    const redirectUri = `${esHttps(req) ? 'https' : 'http'}://${req.headers.host}/api/drive/callback`;
    const parametros = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.readonly', access_type: 'offline', prompt: 'consent', state,
    });
    res.writeHead(302, { location: `${GOOGLE_OAUTH_AUTH_URL}?${parametros.toString()}` });
    res.end();
    return undefined;
  }
  if (ruta === '/api/drive/sincronizar' && req.method === 'POST') {
    if (!DRIVE_ACTIVO) throw new ErrorApi(404, 'Ruta inexistente');
    if (sincronizandoDrive) throw new ErrorApi(409, 'Ya hay una sincronización en curso');
    sincronizandoDrive = true;
    try {
      return json(res, 200, await sincronizar(db, {
        dirUploads: DIR_UPLOADS, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET,
        tokenUrl: GOOGLE_OAUTH_TOKEN_URL, driveApiUrl: GOOGLE_DRIVE_API_URL,
      }));
    } finally {
      sincronizandoDrive = false;
    }
  }
  if (ruta === '/api/backup' && req.method === 'GET') {
    const temporal = path.join(DIR_DATOS, `descarga-${crypto.randomBytes(4).toString('hex')}.db`);
    copiaDe(temporal);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="izel-joyas-${hoy()}.db"`,
    });
    const s = fs.createReadStream(temporal);
    s.pipe(res);
    s.on('close', () => fs.rmSync(temporal, { force: true }));
    return undefined;
  }

  const cuerpo = ['POST', 'PUT'].includes(req.method) ? await leerJson(req) : {};
  return json(res, 200, api(req.method, ruta, Object.fromEntries(url.searchParams), cuerpo, sucursalDeSesion(req)));
}

// Con Google activado hace falta poder cargar su script, su hoja de estilos y los estilos que
// pone al vuelo sobre el botón (no hay forma de evitar el 'unsafe-inline' ahí: el botón de Google
// no se puede armar con hash ni nonce), y mostrarlo en un iframe propio.
const CSP_ADMIN = GOOGLE_ACTIVO
  ? "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://accounts.google.com 'unsafe-inline'; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  : "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

async function atender(req, res) {
  const url = new URL(req.url, 'http://local');
  const ruta = decodeURIComponent(url.pathname);

  if (ruta.startsWith('/api/')) {
    if (await rutaPublica(req, res, ruta)) return;
    if (await rutaSesion(req, res, ruta)) return;
    await rutaPrivada(req, res, ruta, url);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErrorApi(405, 'Método no permitido');

  if (ruta === '/gestion') { res.writeHead(301, { location: '/gestion/' }); res.end(); return; }
  if (ruta.startsWith('/gestion/')) {
    const relativo = ruta === '/gestion/' ? '/index.html' : ruta.slice('/gestion'.length);
    const cabeceras = { 'content-security-policy': CSP_ADMIN, 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache' };
    if (servirArchivo(res, DIR_ADMIN, relativo, cabeceras)) return;
  } else if (ruta.startsWith('/uploads/')) {
    if (servirArchivo(res, DIR_UPLOADS, ruta.slice('/uploads'.length), { 'cache-control': 'public, max-age=31536000, immutable' })) return;
  } else if (servirArchivo(res, DIR_CATALOGO, ruta === '/' ? '/index.html' : ruta, { 'cache-control': 'public, max-age=300' })) {
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('No encontrado');
}

const servidor = http.createServer((req, res) => {
  atender(req, res).catch((e) => {
    if (res.headersSent) { res.destroy(); return; }
    if (e instanceof ErrorApi) { json(res, e.status, { error: e.message }); return; }
    if (e instanceof URIError) { json(res, 400, { error: 'Dirección no válida' }); return; }
    console.error(e);
    json(res, 500, { error: 'Ocurrió un error inesperado' });
  });
});

servidor.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`
  El puerto ${PUERTO} ya está en uso: probablemente el sistema ya esté abierto en otra ventana.
`);
  process.exit(1);
});

servidor.listen(PUERTO, HOST, () => {
  console.log(`\n  Izel Joyas funcionando`);
  console.log(`  Catálogo: http://localhost:${PUERTO}/`);
  console.log(`  Gestión:  http://localhost:${PUERTO}/gestion/\n`);
  if (GOOGLE_ACTIVO) console.log(`  Acceso con Google activado (${CORREOS_AUTORIZADOS.length} mail${CORREOS_AUTORIZADOS.length === 1 ? '' : 'es'} autorizado${CORREOS_AUTORIZADOS.length === 1 ? '' : 's'})\n`);
  else if (!db.conf('clave')) console.log(`  Código de instalación (se pide una sola vez): ${codigoInstalacion()}\n`);
  copiaDiaria();
  setInterval(copiaDiaria, 6 * 36e5).unref();
  sincronizacionSemanal();
  setInterval(sincronizacionSemanal, 6 * 36e5).unref();
});
