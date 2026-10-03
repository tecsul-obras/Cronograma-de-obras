#!/usr/bin/env python3
"""
Genera los .sql de carga a partir de out/*.json (salida de transformar.py).

Cada archivo es una transacción completa (BEGIN … COMMIT): si algo falla, no
queda nada a medias. Los datos viajan como un arreglo JSON compacto y se
convierten con jsonb_array_elements, así el archivo es chico y no hay que
escapar comillas fila por fila.

Uso:  python3 generar_sql.py <dir_out> <dir_sql> [--muestra N]
      --muestra N  genera un único archivo con N filas por tabla que termina en
                   ROLLBACK (para probar tipos y restricciones sin cargar nada).
"""
import json, sys
from pathlib import Path

OUT = Path(sys.argv[1]); SQL = Path(sys.argv[2]); SQL.mkdir(parents=True, exist_ok=True)
MUESTRA = int(sys.argv[sys.argv.index('--muestra') + 1]) if '--muestra' in sys.argv else None

# tabla -> [(columna, tipo_pg, valor_por_defecto_si_falta)]
# (los defaults replican los del esquema: jsonb_array_elements no aplica DEFAULT)
T = {
 'obra': [('obra_id','text',None),('nombre','text',''),('llamado','text',''),('lote','text',''),
          ('moneda','text','PYG'),('tipo_obra','text','privada'),('fecha_inicio','date',None),
          ('fecha_fin','date',None),('plazo_meses','integer',None),('dias_por_mes','integer',30),
          ('activo','boolean',True)],
 'categoria': [('obra_id','text',None),('nombre','text',None),('color','text',''),('orden','integer',0)],
 'item': [('obra_id','text',None),('item_id','text',None),('descripcion','text',''),('id_nivel3','text',''),
          ('desc_nivel3','text',''),('codigo_cc','text',''),('um','text',''),('cant_contrato','numeric',0),
          ('cant_convenio','numeric',None),('cant_ajustada','numeric',None),('precio_unit','numeric',0),
          ('incidencia','numeric',None),('categoria','text','Sin categoría'),('estado','text','Pendiente'),
          ('fecha_ini','date',None),('fecha_fin','date',None),('avance_esperado','numeric',None),
          ('avance_manual','numeric',None),('nivel','smallint',1),('es_grupo','boolean',False),
          ('tipo','text',''),('padre_id','text',None),('orden','integer',0)],
 'item_dependencia': [('obra_id','text',None),('item_id','text',None),('pred_id','text',None),
                      ('tipo','text','FS'),('lag_dias','integer',0)],
 'convenio': [('obra_id','text',None),('convenio_id','text',None),('orden','integer',1),('nro','text',''),
              ('tipo','text',''),('estado','text','borrador'),('fecha_presentacion','date',None),
              ('fecha_resolucion','date',None),('monto_original','numeric',0),('monto_convenio','numeric',0),
              ('pct_aumento','numeric',None),('dias_calculados','integer',None),('dias_ampliacion','integer',None),
              ('fecha_fin_contrato','date',None),('descripcion','text',''),('doc_url','text','')],
 'convenio_detalle': [('obra_id','text',None),('convenio_id','text',None),('item_id','text',None),
                      ('tipo','text',''),('cant','numeric',0),('pu','numeric',None)],
 'distribucion_mensual': [('obra_id','text',None),('item_id','text',None),('mes','text',None),
                          ('cant','numeric',0),('manual','boolean',False)],
 'linea_base': [('obra_id','text',None),('baseline_id','text',None),('nombre','text',None),
                ('fecha_snapshot','date',None),('activa','boolean',True),('tipo','text','replanificacion'),
                ('convenio_id','text',None),('creada_por','text','')],
 'linea_base_detalle': [('obra_id','text',None),('baseline_id','text',None),('item_id','text',None),
                        ('fecha_ini','date',None),('fecha_fin','date',None),('cant','numeric',0),
                        ('cant_convenio','numeric',None),('dist','jsonb',{})],
 'plan_semanal': [('obra_id','text',None),('plan_id','text',None),('item_id','text',None),
                  ('actividad','text',''),('frente','text',''),('um','text',''),('semana','text',None),
                  ('mes','text',None),('cant_prevista','numeric',0),('causa','text',''),
                  ('split','jsonb',{}),('manual','boolean',False)],
 'certificacion': [('obra_id','text',None),('item_id','text',None),('mes','text',None),
                   ('cant_certificada','numeric',0),('observacion','text',''),('nro_certificado','text',''),
                   ('guardado_por','text','')],
 'comunicacion': [('obra_id','text',None),('com_id','text',None),('nro','text',''),('fecha_nota','date',None),
                  ('fecha_recepcion','date',None),('remitente','text',''),('destinatario','text',''),
                  ('asunto','text',''),('resumen','text',''),('tipo','text',''),('medio','text',''),
                  ('requiere_resp','boolean',False),('vence','date',None),('resp_a','text',None),
                  ('responsable','text',''),('link','text',''),('cerrada','boolean',False),
                  ('creado_por','text',''),('creado_en','timestamptz',None)],
 'config': [('obra_id','text',None),('clave','text',None),('valor','text','')],
 'produccion_jornada': [('obra_id','text',None),('submission_id','text',None),('fecha','date',None),
                        ('estado','text',''),('responsable','text',''),('lluvia_mm','numeric',None),
                        ('observaciones','text',''),('cargado_por','text',''),('cargado_en','timestamptz',None)],
 'produccion_fila': [('obra_id','text',None),('submission_id','text',None),('fila_nro','smallint',None),
                     ('item_id','text',None),('lado','text',''),('prog_ini','numeric',None),('prog_fin','numeric',None),
                     ('cantidad','numeric',0),('ancho_prom','numeric',None),('espesor_prom','numeric',None),
                     ('observaciones','text','')],
}
ALIAS = {'certificacion_pbi': 'certificacion', 'certificacion_sobre_tope': 'certificacion'}

ARCHIVOS = [
 ('01_obras_items.sql', ['obra', 'categoria', 'item', 'item_dependencia', 'convenio', 'convenio_detalle']),
 ('02_distribucion_lineas_base.sql', ['distribucion_mensual', 'linea_base', 'linea_base_detalle']),
 ('03_cecon_operativo.sql', ['plan_semanal', 'certificacion', 'comunicacion', 'config']),
]


def compactar(v):
    if isinstance(v, float):
        if v.is_integer():
            return int(v)
        return float(f'{v:.15g}')
    return v


def bloque(tabla, filas):
    tabla = ALIAS.get(tabla, tabla)
    cols = T[tabla]
    data = []
    for f in filas:
        fila = []
        for c, _, d in cols:
            v = f.get(c, d)
            if v is None and d is not None:
                v = d
            fila.append(compactar(v))
        data.append(fila)
    # una fila por línea: el SQL Editor del navegador se traba con líneas de 1 MB
    js = '[\n' + ',\n'.join(json.dumps(f, ensure_ascii=False, separators=(',', ':')) for f in data) + '\n]'
    assert '$d$' not in js
    sel = []
    for i, (c, t, _) in enumerate(cols):
        if t == 'jsonb':
            sel.append(f"(x->{i})")
        elif t == 'boolean':
            sel.append(f"(x->>{i})::boolean")
        else:
            sel.append(f"(x->>{i})::{t}")
    return (f"-- {tabla}: {len(filas)} filas\n"
            f"INSERT INTO public.{tabla} ({', '.join(c for c, _, _ in cols)})\n"
            f"SELECT {', '.join(sel)}\nFROM jsonb_array_elements($d${js}$d$::jsonb) AS x;\n\n")


def cargar(t):
    rows = json.load(open(OUT / f'{t}.json', encoding='utf-8'))
    return rows[:MUESTRA] if MUESTRA else rows


if '--cert-negativos' in sys.argv:
    # Recarga de certificación respetando los meses negativos (03/10/2026).
    pbi = cargar('certificacion_pbi') + cargar('certificacion_sobre_tope')
    neg_cecon = [c for c in cargar('certificacion') if c['cant_certificada'] < 0]
    ddl = open(Path(__file__).parent / 'esquema' / '11_certificacion_negativa.sql', encoding='utf-8').read()
    txt = ("-- Carga etapa 2b Cronograma de Obra — 11_recargar_certificacion_con_negativos.sql\n"
           f"-- {len(pbi)} certificaciones mensuales de Power BI (con {sum(1 for c in pbi if c['cant_certificada'] < 0)} meses negativos respetados)\n"
           f"-- + {len(neg_cecon)} deducción(es) de CECON que había quedado afuera.\n"
           "-- Reemplaza la certificación de Power BI cargada con 06/07. NO toca la de CECON (Sheet PWA).\n"
           "-- Ejecutar completo en el SQL Editor de Supabase. Es una transacción: si falla, no cambia nada.\n"
           "BEGIN;\n\n" + ddl + "\n"
           "-- el tope se apaga solo mientras se recarga: incluye los 128 ítems sobre el tope (archivo 07)\n"
           "ALTER TABLE public.certificacion DISABLE TRIGGER tg_tope_certificacion;\n\n"
           "DELETE FROM public.certificacion WHERE guardado_por = 'migracion-powerbi';\n\n"
           + bloque('certificacion_pbi', pbi)
           + bloque('certificacion', neg_cecon).replace('FROM jsonb_array_elements', 'FROM jsonb_array_elements', 1).rstrip(';\n') + "\nON CONFLICT (obra_id, item_id, mes) DO NOTHING;\n\n"
           "ALTER TABLE public.certificacion ENABLE TRIGGER tg_tope_certificacion;\n\n"
           "COMMIT;\n\n"
           "-- Comprobación: meses negativos y total por obra\n"
           "SELECT obra_id, count(*) AS meses, count(*) FILTER (WHERE cant_certificada < 0) AS meses_negativos,\n"
           "       round(sum(cant_certificada * (SELECT precio_unit FROM public.item i WHERE i.obra_id = c.obra_id AND i.item_id = c.item_id))) AS monto_certificado\n"
           "FROM public.certificacion c GROUP BY obra_id ORDER BY obra_id;\n")
    (SQL / '11_recargar_certificacion_con_negativos.sql').write_text(txt, encoding='utf-8')
    print('11_recargar_certificacion_con_negativos.sql', round(len(txt.encode()) / 1024), 'KB')
    sys.exit()

if '--etapa2' in sys.argv:
    # Producción y certificación desde Power BI (salida de transformar_produccion.py)
    def archivo(nombre, cabecera, cuerpo, pie=''):
        txt = (f"-- Carga etapa 2 Cronograma de Obra — {nombre}\n{cabecera}"
               "-- Ejecutar completo en el SQL Editor de Supabase. Es una transacción: si falla, no carga nada.\n"
               "BEGIN;\n\n" + cuerpo + pie + "COMMIT;\n")
        (SQL / nombre).write_text(txt, encoding='utf-8')
        print(nombre, round(len(txt.encode()) / 1024), 'KB')

    jor = cargar('produccion_jornada'); fil = cargar('produccion_fila')
    archivo('05a_produccion_jornadas.sql',
            f"-- {len(jor)} jornadas de liberación (incluye días sin actividad por lluvia/humedad/receso).\n",
            bloque('produccion_jornada', jor))
    archivo('05b_produccion_filas.sql',
            f"-- {len(fil)} filas de liberación (ítem, lado, progresivas, cantidad). Correr DESPUÉS de 05a.\n",
            bloque('produccion_fila', fil))
    ok = cargar('certificacion_pbi')
    archivo('06_certificacion.sql',
            f"-- {len(ok)} certificaciones mensuales (ítem × mes) dentro del tope. CECON no va: ya está cargada.\n",
            bloque('certificacion_pbi', ok))
    fuera = cargar('certificacion_sobre_tope')
    archivo('07_certificacion_sobre_tope_OPCIONAL.sql',
            f"-- OPCIONAL. {len(fuera)} certificaciones de ítems cuyo acumulado SUPERA la cantidad vigente\n"
            "-- (convenios que faltan en el maestro, ajustes no cargados, etc.). Es historia real certificada;\n"
            "-- para poder cargarla se desactiva el control de tope SOLO dentro de esta transacción y se\n"
            "-- vuelve a activar al final. Mientras esos ítems sigan sobre el tope, la PWA no va a dejar\n"
            "-- certificarles más hasta que se cargue el convenio o la cantidad ajustada que corresponda.\n",
            "ALTER TABLE public.certificacion DISABLE TRIGGER tg_tope_certificacion;\n\n" + bloque('certificacion_sobre_tope', fuera),
            "ALTER TABLE public.certificacion ENABLE TRIGGER tg_tope_certificacion;\n\n")
    sys.exit()

if MUESTRA:
    # muestra coherente: obras completas no, sólo N filas; desactivo FKs vía orden
    # y uso las N primeras obras/ítems que referencian las demás tablas.
    obras = cargar('obra')
    o_ids = {o['obra_id'] for o in obras}
    items = [i for i in json.load(open(OUT / 'item.json')) if i['obra_id'] in o_ids]
    keys = set()
    sel_items = []
    for i in items:                       # N ítems por obra elegida + los que referencian deps/conv
        if sum(1 for k in keys if k[0] == i['obra_id']) < MUESTRA:
            keys.add((i['obra_id'], i['item_id'])); sel_items.append(i)
    sql = ['BEGIN;\n']
    sql.append(bloque('obra', obras))
    sql.append(bloque('item', [dict(i, padre_id=None) for i in sel_items]))
    for t in ['categoria', 'item_dependencia', 'convenio', 'convenio_detalle', 'distribucion_mensual',
              'linea_base', 'linea_base_detalle', 'plan_semanal', 'certificacion', 'comunicacion', 'config']:
        rows = json.load(open(OUT / f'{t}.json', encoding='utf-8'))
        ok = []
        for r in rows:
            if r.get('obra_id') not in o_ids and r.get('obra_id') is not None:
                continue
            if 'item_id' in r and (r['obra_id'], r['item_id']) not in keys:
                continue
            if 'pred_id' in r and (r['obra_id'], r['pred_id']) not in keys:
                continue
            if t == 'comunicacion' and r.get('resp_a'):
                continue
            ok.append(r)
        if t == 'convenio_detalle':
            conv = {(c['obra_id'], c['convenio_id']) for c in json.load(open(OUT / 'convenio.json'))}
            ok = [r for r in ok if (r['obra_id'], r['convenio_id']) in conv]
        if t == 'linea_base_detalle':
            ok = [r for r in ok]
        sql.append(bloque(t, ok[:MUESTRA]))
    sql.append("SELECT 'muestra ok' AS resultado;\nROLLBACK;\n")
    (SQL / '00_prueba_muestra.sql').write_text(''.join(sql), encoding='utf-8')
    print('muestra', sum(len(s) for s in sql))
    sys.exit()

for nombre, tablas in ARCHIVOS:
    partes = [f"-- Carga inicial Cronograma de Obra — {nombre}\n"
              f"-- Generado por migracion/generar_sql.py. Ejecutar completo en el SQL Editor de Supabase.\n"
              "BEGIN;\n\n"]
    for t in tablas:
        partes.append(bloque(t, cargar(t)))
    partes.append("COMMIT;\n")
    (SQL / nombre).write_text(''.join(partes), encoding='utf-8')
    print(nombre, round(sum(len(p.encode()) for p in partes) / 1024), 'KB')

(SQL / '00_vaciar_tablas.sql').write_text(
    "-- Deja todas las tablas de datos vacías (para volver a correr la carga desde cero).\n"
    "-- NO toca usuario ni usuario_obra.\n"
    "BEGIN;\nTRUNCATE public.produccion_fila, public.produccion_jornada, public.pista_snapshot, public.pista_tramo,\n"
    "  public.pista_estado, public.pista_eje, public.comunicacion, public.certificacion, public.plan_semanal,\n"
    "  public.linea_base_detalle, public.linea_base, public.convenio_detalle, public.convenio,\n"
    "  public.distribucion_mensual, public.item_dependencia, public.item, public.categoria, public.calendario,\n"
    "  public.config, public.usuario_obra, public.obra CASCADE;\nCOMMIT;\n", encoding='utf-8')

(SQL / '04_verificar.sql').write_text(
    "-- Conteos por obra después de la carga\n"
    "SELECT o.obra_id, o.nombre, o.tipo_obra,\n"
    "  (SELECT count(*) FROM item i WHERE i.obra_id=o.obra_id AND NOT es_grupo) AS items,\n"
    "  (SELECT count(*) FROM distribucion_mensual d WHERE d.obra_id=o.obra_id) AS dist,\n"
    "  (SELECT count(*) FROM convenio c WHERE c.obra_id=o.obra_id) AS convenios,\n"
    "  (SELECT count(*) FROM linea_base b WHERE b.obra_id=o.obra_id) AS lineas_base,\n"
    "  (SELECT round(sum(cant_contrato*precio_unit)) FROM item i WHERE i.obra_id=o.obra_id AND NOT es_grupo) AS monto_contrato,\n"
    "  (SELECT round(sum(cant_vigente*precio_unit)) FROM item i WHERE i.obra_id=o.obra_id AND NOT es_grupo) AS monto_vigente\n"
    "FROM obra o ORDER BY o.obra_id;\n", encoding='utf-8')
