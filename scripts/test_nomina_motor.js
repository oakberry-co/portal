#!/usr/bin/env node
/* eslint-disable */
// CENTINELA DEL MOTOR DE NÓMINA (Regla 14) — funciones PURAS, sin base de datos.
//
// Nace de la revisión del 23-oct-2026 (rama feature/nomina-dian):
//   1. horas extra nunca se calculaban (las horas sobre la jornada se pagaban al 0 %);
//   2. incapacidad sin piso de SMLMV y sin la convención Siigo de días 1-2 al 100 %;
//      auxilio de transporte pagado en días de incapacidad/licencia/vacaciones;
//   3. no había retención en la fuente laboral;
//   4. las prestaciones periódicas (prima, intereses) no entraban a la quincena;
//   5. no había liquidación de aportes PILA;
//   6. el snapshot no traía lo que la nómina electrónica necesita (v2) ni suma de control;
//   +  horasDe contaba de a media hora: 8:15–16:00 daba 8 h en vez de 7,75.
//
//   node scripts/test_nomina_motor.js
//
// Compila lib/rrhh/{fechas,motor,catalogos,retencion,prestaciones,pila,quincena}.ts
// a un directorio temporal (fuera del repo y de node_modules) y los prueba.

const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");

const RAIZ = path.dirname(__dirname);
const fallos = [];
const check = (ok, t, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); if (!ok) fallos.push(t); };
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nomina-motor-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
const MODS = ["fechas", "motor", "catalogos", "retencion", "prestaciones", "pila", "quincena"];
try {
  execFileSync(path.join(RAIZ, "node_modules", ".bin", "tsc"), [...MODS.map((m) => `lib/rrhh/${m}.ts`), "--outDir", tmp,
    "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--esModuleInterop", "--strict"], { cwd: RAIZ, stdio: "pipe" });
} catch (e) {
  console.error("No compiló:\n" + (e.stdout || e.message)); process.exit(1);
}
const M = Object.fromEntries(MODS.map((m) => [m, require(path.join(tmp, m + ".js"))]));
const { motor, fechas, retencion, prestaciones, pila, quincena } = M;

const SMLMV = 1_750_905, AUX = 249_095;
const T = (id, fecha, inicio, fin, alm = 0, tipo = "programado") => ({ id, empleadoId: 1, tiendaId: "X", fecha, inicio, fin, tipo, almuerzoMin: alm });

// ---------------------------------------------------------------------------
console.log("\n0. Convención de 30 días");
check(fechas.dias30("2026-01-16", "2026-01-31") === 15, "16–31 enero = 15");
check(fechas.dias30("2026-02-16", "2026-02-28") === 15, "16–28 febrero = 15");
check(fechas.dias30("2026-01-01", "2026-06-30") === 180, "semestre = 180");
check(fechas.dias30("2026-01-01", "2026-12-31") === 360, "año = 360");

// ---------------------------------------------------------------------------
console.log("\n1. Horas extra por semana (jornada 42, sem. 2026-10-19 lun … 25 dom)");
{
  // lun–sáb 8:00–16:00 sin almuerzo = 6 × 8 = 48 h → 6 h extra, las ÚLTIMAS (sábado)
  const ts = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((f, i) => T(i, f, 8, 16));
  const r = motor.horasConExtras(ts, 42);
  check(r.horas.ordinaria === 42 && r.horas.extra_diurna === 6, "48 h → 42 ordinarias + 6 extra diurnas", JSON.stringify({ o: r.horas.ordinaria, x: r.horas.extra_diurna }));
  check(r.extrasPorDia["2026-10-24"] === 6 && !r.extrasPorDia["2026-10-23"], "las extra caen en el último día (sábado)");
  check(r.alertas.some((a) => a.includes("2026-10-24") && a.includes("2 h")), "alerta > 2 h extra en el día", r.alertas.join(" | "));
  // misma semana con el sábado de 14:00 a 22:00: las últimas 6 h = 14-16..? → 16:00-19:00 diurnas (3h) y 19:00-22:00 nocturnas (3h)
  const ts2 = [...ts.slice(0, 5), T(9, "2026-10-24", 14, 22)];
  const r2 = motor.horasConExtras(ts2, 42);
  check(r2.horas.extra_nocturna === 3 && r2.horas.extra_diurna === 3 && r2.horas.nocturna === 0, "sábado 14–22: últimas 6 h = 3 extra diurnas + 3 extra nocturnas", JSON.stringify(r2.horas));
  // domingo trabajado que cruza el límite → extra dominical
  const ts3 = [...ts.slice(0, 5), T(10, "2026-10-25", 9, 15)];      // 40 + 6 = 46 → 4 extra el domingo
  const r3 = motor.horasConExtras(ts3, 42);
  check(r3.horas.extra_dominical === 4 && r3.horas.dominical === 2, "domingo cruza el límite: 2 dominicales + 4 extra dominicales", JSON.stringify({ d: r3.horas.dominical, xd: r3.horas.extra_dominical }));
  // festivo (2026-10-12 lunes festivo) al final de la semana anterior no; festivo noche
  const sem12 = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((f, i) => T(20 + i, f, 8, 16)); // mar–sáb 40 h
  const r4 = motor.horasConExtras([...sem12, T(30, "2026-10-11", 15, 21)], 42);  // domingo 15–21: 6 h → 4 extra (2 diurnas dom + 2 nocturnas dom)
  check(r4.horas.extra_nocturna_dominical === 2 && r4.horas.extra_dominical === 2, "domingo 15–21 con 40 h previas: 2 extra dominical diurna + 2 extra nocturna dominical", JSON.stringify(r4.horas));
  // jornada de la PERSONA (medio tiempo 24 h) manda
  const r5 = motor.horasConExtras(ts.slice(0, 4), 24);          // 32 h → 8 extra
  check(r5.horas.extra_diurna === 8, "jornada pactada 24 h: 32 h → 8 extra");
  // la jornada nunca pasa la máxima legal (44 en la ficha, 42 legal desde jul-2026)
  check(motor.horasConExtras(ts, 44).horas.extra_diurna === 6, "ficha 44 h en sem. de oct-2026: límite legal 42 → 6 extra");
  // la semana se acumula desde el lunes aunque la quincena empiece el jueves
  const r6 = motor.horasConExtras(ts, 42, "2026-10-22");
  check(r6.horas.extra_diurna === 6 && r6.horas.ordinaria === 18, "período desde el jueves: cuenta solo jue–sáb, con el acumulado de lun–mié (18 ord + 6 extra)", JSON.stringify({ o: r6.horas.ordinaria, x: r6.horas.extra_diurna }));
  // > 12 h extra en la semana
  const largas = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((f, i) => T(40 + i, f, 8, 18)); // 60 h → 18 extra
  check(motor.horasConExtras(largas, 42).alertas.some((a) => a.startsWith("semana del 2026-10-19")), "alerta > 12 h extra en la semana");
  // sin jornada → error ruidoso (R6)
  check(!!lanza(() => motor.jornadaDe({ activo_id: 7 })), "empleado sin jornada_semanal → error");
  check(!!lanza(() => motor.horasConExtras(ts, 0)), "jornada 0 → error");
  // almuerzo no se come las extras
  const conAlm = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((f, i) => T(50 + i, f, 8, 17, 60)); // 8 h netas
  check(motor.horasConExtras(conAlm, 42).horas.extra_diurna === 6, "con 1 h de almuerzo diario: 48 h netas → 6 extra");
}
console.log("\n1b. horasDe al cuarto de hora (bug de media hora)");
check(motor.totalTrabajadas(motor.horasDe(T(1, "2026-10-20", 8.25, 16))) === 7.75, "8:15–16:00 = 7,75 h (antes 8)");
check(motor.horasDe(T(1, "2026-10-20", 14, 22)).nocturna === 3, "14–22 → 3 h nocturnas (desde 19:00)");

console.log("\n1c. costoDe paga las extra (recargo 25 %) y expone la base aparte");
{
  const e = { activo_id: 1, nombre_completo: "X", punto: "X", cargo: "", salario: SMLMV, auxilio_transporte: true, fecha_ingreso: "2025-01-01", tipo_contrato: "", eps: "", afp: "", arl: "", ccf: "", jornada_semanal: 42 };
  const ts = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((f, i) => T(i, f, 8, 16));
  const c = motor.costoDe(e, ts, "2026-10-31");
  const vh = Math.round(SMLMV / 210);
  check(c.extrasBase === 6 * vh && c.recargoPorTipo.extra_diurna === Math.round(6 * vh * 0.25), `6 h extra: base ${6 * vh} + recargo ${Math.round(6 * vh * 0.25)}`, JSON.stringify({ b: c.extrasBase, r: c.recargoPorTipo.extra_diurna }));
}

// ---------------------------------------------------------------------------
console.log("\n2. Incapacidad: piso SMLMV, días 1-2 al 100 %, origen laboral, auxilio");
const R = motor.reglasNomina("2026-10-31");
const PREST0 = { prima: null, interesesCesantias: null, cesantiasConsignadas: null, alertas: [] };
const costo0 = () => ({ horas: motor.horasVacias(), recargos: 0, extrasBase: 0, basePorTipo: motor.horasVacias(), recargoPorTipo: motor.horasVacias(), trabajadas: 40 });
const linea = (salario, sols = [], extra = {}) => quincena.lineaQuincena({
  e: { activo_id: 1, nombre_completo: "Prueba", salario, auxilio_transporte: true, fecha_ingreso: "2025-01-01", fecha_retiro: null, ...(extra.e || {}) },
  q: extra.q || { desde: "2026-10-16", hasta: "2026-10-31" }, costo: extra.costo || costo0(), sols, novs: extra.novs || [], r: R,
  prest: extra.prest || PREST0, retencion: extra.retencion || 0, festivos: motor.FESTIVOS,
});
{
  const sol = [{ id: 1, tipo: "Incapacidad", desde: "2026-10-16", hasta: "2026-10-25" }];   // 10 días
  const min = linea(SMLMV, sol);
  check(min.descInc === 0, "salario mínimo, 10 días de incapacidad común → descuento 0 (piso SMLMV)", `descInc=${min.descInc}`);
  const alto = linea(3_000_000, sol);
  const sd = 3_000_000 / 30;
  const esperado = Math.round(sd * 10) - Math.round(2 * sd + 8 * Math.max(sd * 0.6667, SMLMV / 30));
  check(alto.descInc === esperado, `$3 MM: días 1-2 al 100 %, 3-10 al 66,67 % → descuento ${esperado}`, `descInc=${alto.descInc}`);
  // antes: 10 × salario/30 × 33,33 % = 333.300 (sobre los 10 días)
  check(alto.descInc < Math.round(10 * sd * 0.3333), "descuenta menos que el 33,33 % plano de antes");
  const lab = linea(3_000_000, [{ id: 2, tipo: "Incapacidad laboral", desde: "2026-10-16", hasta: "2026-10-25" }]);
  check(lab.descInc === 0, "incapacidad laboral (ARL) → 100 %, descuento 0");
  // día 1-2 se cuentan desde el inicio de la solicitud, aunque haya empezado la quincena anterior
  const cruza = linea(3_000_000, [{ id: 3, tipo: "Incapacidad", desde: "2026-10-14", hasta: "2026-10-17" }]);
  check(cruza.descInc === Math.round(2 * sd) - Math.round(2 * Math.max(sd * 0.6667, SMLMV / 30)), "incapacidad desde el 14: el 16 y 17 ya son días 3-4 (66,67 %)", `descInc=${cruza.descInc}`);
  // auxilio de transporte: 10 días sin derecho → 5/30 del auxilio
  check(min.auxilio === Math.round(AUX * 5 / 30) && min.diasAux === 5, "auxilio solo por los 5 días con derecho", `aux=${min.auxilio}`);
  check(linea(SMLMV).auxilio === Math.round(AUX * 15 / 30), "sin ausencias: auxilio de media quincena completo");
  const vac = linea(SMLMV, [{ id: 4, tipo: "Vacaciones", desde: "2026-10-19", hasta: "2026-10-31" }]);
  check(vac.diasAux === 3 && vac.descuentos === 0, "vacaciones: se pagan completas pero sin auxilio esos días", `diasAux=${vac.diasAux}`);
  check(!!lanza(() => linea(SMLMV, [{ id: 5, tipo: "Otro raro", desde: "2026-10-19", hasta: "2026-10-19" }])), "tipo de ausencia fuera del catálogo → error (R6)");
  const sol2 = linea(SMLMV, [{ id: 6, tipo: "Vacaciones", desde: "2026-10-19", hasta: "2026-10-23" }, { id: 7, tipo: "Incapacidad", desde: "2026-10-22", hasta: "2026-10-23" }]);
  check(sol2.ausencias.reduce((a, x) => a + x.dias, 0) === 5 && sol2.alertas.some((a) => a.includes("solapa")), "dos ausencias el mismo día: cuenta una vez y avisa");
  // 30 de convención: 16–31 = 15 días; básico = salario/2
  check(linea(SMLMV).basico === Math.round(SMLMV / 2) && linea(SMLMV).diasPagados === 15, "quincena completa = 15 días = salario/2");
  check(linea(SMLMV, [], { e: { fecha_ingreso: "2026-10-26" } }).diasPagados === 5, "ingreso el 26 de oct: 26–30 = 5 días (el 31 no suma)");
}

// ---------------------------------------------------------------------------
console.log("\n3. Retención en la fuente (proc. 1, art. 383 ET)");
{
  const uvt = motor.uvtDe("2026-10-31");
  check(uvt === 52374, "UVT 2026 = 52.374");
  check(!!lanza(() => motor.uvtDe("2027-01-31")), "sin fila de REGLAS 2027 → error, no usa la UVT 2026");
  // salario mínimo + auxilio, mes completo
  const min = retencion.retencionMensual({ pagosLaborales: SMLMV + AUX, aportesObligatorios: Math.round(SMLMV * 0.08), uvt });
  check(min.retencion === 0, "salario mínimo → 0", JSON.stringify(min));
  // el salario más alto de hoy en el maestro está muy por debajo; probamos 4 MM
  check(retencion.retencionMensual({ pagosLaborales: 4_000_000, aportesObligatorios: 320_000, uvt }).retencion === 0, "$4 MM → 0 (base < 95 UVT)");
  // salario alto: 20 MM
  const alto = retencion.retencionMensual({ pagosLaborales: 20_000_000, aportesObligatorios: 800_000 + 800_000 + 200_000, uvt });
  // ingreso neto 18,2 MM; 25 % = 4,55 MM > tope 790 UVT/12 = 3.447.955 → exenta 3.447.955; 40 % = 7,28 MM y 1340/12 UVT = 5.848.430: no recorta
  const exenta = 790 * uvt / 12, base = 18_200_000 - exenta, bu = base / uvt;
  const imp = (bu - 150) * 0.28 + 10;     // 281,67 UVT → tramo 150–360
  check(alto.retencion === Math.round(imp * uvt / 1000) * 1000 && alto.retencion > 0, `$20 MM → ${alto.retencion} (> 0)`, JSON.stringify(alto));
  check(alto.exenta25 === Math.round(exenta), "exenta 25 % topada en 790 UVT/año ÷ 12");
  // tope global del 40 %: deducciones grandes recortan
  const tope = retencion.retencionMensual({ pagosLaborales: 10_000_000, aportesObligatorios: 900_000, uvt, deducciones: 3_000_000 });
  check(tope.recortadoPorTope && tope.beneficios === Math.round(Math.min(9_100_000 * 0.4, 1340 * uvt / 12)), "deducciones + 25 % sobre el 40 % → se recortan al tope", JSON.stringify(tope));
  check(retencion.redondeoRetencion(123_499) === 123_000 && retencion.redondeoRetencion(123_500) === 124_000, "redondeo al múltiplo de 1.000 más cercano");
  check(!!lanza(() => retencion.retencionMensual({ pagosLaborales: 1, aportesObligatorios: 0, uvt: 0 })), "sin UVT → error");
}

// ---------------------------------------------------------------------------
console.log("\n4. Prestaciones");
{
  const e = { activo_id: 1, salario: SMLMV, auxilio_transporte: true, fecha_ingreso: "2025-03-01", fecha_retiro: null };
  const r = { smlmv: SMLMV, auxilio: AUX };
  const p = prestaciones.prestacionesDeQuincena(e, { desde: "2026-06-16", hasta: "2026-06-30" }, r, r);
  check(p.prima && p.prima.pago === Math.round((SMLMV + AUX) / 2) && p.prima.dias === 180, "prima de un semestre completo = (salario + auxilio) ÷ 2", JSON.stringify(p.prima));
  const pd = prestaciones.prestacionesDeQuincena(e, { desde: "2026-12-01", hasta: "2026-12-15" }, r, r);
  check(pd.prima && pd.prima.dias === 180, "prima de diciembre en la 1ª quincena, por el semestre completo");
  check(!prestaciones.prestacionesDeQuincena(e, { desde: "2026-06-01", hasta: "2026-06-15" }, r, r).prima, "1ª de junio: no hay prima");
  const nuevo = prestaciones.prestacionesDeQuincena({ ...e, fecha_ingreso: "2026-04-01" }, { desde: "2026-06-16", hasta: "2026-06-30" }, r, r);
  check(nuevo.prima.dias === 90 && nuevo.prima.pago === Math.round((SMLMV + AUX) * 90 / 360), "ingresó el 1-abr → 90 días de prima");
  const ret = prestaciones.prestacionesDeQuincena({ ...e, fecha_retiro: "2026-06-20" }, { desde: "2026-06-16", hasta: "2026-06-30" }, r, r);
  check(!ret.prima && ret.alertas.length === 1, "se retira en el semestre → la prima va en la liquidación");
  const ene = prestaciones.prestacionesDeQuincena(e, { desde: "2027-01-16", hasta: "2027-01-31" }, r, r);
  const ces = Math.round(SMLMV + AUX);
  check(ene.interesesCesantias && ene.interesesCesantias.pago === Math.round(ces * 0.12), "intereses de cesantías del año completo = 12 % en la 2ª de enero", JSON.stringify(ene.interesesCesantias));
  const feb = prestaciones.prestacionesDeQuincena(e, { desde: "2027-02-01", hasta: "2027-02-15" }, r, r);
  check(feb.cesantiasConsignadas && feb.cesantiasConsignadas.pago === ces, "cesantías del año anterior registradas en la 1ª de febrero");
  // fuera del neto: la línea no las suma
  const conCes = linea(SMLMV, [], { prest: feb });
  check(conCes.neto === linea(SMLMV).neto && conCes.cesantiasConsignadas === ces, "cesantías consignadas NO cambian el neto (van al fondo)");
  const conPrima = linea(SMLMV, [], { prest: p, q: { desde: "2026-06-16", hasta: "2026-06-30" } });
  check(conPrima.neto - linea(SMLMV, [], { q: { desde: "2026-06-16", hasta: "2026-06-30" } }).neto === p.prima.pago, "la prima suma al neto y no al IBC");
  check(prestaciones.basePrestacional({ salario: 4_000_000, auxilio_transporte: true }, r) === 4_000_000, "sobre 2 SMLMV la base no lleva auxilio aunque la ficha lo marque");
  check(prestaciones.vacacionesProporcionales(SMLMV, 360) === Math.round(SMLMV / 2), "vacaciones de un año = 15 días de salario");
}

// ---------------------------------------------------------------------------
console.log("\n5. PILA");
{
  const min = pila.aportesPila({ empleadoId: 1, nombre: "a", salario: SMLMV, devengadoSalarial: SMLMV, dias: 30, smlmv: SMLMV });
  check(min.exonerado && min.saludEmp === 0 && min.sena === 0 && min.icbf === 0, "< 10 SMLMV: exonera salud empleador, SENA e ICBF (Ley 1607)");
  check(min.saludTrab === Math.ceil(SMLMV * 0.04 / 100) * 100 && min.saludTrab % 100 === 0, "cotización redondeada al múltiplo de 100 superior", String(min.saludTrab));
  check(min.arl === Math.ceil(SMLMV * 0.00522 / 100) * 100, "ARL clase I 0,522 %");
  const alto = pila.aportesPila({ empleadoId: 2, nombre: "b", salario: 20_000_000, devengadoSalarial: 20_000_000, dias: 30, smlmv: SMLMV });
  check(!alto.exonerado && alto.saludEmp === 1_700_000 && alto.sena === 400_000 && alto.icbf === 600_000, "≥ 10 SMLMV: sí paga salud empleador, SENA, ICBF");
  check(alto.fsp === Math.ceil(20_000_000 * 0.01 / 100) * 100, "FSP 1 % entre 4 y 16 SMLMV");
  const piso = pila.aportesPila({ empleadoId: 3, nombre: "c", salario: SMLMV, devengadoSalarial: 300_000, dias: 15, smlmv: SMLMV });
  check(piso.ibc === Math.ceil(SMLMV / 2), "IBC nunca bajo 1 SMLMV proporcional a los días (al peso superior)", String(piso.ibc));
  check(!!lanza(() => pila.aportesPila({ empleadoId: 4, nombre: "d", salario: SMLMV, devengadoSalarial: SMLMV, dias: 30, smlmv: SMLMV, arlClase: 3 })), "clase ARL sin tarifa cargada → error");
}

// ---------------------------------------------------------------------------
console.log("\n6. Snapshot v2: suma de control");
{
  const vh = Math.round(SMLMV / 210);
  const horas = { ...motor.horasVacias(), ordinaria: 40, nocturna: 4, extra_diurna: 3 };
  const basePor = { ...motor.horasVacias(), ordinaria: 40 * vh, nocturna: 4 * vh, extra_diurna: 3 * vh };
  const recPor = { ...motor.horasVacias(), nocturna: Math.round(4 * vh * 0.35), extra_diurna: Math.round(3 * vh * 0.25) };
  const costo = { horas, recargos: recPor.nocturna + recPor.extra_diurna, extrasBase: 3 * vh, basePorTipo: basePor, recargoPorTipo: recPor, trabajadas: 47 };
  const x = linea(5_000_000, [{ id: 1, tipo: "Incapacidad", desde: "2026-10-20", hasta: "2026-10-24" }, { id: 2, tipo: "Permiso no remunerado", desde: "2026-10-27", hasta: "2026-10-27" }],
    { costo, novs: [{ tipo: "incentivo", descripcion: "oct", valor: 200_000 }, { tipo: "prestamo", descripcion: "cuota", valor: -50_000 }], retencion: 0 });
  const v = x.v2;
  check(v.v === 2 && v.devengado - v.deducciones === v.neto, "devengado − deducciones = neto", `${v.devengado} − ${v.deducciones} = ${v.neto}`);
  check(quincena.validarSnapshotV2(v) === null, "validarSnapshotV2 acepta la línea");
  check(v.horas.extra_diurna.pago === 3 * vh + recPor.extra_diurna && v.horas.nocturna.pago === recPor.nocturna && !v.horas.ordinaria, "extra = hora completa, nocturna = solo recargo, ordinaria no se lista");
  check(v.basico + v.ausencias.reduce((a, z) => a + z.pago + z.descuento, 0) === x.basico, "básico trabajado + ausencias (pago + descuento) = salario de los días");
  check(v.novedades.every((n) => n.valor > 0), "novedades en positivo con su naturaleza");
  check(Object.values(v).every((val) => typeof val !== "number" || Number.isInteger(val)), "todo en pesos enteros");
  const roto = { ...v, neto: v.neto + 1 };
  check(quincena.validarSnapshotV2(roto) !== null, "un neto corrido 1 peso se rechaza");
  check(quincena.validarSnapshotV2({ ...v, devengado: v.devengado + 1, neto: v.neto + 1 }) !== null, "un devengado que no es la suma de conceptos se rechaza");
  // doble corrida idéntica (R9)
  const y = linea(5_000_000, [{ id: 1, tipo: "Incapacidad", desde: "2026-10-20", hasta: "2026-10-24" }, { id: 2, tipo: "Permiso no remunerado", desde: "2026-10-27", hasta: "2026-10-27" }],
    { costo, novs: [{ tipo: "incentivo", descripcion: "oct", valor: 200_000 }, { tipo: "prestamo", descripcion: "cuota", valor: -50_000 }], retencion: 0 });
  check(JSON.stringify(x.v2) === JSON.stringify(y.v2), "doble corrida = mismo snapshot");
  const conRet = linea(30_000_000, [], { retencion: 1_234_000 });
  check(conRet.v2.retencion === 1_234_000 && conRet.v2.devengado - conRet.v2.deducciones === conRet.v2.neto, "con retención: sigue cuadrando");
}

console.log(fallos.length ? `\n❌ ${fallos.length} fallo(s): ${fallos.join(" · ")}` : "\n✅ Todo en orden.");
process.exit(fallos.length ? 1 : 0);
