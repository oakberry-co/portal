// Códigos ACH Colombia + mapeos para armar el archivo del banco (CSV).
// La tabla de códigos viene de la plantilla de pagos de Rappi (columna oculta
// "CÓDIGO DE BANCO"). El maestro de cuentas del proveedor guarda el NOMBRE del
// banco; aquí resolvemos su código. Si el banco no matchea, el código va vacío
// (la persona lo completa en el archivo).

export const BANCOS: { codigo: string; nombre: string }[] = [
  { codigo: "001", nombre: "BANCO DE BOGOTÁ" },
  { codigo: "002", nombre: "BANCO POPULAR" },
  { codigo: "006", nombre: "BANCO ITAU CORPBANCA COLOMBIA" },
  { codigo: "007", nombre: "BANCOLOMBIA" },
  { codigo: "009", nombre: "BANCO CITIBANK COLOMBIA" },
  { codigo: "012", nombre: "BANCO GNB SUDAMERIS" },
  { codigo: "013", nombre: "BBVA COLOMBIA" },
  { codigo: "014", nombre: "ITAU" },
  { codigo: "019", nombre: "DAVIbank S.A" },
  { codigo: "023", nombre: "BANCO DE OCCIDENTE" },
  { codigo: "024", nombre: "FINANCIERA COMULTRASAN" },
  { codigo: "031", nombre: "BANCO BANCOLDEX" },
  { codigo: "032", nombre: "CAJA SOCIAL" },
  { codigo: "040", nombre: "BANCO AGRARIO DE COLOMBIA" },
  { codigo: "047", nombre: "BANCO MUNDO MUJER" },
  { codigo: "051", nombre: "BANCO DAVIVIENDA" },
  { codigo: "052", nombre: "BANCO AV VILLAS" },
  { codigo: "053", nombre: "BANCO W" },
  { codigo: "059", nombre: "BANCAMIA" },
  { codigo: "060", nombre: "BANCO PICHINCHA" },
  { codigo: "061", nombre: "BANCOOMEVA" },
  { codigo: "062", nombre: "BANCO FALABELLA" },
  { codigo: "065", nombre: "BANCO SANTANDER DE NEGOCIOS COLOMBIA" },
  { codigo: "066", nombre: "BANCO COOPERATIVO COOPCENTRAL" },
  { codigo: "067", nombre: "MIBANCO" },
  { codigo: "069", nombre: "BANCO SERFINANZA S.A." },
  { codigo: "070", nombre: "LULO BANK S.A." },
  { codigo: "071", nombre: "BANCO JP MORGAN COLOMBIA S.A" },
  { codigo: "121", nombre: "FINANCIERA JURISCOOP" },
  { codigo: "246", nombre: "CREDISERVIR" },
  { codigo: "283", nombre: "COOPERATIVA FINANCIERA ANTIOQUIA" },
  { codigo: "286", nombre: "JFK COOPERATIVA FINANCIERA" },
  { codigo: "289", nombre: "COTRAFA FINANCIERA" },
  { codigo: "291", nombre: "COOFINEP" },
  { codigo: "292", nombre: "CONFIAR" },
  { codigo: "303", nombre: "BANCO UNION" },
  { codigo: "370", nombre: "COLTEFINANCIERA" },
  { codigo: "507", nombre: "NEQUI" },
  { codigo: "551", nombre: "DAVIPLATA" },
  { codigo: "558", nombre: "BAN100" },
  { codigo: "560", nombre: "PIBANK" },
  { codigo: "637", nombre: "IRIS" },
  { codigo: "801", nombre: "MOVII" },
  { codigo: "802", nombre: "DING TECNIPAGOS S.A." },
  { codigo: "803", nombre: "POWWI" },
  { codigo: "804", nombre: "UALA" },
  { codigo: "805", nombre: "BANCO BTG PACTUAL" },
  { codigo: "808", nombre: "Bold CF" },
  { codigo: "809", nombre: "NU" },
  { codigo: "811", nombre: "RAPPIPAY" },
  { codigo: "812", nombre: "COINK" },
  { codigo: "814", nombre: "GLOBAL66" },
  { codigo: "819", nombre: "BANCO CONTACTAR" },
  { codigo: "979", nombre: "CFA COOPERATIVA FINANCIERA DE ANTIOQUIA" },
  { codigo: "980", nombre: "HOLDING RAPPIPAY SAS" },
  { codigo: "981", nombre: "PRESENTE FONDO DE EMPLEADOS ALMACENES EXITO" },
  { codigo: "983", nombre: "MICROEMPRESAS DE COLOMBIA" },
  { codigo: "984", nombre: "COOPETROL" },
  { codigo: "985", nombre: "CONGENTE" },
  { codigo: "986", nombre: "COOTRAPELDAR" },
  { codigo: "987", nombre: "COOPANTEX" },
  { codigo: "988", nombre: "COONFIE" },
  { codigo: "990", nombre: "UTRAHUILCA" },
  { codigo: "991", nombre: "COOPLAROSA" },
  { codigo: "992", nombre: "SERVIMCOOP" },
  { codigo: "993", nombre: "COOPTENJO" },
  { codigo: "994", nombre: "COOGRANADA" },
  { codigo: "995", nombre: "COOPERATIVA AVANZA" },
  { codigo: "996", nombre: "COOFISAM" },
  { codigo: "997", nombre: "COOMULDESA" },
  { codigo: "998", nombre: "COAGROSUR" },
  { codigo: "999", nombre: "COOPERAMOS" },
];

const norm = (s: string) =>
  s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();

const BY_NORM = new Map(BANCOS.map((b) => [norm(b.nombre), b.codigo]));

/** Nombre del banco → código ACH. Exacto y si no, por contención (BANCOLOMBIA
 *  matchea "BANCO BANCOLOMBIA", DAVIVIENDA matchea "BANCO DAVIVIENDA", etc.). */
export function codigoBanco(nombre: string | null | undefined): string {
  if (!nombre) return "";
  const n = norm(nombre);
  if (!n) return "";
  if (BY_NORM.has(n)) return BY_NORM.get(n)!;
  let best = "";
  for (const b of BANCOS) {
    const bn = norm(b.nombre);
    if (n === bn) return b.codigo;
    if (n.includes(bn) || bn.includes(n)) { if (!best) best = b.codigo; }
  }
  return best;
}

// Tabla OFICIAL de Davivienda ("Código canales", entregada por el equipo). Banco
// (nombre) → código canales. Davivienda no viene en la tabla (es el pagador); se
// agrega 51 para destinos Davivienda. Fuente: Sheet de códigos Davivienda.
const DAVIVIENDA: { codigo: string; nombre: string }[] = [
  { codigo: "1", nombre: "Banco de Bogotá" },
  { codigo: "2", nombre: "Banco Popular" },
  { codigo: "6", nombre: "Itaú (antes corpbanca)" },
  { codigo: "7", nombre: "Bancolombia" },
  { codigo: "9", nombre: "Citibank" },
  { codigo: "12", nombre: "Banco GNB Sudameris" },
  { codigo: "13", nombre: "BBVA Colombia" },
  { codigo: "14", nombre: "Itaú (Helm bank)" },
  { codigo: "19", nombre: "Scotiabank Colpatria" },
  { codigo: "23", nombre: "Banco de Occidente" },
  { codigo: "31", nombre: "Bancóldex" },
  { codigo: "32", nombre: "Banco Caja Social BCSC" },
  { codigo: "40", nombre: "Banco Agrario" },
  { codigo: "42", nombre: "Banco BNP Paribas" },
  { codigo: "47", nombre: "Banco Mundo Mujer" },
  { codigo: "52", nombre: "Banco AV Villas" },
  { codigo: "53", nombre: "Banco W" },
  { codigo: "59", nombre: "Bancamia" },
  { codigo: "60", nombre: "Banco Pichincha" },
  { codigo: "61", nombre: "Bancoomeva" },
  { codigo: "62", nombre: "Banco Falabella" },
  { codigo: "63", nombre: "Banco Finandina" },
  { codigo: "64", nombre: "Banco Multibank" },
  { codigo: "65", nombre: "Banco Santander de Negocios Colombia" },
  { codigo: "66", nombre: "Banco Cooperativo Coopcentral" },
  { codigo: "67", nombre: "Mibanco" },
  { codigo: "69", nombre: "Banco Serfinanza" },
  { codigo: "71", nombre: "Banco J.P. Morgan Colombia" },
  { codigo: "121", nombre: "Financiera Juriscoop" },
  { codigo: "151", nombre: "Rappipay Daviplata" },
  { codigo: "283", nombre: "Cooperativa Financiera de Antioquia CFA" },
  { codigo: "289", nombre: "Cootrafa Cooperativa Financiera" },
  { codigo: "291", nombre: "Cofinep Cooperativa Financiera" },
  { codigo: "292", nombre: "Confiar Cooperativa Financiera" },
  { codigo: "303", nombre: "Banco Unión" },
  { codigo: "370", nombre: "Coltefinanciera" },
  { codigo: "507", nombre: "Nequi" },
  { codigo: "551", nombre: "Daviplata" },
  { codigo: "558", nombre: "BAN100" },
  { codigo: "637", nombre: "IRIS Dann Regional" },
  { codigo: "801", nombre: "Movii" },
  { codigo: "70", nombre: "Lulo Bank" },
  { codigo: "805", nombre: "BTG Pactual" },
  { codigo: "804", nombre: "Uala Bancar tecnologia" },
  { codigo: "802", nombre: "Ding Tecnipagos" },
  { codigo: "286", nombre: "JFK Cooperativa Financiera" },
  { codigo: "560", nombre: "Pibank" },
  { codigo: "803", nombre: "Powwi" },
  { codigo: "811", nombre: "Rappipay" },
  { codigo: "812", nombre: "Coink" },
  { codigo: "813", nombre: "Santander Consumer" },
  { codigo: "814", nombre: "Global66" },
  { codigo: "808", nombre: "Bold CF" },
  { codigo: "819", nombre: "Banco Contactar" },
  { codigo: "809", nombre: "NU" },
  { codigo: "51", nombre: "Davivienda" },
];
const DAVI_BY_NORM = new Map(DAVIVIENDA.map((b) => [norm(b.nombre), b.codigo]));

/** Código del banco para el archivo de DAVIVIENDA = "Código canales" (tabla oficial
 *  arriba). Si el banco no está, cae al ACH sin ceros a la izquierda. */
export function codigoBancoDavivienda(nombre: string | null | undefined): string {
  if (!nombre) return "";
  const n = norm(nombre);
  if (!n) return "";
  if (DAVI_BY_NORM.has(n)) return DAVI_BY_NORM.get(n)!;
  for (const b of DAVIVIENDA) {
    const bn = norm(b.nombre);
    if (n === bn || n.includes(bn) || bn.includes(n)) return b.codigo;
  }
  const c = codigoBanco(nombre);       // fallback: ACH sin ceros
  return c ? String(Number(c)) : "";
}

// Tipo de documento y tipo de cuenta guardados en el maestro (códigos cortos)
// vs. como los quiere cada plantilla del banco.
export const TIPO_DOC_FULL: Record<string, string> = {
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  NIT: "NIT",
  PPT: "Permiso por protección temporal",
};
export const TIPO_CUENTA_FULL: Record<string, string> = {
  ahorros: "CUENTA DE AHORROS",
  corriente: "CUENTA CORRIENTE",
  deposito: "DEPOSITO ELECTRONICO",
};

/** Escapa un valor para CSV (comillas si trae coma, comilla o salto de línea). */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}
