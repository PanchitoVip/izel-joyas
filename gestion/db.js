import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Todos los importes se guardan en centavos (enteros) para no arrastrar errores de redondeo.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, expira INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, contacto TEXT DEFAULT '', telefono TEXT DEFAULT '',
  email TEXT DEFAULT '', cuit TEXT DEFAULT '', direccion TEXT DEFAULT '', notas TEXT DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT DEFAULT '', email TEXT DEFAULT '',
  documento TEXT DEFAULT '', direccion TEXT DEFAULT '', cumpleanos TEXT DEFAULT '',
  talle_anillo TEXT DEFAULT '', notas TEXT DEFAULT '', activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, descripcion TEXT DEFAULT '',
  categoria TEXT NOT NULL DEFAULT 'Otros', material TEXT DEFAULT '',
  costo INTEGER NOT NULL DEFAULT 0, precio INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0, stock_minimo INTEGER NOT NULL DEFAULT 0,
  proveedor_id INTEGER REFERENCES proveedores(id), imagen TEXT DEFAULT '',
  publicado INTEGER NOT NULL DEFAULT 0, destacado INTEGER NOT NULL DEFAULT 0,
  revisar INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS movimientos_stock (
  id INTEGER PRIMARY KEY, producto_id INTEGER NOT NULL REFERENCES productos(id), fecha TEXT NOT NULL,
  cantidad INTEGER NOT NULL, motivo TEXT NOT NULL, ref_tipo TEXT, ref_id INTEGER
);
CREATE TABLE IF NOT EXISTS cuenta_corriente (
  id INTEGER PRIMARY KEY, entidad TEXT NOT NULL CHECK (entidad IN ('cliente','proveedor')),
  entidad_id INTEGER NOT NULL, fecha TEXT NOT NULL, concepto TEXT NOT NULL,
  debe INTEGER NOT NULL DEFAULT 0, haber INTEGER NOT NULL DEFAULT 0, ref_tipo TEXT, ref_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cc ON cuenta_corriente (entidad, entidad_id);
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, numero INTEGER NOT NULL, fecha TEXT NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id), subtotal INTEGER NOT NULL, descuento INTEGER NOT NULL DEFAULT 0,
  recargo INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, costo_total INTEGER NOT NULL DEFAULT 0,
  pagado INTEGER NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'ok', factura_arca TEXT DEFAULT '',
  notas TEXT DEFAULT '', UNIQUE (tipo, numero)
);
CREATE TABLE IF NOT EXISTS venta_items (
  id INTEGER PRIMARY KEY, venta_id INTEGER NOT NULL REFERENCES ventas(id), producto_id INTEGER REFERENCES productos(id),
  descripcion TEXT NOT NULL, cantidad INTEGER NOT NULL, precio INTEGER NOT NULL, costo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY, proveedor_id INTEGER NOT NULL REFERENCES proveedores(id), fecha TEXT NOT NULL,
  comprobante TEXT DEFAULT '', total INTEGER NOT NULL, notas TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS compra_items (
  id INTEGER PRIMARY KEY, compra_id INTEGER NOT NULL REFERENCES compras(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id), cantidad INTEGER NOT NULL, costo INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS caja (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria TEXT NOT NULL, concepto TEXT NOT NULL, medio TEXT NOT NULL, monto INTEGER NOT NULL CHECK (monto > 0),
  ref_tipo TEXT, ref_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_caja_fecha ON caja (fecha);
CREATE TABLE IF NOT EXISTS cierres_caja (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, esperado INTEGER NOT NULL, contado INTEGER NOT NULL,
  diferencia INTEGER NOT NULL, notas TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS arreglos (
  id INTEGER PRIMARY KEY, cliente_id INTEGER REFERENCES clientes(id), cliente_nombre TEXT DEFAULT '',
  descripcion TEXT NOT NULL, precio INTEGER NOT NULL DEFAULT 0, pagado INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente', fecha_ingreso TEXT NOT NULL, fecha_entrega TEXT DEFAULT '', notas TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS consultas (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, codigo TEXT NOT NULL);
`;

const formatoFecha = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'medium',
});
export const ahora = () => formatoFecha.format(new Date());
export const hoy = () => ahora().slice(0, 10);

export function abrirDb(dir, rutaCatalogo) {
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const raw = new DatabaseSync(path.join(dir, 'izel.db'));
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);

  const db = {
    raw,
    all: (sql, ...p) => raw.prepare(sql).all(...p),
    get: (sql, ...p) => raw.prepare(sql).get(...p),
    run: (sql, ...p) => raw.prepare(sql).run(...p),
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    conf: (k, porDefecto = '') => raw.prepare('SELECT v FROM config WHERE k = ?').get(k)?.v ?? porDefecto,
    setConf: (k, v) => raw.prepare('INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, String(v)),
  };

  if (db.get('SELECT COUNT(*) n FROM productos').n === 0 && !db.conf('sembrado')) sembrar(db, rutaCatalogo);
  return db;
}

// Primera vez: arranca con los productos relevados de Instagram, ya publicados en el catálogo.
function sembrar(db, rutaCatalogo) {
  db.setConf('sembrado', '1');
  if (!fs.existsSync(rutaCatalogo)) return;
  const { productos } = JSON.parse(fs.readFileSync(rutaCatalogo, 'utf8'));
  db.tx(() => {
    for (const p of productos) {
      db.run(
        `INSERT INTO productos (codigo, nombre, descripcion, categoria, material, imagen, publicado, destacado, revisar)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        p.codigo, p.nombre, p.descripcion || '', p.categoria, p.material || '', p.imagen, p.destacado ? 1 : 0, p.revisar ? 1 : 0,
      );
    }
  });
}
