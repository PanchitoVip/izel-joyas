(() => {
  const cfg = window.IZEL;
  const $ = (id) => document.getElementById(id);
  const CLAVE_CARRITO = 'izel.carrito.v1';
  const TODAS = 'Todas';

  let productos = [];
  let categoria = TODAS;
  let carrito = leerCarrito();
  let abierto = null;

  function leerCarrito() {
    try { return JSON.parse(localStorage.getItem(CLAVE_CARRITO)) || {}; } catch { return {}; }
  }
  function guardarCarrito() {
    try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito)); } catch { /* modo privado */ }
  }

  function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...hijos);
    return n;
  }

  const normalizar = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const material = (p) => p.material || 'Consultanos el material';
  const urlImagen = (p) => (/^https?:/.test(p.imagen) ? p.imagen : (cfg.api || '') + (cfg.api ? '/' : '') + p.imagen);

  function urlWhatsapp(texto) {
    return `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto)}`;
  }

  async function cargar() {
    try {
      const r = await fetch(`${cfg.api}/api/catalogo`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (data.tienda?.whatsapp) cfg.whatsapp = data.tienda.whatsapp;
      cfg.conApi = true;
      return data.productos;
    } catch {
      const r = await fetch('data/productos.json');
      return (await r.json()).productos;
    }
  }

  /* ---- Listado ---- */
  function pintarCategorias() {
    const orden = [TODAS, ...new Set(productos.map((p) => p.categoria))];
    $('categorias').replaceChildren(...orden.map((c) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(c === categoria),
      onclick: () => { categoria = c; pintarCategorias(); pintarProductos(); },
    }, c)));
  }

  function tarjeta(p) {
    const foto = el('img', { src: urlImagen(p), alt: `${p.nombre}, ${material(p)}`, loading: 'lazy', width: 640, height: 800 });
    const boton = el('button', { class: 'card-photo', type: 'button', 'aria-label': `Ver detalle de ${p.nombre}`, onclick: () => abrirDetalle(p) }, foto);
    if (p.agotado) boton.append(el('span', { class: 'tag off' }, 'Consultar disponibilidad'));
    else if (p.destacado) boton.append(el('span', { class: 'tag' }, 'Favorito'));
    return el('article', { class: 'card' }, boton, el('div', { class: 'card-body' },
      el('h3', {}, p.nombre),
      el('p', { class: 'material' }, material(p)),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => agregar(p) }, 'Comprar'),
    ));
  }

  function pintarProductos() {
    const q = normalizar($('buscar').value.trim());
    const lista = productos.filter((p) => (categoria === TODAS || p.categoria === categoria)
      && (!q || normalizar(`${p.nombre} ${p.material || ''} ${p.descripcion || ''} ${p.categoria} ${p.codigo}`).includes(q)));
    if (categoria === TODAS && !q) lista.sort((a, b) => b.destacado - a.destacado);
    $('resultado').textContent = lista.length === 1 ? '1 joya' : `${lista.length} joyas`;
    $('productos').replaceChildren(...(lista.length
      ? lista.map(tarjeta)
      : [el('p', { class: 'empty' }, 'No encontramos esa joya, pero puede que la tengamos. Escribinos por WhatsApp.')]));
  }

  /* ---- Carrito ---- */
  function agregar(p) {
    const linea = carrito[p.codigo] || { cantidad: 0, talle: '' };
    linea.cantidad += 1;
    carrito[p.codigo] = linea;
    guardarCarrito();
    pintarCarrito();
    const cuenta = $('carritoCuenta');
    cuenta.classList.remove('bump');
    void cuenta.offsetWidth;
    cuenta.classList.add('bump');
    avisar(`${p.nombre} se sumó al carrito`);
  }

  function lineasCarrito() {
    return Object.entries(carrito)
      .map(([codigo, l]) => ({ ...l, producto: productos.find((p) => p.codigo === codigo) }))
      .filter((l) => l.producto);
  }

  function lineaCarrito(l) {
    const p = l.producto;
    const cambiar = (delta) => {
      const linea = carrito[p.codigo];
      linea.cantidad += delta;
      if (linea.cantidad < 1) delete carrito[p.codigo];
      guardarCarrito();
      pintarCarrito();
    };
    const detalle = el('div', {},
      el('h3', {}, p.nombre),
      el('p', { class: 'material' }, material(p)),
      el('div', { class: 'line-actions' },
        el('span', { class: 'qty' },
          el('button', { type: 'button', 'aria-label': `Quitar una unidad de ${p.nombre}`, onclick: () => cambiar(-1) }, '−'),
          el('span', {}, String(l.cantidad)),
          el('button', { type: 'button', 'aria-label': `Agregar una unidad de ${p.nombre}`, onclick: () => cambiar(1) }, '+')),
        el('button', { class: 'link-btn', type: 'button', onclick: () => { delete carrito[p.codigo]; guardarCarrito(); pintarCarrito(); } }, 'Quitar')),
    );
    if (p.categoria === 'Anillos') {
      const talle = el('input', {
        type: 'text', maxlength: '20', placeholder: 'Talle o medida en mm', 'aria-label': `Talle para ${p.nombre}`,
        oninput: (e) => { carrito[p.codigo].talle = e.target.value; guardarCarrito(); },
      });
      talle.value = l.talle || '';
      detalle.append(el('label', { class: 'size-field' }, 'Talle', talle));
    }
    return el('div', { class: 'line' }, el('img', { src: urlImagen(p), alt: '' }), detalle);
  }

  function pintarCarrito() {
    const lineas = lineasCarrito();
    const total = lineas.reduce((s, l) => s + l.cantidad, 0);
    const cuenta = $('carritoCuenta');
    cuenta.textContent = total;
    cuenta.hidden = total === 0;
    $('carritoPie').hidden = total === 0;
    $('carritoItems').replaceChildren(...(lineas.length
      ? lineas.map(lineaCarrito)
      : [el('div', { class: 'cart-empty' },
          el('p', {}, 'Todavía no elegiste ninguna joya.'),
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: cerrarCarrito }, 'Ver el catálogo'))]));
  }

  function mensajeConsulta() {
    const filas = lineasCarrito().map(({ producto: p, cantidad, talle }) => {
      const extra = [
        cantidad > 1 ? `x${cantidad}` : '',
        talle?.trim() ? `talle ${talle.trim()}` : '',
      ].filter(Boolean).join(', ');
      return `• ${p.nombre} (${p.codigo})${extra ? ` - ${extra}` : ''}`;
    });
    const nota = $('nota').value.trim();
    return ['¡Hola Izel Joyas! Quiero saber el precio de:', '', ...filas, ...(nota ? ['', nota] : [])].join('\n');
  }

  function consultar() {
    const lineas = lineasCarrito();
    if (!lineas.length) return;
    window.open(urlWhatsapp(mensajeConsulta()), '_blank', 'noopener');
    if (cfg.conApi) {
      fetch(`${cfg.api}/api/consultas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codigos: lineas.map((l) => l.producto.codigo) }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  let ultimoFoco = null;
  function abrirCarrito() {
    ultimoFoco = document.activeElement;
    const d = $('carrito');
    d.classList.add('open');
    d.inert = false;
    d.setAttribute('aria-hidden', 'false');
    $('scrim').hidden = false;
    document.body.classList.add('locked');
    $('cerrarCarrito').focus();
  }
  function cerrarCarrito() {
    const d = $('carrito');
    d.classList.remove('open');
    d.inert = true;
    d.setAttribute('aria-hidden', 'true');
    $('scrim').hidden = true;
    document.body.classList.remove('locked');
    ultimoFoco?.focus?.();
  }

  /* ---- Detalle ---- */
  function abrirDetalle(p) {
    abierto = p;
    $('detalleImg').src = urlImagen(p);
    $('detalleImg').alt = `${p.nombre}, ${material(p)}`;
    $('detalleCat').textContent = p.categoria;
    $('detalleNombre').textContent = p.nombre;
    $('detalleMaterial').textContent = material(p);
    $('detalleDesc').textContent = p.descripcion || '';
    $('detalleCodigo').textContent = `Código ${p.codigo}`;
    history.replaceState(null, '', `#${p.codigo}`);
    if (!$('detalle').open) $('detalle').showModal();
  }

  async function compartir() {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: abierto.nombre, url });
      else { await navigator.clipboard.writeText(url); avisar('Copiamos el link de esta joya'); }
    } catch { /* la persona canceló */ }
  }

  let temporizador;
  function avisar(texto) {
    const t = $('aviso');
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---- Abierto ahora, en horario de Argentina ---- */
  function pintarEstado() {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
    const minutos = Number(partes.hour) * 60 + Number(partes.minute);
    const horario = cfg.horarios[dia];
    const on = horario && minutos >= horario[0] && minutos < horario[1];
    $('estadoLocal').textContent = on ? 'Abierto ahora' : 'Cerrado ahora';
    $('estadoLocal').classList.toggle('on', Boolean(on));
  }

  /* ---- Inicio ---- */
  async function iniciar() {
    pintarEstado();
    $('linkInstagram').href = cfg.instagram;
    $('footInstagram').href = cfg.instagram;
    productos = await cargar();
    $('linkConsulta').href = urlWhatsapp('¡Hola Izel Joyas! Quería hacerles una consulta.');
    if (!cfg.whatsapp) console.warn('Falta cargar el número de WhatsApp en config.js');
    pintarCategorias();
    pintarProductos();
    pintarCarrito();
    const p = productos.find((x) => `#${x.codigo}` === location.hash);
    if (p) abrirDetalle(p);
  }

  $('buscar').addEventListener('input', pintarProductos);
  $('abrirCarrito').addEventListener('click', abrirCarrito);
  $('cerrarCarrito').addEventListener('click', cerrarCarrito);
  $('scrim').addEventListener('click', cerrarCarrito);
  $('consultar').addEventListener('click', consultar);
  $('vaciar').addEventListener('click', () => { carrito = {}; guardarCarrito(); pintarCarrito(); });
  $('cerrarDetalle').addEventListener('click', () => $('detalle').close());
  $('detalle').addEventListener('click', (e) => { if (e.target === $('detalle')) $('detalle').close(); });
  $('detalle').addEventListener('close', () => history.replaceState(null, '', location.pathname));
  $('detalleComprar').addEventListener('click', () => { agregar(abierto); $('detalle').close(); });
  $('detalleCompartir').addEventListener('click', compartir);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('carrito').classList.contains('open')) cerrarCarrito(); });

  iniciar();
})();
