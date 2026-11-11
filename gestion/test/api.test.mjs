import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { abrirDb } from '../db.js';

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 3111;
const URL_BASE = `http://127.0.0.1:${PUERTO}`;
const CODIGO = 'codigo-prueba';
const CLAVE = 'clave-de-prueba-1';
let datos;
let servidor;
let cookie = '';

async function pedir(metodo, ruta, cuerpo, { sinSesion = false, headers = {} } = {}) {
  const r = await fetch(URL_BASE + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie && !sinSesion ? { cookie } : {}),
      ...headers,
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set && !sinSesion) cookie = set.split(';')[0];
  const texto = await r.text();
  let data;
  try { data = JSON.parse(texto); } catch { data = texto; }
  return { status: r.status, data, texto };
}
const ok = async (...a) => {
  const r = await pedir(...a);
  assert.equal(r.status, 200, `${a[0]} ${a[1]}: ${r.texto}`);
  return r.data;
};

before(async () => {
  datos = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-'));
  servidor = spawn(process.execPath, ['server.js'], {
    cwd: BASE,
    env: { ...process.env, PORT: String(PUERTO), IZEL_DATOS: datos, IZEL_CODIGO_INSTALACION: CODIGO },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(`${URL_BASE}/api/sesion`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('El servidor no arrancó');
});
after(async () => {
  servidor.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(datos, { recursive: true, force: true });
});

test('sin sesión no se accede a nada privado', async () => {
  for (const ruta of ['/api/productos', '/api/clientes', '/api/caja', '/api/ventas', '/api/resumen', '/api/backup', '/api/reportes']) {
    assert.equal((await pedir('GET', ruta)).status, 401, ruta);
  }
  assert.equal((await pedir('POST', '/api/ventas', {})).status, 401);
});

test('la instalación exige el código y una clave larga', async () => {
  assert.equal((await pedir('POST', '/api/instalar', { codigo: 'mal', clave: CLAVE })).status, 403);
  assert.equal((await pedir('POST', '/api/instalar', { codigo: CODIGO, clave: 'corta' })).status, 400);
  await ok('POST', '/api/instalar', { codigo: CODIGO, clave: CLAVE });
  assert.equal((await pedir('POST', '/api/instalar', { codigo: CODIGO, clave: CLAVE })).status, 409);
  assert.deepEqual((await ok('GET', '/api/sesion')), { configurado: true, logueado: true, sucursal: 'Moreno' });
});

test('con IZEL_CLAVE_INICIAL el sistema arranca con esa clave ya puesta, sin pedir código', async () => {
  const puerto = 3112;
  const urlBase = `http://127.0.0.1:${puerto}`;
  const datosPropios = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-clave-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BASE,
    env: { ...process.env, PORT: String(puerto), IZEL_DATOS: datosPropios, IZEL_CLAVE_INICIAL: 'clave-fijada-de-antemano' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(`${urlBase}/api/sesion`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const sesion = await (await fetch(`${urlBase}/api/sesion`)).json();
    assert.deepEqual(sesion, { configurado: true, logueado: false, sucursal: null });
    const rInstalar = await fetch(`${urlBase}/api/instalar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo: 'cualquiera', clave: 'otra-clave-cualquiera' }),
    });
    assert.equal(rInstalar.status, 409, 'nadie puede crear su propia clave: ya hay una puesta');
    const rMal = await fetch(`${urlBase}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave: 'cualquier-otra-cosa' }),
    });
    assert.equal(rMal.status, 401);
    const rLogin = await fetch(`${urlBase}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave: 'clave-fijada-de-antemano' }),
    });
    assert.equal(rLogin.status, 200);
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(datosPropios, { recursive: true, force: true });
  }
});

test('el catálogo público nunca expone precio, costo ni stock', async () => {
  const productos = await ok('GET', '/api/productos');
  assert.equal(productos.length, 30, 'arranca con los productos de Instagram');
  await ok('PUT', `/api/productos/${productos[0].id}`, { ...productos[0], costo: 123400, precio: 987600 });
  const r = await pedir('GET', '/api/catalogo', undefined, { sinSesion: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.productos.length, 30);
  for (const p of r.data.productos) {
    assert.deepEqual(Object.keys(p).sort(), ['agotado', 'categoria', 'codigo', 'descripcion', 'destacado', 'imagen', 'material', 'nombre']);
  }
  assert.ok(!r.texto.includes('987600') && !r.texto.includes('123400'));
});

test('sólo aparecen en el catálogo los productos publicados', async () => {
  const { id } = await ok('POST', '/api/productos', { nombre: 'Oculto', categoria: 'Aros', precio: 100, publicado: false });
  const antes = await ok('GET', '/api/catalogo');
  assert.ok(!antes.productos.some((p) => p.nombre === 'Oculto'));
  const p = (await ok('GET', '/api/productos')).find((x) => x.id === id);
  await ok('PUT', `/api/productos/${id}`, { ...p, publicado: true });
  assert.ok((await ok('GET', '/api/catalogo')).productos.some((x) => x.nombre === 'Oculto'));
  await ok('DELETE', `/api/productos/${id}`);
  assert.ok(!(await ok('GET', '/api/catalogo')).productos.some((x) => x.nombre === 'Oculto'));
});

let prod;
let proveedor;
let cliente;

test('una compra suma stock, actualiza costo y deja deuda con el proveedor', async () => {
  proveedor = (await ok('POST', '/api/proveedores', { nombre: 'Mayorista Plata' })).id;
  prod = (await ok('POST', '/api/productos', { nombre: 'Anillo prueba', categoria: 'Anillos', precio: 5000000 }));
  const c = await ok('POST', '/api/compras', {
    proveedor_id: proveedor, comprobante: 'R-1', items: [{ producto_id: prod.id, cantidad: 10, costo: 1000000 }],
    pago_monto: 4000000, pago_medio: 'Transferencia',
  });
  assert.equal(c.total, 10000000);
  const p = (await ok('GET', '/api/productos')).find((x) => x.id === prod.id);
  assert.equal(p.stock, 10);
  assert.equal(p.costo, 1000000);
  assert.equal((await ok('GET', `/api/proveedores/${proveedor}/cuenta`)).saldo, 6000000);
  await ok('POST', `/api/proveedores/${proveedor}/pago`, { monto: 6000000, medio: 'Efectivo' });
  assert.equal((await ok('GET', `/api/proveedores/${proveedor}/cuenta`)).saldo, 0);
});

test('una venta mixta descuenta stock, entra a caja y deja saldo en cuenta corriente', async () => {
  await ok('POST', '/api/caja', { tipo: 'ingreso', categoria: 'Saldo inicial', concepto: 'Apertura', medio: 'Efectivo', monto: 10000000 });
  cliente = (await ok('POST', '/api/clientes', { nombre: 'Ana Prueba', telefono: '1122334455', cumpleanos: '1990-05-10' })).id;
  const v = await ok('POST', '/api/ventas', {
    tipo: 'Comprobante interno', cliente_id: cliente,
    items: [{ producto_id: prod.id, cantidad: 2, precio: 5000000 }, { descripcion: 'Grabado', cantidad: 1, precio: 500000 }],
    descuento: 500000,
    pagos: [{ medio: 'Efectivo', monto: 3000000 }, { medio: 'Débito', monto: 2000000 }],
  });
  assert.equal(v.total, 10000000);
  assert.equal(v.numero, 1);
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 8);
  assert.equal((await ok('GET', `/api/clientes/${cliente}/cuenta`)).saldo, 5000000);
  const r = await ok('GET', '/api/resumen');
  assert.equal(r.a_cobrar, 5000000);
  assert.equal(r.hoy.ventas, 10000000);
  assert.equal(r.hoy.costo, 2000000);
  assert.equal(r.hoy.ganancia_bruta, 8000000);
  // 100.000 apertura - 60.000 pago al proveedor + 30.000 de la venta
  assert.equal(r.efectivo, 10000000 - 6000000 + 3000000);
});

test('no se vende fiado sin cliente, ni sin stock salvo confirmación, ni de más', async () => {
  const items = [{ producto_id: prod.id, cantidad: 1, precio: 5000000 }];
  assert.equal((await pedir('POST', '/api/ventas', { tipo: 'Comprobante interno', items, pagos: [] })).status, 400);
  assert.equal((await pedir('POST', '/api/ventas', { tipo: 'Comprobante interno', items, pagos: [{ medio: 'Efectivo', monto: 6000000 }] })).status, 400);
  const muchos = [{ producto_id: prod.id, cantidad: 99, precio: 1 }];
  assert.equal((await pedir('POST', '/api/ventas', { tipo: 'Comprobante interno', items: muchos, pagos: [{ medio: 'Efectivo', monto: 99 }] })).status, 409);
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 8, 'una venta rechazada no toca el stock');
});

test('cobrar la cuenta corriente entra a caja pero no cuenta como venta nueva', async () => {
  const antes = await ok('GET', '/api/resumen');
  await ok('POST', `/api/clientes/${cliente}/pago`, { monto: 2000000, medio: 'Efectivo' });
  const r = await ok('GET', '/api/resumen');
  assert.equal(r.a_cobrar, 3000000);
  assert.equal(r.efectivo, antes.efectivo + 2000000);
  assert.equal(r.hoy.ventas, antes.hoy.ventas);
  assert.equal(r.hoy.resultado, antes.hoy.resultado);
});

test('los gastos bajan el resultado; retiros y mercadería no se cuentan dos veces', async () => {
  const antes = (await ok('GET', '/api/resumen')).hoy.resultado;
  await ok('POST', '/api/caja', { tipo: 'egreso', categoria: 'Alquiler', concepto: 'Noviembre', medio: 'Transferencia', monto: 1500000 });
  await ok('POST', '/api/caja', { tipo: 'egreso', categoria: 'Retiro personal', concepto: 'Retiro', medio: 'Efectivo', monto: 100000 });
  assert.equal((await ok('GET', '/api/resumen')).hoy.resultado, antes - 1500000);
  assert.equal((await pedir('POST', '/api/caja', { tipo: 'ingreso', categoria: 'Venta', concepto: 'x', medio: 'Efectivo', monto: 1 })).status, 400);
});

test('anular una venta revierte stock, caja y cuenta corriente', async () => {
  const antes = await ok('GET', '/api/resumen');
  const { id } = await ok('POST', '/api/ventas', {
    tipo: 'Comprobante interno', cliente_id: cliente,
    items: [{ producto_id: prod.id, cantidad: 1, precio: 5000000 }],
    pagos: [{ medio: 'Efectivo', monto: 1000000 }],
  });
  await ok('POST', `/api/ventas/${id}/anular`);
  const r = await ok('GET', '/api/resumen');
  assert.equal(r.efectivo, antes.efectivo);
  assert.equal(r.a_cobrar, antes.a_cobrar);
  assert.equal(r.hoy.ventas, antes.hoy.ventas);
  assert.equal(r.hoy.resultado, antes.hoy.resultado);
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 8);
  assert.equal((await pedir('POST', `/api/ventas/${id}/anular`)).status, 400, 'no se anula dos veces');
});

test('el cierre de caja registra y ajusta la diferencia', async () => {
  const { efectivo } = await ok('GET', '/api/resumen');
  const c = await ok('POST', '/api/caja/cierre', { contado: efectivo - 5000 });
  assert.equal(c.diferencia, -5000);
  assert.equal((await ok('GET', '/api/resumen')).efectivo, efectivo - 5000);
});

test('arreglo: la seña entra a caja y al entregar se cobra el resto', async () => {
  const { efectivo } = await ok('GET', '/api/resumen');
  const { id } = await ok('POST', '/api/arreglos', { cliente_id: cliente, descripcion: 'Soldar cadena', precio: 800000, sena: 300000, medio: 'Efectivo' });
  await ok('POST', `/api/arreglos/${id}/estado`, { estado: 'entregado', medio: 'Efectivo' });
  assert.equal((await ok('GET', '/api/resumen')).efectivo, efectivo + 800000);
  assert.equal((await ok('GET', '/api/arreglos')).find((a) => a.id === id).pagado, 800000);
});

test('el aumento masivo de precios redondea y no toca los productos sin precio', async () => {
  const r = await ok('POST', '/api/productos/precios', { porcentaje: 10, categoria: 'Anillos', redondeo: 10000 });
  assert.ok(r.actualizados >= 1);
  const lista = await ok('GET', '/api/productos');
  assert.equal(lista.find((x) => x.id === prod.id).precio, 5500000);
  assert.ok(lista.filter((x) => x.categoria === 'Pulseras').every((x) => x.precio === 0));
});

test('las consultas de WhatsApp se cuentan y descartan códigos falsos', async () => {
  await ok('POST', '/api/consultas', { codigos: ['IZ-001', 'IZ-001', 'NO-EXISTE'] });
  const r = await ok('GET', '/api/reportes');
  assert.equal(r.consultas[0].codigo, 'IZ-001');
  assert.equal(r.consultas[0].veces, 2);
  assert.equal(r.consultas.length, 1);
});

test('el WhatsApp de ajustes llega al catálogo público', async () => {
  const a = await ok('GET', '/api/ajustes');
  await ok('PUT', '/api/ajustes', { ...a, whatsapp: '+54 9 11 2345-6789' });
  assert.equal((await ok('GET', '/api/catalogo')).tienda.whatsapp, '5491123456789');
});

test('se rechazan imágenes falsas, otros orígenes y rutas fuera de las carpetas', async () => {
  const subir = (b) => fetch(`${URL_BASE}/api/imagenes`, { method: 'POST', headers: { cookie, 'content-type': 'image/jpeg' }, body: b });
  assert.equal((await subir('<svg onload=alert(1)>')).status, 400);
  const bien = await subir(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  assert.equal(bien.status, 200);
  assert.match((await bien.json()).imagen, /^uploads\/[a-f0-9]+\.jpg$/);
  assert.equal((await pedir('POST', '/api/clientes', { nombre: 'x' }, { headers: { origin: 'https://malo.example' } })).status, 403);
  for (const r of ['/..%2f..%2fgestion%2fdata%2fizel.db', '/gestion/..%2f..%2fserver.js', '/uploads/..%2fizel.db', '/data/../../gestion/server.js']) {
    assert.equal((await fetch(URL_BASE + r)).status, 404, r);
  }
});

test('la copia de seguridad descarga una base válida', async () => {
  const r = await fetch(`${URL_BASE}/api/backup`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const b = Buffer.from(await r.arrayBuffer());
  assert.equal(b.subarray(0, 15).toString(), 'SQLite format 3');
});

test('Moreno y Morón no se pisan: clientes, stock y caja quedan separados por sucursal', async () => {
  assert.deepEqual(await ok('GET', '/api/sesion'), { configurado: true, logueado: true, sucursal: 'Moreno' });

  const clienteMoreno = (await ok('POST', '/api/clientes', { nombre: 'Cliente Moreno' })).id;
  await ok('POST', `/api/productos/${prod.id}/ajuste`, { cantidad: 5, motivo: 'Carga Moreno' });
  const stockMoreno = (await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock;

  const r = await ok('POST', '/api/sucursal', { sucursal: 'Morón' });
  assert.equal(r.sucursal, 'Morón');
  assert.equal((await ok('GET', '/api/sesion')).sucursal, 'Morón');

  assert.ok(!(await ok('GET', '/api/clientes')).some((c) => c.id === clienteMoreno), 'el cliente de Moreno no aparece en Morón');
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 0, 'Morón arranca sin el stock de Moreno');
  assert.equal(
    (await pedir('POST', '/api/ventas', {
      tipo: 'Comprobante interno', cliente_id: clienteMoreno,
      items: [{ producto_id: prod.id, cantidad: 1, precio: 100 }], pagos: [{ medio: 'Efectivo', monto: 100 }],
    })).status,
    404,
    'no se puede vender a un cliente de otra sucursal',
  );

  const clienteMoron = (await ok('POST', '/api/clientes', { nombre: 'Cliente Morón' })).id;
  await ok('POST', `/api/productos/${prod.id}/ajuste`, { cantidad: 3, motivo: 'Carga Morón' });
  await ok('POST', '/api/caja', { tipo: 'ingreso', categoria: 'Aporte', concepto: 'Apertura Morón', medio: 'Efectivo', monto: 999900 });
  assert.equal((await ok('GET', '/api/caja')).efectivo, 999900);
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 3);

  await ok('POST', '/api/sucursal', { sucursal: 'Moreno' });
  assert.ok((await ok('GET', '/api/clientes')).some((c) => c.id === clienteMoreno), 'Moreno conserva su cliente');
  assert.ok(!(await ok('GET', '/api/clientes')).some((c) => c.id === clienteMoron), 'el cliente de Morón no aparece en Moreno');
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, stockMoreno, 'el stock de Moreno no lo tocó lo cargado en Morón');
  assert.notEqual((await ok('GET', '/api/caja')).efectivo, 999900, 'la caja de Morón no se mezcla con la de Moreno');
});

test('cinco claves mal bloquean el login y cerrar sesión funciona', async () => {
  await ok('POST', '/api/logout', {});
  assert.deepEqual(await pedir('GET', '/api/sesion').then((r) => r.data.logueado), false);
  for (let i = 0; i < 5; i += 1) assert.equal((await pedir('POST', '/api/login', { clave: 'mala' }, { sinSesion: true })).status, 401);
  assert.equal((await pedir('POST', '/api/login', { clave: CLAVE }, { sinSesion: true })).status, 429);
});

test('una base creada antes de separar por sucursal migra sus datos a Moreno', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-migracion-'));
  const raw = new DatabaseSync(path.join(dir, 'izel.db'));
  raw.exec(`
    CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE sesiones (token TEXT PRIMARY KEY, expira INTEGER NOT NULL);
    CREATE TABLE proveedores (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE productos (
      id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, descripcion TEXT DEFAULT '',
      categoria TEXT NOT NULL DEFAULT 'Otros', material TEXT DEFAULT '', costo INTEGER NOT NULL DEFAULT 0, precio INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0, stock_minimo INTEGER NOT NULL DEFAULT 0, proveedor_id INTEGER, imagen TEXT DEFAULT '',
      publicado INTEGER NOT NULL DEFAULT 0, destacado INTEGER NOT NULL DEFAULT 0, revisar INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE movimientos_stock (id INTEGER PRIMARY KEY, producto_id INTEGER NOT NULL, fecha TEXT NOT NULL, cantidad INTEGER NOT NULL, motivo TEXT NOT NULL, ref_tipo TEXT, ref_id INTEGER);
    CREATE TABLE cuenta_corriente (id INTEGER PRIMARY KEY, entidad TEXT NOT NULL, entidad_id INTEGER NOT NULL, fecha TEXT NOT NULL, concepto TEXT NOT NULL, debe INTEGER NOT NULL DEFAULT 0, haber INTEGER NOT NULL DEFAULT 0, ref_tipo TEXT, ref_id INTEGER);
    CREATE TABLE ventas (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, numero INTEGER NOT NULL, fecha TEXT NOT NULL, cliente_id INTEGER, subtotal INTEGER NOT NULL, descuento INTEGER NOT NULL DEFAULT 0, recargo INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, costo_total INTEGER NOT NULL DEFAULT 0, pagado INTEGER NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'ok', factura_arca TEXT DEFAULT '', notas TEXT DEFAULT '', UNIQUE (tipo, numero));
    CREATE TABLE venta_items (id INTEGER PRIMARY KEY, venta_id INTEGER NOT NULL, producto_id INTEGER, descripcion TEXT NOT NULL, cantidad INTEGER NOT NULL, precio INTEGER NOT NULL, costo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE compras (id INTEGER PRIMARY KEY, proveedor_id INTEGER NOT NULL, fecha TEXT NOT NULL, comprobante TEXT DEFAULT '', total INTEGER NOT NULL, notas TEXT DEFAULT '');
    CREATE TABLE compra_items (id INTEGER PRIMARY KEY, compra_id INTEGER NOT NULL, producto_id INTEGER NOT NULL, cantidad INTEGER NOT NULL, costo INTEGER NOT NULL);
    CREATE TABLE caja (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, tipo TEXT NOT NULL, categoria TEXT NOT NULL, concepto TEXT NOT NULL, medio TEXT NOT NULL, monto INTEGER NOT NULL, ref_tipo TEXT, ref_id INTEGER);
    CREATE TABLE cierres_caja (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, esperado INTEGER NOT NULL, contado INTEGER NOT NULL, diferencia INTEGER NOT NULL, notas TEXT DEFAULT '');
    CREATE TABLE arreglos (id INTEGER PRIMARY KEY, cliente_id INTEGER, cliente_nombre TEXT DEFAULT '', descripcion TEXT NOT NULL, precio INTEGER NOT NULL DEFAULT 0, pagado INTEGER NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'pendiente', fecha_ingreso TEXT NOT NULL, fecha_entrega TEXT DEFAULT '', notas TEXT DEFAULT '');
    CREATE TABLE consultas (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, codigo TEXT NOT NULL);
  `);
  const { lastInsertRowid } = raw.prepare('INSERT INTO productos (codigo, nombre, stock, stock_minimo) VALUES (?, ?, ?, ?)').run('IZ-900', 'Producto viejo', 7, 2);
  raw.prepare("INSERT INTO clientes (id, nombre) VALUES (1, 'Cliente viejo')").run();
  raw.close();

  const db = abrirDb(dir, path.join(dir, 'no-existe.json'));
  const prodId = Number(lastInsertRowid);
  const productoMigrado = db.get('SELECT * FROM productos WHERE id = ?', prodId);
  assert.ok(!('stock' in productoMigrado), 'la columna stock ya no vive en productos');
  const stockFila = db.get('SELECT * FROM stock_sucursal WHERE producto_id = ?', prodId);
  assert.equal(stockFila.sucursal, 'Moreno');
  assert.equal(stockFila.cantidad, 7);
  assert.equal(stockFila.stock_minimo, 2);
  assert.equal(db.get('SELECT sucursal FROM clientes WHERE id = 1').sucursal, 'Moreno');

  db.raw.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
