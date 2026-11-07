import { ahora, hoy } from './db.js';

export class ErrorApi extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}
const falla = (mensaje, status = 400) => { throw new ErrorApi(status, mensaje); };

export const MEDIOS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Mercado Pago'];
export const TIPOS_COMPROBANTE = ['Comprobante interno', 'Venta con factura ARCA'];
export const CATEGORIAS_MANUALES = {
  ingreso: ['Saldo inicial', 'Aporte', 'Otros ingresos'],
  egreso: ['Alquiler', 'Servicios', 'Impuestos', 'Sueldos', 'Publicidad', 'Insumos y packaging', 'Envíos', 'Comisiones', 'Otros gastos', 'Retiro personal'],
};
// Movimientos de plata que no son ni ganancia ni gasto: la mercadería entra al resultado por su costo al venderse.
const FUERA_DE_RESULTADO = ['Venta', 'Cobranza', 'Saldo inicial', 'Aporte', 'Pago a proveedor', 'Retiro personal', 'Anulación de venta', 'Ajuste de arqueo'];
const NO_RESULTADO_SQL = FUERA_DE_RESULTADO.map((c) => `'${c}'`).join(',');

const texto = (v, max = 300) => String(v ?? '').trim().slice(0, max);
function entero(v, nombre, min = 0, max = 1e12) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) falla(`${nombre} no es válido`);
  return n;
}
function requerido(v, nombre, max) {
  const t = texto(v, max);
  if (!t) falla(`Falta ${nombre}`);
  return t;
}
function medio(v) {
  if (!MEDIOS.includes(v)) falla('Medio de pago no válido');
  return v;
}
function rango(q) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const h = hoy();
  return { desde: ok(q.desde) ? q.desde : `${h.slice(0, 7)}-01`, hasta: ok(q.hasta) ? q.hasta : h };
}

export function crearApi(db) {
  const CAMPOS = {
    clientes: ['nombre', 'telefono', 'email', 'documento', 'direccion', 'cumpleanos', 'talle_anillo', 'notas'],
    proveedores: ['nombre', 'contacto', 'telefono', 'email', 'cuit', 'direccion', 'notas'],
  };

  function asiento(entidad, id, concepto, debe, haber, refTipo = null, refId = null) {
    db.run(
      'INSERT INTO cuenta_corriente (entidad, entidad_id, fecha, concepto, debe, haber, ref_tipo, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      entidad, id, ahora(), concepto, debe, haber, refTipo, refId,
    );
  }
  function movimientoCaja(tipo, categoria, concepto, medioPago, monto, refTipo = null, refId = null) {
    db.run(
      'INSERT INTO caja (fecha, tipo, categoria, concepto, medio, monto, ref_tipo, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ahora(), tipo, categoria, concepto, medioPago, monto, refTipo, refId,
    );
  }
  function moverStock(productoId, cantidad, motivo, refTipo = null, refId = null) {
    db.run('UPDATE productos SET stock = stock + ? WHERE id = ?', cantidad, productoId);
    db.run(
      'INSERT INTO movimientos_stock (producto_id, fecha, cantidad, motivo, ref_tipo, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
      productoId, ahora(), cantidad, motivo, refTipo, refId,
    );
  }
  const saldo = (entidad, id) => db.get(
    'SELECT COALESCE(SUM(debe - haber), 0) s FROM cuenta_corriente WHERE entidad = ? AND entidad_id = ?', entidad, id,
  ).s;
  const efectivoEnCaja = () => db.get(
    `SELECT COALESCE(SUM(CASE tipo WHEN 'ingreso' THEN monto ELSE -monto END), 0) s FROM caja WHERE medio = 'Efectivo'`,
  ).s;
  const existe = (tabla, id) => db.get(`SELECT id FROM ${tabla} WHERE id = ? AND activo = 1`, id) || falla('No se encontró el registro', 404);

  /* ---- Productos ---- */
  function datosProducto(b) {
    const proveedor = b.proveedor_id ? entero(b.proveedor_id, 'Proveedor', 1) : null;
    return {
      nombre: requerido(b.nombre, 'el nombre', 120),
      descripcion: texto(b.descripcion, 500),
      categoria: requerido(b.categoria, 'la categoría', 60),
      material: texto(b.material, 80),
      costo: entero(b.costo ?? 0, 'El costo'),
      precio: entero(b.precio ?? 0, 'El precio'),
      stock_minimo: entero(b.stock_minimo ?? 0, 'El stock mínimo'),
      proveedor_id: proveedor,
      imagen: texto(b.imagen, 200),
      publicado: b.publicado ? 1 : 0,
      destacado: b.destacado ? 1 : 0,
    };
  }
  function siguienteCodigo() {
    const max = db.get(`SELECT MAX(CAST(SUBSTR(codigo, 4) AS INTEGER)) m FROM productos WHERE codigo GLOB 'IZ-[0-9]*'`).m || 0;
    return `IZ-${String(max + 1).padStart(3, '0')}`;
  }
  function codigoLibre(codigo, id = 0) {
    if (db.get('SELECT id FROM productos WHERE codigo = ? AND id != ?', codigo, id)) falla(`El código ${codigo} ya está en uso`);
    return codigo;
  }

  /* ---- Ventas ---- */
  function crearVenta(b) {
    if (!TIPOS_COMPROBANTE.includes(b.tipo)) falla('Tipo de comprobante no válido');
    if (!Array.isArray(b.items) || !b.items.length) falla('La venta no tiene productos');
    const clienteId = b.cliente_id ? entero(b.cliente_id, 'Cliente', 1) : null;
    if (clienteId) existe('clientes', clienteId);

    return db.tx(() => {
      const items = b.items.map((i) => {
        const cantidad = entero(i.cantidad, 'La cantidad', 1, 100000);
        const precio = entero(i.precio, 'El precio');
        if (!i.producto_id) return { producto_id: null, descripcion: requerido(i.descripcion, 'la descripción', 200), cantidad, precio, costo: 0 };
        const p = db.get('SELECT * FROM productos WHERE id = ? AND activo = 1', entero(i.producto_id, 'Producto', 1)) || falla('Producto inexistente');
        if (p.stock < cantidad && !b.permitir_sin_stock) falla(`Sin stock suficiente de ${p.nombre} (hay ${p.stock})`, 409);
        return { producto_id: p.id, descripcion: `${p.codigo} ${p.nombre}`, cantidad, precio, costo: p.costo };
      });
      const subtotal = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
      const descuento = entero(b.descuento ?? 0, 'El descuento');
      const recargo = entero(b.recargo ?? 0, 'El recargo');
      const total = subtotal - descuento + recargo;
      if (total < 0) falla('El descuento supera el total');
      const pagos = (b.pagos || []).filter((p) => Number(p.monto) > 0).map((p) => ({ medio: medio(p.medio), monto: entero(p.monto, 'El pago', 1) }));
      const pagado = pagos.reduce((s, p) => s + p.monto, 0);
      if (pagado > total) falla('Lo cobrado supera el total de la venta');
      const deuda = total - pagado;
      if (deuda > 0 && !clienteId) falla('Para dejar saldo en cuenta corriente hay que elegir un cliente');

      const numero = db.get('SELECT COALESCE(MAX(numero), 0) + 1 n FROM ventas WHERE tipo = ?', b.tipo).n;
      const costoTotal = items.reduce((s, i) => s + i.costo * i.cantidad, 0);
      const { lastInsertRowid } = db.run(
        `INSERT INTO ventas (tipo, numero, fecha, cliente_id, subtotal, descuento, recargo, total, costo_total, pagado, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.tipo, numero, ahora(), clienteId, subtotal, descuento, recargo, total, costoTotal, pagado, texto(b.notas, 300),
      );
      const id = Number(lastInsertRowid);
      const etiqueta = `${b.tipo} N° ${numero}`;
      for (const i of items) {
        db.run(
          'INSERT INTO venta_items (venta_id, producto_id, descripcion, cantidad, precio, costo) VALUES (?, ?, ?, ?, ?, ?)',
          id, i.producto_id, i.descripcion, i.cantidad, i.precio, i.costo,
        );
        if (i.producto_id) moverStock(i.producto_id, -i.cantidad, `Venta: ${etiqueta}`, 'venta', id);
      }
      for (const p of pagos) movimientoCaja('ingreso', 'Venta', etiqueta, p.medio, p.monto, 'venta', id);
      if (deuda > 0) asiento('cliente', clienteId, `Saldo de ${etiqueta}`, deuda, 0, 'venta', id);
      return { id, numero, total };
    });
  }

  function verVenta(id) {
    const v = db.get(
      `SELECT v.*, c.nombre cliente, c.telefono cliente_telefono, c.documento cliente_documento
       FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`, id,
    ) || falla('Venta inexistente', 404);
    v.items = db.all('SELECT * FROM venta_items WHERE venta_id = ?', id);
    v.pagos = db.all(`SELECT medio, monto FROM caja WHERE ref_tipo = 'venta' AND ref_id = ? AND categoria = 'Venta'`, id);
    return v;
  }

  function anularVenta(id) {
    return db.tx(() => {
      const v = verVenta(id);
      if (v.estado === 'anulada') falla('La venta ya estaba anulada');
      const etiqueta = `${v.tipo} N° ${v.numero}`;
      db.run(`UPDATE ventas SET estado = 'anulada' WHERE id = ?`, id);
      for (const i of v.items) if (i.producto_id) moverStock(i.producto_id, i.cantidad, `Anulación: ${etiqueta}`, 'venta', id);
      for (const p of v.pagos) movimientoCaja('egreso', 'Anulación de venta', `Anulación ${etiqueta}`, p.medio, p.monto, 'venta', id);
      if (v.total > v.pagado) asiento('cliente', v.cliente_id, `Anulación ${etiqueta}`, 0, v.total - v.pagado, 'venta', id);
      return { ok: true };
    });
  }

  /* ---- Compras ---- */
  function crearCompra(b) {
    const proveedorId = entero(b.proveedor_id, 'Proveedor', 1);
    existe('proveedores', proveedorId);
    if (!Array.isArray(b.items) || !b.items.length) falla('La compra no tiene productos');
    return db.tx(() => {
      const items = b.items.map((i) => ({
        producto_id: entero(i.producto_id, 'Producto', 1),
        cantidad: entero(i.cantidad, 'La cantidad', 1, 100000),
        costo: entero(i.costo, 'El costo'),
      }));
      const total = items.reduce((s, i) => s + i.costo * i.cantidad, 0);
      const comprobante = texto(b.comprobante, 60);
      const { lastInsertRowid } = db.run(
        'INSERT INTO compras (proveedor_id, fecha, comprobante, total, notas) VALUES (?, ?, ?, ?, ?)',
        proveedorId, ahora(), comprobante, total, texto(b.notas, 300),
      );
      const id = Number(lastInsertRowid);
      const etiqueta = `Compra${comprobante ? ` ${comprobante}` : ` N° ${id}`}`;
      for (const i of items) {
        db.get('SELECT id FROM productos WHERE id = ?', i.producto_id) || falla('Producto inexistente');
        db.run('INSERT INTO compra_items (compra_id, producto_id, cantidad, costo) VALUES (?, ?, ?, ?)', id, i.producto_id, i.cantidad, i.costo);
        db.run('UPDATE productos SET costo = ?, proveedor_id = ? WHERE id = ?', i.costo, proveedorId, i.producto_id);
        moverStock(i.producto_id, i.cantidad, etiqueta, 'compra', id);
      }
      asiento('proveedor', proveedorId, etiqueta, total, 0, 'compra', id);
      const pago = Number(b.pago_monto) ? entero(b.pago_monto, 'El pago', 1) : 0;
      if (pago > total) falla('El pago supera el total de la compra');
      if (pago) {
        movimientoCaja('egreso', 'Pago a proveedor', etiqueta, medio(b.pago_medio), pago, 'compra', id);
        asiento('proveedor', proveedorId, `Pago de ${etiqueta}`, 0, pago, 'compra', id);
      }
      return { id, total };
    });
  }

  /* ---- Arreglos ---- */
  function cobrarArreglo(a, monto, medioPago) {
    if (a.pagado + monto > a.precio) falla('El pago supera el precio del arreglo');
    db.run('UPDATE arreglos SET pagado = pagado + ? WHERE id = ?', monto, a.id);
    movimientoCaja('ingreso', 'Arreglos', `Arreglo N° ${a.id}: ${a.descripcion.slice(0, 60)}`, medio(medioPago), monto, 'arreglo', a.id);
  }

  /* ---- Reportes ---- */
  function resultado(desde, hasta) {
    const v = db.get(
      `SELECT COUNT(*) cantidad, COALESCE(SUM(total), 0) ventas, COALESCE(SUM(costo_total), 0) costo
       FROM ventas WHERE estado = 'ok' AND SUBSTR(fecha, 1, 10) BETWEEN ? AND ?`, desde, hasta,
    );
    const c = db.get(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) otros,
              COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto END), 0) gastos
       FROM caja WHERE categoria NOT IN (${NO_RESULTADO_SQL}) AND SUBSTR(fecha, 1, 10) BETWEEN ? AND ?`, desde, hasta,
    );
    const bruta = v.ventas - v.costo;
    return { ...v, ganancia_bruta: bruta, otros_ingresos: c.otros, gastos: c.gastos, resultado: bruta + c.otros - c.gastos };
  }

  function resumen() {
    const h = hoy();
    const mes = `${h.slice(0, 7)}-01`;
    const hace30 = new Date(`${h}T12:00:00Z`);
    hace30.setUTCDate(hace30.getUTCDate() - 29);
    const proximos = [];
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(`${h}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      proximos.push(d.toISOString().slice(5, 10));
    }
    const saldos = (e) => db.get(
      `SELECT COALESCE(SUM(s), 0) t FROM (SELECT SUM(debe - haber) s FROM cuenta_corriente WHERE entidad = ? GROUP BY entidad_id HAVING s > 0)`, e,
    ).t;
    return {
      hoy: resultado(h, h),
      mes: resultado(mes, h),
      efectivo: efectivoEnCaja(),
      a_cobrar: saldos('cliente'),
      a_pagar: saldos('proveedor'),
      stock: db.get(`SELECT COALESCE(SUM(stock * costo), 0) costo, COALESCE(SUM(stock * precio), 0) venta, COALESCE(SUM(stock), 0) unidades FROM productos WHERE activo = 1 AND stock > 0`),
      stock_bajo: db.all('SELECT id, codigo, nombre, stock, stock_minimo FROM productos WHERE activo = 1 AND stock_minimo > 0 AND stock <= stock_minimo ORDER BY stock LIMIT 12'),
      por_revisar: db.get('SELECT COUNT(*) n FROM productos WHERE activo = 1 AND (revisar = 1 OR precio = 0)').n,
      cumpleanos: db.all(
        `SELECT id, nombre, telefono, cumpleanos FROM clientes WHERE activo = 1 AND SUBSTR(cumpleanos, 6, 5) IN (${proximos.map(() => '?').join(',')})`, ...proximos,
      ).sort((a, b) => proximos.indexOf(a.cumpleanos.slice(5)) - proximos.indexOf(b.cumpleanos.slice(5))),
      arreglos: db.all(`SELECT a.id, a.descripcion, a.fecha_entrega, a.estado, COALESCE(c.nombre, a.cliente_nombre) cliente FROM arreglos a LEFT JOIN clientes c ON c.id = a.cliente_id WHERE a.estado IN ('pendiente', 'listo') ORDER BY a.fecha_entrega = '', a.fecha_entrega LIMIT 8`),
      serie: db.all(
        `SELECT SUBSTR(fecha, 1, 10) dia, SUM(total) total FROM ventas WHERE estado = 'ok' AND SUBSTR(fecha, 1, 10) >= ? GROUP BY dia ORDER BY dia`,
        hace30.toISOString().slice(0, 10),
      ),
      desde_serie: hace30.toISOString().slice(0, 10),
    };
  }

  function reportes(q) {
    const { desde, hasta } = rango(q);
    const p = [desde, hasta];
    const enRango = `SUBSTR(fecha, 1, 10) BETWEEN ? AND ?`;
    return {
      desde,
      hasta,
      ...resultado(desde, hasta),
      por_medio: db.all(
        `SELECT medio, SUM(CASE tipo WHEN 'ingreso' THEN monto ELSE 0 END) ingresos, SUM(CASE tipo WHEN 'egreso' THEN monto ELSE 0 END) egresos
         FROM caja WHERE ${enRango} GROUP BY medio ORDER BY ingresos DESC`, ...p,
      ),
      gastos_por_categoria: db.all(
        `SELECT categoria, SUM(monto) total FROM caja WHERE tipo = 'egreso' AND categoria NOT IN (${NO_RESULTADO_SQL}) AND ${enRango} GROUP BY categoria ORDER BY total DESC`, ...p,
      ),
      top_productos: db.all(
        `SELECT i.descripcion, SUM(i.cantidad) unidades, SUM(i.cantidad * i.precio) total, SUM(i.cantidad * (i.precio - i.costo)) ganancia
         FROM venta_items i JOIN ventas v ON v.id = i.venta_id WHERE v.estado = 'ok' AND SUBSTR(v.fecha, 1, 10) BETWEEN ? AND ?
         GROUP BY i.descripcion ORDER BY unidades DESC LIMIT 10`, ...p,
      ),
      por_categoria: db.all(
        `SELECT COALESCE(p.categoria, 'Sin producto') categoria, SUM(i.cantidad) unidades, SUM(i.cantidad * i.precio) total
         FROM venta_items i JOIN ventas v ON v.id = i.venta_id LEFT JOIN productos p ON p.id = i.producto_id
         WHERE v.estado = 'ok' AND SUBSTR(v.fecha, 1, 10) BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC`, ...p,
      ),
      consultas: db.all(
        `SELECT c.codigo, COALESCE(p.nombre, '') nombre, COUNT(*) veces FROM consultas c LEFT JOIN productos p ON p.codigo = c.codigo
         WHERE SUBSTR(c.fecha, 1, 10) BETWEEN ? AND ? GROUP BY c.codigo ORDER BY veces DESC LIMIT 10`, ...p,
      ),
      deudores: db.all(
        `SELECT c.id, c.nombre, c.telefono, SUM(m.debe - m.haber) saldo FROM cuenta_corriente m JOIN clientes c ON c.id = m.entidad_id
         WHERE m.entidad = 'cliente' GROUP BY c.id HAVING saldo > 0 ORDER BY saldo DESC`,
      ),
    };
  }

  /* ---- Rutas: [método, patrón, manejador(ctx)] ---- */
  const rutas = [];
  const ruta = (metodo, patron, fn) => rutas.push({
    metodo,
    fn,
    re: new RegExp(`^${patron.replace(/:id/g, '(\\d+)')}$`),
  });

  ruta('GET', '/api/opciones', () => ({
    medios: MEDIOS,
    comprobantes: TIPOS_COMPROBANTE,
    categorias_caja: CATEGORIAS_MANUALES,
    categorias_producto: db.all(`SELECT DISTINCT categoria FROM productos WHERE activo = 1 ORDER BY categoria`).map((r) => r.categoria),
    materiales: db.all(`SELECT DISTINCT material FROM productos WHERE activo = 1 AND material != '' ORDER BY material`).map((r) => r.material),
    siguiente_codigo: siguienteCodigo(),
  }));
  ruta('GET', '/api/resumen', resumen);
  ruta('GET', '/api/reportes', ({ q }) => reportes(q));

  ruta('GET', '/api/productos', () => db.all(
    `SELECT p.*, pr.nombre proveedor FROM productos p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id WHERE p.activo = 1 ORDER BY p.categoria, p.nombre`,
  ));
  ruta('POST', '/api/productos', ({ b }) => {
    const d = datosProducto(b);
    const codigo = codigoLibre(texto(b.codigo, 30) || siguienteCodigo());
    const stock = entero(b.stock ?? 0, 'El stock inicial');
    return db.tx(() => {
      const { lastInsertRowid } = db.run(
        `INSERT INTO productos (codigo, nombre, descripcion, categoria, material, costo, precio, stock_minimo, proveedor_id, imagen, publicado, destacado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        codigo, d.nombre, d.descripcion, d.categoria, d.material, d.costo, d.precio, d.stock_minimo, d.proveedor_id, d.imagen, d.publicado, d.destacado,
      );
      const id = Number(lastInsertRowid);
      if (stock) moverStock(id, stock, 'Stock inicial');
      return { id, codigo };
    });
  });
  ruta('PUT', '/api/productos/:id', ({ id, b }) => {
    existe('productos', id);
    const d = datosProducto(b);
    const codigo = codigoLibre(requerido(b.codigo, 'el código', 30), id);
    db.run(
      `UPDATE productos SET codigo = ?, nombre = ?, descripcion = ?, categoria = ?, material = ?, costo = ?, precio = ?, stock_minimo = ?,
       proveedor_id = ?, imagen = ?, publicado = ?, destacado = ?, revisar = 0 WHERE id = ?`,
      codigo, d.nombre, d.descripcion, d.categoria, d.material, d.costo, d.precio, d.stock_minimo, d.proveedor_id, d.imagen, d.publicado, d.destacado, id,
    );
    return { ok: true };
  });
  ruta('DELETE', '/api/productos/:id', ({ id }) => {
    existe('productos', id);
    db.run('UPDATE productos SET activo = 0, publicado = 0 WHERE id = ?', id);
    return { ok: true };
  });
  ruta('POST', '/api/productos/:id/ajuste', ({ id, b }) => {
    existe('productos', id);
    const cantidad = entero(b.cantidad, 'La cantidad', -100000, 100000);
    if (!cantidad) falla('La cantidad no puede ser cero');
    db.tx(() => moverStock(id, cantidad, requerido(b.motivo, 'el motivo', 120)));
    return { ok: true };
  });
  ruta('GET', '/api/productos/:id/movimientos', ({ id }) => db.all('SELECT * FROM movimientos_stock WHERE producto_id = ? ORDER BY id DESC LIMIT 100', id));
  ruta('POST', '/api/productos/precios', ({ b }) => {
    const porcentaje = Number(b.porcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje <= -100 || porcentaje > 1000 || porcentaje === 0) falla('Porcentaje no válido');
    const redondeo = entero(b.redondeo ?? 100, 'El redondeo', 1);
    const filtro = texto(b.categoria, 60);
    const lista = db.all(`SELECT id, precio FROM productos WHERE activo = 1 AND precio > 0 ${filtro ? 'AND categoria = ?' : ''}`, ...(filtro ? [filtro] : []));
    db.tx(() => {
      for (const p of lista) {
        db.run('UPDATE productos SET precio = ? WHERE id = ?', Math.round((p.precio * (1 + porcentaje / 100)) / redondeo) * redondeo, p.id);
      }
    });
    return { actualizados: lista.length };
  });

  for (const tabla of ['clientes', 'proveedores']) {
    const entidad = tabla === 'clientes' ? 'cliente' : 'proveedor';
    const campos = CAMPOS[tabla];
    const valores = (b) => campos.map((c) => (c === 'nombre' ? requerido(b.nombre, 'el nombre', 120) : texto(b[c], 300)));
    ruta('GET', `/api/${tabla}`, () => db.all(
      `SELECT t.*, COALESCE((SELECT SUM(debe - haber) FROM cuenta_corriente m WHERE m.entidad = '${entidad}' AND m.entidad_id = t.id), 0) saldo
       FROM ${tabla} t WHERE t.activo = 1 ORDER BY t.nombre`,
    ));
    ruta('POST', `/api/${tabla}`, ({ b }) => ({
      id: Number(db.run(`INSERT INTO ${tabla} (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`, ...valores(b)).lastInsertRowid),
    }));
    ruta('PUT', `/api/${tabla}/:id`, ({ id, b }) => {
      existe(tabla, id);
      db.run(`UPDATE ${tabla} SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...valores(b), id);
      return { ok: true };
    });
    ruta('DELETE', `/api/${tabla}/:id`, ({ id }) => {
      existe(tabla, id);
      if (saldo(entidad, id) !== 0) falla('No se puede eliminar: tiene saldo en cuenta corriente');
      db.run(`UPDATE ${tabla} SET activo = 0 WHERE id = ?`, id);
      return { ok: true };
    });
    ruta('GET', `/api/${tabla}/:id/cuenta`, ({ id }) => ({
      saldo: saldo(entidad, id),
      movimientos: db.all('SELECT * FROM cuenta_corriente WHERE entidad = ? AND entidad_id = ? ORDER BY id DESC LIMIT 200', entidad, id),
    }));
    ruta('POST', `/api/${tabla}/:id/pago`, ({ id, b }) => {
      existe(tabla, id);
      const monto = entero(b.monto, 'El monto', 1);
      const { nombre } = db.get(`SELECT nombre FROM ${tabla} WHERE id = ?`, id);
      db.tx(() => {
        if (entidad === 'cliente') {
          movimientoCaja('ingreso', 'Cobranza', `Pago de ${nombre}`, medio(b.medio), monto, 'cliente', id);
          asiento('cliente', id, texto(b.concepto, 120) || `Pago (${b.medio})`, 0, monto);
        } else {
          movimientoCaja('egreso', 'Pago a proveedor', `Pago a ${nombre}`, medio(b.medio), monto, 'proveedor', id);
          asiento('proveedor', id, texto(b.concepto, 120) || `Pago (${b.medio})`, 0, monto);
        }
      });
      return { saldo: saldo(entidad, id) };
    });
    ruta('POST', `/api/${tabla}/:id/saldo-inicial`, ({ id, b }) => {
      existe(tabla, id);
      asiento(entidad, id, 'Saldo inicial', entero(b.monto, 'El monto', 1), 0);
      return { saldo: saldo(entidad, id) };
    });
  }

  ruta('GET', '/api/ventas', ({ q }) => {
    const { desde, hasta } = rango(q);
    return db.all(
      `SELECT v.*, c.nombre cliente FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE SUBSTR(v.fecha, 1, 10) BETWEEN ? AND ? ORDER BY v.id DESC LIMIT 500`, desde, hasta,
    );
  });
  ruta('POST', '/api/ventas', ({ b }) => crearVenta(b));
  ruta('GET', '/api/ventas/:id', ({ id }) => verVenta(id));
  ruta('POST', '/api/ventas/:id/anular', ({ id }) => anularVenta(id));
  ruta('PUT', '/api/ventas/:id/factura', ({ id, b }) => {
    verVenta(id);
    db.run('UPDATE ventas SET factura_arca = ? WHERE id = ?', texto(b.factura_arca, 80), id);
    return { ok: true };
  });

  ruta('GET', '/api/compras', () => db.all(
    `SELECT c.*, p.nombre proveedor FROM compras c JOIN proveedores p ON p.id = c.proveedor_id ORDER BY c.id DESC LIMIT 300`,
  ));
  ruta('POST', '/api/compras', ({ b }) => crearCompra(b));

  ruta('GET', '/api/caja', ({ q }) => {
    const { desde, hasta } = rango(q);
    return {
      desde,
      hasta,
      efectivo: efectivoEnCaja(),
      movimientos: db.all('SELECT * FROM caja WHERE SUBSTR(fecha, 1, 10) BETWEEN ? AND ? ORDER BY id DESC LIMIT 1000', desde, hasta),
      cierres: db.all('SELECT * FROM cierres_caja ORDER BY id DESC LIMIT 10'),
    };
  });
  ruta('POST', '/api/caja', ({ b }) => {
    const tipo = b.tipo === 'ingreso' ? 'ingreso' : 'egreso';
    if (!CATEGORIAS_MANUALES[tipo].includes(b.categoria)) falla('Categoría no válida');
    movimientoCaja(tipo, b.categoria, requerido(b.concepto, 'el concepto', 200), medio(b.medio), entero(b.monto, 'El monto', 1));
    return { ok: true };
  });
  ruta('DELETE', '/api/caja/:id', ({ id }) => {
    const m = db.get('SELECT * FROM caja WHERE id = ?', id) || falla('Movimiento inexistente', 404);
    if (m.ref_tipo) falla('Este movimiento viene de otra operación: anulá esa operación');
    db.run('DELETE FROM caja WHERE id = ?', id);
    return { ok: true };
  });
  ruta('POST', '/api/caja/cierre', ({ b }) => {
    const contado = entero(b.contado, 'El efectivo contado');
    return db.tx(() => {
      const esperado = efectivoEnCaja();
      const diferencia = contado - esperado;
      db.run('INSERT INTO cierres_caja (fecha, esperado, contado, diferencia, notas) VALUES (?, ?, ?, ?, ?)', ahora(), esperado, contado, diferencia, texto(b.notas, 200));
      if (diferencia) {
        movimientoCaja(diferencia > 0 ? 'ingreso' : 'egreso', 'Ajuste de arqueo', 'Diferencia del cierre de caja', 'Efectivo', Math.abs(diferencia), 'cierre');
      }
      return { esperado, contado, diferencia };
    });
  });

  ruta('GET', '/api/arreglos', () => db.all(
    `SELECT a.*, COALESCE(c.nombre, a.cliente_nombre) cliente, c.telefono FROM arreglos a LEFT JOIN clientes c ON c.id = a.cliente_id
     ORDER BY a.estado IN ('entregado', 'cancelado'), a.id DESC LIMIT 300`,
  ));
  ruta('POST', '/api/arreglos', ({ b }) => db.tx(() => {
    const precio = entero(b.precio ?? 0, 'El precio');
    const { lastInsertRowid } = db.run(
      'INSERT INTO arreglos (cliente_id, cliente_nombre, descripcion, precio, fecha_ingreso, fecha_entrega, notas) VALUES (?, ?, ?, ?, ?, ?, ?)',
      b.cliente_id ? entero(b.cliente_id, 'Cliente', 1) : null, texto(b.cliente_nombre, 120), requerido(b.descripcion, 'la descripción', 300),
      precio, hoy(), texto(b.fecha_entrega, 10), texto(b.notas, 300),
    );
    const id = Number(lastInsertRowid);
    const sena = entero(b.sena ?? 0, 'La seña');
    if (sena) cobrarArreglo(db.get('SELECT * FROM arreglos WHERE id = ?', id), sena, b.medio);
    return { id };
  }));
  ruta('POST', '/api/arreglos/:id/estado', ({ id, b }) => db.tx(() => {
    const a = db.get('SELECT * FROM arreglos WHERE id = ?', id) || falla('Arreglo inexistente', 404);
    if (!['pendiente', 'listo', 'entregado', 'cancelado'].includes(b.estado)) falla('Estado no válido');
    if (b.estado === 'entregado' && a.precio > a.pagado) cobrarArreglo(a, a.precio - a.pagado, b.medio);
    db.run('UPDATE arreglos SET estado = ? WHERE id = ?', b.estado, id);
    return { ok: true };
  }));

  ruta('GET', '/api/ajustes', () => ({
    negocio: db.conf('negocio', 'Izel Joyas'),
    direccion: db.conf('direccion', 'Merlo 2633, B1744OEO Moreno, Provincia de Buenos Aires'),
    cuit: db.conf('cuit'),
    whatsapp: db.conf('whatsapp'),
    mostrar_agotados: db.conf('mostrar_agotados', '0') === '1',
  }));
  ruta('PUT', '/api/ajustes', ({ b }) => {
    const whatsapp = texto(b.whatsapp, 20).replace(/\D/g, '');
    db.setConf('negocio', requerido(b.negocio, 'el nombre del negocio', 80));
    db.setConf('direccion', texto(b.direccion, 200));
    db.setConf('cuit', texto(b.cuit, 20));
    db.setConf('whatsapp', whatsapp);
    db.setConf('mostrar_agotados', b.mostrar_agotados ? '1' : '0');
    return { ok: true };
  });

  return function despachar(metodo, ruta_, q, b) {
    for (const r of rutas) {
      if (r.metodo !== metodo) continue;
      const m = r.re.exec(ruta_);
      if (m) return r.fn({ id: m[1] ? Number(m[1]) : undefined, q, b: b || {} });
    }
    return falla('Ruta inexistente', 404);
  };
}

// Lo único que ve el público: nunca precios, costos ni cantidades.
export function catalogoPublico(db) {
  const agotados = db.conf('mostrar_agotados', '0') === '1';
  return {
    tienda: { whatsapp: db.conf('whatsapp') },
    productos: db.all(
      `SELECT codigo, nombre, categoria, material, descripcion, imagen, destacado, stock FROM productos WHERE activo = 1 AND publicado = 1 ORDER BY id`,
    ).map(({ stock, destacado, material, ...p }) => ({
      ...p, material: material || null, destacado: Boolean(destacado), agotado: agotados && stock <= 0,
    })),
  };
}

export function registrarConsulta(db, codigos) {
  if (!Array.isArray(codigos)) falla('Consulta no válida');
  const fecha = ahora();
  db.tx(() => {
    for (const c of codigos.slice(0, 50)) {
      if (typeof c === 'string' && db.get('SELECT id FROM productos WHERE codigo = ? AND publicado = 1', c)) {
        db.run('INSERT INTO consultas (fecha, codigo) VALUES (?, ?)', fecha, c);
      }
    }
  });
}
