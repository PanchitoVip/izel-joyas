# Izel Joyas

Dos partes que comparten una sola base de datos:

| Parte | Dirección | Quién entra |
|---|---|---|
| Catálogo (`catalogo/`) | `/` | Todo el mundo |
| Gestión (`gestion/`) | `/gestion/` | Sólo con contraseña |

Cuando un producto se marca "Publicar en el catálogo" en la gestión, aparece en el catálogo. El público nunca recibe precios, costos ni cantidades de stock.

## Dos locales: Moreno y Morón

La gestión tiene un selector **"Local"** arriba a la izquierda. Cada local tiene sus propias ventas, caja, stock, clientes y arreglos — lo que se carga en uno no aparece en el otro. El catálogo de productos y la lista de proveedores son **compartidos** entre los dos (se cargan una sola vez), aunque cada local anota sus propias compras y lo que le debe a cada proveedor por separado.

Es una sola contraseña para los dos locales por ahora: cualquiera que entre puede cambiar de local con el selector, se puede cambiar cuando se quiera. El login por mail/usuario (uno por local) queda para cuando se publique oficialmente.

## Probarlo en la compu

Hace falta [Node.js](https://nodejs.org) 22.13 o más nuevo. No hay nada más que instalar.

- **`Abrir Sistema.bat`**: abre la gestión en `http://localhost:3000/gestion/`.
- **`Abrir Catalogo.bat`**: abre el catálogo en `http://localhost:3000/`.

Cada uno prende el sistema si está apagado. Se abre una ventana negra que hay que dejar abierta mientras se use: al cerrarla, se apaga todo. La primera vez la gestión pide el **código de instalación**, que aparece en esa ventana, y una contraseña nueva.

## Antes de publicar

1. **Número de WhatsApp**: cargarlo en Gestión > Ajustes. Si el catálogo se publica solo, sin el sistema, va en `catalogo/config.js`.
2. **Confirmar con ella los productos marcados "Revisar"** (ver abajo).
3. **Cargar precios, costos y stock** en Gestión > Stock.
4. **Activar "Consultar disponibilidad"** en Ajustes, una vez que el stock esté cargado. Viene apagado para que no parezca todo agotado.

### Productos a confirmar

Salieron de Instagram, pero la publicación no dice el material o el dato es una deducción:

| Código | Producto | Qué confirmar |
|---|---|---|
| IZ-018 | Pulseras de Cristales | Material: el catálogo muestra "Consultanos el material" |
| IZ-023 | Gargantilla Corazón Rojo | Material: ídem |
| IZ-028 | Dije Inicial | Material: ídem |
| IZ-009 | Pulsera Estrellas | Se puso Plata 925 por ser de la misma serie de fotos |
| IZ-012 | Pulsera Virgen | Ídem |
| IZ-029 | Dije Argolla de Oro | La foto dice Oro 18k; confirmar qué pieza es |

Los nombres y descripciones de los 30 productos se escribieron mirando las fotos: conviene que ella los lea. Se editan en Gestión > Stock.

### Lo que no se pudo traer de Instagram

Las **historias destacadas** (Carteras, Swarovski, Aros de Plata, Aros argollas, Anillos Falange, etc.) piden iniciar sesión, así que esos productos no están. Las fotos del catálogo son las de las publicaciones, de 512×640 px: alcanzan para la web, pero si ella tiene los originales se ven mejor. Se cambian desde Editar en cada producto.

## Publicarlo en internet

**Opción recomendada: todo junto en un servidor.** Necesita un servicio con **disco persistente** para guardar `IZEL_DATOS`. Los planes gratuitos que borran el disco al reiniciar perderían las ventas. Variables:

```
HOST=0.0.0.0
PORT=3000
TRUST_PROXY=1
IZEL_DATOS=/ruta/del/disco
```

Tiene que estar detrás de HTTPS. El código de instalación aparece en los logs la primera vez.

Si se agrega `IZEL_CLAVE_INICIAL=la-contraseña-que-quieras`, el sistema arranca ya con esa contraseña puesta: no pide código de instalación y nadie que entre primero puede elegir la suya. Sirve para que un disco que se borra solo (plan gratis, cada redeploy) no vuelva a pedir el código cada vez.

**Opción rápida: sólo el catálogo, gratis.** La carpeta `catalogo/` es un sitio estático: se puede subir a Netlify, Cloudflare Pages o GitHub Pages con el número cargado en `config.js`. Los productos salen de `data/productos.json`. Para conectarlo después a un sistema en otro dominio, poner su dirección en `api` de `config.js` y `CATALOGO_ORIGEN=https://dominio-del-catalogo` en el servidor.

**Opción local: la gestión sólo en la compu del local.** Funciona con los `.bat`, pero el catálogo público no se actualizaría solo, y si la compu se rompe sólo quedan las copias que se hayan guardado afuera.

## Facturación

El sistema emite **comprobantes internos** ("no válido como factura") y permite anotar en cada venta el número o CAE de la factura hecha en ARCA. **No emite factura electrónica por sí mismo.** Para eso hace falta integrar los servicios web de ARCA con el CUIT y el certificado digital del negocio.

## Copias de seguridad

- Automática: una por día en `gestion/data/backups/`, se guardan las últimas 14.
- Manual: Gestión > Ajustes > Descargar copia. Conviene guardarla fuera de la compu o del servidor.
- Restaurar: con el sistema apagado, reemplazar `gestion/data/izel.db` por la copia y borrar `izel.db-wal` e `izel.db-shm` si existen. Las fotos subidas están en `gestion/data/uploads/`: hay que copiarlas aparte.

## Si se olvida la contraseña

Con el sistema apagado:

```bash
node -e "const {DatabaseSync:D}=require('node:sqlite');new D('gestion/data/izel.db').exec(\"DELETE FROM config WHERE k IN ('clave','codigo_instalacion')\")"
```

Al volver a iniciar, aparece un código nuevo y se elige otra contraseña. No se pierden datos.

## Pasarlo a otra PC

Apagar el sistema y copiar toda la carpeta, incluida `gestion/data`, que tiene los datos y las fotos subidas. En la otra PC hace falta Node. `CLAUDE.md` tiene el contexto para seguir trabajando con Claude Code.

## Desarrollo

```bash
cd gestion
npm test
```

Sin dependencias externas: Node con `node:sqlite`, y HTML, CSS y JavaScript sin frameworks. Los importes se guardan en centavos.
