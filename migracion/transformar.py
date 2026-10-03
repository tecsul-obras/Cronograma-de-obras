#!/usr/bin/env python3
"""
Migración inicial a Supabase — Cronograma de Obra (TECSUL)

Fuentes:
  * Power BI (MODELO CENTRAL DE DATOS OBRAS TECSUL), exportado a CSV con DAX:
      raw/items.csv      MAESTRO_ITEMS_OBRAS        (todas las obras salvo CECON)
      raw/planes.csv     CONSOLIDADO_PLANES_DE_TRABAJO agregado ítem × tipo × mes
      raw/fechas.csv     fechas inicio/fin y dependencias por ítem × tipo de plan
      raw/proyectos.csv  MAESTRO_PROYECTOS_TECSUL
  * Sheet de la PWA (Datos_cronograma_pwa) exportada a raw/pwa_sheet.xlsx:
      - metadata de obras que la PWA ya tenía (plazo, fecha de inicio, llamado)
      - CECON (2090700000) completo: es la única obra cuyo dato bueno vive en la PWA

Reglas (decididas con José, 2026-10-02):
  * Distribución mensual operativa = plan REAL. CONTRATO -> línea base 'inicial',
    TECSUL -> línea base 'replanificacion' (curva 1.5 meta empresa).
  * Obras PÚBLICAS: las columnas CM Nº 1..4 son convenios modificatorios aprobados;
    convenio_detalle.cant es la cantidad NUEVA absoluta (igual que Code_Produccion.gs);
    item.cant_convenio = caché del último convenio aprobado que toca al ítem.
  * Obras PRIVADAS: no hay convenios. cant_contrato = cantidad inicial y
    cant_ajustada = última columna con dato (CANTIDAD FINAL) cuando difiere.
  * item_id es TEXTO, tal cual viene (nunca número).

Salida: out/<tabla>.json (lista de filas listas para insertar) + out/reporte.json
Uso:  python3 transformar.py <dir_raw> <dir_out>
"""
import csv, json, re, sys, collections, datetime as dt
from pathlib import Path

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else 'raw')
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'out')
OUT.mkdir(parents=True, exist_ok=True)

CECON = '2090700000'
PUBLICAS = {'1012500000', '1012300000', '1012600000', '1012700000', '1012400000', '1011700000', '1010100000'}
PRIVADAS = {'2240100000', '1080100000', CECON}
HOY = dt.date.today().isoformat()

aviso = collections.defaultdict(list)   # reporte de cosas a revisar


# ----------------------------------------------------------------- utilidades
def rd(name):
    rows = list(csv.reader(open(RAW / name, encoding='utf-8-sig')))
    head = [re.sub(r'.*\[|\]', '', h) for h in rows[0]]
    return [dict(zip(head, r)) for r in rows[1:]]


def num(s):
    """Número de la exportación DAX: coma decimal, sin separador de miles."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip()
    if s == '':
        return None
    return float(s.replace(',', '.'))


def fecha(s):
    """'d/m/Y hh:mm:ss' -> 'YYYY-MM-DD'. Descarta el 30/12/1899 (fecha vacía de Excel)."""
    if s is None or s == '':
        return None
    if isinstance(s, (dt.datetime, dt.date)):
        d = s.date() if isinstance(s, dt.datetime) else s
    else:
        m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', str(s))
        if not m:
            return None
        d = dt.date(int(m[3]), int(m[2]), int(m[1]))
    if d.year < 1990:
        return None
    return d.isoformat()


def mes_de(iso):
    return iso[:7]


def fin_de_mes(mes):
    y, m = map(int, mes.split('-'))
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - dt.timedelta(days=1)).isoformat()


def clave_orden(item_id):
    """'ITEM 2.1' -> (2,1); '20.10' -> (20,10). Para ordenar jerárquico sin colapsar 20.1/20.10."""
    s = re.sub(r'(?i)^items?\s*', '', item_id).replace(',', '.')
    partes = []
    for p in s.split('.'):
        partes.append(int(p) if p.isdigit() else 10**6)
    return tuple(partes), item_id


def redondear(x, nd=6):
    return None if x is None else round(x, nd)


# ------------------------------------------------------------ fuentes PWA sheet
def sheet():
    import openpyxl
    wb = openpyxl.load_workbook(RAW / 'pwa_sheet.xlsx', read_only=True, data_only=True)

    def tab(t, solo_obra=None):
        rows = list(wb[t].iter_rows(values_only=True))
        h = [str(x).strip() if x is not None else '' for x in rows[0]]
        out = []
        for r in rows[1:]:
            if not any(v not in (None, '') for v in r):
                continue
            d = dict(zip(h, r))
            if solo_obra and str(d.get('obra_id', '')).split('.')[0] != solo_obra:
                continue
            out.append(d)
        return out
    return tab


tab = sheet()


def oid(v):
    return str(v).split('.')[0] if v not in (None, '') else None


def txt(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def boolv(v):
    return v in (True, 1, 1.0, '1', 'TRUE', 'true', 'Sí', 'si', 'sí')


# =================================================================== OBRAS
proyectos = {r['ID UNIDAD NEGOCIO']: r for r in rd('proyectos.csv')}
obras_sheet = {oid(r['obra_id']): r for r in tab('Obras')}

items_pbi = [r for r in rd('items.csv') if r['obra_id'] != CECON]
obra_ids = sorted({r['obra_id'] for r in items_pbi}) + [CECON]

NOMBRES = {  # nombre legible por defecto (de los Excel "MAESTRO PLAN DE TRABAJO - …")
    '1012500000': 'Ruta de la Banana', '1012300000': 'San Juan Misiones Lote 2',
    '1012600000': 'San Juan Misiones Lote 1', '1012700000': 'San Juan Zona Urbana Lote 3',
    '1012400000': 'Ruta 12 Chaco Sur', '1011700000': 'CT Vial — Accesos 2° Puente',
    '1010100000': 'Ruta D027', '1080100000': 'Arborea Hills', '2240100000': 'Frigorífico Cruzmonte',
    CECON: 'CECON Cloacal y Pluvial',
}

obras = []
for o in obra_ids:
    p = proyectos.get(o, {})
    s = obras_sheet.get(o, {})
    nombre_largo = (p.get('NOMBRE DEL PROYECTO') or '').strip()
    m = re.search(r'N[°º]\s*(\d+\s*/\s*\d{4})', nombre_largo)
    llamado = txt(s.get('llamado')) or (m[1].replace(' ', '') if m else '')
    f_ini = fecha(s.get('fecha_inicio')) or fecha(p.get('FECHA INICIO'))
    f_fin = fecha(s.get('fecha_fin')) or fecha(p.get('FECHA DE FINAL.'))
    if f_ini and f_fin and f_fin < f_ini:
        aviso['obra_fechas'].append(f'{o}: fecha fin {f_fin} anterior al inicio {f_ini} en el maestro de proyectos; se deja vacía')
        f_fin = None
    plazo = s.get('plazo_meses')
    plazo = int(plazo) if plazo not in (None, '') else None
    tipo = 'publica' if o in PUBLICAS else 'privada'
    if tipo == 'publica' and not plazo:
        aviso['plazo_faltante'].append(f'{o} {NOMBRES[o]}: obra pública sin plazo_meses — los días de ampliación de convenios quedan sin calcular')
    obras.append({
        'obra_id': o,
        'nombre': txt(s.get('nombre')) or NOMBRES.get(o, p.get('NOMBRE CORTO PROYECTO') or o),
        'llamado': llamado,
        'lote': txt(s.get('lote')),
        'moneda': 'PYG',
        'tipo_obra': tipo,
        'fecha_inicio': f_ini,
        'fecha_fin': f_fin,
        'plazo_meses': plazo,
        'dias_por_mes': int(s.get('dias_por_mes') or 30),
        'activo': True,
    })


# ======================================================= ÍTEMS (Power BI)
items, categorias = [], collections.OrderedDict()
convenios, conv_det = [], []
por_obra = collections.defaultdict(list)
for r in items_pbi:
    por_obra[r['obra_id']].append(r)

QTY = ['cant_ini', 'cm1', 'cm2', 'cm3', 'cm4', 'cant_final']

for o, filas in por_obra.items():
    publica = o in PUBLICAS
    filas.sort(key=lambda r: clave_orden(r['item_id'].strip()))
    titulos = []          # pila de (partes, nivel) de títulos vistos
    cm_usados = [n for n in (1, 2, 3, 4) if any(num(r[f'cm{n}']) is not None for r in filas)]
    acum = {}             # cadena contractual para convenios
    pu_de = {}
    orden = 0
    for r in filas:
        iid = r['item_id'].strip()
        desc = r['descripcion'].strip()
        q = {k: num(r[k]) for k in QTY}
        pu = num(r['pu'])
        um = r['um'].strip()
        if not desc and all(v in (None, 0) for v in q.values()):
            aviso['filas_descartadas'].append(f'{o} "{iid}": fila sin descripción ni cantidades (encabezado vacío)')
            continue
        es_grupo = (q['cant_ini'] is None and all(q[f'cm{n}'] is None for n in (1, 2, 3, 4))
                    and q['cant_final'] in (None, 0) and pu in (None, 0) and um == '')
        if es_grupo and re.match(r'(?i)^items?\s', iid):
            # Capítulos "ITEM n" (CT Vial): los ítems de la obra van numerados 1..N sin
            # relación de prefijo con el capítulo y Power BI no conserva el orden de
            # filas del Excel, así que no hay forma de saber qué ítem cuelga de cuál.
            aviso['capitulos_no_cargados'].append(f'{o} "{iid}" {desc}')
            continue
        partes = clave_orden(iid)[0]

        def cuelga(t):
            tp = t[0]
            if tp == partes[:len(tp)]:                      # prefijo: 2 -> 2.01
                return True
            # subtítulo: 92.01 -> 92.03 (mismo padre, número posterior)
            return len(tp) >= 2 and len(tp) == len(partes) and tp[:-1] == partes[:-1] and tp[-1] < partes[-1]
        while titulos and not cuelga(titulos[-1]):
            titulos.pop()
        nivel = (titulos[-1][1] + 1) if titulos else 1
        if es_grupo:
            titulos.append((partes, nivel))
        nivel = max(1, min(8, nivel))

        cant_ini = q['cant_ini'] or 0.0
        final = q['cant_final']
        cant_ajustada = None
        if not publica and final is not None and abs(final - cant_ini) > 1e-9 and not es_grupo:
            if final == 0:
                aviso['privada_supresion'].append(
                    f'{o} {iid}: cantidad final 0 (ítem suprimido) — cant_ajustada=0 cae al contrato por regla; queda con cant_contrato={cant_ini}')
            cant_ajustada = final

        if publica and not es_grupo:
            ultimo = cant_ini
            for n in (1, 2, 3, 4):
                if q[f'cm{n}'] is not None:
                    ultimo = q[f'cm{n}']
            if final is not None and abs(final - ultimo) > 1e-6:
                aviso['final_no_cuadra'].append(f'{o} {iid}: CANTIDAD FINAL {final} ≠ último CM/inicial {ultimo}')

        categoria = (r['contrato'].strip() or 'Sin categoría') if o == '2240100000' else 'Sin categoría'
        categorias.setdefault((o, categoria), len([k for k in categorias if k[0] == o]))

        items.append({
            'obra_id': o, 'item_id': iid, 'descripcion': desc,
            'id_nivel3': r['id_nivel3'].strip(), 'desc_nivel3': r['desc_nivel3'].strip(),
            'codigo_cc': r['codigo_cc'].strip(), 'um': um,
            'cant_contrato': redondear(cant_ini), 'cant_convenio': None,
            'cant_ajustada': redondear(cant_ajustada),
            'precio_unit': pu or 0.0, 'incidencia': num(r['incidencia']),
            'categoria': categoria, 'estado': 'Pendiente',
            'fecha_ini': None, 'fecha_fin': None,
            'nivel': nivel, 'es_grupo': es_grupo, 'tipo': 'grupo' if es_grupo else 'item',
            'padre_id': None, 'orden': orden,
        })
        orden += 1
        if not es_grupo:
            acum[iid] = cant_ini
            pu_de[iid] = pu or 0.0
        r['_q'] = q
        r['_grupo'] = es_grupo

    # ---- convenios (solo públicas) ------------------------------------
    if publica and cm_usados:
        monto_orig = sum(acum[i] * pu_de[i] for i in acum)
        cache = {}
        for n in cm_usados:
            cid = f'cv_cm{n:02d}'
            det = []
            for r in filas:
                if r.get('_grupo') or '_q' not in r:
                    continue
                iid = r['item_id'].strip()
                nuevo = r['_q'][f'cm{n}']
                if nuevo is None:
                    continue
                previo = acum.get(iid, 0.0)
                if abs(nuevo - previo) < 1e-9:
                    continue
                if previo == 0 and nuevo > 0:
                    t = 'item_nuevo'
                elif nuevo == 0:
                    t = 'supresion'
                elif nuevo > previo:
                    t = 'aumento'
                else:
                    t = 'disminucion'
                det.append({'obra_id': o, 'convenio_id': cid, 'item_id': iid, 'tipo': t,
                            'cant': redondear(nuevo), 'pu': (pu_de.get(iid) if t == 'item_nuevo' else None)})
                acum[iid] = nuevo
                cache[iid] = nuevo
            monto_conv = sum(acum[i] * pu_de[i] for i in acum)
            convenios.append({
                'obra_id': o, 'convenio_id': cid, 'orden': n, 'nro': f'CM-{n:02d}',
                'tipo': 'modificatorio', 'estado': 'aprobado',
                'monto_original': round(monto_orig, 2), 'monto_convenio': round(monto_conv, 2),
                'pct_aumento': round((monto_conv - monto_orig) / monto_orig, 10) if monto_orig else None,
                'dias_calculados': None, 'dias_ampliacion': None, 'fecha_fin_contrato': None,
                'descripcion': f'Convenio Modificatorio Nº {n} — importado de Power BI (columna CANTIDAD CM Nº {n})',
            })
            conv_det.extend(det)
            if not det:
                aviso['convenio_vacio'].append(f'{o} CM-{n:02d}: la columna tiene datos pero ninguna cantidad cambia respecto al anterior')
        for it in items:
            if it['obra_id'] == o and it['item_id'] in cache:
                it['cant_convenio'] = cache[it['item_id']]

item_key = {(i['obra_id'], i['item_id']): i for i in items}


# ============================================= PLANES (REAL / CONTRATO / TECSUL)
dist = collections.defaultdict(float)           # (tipo, obra, item, mes) -> cant
for r in rd('planes.csv'):
    o, t, iid = r['CODIGO UN'], r['TIPO PLAN'], r['ID ITEM DE OBRA CONTRATO'].strip()
    f = fecha(r['FECHA PLAN'])
    c = num(r['cant'])
    if not f or not c:
        continue
    if (o, iid) not in item_key:
        aviso['plan_sin_item'].append(f'{o} {t} "{iid}"')
        continue
    if item_key[(o, iid)]['es_grupo']:
        aviso['plan_en_titulo'].append(f'{o} {t} "{iid}" (título con cantidades: se ignora)')
        continue
    dist[(t, o, iid, mes_de(f))] += c

fechas_plan = {}                                 # (tipo, obra, item) -> (ini, fin)
deps = []
for r in rd('fechas.csv'):
    o, t, iid = r['CODIGO UN'], r['TIPO PLAN'], r['ID ITEM DE OBRA CONTRATO'].strip()
    ini, fin = fecha(r['FECHA INICO']), fecha(r['FECHA FIN'])
    if ini or fin:
        fechas_plan[(t, o, iid)] = (ini, fin)
    pred = (r.get('DEPENDENCIA (ID ITEM)') or '').strip()
    if t == 'REAL' and pred and pred != '0':
        if (o, pred) in item_key and (o, iid) in item_key and pred != iid:
            deps.append({'obra_id': o, 'item_id': iid, 'pred_id': pred, 'tipo': 'FS', 'lag_dias': 0})
        else:
            aviso['dep_invalida'].append(f'{o} {iid} <- {pred}')

meses_de = collections.defaultdict(dict)        # (tipo, obra, item) -> {mes: cant}
for (t, o, iid, m), c in dist.items():
    meses_de[(t, o, iid)][m] = c


def mayor_resto(ms, nd=4):
    """Redondea cada mes a nd decimales sin que la suma del ítem se desvíe
    (mismo criterio que round6 en la PWA, a la escala de la base: numeric(18,4))."""
    f = 10 ** nd
    total = round(sum(ms.values()) * f)
    base = {m: int(v * f // 1) for m, v in ms.items()}
    resto = sorted(ms, key=lambda m: (ms[m] * f - base[m]), reverse=True)
    faltan = total - sum(base.values())
    for m in resto[:max(0, faltan)]:
        base[m] += 1
    return {m: base[m] / f for m in sorted(base) if base[m] != 0}


for k in list(meses_de):
    meses_de[k] = mayor_resto(meses_de[k])
    if not meses_de[k]:
        del meses_de[k]


def rango(t, o, iid):
    """Fechas del ítem en un plan: las explícitas, o el primer/último mes con cantidad."""
    ini, fin = fechas_plan.get((t, o, iid), (None, None))
    ms = sorted(meses_de.get((t, o, iid), {}))
    if not ini and ms:
        ini = ms[0] + '-01'
    if not fin and ms:
        fin = fin_de_mes(ms[-1])
    if ini and fin and fin < ini:
        aviso['fechas_invertidas'].append(f'{o} {t} {iid}: {ini} > {fin}; se usa el rango de meses')
        ini, fin = (ms[0] + '-01', fin_de_mes(ms[-1])) if ms else (None, None)
    return ini, fin


distribucion = []
for (t, o, iid), ms in meses_de.items():
    if t != 'REAL':
        continue
    for m, c in sorted(ms.items()):
        distribucion.append({'obra_id': o, 'item_id': iid, 'mes': m, 'cant': c, 'manual': False})

for it in items:
    if it['obra_id'] == CECON or it['es_grupo']:
        continue
    ini, fin = rango('REAL', it['obra_id'], it['item_id'])
    it['fecha_ini'], it['fecha_fin'] = ini, fin
    # control: suma del plan REAL vs cantidad vigente
    vig = it['cant_ajustada'] if it['cant_ajustada'] not in (None, 0) else (
        it['cant_convenio'] if it['cant_convenio'] is not None else it['cant_contrato'])
    s = sum(meses_de.get(('REAL', it['obra_id'], it['item_id']), {}).values())
    if vig and abs(s - vig) > max(0.01, abs(vig) * 0.001):
        aviso['dist_no_cuadra'].append(f"{it['obra_id']} {it['item_id']}: plan REAL suma {round(s,4)} vs vigente {vig}")

lineas_base, lb_det = [], []
for t, tipo_lb, nombre in [('CONTRATO', 'inicial', 'Contractual (Power BI)'),
                           ('TECSUL', 'replanificacion', 'Meta TECSUL (Power BI)')]:
    for o in obra_ids:
        if o == CECON:
            continue
        claves = [k for k in meses_de if k[0] == t and k[1] == o]
        if not claves:
            continue
        bid = f'bl_pbi_{t.lower()}'
        lineas_base.append({'obra_id': o, 'baseline_id': bid, 'nombre': nombre, 'fecha_snapshot': HOY,
                            'activa': True, 'tipo': tipo_lb, 'convenio_id': None, 'creada_por': 'migracion-powerbi'})
        for (_, _, iid) in claves:
            ms = meses_de[(t, o, iid)]
            ini, fin = rango(t, o, iid)
            lb_det.append({'obra_id': o, 'baseline_id': bid, 'item_id': iid, 'fecha_ini': ini, 'fecha_fin': fin,
                           'cant': round(sum(ms.values()), 6), 'cant_convenio': None, 'dist': ms})


# ==================================================================== CECON
cec_items = tab('Items__2090700000')
for r in cec_items:
    iid = txt(r['item_id'])
    items.append({
        'obra_id': CECON, 'item_id': iid, 'descripcion': txt(r.get('desc')),
        'id_nivel3': txt(r.get('id_nivel3')), 'desc_nivel3': txt(r.get('desc_nivel3')),
        'codigo_cc': txt(r.get('codigo_cc')), 'um': txt(r.get('um')),
        'cant_contrato': num(r.get('cant_contrato')) or 0.0,
        'cant_convenio': num(r.get('cant_convenio')),
        'cant_ajustada': num(r.get('cant_ajustada')),
        'precio_unit': num(r.get('precio_unit')) or 0.0, 'incidencia': num(r.get('incidencia')),
        'categoria': txt(r.get('categoria')) or 'Sin categoría', 'estado': txt(r.get('estado')) or 'Pendiente',
        'fecha_ini': fecha(r.get('fecha_ini')), 'fecha_fin': fecha(r.get('fecha_fin')),
        'avance_esperado': num(r.get('avance_esperado')), 'avance_manual': num(r.get('avance_manual')),
        'nivel': int(num(r.get('nivel')) or 1), 'es_grupo': boolv(r.get('es_grupo')),
        'tipo': txt(r.get('tipo')), 'padre_id': txt(r.get('padre_id')) or None,
        'orden': int(num(r.get('orden')) or 0),
    })
    categorias.setdefault((CECON, items[-1]['categoria']), 0)
cec_ids = {txt(r['item_id']) for r in cec_items}
# padre_id corrompido por Sheets ("1,6" -> fecha 1/06/2026): se deduce del propio ID
for it in items:
    if it['obra_id'] != CECON or not it['padre_id'] or it['padre_id'] in cec_ids:
        continue
    cand = it['item_id'].rsplit('.', 1)[0] if '.' in it['item_id'] else None
    if cand in cec_ids:
        aviso['cecon_padre_reparado'].append(f"{it['item_id']}: padre '{it['padre_id']}' -> '{cand}'")
        it['padre_id'] = cand
    else:
        aviso['cecon_padre_invalido'].append(f"{it['item_id']}: padre '{it['padre_id']}' no existe; se deja vacío")
        it['padre_id'] = None

for r in tab('DistribucionMensual__2090700000'):
    distribucion.append({'obra_id': CECON, 'item_id': txt(r['item_id']), 'mes': txt(r['mes'])[:7],
                         'cant': num(r['cant']) or 0.0, 'manual': boolv(r.get('manual'))})
for r in tab('Dependencias__2090700000'):
    deps.append({'obra_id': CECON, 'item_id': txt(r['item_id']), 'pred_id': txt(r['pred_id']),
                 'tipo': txt(r.get('tipo')) or 'FS', 'lag_dias': int(num(r.get('lag_dias')) or 0)})

plan_semanal = []
for r in tab('PlanSemanal__2090700000'):
    try:
        split = json.loads(r.get('split_json') or '{}')
    except Exception:
        split = {}
    plan_semanal.append({'obra_id': CECON, 'plan_id': txt(r['plan_id']), 'item_id': txt(r['item_id']),
                         'actividad': txt(r.get('actividad')), 'frente': txt(r.get('frente')), 'um': txt(r.get('um')),
                         'semana': txt(r['semana']), 'mes': txt(r.get('mes'))[:7] or None,
                         'cant_prevista': num(r.get('cant_prevista')) or 0.0, 'causa': txt(r.get('causa')),
                         'split': split, 'manual': boolv(r.get('manual'))})

certificacion = []
for r in tab('Certificacion', CECON):
    # las certificaciones negativas (deducciones) se respetan tal cual
    certificacion.append({'obra_id': CECON, 'item_id': txt(r['item_id']), 'mes': txt(r['mes'])[:7],
                          'cant_certificada': num(r.get('cant_certificada')) or 0.0,
                          'observacion': txt(r.get('observacion')), 'nro_certificado': txt(r.get('nro_certificado')),
                          'guardado_por': 'migracion-sheet'})

comunicacion = []
for r in tab('Comunicaciones', CECON):
    comunicacion.append({'obra_id': CECON, 'com_id': txt(r['com_id']), 'nro': txt(r.get('nro')),
                         'fecha_nota': fecha(r.get('fecha_nota')), 'fecha_recepcion': fecha(r.get('fecha_recepcion')),
                         'remitente': txt(r.get('de')), 'destinatario': txt(r.get('para')),
                         'asunto': txt(r.get('asunto')), 'resumen': txt(r.get('resumen')),
                         'tipo': txt(r.get('tipo')), 'medio': txt(r.get('medio')),
                         'requiere_resp': boolv(r.get('requiere_resp')), 'vence': fecha(r.get('vence')),
                         'resp_a': txt(r.get('resp_a')) or None, 'responsable': txt(r.get('responsable')),
                         'link': txt(r.get('link')), 'cerrada': boolv(r.get('cerrada')),
                         'creado_por': txt(r.get('creado_por')),
                         'creado_en': (fecha(r.get('creado_en')) or HOY) + 'T00:00:00-03:00'})

cec_bl = tab('LineasBase', CECON)
bl_ids = {txt(r['baseline_id']) for r in cec_bl}
for r in cec_bl:
    lineas_base.append({'obra_id': CECON, 'baseline_id': txt(r['baseline_id']), 'nombre': txt(r['nombre']),
                        'fecha_snapshot': fecha(r.get('fecha_snapshot')) or HOY, 'activa': boolv(r.get('activa')),
                        'tipo': 'inicial' if 'contractual' in txt(r['nombre']).lower() else 'replanificacion',
                        'convenio_id': None, 'creada_por': 'migracion-sheet'})
for r in tab('LineaBaseDetalle'):
    if txt(r['baseline_id']) not in bl_ids:
        continue
    iid = txt(r['item_id'])
    if iid not in cec_ids:
        aviso['cecon_lb_sin_item'].append(f"{r['baseline_id']} ítem {iid}")
        continue
    try:
        d = json.loads(r.get('dist_json') or '{}')
    except Exception:
        d = {}
    lb_det.append({'obra_id': CECON, 'baseline_id': txt(r['baseline_id']), 'item_id': iid,
                   'fecha_ini': fecha(r.get('fecha_ini')), 'fecha_fin': fecha(r.get('fecha_fin')),
                   'cant': num(r.get('cant')) or 0.0, 'cant_convenio': None, 'dist': d})

config = []
for r in tab('Config'):
    o = oid(r.get('obra_id'))
    if o in (None, CECON) or o in obra_ids:
        if o is None:
            config.append({'obra_id': None, 'clave': txt(r['clave']), 'valor': txt(r.get('valor'))})
        elif o == CECON or o == '1012500000':   # config de lluvia/calendario que José ya cargó
            config.append({'obra_id': o, 'clave': txt(r['clave']), 'valor': txt(r.get('valor'))})

cats = [{'obra_id': o, 'nombre': n, 'color': '', 'orden': i} for (o, n), i in categorias.items()]

# ------------------------------------------------------------- validaciones
claves = collections.Counter((i['obra_id'], i['item_id']) for i in items)
dup = [k for k, v in claves.items() if v > 1]
assert not dup, f'ítems duplicados: {dup[:5]}'
for t, rows in [('distribucion', distribucion), ('dependencias', deps), ('plan_semanal', plan_semanal),
                ('certificacion', certificacion), ('lb_det', lb_det), ('conv_det', conv_det)]:
    bad = [r for r in rows if (r['obra_id'], r['item_id']) not in claves]
    assert not bad, f'{t}: referencias a ítems inexistentes {bad[:3]}'
for d in deps:
    assert (d['obra_id'], d['pred_id']) in claves, d
# tope de certificación (mismo criterio que fn_tope_certificacion)
tipo_de = {o['obra_id']: o['tipo_obra'] for o in obras}
acum_cert = collections.defaultdict(float)
for c in certificacion:
    acum_cert[(c['obra_id'], c['item_id'])] += c['cant_certificada']
for k, total in acum_cert.items():
    i = items[[n for n, x in enumerate(items) if (x['obra_id'], x['item_id']) == k][0]]
    contractual = i['cant_convenio'] if i['cant_convenio'] is not None else i['cant_contrato']
    tope = contractual if tipo_de[k[0]] == 'publica' else (i['cant_ajustada'] if i['cant_ajustada'] is not None else contractual)
    assert total <= tope + 0.0001, f'certificación sobre el tope {k}: {total} > {tope}'
dd = collections.Counter((d['obra_id'], d['item_id'], d['pred_id']) for d in deps)
deps = [d for d in deps if dd[(d['obra_id'], d['item_id'], d['pred_id'])] == 1] + \
       [dict(zip(('obra_id', 'item_id', 'pred_id'), k), tipo='FS', lag_dias=0) for k, v in dd.items() if v > 1]
for i in items:
    if i['fecha_ini'] and i['fecha_fin'] and i['fecha_fin'] < i['fecha_ini']:
        aviso['fechas_invertidas'].append(f"{i['obra_id']} {i['item_id']}: {i['fecha_ini']} > {i['fecha_fin']} (se vacía fin)")
        i['fecha_fin'] = None

# ------------------------------------------------------------------ salida
tablas = {
    'obra': obras, 'categoria': cats, 'item': items, 'item_dependencia': deps,
    'distribucion_mensual': distribucion, 'convenio': convenios, 'convenio_detalle': conv_det,
    'linea_base': lineas_base, 'linea_base_detalle': lb_det, 'plan_semanal': plan_semanal,
    'certificacion': certificacion, 'comunicacion': comunicacion, 'config': config,
}
for t, rows in tablas.items():
    json.dump(rows, open(OUT / f'{t}.json', 'w', encoding='utf-8'), ensure_ascii=False)

resumen = {t: len(v) for t, v in tablas.items()}
por_obra_res = {}
for o in obra_ids:
    por_obra_res[o] = {
        'nombre': next(x['nombre'] for x in obras if x['obra_id'] == o),
        'tipo': next(x['tipo_obra'] for x in obras if x['obra_id'] == o),
        'items': sum(1 for i in items if i['obra_id'] == o and not i['es_grupo']),
        'titulos': sum(1 for i in items if i['obra_id'] == o and i['es_grupo']),
        'dist_filas': sum(1 for d in distribucion if d['obra_id'] == o),
        'convenios': sum(1 for c in convenios if c['obra_id'] == o),
        'lineas_base': sum(1 for b in lineas_base if b['obra_id'] == o),
        'monto_contrato': round(sum((i['cant_contrato'] or 0) * i['precio_unit'] for i in items if i['obra_id'] == o and not i['es_grupo'])),
    }
json.dump({'resumen': resumen, 'por_obra': por_obra_res, 'avisos': aviso},
          open(OUT / 'reporte.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(resumen, indent=1))
print(json.dumps(por_obra_res, ensure_ascii=False, indent=1))
for k, v in aviso.items():
    print(f'[{k}] {len(v)}', *v[:4], sep='\n   ')
