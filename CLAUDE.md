# CLAUDE.md — Portal de contabilidad de ManelFoods

Guía para Claude Code cuando trabaja en este repo.

## Qué es

La contabilidad de ManelFoods (Oakberry Colombia) dejó de vivir en un Google
Sheet y es una **app web**: `https://www.manelfoods.co`. Acá se clasifican las
facturas de la DIAN, se practican retenciones, se arma el archivo con el que el
banco paga a los proveedores, y entran las cuentas de cobro y cotizaciones de
quien no factura electrónicamente.

**Esto mueve plata de verdad.** Un dato mal escrito en el maestro no da error:
sale un archivo más corto y un proveedor no cobra. Ya pasó (ver *Trampas*).

## Antes de tocar código: LAS REGLAS

**Obligatorio** leerlas antes de construir o modificar un módulo:

```bash
gsutil cat gs://oakberry-col-core/00_gobernanza/playbooks/lecciones_auditoria_codigo.md
```

21 reglas ✅/❌ + protocolo de validación (checklist pre-producción, señales de
bug, sentinelas, backtest). Nacen de la auditoría de facturación de jul-2026
(65 hallazgos, 59 bugs). Las que más muerden acá:

- **R3** — el parecido *sugiere*, nunca *afirma*. Nada de "la factura más
  parecida" ni "el banco que se llama casi igual" en un camino de dinero.
- **R12** — en caminos de dinero, las excepciones se gritan; nunca `?? ""`.
- **R13** — el trabajo humano es sagrado: no se pisa sin que un humano lo diga.
- **R14** — todo bug corregido deja su centinela.
- **R15** — llaves de round-trip: lo que sale tiene que poder volver.
- **R18** — un loop humano que no cierra quema la confianza: si algo no se
  puede hacer, hay que decir **por qué** y **qué hacer**.
- **R20** — todo cambio de frontend público se valida en CELULAR real.

## La spec del negocio

El **qué** y el **por qué** (no el código) viven en el bucket:

```bash
gsutil cat gs://oakberry-col-core/03_contabilidad/conciliacion_pagos/06_portal_web.md
```

El área completa es `03_contabilidad/conciliacion_pagos/`; `00_README.md` es su
índice. La sesión de negocio se abre con `/start-core contabilidad` **desde el
repo datawarehouse** — ojo, ese comando NO trae este código.

## Stack

- **Next.js 15** (App Router, Server Actions) en **Vercel**. `main` = producción.
- **Neon Postgres** = base operacional · **BigQuery** = bodega.
  **Regla de oro: la app NO se monta sobre BQ.** BQ entra por `scripts/sync_bq_to_pg.py`.
- **Auth.js** con Google. Cualquier `@manelfoods.com` es admin; los externos se
  agregan a la tabla `usuarios`. Los roles se aplican en el SERVIDOR
  (`exigirCap`), la UI solo esconde.
- **Bitácora** `eventos`: append-only y encadenada por hash. Todo cambio de
  estado se registra **en la misma transacción** (`registrarEvento`).

## El ambiente de pruebas

Un SEGUNDO despliegue del mismo repo, con su propia base:

| | |
|---|---|
| **Producción** | `www.manelfoods.co` · Neon rama `main` · proyecto Vercel `portal` |
| **Pruebas** | `portal-pruebas-plum.vercel.app` · Neon rama `pruebas` · proyecto Vercel `portal-pruebas` |
| **La puerta** | `www.manelfoods.co/pruebas` **redirige** al ambiente |

Lo único que los distingue es **`AMBIENTE=pruebas`**: enciende la franja roja y
le cambia el nombre a la cookie de sesión. La separación es de infraestructura,
no un `if`: compartir el pool de conexiones es cómo una factura de mentiras
termina en los libros de verdad.

**Por qué la puerta REDIRIGE y no sirve el ambiente por dentro** (rewrite +
`basePath`): topa con el login. Auth.js arma sus URLs con la ruta que recibe —a
la que Next ya le quitó el prefijo— así que el callback de Google apuntaba al
`/api/auth/callback/google` de PRODUCCIÓN. Probadas las tres variantes de
`AUTH_URL` contra un despliegue real: o el login del ambiente aterriza en
producción, o Auth.js responde `"Bad request"` a todo. No se intenta de nuevo.

```bash
# Local, contra una base de pruebas (NUNCA la del .env.local)
createdb portal_e2e && psql -q portal_e2e -f db/schema.sql
DATABASE_URL="postgresql://…/portal_e2e" python3 scripts/sembrar_demo.py --aplicar
AMBIENTE=pruebas DATABASE_URL="postgresql://…/portal_e2e" AUTH_MODE=dev DEV_USER_ROL=admin \
  npx next start -p 3402

# Rebobinar el ambiente entero al estado de producción (segundos)
neon branches reset pruebas --parent --project-id odd-king-16815003
```

- `scripts/sembrar_demo.py` deja facturas falsas paradas en **cada** estado del
  flujo (por clasificar · clasificada · lista para pago con y sin cuenta · en
  validación · pagada · nota crédito · cuenta de cobro · cotización con adelanto).
  `--rehacer` rebobina lo sembrado. **Se niega a correr contra la base del
  `.env.local`.**
- **Retroceder no es deshacer:** la bitácora es append-only y así sigue. Se
  rebobina sembrando de nuevo o reseteando la rama de Neon.
- `CORREO_DESTINO_FORZADO=<correo>` manda TODO ahí y nunca al proveedor. Es
  variable de entorno y no un flag a propósito: un flag hay que acordarse.
- En pruebas, `INTAKE_UPLOAD_URL` va VACÍA: así un documento subido no cae en el
  Drive real de contabilidad (queda `pendiente` y el envío se guarda igual).
- **Los 7 crons de la VM apuntan solo a producción.** En pruebas se corren a mano
  con `DATABASE_URL=` por delante.

## Cómo se trabaja

```bash
npm run build          # incluye typecheck; NO desplegar sin esto en verde
npx tsc --noEmit
AUTH_MODE=dev DEV_USER_ROL=admin npx next start -p 3311   # local, sin Google
```

`DEV_USER_ROL` acepta `admin | causador | conciliador | pagador` — así se prueba
qué ve cada rol sin inventar sesiones.

**Desplegar** = `git push origin HEAD:main` (Vercel toma `main`). Verificar que
el deploy quedó vivo buscando una clase nueva del CSS en producción, no
asumiéndolo.

### Los centinelas (correr TODOS antes de desplegar)

```bash
for t in nit bancos candado_aprobacion permisos documentos retenciones_excel espina_dian \
         desvio_titular nombre_pago modal_portal enlaces_basepath; do
  node scripts/test_$t.js; done
python3 scripts/test_enriquecimiento_xml.py   # base REAL, con ROLLBACK
python3 scripts/test_intake_a_pagos.py     # contra la base REAL, con ROLLBACK
python3 scripts/test_cuenta_destino.py     # el desvío de pago; base REAL, con ROLLBACK
python3 scripts/test_esquema_reconstruye.py # ¿schema.sql reconstruye la base? (Postgres local)
```

Cada uno fija una regla que ya se rompió una vez. Si agregas uno, **pruébalo
metiendo el bug a propósito**: un centinela que nunca falló no sabes si sirve.

Los centinelas de datos (no de código) viven en el otro repo:
`datawarehouse/contabilidad/facturacion/health_check.py`.

## Trampas que ya costaron caro

- **El NIT con dígito de verificación.** La DIAN factura con 9 dígitos
  (`901675059`); quien carga a mano escribe `901675059-9`. Se ve igual y no
  cruza: la cuenta existe en Maestros y el proveedor **no sale en el archivo del
  banco**, sin ningún error ($37M detenidos). Canónico = **sin DV** (`lib/nit.ts`
  + espejo `scripts/nit.py`). **Nunca** "quítale el último dígito si son 10":
  una cédula de 10 dígitos tiene ~9% de dar DV válido por casualidad.
- **Dos copias de la misma consulta.** El candado de aprobación tenía su propia
  copia del SQL de la certificación y se quedó sin una columna → bloqueaba
  siempre, callado. El genérico de `query<T>()` es una **promesa, no una
  verificación**: TypeScript no mira el SQL. Un solo lugar por consulta.
- **Un Server Action que LANZA** se ve en producción como "Application error" con
  un digest: el mensaje escrito para el humano no llega. Las acciones de bandeja
  devuelven `Resultado` (`lib/resultado.ts`) y el motivo se pinta al lado del botón.
- **El `required` del HTML y el `accept` de un `<input>` NO son defensas** — se
  saltan desde la consola. Toda validación va también en el servidor.
- **Vacío no es cero.** En el Excel de retenciones, blanco = "no la llené"; un 0
  escrito = "aquí no se retiene".
- **En Colombia el punto separa miles.** `"9.870"` son 9.870 pesos, no 9,87.
- **CSV no lleva formato de celda.** Por eso el archivo de Davivienda es `.xlsx`:
  el banco exige la cuenta como TEXTO y Excel se come los ceros a la izquierda.
- **Cruzar por valor es inviable:** el 45,7% de las facturas comparten NIT y
  total con una gemela.
- **`scripts/sync_bq_to_pg.py` se despliega solo al guardarlo.** No espera a un
  push: la VM lo corre por cron desde el árbol de trabajo (`*/10 14-23`, `40` en
  la madrugada, `--full` a las 10). Editarlo ES desplegarlo, y entra en
  producción hasta 10 minutos después. La app de Vercel sí necesita el push, así
  que entre lo uno y lo otro hay una ventana donde los DATOS ya cambiaron y la
  INTERFAZ todavía no — pasó el 27-ago: las facturas sin XML entraron a la base
  antes de que existiera la marca que las explica. Probar siempre con
  `--dry-run` (hace ROLLBACK) antes de guardar la versión buena, y desplegar la
  interfaz de inmediato.
- **Tras un redeploy**, una pestaña abierta sigue enviando al build anterior. En
  local, `next start` corriendo mientras se reconstruye sirve HTML nuevo con JS
  viejo (los botones no reaccionan): reiniciar el server antes de probar.
- **Los assets de `public/`** que use una página pública hay que excluirlos del
  matcher del middleware, o dan 307 y la imagen rota deforma la página.
- **La paleta de las páginas públicas** es `--purple` / `--border-lav`, no
  `--acc` / `--line` (esas no existen: el botón sale blanco sobre blanco).

## Mapa rápido

| Dónde | Qué |
|---|---|
| `app/(portal)/contabilidad/` | el portal interno (conciliación, pagos, maestros, bandejas) |
| `app/cuentas-de-cobro/`, `app/cotizaciones/`, `app/completar/` | landings PÚBLICAS (fuera del middleware) |
| `lib/permisos.ts` | capacidades por rol — `ver_*` es leer, el resto es operar |
| `lib/certificaciones.ts` | el candado de aprobación del intake (módulo puro) |
| `lib/nit.ts`, `lib/bancos.ts`, `lib/davivienda.ts` | identidad y formato del archivo del banco |
| `lib/retenciones.ts` | ÚNICO camino de escritura de retenciones |
| `scripts/` | cargues, centinelas y arreglos puntuales (todos con ensayo antes de `--aplicar`) |
| `db/schema.sql` | el esquema, por secciones numeradas con su porqué |

## Convenciones

- **Todo en español**, código y comentarios incluidos: lo lee el equipo.
- Los comentarios explican **por qué**, no qué. Si un comentario se puede deducir
  del código, sobra; si documenta una decisión o una trampa, es obligatorio.
- Los mensajes de error se escriben **para el humano que los va a leer**: qué
  pasó y qué hacer, no un código.
- Los scripts que tocan datos van en **ensayo por defecto** y solo escriben con
  `--aplicar`, dejando registro en la bitácora.
