#!/usr/bin/env python3
"""
Etapa 2 de la migración: producción (liberaciones) y certificación desde Power BI.

Fuentes (exportadas con DAX desde MODELO CENTRAL DE DATOS OBRAS TECSUL):
  raw/liberaciones.csv  CONSOLIDADO_PLANILLAS_LIBERACION
  raw/certificado.csv   CONSOLIDADO_EJECUCION_CERTIFICADA_OBRA
  out/item.json / out/obra.json  (ítems ya cargados en la etapa 1, para validar)

Reglas:
  * Una jornada (produccion_jornada) por envío del formulario (Submission ID).
    Si un mismo ID aparece con varias fechas u obras (cargas históricas
    mensuales), se parte en una jornada por (obra, fecha, estado).
    Envíos sin ID -> jornada sintética 'pbi_<obra>_<fecha>_<n>'.
  * Las jornadas sin actividad (lluvia, humedad, receso) se cargan sin filas:
    alimentan el ajuste por lluvia.
  * Fila (produccion_fila) solo si tiene ítem y cantidad. Cantidad = "Cant. Final
    Producida" (si falta, "Cantidad"). Negativas se respetan (son correcciones).
  * Certificación: suma por obra × ítem × mes ('YYYY-MM' de Fecha liberación),
    sin ceros y RESPETANDO los meses con neto negativo (deducciones).
    CECON se excluye (ya se cargó desde la Sheet de la PWA).
    Se controla el tope igual que fn_tope_certificacion; los ítems que lo
    superan se separan (no se cargan) y se listan en el reporte.
  * Mapeo de ítems: exacto -> ruido de float ("86.100999999999999" = 86.101)
    -> separador coma/punto (CECON usa "1,6", la planilla "1.6").

Uso: python3 transformar_produccion.py <dir_raw> <dir_out>
"""
import csv, json, re, sys, collections, datetime as dt
from pathlib import Path

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else 'raw')
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'out')
CECON = '2090700000'
aviso = collections.defaultdict(list)


def rd(name):
    rows = list(csv.reader(open(RAW / name, encoding='utf-8-sig')))
    head = [re.sub(r'.*\[|\]', '', h) for h in rows[0]]
    return [dict(zip(head, r)) for r in rows[1:]]


def num(s):
    s = (s or '').strip()
    if not s:
        return None
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


def prog(s):
    """Progresiva: '12+500' -> 12500 ; número suelto -> tal cual."""
    s = (s or '').strip()
    if not s:
        return None
    m = re.fullmatch(r'(\d+)\s*\+\s*(\d+(?:[.,]\d+)?)', s)
    if m:
        return int(m[1]) * 1000 + float(m[2].replace(',', '.'))
    return num(s)


def fecha(s):
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?', (s or '').strip())
    if not m:
        return None, None
    d = dt.datetime(int(m[3]), int(m[2]), int(m[1]), int(m[4] or 0), int(m[5] or 0), int(m[6] or 0))
    return d.date().isoformat(), d.strftime('%Y-%m-%dT%H:%M:%S-03:00')


items = json.load(open(OUT / 'item.json', encoding='utf-8'))
obras = {o['obra_id']: o for o in json.load(open(OUT / 'obra.json', encoding='utf-8'))}
K = {(i['obra_id'], i['item_id']): i for i in items}
norm = collections.defaultdict(list)
for (o, i) in K:
    norm[(o, i.replace(',', '.'))].append(i)


def fix_float(s):
    if re.fullmatch(r'\d+\.\d{6,}', s):
        f = float(s)
        for nd in range(1, 5):
            if abs(round(f, nd) - f) < 1e-9:
                return f'{f:.{nd}f}'
    return s


por_cc = collections.defaultdict(list)
for (o_, i_), it_ in K.items():
    if (it_.get('codigo_cc') or '').strip():
        por_cc[(o_, it_['codigo_cc'].strip())].append(i_)


def mapea(o, iid, cc=None):
    iid = (iid or '').strip()
    if not iid:
        return None, 'sin_item'
    # Caso "14.2" (actividad sin código CC) vs "14,2" (ítem con CC): si la fila trae
    # el código CC y el ítem que coincide por texto no lo tiene, manda el CC
    # (revisión del comparador CECON, 03/10/2026).
    cc = (cc or '').strip()
    if cc and (o, iid) in K and not (K[(o, iid)].get('codigo_cc') or '').strip():
        c = por_cc.get((o, cc), [])
        if len(c) == 1 and c[0].replace(',', '.') == iid.replace(',', '.'):
            return c[0], 'cc'
    if (o, iid) in K:
        return iid, 'exacto'
    j = fix_float(iid)
    if (o, j) in K:
        return j, 'float'
    c = norm.get((o, j.replace(',', '.')), [])
    if len(c) == 1:
        return c[0], 'coma'
    return None, ('ambiguo' if c else 'no_existe')


def lluvia_mm(v, o='', f=''):
    """Google Sheets convierte "7.6" (7,6 mm escrito con punto) en la fecha 7/6, y
    llega como número de serie de Excel (46180). Se reconstruye día.mes -> 7.6.
    Solo para enteros en el rango de fechas 2000-2049; el resto queda tal cual."""
    if v is None or not (36526 <= v <= 54789) or not float(v).is_integer():
        return v
    d = dt.date(1899, 12, 30) + dt.timedelta(days=int(v))
    mm = float(f"{d.day}.{d.month}")
    aviso['lluvia_fecha_reconstruida'].append(f"{o} {f}: {int(v)} (= {d:%d/%m}) -> {mm} mm")
    return mm


ESTADOS = {'Sin Actividad Exceso de umedad': 'Sin Actividad Exceso de Humedad'}

# ================================================================ PRODUCCIÓN
lib = rd('liberaciones.csv')
grupos = collections.OrderedDict()     # clave jornada -> {cabecera, filas}
combos_por_sub = collections.defaultdict(set)
for r in lib:
    if r['sub']:
        f, _ = fecha(r['fecha'])
        combos_por_sub[r['sub']].add((r['obra'], f, ESTADOS.get(r['estado'], r['estado'])))

sin_id = collections.Counter()
for r in lib:
    o = r['obra'].strip()
    if o not in obras:
        aviso['lib_obra_desconocida'].append(f"obra '{o}' sub {r['sub']}")
        continue
    f, _ = fecha(r['fecha'])
    if not f:
        aviso['lib_sin_fecha'].append(r['sub'])
        continue
    estado = ESTADOS.get(r['estado'], r['estado']).strip()
    if r['sub']:
        sid = r['sub'] if len(combos_por_sub[r['sub']]) == 1 else f"{r['sub']}_{f.replace('-', '')}"
        if len(combos_por_sub[r['sub']]) > 1 and estado:
            sid += '_' + re.sub(r'[^a-z]', '', estado.lower())[:12]
    else:
        base = f"pbi_{o}_{f.replace('-', '')}_{re.sub(r'[^a-z]', '', estado.lower())[:12] or 'x'}"
        sid = base
    clave = (o, sid)
    g = grupos.get(clave)
    _, sub_ts = fecha(r['subdate'])
    lluvia = lluvia_mm(num(r['lluvia']), o, f)
    if g is None:
        g = grupos[clave] = {'obra_id': o, 'submission_id': sid, 'fecha': f, 'estado': estado,
                             'responsable': r['resp'].strip(), 'lluvia_mm': lluvia,
                             'observaciones': '', 'cargado_por': 'migracion-powerbi',
                             'cargado_en': sub_ts or (f + 'T00:00:00-03:00'), '_filas': []}
    else:
        if lluvia is not None and (g['lluvia_mm'] is None or lluvia > g['lluvia_mm']):
            g['lluvia_mm'] = lluvia
        if not g['estado'] and estado:
            g['estado'] = estado
    iid, como = mapea(o, r['item_contrato'], r.get('item_raw'))
    cant = num(r['cfin'])
    if cant is None:
        cant = num(r['cant'])
    if como == 'sin_item':
        continue
    if iid is None:
        aviso[f'lib_item_{como}'].append(f"{o} '{r['item_contrato']}'")
        continue
    if cant is None or cant == 0:
        aviso['lib_fila_sin_cantidad'].append(f"{o} {iid} {f}")
        continue
    if K[(o, iid)]['es_grupo']:
        aviso['lib_en_titulo'].append(f"{o} {iid}")
        continue
    obs = r['obs'].strip()
    pi, pf = prog(r['pi']), prog(r['pf'])
    if (r['pi'] and pi is None) or (r['pf'] and pf is None):
        obs = (obs + f" [progresivas originales: {r['pi']} / {r['pf']}]").strip()
    g['_filas'].append({'obra_id': o, 'submission_id': sid, 'item_id': iid, 'lado': r['lado'].strip(),
                        'prog_ini': pi, 'prog_fin': pf, 'cantidad': cant,
                        'ancho_prom': num(r['ancho']), 'espesor_prom': num(r['espesor']),
                        'observaciones': obs})
    if cant < 0:
        aviso['lib_negativa'].append(f"{o} {iid} {f} {cant}")

# ---- Filas de la planilla viva que Power BI no trae ---------------------
# Power BI descarta las filas sin "Submission ID" (las que se escriben a mano en
# la hoja). En CECON eso dejó afuera los días de lluvia/humedad de julio 2026.
# Se agregan solo los días SIN actividad que no existan ya (obra + fecha + estado).
PLANILLA = RAW / 'planilla_liberacion.xlsx'
if PLANILLA.exists():
    import openpyxl
    ya = {(g['obra_id'], g['fecha'], g['estado'].lower()) for g in grupos.values()}
    ws = openpyxl.load_workbook(PLANILLA, read_only=True, data_only=True).worksheets[0]
    filas_pl = list(ws.iter_rows(values_only=True))
    h = [str(x or '').strip() for x in filas_pl[0]]
    ix = {k: h.index(k) for k in ('Fecha liberación', 'Estado de actividad', 'Responsable registro',
                                  'ID Obra/ Id item de obra', 'Cantidad', 'Cantidad de lluvia (mm)',
                                  'Observaciones', 'Submission ID', 'Submission Date')}
    for r in filas_pl[1:]:
        if r[ix['Submission ID']] not in (None, '', 0, 0.0):
            continue
        o = str(r[ix['ID Obra/ Id item de obra']] or '').strip()[:10]
        if o not in obras:
            continue
        fv = r[ix['Fecha liberación']]
        if isinstance(fv, dt.datetime):
            f = fv.date().isoformat()
        else:
            m = re.match(r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})', str(fv or '').strip())
            if not m:
                continue
            f = f'{int(m[3]):04d}-{int(m[2]):02d}-{int(m[1]):02d}'
        estado = ESTADOS.get(str(r[ix['Estado de actividad']] or '').strip(),
                             str(r[ix['Estado de actividad']] or '').strip())
        if 'sin actividad' not in estado.lower():
            if r[ix['Cantidad']] not in (None, ''):
                aviso['planilla_fila_con_cantidad_sin_id'].append(f"{o} {f} {estado}")
            continue
        if (o, f, estado.lower()) in ya:
            continue
        lv = r[ix['Cantidad de lluvia (mm)']]
        if isinstance(lv, dt.datetime):
            lv = float(f"{lv.day}.{lv.month}")
            aviso['lluvia_fecha_reconstruida'].append(f"{o} {f}: fecha en la planilla -> {lv} mm")
        else:
            lv = lluvia_mm(num(str(lv)) if lv is not None else None, o, f)
        sd = r[ix['Submission Date']]
        sid = f"pla_{o}_{f.replace('-', '')}_{re.sub(r'[^a-z]', '', estado.lower())[12:40]}"
        grupos[(o, sid)] = {'obra_id': o, 'submission_id': sid, 'fecha': f, 'estado': estado,
                            'responsable': str(r[ix['Responsable registro']] or '').strip(), 'lluvia_mm': lv,
                            'observaciones': str(r[ix['Observaciones']] or '').strip(),
                            'cargado_por': 'migracion-planilla',
                            'cargado_en': (sd.strftime('%Y-%m-%dT%H:%M:%S-03:00') if isinstance(sd, dt.datetime)
                                           else f + 'T00:00:00-03:00'), '_filas': []}
        ya.add((o, f, estado.lower()))
        aviso['planilla_dia_agregado'].append(f"{o} {f} {estado} {lv if lv is not None else ''}")

jornadas, filas = [], []
for g in grupos.values():
    fs = g.pop('_filas')
    if not g['estado']:
        g['estado'] = 'Con Actividad con liberaciones' if fs else 'Sin dato'
    jornadas.append(g)
    for n, fl in enumerate(fs, 1):
        fl['fila_nro'] = n
        filas.append(fl)

# ============================================================== CERTIFICACIÓN
cert_rows = rd('certificado.csv')
acum = collections.defaultdict(float)
obs_de = collections.defaultdict(set)
for r in cert_rows:
    o = r['obra'].strip()
    if o == CECON:
        continue                       # ya cargada desde la Sheet de la PWA
    if o not in obras:
        if any((r['cfin'], r['cant'])):
            aviso['cert_obra_desconocida'].append(f"'{o}' {r['src']}")
        continue
    v = num(r['cfin'])
    if v is None:
        v = num(r['cant'])
    if not v:
        continue
    iid, como = mapea(o, r['item_contrato'])
    if iid is None:
        aviso[f'cert_item_{como}'].append(f"{o} '{r['item_contrato']}' {v}")
        continue
    f, _ = fecha(r['fecha'])
    if not f:
        aviso['cert_sin_fecha'].append(f"{o} {iid}")
        continue
    acum[(o, iid, f[:7])] += v
    if r['obs'].strip():
        obs_de[(o, iid, f[:7])].add(r['obs'].strip())

# Las certificaciones NEGATIVAS (deducciones) se respetan tal cual en su mes:
# en la práctica existen y hay que poder ver cuánto se certificó mes a mes
# (decisión de José, 03/10/2026). La columna admite negativos desde la
# migración 11_certificacion_negativa.sql.
cert = []
for (o, iid, mes), v in sorted(acum.items()):
    # SIN redondeo (José, 03/10/2026). Solo se descarta el cero exacto que deja
    # la suma de positivos y negativos (ruido binario del orden de 1e-12).
    if abs(v) < 1e-9:
        continue
    if v < 0:
        aviso['cert_mes_negativo'].append(f"{o} {iid} {mes} {v}")
    cert.append({'obra_id': o, 'item_id': iid, 'mes': mes, 'cant_certificada': v,
                 'observacion': ' | '.join(sorted(obs_de[(o, iid, mes)]))[:500],
                 'nro_certificado': '', 'guardado_por': 'migracion-powerbi'})

# tope (mismo criterio que fn_tope_certificacion)
tot = collections.defaultdict(float)
for c in cert:
    tot[(c['obra_id'], c['item_id'])] += c['cant_certificada']
fuera = set()
for k, t in tot.items():
    i = K[k]
    contractual = i['cant_convenio'] if i['cant_convenio'] is not None else i['cant_contrato']
    tope = contractual if obras[k[0]]['tipo_obra'] == 'publica' else (
        i['cant_ajustada'] if i['cant_ajustada'] is not None else contractual)
    if t > (tope or 0) + 0.0001:
        fuera.add(k)
        aviso['cert_sobre_tope'].append(f"{k[0]} {k[1]}: certificado {round(t, 4)} > tope {tope} ({i['um']})")
cert_ok = [c for c in cert if (c['obra_id'], c['item_id']) not in fuera]
cert_fuera = [c for c in cert if (c['obra_id'], c['item_id']) in fuera]

# ------------------------------------------------------------------ salida
for t, rows in [('produccion_jornada', jornadas), ('produccion_fila', filas),
                ('certificacion_pbi', cert_ok), ('certificacion_sobre_tope', cert_fuera)]:
    json.dump(rows, open(OUT / f'{t}.json', 'w', encoding='utf-8'), ensure_ascii=False)

res = {'jornadas': len(jornadas), 'jornadas_sin_filas': sum(1 for j in jornadas if not any(True for _ in ())),
       'filas': len(filas), 'certificacion': len(cert_ok), 'cert_sobre_tope_filas': len(cert_fuera),
       'cert_sobre_tope_items': len(fuera)}
con_filas = {(f['obra_id'], f['submission_id']) for f in filas}
res['jornadas_sin_filas'] = sum(1 for j in jornadas if (j['obra_id'], j['submission_id']) not in con_filas)
por_obra = collections.defaultdict(lambda: collections.Counter())
for j in jornadas:
    por_obra[j['obra_id']]['jornadas'] += 1
for f in filas:
    por_obra[f['obra_id']]['filas'] += 1
for c in cert_ok:
    por_obra[c['obra_id']]['cert'] += 1
for c in cert_fuera:
    por_obra[c['obra_id']]['cert_fuera'] += 1
json.dump({'resumen': res, 'por_obra': por_obra, 'avisos': aviso},
          open(OUT / 'reporte_produccion.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(res, indent=1))
for o, c in sorted(por_obra.items()):
    print(o, obras[o]['nombre'], dict(c))
for k, v in aviso.items():
    print(f'[{k}] {len(v)}', *v[:5], sep='\n   ')
