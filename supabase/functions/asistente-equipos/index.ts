// ══════════════════════════════════════════════════════════════════
// ASISTENTE IA — Edge Function de Supabase (Tecsul S.A.E.)
//
// La app le manda la conversación; esta función se la pasa a Gemini
// junto con la descripción de las tablas. Cuando Gemini necesita datos
// pide una consulta SELECT ("consultar_datos"), la función la corre en
// la base con el usuario que preguntó (ia_consulta: solo lectura, solo
// admin_central) y le devuelve el resultado, hasta que Gemini contesta.
//
// La clave de Gemini vive SOLO acá, como secreto de Supabase
// (GEMINI_API_KEY). Nunca va dentro de la PWA.
//
// Secretos:
//   GEMINI_API_KEY   obligatorio (aistudio.google.com → Get API key)
//   GEMINI_MODELS    opcional: modelos a usar, en orden, separados por coma.
//                    Por defecto los Flash del plan gratuito. Cada modelo
//                    tiene su propio límite: si uno se agota (429) o está
//                    saturado (503), la pregunta se responde con el siguiente.
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';

const CLAVE = Deno.env.get('GEMINI_API_KEY') ?? '';
const POR_DEFECTO = 'gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';
const MODELOS = [...new Set((Deno.env.get('GEMINI_MODELS') ||
  [Deno.env.get('GEMINI_MODEL') || '', POR_DEFECTO].join(','))
  .split(',').map((m) => m.trim()).filter(Boolean))];
// Hasta cuándo no conviene usar cada modelo (mientras la función siga "caliente")
const agotadoHasta: Record<string, number> = {};
const BASE = Deno.env.get('GEMINI_BASE') || 'https://generativelanguage.googleapis.com';   // solo para pruebas
const MAX_VUELTAS = 8;          // consultas que puede encadenar por pregunta
const MAX_CARACTERES = 30000;   // lo que se le muestra de cada resultado

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

const HERRAMIENTAS = [{
  functionDeclarations: [{
    name: 'consultar_datos',
    description: 'Ejecuta UNA consulta SELECT de PostgreSQL sobre la base de Tecsul y devuelve las filas (máximo 300). ' +
      'Usala siempre que necesites un dato; agregá con GROUP BY / SUM / COUNT en vez de traer filas sueltas.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Una sola consulta SELECT (o WITH … SELECT), sin punto y coma.' },
        motivo: { type: 'string', description: 'Para qué se hace la consulta, en pocas palabras.' },
      },
      required: ['sql'],
    },
  }],
}];

function instrucciones(esquema: { tabla: string; columnas: string }[]): string {
  const hoy = new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', dateStyle: 'full' }).format(new Date());
  const fechaIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
  return `Sos el asistente de datos de Tecsul S.A.E., empresa paraguaya de construcción vial. Ayudás a la gerencia a
analizar el uso de la maquinaria, el taller, el combustible, el mantenimiento y los alquileres de equipos.
Hoy es ${hoy} (${fechaIso}), zona horaria America/Asuncion.

REGLAS
- Todo número que digas tiene que salir de consultar_datos. Nunca inventes datos ni supongas valores.
- Escribí SQL de PostgreSQL. Solo SELECT. Agregá en SQL (SUM, COUNT, AVG, GROUP BY) y limitá filas; el resultado se corta en 300 filas.
- Si la pregunta no dice el período, usá el mes en curso y aclaralo. Si es ambigua, elegí la interpretación más razonable y decila.
- Si una consulta da error, corregila y probá de nuevo.
- Hacé la menor cantidad de consultas posible: preferí UNA consulta que traiga todo lo necesario (con JOIN y GROUP BY).
- Si una consulta bien armada devuelve 0 filas, como mucho verificá UNA vez (por ejemplo, que el código del equipo exista) y respondé que no hay registros. No busques el dato en otras columnas de texto ni pruebes muchas variantes.
- Respondé en español de Paraguay, claro y breve: primero la conclusión, después el detalle. Usá tablas en markdown
  para listas de más de 3 elementos. Montos en guaraníes con punto de miles (Gs 1.250.000). Fechas DD/MM/AAAA.
- Si algo no se puede responder con estas tablas, decilo y sugerí qué dato faltaría. No tenés acceso a Power BI:
  los datos de Power BI del parte diario salen de estas mismas tablas.

QUÉ SIGNIFICA CADA COSA
- partes: un parte diario por equipo, operador y turno. fecha (date); equipo_id (código, ej. CV-14); operador_cedula
  (join operadores.cedula); obra_clave (join obras.clave); horas_horometro = horas que trabajó la máquina según horómetro
  (si es null usar horas_horometro_reportada); horas_hombre = horas del operador; km_recorridos; tiene_falla (boolean);
  actividad_dia, detalle_actividad; origen ('jotform' = histórico, 'pwa' = app). v_resumen_mensual ya resume por mes.
- equipos: id = código; descripcion; tipo; marca; categoria ('equipo','vehiculo_liviano','tanque','contenedor','bascula');
  propiedad 'Propio' o 'Tercero' (los de terceros NO son flota propia); activo; consumo_nominal / consumo_promedio_lh (L/h).
- v_flota: estado actual de cada equipo: estado ('Operativo','Fallando','Inoperativo'), disponibilidad, asignacion,
  ubicacion, dias_en_taller, ultimo_horometro, ultimo_parte_fecha. equipo_estado_historial: cambios de estado.
- v_ot: órdenes de trabajo de taller (numero, estado 'Solicitada','Abierta','Cerrada','Anulada', equipo_id, nombre,
  fallas, abierta_el, fecha_cierre, dias, atrasada, registros, horas_trabajo). v_ot_horas: horas por técnico/sistema.
  ot_registros + ot_registro_items: cada carga del mecánico.
- combustible_movimientos: actividad ('Despacho de combustible','Ingreso de combustible','Medición de tanque',
  'Prueba de desviación'); litros (despachados), litros_ingresados, stock_medido; tanque_salida_id; equipo_id = quien
  recibe (si es un tanque es traspaso); receptor_texto = tercero; horometro; fecha; obra_clave; insumo.
  v_stock_tanques: stock estimado por tanque. v_combustible_consumo: litros/hora por equipo y mes vs referencia
  (desvio_pct). v_combustible_conciliacion: despacho vs lo declarado en el parte. v_combustible_anomalias.
- v_mantenimiento_plan: plan de service por equipo (ciclo 250/500/750/1.000 h; proximo_nivel, horas_restantes,
  semaforo 'VENCIDO','PRÓXIMO','OK','SIN DATOS'). mantenimientos: services y reparaciones hechos (tipo, nivel, fecha).
- v_alertas_flota: vencimientos (Dinatran, municipal, seguros), mantenimiento y taller demorado.
- v_alquiler_liquidacion: alquiler de equipos a terceros por mes (horas_trabajadas, horas_facturables, monto_gs,
  estado_facturacion). alquiler_contratos, alquiler_equipos. seguros: pólizas (vencimiento, compania, costo_total).
- tarifas_equipos: maestro de tarifas por hora de Unysoft (equipo_id, unidad_negocio = left(obras.codigo,5)||'00000',
  fecha_hasta, tarifa1 = Gs por hora). Para costos de máquinas por obra usá la función ya armada:
  SELECT * FROM certificado_maquinas('AAAA-MM-DD','AAAA-MM-DD', null) (o la clave de una obra en vez de null):
  devuelve obra, equipo, horas, tarifa, costo y horas_sin_tarifa.

TABLAS Y COLUMNAS DISPONIBLES
${esquema.map((t) => `- ${t.tabla}(${t.columnas})`).join('\n')}`;
}

// Error de Gemini que se arregla probando con otro modelo (o esperando)
class Reintentable extends Error {
  constructor(msg: string, public espera: number, public diario = false) { super(msg); }
}

// Una pregunta completa con UN modelo: llama a Gemini, corre las
// consultas que pide y repite hasta que contesta.
async function responder(
  // deno-lint-ignore no-explicit-any
  sb: any, modelo: string, mensajes: { rol: string; texto: string }[], sistema: string,
  consultas: { sql: string; motivo?: string; filas?: number; error?: string }[],
): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const contenidos: any[] = mensajes.slice(-14).map((m) => ({
    role: m.rol === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.texto || '').slice(0, 8000) }],
  }));
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const r = await fetch(`${BASE}/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CLAVE },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: contenidos,
        tools: HERRAMIENTAS,
        generationConfig: { temperature: 0.2 },
      }),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = datos?.error?.message || `Gemini respondió ${r.status}`;
      if ([429, 500, 502, 503, 504, 404].includes(r.status)) {
        // deno-lint-ignore no-explicit-any
        const info = (datos?.error?.details || []).find((d: any) => d.retryDelay);
        const espera = info ? parseFloat(info.retryDelay) : (r.status === 429 ? 60 : 30);
        const diario = /per ?day|PerDay|daily/i.test(msg);
        throw new Reintentable(`${modelo}: ${msg}`, r.status === 404 ? 3600 : espera, diario);
      }
      throw new Error(msg);
    }
    const contenido = datos?.candidates?.[0]?.content;
    if (!contenido?.parts?.length) {
      const motivo = datos?.candidates?.[0]?.finishReason;
      return 'Gemini no devolvió respuesta' + (motivo ? ` (${motivo})` : '') + '.';
    }
    contenidos.push(contenido);   // tal cual: conserva las firmas de razonamiento del modelo

    // deno-lint-ignore no-explicit-any
    const llamadas = contenido.parts.filter((p: any) => p.functionCall);
    if (!llamadas.length) {
      // deno-lint-ignore no-explicit-any
      return contenido.parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('').trim();
    }

    // deno-lint-ignore no-explicit-any
    const resultados: any[] = [];
    for (const p of llamadas) {
      const sql = String(p.functionCall.args?.sql ?? '');
      const motivo = p.functionCall.args?.motivo;
      const { data: filas, error } = await sb.rpc('ia_consulta', { p_sql: sql });
      // deno-lint-ignore no-explicit-any
      let salida: any;
      if (error) {
        salida = { error: error.message };
        consultas.push({ sql, motivo, error: error.message });
      } else {
        const lista = Array.isArray(filas) ? filas : [];
        let mostradas = lista;
        while (mostradas.length > 1 && JSON.stringify(mostradas).length > MAX_CARACTERES) {
          mostradas = mostradas.slice(0, Math.floor(mostradas.length / 2));
        }
        salida = { total_filas: lista.length, filas: mostradas,
                   aviso: mostradas.length < lista.length ? `Se muestran ${mostradas.length} de ${lista.length} filas: agregá más en SQL.` : undefined };
        consultas.push({ sql, motivo, filas: lista.length });
      }
      resultados.push({ functionResponse: { name: p.functionCall.name, id: p.functionCall.id, response: salida } });
    }
    contenidos.push({ role: 'user', parts: resultados });
  }
  return 'No llegué a una respuesta con las consultas permitidas. Probá con una pregunta más concreta.';
}

const dormir = (seg: number) => new Promise((r) => setTimeout(r, seg * 1000));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usar POST' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  let pregunta = '';
  let modeloUsado = '';
  let consultas: { sql: string; motivo?: string; filas?: number; error?: string }[] = [];
  try {
    const { data: esAdmin, error: errAdmin } = await sb.rpc('es_admin');
    if (errAdmin || !esAdmin) return json({ error: 'El asistente es solo para administradores centrales.' }, 403);
    if (!CLAVE) {
      return json({ error: 'Falta configurar la clave de Gemini (secreto GEMINI_API_KEY en Supabase → Edge Functions → Secrets).' }, 500);
    }

    const { mensajes } = await req.json() as { mensajes: { rol: string; texto: string }[] };
    if (!Array.isArray(mensajes) || !mensajes.length) return json({ error: 'No llegó la pregunta' }, 400);
    pregunta = String(mensajes[mensajes.length - 1].texto || '').slice(0, 4000);

    const { data: esquema, error: errEsq } = await sb.rpc('ia_esquema');
    if (errEsq) throw new Error('No se pudo leer el esquema: ' + errEsq.message);
    const sistema = instrucciones(esquema);

    // Cada modelo tiene su propio límite gratuito. Se prueba en orden,
    // salteando los que se sabe que están agotados; si todos lo están
    // por pocos segundos (límite por minuto), se espera una vez.
    let respuesta = '';
    const fallas: string[] = [];
    for (let ronda = 0; ronda < 2 && !respuesta; ronda++) {
      for (const modelo of MODELOS) {
        if ((agotadoHasta[modelo] || 0) > Date.now()) continue;
        consultas = [];
        try {
          respuesta = await responder(sb, modelo, mensajes, sistema, consultas);
          modeloUsado = modelo;
          break;
        } catch (e) {
          if (!(e instanceof Reintentable)) throw e;
          fallas.push(e.message);
          agotadoHasta[modelo] = Date.now() + (e.diario ? 3600 : Math.max(e.espera, 10)) * 1000;
        }
      }
      if (!respuesta && ronda === 0) {
        const proximo = Math.min(...MODELOS.map((m) => agotadoHasta[m] || 0)) - Date.now();
        if (proximo > 25000) break;
        await dormir(Math.max(proximo, 1000) / 1000);
      }
    }
    if (!respuesta) {
      throw new Error('Todos los modelos gratuitos de Gemini están ocupados o llegaron a su límite. Probá de nuevo en unos minutos' +
        ' (si es el límite diario, mañana). Detalle: ' + (fallas.slice(-1)[0] || ''));
    }

    await sb.from('ia_registro').insert({ pregunta, consultas, respuesta: respuesta.slice(0, 20000), modelo: modeloUsado });
    return json({ respuesta, consultas, modelo: modeloUsado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (pregunta) await sb.from('ia_registro').insert({ pregunta, consultas, error: msg.slice(0, 2000), modelo: modeloUsado || null });
    return json({ error: msg, consultas }, 500);
  }
});
