import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { abrirDb, hoy, SUCURSALES } from './db.js';
import { crearApi, catalogoPublico, registrarConsulta, ErrorApi } from './api.js';

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

function crearSesion(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = Date.now() + DIAS_SESION * 864e5;
  db.run('INSERT INTO sesiones (token, expira) VALUES (?, ?)', hashToken(token), expira);
  db.run('DELETE FROM sesiones WHERE expira < ?', Date.now());
  const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
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
const ipDe = (req) => (DETRAS_DE_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
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
function extensionImagen(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
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
  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
  const destino = path.join(DIR_BACKUPS, `izel-${hoy()}.db`);
  if (!fs.existsSync(destino)) copiaDe(destino);
  for (const viejo of fs.readdirSync(DIR_BACKUPS).sort().slice(0, -14)) fs.rmSync(path.join(DIR_BACKUPS, viejo));
}

/* ---- Rutas ---- */
async function rutaPublica(req, res, ruta) {
  if (ruta !== '/api/catalogo' && ruta !== '/api/consultas') return false;
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
  throw new ErrorApi(405, 'Método no permitido');
}

async function rutaSesion(req, res, ruta) {
  if (ruta === '/api/sesion' && req.method === 'GET') {
    json(res, 200, { configurado: Boolean(db.conf('clave')), logueado: logueado(req), sucursal: logueado(req) ? sucursalDeSesion(req) : null });
    return true;
  }
  if (ruta === '/api/instalar' && req.method === 'POST') {
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
    if (!claveCorrecta(String(b.actual || ''), db.conf('clave'))) throw new ErrorApi(403, 'La contraseña actual no es correcta');
    if (String(b.nueva || '').length < 8) throw new ErrorApi(400, 'La contraseña debe tener al menos 8 caracteres');
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

const CSP_ADMIN = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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
  if (!db.conf('clave')) console.log(`  Código de instalación (se pide una sola vez): ${codigoInstalacion()}\n`);
  copiaDiaria();
  setInterval(copiaDiaria, 6 * 36e5).unref();
});
