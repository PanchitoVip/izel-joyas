# Izel Joyas: contexto para Claude

Este proyecto se armó en otra PC y se pasó a esta en un zip. Las sesiones de Claude Code no se comparten, así que todo lo importante de esa conversación está acá. Leé este archivo y el [README](README.md) antes de tocar nada.

## Quién y para qué

Francisco le arma esto a una amiga, dueña de la joyería **Izel Joyas** (Merlo 2633, B1744OEO Moreno, Provincia de Buenos Aires; Instagram @izeljoyas; lunes a viernes 9 a 19, sábados 9:30 a 14). Hablale en español rioplatense y en términos simples.

Pidió dos cosas:

1. **Catálogo público**: llamativo, foto y material **sin precio**, botón "Comprar", carrito y "Consultar precio por WhatsApp" con mensaje automático. Abajo "Podés encontrarnos en" con dirección y mapa.
2. **Sistema privado, sólo para ella**: stock, proveedores, clientes con cuenta corriente, facturación y caja con gastos y ganancias.

También pidió sumar ideas útiles que no hubiera nombrado.

## Estructura

```
catalogo/        Sitio estático público (HTML, CSS, JS). Datos en data/productos.json, ajustes en config.js
gestion/         Servidor Node y sistema privado
  server.js      HTTP, sesiones, archivos estáticos, copias de seguridad
  api.js         Rutas y toda la lógica de negocio
  db.js          Esquema SQLite y carga inicial de productos
  public/        Interfaz del sistema (JS sin frameworks)
  test/          Pruebas de la API: npm test, 18 en verde
  iniciar.bat    Prende el servidor si hace falta y abre la página pedida
  data/          DATOS REALES: base, fotos subidas y copias. Está en .gitignore
Abrir Sistema.bat / Abrir Catalogo.bat    Las dos entradas para la dueña
fuentes/instagram/    Fotos originales bajadas de Instagram y sus textos
herramientas/    build_catalog.py (rearma fotos y datos) y e2e.mjs (prueba de interfaz con Edge)
```

Un solo servidor sirve el catálogo en `/` y el sistema en `/gestion/`. Hace falta Node 22.13 o más nuevo y no hay dependencias: usa `node:sqlite`.

## Decisiones y por qué

- **Una base y un servidor**: al publicar un producto en la gestión aparece solo en el catálogo. El catálogo igual funciona como sitio estático leyendo `data/productos.json` si no encuentra la API.
- **El público nunca recibe precio, costo ni cantidad de stock**. `catalogoPublico` en `api.js` filtra los campos y hay una prueba que lo controla. No la aflojes.
- **Importes en centavos enteros** en la base y en la API; se convierten sólo en la interfaz.
- **Ganancia = ventas − costo de lo vendido + otros ingresos − gastos.** Las compras de mercadería no son gasto: entran por su costo al venderse. `FUERA_DE_RESULTADO` en `api.js` lista lo que mueve plata sin ser ganancia ni gasto (cobranzas, pagos a proveedores, retiros, anulaciones).
- **Fechas en hora de Argentina** (`ahora()` en `db.js`), para que un servidor en UTC no corra los días.
- **La CSP del sistema prohíbe estilos y scripts en línea**: nada de `style=""` ni `onclick`. Todo el HTML pasa por la plantilla `h` que escapa valores.
- **Primera clave con código de instalación** que sale en la consola, para que un extraño no la cree si el sistema se publica.
- **Facturación**: sólo comprobantes internos ("no válido como factura") y un campo para anotar el número o CAE de ARCA. La factura electrónica **no está integrada**: requiere CUIT y certificado de ella, y saber su condición fiscal.

Ideas sumadas: arreglos con seña, aumento masivo de precios, cierre de caja, recordatorio de deuda y cumpleaños por WhatsApp, alertas de stock, reportes, consultas más pedidas, talle en el carrito, "Abierto ahora".

## Cómo se obtuvieron los productos

- El perfil de Instagram es público. Se bajaron las 36 publicaciones visibles sin iniciar sesión, a 512×640 como máximo. Quedaron 30 productos al sacar repetidos.
- Las **historias destacadas piden login y no se accedió**. Faltan carteras, Swarovski, aros de plata, argollas y anillos Falange. No iniciar sesión con ninguna cuenta para conseguirlas: pedirle las fotos a ella.
- Los **nombres y descripciones los escribió Claude mirando las fotos**: ella tiene que validarlos.
- **Nunca inventar materiales ni precios.** Si Instagram no lo dice, queda sin material y el catálogo muestra "Consultanos el material". La tabla de productos a confirmar está en el README.

## Estado

**Funciona y se probó:** las 18 pruebas de API, el recorrido completo de interfaz en Edge headless (alta de proveedor y cliente, compra, venta mixta, cobro, gasto, cierre, arreglo, foto, venta sin stock, anulación, salir y volver a entrar), el mapa con el pin correcto, y las dos entradas `.bat` ejecutadas de verdad en la PC original.

**Sin verificar:** el PDF del comprobante se genera en una página, pero nadie lo miró como imagen; el botón de WhatsApp con un número real; el sitio publicado en internet.

**Datos actuales:** `gestion/data` viene con lo que se cargó en la PC original: contraseña definida, 1 venta, 1 cliente, 1 proveedor y 4 movimientos de caja. No se sabe si es de prueba. **Preguntá antes de borrar o reiniciar esos datos.** La contraseña no está en ningún archivo: la sabe Francisco. Para reiniciarla, ver el README.

## Pendientes

1. Número de WhatsApp: falta. Va en Gestión > Ajustes y, si el catálogo se publica solo, en `catalogo/config.js`.
2. Que ella confirme los productos marcados "Revisar" y cargue precios, costos y stock.
3. Publicar. Francisco dijo que va a subirlo a GitHub y de ahí a Netlify o Vercel, **pero todavía no**. No lo hagas hasta que lo pida.
4. El repositorio git todavía no existe. Commit y push sólo si lo pide.

## Sobre la publicación

- Netlify y Vercel sirven **sólo para el catálogo** (carpeta de publicación `catalogo`). Se le recomendó Netlify porque el plan gratis de Vercel, hasta donde se sabe, es para uso no comercial; confirmarlo en sus condiciones.
- El sistema de gestión **no funciona ahí**: usa SQLite en disco y esos servicios no conservan archivos. Necesita un servidor con disco persistente, o seguir local con los `.bat`.
- Publicado aparte, el catálogo no se actualiza solo desde la gestión: lee `data/productos.json`, salvo que se configure `api` en `config.js`.
- **Nunca subir `gestion/data` ni el zip a GitHub**: tienen datos del negocio.

## Trampas conocidas

- **Los `.bat` deben tener finales de línea CRLF, ser ASCII y no usar `chcp 65001`.** La primera versión tenía LF y `chcp`: Windows la leía mal y decía que faltaba Node. Pasó desapercibido porque no se había ejecutado. Si tocás un `.bat`, ejecutalo de verdad y controlá los bytes: `sed -i` en Git Bash borra los CR.
- `node:sqlite` muestra un aviso de función experimental; es normal.
- Si el puerto 3000 está ocupado, el sistema avisa y termina.
- `herramientas/build_catalog.py` **sobrescribe** `catalogo/img/productos` y `data/productos.json`. No cambia lo cargado en la base.
- La base usa WAL: para copiarla, apagá el servidor y copiá `izel.db` junto con `izel.db-wal` e `izel.db-shm`, si existen.
