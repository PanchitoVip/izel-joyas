import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ahora } from './db.js';
import { siguienteCodigo } from './api.js';
import { extensionImagen } from './imagenes.js';

// Semilla de la lista de subcarpetas que no se sincronizan (texto libre, separado por comas,
// editable desde Ajustes: `drive_excluir` en la tabla config). Por ahora, a pedido del usuario,
// los insumos para fabricar/reparar ("Fornituras") quedan afuera hasta que decida qué hacer con ellos.
export const EXCLUSION_DEFECTO = 'Fornituras';

// Mismo truco que verificarCredencialGoogle en server.js: en producción siempre es https
// (los endpoints reales de Google); el módulo http sólo se usa cuando los tests apuntan
// las URLs a un servidor de prueba en http.
function pedir(metodo, urlStr, { headers = {}, cuerpo } = {}) {
  return new Promise((resolver, rechazar) => {
    const u = new URL(urlStr);
    const cliente = u.protocol === 'http:' ? http : https;
    const req = cliente.request(u, { method: metodo, headers }, (r) => {
      const partes = [];
      r.on('data', (c) => partes.push(c));
      r.on('end', () => resolver({ status: r.statusCode, cuerpo: Buffer.concat(partes) }));
    });
    req.on('error', rechazar);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}
function json(respuesta) {
  try { return JSON.parse(respuesta.cuerpo.toString('utf8') || '{}'); } catch { return {}; }
}

// Intercambia el código de autorización por tokens. Se usa una sola vez, en el callback
// de /api/drive/conectar (ver server.js). Hace falta el Client Secret (a diferencia del
// login con Google, que sólo usa el ID token y no necesita este paso).
export async function intercambiarCodigoPorTokens(code, { clientId, clientSecret, redirectUri, tokenUrl }) {
  const cuerpo = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
  }).toString();
  const r = await pedir('POST', tokenUrl, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(cuerpo) },
    cuerpo,
  });
  const datos = json(r);
  if (r.status !== 200 || !datos.access_token) throw new Error(datos.error_description || 'No se pudo completar la conexión con Google Drive');
  return datos; // { access_token, refresh_token?, expires_in }
}

// Access token cacheado en memoria del módulo: dura ~1 hora, no hace falta pedir uno por archivo.
let cacheToken = { token: null, expira: 0 };
async function obtenerAccessToken(refreshToken, { clientId, clientSecret, tokenUrl }) {
  if (cacheToken.token && cacheToken.expira > Date.now() + 5000) return cacheToken.token;
  const cuerpo = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  }).toString();
  const r = await pedir('POST', tokenUrl, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(cuerpo) },
    cuerpo,
  });
  const datos = json(r);
  if (r.status !== 200 || !datos.access_token) throw new Error('No se pudo renovar el acceso a Google Drive. Puede hacer falta reconectar desde Ajustes');
  cacheToken = { token: datos.access_token, expira: Date.now() + Number(datos.expires_in || 3600) * 1000 };
  return cacheToken.token;
}

function listarCarpeta(accessToken, folderId, { driveApiUrl }, pageToken) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType)',
    pageSize: '1000',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return pedir('GET', `${driveApiUrl}/files?${params.toString()}`, { headers: { authorization: `Bearer ${accessToken}` } })
    .then((r) => {
      const datos = json(r);
      if (r.status !== 200) throw new Error(datos.error?.message || 'No se pudo listar la carpeta de Google Drive');
      return datos;
    });
}

// Recorre la carpeta recursivamente. Si una subcarpeta está en la lista de exclusión,
// corta todo ese subárbol (no sólo ese nivel). Devuelve una lista plana de imágenes,
// cada una con el nombre de su carpeta contenedora inmediata (sugerencia de categoría).
async function listarImagenesDrive(accessToken, folderId, exclusiones, opts, carpetaInmediata = '') {
  const imagenes = [];
  let pageToken;
  do {
    const datos = await listarCarpeta(accessToken, folderId, opts, pageToken);
    for (const f of datos.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        if (exclusiones.has(String(f.name).trim().toLowerCase())) continue;
        imagenes.push(...await listarImagenesDrive(accessToken, f.id, exclusiones, opts, f.name));
      } else if (typeof f.mimeType === 'string' && f.mimeType.startsWith('image/')) {
        imagenes.push({ id: f.id, nombre: f.name, carpetaInmediata });
      }
    }
    pageToken = datos.nextPageToken;
  } while (pageToken);
  return imagenes;
}

function descargarImagenDrive(accessToken, fileId, { driveApiUrl }, maxBytes = 8e6) {
  return new Promise((resolver, rechazar) => {
    const u = new URL(`${driveApiUrl}/files/${fileId}?alt=media`);
    const cliente = u.protocol === 'http:' ? http : https;
    const req = cliente.get(u, { headers: { authorization: `Bearer ${accessToken}` } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); rechazar(new Error('No se pudo descargar una imagen de Google Drive')); return; }
      const partes = [];
      let total = 0;
      r.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) { r.destroy(); rechazar(new Error('Una imagen de Google Drive superó el límite de tamaño')); return; }
        partes.push(c);
      });
      r.on('end', () => resolver(Buffer.concat(partes)));
      r.on('error', rechazar);
    });
    req.on('error', rechazar);
  });
}

// Las fotos del proveedor vienen pesadas (varios cientos de KB, a veces más de 1MB, tamaño de
// cámara/celular). Achicarlas antes de guardarlas es lo que de verdad cuida el disco: una carpeta
// grande del proveedor no tiene por qué llenarlo, sea cual sea su tamaño original. Mismo criterio
// que ya usa la subida manual de fotos (máx. 1000px, JPEG calidad 85), pero del lado del servidor.
async function comprimirImagen(binario) {
  return sharp(binario).rotate().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

// Idempotente: se puede correr todas las veces que haga falta (a demanda o por el programador
// semanal en server.js) sin duplicar productos ni pisar lo que la dueña ya cargó a mano.
export async function sincronizar(db, opts) {
  const refreshToken = db.conf('drive_refresh_token', '');
  const folderId = db.conf('drive_carpeta_id', '');
  if (!refreshToken) return { ok: false, motivo: 'Todavía no se conectó Google Drive' };
  if (!folderId) return { ok: false, motivo: 'Falta cargar la carpeta de Google Drive en Ajustes' };
  const exclusiones = new Set(
    db.conf('drive_excluir', EXCLUSION_DEFECTO).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  const omitidos = [];
  let nuevos = 0;
  let marcadosARevisar = 0;
  let sinEspacio = false;
  try {
    const accessToken = await obtenerAccessToken(refreshToken, opts);
    const encontrados = await listarImagenesDrive(accessToken, folderId, exclusiones, opts);
    const idsEncontrados = new Set(encontrados.map((f) => f.id));
    for (const img of encontrados) {
      if (db.get('SELECT id FROM productos WHERE drive_file_id = ?', img.id)) continue;
      const binario = await descargarImagenDrive(accessToken, img.id, opts);
      const ext = extensionImagen(binario);
      if (!ext) { omitidos.push(img.nombre); continue; }
      const nombreArchivo = `${crypto.randomBytes(12).toString('hex')}.jpg`;
      const comprimida = await comprimirImagen(binario);
      try {
        fs.writeFileSync(path.join(opts.dirUploads, nombreArchivo), comprimida);
      } catch (e) {
        // Si en algún momento el disco se llena igual (una carpeta enorme, un disco chico):
        // frenar acá, dejar lo que ya se sincronizó, y retomar justo donde quedó la próxima vez
        // (las fotos ya guardadas no se vuelven a descargar, por el chequeo de drive_file_id de arriba).
        if (e.code !== 'ENOSPC') throw e;
        sinEspacio = true;
        break;
      }
      db.run(
        `INSERT INTO productos (codigo, nombre, categoria, material, costo, precio, imagen, publicado, revisar, drive_file_id)
         VALUES (?, '', ?, '', 0, 0, ?, 0, 1, ?)`,
        siguienteCodigo(db), img.carpetaInmediata || 'Otros', `uploads/${nombreArchivo}`, img.id,
      );
      nuevos += 1;
    }
    // Lo que ya estaba sincronizado y el proveedor sacó o movió: nunca se borra ni se despublica
    // solo (podría tener stock o ventas reales) — como mucho, vuelve a quedar a revisar.
    for (const p of db.all('SELECT id, drive_file_id FROM productos WHERE drive_file_id IS NOT NULL AND activo = 1 AND revisar = 0')) {
      if (!idsEncontrados.has(p.drive_file_id)) {
        db.run('UPDATE productos SET revisar = 1 WHERE id = ?', p.id);
        marcadosARevisar += 1;
      }
    }
    db.setConf('drive_ultima_sincronizacion', ahora());
    db.setConf('drive_ultimo_error', sinEspacio ? `Se quedó sin espacio en el disco: trajo ${nuevos} de ${encontrados.length} fotos. Libera espacio o agrandá el disco para traer el resto.` : '');
    return {
      ok: true, nuevos, marcados_a_revisar: marcadosARevisar, omitidos, encontrados: encontrados.length, sin_espacio: sinEspacio,
    };
  } catch (e) {
    db.setConf('drive_ultimo_error', e.message || 'Error desconocido al sincronizar con Google Drive');
    throw e;
  }
}
