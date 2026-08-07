# Portal Oakberry

Cáscara web multi-módulo del producto **oakberry-core**. Una web, muchos módulos.
Módulo #1: **Contabilidad → Conciliación de pagos** (reemplaza el Google Sheet).

- **Front:** Next.js 15 (App Router) + TypeScript → Vercel
- **Base operacional:** PostgreSQL (local → Neon/Cloud SQL) — estado en vivo + bitácora
- **Auth:** Google vía **Auth.js/NextAuth** (Opción A, en uso). Roles en la tabla `usuarios`
  (conciliador · pagador · causador · admin). Opción B futura: Firebase (ver "Auth (login)").
- **Bodega:** BigQuery sigue siendo el cerebro analítico; un sync BQ→Postgres alimenta
  facturas y propuestas (ver `scripts/sync_bq_to_pg.md`). La app **no** se monta sobre BQ.

## Arquitectura (por qué Postgres y no BQ)
El Sheet era base+interfaz+bitácora a la vez, y por eso borraba datos. Aquí se separan:

| Capa | Rol |
|------|-----|
| `facturas` | identidad + montos (espejo de la DIAN, vía sync) |
| `factura_propuesta` | lo que la máquina sugiere (se refresca a diario) |
| `factura_estado` | máquina de estados + lo que un humano confirmó (**intocable por el sync**) |
| `eventos` | **la bitácora**: append-only, encadenada por hash → trazabilidad incorruptible |

Máquina de estados: `capturada → clasificada → retenciones_ok → aprobada_pago → pagada → causada`.
Cada avance exige un evento humano; el cambio de estado y su evento se escriben en la
**misma transacción** (ver `lib/eventos.ts`).

## Auth (login)
**Opción A — EN USO:** Google vía **Auth.js/NextAuth** (`auth.ts`, `middleware.ts`,
`app/login`). El middleware protege todas las rutas; solo entran correos
`@manelfoods.com` + allowlist (`AUTH_ALLOWED_EMAILS`). El rol sale de la tabla `usuarios`
(correo→rol), con `AUTH_DEFAULT_ROL` de respaldo. Local: `AUTH_MODE=dev` (usuario fijo, sin
login). Pruebas/prod: `AUTH_MODE=google`. Toda la app pide `getCurrentUser()` → `{ email, rol }`.

**Opción B — futuro:** Firebase Auth (pensada para multi-tenant/SaaS). No cambia la app:
solo hay que implementar el mismo contrato `getCurrentUser()` con Firebase en vez de Auth.js.

## Correr local (Fase 0)

```bash
# 1. Postgres local + base
createdb oakberry_portal

# 2. Variables
cp .env.example .env.local
#   ajusta DATABASE_URL (por defecto: postgres://<tu-usuario>@localhost:5432/oakberry_portal)
#   AUTH_MODE=dev deja correr sin login (usuario fijo). En prod: AUTH_MODE=google

# 3. Esquema + datos de ejemplo
export DATABASE_URL="postgres://$USER@localhost:5432/oakberry_portal"
npm run db:schema
npm run db:seed

# 4. Dependencias + dev server
npm install
npm run dev
#   -> http://localhost:3000  (Conciliación en /contabilidad/conciliacion)
```

Sin Postgres a mano: `docker run --name pg -e POSTGRES_PASSWORD=pg -p 5432:5432 -d postgres:16`
y `DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres`.

## Desplegar (al aire)
1. Repo conectado a Vercel (import del proyecto).
2. En Vercel → Environment Variables: `DATABASE_URL` (Neon/Cloud SQL) + auth Google:
   `AUTH_MODE=google`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
   `AUTH_ALLOWED_DOMAIN`, `AUTH_ALLOWED_EMAILS`, `AUTH_DEFAULT_ROL`, `AUTH_URL`, `AUTH_TRUST_HOST`.
   Correr `db/schema.sql` contra la base de pruebas/prod una vez.
3. Cliente OAuth (Google Cloud → Credenciales → Web). El `redirect_uri` EXACTO debe ser
   `https://<host>/api/auth/callback/google`. Dominio → Vercel.

## Fases
- **Fase 0 (esto):** esqueleto + ventana de conciliación + bitácora blindada + login Google. ✅
- **Fase 1:** sync BQ→Postgres, backtest de paridad de un mes.
- **Fase 2:** portal de pagos. **Fase 3:** causación (POST Siigo). **Fase 4:** bancos, cuentas x pagar/cobrar/internacionales, token DIAN, dashboard, maestros CRUD.

## Estructura
```
db/schema.sql          esquema + candados de la bitácora
db/seed_dev.sql        datos de ejemplo (dev)
lib/db.ts              pool Postgres + withTx()
lib/eventos.ts         registrarEvento() atómico + verificarCadena() (sentinela)
lib/estados.ts         máquina de estados + roles por transición
lib/auth.ts            usuario/rol: getCurrentUser() -> {email,rol} (dev | Google/Auth.js)
auth.ts                config Auth.js (Google + compuerta de dominio/allowlist)
middleware.ts          protege todas las rutas (sin sesión -> /login)
app/                   portal (índice) + login + módulo contabilidad/conciliacion
scripts/sync_bq_to_pg.md   cómo corre en paralelo sin pisar lo humano
```
