# Izel Joyas: contexto para Claude

Este proyecto se armó en otra PC y se pasó a esta en un zip. Las sesiones de Claude Code no se comparten, así que todo lo importante de esa conversación está acá. Leé este archivo y el [README](README.md) antes de tocar nada.

## Quién y para qué

Francisco le arma esto a una amiga, dueña de la joyería **Izel Joyas** (Merlo 2633, B1744OEO Moreno, Provincia de Buenos Aires; Instagram @izeljoyas; lunes a viernes 9 a 19, sábados 9:30 a 14). Hablale en español rioplatense y en términos simples.

Tiene **dos locales, Moreno y Morón**: cada uno con su propia gestión (ventas, caja, stock, clientes, arreglos), pero comparten el mismo catálogo de productos y la misma lista de proveedores. Ver "Sucursales" en Decisiones.

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
  test/          Pruebas de la API: npm test, 30 en verde
  iniciar.bat    Prende el servidor si hace falta y abre la página pedida
  data/          DATOS REALES: base, fotos subidas y copias. Está en .gitignore
Abrir Sistema.bat / Abrir Catalogo.bat    Las dos entradas para la dueña
fuentes/instagram/    Fotos originales bajadas de Instagram y sus textos
herramientas/    build_catalog.py (rearma fotos y datos) y e2e.mjs (prueba de interfaz con Edge)
```

Un solo servidor sirve el catálogo en `/` y el sistema en `/gestion/`. Hace falta Node 22.13 o más nuevo; usa `node:sqlite` y, desde la sincronización con Google Drive, una sola dependencia de npm (`sharp`, para achicar fotos — ver Decisiones). Antes de eso no había ninguna.

## Decisiones y por qué

- **Una base y un servidor**: al publicar un producto en la gestión aparece solo en el catálogo. El catálogo igual funciona como sitio estático leyendo `data/productos.json` si no encuentra la API.
- **El público nunca recibe precio, costo ni cantidad de stock**. `catalogoPublico` en `api.js` filtra los campos y hay una prueba que lo controla. No la aflojes.
- **Importes en centavos enteros** en la base y en la API; se convierten sólo en la interfaz.
- **Ganancia = ventas − costo de lo vendido + otros ingresos − gastos.** Las compras de mercadería no son gasto: entran por su costo al venderse. `FUERA_DE_RESULTADO` en `api.js` lista lo que mueve plata sin ser ganancia ni gasto (cobranzas, pagos a proveedores, retiros, anulaciones).
- **Fechas en hora de Argentina** (`ahora()` en `db.js`), para que un servidor en UTC no corra los días.
- **La CSP del sistema prohíbe estilos y scripts en línea**: nada de `style=""` ni `onclick`. Todo el HTML pasa por la plantilla `h` que escapa valores.
- **Primera clave con código de instalación** que sale en la consola, para que un extraño no la cree si el sistema se publica. Si se define `IZEL_CLAVE_INICIAL` (variable de entorno), el sistema arranca ya con esa contraseña puesta y se salta el código: se usa en el Render de demo, cuyo disco se borra en cada redeploy.
- **Facturación**: sólo comprobantes internos ("no válido como factura") y un campo para anotar el número o CAE de ARCA. La factura electrónica **no está integrada**: requiere CUIT y certificado de ella, y saber su condición fiscal.
- **Sucursales (Moreno/Morón)**: `SUCURSALES` en `db.js`. Clientes, ventas, caja, arreglos, compras y el stock (tabla `stock_sucursal`, ya no una columna de `productos`) quedan separados por local; la sucursal activa se guarda en la sesión (cookie), no en el usuario, y se cambia en cualquier momento con el selector "Local" de la barra lateral — todavía no hay login por usuario, así que cualquiera que entre con la contraseña puede cambiar de local. **Productos y proveedores son compartidos** entre los dos: el mismo catálogo, pero cada local anota sus propias compras y su propia deuda con cada proveedor (y el número de comprobante de venta es una sola secuencia compartida, no una por local — alcanza mientras no haya facturación ARCA real). Una base vieja (de antes de este cambio) migra sola la primera vez que arranca: todo lo que ya existía queda en Moreno. Ver `migrarASucursales` en `db.js`.
- **Login con Google (opt-in, `GOOGLE_CLIENT_ID` + `IZEL_CORREOS_AUTORIZADOS`)**: a pedido del usuario, para el hosting de producción. Reemplaza la clave única compartida por identidad real por persona: Google Identity Services en el navegador, verificado en el backend contra el endpoint público `tokeninfo` de Google (sin ninguna librería — `verificarCredencialGoogle` en `server.js`, con `GOOGLE_TOKENINFO_URL` pisable para los tests), chequeando `aud` (que el token sea para este sistema) y que el mail esté en la lista autorizada. Sobre eso, cada mail tiene su **propia contraseña** (tabla `usuarios`, mismo hash+sal que la clave única), que se crea sola la primera vez que esa persona entra — mismo patrón que `/api/instalar`, pero por mail. La sesión queda atada al mail (`sesiones.email`). El catálogo público puede mostrar un link "Ir a gestión" sólo a quien se identifique con un mail autorizado, vía `POST /api/acceso-gestion` (no crea sesión, sólo confirma la identidad). **Si estas variables no están puestas, el sistema funciona exactamente como antes** (clave única, código de instalación) — se probó explícitamente que no hay regresión. Decisiones tomadas con el usuario: contraseña personal elegida por cada una (no una predefinida), un solo dominio para catálogo y gestión (evita CORS/cookies entre sitios), y nada de roles distintos ni auditoría de "quién hizo qué" todavía (la sesión ya guarda el mail, quedaría fácil sumarlo si lo piden).
- **Catálogo desde Google Drive (opt-in, además `GOOGLE_CLIENT_SECRET`)**: trae fotos de una carpeta de Drive al catálogo, revisada sola los sábados (`sincronizacionSemanal` en `server.js`) o a demanda (botón "Sincronizar ahora" en la pantalla "Catálogo"). La carpeta real relevada (`Nuevo catalogo Helena925 precios 2026`) resultó ser el catálogo mayorista de un **proveedor externo**, compartida con Francisco en modo sólo lectura (no puede volver a compartirla) — por eso se descartó una cuenta de servicio de Google (necesitaría que el proveedor le diera acceso a esa cuenta) y se usa en cambio OAuth 2.0 con el acceso de la persona que conecta (`access_type=offline&prompt=consent`, refresh token guardado en `config.drive_refresh_token`, nunca en un archivo). El callback (`GET /api/drive/callback` en `server.js`) **no depende de la cookie de sesión**: Google vuelve ahí con una navegación entre sitios y la cookie es `SameSite=Strict`, así que no llegaría — se valida en cambio con un `state` de un solo uso que sí exige sesión para generarse (`/api/drive/conectar`). Cada foto de esa carpeta trae el precio mayorista escrito encima: **nunca se lee ni se guarda ningún precio de ahí** (los productos nuevos entran con `costo=0, precio=0`). Tampoco se auto-publican: entran con `publicado=0` y `revisar=1` (reutilizando el flag que ya existía) para que la dueña cargue precio/costo/stock reales antes de que aparezcan en el catálogo público — y si una foto ya sincronizada desaparece de Drive, el sistema nunca la borra ni la despublica solo (podría tener stock o ventas reales), como mucho la vuelve a marcar a revisar. La carpeta de "Fornituras" (insumos para fabricar/reparar, no joyas terminadas) queda excluida por decisión explícita del usuario — la lista de exclusión (`config.drive_excluir`) es editable desde Ajustes, sembrada con `"Fornituras"`. La carpeta a sincronizar y esa lista son configuración de negocio (se guardan en `config`, se editan en Ajustes), a diferencia de `GOOGLE_CLIENT_SECRET` que es de infraestructura (variable de entorno, la carga quien tenga acceso al hosting). Lógica en `gestion/drive.js`; `extensionImagen` (validación de magic bytes) se compartía con la subida manual de fotos y se movió a `gestion/imagenes.js` para que ambos módulos la usen sin depender uno del otro.
- **Las fotos de Drive se comprimen antes de guardarse (`sharp`, única dependencia de npm del proyecto).** Pasó lo que se temía: la primera conexión real con la carpeta de Helena925 llenó el disco de 1 GB de producción (subió 953 MB en uploads, 1174 fotos a ~800 KB cada una, tal como venían del proveedor) y la sincronización se cortó con `ENOSPC`. Se limpiaron esos productos sin publicar (cero pérdida real, nada que la dueña hubiera visto) y se agregó `comprimirImagen` en `drive.js`: mismo criterio que ya usa la subida manual (máx. 1000px, JPEG calidad 85), pero del lado del servidor — sin esto, el disco se puede volver a llenar sin importar su tamaño si la carpeta del proveedor sigue creciendo. Además, si el disco igual se llena a mitad de una corrida, `sincronizar()` para prolijo en vez de romperse (atrapa `ENOSPC` puntualmente, no cualquier error), deja lo que ya bajó, y la próxima corrida retoma justo donde quedó (las fotos ya guardadas no se vuelven a descargar). Decisión tomada con el usuario: agregar esta única dependencia es preferible a confiar sólo en agrandar el disco, porque el disco se puede agrandar pero **no achicar después**, y la carpeta del proveedor puede seguir creciendo. El usuario también decidió sumar igual algo de margen al disco (más barato que parece: Render cobra $0.25 por GB al mes).

Ideas sumadas: arreglos con seña, aumento masivo de precios, cierre de caja, recordatorio de deuda y cumpleaños por WhatsApp, alertas de stock, reportes, consultas más pedidas, talle en el carrito, "Abierto ahora", pantalla "Pagos" para sueldos y servicios (reusa Caja, categorías "Sueldos"/"Servicios").

## Cómo se obtuvieron los productos

- El perfil de Instagram es público. Se bajaron las 36 publicaciones visibles sin iniciar sesión, a 512×640 como máximo. Quedaron 30 productos al sacar repetidos.
- Las **historias destacadas piden login y no se accedió**. Faltan carteras, Swarovski, aros de plata, argollas y anillos Falange. No iniciar sesión con ninguna cuenta para conseguirlas: pedirle las fotos a ella.
- Los **nombres y descripciones los escribió Claude mirando las fotos**: ella tiene que validarlos.
- **Nunca inventar materiales ni precios.** Si Instagram no lo dice, queda sin material y el catálogo muestra "Consultanos el material". La tabla de productos a confirmar está en el README.

## Estado

**Funciona y se probó:** las 31 pruebas de API, el recorrido completo de interfaz en Edge headless (alta de proveedor y cliente, compra, venta mixta, cobro, gasto, cierre, arreglo, foto, venta sin stock, anulación, salir y volver a entrar), el mapa con el pin correcto, las dos entradas `.bat` ejecutadas de verdad en la PC original, la separación por sucursal (Moreno/Morón) probada a mano en el navegador contra la base real, y el login con Google **ya probado en producción (Render) con una cuenta real** (Francisco, dueño del proyecto) — entró, eligió su contraseña y quedó andando de punta a punta. El catálogo desde Google Drive se probó con la pantalla "Catálogo" y "Ajustes" en el navegador local (aparecen sólo cuando `GOOGLE_CLIENT_SECRET` está puesto, el link "Conectar Google Drive" devuelve el redirect esperado, renombrar un producto desde la grilla guarda y apaga "Revisar") — falta hacer la conexión real completa (el consentimiento de Google de punta a punta) contra la carpeta real del proveedor, que solo puede probarse a mano, no con un test automático.

**Auditoría con agentes de revisión (uno por módulo, dos vueltas cada uno para no dejar regresiones):** encontraron y arreglaron 9 bugs reales — el más repetido fue el mismo error en tres lugares distintos (borrado de proveedor, de producto, de movimiento de caja): chequear el **neto sumado entre Moreno y Morón** en vez de cada sucursal por separado, lo que podía esconder una deuda o dejar stock huérfano aunque pareciera todo en cero. También: no se podía borrar un movimiento de caja ya contado en un cierre (lo desarmaba sin dejar rastro); una venta con el mismo producto repetido en dos renglones podía superar el stock sin usar "permitir sin stock"; una compra podía sumar stock a un producto dado de baja; el botón "Cancelar" de un arreglo existía en el backend pero no en la pantalla; y una condición de carrera real en la navegación (`navegar()` en `app.js`) donde una pantalla lenta podía pisar el contenido de la pantalla a la que ya habías navegado. Quedaron dos preguntas para la dueña, sin tocar nada: qué hacer con una seña de arreglo ya cobrada al cancelarlo (¿se devuelve, queda a favor, se pierde?), y si el recibo de "Venta con factura ARCA" debería avisar algo cuando todavía no se cargó el CAE.

**Ya publicado** (ver "Sobre la publicación"): repo en GitHub (`PanchitoVip/izel-joyas`), catálogo en Netlify, y una copia de demo de la gestión en Render (free, se resetea sola).

**Sin verificar:** el PDF del comprobante se genera en una página, pero nadie lo miró como imagen; el botón de WhatsApp con un número real.

**Datos actuales:** `gestion/data` viene con lo que se cargó en la PC original: contraseña definida (Francisco la cambió a pedido del usuario; no está en ningún archivo), 1 venta, 1 cliente ("lili"), 1 proveedor y 4 movimientos de caja, todo migrado a la sucursal Moreno. **Confirmado por el usuario: son datos de prueba, no hay nada real que migrar a producción.** Las fotos de los 30 productos actuales (de Instagram) tampoco se van a usar: van a salir de una carpeta de Google Drive (ver Pendientes). Para reiniciar la contraseña, ver el README.

## Pendientes

1. Número de WhatsApp: falta. Va en Gestión > Ajustes y, si el catálogo se publica solo, en `catalogo/config.js`.
2. Que ella confirme los productos marcados "Revisar" y cargue precios, costos y stock — **en pausa**: con la carpeta de Drive (Pendientes 5) los productos actuales de Instagram se van a reemplazar, no tiene sentido cargarles datos reales todavía.
3. Que confirme si prefiere los **proveedores separados por local** en vez de compartidos (ver Decisiones > Sucursales) — es el único supuesto sin confirmar de ese cambio.
4. Login por mail/usuario para que cada local tenga su propia cuenta — hoy la sucursal se sigue eligiendo con un selector, no con el login (el login con Google identifica a la persona, no todavía el local).
5. **Implementado**: catálogo sincronizado con Google Drive (`gestion/drive.js`), ver Decisiones. Falta: que Francisco pruebe la conexión real una vez (Ajustes > "Conectar Google Drive", con la carpeta real de Helena925) y, más adelante, decidir qué hacer con "Fornituras" (hoy excluida) y si las dueñas van a armar su propia carpeta en vez de usar la del proveedor.

## Sobre la publicación

**Ya está hecho** (a pedido del usuario, no era un "todavía no"):

- Repo en GitHub: `github.com/PanchitoVip/izel-joyas` (público). Push a `main` redespliega los dos solos.
- Catálogo en Netlify: **izel-joyas.netlify.app**. Carpeta publicada: `catalogo/`.
- Gestión de **demo** en Render (plan free): **izel-joyas.onrender.com/gestion/**, con una contraseña fija puesta vía `IZEL_CLAVE_INICIAL` (variable de entorno en el panel de Render; no está en ningún archivo del repo). Es una base aparte, no la real: se duerme sola a los ~15 min de inactividad (tarda hasta 50s en responder después) y **se resetea en cada redeploy** — es solo para mostrar, no para cargar datos que importen. Otras variables puestas en Render: `HOST=0.0.0.0`, `TRUST_PROXY=1`.
- Gestión de **producción** en Render, servicio **`izel-joyas-produccion`** (plan Starter pago + disco persistente de 1 GB en `/var/data`): **izel-joyas-produccion.onrender.com/gestion/**. El usuario creó el servicio y cargó las variables él mismo, en su propio navegador (prefiere manejar personalmente cualquier paso con tarjeta). Tiene el login con Google activo (`GOOGLE_CLIENT_ID` + `IZEL_CORREOS_AUTORIZADOS` con los mails de las dos dueñas y el de Francisco, este último sumado para poder probar — ver Decisiones > Login con Google). Probado de punta a punta con una cuenta de Google real. **Confirmado por el usuario: la base de esta demo y de esta producción son datos de prueba, no hay datos reales que migrar desde la PC.**
- La PC local sigue aparte e intacta; nada de esto la toca.

Cuando pase a producción en serio:

- Netlify/Vercel siguen sirviendo **sólo para el catálogo** (carpeta de publicación `catalogo`). Vercel: confirmar que su plan gratis permite uso comercial.
- El sistema de gestión necesita un hosting **pago, con disco persistente** (Render pago, Railway, un VPS), porque usa SQLite en disco y los planes gratis no lo conservan.
- Publicado aparte, el catálogo no se actualiza solo desde la gestión: lee `data/productos.json`, salvo que se configure `api` en `config.js`.
- **Nunca subir `gestion/data` ni el zip a GitHub**: tienen datos del negocio. Ya está en `.gitignore`.

## Trampas conocidas

- **Los `.bat` deben tener finales de línea CRLF, ser ASCII y no usar `chcp 65001`.** La primera versión tenía LF y `chcp`: Windows la leía mal y decía que faltaba Node. Pasó desapercibido porque no se había ejecutado. Si tocás un `.bat`, ejecutalo de verdad y controlá los bytes: `sed -i` en Git Bash borra los CR.
- `node:sqlite` muestra un aviso de función experimental; es normal.
- Si el puerto 3000 está ocupado, el sistema avisa y termina.
- `herramientas/build_catalog.py` **sobrescribe** `catalogo/img/productos` y `data/productos.json`. No cambia lo cargado en la base.
- La base usa WAL: para copiarla, apagá el servidor y copiá `izel.db` junto con `izel.db-wal` e `izel.db-shm`, si existen.
