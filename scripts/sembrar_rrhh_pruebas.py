#!/usr/bin/env python3
"""Siembra el módulo RRHH del ambiente de PRUEBAS con personas INVENTADAS.

Decisión de Daniel (2026-10-06): en pruebas se valida la app completa con datos
anónimos; la data real solo vive en producción. Este script:
  1. borra TODO lo de rrhh_* (incluido cualquier maestro real que haya quedado);
  2. siembra las 11 tiendas reales (no son datos personales) con horario y geocerca;
  3. inventa ~40 colaboradores (nombres sintéticos, salarios de mínimo a 2,2 MM),
     3-4 por tienda, un administrador de punto por tienda, 2 de RRHH;
  4. turnos de las últimas 8 semanas + 2 adelante (publicadas las pasadas);
  5. marcaciones con selfie placeholder para los turnos pasados (90 % dentro del
     radio y aprobadas; 6 % fuera del radio sin revisar; 4 % sin marcar);
  6. solicitudes en los tres estados, saldos iniciales al corte, novedades,
     una quincena aprobada, un mes de incentivos.
CANDADO: solo corre contra la base cuyo host coincide con ~/.neon_pruebas_url.
    DATABASE_URL="$(cat ~/.neon_pruebas_url)" python3 scripts/sembrar_rrhh_pruebas.py --aplicar
"""
import argparse, os, random, sys, io, datetime as dt, json
import psycopg2
from psycopg2.extras import execute_values, Json

random.seed(20261006)
HOY = dt.date.today()

TIENDAS = [
 ("ANDINO","Andino","Cra. 11 #82-71","Bogotá","01",10,21,4.6668,-74.0533,120,0,True),
 ("CALLE 109","Calle 109","Cl. 109 #15-45","Bogotá","02",8,21,4.6963,-74.0381,120,0,True),
 ("COLINA","Colina","Cra. 58 #138-27","Bogotá","03",9,21,4.7334,-74.0646,120,0,True),
 ("UNICENTRO","Unicentro","Av. 15 #123-30","Bogotá","04",10,21,4.7024,-74.0417,150,0,True),
 ("ZONA T","Zona T","Cl. 83 #13-07","Bogotá","05",8,23,4.6672,-74.0549,120,0,True),
 ("ZONA G","Zona G","Cl. 69A #5-45","Bogotá","06",8,22,4.6519,-74.0566,120,0,True),
 ("PLAZA CLARO","Plaza Claro","Cl. 26 #69-40","Bogotá","07",10,21,4.6568,-74.1097,150,0,True),
 ("TITAN PLAZA","Titan Plaza","Av. Boyacá #80-94","Bogotá","08",10,21,4.6947,-74.0869,150,0,True),
 ("MALOKA","Maloka","Cra. 68D #24A-51","Bogotá","09",10,21,4.6572,-74.1091,150,0,True),
 ("CALLE 76","Barranquilla 76","Cl. 76 #54-11","Barranquilla","10",9,21,11.0041,-74.8070,120,0,True),
 ("CALLE 140","Calle 140","Cl. 140 #11-58","Bogotá","12",9,21,4.7199,-74.0351,120,0,True),
 ("VIVA","Viva Barranquilla","Cl. 99 #53-280","Barranquilla","11",10,21,11.0190,-74.8320,150,0,False),
]
NOMBRES = ["AMARANTA","BALTAZAR","CELESTE","DAMIÁN","ELOÍSA","FABRICIO","GALA","HELIODORO","ÍNDIRA","JACINTO","KIARA","LEANDRO","MARISOL","NICANOR","OLIVIA","PRÓSPERO","QUERUBÍN","ROSALBA","SANTIAGO","TAMARA","ULISES","VIOLETA","WENCESLAO","XIMENA","YAMILE","ZACARÍAS","BRISA","CÉSAR","DULCE","EMILIANO","FLORENCIA","GASPAR","HILDA","ISMAEL","JULIANA","KEVIN","LORENA","MATEO","NATALIA","ORLANDO","PILAR","RAMIRO","SOFÍA","TOMÁS","VALERIA","WILSON"]
APELLIDOS = ["ACEVEDO","BARRAGÁN","CASTAÑO","DUARTE","ESCOBAR","FIGUEROA","GUZMÁN","HOYOS","IBARRA","JARAMILLO","LONDOÑO","MONSALVE","NARANJO","OSPINA","PALACIO","QUICENO","RESTREPO","SALAZAR","TORO","URIBE","VALENCIA","ZAPATA","AGUDELO","BETANCUR","CARDONA","DUQUE","ECHEVERRI","FRANCO","GIRALDO","HENAO"]
EPS = ["SANITAS EPS","FAMISANAR EPS","SALUD TOTAL","COMPENSAR EPS","SURA EPS"]; AFP = ["PROTECCIÓN","PORVENIR","COLFONDOS"]; CCF = ["COMPENSAR","COLSUBSIDIO","CAFAM"]
PATRONES = [(9,16),(13,21),(14,22),(10,18),(8,16),(12,20),(11,19)]
SELFIE = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfa28a2803fffd9") * 1  # JPEG 1x1 válido
SELFIE = SELFIE + b"\x00" * 2500   # relleno para pasar el mínimo de tamaño del action

def festivo(f): return f in {dt.date(2026,m,d) for m,d in [(1,1),(1,12),(3,23),(4,2),(4,3),(5,1),(5,18),(6,8),(6,15),(6,29),(7,20),(8,7),(8,17),(10,12),(11,2),(11,16),(12,8),(12,25)]}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--aplicar", action="store_true"); a = ap.parse_args()
    url = os.environ.get("DATABASE_URL") or sys.exit("DATABASE_URL")
    pru = open(os.path.expanduser("~/.neon_pruebas_url")).read().strip()
    if url.split("@")[-1] != pru.split("@")[-1]: sys.exit("CANDADO: esa no es la base de pruebas")
    conn = psycopg2.connect(url); cur = conn.cursor()
    for t in ["rrhh_eventos","rrhh_liquidaciones","rrhh_incentivo_mes","rrhh_quincenas","rrhh_novedades","rrhh_saldos_iniciales","rrhh_solicitudes","rrhh_marcaciones","rrhh_turnos","rrhh_empleados","rrhh_tiendas"]:
        cur.execute(f"DELETE FROM {t}")
    execute_values(cur, "INSERT INTO rrhh_tiendas (id,nombre,direccion,ciudad,centro_costo,apertura,cierre,lat,lng,radio_m,almuerzo_min,activa) VALUES %s", TIENDAS)
    # empleados
    emps = []; aid = 1000; usados = set()
    def nombre():
        while True:
            n = f"{random.choice(APELLIDOS)} {random.choice(APELLIDOS)} {random.choice(NOMBRES)}"
            if n not in usados: usados.add(n); return n
    for (tid, *_rest, activa) in TIENDAS:
        if not activa: continue
        k = random.choice([3,3,4,4,5]) if tid not in ("ZONA T","CALLE 109") else 6
        for i in range(k):
            aid += 1
            admin = i == 0
            sal = 2_056_398 if admin else random.choice([1_750_905]*5 + [1_950_905, 1_850_000, 2_150_905])
            ingreso = HOY - dt.timedelta(days=random.randint(40, 900))
            emps.append(dict(activo_id=aid, nombre=nombre(), punto=tid, cargo="ADMINISTRADOR DE PUNTO" if admin else "AUXILIAR PUNTO DE VENTA", salario=sal, ingreso=ingreso,
                             rol="admin_punto" if admin else "colaborador", email=f"prueba{aid}@manelfoods.co", consent=None if random.random() < 0.1 else ingreso))
    for i in range(2):
        aid += 1; emps.append(dict(activo_id=aid, nombre=nombre(), punto="ZONA G", cargo="ANALISTA RRHH", salario=2_600_000, ingreso=HOY - dt.timedelta(days=500), rol="rrhh", email=f"rrhh{i}@manelfoods.co", consent=HOY - dt.timedelta(days=400)))
    execute_values(cur, """INSERT INTO rrhh_empleados (activo_id,nombre_completo,punto,cargo,salario,auxilio_transporte,fecha_ingreso,tipo_contrato,eps,afp,arl,ccf,ciudad_expedicion,snapshot_date,email,rol_app,consentimiento_firmado_en,consentimiento_archivo) VALUES %s""",
        [(e["activo_id"], e["nombre"], e["punto"], e["cargo"], e["salario"], e["salario"] <= 2*1_750_905, e["ingreso"], "INDEFINIDO", random.choice(EPS), random.choice(AFP), "SURA", random.choice(CCF), "BOGOTÁ, D.C.", HOY, e["email"], e["rol"], e["consent"], "consentimiento_firmado.pdf" if e["consent"] else None) for e in emps])
    # turnos: 8 semanas atrás, 2 adelante
    lun = HOY - dt.timedelta(days=HOY.weekday())
    desde = lun - dt.timedelta(weeks=8); hasta = lun + dt.timedelta(weeks=2, days=6)
    tcfg = {t[0]: t for t in TIENDAS}
    turnos = []; marcs = []
    for e in emps:
        if e["rol"] == "rrhh": continue
        t = tcfg[e["punto"]]; ap_, ci = t[5], t[6]
        descanso = random.randint(0, 3); patron = random.choice(PATRONES)
        f = desde
        while f <= hasta:
            if f >= e["ingreso"]:
                dow = f.weekday(); publicado = f < lun + dt.timedelta(days=7)
                if dow == descanso:
                    turnos.append((e["activo_id"], e["punto"], f, 0, 0, "descanso", "publicado" if publicado else "borrador"))
                else:
                    ini, fin = patron
                    if random.random() < 0.15: ini -= 1; fin -= 1
                    if f.weekday() == 6 or festivo(f): ini = max(ini, ap_); fin = min(fin + 1, ci)
                    ini = max(ini, ap_); fin = min(fin, ci)
                    turnos.append((e["activo_id"], e["punto"], f, ini, fin, "programado", "publicado" if publicado else "borrador"))
                    if f < HOY:
                        r = random.random()
                        if r < 0.96:   # marcó
                            dent = random.random() < 0.94
                            dist = random.randint(5, t[9]) if dent else random.randint(t[9] + 20, 600)
                            dmin = random.randint(-8, 12) if random.random() < 0.85 else random.randint(13, 40)
                            ts_e = dt.datetime.combine(f, dt.time(0)) + dt.timedelta(hours=ini, minutes=dmin)
                            ts_s = dt.datetime.combine(f, dt.time(0)) + dt.timedelta(hours=fin, minutes=random.randint(-10, 25))
                            est = "aprobada" if dent and f < lun else "registrada"
                            for tipo, ts, d_ in (("entrada", ts_e, dist), ("salida", ts_s, random.randint(5, t[9]))):
                                marcs.append((e["activo_id"], e["punto"], ts.isoformat() + "-05:00", tipo, t[7] + random.uniform(-0.001, 0.001), t[8] + random.uniform(-0.001, 0.001), random.randint(8, 40), d_, d_ <= t[9], "selfie", psycopg2.Binary(SELFIE), est if tipo == "entrada" else ("aprobada" if f < lun else "registrada")))
            f += dt.timedelta(days=1)
    execute_values(cur, "INSERT INTO rrhh_turnos (empleado_id,tienda_id,fecha,inicio,fin,tipo,estado) VALUES %s", turnos)
    execute_values(cur, "INSERT INTO rrhh_marcaciones (empleado_id,tienda_id,ts,tipo,lat,lng,precision_m,distancia_m,dentro,metodo,selfie,estado) VALUES %s", marcs, page_size=500)
    # solicitudes
    sol = []
    col = [e for e in emps if e["rol"] != "rrhh"]
    for e in random.sample(col, 12):
        tipo = random.choice(["Vacaciones","Cita médica","Incapacidad","Calamidad doméstica","Licencia de luto","Permiso no remunerado"])
        d0 = HOY + dt.timedelta(days=random.randint(-30, 20)); d1 = d0 + dt.timedelta(days={"Vacaciones":7,"Licencia de luto":4,"Incapacidad":2}.get(tipo, 0))
        estado = "pendiente" if d0 > HOY and random.random() < 0.6 else random.choice(["aprobado","aprobado","rechazado"])
        hab = sum(1 for i in range((d1-d0).days+1) if (d0+dt.timedelta(days=i)).weekday() != 6)
        sol.append((e["activo_id"], tipo, d0, d1, hab, random.choice(["", "Programado con el administrador", "Control médico", "Trámite personal"]), "soporte.pdf" if tipo in ("Incapacidad","Cita médica") else None, estado, "rrhh0@manelfoods.co" if estado != "pendiente" else None, e["email"]))
    execute_values(cur, "INSERT INTO rrhh_solicitudes (empleado_id,tipo,desde,hasta,dias_habiles,motivo,soporte_nombre,estado,decidido_por,creado_por) VALUES %s", sol)
    corte = dt.date(2026, 9, 30)
    execute_values(cur, "INSERT INTO rrhh_saldos_iniciales (empleado_id,corte,vacaciones_dias) VALUES %s", [(e["activo_id"], corte, round(random.uniform(0, 14), 1)) for e in emps])
    # novedades y quincena aprobada (la anterior a la última cerrada)
    q_ult = dt.date(HOY.year, HOY.month, 1) if HOY.day > 15 else (dt.date(HOY.year, HOY.month, 1) - dt.timedelta(days=1)).replace(day=16)
    q_prev = (q_ult - dt.timedelta(days=1)).replace(day=1) if q_ult.day == 16 else (q_ult - dt.timedelta(days=1)).replace(day=16)
    nov = []
    for e in random.sample(col, 6):
        nov.append((e["activo_id"], q_ult, random.choice(["prestamo","descuento","bonificacion"]), "cuota 2/6", random.choice([-100000, -50000, 150000]), "rrhh0@manelfoods.co"))
    execute_values(cur, "INSERT INTO rrhh_novedades (empleado_id,quincena,tipo,descripcion,valor,creado_por) VALUES %s", nov)
    q_prev_fin = (q_prev.replace(day=15) if q_prev.day == 1 else (q_prev.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1))
    cur.execute("INSERT INTO rrhh_quincenas (desde,hasta,estado,aprobada_por,aprobada_en,total_neto,total_costo,snapshot) VALUES (%s,%s,'aprobada','dzuluaga@manelfoods.com',now(),%s,%s,%s)", (q_prev, q_prev_fin, 37_000_000, 55_000_000, Json([])))
    m_prev = (HOY.replace(day=1) - dt.timedelta(days=1))
    for (tid, *_r, activa) in TIENDAS:
        if not activa: continue
        cur.execute("INSERT INTO rrhh_incentivo_mes (tienda_id,anio,mes,indicadores,metas,estado) VALUES (%s,%s,%s,%s,%s,'abierto')", (tid, m_prev.year, m_prev.month, Json({"rappi_recompra": True, "rappi_espera": random.random()<.6, "rappi_reclamos": True, "rappi_online": random.random()<.5, "rappi_cancel": True, "op_inventario": True, "op_caja": random.random()<.7, "op_mermas": random.random()<.5, "servicio": {}}), Json({"n1":60000000,"n2":80000000,"n3":100000000,"b1":100000,"b2":175000,"b3":250000,"ventaMes": random.choice([45,62,78,91,105])*1_000_000})))
    cur.execute("INSERT INTO rrhh_eventos (entidad,accion,detalle,actor) VALUES ('siembra','sembrar',%s,'sistema')", (Json({"empleados": len(emps), "turnos": len(turnos), "marcaciones": len(marcs)}),))
    print(f"empleados={len(emps)} turnos={len(turnos)} marcaciones={len(marcs)} solicitudes={len(sol)} quincena_aprobada={q_prev}")
    if a.aplicar: conn.commit(); print("APLICADO")
    else: conn.rollback(); print("ensayo (rollback); usa --aplicar")

if __name__ == "__main__": main()
