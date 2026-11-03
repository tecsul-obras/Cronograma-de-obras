#!/usr/bin/env python3
# =========================================================================
#  cargar_historico_taller.py · v20261103c — HISTÓRICO DE MONDAY → tc_hist_fuente
#  Lee los Excel exportados de Monday (Pedidos Taller, Compras Taller, Caja
#  Chica, UCC, Consolidado, Traslados, Proveedores…) y los manda tal cual a
#  public.tc_hist_cargar (SQL 80), en lotes. No crea pedidos.
#
#    · una fila = (sha256 del archivo, hoja, fila de Excel): volver a correrlo
#      con el mismo archivo no duplica; si una fila cambió, la base la marca
#      «conflicto» (no la pisa);
#    · campos = {encabezado: valor} de la fila + «_grupo» (grupo de Monday);
#      las celdas vacías no se mandan;
#    · se saltan los títulos, los grupos, los encabezados repetidos y las
#      filas sin «Name».
#
#  Uso (necesita Python 3.9+ y openpyxl: pip install openpyxl):
#    python cargar_historico_taller.py "<carpeta con los .xlsx>"            → simulación: solo cuenta
#    python cargar_historico_taller.py "<carpeta>" --muestra salida.json     → además guarda las filas para revisar
#    python cargar_historico_taller.py "<carpeta>" --subir                   → carga (pide usuario y contraseña)
#  Solo el administrador (super) puede cargar. Los Excel y el .json NO van al
#  repositorio (es la carpeta pública de la app).
# =========================================================================
import argparse, datetime, decimal, getpass, glob, hashlib, json, os, sys, urllib.error, urllib.request

SUPABASE_URL = 'https://sququxlqcrbsoqvmycfa.supabase.co'
SUPABASE_KEY = 'sb_publishable_pN_FUHE3sbU98ReSQriUpg_zQeBko7R'   # la misma clave publicable de api.js
DOMINIO = 'tecsul.com.py'                                          # "jose.espinola" → jose.espinola@tecsul.com.py
LOTE = 500                                                         # la función acepta hasta 2.000


def sha256_archivo(ruta):
    h = hashlib.sha256()
    with open(ruta, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def valor(c):
    if c is None:
        return None
    if isinstance(c, datetime.datetime):
        return c.isoformat(sep=' ')
    if isinstance(c, (datetime.date, datetime.time)):
        return c.isoformat()
    if isinstance(c, decimal.Decimal):
        return float(c)
    if isinstance(c, float) and c.is_integer():
        return int(c)
    if isinstance(c, str):
        c = c.strip()
        return c or None
    return c


def leer_archivo(ruta):
    """Devuelve (filas, saltadas) de un .xlsx de Monday."""
    import openpyxl
    sha = sha256_archivo(ruta)
    nombre = os.path.basename(ruta)
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    filas, saltadas = [], 0

    def agregar(ws, n, vals, enc, grupo):
            campos = {}
            for k, v in zip(enc, vals):
                if v is None or not k:
                    continue
                if k in campos:                           # encabezado repetido: no perder el dato
                    i = 2
                    while '%s (%d)' % (k, i) in campos:
                        i += 1
                    k = '%s (%d)' % (k, i)
                campos[k] = v
            if grupo:
                campos['_grupo'] = grupo
            filas.append({'archivo': nombre, 'archivo_sha256': sha, 'hoja': ws.title, 'fila': n,
                          'source_id': None, 'campos': campos})

    for ws in wb.worksheets:
        enc, grupo = None, None
        suelta = None          # fila con un solo dato: es nombre de grupo si le sigue un encabezado; si no, es un ítem
        for n, r in enumerate(ws.iter_rows(values_only=True), start=1):
            vals = [valor(c) for c in r]
            llenas = [v for v in vals if v is not None]
            if not llenas:
                continue
            if vals[0] == 'Name':                         # encabezado (Monday lo repite en cada grupo)
                if suelta:
                    grupo = str(suelta[1][0])
                enc, suelta = [str(v) if v is not None else '' for v in vals], None
                continue
            if suelta:
                agregar(ws, suelta[0], suelta[1], enc, grupo)
                suelta = None
            if enc is None:                               # título del tablero antes del primer encabezado
                grupo = str(llenas[0])
                continue
            if vals[0] is None:                           # totales del grupo u otras filas sin ítem
                saltadas += 1
                continue
            if len(llenas) == 1:
                suelta = (n, vals)
                continue
            agregar(ws, n, vals, enc, grupo)
        if suelta:
            agregar(ws, suelta[0], suelta[1], enc, grupo)
    wb.close()
    return filas, saltadas


def pedir(url, cuerpo, token=None):
    h = {'apikey': SUPABASE_KEY, 'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=json.dumps(cuerpo, ensure_ascii=False, default=str).encode('utf-8'), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode('utf-8') or 'null')
    except urllib.error.HTTPError as e:
        det = e.read().decode('utf-8', 'replace')
        try:
            det = json.loads(det).get('message') or json.loads(det).get('error_description') or det
        except Exception:
            pass
        raise SystemExit('Error %s: %s' % (e.code, det))


def iniciar_sesion():
    usuario = input('Usuario (administrador): ').strip()
    if '@' not in usuario:
        usuario += '@' + DOMINIO
    clave = getpass.getpass('Contraseña: ')
    r = pedir(SUPABASE_URL + '/auth/v1/token?grant_type=password', {'email': usuario, 'password': clave})
    return r['access_token']


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='Carga el histórico de Monday (taller) a tc_hist_fuente.')
    ap.add_argument('carpeta', help='carpeta con los .xlsx exportados de Monday')
    ap.add_argument('--subir', action='store_true', help='cargar en la base (si no, solo simula)')
    ap.add_argument('--muestra', metavar='JSON', help='guardar las filas leídas en este archivo para revisarlas')
    a = ap.parse_args()

    archivos = sorted(glob.glob(os.path.join(a.carpeta, '*.xlsx')))
    if not archivos:
        raise SystemExit('No hay .xlsx en ' + a.carpeta)
    todas = []
    for ruta in archivos:
        filas, saltadas = leer_archivo(ruta)
        print('%-48s %6d filas%s' % (os.path.basename(ruta), len(filas), ('  (%d sin ítem, saltadas)' % saltadas) if saltadas else ''))
        todas += filas
    print('Total: %d filas en %d archivos.' % (len(todas), len(archivos)))

    if a.muestra:
        with open(a.muestra, 'w', encoding='utf-8') as f:
            json.dump(todas, f, ensure_ascii=False, indent=1, default=str)
        print('Filas guardadas en', a.muestra)
    if not a.subir:
        print('Simulación: no se cargó nada. Para cargar, agregá --subir.')
        return

    token = iniciar_sesion()
    tot = {'nuevos': 0, 'ya_estaban': 0, 'conflictos': 0}
    for i in range(0, len(todas), LOTE):
        r = pedir(SUPABASE_URL + '/rest/v1/rpc/tc_hist_cargar', {'p': todas[i:i + LOTE]}, token)
        for k in tot:
            tot[k] += r.get(k, 0)
        print('  lote %d-%d: %s' % (i + 1, min(i + LOTE, len(todas)), r))
    print('Listo: %(nuevos)d nuevas, %(ya_estaban)d ya estaban, %(conflictos)d en conflicto.' % tot)
    if tot['nuevos']:
        # SQL 86: tarda más que el límite de la API; se corre en el SQL Editor
        print('Hay filas nuevas: para juntarlas en un pedido por fila, corré en el SQL Editor de Supabase:')
        print('    select public.tc_hist_unificar(true);')
    print('Resumen en la base:')
    for x in pedir(SUPABASE_URL + '/rest/v1/rpc/tc_hist_resumen', {}, token) or []:
        print('  %-48s %6d filas · %d nuevas · %d conflictos' % (x['archivo'], x['filas'], x['nuevas'], x['conflictos']))


if __name__ == '__main__':
    main()
