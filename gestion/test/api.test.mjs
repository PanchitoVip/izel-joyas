import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
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
  assert.deepEqual((await ok('GET', '/api/sesion')), {
    configurado: true, logueado: true, sucursal: 'Moreno', google: false, googleClientId: null, email: '', driveActivo: false, driveConectado: false,
  });
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
    assert.deepEqual(sesion, {
      configurado: true, logueado: false, sucursal: null, google: false, googleClientId: null, email: null, driveActivo: false, driveConectado: false,
    });
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

test('una compra no puede sumar stock a un producto ya dado de baja', async () => {
  const { id } = await ok('POST', '/api/productos', { nombre: 'Para dar de baja', categoria: 'Anillos', precio: 1000 });
  await ok('DELETE', `/api/productos/${id}`);
  const r = await pedir('POST', '/api/compras', {
    proveedor_id: proveedor, items: [{ producto_id: id, cantidad: 5, costo: 100 }],
  });
  assert.equal(r.status, 400, 'el producto ya no existe para el depósito');
});

test('no se puede dar de baja un producto que todavía tiene stock cargado', async () => {
  const { id } = await ok('POST', '/api/productos', { nombre: 'Con stock, no se borra', categoria: 'Anillos', precio: 1000, stock: 5 });
  // Si se pudiera dar de baja así, esas 5 unidades quedarían huérfanas: el producto desaparece
  // de /api/productos (que sólo muestra activo = 1) y ya no se podría ni ajustar su stock
  // (el ajuste exige "existe", que también pide activo = 1), ni venderlo, ni verlo nunca más.
  assert.equal((await pedir('DELETE', `/api/productos/${id}`)).status, 400, 'todavía tiene 5 unidades cargadas');
  await ok('POST', `/api/productos/${id}/ajuste`, { cantidad: -5, motivo: 'Vaciar para la prueba' });
  await ok('DELETE', `/api/productos/${id}`);
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

test('una venta con el mismo producto en dos renglones no puede superar el stock total disponible', async () => {
  const { id: id2 } = await ok('POST', '/api/productos', { nombre: 'Repetido en la venta', categoria: 'Anillos', precio: 100, stock: 10 });
  // 8 + 8 = 16 pedidos sobre un stock de 10: cada renglón por separado "entraría" (8 <= 10),
  // pero juntos superan lo que hay. No debe aceptarse sin permitir_sin_stock.
  const r = await pedir('POST', '/api/ventas', {
    tipo: 'Comprobante interno',
    items: [{ producto_id: id2, cantidad: 8, precio: 100 }, { producto_id: id2, cantidad: 8, precio: 100 }],
    pagos: [{ medio: 'Efectivo', monto: 1600 }],
  });
  assert.equal(r.status, 409);
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === id2).stock, 10, 'la venta rechazada no toca el stock');
  const ok2 = await ok('POST', '/api/ventas', {
    tipo: 'Comprobante interno',
    items: [{ producto_id: id2, cantidad: 5, precio: 100 }, { producto_id: id2, cantidad: 5, precio: 100 }],
    pagos: [{ medio: 'Efectivo', monto: 1000 }],
  });
  assert.ok(ok2.id, 'pedir exactamente el total disponible entre los dos renglones sí se acepta');
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === id2).stock, 0);
});

test('un ajuste manual no puede dejar el stock en negativo', async () => {
  const r = await pedir('POST', `/api/productos/${prod.id}/ajuste`, { cantidad: -9999, motivo: 'Rotura' });
  assert.equal(r.status, 409);
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 8, 'el ajuste rechazado no toca el stock');
  // Un ajuste que deja el stock justo en cero sí se permite; se restaura después para no afectar las pruebas siguientes.
  await ok('POST', `/api/productos/${prod.id}/ajuste`, { cantidad: -8, motivo: 'Rotura total (prueba)' });
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 0);
  await ok('POST', `/api/productos/${prod.id}/ajuste`, { cantidad: 8, motivo: 'Restaurar stock de prueba' });
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === prod.id).stock, 8);
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

test('anular una venta que vació el stock de un producto ya dado de baja lo reactiva', async () => {
  const { id } = await ok('POST', '/api/productos', { nombre: 'Se agota y se borra', categoria: 'Anillos', precio: 1000, stock: 3 });
  const venta = await ok('POST', '/api/ventas', {
    tipo: 'Comprobante interno', items: [{ producto_id: id, cantidad: 3, precio: 1000 }], pagos: [{ medio: 'Efectivo', monto: 3000 }],
  });
  await ok('DELETE', `/api/productos/${id}`); // queda en 0: se puede dar de baja
  assert.ok(!(await ok('GET', '/api/productos')).some((p) => p.id === id), 'desapareció de la lista al darse de baja');
  await ok('POST', `/api/ventas/${venta.id}/anular`);
  const p = (await ok('GET', '/api/productos')).find((x) => x.id === id);
  // Si siguiera inactivo, estas 3 unidades que la anulación le devolvió quedarían huérfanas
  // (invisibles e inajustables), igual que si se hubiera podido borrar con stock de entrada.
  assert.ok(p, 'la anulación lo reactiva: no puede quedar con stock y fuera de la lista');
  assert.equal(p.stock, 3);
});

test('el cierre de caja registra y ajusta la diferencia', async () => {
  const { efectivo } = await ok('GET', '/api/resumen');
  const c = await ok('POST', '/api/caja/cierre', { contado: efectivo - 5000 });
  assert.equal(c.diferencia, -5000);
  assert.equal((await ok('GET', '/api/resumen')).efectivo, efectivo - 5000);
});

test('un movimiento de caja anterior a un cierre ya hecho no se puede borrar (desarmaría ese cierre)', async () => {
  await ok('POST', '/api/caja', { tipo: 'ingreso', categoria: 'Otros ingresos', concepto: 'Antes del cierre', medio: 'Efectivo', monto: 12345 });
  const id = (await ok('GET', '/api/caja')).movimientos.find((m) => m.concepto === 'Antes del cierre').id;
  await ok('POST', '/api/caja/cierre', { contado: (await ok('GET', '/api/resumen')).efectivo });
  assert.equal((await pedir('DELETE', `/api/caja/${id}`)).status, 400, 'ya hay un cierre posterior: borrarlo desincroniza el efectivo que ya se cerró');
  await ok('POST', '/api/caja', { tipo: 'ingreso', categoria: 'Otros ingresos', concepto: 'Después del cierre', medio: 'Efectivo', monto: 999 });
  const idNuevo = (await ok('GET', '/api/caja')).movimientos.find((m) => m.concepto === 'Después del cierre').id;
  await ok('DELETE', `/api/caja/${idNuevo}`);
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
  assert.deepEqual(await ok('GET', '/api/sesion'), {
    configurado: true, logueado: true, sucursal: 'Moreno', google: false, googleClientId: null, email: '', driveActivo: false, driveConectado: false,
  });

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

test('un proveedor no se borra si tiene saldo en alguna sucursal, aunque el neto entre las dos sea cero', async () => {
  const prov = (await ok('POST', '/api/proveedores', { nombre: 'Proveedor Multi-sucursal' })).id;

  assert.equal((await ok('GET', '/api/sesion')).sucursal, 'Moreno');
  await ok('POST', `/api/proveedores/${prov}/saldo-inicial`, { monto: 500000 });
  assert.equal((await ok('GET', `/api/proveedores/${prov}/cuenta`)).saldo, 500000, 'Moreno le debe 500000 a este proveedor');

  await ok('POST', '/api/sucursal', { sucursal: 'Morón' });
  await ok('POST', `/api/proveedores/${prov}/pago`, { monto: 500000, medio: 'Efectivo' });
  assert.equal((await ok('GET', `/api/proveedores/${prov}/cuenta`)).saldo, -500000, 'Morón quedó a favor por error, pero eso no borra la deuda de Moreno');

  // El neto entre las dos sucursales da cero, pero Moreno sigue debiendo de verdad: no debe poder borrarse desde ninguna.
  assert.equal((await pedir('DELETE', `/api/proveedores/${prov}`)).status, 400, 'no se puede borrar desde Morón: Moreno le sigue debiendo');
  await ok('POST', '/api/sucursal', { sucursal: 'Moreno' });
  assert.equal((await pedir('DELETE', `/api/proveedores/${prov}`)).status, 400, 'tampoco desde Moreno: sigue habiendo saldo pendiente');

  // Recién cuando las dos sucursales están realmente en cero se puede borrar.
  await ok('POST', `/api/proveedores/${prov}/pago`, { monto: 500000, medio: 'Efectivo' });
  await ok('POST', '/api/sucursal', { sucursal: 'Morón' });
  await ok('POST', `/api/proveedores/${prov}/saldo-inicial`, { monto: 500000 });
  assert.equal((await ok('GET', `/api/proveedores/${prov}/cuenta`)).saldo, 0);
  await ok('DELETE', `/api/proveedores/${prov}`);
  await ok('POST', '/api/sucursal', { sucursal: 'Moreno' });
});

test('la baja de un producto no se cuela si el neto entre sucursales da cero pero una tiene stock físico real', async () => {
  const { id } = await ok('POST', '/api/productos', { nombre: 'Multi-sucursal, no se borra con neto cero', categoria: 'Anillos', precio: 1000 });
  // Moreno queda con stock prometido en negativo (venta confirmada sin tener todavía la mercadería).
  await ok('POST', '/api/ventas', {
    tipo: 'Comprobante interno', permitir_sin_stock: true,
    items: [{ producto_id: id, cantidad: 5, precio: 1000 }], pagos: [{ medio: 'Efectivo', monto: 5000 }],
  });
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === id).stock, -5);

  await ok('POST', '/api/sucursal', { sucursal: 'Morón' });
  await ok('POST', `/api/productos/${id}/ajuste`, { cantidad: 5, motivo: 'Stock físico real en Morón' });
  assert.equal((await ok('GET', '/api/productos')).find((x) => x.id === id).stock, 5);

  // El total entre las dos sucursales da cero (-5 de Moreno + 5 de Morón), pero Morón tiene
  // 5 unidades físicas de verdad: si el chequeo de baja suma en vez de mirar cada sucursal por
  // separado, se borraría igual y esas 5 unidades quedarían huérfanas (invisibles, no se pueden
  // ni vender ni ajustar nunca más).
  assert.equal(
    (await pedir('DELETE', `/api/productos/${id}`)).status,
    400,
    'Morón todavía tiene 5 unidades físicas, aunque el total entre sucursales dé cero',
  );

  await ok('POST', `/api/productos/${id}/ajuste`, { cantidad: -5, motivo: 'Vaciar Morón para la prueba' });
  await ok('POST', '/api/sucursal', { sucursal: 'Moreno' });
  await ok('POST', `/api/productos/${id}/ajuste`, { cantidad: 5, motivo: 'Saldar la deuda de Moreno para la prueba' });
  await ok('DELETE', `/api/productos/${id}`);
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

test('con Google activado: sólo entran los mails autorizados, cada uno con su propia contraseña', async () => {
  const AUD = 'test-client-id.apps.googleusercontent.com';
  const TOKENS = {
    'tok-duena1': { aud: AUD, email: 'duena1@gmail.com', email_verified: 'true' },
    'tok-duena2': { aud: AUD, email: 'duena2@gmail.com', email_verified: 'true' },
    'tok-no-autorizada': { aud: AUD, email: 'otra@gmail.com', email_verified: 'true' },
    'tok-aud-mala': { aud: 'otro-client-id', email: 'duena1@gmail.com', email_verified: 'true' },
    'tok-no-verificado': { aud: AUD, email: 'duena1@gmail.com', email_verified: 'false' },
  };
  // Simula el endpoint de verificación de Google: responde con las "claims" fijadas arriba según el id_token recibido.
  const stub = http.createServer((req, res) => {
    const datos = TOKENS[new URL(req.url, 'http://local').searchParams.get('id_token')];
    res.writeHead(datos ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(datos || { error: 'invalid_token' }));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const puertoStub = stub.address().port;

  const puerto = 3113;
  const urlBase = `http://127.0.0.1:${puerto}`;
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-google-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BASE,
    env: {
      ...process.env, PORT: String(puerto), IZEL_DATOS: datos,
      GOOGLE_CLIENT_ID: AUD, IZEL_CORREOS_AUTORIZADOS: 'Duena1@gmail.com, duena2@gmail.com',
      GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${puertoStub}`,
    },
    stdio: 'ignore',
  });
  let cookie = '';
  const pedirG = async (metodo, ruta, cuerpo, conSesion = true) => {
    const r = await fetch(`${urlBase}${ruta}`, {
      method: metodo,
      headers: cuerpo !== undefined ? { 'content-type': 'application/json', ...(conSesion && cookie ? { cookie } : {}) } : (conSesion && cookie ? { cookie } : {}),
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const texto = await r.text();
    let data; try { data = JSON.parse(texto); } catch { data = texto; }
    return { status: r.status, data };
  };

  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(`${urlBase}/api/sesion`); break; } catch { await new Promise((res) => setTimeout(res, 100)); }
    }

    // La lista de autorizados se compara sin importar mayúsculas: "Duena1@gmail.com" en la variable de entorno
    // igual reconoce el mail que Google devuelve en minúsculas.
    assert.deepEqual((await pedirG('GET', '/api/sesion')).data, {
      configurado: true, logueado: false, sucursal: null, google: true, googleClientId: AUD, email: null, driveActivo: false, driveConectado: false,
    });

    assert.equal((await pedirG('POST', '/api/instalar', { codigo: 'x', clave: 'cualquiera1' })).status, 404, 'la clave única vieja queda deshabilitada');
    assert.equal((await pedirG('POST', '/api/login', { clave: 'cualquiera1' })).status, 404);

    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-no-autorizada' })).status, 403);
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-aud-mala' })).status, 401);
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-no-verificado' })).status, 401);
    assert.equal((await pedirG('POST', '/api/acceso-gestion', { credential: 'tok-no-autorizada' }, false)).data.autorizada, false);
    assert.equal((await pedirG('POST', '/api/acceso-gestion', { credential: 'tok-duena1' }, false)).data.autorizada, true);

    // Primera vez con un mail autorizado: sin clave todavía no hay sesión, sólo se informa que hay que crear una.
    const primera = await pedirG('POST', '/api/login-google', { credential: 'tok-duena1' });
    assert.deepEqual(primera.data, { email: 'duena1@gmail.com', nueva: true });
    assert.equal((await pedirG('GET', '/api/sesion')).data.logueado, false, 'todavía no inició sesión, sólo consultó');

    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena1', clave: 'corta' })).status, 400);
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena1', clave: 'clave-de-duena-1' })).status, 200);
    assert.deepEqual((await pedirG('GET', '/api/sesion')).data, {
      configurado: true, logueado: true, sucursal: 'Moreno', google: true, googleClientId: AUD, email: 'duena1@gmail.com', driveActivo: false, driveConectado: false,
    });

    await pedirG('POST', '/api/logout', {});
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena1', clave: 'mala' })).status, 401, 'ya tiene clave puesta: ahora se exige, no se vuelve a crear');
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena1', clave: 'clave-de-duena-1' })).status, 200);

    // Cambiar la contraseña sólo afecta al mail de la sesión actual, no a la otra dueña.
    assert.equal((await pedirG('POST', '/api/clave', { actual: 'clave-de-duena-1', nueva: 'clave-nueva-de-duena-1' })).status, 200);
    await pedirG('POST', '/api/logout', {});
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena1', clave: 'clave-de-duena-1' })).status, 401, 'la clave vieja ya no sirve');
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena1', clave: 'clave-nueva-de-duena-1' })).status, 200);
    await pedirG('POST', '/api/logout', {});

    const otraPrimera = await pedirG('POST', '/api/login-google', { credential: 'tok-duena2' });
    assert.deepEqual(otraPrimera.data, { email: 'duena2@gmail.com', nueva: true });
    assert.equal((await pedirG('POST', '/api/login-google', { credential: 'tok-duena2', clave: 'clave-de-duena-2' })).status, 200);
    assert.equal((await pedirG('GET', '/api/sesion')).data.email, 'duena2@gmail.com', 'cada una entra con la suya, sin mezclarse');
  } finally {
    proc.kill();
    stub.close();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(datos, { recursive: true, force: true });
  }
});

test('catálogo desde Google Drive: conecta, sincroniza, excluye Fornituras y no borra lo que ya no aparece', async () => {
  // Tiene que ser un JPEG de verdad (no sólo los bytes mágicos): drive.js ahora lo recomprime con
  // sharp antes de guardarlo, para que las fotos del proveedor no inflen el disco.
  const JPG = await sharp({ create: { width: 2200, height: 1800, channels: 3, background: { r: 180, g: 40, b: 90 } } }).jpeg().toBuffer();
  const NO_IMAGEN = Buffer.from('esto no es una imagen de verdad');
  // Imita la estructura real relevada a mano en la carpeta del proveedor: una raíz con una
  // subcarpeta "Fornituras" (se tiene que excluir entera) y una subcarpeta con fotos de verdad,
  // más un archivo con mimeType de imagen pero que no es un jpg/png/webp real (ej. un HEIC).
  const archivos = {
    raiz: { id: 'raiz', name: 'Catálogo proveedor', mimeType: 'application/vnd.google-apps.folder', parents: [] },
    fornituras: { id: 'fornituras', name: 'Fornituras', mimeType: 'application/vnd.google-apps.folder', parents: ['raiz'] },
    vacia: { id: 'vacia', name: 'Novedades', mimeType: 'application/vnd.google-apps.folder', parents: ['raiz'] },
    dijes: { id: 'dijes', name: 'Dijes ac', mimeType: 'application/vnd.google-apps.folder', parents: ['raiz'] },
    broche: { id: 'broche', name: 'broche.jpg', mimeType: 'image/jpeg', parents: ['fornituras'], contenido: JPG },
    foto1: { id: 'foto1', name: 'D3767.jpg', mimeType: 'image/jpeg', parents: ['dijes'], contenido: JPG },
    foto2: { id: 'foto2', name: 'D3814.jpg', mimeType: 'image/jpeg', parents: ['dijes'], contenido: JPG },
    heic: { id: 'heic', name: 'foto-iphone.heic', mimeType: 'image/heic', parents: ['dijes'], contenido: NO_IMAGEN },
  };
  let descargasDeFornituras = 0;
  const pedidosDrive = [];
  const stub = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://local');
      pedidosDrive.push(u.pathname);
      if (u.pathname === '/token') {
        const b = new URLSearchParams(cuerpo);
        if (b.get('client_id') !== 'client-drive' || b.get('client_secret') !== 'secreto-drive') {
          res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); return;
        }
        if (b.get('grant_type') === 'authorization_code') {
          if (b.get('code') === 'codigo-sin-refresh') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ access_token: 'acc-1', expires_in: 3600 }));
            return;
          }
          if (b.get('code') !== 'codigo-bueno') { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'acc-1', refresh_token: 'refresh-1', expires_in: 3600 }));
          return;
        }
        if (b.get('grant_type') === 'refresh_token' && b.get('refresh_token') === 'refresh-1') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'acc-1', expires_in: 3600 }));
          return;
        }
        res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}');
        return;
      }
      if (u.pathname === '/drive/files') {
        const padre = /^'([^']+)' in parents/.exec(u.searchParams.get('q') || '')?.[1];
        const files = Object.values(archivos).filter((a) => a.parents.includes(padre)).map(({ id, name, mimeType }) => ({ id, name, mimeType }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ files }));
        return;
      }
      const m = /^\/drive\/files\/([^/]+)$/.exec(u.pathname);
      if (m && u.searchParams.get('alt') === 'media') {
        const a = archivos[m[1]];
        if (a?.parents.includes('fornituras')) descargasDeFornituras += 1;
        if (!a) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(a.contenido);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const puertoStub = stub.address().port;
  const urlStub = `http://127.0.0.1:${puertoStub}`;

  const puerto = 3114;
  const urlBase = `http://127.0.0.1:${puerto}`;
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-drive-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BASE,
    env: {
      ...process.env, PORT: String(puerto), IZEL_DATOS: datos, IZEL_CODIGO_INSTALACION: CODIGO,
      GOOGLE_CLIENT_ID: 'client-drive', GOOGLE_CLIENT_SECRET: 'secreto-drive',
      GOOGLE_OAUTH_TOKEN_URL: `${urlStub}/token`, GOOGLE_DRIVE_API_URL: `${urlStub}/drive`,
    },
    stdio: 'ignore',
  });
  let cookie = '';
  const pedirD = async (metodo, ruta, cuerpo, { redirigir = 'manual' } = {}) => {
    const r = await fetch(`${urlBase}${ruta}`, {
      method: metodo,
      redirect: redirigir,
      headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const texto = await r.text();
    let data; try { data = JSON.parse(texto); } catch { data = texto; }
    return { status: r.status, headers: r.headers, data };
  };

  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(`${urlBase}/api/sesion`); break; } catch { await new Promise((res) => setTimeout(res, 100)); }
    }
    await pedirD('POST', '/api/instalar', { codigo: CODIGO, clave: CLAVE });
    assert.deepEqual((await pedirD('GET', '/api/sesion')).data, {
      configurado: true, logueado: true, sucursal: 'Moreno', google: false, googleClientId: null, email: '', driveActivo: true, driveConectado: false,
    });

    // /conectar exige sesión (ya la tenemos) y arma un "state" de un solo uso; /callback, en cambio,
    // tiene que funcionar SIN la cookie: así llega de verdad desde accounts.google.com (navegación
    // entre sitios, y la cookie de sesión es SameSite=Strict).
    const conectar = await pedirD('GET', '/api/drive/conectar');
    assert.equal(conectar.status, 302);
    const destino = new URL(conectar.headers.get('location'));
    assert.equal(destino.origin + destino.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(destino.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.readonly');
    assert.equal(destino.searchParams.get('access_type'), 'offline');
    assert.equal(destino.searchParams.get('prompt'), 'consent');
    const state = destino.searchParams.get('state');

    const sinState = await fetch(`${urlBase}/api/drive/callback?code=codigo-bueno&state=lo-que-sea`);
    assert.equal(sinState.status, 400, 'un state inválido o repetido se rechaza');

    // Si Google no devuelve refresh_token (puede pasar si ya se había otorgado el acceso antes),
    // se avisa en vez de quedar "conectado a medias".
    const conectar2 = await pedirD('GET', '/api/drive/conectar');
    const state2 = new URL(conectar2.headers.get('location')).searchParams.get('state');
    const sinRefresh = await fetch(`${urlBase}/api/drive/callback?code=codigo-sin-refresh&state=${state2}`, { redirect: 'manual' });
    assert.equal(sinRefresh.status, 409);

    const callback = await fetch(`${urlBase}/api/drive/callback?code=codigo-bueno&state=${state}`, { redirect: 'manual' });
    assert.equal(callback.status, 302, 'la vuelta de Google funciona sin la cookie de sesión');
    assert.equal((await pedirD('GET', '/api/sesion')).data.driveConectado, true);

    await pedirD('PUT', '/api/ajustes', { negocio: 'Izel Joyas', drive_carpeta_id: 'https://drive.google.com/drive/folders/raiz' });
    assert.equal((await pedirD('GET', '/api/ajustes')).data.drive_carpeta_id, 'raiz', 'acepta pegar la URL completa y guarda sólo el ID');
    assert.equal((await pedirD('GET', '/api/ajustes')).data.drive_excluir, 'Fornituras', 'la exclusión viene sembrada con Fornituras por defecto');

    const r1 = await pedirD('POST', '/api/drive/sincronizar', {});
    assert.equal(r1.status, 200);
    assert.equal(r1.data.nuevos, 2, 'sólo las 2 fotos de Dijes ac; Fornituras queda afuera y el .heic se omite');
    assert.deepEqual(r1.data.omitidos, ['foto-iphone.heic']);
    assert.equal(descargasDeFornituras, 0, 'nunca se descarga nada de la carpeta excluida');

    const productos = (await pedirD('GET', '/api/productos')).data;
    const sincronizados = productos.filter((p) => p.drive_file_id);
    assert.equal(sincronizados.length, 2);
    for (const p of sincronizados) {
      assert.equal(p.nombre, '');
      assert.equal(p.categoria, 'Dijes ac');
      assert.equal(p.costo, 0);
      assert.equal(p.precio, 0, 'el precio mayorista de la foto nunca se guarda');
      assert.equal(p.publicado, 0, 'no se auto-publica: la dueña revisa y carga precio/stock real antes');
      assert.equal(p.revisar, 1);
      assert.ok(p.imagen.startsWith('uploads/'));
      const foto = await fetch(`${urlBase}/${p.imagen}`);
      assert.equal(foto.status, 200);
      const metadata = await sharp(Buffer.from(await foto.arrayBuffer())).metadata();
      assert.ok(metadata.width <= 1000 && metadata.height <= 1000, 'se achica a máx. 1000px antes de guardarla, aunque la original sea más grande');
    }
    assert.ok(!productos.some((p) => p.categoria === 'Fornituras'), 'nada de Fornituras se convirtió en producto');

    // Correr de nuevo sin cambios en Drive no duplica nada.
    const r2 = await pedirD('POST', '/api/drive/sincronizar', {});
    assert.equal(r2.data.nuevos, 0);
    assert.equal((await pedirD('GET', '/api/productos')).data.filter((p) => p.drive_file_id).length, 2);

    // La dueña edita uno a mano (le pone nombre): PUT ya apaga "revisar" solo.
    const editado = sincronizados[0];
    await pedirD('PUT', `/api/productos/${editado.id}`, {
      ...editado, nombre: 'Dije corazón con ciervo', codigo: editado.codigo,
    });
    assert.equal((await pedirD('GET', `/api/productos`)).data.find((p) => p.id === editado.id).revisar, 0);

    // El proveedor saca esa foto de Drive: nunca se borra ni se despublica sola, sólo vuelve a revisar.
    delete archivos[editado.drive_file_id];
    const r3 = await pedirD('POST', '/api/drive/sincronizar', {});
    assert.equal(r3.data.nuevos, 0);
    assert.equal(r3.data.marcados_a_revisar, 1);
    const sigueExistiendo = (await pedirD('GET', '/api/productos')).data.find((p) => p.id === editado.id);
    assert.ok(sigueExistiendo, 'no se borró');
    assert.equal(sigueExistiendo.activo, 1);
    assert.equal(sigueExistiendo.nombre, 'Dije corazón con ciervo', 'tampoco se pisó lo que ya había cargado la dueña');
    assert.equal(sigueExistiendo.revisar, 1);
  } finally {
    proc.kill();
    stub.close();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(datos, { recursive: true, force: true });
  }
});

test('anular compra, factura duplicada y límite de crédito (servidor propio, no pisa los contadores compartidos del resto de la suite)', async () => {
  const puerto = 3115;
  const urlBase = `http://127.0.0.1:${puerto}`;
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-alta-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BASE, env: { ...process.env, PORT: String(puerto), IZEL_DATOS: datos, IZEL_CODIGO_INSTALACION: CODIGO }, stdio: 'ignore',
  });
  let cookie = '';
  const pedirA = async (metodo, ruta, cuerpo) => {
    const r = await fetch(`${urlBase}${ruta}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const texto = await r.text();
    let data; try { data = JSON.parse(texto); } catch { data = texto; }
    return { status: r.status, data };
  };
  const okA = async (...a) => { const r = await pedirA(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]}: ${JSON.stringify(r.data)}`); return r.data; };

  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(`${urlBase}/api/sesion`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await okA('POST', '/api/instalar', { codigo: CODIGO, clave: CLAVE });

    // Factura/comprobante duplicado del mismo proveedor: avisa, no bloquea si se confirma.
    const { id: prov } = await okA('POST', '/api/proveedores', { nombre: 'Proveedor para factura duplicada' });
    const { id: pid } = await okA('POST', '/api/productos', { nombre: 'Producto para factura duplicada', categoria: 'Anillos', precio: 100000 });
    await okA('POST', '/api/compras', { proveedor_id: prov, comprobante: 'R-9', items: [{ producto_id: pid, cantidad: 1, costo: 1000 }] });
    const dup = await pedirA('POST', '/api/compras', { proveedor_id: prov, comprobante: 'R-9', items: [{ producto_id: pid, cantidad: 1, costo: 1000 }] });
    assert.equal(dup.status, 409, 'mismo proveedor y mismo comprobante que la compra anterior');
    const dupOk = await okA('POST', '/api/compras', {
      proveedor_id: prov, comprobante: 'R-9', items: [{ producto_id: pid, cantidad: 1, costo: 1000 }], permitir_duplicado: true,
    });
    assert.ok(dupOk.id, 'con permitir_duplicado sí se puede, por si de verdad son dos compras con el mismo número');

    // Anular compra: revierte stock, deuda y pago; no deja el stock en negativo; no se puede anular dos veces.
    // Proveedor y producto propios, para no mezclar esta cuenta corriente con la de la prueba anterior.
    const { id: prov2 } = await okA('POST', '/api/proveedores', { nombre: 'Proveedor para anular compra' });
    const { id: pid2 } = await okA('POST', '/api/productos', { nombre: 'Producto para anular compra', categoria: 'Anillos', precio: 999900 });
    const compra = await okA('POST', '/api/compras', {
      proveedor_id: prov2, comprobante: 'A-1', items: [{ producto_id: pid2, cantidad: 10, costo: 100000 }],
      pago_monto: 300000, pago_medio: 'Efectivo',
    });
    assert.equal((await okA('GET', '/api/productos')).find((p) => p.id === pid2).stock, 10);
    assert.equal((await okA('GET', `/api/proveedores/${prov2}/cuenta`)).saldo, 700000);
    await okA('POST', `/api/productos/${pid2}/ajuste`, { cantidad: -8, motivo: 'Venta de prueba' });
    const bloqueada = await pedirA('POST', `/api/compras/${compra.id}/anular`, {});
    assert.equal(bloqueada.status, 400, 'ya se "vendieron" 8 de las 10 unidades, no puede dejar el stock en -8');
    await okA('POST', `/api/productos/${pid2}/ajuste`, { cantidad: 8, motivo: 'Deshacer para la prueba' });
    await okA('POST', `/api/compras/${compra.id}/anular`, {});
    assert.equal((await okA('GET', '/api/productos')).find((p) => p.id === pid2).stock, 0, 'el stock que trajo la compra se revirtió');
    assert.equal((await okA('GET', `/api/proveedores/${prov2}/cuenta`)).saldo, 0, 'la deuda y el pago de la compra anulada se revirtieron entre los dos');
    assert.equal((await pedirA('POST', `/api/compras/${compra.id}/anular`, {})).status, 400, 'no se puede anular dos veces');

    // Límite de crédito de un cliente.
    const { id: clienteId } = await okA('POST', '/api/clientes', { nombre: 'Cliente con límite', limite_credito: 500000 });
    const { id: productoId } = await okA('POST', '/api/productos', { nombre: 'Para fiar', categoria: 'Anillos', precio: 600000, stock: 5 });
    const r = await pedirA('POST', '/api/ventas', {
      tipo: 'Comprobante interno', cliente_id: clienteId, items: [{ producto_id: productoId, cantidad: 1, precio: 600000 }], pagos: [],
    });
    assert.equal(r.status, 409, 'el saldo que deja (600000) supera el límite (500000)');
    assert.match(r.data.error, /límite de fiado/);
    const venta = await okA('POST', '/api/ventas', {
      tipo: 'Comprobante interno', cliente_id: clienteId, items: [{ producto_id: productoId, cantidad: 1, precio: 600000 }], pagos: [],
      permitir_exceder_credito: true,
    });
    assert.ok(venta.id, 'con permitir_exceder_credito la dueña puede igual fiarle a un cliente de confianza');
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(datos, { recursive: true, force: true });
  }
});

test('con TRUST_PROXY, el límite de intentos de login usa la IP real (el último tramo de X-Forwarded-For), no uno falso que mande el cliente', async () => {
  const puerto = 3116;
  const urlBase = `http://127.0.0.1:${puerto}`;
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'izel-test-xff-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BASE, env: { ...process.env, PORT: String(puerto), IZEL_DATOS: datos, IZEL_CLAVE_INICIAL: CLAVE, TRUST_PROXY: '1' }, stdio: 'ignore',
  });
  const login = (clave, xff) => fetch(`${urlBase}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify({ clave }),
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(`${urlBase}/api/sesion`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    // Cinco intentos fallidos, cada uno "mintiendo" una IP de origen distinta (lo que el cliente
    // puede escribir), pero siempre con el mismo último tramo (el que pondría el proxy de verdad).
    for (let i = 0; i < 5; i += 1) assert.equal((await login('mala', `1.2.3.${i}, 9.9.9.9`)).status, 401);
    assert.equal((await login(CLAVE, '5.5.5.5, 9.9.9.9')).status, 429, 'mismo origen real (9.9.9.9): sigue bloqueado aunque cambie lo que manda el cliente');
    assert.equal((await login(CLAVE, '1.2.3.4, 8.8.8.8')).status, 200, 'un origen real distinto (8.8.8.8) no comparte el límite del otro');
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(datos, { recursive: true, force: true });
  }
});
