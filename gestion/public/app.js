/* Sistema de gestión de Izel Joyas. Importes siempre en centavos; se convierten sólo al mostrar o leer un campo. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---- Plantillas con escape automático ---- */
class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const valor = (v) => {
  if (v instanceof Seguro) return v.s;
  if (Array.isArray(v)) return v.map(valor).join('');
  return v === false || v == null ? '' : esc(v);
};
const h = (partes, ...vals) => new Seguro(partes.reduce((acc, p, i) => acc + p + (i < vals.length ? valor(vals[i]) : ''), ''));

/* ---- Formatos ---- */
const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const plata = (c) => moneda.format((c || 0) / 100);
const aCentavos = (v) => Math.round(Number(String(v).replace(',', '.') || 0) * 100);
const aPesos = (c) => (c ? String(c / 100) : '');
const fecha = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '');
const fechaHora = (f) => (f ? `${fecha(f)} ${f.slice(11, 16)}` : '');
const hoyLocal = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const inicioMes = () => `${hoyLocal().slice(0, 7)}-01`;
const operaciones = (n) => `${n} ${n === 1 ? 'operación' : 'operaciones'}`;
const urlImagen = (i) => (i ? `/${i}` : '/img/logo.jpg');
function telefonoWa(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `549${d}`;
  return d;
}
const linkWa = (t, texto) => `https://wa.me/${telefonoWa(t)}?text=${encodeURIComponent(texto)}`;

/* ---- API ---- */
async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`/api/${ruta}`, {
    method: metodo,
    headers: cuerpo !== undefined ? { 'content-type': 'application/json' } : {},
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== 'login') { pantallaAcceso(true); throw new Error('Tenés que iniciar sesión'); }
  if (!r.ok) { const e = new Error(data.error || 'No se pudo completar la operación'); e.status = r.status; throw e; }
  return data;
}

let temporizador;
function aviso(texto, malo = false) {
  const t = $('#aviso');
  t.textContent = texto;
  t.classList.toggle('bad', malo);
  t.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { t.hidden = true; }, malo ? 5000 : 2600);
}
const intentar = (fn) => async (...a) => {
  try { return await fn(...a); } catch (e) { aviso(e.message, true); return undefined; }
};

/* ---- Modal ---- */
function abrirModal(titulo, cuerpo) {
  const m = $('#modal');
  m.innerHTML = h`<div class="modal-head"><h2>${titulo}</h2><button class="btn small" type="button" data-cerrar aria-label="Cerrar">✕</button></div>${cuerpo}`;
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', () => m.close()));
  if (!m.open) m.showModal();
  return m;
}
const cerrarModal = () => $('#modal').close();
const leerForm = (f) => Object.fromEntries(new FormData(f));
function confirmar(titulo, texto, etiqueta = 'Confirmar') {
  return new Promise((resolver) => {
    const m = abrirModal(titulo, h`<p>${texto}</p><div class="modal-foot"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary" id="si" type="button">${etiqueta}</button></div>`);
    let respuesta = false;
    $('#si', m).addEventListener('click', () => { respuesta = true; m.close(); });
    $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', () => m.close()));
    m.addEventListener('close', () => resolver(respuesta), { once: true });
  });
}
const opciones = (lista, sel) => lista.map((o) => h`<option value="${o}" ${o === sel ? 'selected' : ''}>${o}</option>`);

/* ---- Acceso ---- */
async function pantallaAcceso(vencida = false) {
  const { configurado } = await fetch('/api/sesion').then((r) => r.json());
  $('#app').innerHTML = h`<div class="login"><form id="acceso">
    <img src="/img/logo.jpg" alt="Izel Joyas">
    <h1>${configurado ? 'Gestión Izel Joyas' : 'Crear contraseña'}</h1>
    ${!configurado && h`<p class="hint">Es la primera vez. Ingresá el código que aparece en la ventana del servidor y elegí tu contraseña.</p>
      <label class="f">Código de instalación<input name="codigo" required autocomplete="off"></label>`}
    ${vencida && configurado && h`<p class="hint">Tu sesión terminó. Volvé a entrar.</p>`}
    <label class="f">Contraseña<input name="clave" type="password" required minlength="${configurado ? 1 : 8}" autocomplete="${configurado ? 'current-password' : 'new-password'}" autofocus></label>
    <p class="error" id="err" role="alert"></p>
    <button class="btn primary">${configurado ? 'Entrar' : 'Crear y entrar'}</button>
  </form></div>`;
  $('#acceso').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', configurado ? 'login' : 'instalar', leerForm(e.target));
      iniciar();
    } catch (err) { $('#err').textContent = err.message; }
  });
}

/* ---- Armazón ---- */
const MENU = [
  ['inicio', 'Inicio'], ['venta', 'Nueva venta'], ['ventas', 'Ventas'], ['productos', 'Stock'], ['clientes', 'Clientes'],
  ['proveedores', 'Proveedores'], ['compras', 'Compras'], ['caja', 'Caja'], ['pagos', 'Pagos'], ['arreglos', 'Arreglos'], ['reportes', 'Reportes'], ['ajustes', 'Ajustes'],
];
let op = {};

function armazon() {
  $('#app').innerHTML = h`<div class="layout">
    <aside class="side">
      <div class="side-brand"><img src="/img/logo.jpg" alt=""><span>Izel Joyas</span></div>
      <nav aria-label="Secciones">${MENU.map(([r, t]) => h`<a href="#/${r}" data-r="${r}">${t}</a>`)}</nav>
      <div class="side-foot"><a href="/" target="_blank" rel="noopener">Ver catálogo</a><button id="salir" type="button">Salir</button></div>
    </aside>
    <main id="vista"></main>
  </div>`;
  $('#salir').addEventListener('click', intentar(async () => { await api('POST', 'logout', {}); pantallaAcceso(); }));
}

const VISTAS = {};
async function navegar() {
  const [ruta = 'inicio', param] = location.hash.replace(/^#\//, '').split('/');
  const vista = VISTAS[ruta] || VISTAS.inicio;
  $$('.side nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === ruta));
  const v = $('#vista');
  if (!v) return;
  try { await vista(v, param); } catch (e) { if (e.message !== 'Tenés que iniciar sesión') v.innerHTML = h`<p class="notice">${e.message}</p>`; }
}
const refrescar = () => navegar();

/* ---- Inicio ---- */
function graficoVentas(serie, desde) {
  const dias = [];
  const d0 = new Date(`${desde}T12:00:00Z`);
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(d0);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    dias.push({ dia: iso, total: serie.find((s) => s.dia === iso)?.total || 0 });
  }
  const max = Math.max(...dias.map((d) => d.total), 1);
  const W = 720; const H = 170; const base = 146; const alto = 132; const paso = W / 30; const ancho = paso - 6;
  const barras = dias.map((d, i) => {
    const bh = d.total ? Math.max((d.total / max) * alto, 3) : 0;
    const x = i * paso + 3;
    const y = base - bh;
    const r = Math.min(4, bh);
    const path = `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + ancho - r}Q${x + ancho} ${y} ${x + ancho} ${y + r}V${base}Z`;
    return h`<g data-tip="${fecha(d.dia)}: ${plata(d.total)}"><rect class="hit" x="${i * paso}" y="0" width="${paso}" height="${base}"></rect>${bh ? h`<path class="bar" d="${path}"></path>` : ''}<title>${fecha(d.dia)}: ${plata(d.total)}</title></g>`;
  });
  const etiquetas = [0, 10, 20, 29].map((i) => h`<text class="axis" x="${i * paso + paso / 2}" y="${H - 6}" text-anchor="middle">${fecha(dias[i].dia).slice(0, 5)}</text>`);
  return h`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas por día, últimos 30 días">
    <line class="grid" x1="0" x2="${W}" y1="${base}" y2="${base}"></line>${barras}${etiquetas}</svg>
    <p class="chart-tip" id="tip">Pasá por una barra para ver el día. Máximo: ${plata(max === 1 ? 0 : max)}</p>`;
}

VISTAS.inicio = async (v) => {
  const r = await api('GET', 'resumen');
  const ajustes = await api('GET', 'ajustes');
  v.innerHTML = h`
    <div class="head"><h1>Inicio</h1><div class="head-actions"><a class="btn primary" href="#/venta">Nueva venta</a></div></div>
    ${!ajustes.whatsapp && h`<p class="notice">Falta el número de WhatsApp del catálogo. <a href="#/ajustes">Cargalo en Ajustes</a>.</p>`}
    ${r.por_revisar > 0 && h`<p class="notice">Hay ${r.por_revisar} productos sin precio o con datos por revisar. <a href="#/productos/revisar">Ver cuáles</a>.</p>`}
    <div class="tiles">
      <div class="tile"><small>Ventas de hoy</small><strong>${plata(r.hoy.ventas)}</strong><span>${operaciones(r.hoy.cantidad)}</span></div>
      <div class="tile"><small>Ventas del mes</small><strong>${plata(r.mes.ventas)}</strong><span>${operaciones(r.mes.cantidad)}</span></div>
      <div class="tile"><small>Ganancia del mes</small><strong class="${r.mes.resultado < 0 ? 'neg' : ''}">${plata(r.mes.resultado)}</strong><span>ventas − costo − gastos</span></div>
      <div class="tile"><small>Efectivo en caja</small><strong>${plata(r.efectivo)}</strong></div>
      <div class="tile"><small>Te deben clientes</small><strong>${plata(r.a_cobrar)}</strong></div>
      <div class="tile"><small>Debés a proveedores</small><strong>${plata(r.a_pagar)}</strong></div>
      <div class="tile"><small>Stock a costo</small><strong>${plata(r.stock.costo)}</strong><span>${r.stock.unidades} unidades</span></div>
    </div>
    <div class="cols">
      <section class="card wide"><h2>Ventas de los últimos 30 días</h2>${graficoVentas(r.serie, r.desde_serie)}</section>
      <section class="card"><h2>Stock bajo</h2>${r.stock_bajo.length ? h`<table><tbody>${r.stock_bajo.map((p) => h`<tr><td>${p.nombre}</td><td class="n"><span class="tag ${p.stock <= 0 ? 'bad' : 'warn'}">${p.stock} / mín. ${p.stock_minimo}</span></td></tr>`)}</tbody></table>` : h`<p class="hint">Nada por reponer. Definí el stock mínimo en cada producto para recibir avisos.</p>`}</section>
      <section class="card"><h2>Cumpleaños próximos</h2>${r.cumpleanos.length ? h`<table><tbody>${r.cumpleanos.map((c) => h`<tr><td>${c.nombre}</td><td>${fecha(c.cumpleanos).slice(0, 5)}</td><td class="actions">${c.telefono && h`<a class="btn small" target="_blank" rel="noopener" href="${linkWa(c.telefono, `¡Hola ${c.nombre}! Desde Izel Joyas te deseamos un muy feliz cumpleaños.`)}">Saludar</a>`}</td></tr>`)}</tbody></table>` : h`<p class="hint">Ninguno en los próximos 14 días.</p>`}</section>
      <section class="card"><h2>Arreglos pendientes</h2>${r.arreglos.length ? h`<table><tbody>${r.arreglos.map((a) => h`<tr><td>${a.cliente || 'Sin cliente'}<br><span class="hint">${a.descripcion}</span></td><td class="n">${a.fecha_entrega ? fecha(a.fecha_entrega) : ''}<br>${tagArreglo(a.estado)}</td></tr>`)}</tbody></table>` : h`<p class="hint">No hay arreglos en curso.</p>`}</section>
    </div>`;
  $$('.chart g[data-tip]', v).forEach((g) => g.addEventListener('mouseenter', () => { $('#tip').textContent = g.dataset.tip; }));
};

/* ---- Productos ---- */
let filtroProductos = { q: '', categoria: '', vista: '' };
function filaProducto(p) {
  const estado = p.stock <= 0 ? 'bad' : p.stock_minimo && p.stock <= p.stock_minimo ? 'warn' : 'ok';
  return h`<tr>
    <td><img class="thumb" src="${urlImagen(p.imagen)}" alt="" loading="lazy"></td>
    <td>${p.codigo}</td>
    <td>${p.nombre}${p.revisar ? h` <span class="tag warn">Revisar</span>` : ''}<br><span class="hint">${p.categoria}${p.material ? ` · ${p.material}` : ''}</span></td>
    <td class="n">${plata(p.costo)}</td>
    <td class="n">${p.precio ? plata(p.precio) : h`<span class="tag warn">Sin precio</span>`}</td>
    <td class="n"><span class="tag ${estado}">${p.stock}</span></td>
    <td>${p.publicado ? h`<span class="tag ok">Publicado</span>` : h`<span class="tag mute">Oculto</span>`}</td>
    <td class="actions"><button class="btn small" data-stock="${p.id}" type="button">Stock</button> <button class="btn small" data-editar="${p.id}" type="button">Editar</button></td>
  </tr>`;
}

async function subirFoto(archivo) {
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * escala);
  c.height = Math.round(bmp.height * escala);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => { c.toBlob(r, 'image/jpeg', 0.85); });
  const r = await fetch('/api/imagenes', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data.imagen;
}

function formProducto(p, proveedores) {
  const nuevo = !p.id;
  const m = abrirModal(nuevo ? 'Nuevo producto' : `Editar ${p.nombre}`, h`<form class="form" id="fp">
    <div class="full row"><img class="foto-prev" id="prev" src="${urlImagen(p.imagen)}" alt="">
      <label class="f grow">Foto<input type="file" id="foto" accept="image/*"></label></div>
    <label class="f">Código<input name="codigo" value="${p.codigo || op.siguiente_codigo}" required></label>
    <label class="f">Nombre<input name="nombre" value="${p.nombre || ''}" required></label>
    <label class="f">Categoría<input name="categoria" list="cats" value="${p.categoria || ''}" required><datalist id="cats">${op.categorias_producto.map((c) => h`<option value="${c}"></option>`)}</datalist></label>
    <label class="f">Material<input name="material" list="mats" value="${p.material || ''}" placeholder="Plata 925"><datalist id="mats">${op.materiales.map((c) => h`<option value="${c}"></option>`)}</datalist></label>
    <label class="f">Costo ($)<input name="costo" type="number" min="0" step="0.01" value="${aPesos(p.costo)}"></label>
    <label class="f">Precio de venta ($)<input name="precio" type="number" min="0" step="0.01" value="${aPesos(p.precio)}"></label>
    ${nuevo && h`<label class="f">Stock inicial<input name="stock" type="number" min="0" step="1" value="0"></label>`}
    <label class="f">Avisar cuando queden<input name="stock_minimo" type="number" min="0" step="1" value="${p.stock_minimo || 0}"></label>
    <label class="f">Proveedor<select name="proveedor_id"><option value="">Sin proveedor</option>${proveedores.map((x) => h`<option value="${x.id}" ${x.id === p.proveedor_id ? 'selected' : ''}>${x.nombre}</option>`)}</select></label>
    <label class="f full">Descripción para el catálogo<textarea name="descripcion" rows="2">${p.descripcion || ''}</textarea></label>
    <label class="check"><input type="checkbox" name="publicado" ${p.publicado ? 'checked' : ''}> Publicar en el catálogo</label>
    <label class="check"><input type="checkbox" name="destacado" ${p.destacado ? 'checked' : ''}> Marcar como favorito</label>
    <div class="modal-foot full">
      ${!nuevo && h`<button class="btn danger" id="borrar" type="button">Eliminar</button>`}
      <span class="grow"></span>
      <button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Guardar</button>
    </div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  let imagen = p.imagen || '';
  $('#foto', m).addEventListener('change', intentar(async (e) => {
    if (!e.target.files[0]) return;
    imagen = await subirFoto(e.target.files[0]);
    $('#prev', m).src = urlImagen(imagen);
  }));
  $('#fp', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    const cuerpo = {
      ...d, imagen, costo: aCentavos(d.costo), precio: aCentavos(d.precio), stock_minimo: Number(d.stock_minimo || 0),
      stock: Number(d.stock || 0), publicado: Boolean(d.publicado), destacado: Boolean(d.destacado),
    };
    if (nuevo) await api('POST', 'productos', cuerpo); else await api('PUT', `productos/${p.id}`, cuerpo);
    op = await api('GET', 'opciones');
    cerrarModal();
    aviso('Producto guardado');
    refrescar();
  }));
  $('#borrar', m)?.addEventListener('click', intentar(async () => {
    if (!await confirmar('Eliminar producto', `Se quita ${p.nombre} del stock y del catálogo. El historial de ventas se conserva.`, 'Eliminar')) return;
    await api('DELETE', `productos/${p.id}`);
    aviso('Producto eliminado');
    refrescar();
  }));
}

async function formStock(p) {
  const movs = await api('GET', `productos/${p.id}/movimientos`);
  const m = abrirModal(`Stock de ${p.nombre}`, h`<p>Stock actual: <strong>${p.stock}</strong></p>
    <form class="form" id="fs">
      <label class="f">Sumar o restar<input name="cantidad" type="number" step="1" required placeholder="Ej: 5 o -1"></label>
      <label class="f">Motivo<input name="motivo" list="motivos" required><datalist id="motivos"><option value="Conteo de stock"></option><option value="Rotura o pérdida"></option><option value="Regalo o muestra"></option><option value="Carga inicial"></option></datalist></label>
      <div class="modal-foot full"><button class="btn primary">Registrar ajuste</button></div>
    </form>
    <h2>Últimos movimientos</h2>
    ${movs.length ? h`<table><tbody>${movs.slice(0, 12).map((x) => h`<tr><td>${fechaHora(x.fecha)}</td><td>${x.motivo}</td><td class="n ${x.cantidad < 0 ? 'neg' : 'pos'}">${x.cantidad > 0 ? '+' : ''}${x.cantidad}</td></tr>`)}</tbody></table>` : h`<p class="hint">Sin movimientos todavía.</p>`}`);
  $('#fs', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    await api('POST', `productos/${p.id}/ajuste`, leerForm(e.target));
    cerrarModal();
    aviso('Stock actualizado');
    refrescar();
  }));
}

function formPrecios() {
  const m = abrirModal('Actualizar precios', h`<form class="form" id="fpr">
    <p class="hint full">Aumenta todos los precios cargados de una vez. Usá un número negativo para bajarlos.</p>
    <label class="f">Porcentaje<input name="porcentaje" type="number" step="0.1" required placeholder="Ej: 15"></label>
    <label class="f">Redondear a<select name="redondeo"><option value="10000">$100</option><option value="50000">$500</option><option value="100000">$1.000</option><option value="100">Sin redondear</option></select></label>
    <label class="f full">Categoría<select name="categoria"><option value="">Todas</option>${opciones(op.categorias_producto)}</select></label>
    <div class="modal-foot full"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Aplicar</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  $('#fpr', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const r = await api('POST', 'productos/precios', leerForm(e.target));
    cerrarModal();
    aviso(`Se actualizaron ${r.actualizados} precios`);
    refrescar();
  }));
}

VISTAS.productos = async (v, param) => {
  const [lista, proveedores] = await Promise.all([api('GET', 'productos'), api('GET', 'proveedores')]);
  if (param === 'revisar') filtroProductos.vista = 'revisar';
  v.innerHTML = h`
    <div class="head"><h1>Stock</h1><div class="head-actions">
      <button class="btn" id="precios" type="button">Actualizar precios</button>
      <button class="btn primary" id="nuevo" type="button">Nuevo producto</button></div></div>
    <div class="row">
      <input class="grow" id="q" type="search" placeholder="Buscar por nombre o código" aria-label="Buscar" value="${filtroProductos.q}">
      <select id="cat" aria-label="Categoría" class="grow"><option value="">Todas las categorías</option>${opciones(op.categorias_producto, filtroProductos.categoria)}</select>
      <select id="vis" aria-label="Filtro" class="grow">
        ${[['', 'Todos'], ['revisar', 'Sin precio o por revisar'], ['bajo', 'Stock bajo o sin stock'], ['oculto', 'Ocultos del catálogo']].map(([k, t]) => h`<option value="${k}" ${k === filtroProductos.vista ? 'selected' : ''}>${t}</option>`)}
      </select>
    </div>
    <p class="hint" id="cuenta"></p>
    <div class="tablewrap"><table>
      <thead><tr><th></th><th>Código</th><th>Producto</th><th class="n">Costo</th><th class="n">Precio</th><th class="n">Stock</th><th>Catálogo</th><th></th></tr></thead>
      <tbody id="filas"></tbody></table></div>`;
  const pintar = () => {
    const q = filtroProductos.q.toLowerCase();
    const filas = lista.filter((p) => (!q || `${p.nombre} ${p.codigo}`.toLowerCase().includes(q))
      && (!filtroProductos.categoria || p.categoria === filtroProductos.categoria)
      && (filtroProductos.vista !== 'revisar' || p.revisar || !p.precio)
      && (filtroProductos.vista !== 'bajo' || p.stock <= p.stock_minimo)
      && (filtroProductos.vista !== 'oculto' || !p.publicado));
    $('#filas').innerHTML = filas.length ? h`${filas.map(filaProducto)}` : h`<tr><td colspan="8" class="empty">No hay productos con ese filtro.</td></tr>`;
    $('#cuenta').textContent = `${filas.length} productos`;
  };
  pintar();
  $('#q').addEventListener('input', (e) => { filtroProductos.q = e.target.value; pintar(); });
  $('#cat').addEventListener('change', (e) => { filtroProductos.categoria = e.target.value; pintar(); });
  $('#vis').addEventListener('change', (e) => { filtroProductos.vista = e.target.value; pintar(); });
  $('#nuevo').addEventListener('click', () => formProducto({ publicado: 1 }, proveedores));
  $('#precios').addEventListener('click', formPrecios);
  $('#filas').addEventListener('click', intentar(async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const p = lista.find((x) => x.id === Number(b.dataset.editar || b.dataset.stock));
    if (b.dataset.editar) formProducto(p, proveedores); else await formStock(p);
  }));
};

/* ---- Clientes y proveedores ---- */
const ENTIDADES = {
  clientes: {
    titulo: 'Clientes', singular: 'cliente', saldoTexto: 'Te debe',
    campos: [['nombre', 'Nombre y apellido', 'text', true], ['telefono', 'Teléfono / WhatsApp'], ['email', 'Email', 'email'], ['documento', 'DNI o CUIT'],
      ['cumpleanos', 'Cumpleaños', 'date'], ['talle_anillo', 'Talle de anillo'], ['direccion', 'Dirección'], ['notas', 'Notas (gustos, regalos)']],
  },
  proveedores: {
    titulo: 'Proveedores', singular: 'proveedor', saldoTexto: 'Le debés',
    campos: [['nombre', 'Nombre o razón social', 'text', true], ['contacto', 'Persona de contacto'], ['telefono', 'Teléfono / WhatsApp'], ['email', 'Email', 'email'],
      ['cuit', 'CUIT'], ['direccion', 'Dirección'], ['notas', 'Notas (condiciones, plazos)']],
  },
};

function formEntidad(tabla, x = {}) {
  const e = ENTIDADES[tabla];
  const m = abrirModal(x.id ? `Editar ${x.nombre}` : `Nuevo ${e.singular}`, h`<form class="form" id="fe">
    ${e.campos.map(([k, t, tipo = 'text', req]) => h`<label class="f">${t}<input name="${k}" type="${tipo}" value="${x[k] || ''}" ${req ? 'required' : ''}></label>`)}
    <div class="modal-foot full">
      ${x.id && h`<button class="btn danger" id="borrar" type="button">Eliminar</button>`}<span class="grow"></span>
      <button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  $('#fe', m).addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    if (x.id) await api('PUT', `${tabla}/${x.id}`, leerForm(ev.target)); else await api('POST', tabla, leerForm(ev.target));
    cerrarModal();
    aviso('Guardado');
    refrescar();
  }));
  $('#borrar', m)?.addEventListener('click', intentar(async () => {
    await api('DELETE', `${tabla}/${x.id}`);
    cerrarModal();
    aviso('Eliminado');
    refrescar();
  }));
}

async function verCuenta(tabla, x) {
  const e = ENTIDADES[tabla];
  const c = await api('GET', `${tabla}/${x.id}/cuenta`);
  const esCliente = tabla === 'clientes';
  const msg = `Hola ${x.nombre}, te escribimos de Izel Joyas. Te recordamos que tenés un saldo pendiente de ${plata(c.saldo)}. ¡Muchas gracias!`;
  const m = abrirModal(`Cuenta corriente: ${x.nombre}`, h`
    <p>${e.saldoTexto}: <strong class="${c.saldo > 0 ? 'neg' : ''}">${plata(c.saldo)}</strong></p>
    <form class="form" id="fc">
      <label class="f">${esCliente ? 'Cobrar' : 'Pagar'} ($)<input name="monto" type="number" min="0.01" step="0.01" required value="${c.saldo > 0 ? aPesos(c.saldo) : ''}"></label>
      <label class="f">Medio<select name="medio">${opciones(op.medios)}</select></label>
      <div class="modal-foot full">
        <button class="btn" id="inicial" type="button">Cargar deuda previa</button>
        ${esCliente && x.telefono && c.saldo > 0 && h`<a class="btn" target="_blank" rel="noopener" href="${linkWa(x.telefono, msg)}">Recordar por WhatsApp</a>`}
        <button class="btn primary">Registrar ${esCliente ? 'cobro' : 'pago'}</button></div>
    </form>
    <h2>Movimientos</h2>
    ${c.movimientos.length ? h`<table><thead><tr><th>Fecha</th><th>Concepto</th><th class="n">Debe</th><th class="n">Haber</th></tr></thead><tbody>${c.movimientos.map((r) => h`<tr><td>${fecha(r.fecha)}</td><td>${r.concepto}</td><td class="n">${r.debe ? plata(r.debe) : ''}</td><td class="n">${r.haber ? plata(r.haber) : ''}</td></tr>`)}</tbody></table>` : h`<p class="hint">Sin movimientos.</p>`}`);
  $('#fc', m).addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    const d = leerForm(ev.target);
    await api('POST', `${tabla}/${x.id}/pago`, { monto: aCentavos(d.monto), medio: d.medio });
    aviso(esCliente ? 'Cobro registrado' : 'Pago registrado');
    await refrescar();
    await verCuenta(tabla, x);
  }));
  $('#inicial', m).addEventListener('click', intentar(async () => {
    const monto = $('[name=monto]', m);
    if (!monto.value) { monto.focus(); aviso('Escribí el monto de la deuda previa', true); return; }
    await api('POST', `${tabla}/${x.id}/saldo-inicial`, { monto: aCentavos(monto.value) });
    aviso('Deuda cargada');
    await refrescar();
    await verCuenta(tabla, x);
  }));
}

const vistaEntidad = (tabla) => async (v) => {
  const e = ENTIDADES[tabla];
  const lista = await api('GET', tabla);
  v.innerHTML = h`
    <div class="head"><h1>${e.titulo}</h1><div class="head-actions"><button class="btn primary" id="nuevo" type="button">Nuevo ${e.singular}</button></div></div>
    <input id="q" type="search" placeholder="Buscar" aria-label="Buscar">
    <p class="hint">Total pendiente: <strong>${plata(lista.reduce((s, x) => s + Math.max(x.saldo, 0), 0))}</strong></p>
    <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Teléfono</th><th class="n">Saldo</th><th></th></tr></thead><tbody id="filas"></tbody></table></div>`;
  const pintar = (q = '') => {
    const filas = lista.filter((x) => `${x.nombre} ${x.telefono}`.toLowerCase().includes(q.toLowerCase()));
    $('#filas').innerHTML = filas.length ? h`${filas.map((x) => h`<tr><td>${x.nombre}</td><td>${x.telefono}</td>
      <td class="n ${x.saldo > 0 ? 'neg' : ''}">${plata(x.saldo)}</td>
      <td class="actions"><button class="btn small" data-cuenta="${x.id}" type="button">Cuenta</button> <button class="btn small" data-editar="${x.id}" type="button">Editar</button></td></tr>`)}` : h`<tr><td colspan="4" class="empty">Todavía no hay ${e.titulo.toLowerCase()}.</td></tr>`;
  };
  pintar();
  $('#q').addEventListener('input', (ev) => pintar(ev.target.value));
  $('#nuevo').addEventListener('click', () => formEntidad(tabla));
  $('#filas').addEventListener('click', intentar(async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const x = lista.find((y) => y.id === Number(b.dataset.editar || b.dataset.cuenta));
    if (b.dataset.editar) formEntidad(tabla, x); else await verCuenta(tabla, x);
  }));
};
VISTAS.clientes = vistaEntidad('clientes');
VISTAS.proveedores = vistaEntidad('proveedores');

/* ---- Nueva venta ---- */
VISTAS.venta = async (v) => {
  const [productos, clientes] = await Promise.all([api('GET', 'productos'), api('GET', 'clientes')]);
  const venta = { items: [], pagos: [{ medio: op.medios[0], monto: null }], descuento: 0, recargo: 0 };
  const subtotal = () => venta.items.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const total = () => subtotal() - venta.descuento + venta.recargo;

  v.innerHTML = h`
    <div class="head"><h1>Nueva venta</h1></div>
    <div class="pos-grid">
      <section class="card">
        <label class="f">Producto: nombre, código o lector de códigos<input id="busca" type="search" autocomplete="off" autofocus></label>
        <div class="sugerencias" id="sug"></div>
        <div id="items"></div>
        <button class="link" id="libre" type="button">Agregar ítem sin producto (grabado, envío, seña…)</button>
      </section>
      <section class="card">
        <div class="form">
          <label class="f full">Cliente<select id="cliente"><option value="">Consumidor final</option>${clientes.map((c) => h`<option value="${c.id}">${c.nombre}${c.saldo > 0 ? ` (debe ${plata(c.saldo)})` : ''}</option>`)}</select></label>
          <label class="f">Descuento ($)<input id="descuento" type="number" min="0" step="0.01"></label>
          <label class="f">Recargo / cuotas ($)<input id="recargo" type="number" min="0" step="0.01"></label>
          <label class="f full">Comprobante<select id="tipo">${opciones(op.comprobantes)}</select></label>
        </div>
        <div id="totales"></div>
        <h2>Cobro</h2>
        <div id="pagos"></div>
        <button class="link" id="otroPago" type="button">Agregar otro medio de pago</button>
        <p class="hint" id="saldo"></p>
        <label class="f">Notas<input id="notas" maxlength="300"></label>
        <div class="modal-foot"><button class="btn primary" id="cerrar" type="button">Confirmar venta</button></div>
      </section>
    </div>`;

  function agregar(p) {
    const ya = venta.items.find((i) => i.producto_id === p.id);
    if (ya) ya.cantidad += 1;
    else venta.items.push({ producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio: p.precio, stock: p.stock });
    $('#busca').value = '';
    $('#sug').innerHTML = '';
    pintar();
    $('#busca').focus();
  }
  function sugerir() {
    const q = $('#busca').value.trim().toLowerCase();
    const lista = q ? productos.filter((p) => `${p.nombre} ${p.codigo}`.toLowerCase().includes(q)).slice(0, 8) : [];
    $('#sug').innerHTML = h`${lista.map((p) => h`<button class="sugerencia" type="button" data-id="${p.id}"><img class="thumb" src="${urlImagen(p.imagen)}" alt=""><span>${p.nombre}<br><span class="hint">${p.codigo} · stock ${p.stock}</span></span><span>${plata(p.precio)}</span></button>`)}`;
  }
  function pintar() {
    $('#items').innerHTML = h`${venta.items.map((i, n) => h`<div class="item-row" data-n="${n}">
      <span>${i.descripcion}${i.producto_id && i.cantidad > i.stock ? h` <span class="tag warn">Stock: ${i.stock}</span>` : ''}</span>
      <input data-k="cantidad" type="number" min="1" step="1" value="${i.cantidad}" aria-label="Cantidad">
      <input data-k="precio" type="number" min="0" step="0.01" value="${aPesos(i.precio)}" aria-label="Precio unitario">
      <span class="n sub">${plata(i.precio * i.cantidad)}</span>
      <button class="btn small" data-quitar type="button" aria-label="Quitar">✕</button></div>`)}`;
    pintarTotales();
    pintarPagos();
  }
  function pintarTotales() {
    $('#totales').innerHTML = h`
      <div class="total-line"><span>Subtotal</span><span>${plata(subtotal())}</span></div>
      ${venta.descuento > 0 && h`<div class="total-line"><span>Descuento</span><span>−${plata(venta.descuento)}</span></div>`}
      ${venta.recargo > 0 && h`<div class="total-line"><span>Recargo</span><span>${plata(venta.recargo)}</span></div>`}
      <div class="total-line big"><span>Total</span><span>${plata(total())}</span></div>`;
    pintarSaldo();
  }
  const cobrado = () => venta.pagos.reduce((s, p, n) => s + (p.monto ?? (n === 0 ? total() : 0)), 0);
  function pintarSaldo() {
    const resta = total() - cobrado();
    $('#saldo').textContent = resta > 0 ? `Quedan ${plata(resta)} en cuenta corriente del cliente.` : resta < 0 ? `Lo cobrado supera el total por ${plata(-resta)}.` : '';
  }
  function pintarPagos() {
    $('#pagos').innerHTML = h`${venta.pagos.map((p, n) => h`<div class="pago-row" data-n="${n}">
      <select aria-label="Medio de pago">${opciones(op.medios, p.medio)}</select>
      <input type="number" min="0" step="0.01" aria-label="Monto" value="${p.monto === null ? aPesos(n === 0 ? total() : 0) : p.monto ? aPesos(p.monto) : '0'}">
      ${n > 0 ? h`<button class="btn small" data-quitar type="button" aria-label="Quitar">✕</button>` : h`<span></span>`}</div>`)}`;
    pintarSaldo();
  }

  $('#busca').addEventListener('input', sugerir);
  $('#busca').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = e.target.value.trim().toLowerCase();
    const p = productos.find((x) => x.codigo.toLowerCase() === q) || (() => {
      const l = productos.filter((x) => `${x.nombre} ${x.codigo}`.toLowerCase().includes(q));
      return q && l.length === 1 ? l[0] : null;
    })();
    if (p) agregar(p);
  });
  $('#sug').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) agregar(productos.find((p) => p.id === Number(b.dataset.id)));
  });
  $('#items').addEventListener('change', (e) => {
    const fila = e.target.closest('[data-n]');
    if (!fila || !e.target.dataset.k) return;
    const i = venta.items[Number(fila.dataset.n)];
    if (e.target.dataset.k === 'cantidad') i.cantidad = Math.max(1, Math.floor(Number(e.target.value)) || 1);
    else i.precio = aCentavos(e.target.value);
    pintar();
  });
  $('#items').addEventListener('click', (e) => {
    if (!e.target.closest('[data-quitar]')) return;
    venta.items.splice(Number(e.target.closest('[data-n]').dataset.n), 1);
    pintar();
  });
  $('#libre').addEventListener('click', () => {
    const m = abrirModal('Ítem sin producto', h`<form class="form" id="fl">
      <label class="f full">Descripción<input name="descripcion" required></label>
      <label class="f">Precio ($)<input name="precio" type="number" min="0" step="0.01" required></label>
      <label class="f">Cantidad<input name="cantidad" type="number" min="1" step="1" value="1" required></label>
      <div class="modal-foot full"><button class="btn primary">Agregar</button></div></form>`);
    $('#fl', m).addEventListener('submit', (e) => {
      e.preventDefault();
      const d = leerForm(e.target);
      venta.items.push({ producto_id: null, descripcion: d.descripcion, cantidad: Number(d.cantidad), precio: aCentavos(d.precio) });
      cerrarModal();
      pintar();
    });
  });
  for (const k of ['descuento', 'recargo']) {
    $(`#${k}`).addEventListener('input', (e) => { venta[k] = aCentavos(e.target.value); pintarTotales(); pintarPagos(); });
  }
  $('#pagos').addEventListener('input', (e) => {
    const fila = e.target.closest('[data-n]');
    const p = venta.pagos[Number(fila.dataset.n)];
    if (e.target.tagName === 'SELECT') p.medio = e.target.value; else p.monto = aCentavos(e.target.value);
    pintarSaldo();
  });
  $('#pagos').addEventListener('click', (e) => {
    if (!e.target.closest('[data-quitar]')) return;
    venta.pagos.splice(Number(e.target.closest('[data-n]').dataset.n), 1);
    pintarPagos();
  });
  $('#otroPago').addEventListener('click', () => {
    venta.pagos[0].monto ??= total();
    const resto = Math.max(total() - cobrado(), 0);
    venta.pagos.push({ medio: op.medios[1], monto: resto });
    pintarPagos();
  });

  async function confirmarVenta(permitir = false) {
    if (!venta.items.length) { aviso('Agregá al menos un producto', true); return; }
    const cuerpo = {
      tipo: $('#tipo').value,
      cliente_id: Number($('#cliente').value) || null,
      items: venta.items.map(({ producto_id, descripcion, cantidad, precio }) => ({ producto_id, descripcion, cantidad, precio })),
      descuento: venta.descuento,
      recargo: venta.recargo,
      pagos: venta.pagos.map((p, n) => ({ medio: p.medio, monto: p.monto ?? (n === 0 ? total() : 0) })),
      notas: $('#notas').value,
      permitir_sin_stock: permitir,
    };
    try {
      const r = await api('POST', 'ventas', cuerpo);
      aviso(`Venta N° ${r.numero} registrada`);
      location.hash = `#/ventas/${r.id}`;
    } catch (e) {
      if (e.status === 409 && await confirmar('Sin stock suficiente', `${e.message}. ¿Vender igual? El stock va a quedar en negativo hasta que lo corrijas.`, 'Vender igual')) {
        await confirmarVenta(true);
      } else if (e.status !== 409) aviso(e.message, true);
    }
  }
  $('#cerrar').addEventListener('click', () => confirmarVenta());
  pintar();
};

/* ---- Ventas / comprobantes ---- */
function selectorFechas(desde, hasta) {
  return h`<div class="row"><label class="f">Desde<input type="date" id="desde" value="${desde}"></label><label class="f">Hasta<input type="date" id="hasta" value="${hasta}"></label></div>`;
}
const fechas = { desde: null, hasta: null };
function usarFechas(onCambio) {
  for (const k of ['desde', 'hasta']) {
    $(`#${k}`).addEventListener('change', (e) => { fechas[k] = e.target.value; onCambio(); });
  }
}
const consultaFechas = () => `?desde=${fechas.desde || inicioMes()}&hasta=${fechas.hasta || hoyLocal()}`;

function recibo(v, ajustes) {
  const esInterno = v.tipo === 'Comprobante interno';
  return h`<div class="recibo">
    <header><div><strong>${ajustes.negocio}</strong><br>${ajustes.direccion}${ajustes.cuit ? h`<br>CUIT ${ajustes.cuit}` : ''}</div>
      <div><strong>${v.tipo} N° ${String(v.numero).padStart(6, '0')}</strong><br>${fechaHora(v.fecha)}${v.estado === 'anulada' ? h`<br><strong>ANULADA</strong>` : ''}</div></header>
    <p>Cliente: ${v.cliente || 'Consumidor final'}${v.cliente_documento ? ` · ${v.cliente_documento}` : ''}</p>
    <table><thead><tr><th>Detalle</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr></thead>
    <tbody>${v.items.map((i) => h`<tr><td>${i.descripcion}</td><td class="n">${i.cantidad}</td><td class="n">${plata(i.precio)}</td><td class="n">${plata(i.precio * i.cantidad)}</td></tr>`)}</tbody></table>
    ${v.descuento > 0 && h`<div class="total-line"><span>Descuento</span><span>−${plata(v.descuento)}</span></div>`}
    ${v.recargo > 0 && h`<div class="total-line"><span>Recargo</span><span>${plata(v.recargo)}</span></div>`}
    <div class="total-line big"><span>Total</span><span>${plata(v.total)}</span></div>
    ${v.pagos.map((p) => h`<div class="total-line"><span>${p.medio}</span><span>${plata(p.monto)}</span></div>`)}
    ${v.total > v.pagado && h`<div class="total-line"><span>Saldo en cuenta corriente</span><span>${plata(v.total - v.pagado)}</span></div>`}
    ${v.factura_arca && h`<p>Factura ARCA: ${v.factura_arca}</p>`}
    ${esInterno && h`<p class="legal">Documento no válido como factura.</p>`}
  </div>`;
}

async function verVenta(v, id) {
  const [venta, ajustes] = await Promise.all([api('GET', `ventas/${id}`), api('GET', 'ajustes')]);
  const textoWa = `¡Gracias por tu compra en ${ajustes.negocio}!\n${venta.items.map((i) => `• ${i.descripcion} x${i.cantidad}`).join('\n')}\nTotal: ${plata(venta.total)}`;
  v.innerHTML = h`
    <div class="head"><h1>${venta.tipo} N° ${venta.numero}</h1><div class="head-actions">
      <a class="btn" href="#/ventas">Volver</a>
      ${venta.cliente_telefono && h`<a class="btn" target="_blank" rel="noopener" href="${linkWa(venta.cliente_telefono, textoWa)}">Enviar por WhatsApp</a>`}
      ${venta.estado === 'ok' && h`<button class="btn danger" id="anular" type="button">Anular</button>`}
      <button class="btn primary" id="print" type="button">Imprimir o guardar PDF</button></div></div>
    <section class="card">${recibo(venta, ajustes)}</section>
    <section class="card cols-gap">
      <form class="row" id="ff"><label class="f grow">N° de factura ARCA o CAE (si la emitiste)<input name="factura_arca" value="${venta.factura_arca}"></label><button class="btn">Guardar</button></form>
    </section>`;
  $('#print').addEventListener('click', () => { $('#imprimir').innerHTML = recibo(venta, ajustes); window.print(); });
  $('#ff').addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    await api('PUT', `ventas/${id}/factura`, leerForm(e.target));
    aviso('Guardado');
    refrescar();
  }));
  $('#anular')?.addEventListener('click', intentar(async () => {
    if (!await confirmar('Anular venta', 'Vuelve el stock, se descuenta lo cobrado de la caja y se corrige la cuenta corriente.', 'Anular venta')) return;
    await api('POST', `ventas/${id}/anular`);
    aviso('Venta anulada');
    refrescar();
  }));
}

VISTAS.ventas = async (v, id) => {
  if (id) { await verVenta(v, id); return; }
  const lista = await api('GET', `ventas${consultaFechas()}`);
  const validas = lista.filter((x) => x.estado === 'ok');
  v.innerHTML = h`
    <div class="head"><h1>Ventas</h1><div class="head-actions"><a class="btn primary" href="#/venta">Nueva venta</a></div></div>
    <div class="head">${selectorFechas(fechas.desde || inicioMes(), fechas.hasta || hoyLocal())}<p>Total del período: <strong>${plata(validas.reduce((s, x) => s + x.total, 0))}</strong></p></div>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th class="n">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map((x) => h`<tr><td>${fechaHora(x.fecha)}</td><td>${x.tipo} N° ${x.numero}</td><td>${x.cliente || 'Consumidor final'}</td><td class="n">${plata(x.total)}</td>
      <td>${x.estado === 'anulada' ? h`<span class="tag bad">Anulada</span>` : x.total > x.pagado ? h`<span class="tag warn">Con saldo</span>` : h`<span class="tag ok">Cobrada</span>`}</td>
      <td class="actions"><a class="btn small" href="#/ventas/${x.id}">Ver</a></td></tr>`) : h`<tr><td colspan="6" class="empty">No hay ventas en este período.</td></tr>`}</tbody></table></div>`;
  usarFechas(refrescar);
};

/* ---- Compras ---- */
async function formCompra() {
  const [productos, proveedores] = await Promise.all([api('GET', 'productos'), api('GET', 'proveedores')]);
  if (!proveedores.length) { aviso('Primero cargá un proveedor', true); return; }
  const items = [];
  const m = abrirModal('Registrar compra', h`<form class="form" id="fcm">
    <label class="f">Proveedor<select name="proveedor_id" required>${proveedores.map((p) => h`<option value="${p.id}">${p.nombre}</option>`)}</select></label>
    <label class="f">N° de remito o factura<input name="comprobante"></label>
    <div class="full row"><label class="f grow">Producto<select id="prod">${productos.map((p) => h`<option value="${p.id}">${p.codigo} ${p.nombre}</option>`)}</select></label>
      <label class="f">Cantidad<input id="cant" type="number" min="1" step="1" value="1"></label>
      <label class="f">Costo unit. ($)<input id="costo" type="number" min="0" step="0.01"></label>
      <button class="btn" id="add" type="button">Agregar</button></div>
    <div class="full" id="lista"></div>
    <label class="f">Pagado ahora ($)<input name="pago_monto" type="number" min="0" step="0.01" placeholder="0: queda en cuenta corriente"></label>
    <label class="f">Medio<select name="pago_medio">${opciones(op.medios)}</select></label>
    <div class="modal-foot full"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Registrar compra</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  const pintar = () => {
    const total = items.reduce((s, i) => s + i.costo * i.cantidad, 0);
    $('#lista', m).innerHTML = items.length ? h`<table><tbody>${items.map((i) => h`<tr><td>${i.nombre}</td><td class="n">${i.cantidad} × ${plata(i.costo)}</td></tr>`)}</tbody></table><div class="total-line big"><span>Total</span><span>${plata(total)}</span></div>` : '';
  };
  const elegir = () => { $('#costo', m).value = aPesos(productos.find((p) => p.id === Number($('#prod', m).value))?.costo); };
  elegir();
  $('#prod', m).addEventListener('change', elegir);
  $('#add', m).addEventListener('click', () => {
    const p = productos.find((x) => x.id === Number($('#prod', m).value));
    if (!p) return;
    items.push({ producto_id: p.id, nombre: p.nombre, cantidad: Number($('#cant', m).value) || 1, costo: aCentavos($('#costo', m).value) });
    pintar();
  });
  $('#fcm', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    if (!items.length) { aviso('Agregá al menos un producto', true); return; }
    const d = leerForm(e.target);
    await api('POST', 'compras', { ...d, items, pago_monto: aCentavos(d.pago_monto) });
    cerrarModal();
    aviso('Compra registrada: stock y costos actualizados');
    refrescar();
  }));
}

VISTAS.compras = async (v) => {
  const lista = await api('GET', 'compras');
  v.innerHTML = h`
    <div class="head"><h1>Compras</h1><div class="head-actions"><button class="btn primary" id="nueva" type="button">Registrar compra</button></div></div>
    <p class="hint">Cada compra suma stock, actualiza el costo del producto y registra la deuda con el proveedor.</p>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th class="n">Total</th></tr></thead>
    <tbody>${lista.length ? lista.map((c) => h`<tr><td>${fecha(c.fecha)}</td><td>${c.proveedor}</td><td>${c.comprobante}</td><td class="n">${plata(c.total)}</td></tr>`) : h`<tr><td colspan="4" class="empty">Todavía no hay compras.</td></tr>`}</tbody></table></div>`;
  $('#nueva').addEventListener('click', intentar(formCompra));
};

/* ---- Caja ---- */
function formMovimiento(tipo) {
  const m = abrirModal(tipo === 'egreso' ? 'Registrar gasto' : 'Registrar ingreso', h`<form class="form" id="fm">
    <label class="f">Categoría<select name="categoria">${opciones(op.categorias_caja[tipo])}</select></label>
    <label class="f">Medio<select name="medio">${opciones(op.medios)}</select></label>
    <label class="f">Monto ($)<input name="monto" type="number" min="0.01" step="0.01" required></label>
    <label class="f">Concepto<input name="concepto" required></label>
    <div class="modal-foot full"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  $('#fm', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    await api('POST', 'caja', { ...d, tipo, monto: aCentavos(d.monto) });
    cerrarModal();
    aviso('Movimiento registrado');
    refrescar();
  }));
}

function formCierre(efectivo) {
  const m = abrirModal('Cierre de caja', h`<form class="form" id="fci">
    <p class="full">El sistema espera <strong>${plata(efectivo)}</strong> en efectivo. Contá la plata y anotá cuánto hay.</p>
    <label class="f">Efectivo contado ($)<input name="contado" type="number" min="0" step="0.01" required></label>
    <label class="f">Notas<input name="notas"></label>
    <div class="modal-foot full"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Cerrar caja</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  $('#fci', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    const r = await api('POST', 'caja/cierre', { contado: aCentavos(d.contado), notas: d.notas });
    cerrarModal();
    aviso(r.diferencia ? `Caja cerrada con diferencia de ${plata(r.diferencia)}` : 'Caja cerrada sin diferencias');
    refrescar();
  }));
}

VISTAS.caja = async (v) => {
  const c = await api('GET', `caja${consultaFechas()}`);
  const suma = (t) => c.movimientos.filter((m) => m.tipo === t).reduce((s, m) => s + m.monto, 0);
  v.innerHTML = h`
    <div class="head"><h1>Caja</h1><div class="head-actions">
      <button class="btn" id="ing" type="button">Ingreso</button>
      <button class="btn" id="egr" type="button">Gasto</button>
      <button class="btn primary" id="cierre" type="button">Cierre de caja</button></div></div>
    <div class="tiles">
      <div class="tile"><small>Efectivo en caja</small><strong>${plata(c.efectivo)}</strong><span>acumulado</span></div>
      <div class="tile"><small>Ingresos del período</small><strong>${plata(suma('ingreso'))}</strong></div>
      <div class="tile"><small>Egresos del período</small><strong>${plata(suma('egreso'))}</strong></div>
      <div class="tile"><small>Neto del período</small><strong class="${suma('ingreso') < suma('egreso') ? 'neg' : ''}">${plata(suma('ingreso') - suma('egreso'))}</strong></div>
    </div>
    <div class="head cols-gap">${selectorFechas(c.desde, c.hasta)}</div>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Medio</th><th class="n">Monto</th><th></th></tr></thead>
    <tbody id="filas">${c.movimientos.length ? c.movimientos.map((m) => h`<tr><td>${fechaHora(m.fecha)}</td><td>${m.categoria}</td><td>${m.concepto}</td><td>${m.medio}</td>
      <td class="n ${m.tipo === 'egreso' ? 'neg' : 'pos'}">${m.tipo === 'egreso' ? '−' : '+'}${plata(m.monto)}</td>
      <td class="actions">${!m.ref_tipo && h`<button class="btn small" data-borrar="${m.id}" type="button">Borrar</button>`}</td></tr>`) : h`<tr><td colspan="6" class="empty">No hay movimientos en este período.</td></tr>`}</tbody></table></div>
    ${c.cierres.length > 0 && h`<section class="card cols-gap"><h2>Últimos cierres</h2><table><thead><tr><th>Fecha</th><th class="n">Esperado</th><th class="n">Contado</th><th class="n">Diferencia</th></tr></thead><tbody>${c.cierres.map((x) => h`<tr><td>${fechaHora(x.fecha)}</td><td class="n">${plata(x.esperado)}</td><td class="n">${plata(x.contado)}</td><td class="n ${x.diferencia < 0 ? 'neg' : ''}">${plata(x.diferencia)}</td></tr>`)}</tbody></table></section>`}`;
  usarFechas(refrescar);
  $('#ing').addEventListener('click', () => formMovimiento('ingreso'));
  $('#egr').addEventListener('click', () => formMovimiento('egreso'));
  $('#cierre').addEventListener('click', () => formCierre(c.efectivo));
  $('#filas').addEventListener('click', intentar(async (e) => {
    const b = e.target.closest('[data-borrar]');
    if (!b || !await confirmar('Borrar movimiento', 'Se elimina este movimiento de la caja.', 'Borrar')) return;
    await api('DELETE', `caja/${b.dataset.borrar}`);
    refrescar();
  }));
};

/* ---- Pagos ---- */
const TIPOS_PAGO = [['Sueldos', 'Sueldo'], ['Servicios', 'Servicio']];

function formPago() {
  const m = abrirModal('Registrar pago', h`<form class="form" id="fp">
    <label class="f">Tipo<select name="categoria" id="tipoPago">${TIPOS_PAGO.map(([cat, etq]) => h`<option value="${cat}">${etq}</option>`)}</select></label>
    <label class="f">Nombre<input name="concepto" id="nombrePago" required placeholder="Ej: Belén"></label>
    <label class="f">Medio<select name="medio">${opciones(op.medios)}</select></label>
    <label class="f">Monto ($)<input name="monto" type="number" min="0.01" step="0.01" required></label>
    <div class="modal-foot full"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  $('#tipoPago', m).addEventListener('change', (e) => {
    $('#nombrePago', m).placeholder = e.target.value === 'Servicios' ? 'Ej: Gas, Luz, Agua' : 'Ej: Belén';
  });
  $('#fp', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    await api('POST', 'caja', { ...d, tipo: 'egreso', monto: aCentavos(d.monto) });
    cerrarModal();
    aviso('Pago registrado');
    refrescar();
  }));
}

VISTAS.pagos = async (v) => {
  const c = await api('GET', `caja${consultaFechas()}`);
  const pagos = c.movimientos.filter((m) => m.categoria === 'Sueldos' || m.categoria === 'Servicios');
  const suma = (cat) => pagos.filter((m) => m.categoria === cat).reduce((s, m) => s + m.monto, 0);
  v.innerHTML = h`
    <div class="head"><h1>Pagos</h1><div class="head-actions"><button class="btn primary" id="nuevo" type="button">Registrar pago</button></div></div>
    <p class="hint">Sueldos de empleados y pagos de servicios (agua, luz, gas, etc.). Quedan anotados en la Caja como gastos.</p>
    <div class="tiles">
      <div class="tile"><small>Sueldos del período</small><strong>${plata(suma('Sueldos'))}</strong></div>
      <div class="tile"><small>Servicios del período</small><strong>${plata(suma('Servicios'))}</strong></div>
      <div class="tile"><small>Total pagado</small><strong>${plata(suma('Sueldos') + suma('Servicios'))}</strong></div>
    </div>
    <div class="head cols-gap">${selectorFechas(c.desde, c.hasta)}</div>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Nombre</th><th>Medio</th><th class="n">Monto</th><th></th></tr></thead>
    <tbody id="filas">${pagos.length ? pagos.map((m) => h`<tr><td>${fechaHora(m.fecha)}</td><td>${m.categoria === 'Sueldos' ? 'Sueldo' : 'Servicio'}</td><td>${m.concepto}</td><td>${m.medio}</td>
      <td class="n neg">−${plata(m.monto)}</td>
      <td class="actions">${!m.ref_tipo && h`<button class="btn small" data-borrar="${m.id}" type="button">Borrar</button>`}</td></tr>`) : h`<tr><td colspan="6" class="empty">No hay pagos en este período.</td></tr>`}</tbody></table></div>`;
  usarFechas(refrescar);
  $('#nuevo').addEventListener('click', formPago);
  $('#filas').addEventListener('click', intentar(async (e) => {
    const b = e.target.closest('[data-borrar]');
    if (!b || !await confirmar('Borrar pago', 'Se elimina este pago de la caja.', 'Borrar')) return;
    await api('DELETE', `caja/${b.dataset.borrar}`);
    refrescar();
  }));
};

/* ---- Arreglos ---- */
function tagArreglo(e) {
  const t = { pendiente: ['warn', 'En taller'], listo: ['ok', 'Listo para retirar'], entregado: ['mute', 'Entregado'], cancelado: ['bad', 'Cancelado'] }[e];
  return h`<span class="tag ${t[0]}">${t[1]}</span>`;
}

async function formArreglo() {
  const clientes = await api('GET', 'clientes');
  const m = abrirModal('Nuevo arreglo o encargo', h`<form class="form" id="fa">
    <label class="f full">Qué hay que hacer<textarea name="descripcion" rows="2" required placeholder="Ej: soldar cadena, grabar iniciales, achicar anillo"></textarea></label>
    <label class="f">Cliente<select name="cliente_id"><option value="">Otro</option>${clientes.map((c) => h`<option value="${c.id}">${c.nombre}</option>`)}</select></label>
    <label class="f">Nombre (si no está cargado)<input name="cliente_nombre"></label>
    <label class="f">Precio ($)<input name="precio" type="number" min="0" step="0.01"></label>
    <label class="f">Fecha prometida<input name="fecha_entrega" type="date"></label>
    <label class="f">Seña ($)<input name="sena" type="number" min="0" step="0.01"></label>
    <label class="f">Medio de la seña<select name="medio">${opciones(op.medios)}</select></label>
    <div class="modal-foot full"><button class="btn" data-cerrar type="button">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', cerrarModal));
  $('#fa', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    await api('POST', 'arreglos', { ...d, precio: aCentavos(d.precio), sena: aCentavos(d.sena) });
    cerrarModal();
    aviso('Arreglo registrado');
    refrescar();
  }));
}

function formEntrega(a) {
  const resta = a.precio - a.pagado;
  const m = abrirModal('Entregar arreglo', h`<form id="fen">
    <p>${resta > 0 ? h`Falta cobrar <strong>${plata(resta)}</strong>.` : 'Ya está todo pago.'}</p>
    ${resta > 0 && h`<label class="f">Medio<select name="medio">${opciones(op.medios)}</select></label>`}
    <div class="modal-foot"><button class="btn primary">Marcar entregado</button></div></form>`);
  $('#fen', m).addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    await api('POST', `arreglos/${a.id}/estado`, { estado: 'entregado', ...leerForm(e.target) });
    cerrarModal();
    aviso('Arreglo entregado');
    refrescar();
  }));
}

VISTAS.arreglos = async (v) => {
  const lista = await api('GET', 'arreglos');
  v.innerHTML = h`
    <div class="head"><h1>Arreglos y encargos</h1><div class="head-actions"><button class="btn primary" id="nuevo" type="button">Nuevo arreglo</button></div></div>
    <div class="tablewrap"><table><thead><tr><th>Trabajo</th><th>Cliente</th><th>Para el</th><th class="n">Precio</th><th class="n">Pagado</th><th>Estado</th><th></th></tr></thead>
    <tbody id="filas">${lista.length ? lista.map((a) => h`<tr><td>${a.descripcion}</td><td>${a.cliente}</td><td>${fecha(a.fecha_entrega)}</td><td class="n">${plata(a.precio)}</td><td class="n">${plata(a.pagado)}</td><td>${tagArreglo(a.estado)}</td>
      <td class="actions">
        ${a.estado === 'pendiente' && h`<button class="btn small" data-listo="${a.id}" type="button">Listo</button>`}
        ${a.estado === 'listo' && a.telefono && h`<a class="btn small" target="_blank" rel="noopener" href="${linkWa(a.telefono, `Hola ${a.cliente}, tu arreglo ya está listo para retirar en Izel Joyas.`)}">Avisar</a>`}
        ${['pendiente', 'listo'].includes(a.estado) && h`<button class="btn small" data-entregar="${a.id}" type="button">Entregar</button>`}
      </td></tr>`) : h`<tr><td colspan="7" class="empty">No hay arreglos cargados.</td></tr>`}</tbody></table></div>`;
  $('#nuevo').addEventListener('click', intentar(formArreglo));
  $('#filas').addEventListener('click', intentar(async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.listo) { await api('POST', `arreglos/${b.dataset.listo}/estado`, { estado: 'listo' }); refrescar(); } else formEntrega(lista.find((a) => a.id === Number(b.dataset.entregar)));
  }));
};

/* ---- Reportes ---- */
function tabla(columnas, filas, vacio) {
  if (!filas.length) return h`<p class="hint">${vacio}</p>`;
  return h`<table><thead><tr>${columnas.map(([t, , n]) => h`<th class="${n ? 'n' : ''}">${t}</th>`)}</tr></thead><tbody>${filas.map((f) => h`<tr>${columnas.map(([, fn, n]) => h`<td class="${n ? 'n' : ''}">${fn(f)}</td>`)}</tr>`)}</tbody></table>`;
}

VISTAS.reportes = async (v) => {
  const r = await api('GET', `reportes${consultaFechas()}`);
  const margen = r.ventas ? Math.round((r.ganancia_bruta / r.ventas) * 100) : 0;
  v.innerHTML = h`
    <div class="head"><h1>Reportes</h1>${selectorFechas(r.desde, r.hasta)}</div>
    <div class="tiles">
      <div class="tile"><small>Ventas</small><strong>${plata(r.ventas)}</strong><span>${operaciones(r.cantidad)}</span></div>
      <div class="tile"><small>Costo de lo vendido</small><strong>${plata(r.costo)}</strong></div>
      <div class="tile"><small>Ganancia bruta</small><strong>${plata(r.ganancia_bruta)}</strong><span>margen ${margen}%</span></div>
      <div class="tile"><small>Arreglos y otros</small><strong>${plata(r.otros_ingresos)}</strong></div>
      <div class="tile"><small>Gastos</small><strong>${plata(r.gastos)}</strong></div>
      <div class="tile"><small>Ganancia neta</small><strong class="${r.resultado < 0 ? 'neg' : 'pos'}">${plata(r.resultado)}</strong></div>
    </div>
    <div class="cols">
      <section class="card"><h2>Más vendidos</h2>${tabla([['Producto', (x) => x.descripcion], ['Unid.', (x) => x.unidades, 1], ['Ganancia', (x) => plata(x.ganancia), 1]], r.top_productos, 'Sin ventas en el período.')}</section>
      <section class="card"><h2>Más consultados por WhatsApp</h2>${tabla([['Producto', (x) => `${x.codigo} ${x.nombre}`], ['Consultas', (x) => x.veces, 1]], r.consultas, 'Aún no hay consultas desde el catálogo.')}</section>
      <section class="card"><h2>Ventas por categoría</h2>${tabla([['Categoría', (x) => x.categoria], ['Unid.', (x) => x.unidades, 1], ['Total', (x) => plata(x.total), 1]], r.por_categoria, 'Sin ventas en el período.')}</section>
      <section class="card"><h2>Por medio de pago</h2>${tabla([['Medio', (x) => x.medio], ['Ingresos', (x) => plata(x.ingresos), 1], ['Egresos', (x) => plata(x.egresos), 1]], r.por_medio, 'Sin movimientos.')}</section>
      <section class="card"><h2>Gastos por categoría</h2>${tabla([['Categoría', (x) => x.categoria], ['Total', (x) => plata(x.total), 1]], r.gastos_por_categoria, 'Sin gastos en el período.')}</section>
      <section class="card"><h2>Clientes que deben</h2>${tabla([['Cliente', (x) => x.nombre], ['Saldo', (x) => plata(x.saldo), 1]], r.deudores, 'Nadie debe nada.')}</section>
    </div>`;
  usarFechas(refrescar);
};

/* ---- Ajustes ---- */
VISTAS.ajustes = async (v) => {
  const a = await api('GET', 'ajustes');
  v.innerHTML = h`
    <div class="head"><h1>Ajustes</h1></div>
    <div class="cols">
      <section class="card"><h2>Negocio y catálogo</h2>
        <form class="form" id="fa">
          <label class="f full">Nombre<input name="negocio" value="${a.negocio}" required></label>
          <label class="f full">Dirección<input name="direccion" value="${a.direccion}"></label>
          <label class="f">CUIT<input name="cuit" value="${a.cuit}"></label>
          <label class="f">WhatsApp del catálogo<input name="whatsapp" value="${a.whatsapp}" placeholder="5491123456789"></label>
          <label class="check full"><input type="checkbox" name="mostrar_agotados" ${a.mostrar_agotados ? 'checked' : ''}> Mostrar “Consultar disponibilidad” en productos sin stock</label>
          <div class="modal-foot full"><button class="btn primary">Guardar</button></div>
        </form></section>
      <section class="card"><h2>Cambiar contraseña</h2>
        <form class="form" id="fk">
          <label class="f full">Contraseña actual<input name="actual" type="password" required autocomplete="current-password"></label>
          <label class="f full">Nueva contraseña<input name="nueva" type="password" minlength="8" required autocomplete="new-password"></label>
          <div class="modal-foot full"><button class="btn primary">Cambiar</button></div>
        </form></section>
      <section class="card"><h2>Copia de seguridad</h2>
        <p class="hint">El sistema guarda una copia automática por día. Descargá una cada tanto y guardala en otro lado, por ejemplo en Google Drive.</p>
        <div class="modal-foot"><a class="btn" href="/api/backup">Descargar copia</a></div></section>
    </div>`;
  $('#fa').addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    const d = leerForm(e.target);
    await api('PUT', 'ajustes', { ...d, mostrar_agotados: Boolean(d.mostrar_agotados) });
    aviso('Ajustes guardados');
  }));
  $('#fk').addEventListener('submit', intentar(async (e) => {
    e.preventDefault();
    await api('POST', 'clave', leerForm(e.target));
    e.target.reset();
    aviso('Contraseña cambiada');
  }));
};

/* ---- Arranque ---- */
async function iniciar() {
  const s = await fetch('/api/sesion').then((r) => r.json());
  if (!s.logueado) { pantallaAcceso(); return; }
  op = await api('GET', 'opciones');
  armazon();
  navegar();
}
window.addEventListener('hashchange', navegar);
iniciar();
