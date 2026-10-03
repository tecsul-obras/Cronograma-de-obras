/* =========================================================================
 * api.js — cliente de la PWA hacia SUPABASE  (v20261003a · etapa 1: lectura)
 *
 * ÚNICA costura entre la PWA y el backend. Reemplaza al cliente del Apps Script
 * manteniendo EXACTAMENTE las mismas funciones (ObraAPI.*) y las mismas formas
 * de datos que devolvía Codigo.gs. app.js — y con él el Gantt — no cambia.
 *
 * Etapa 1 (este archivo): login, whoami, listObras, getObra (completo: ítems con
 * cascada de cantidades, avance por producción con rollup a padres, ejecución
 * semanal, certificación por mes, líneas base, config, calendario, clima, plazo
 * y convenios), presencia, convListar y plazoCalc.
 * Las escrituras responden "todavía no disponible" hasta las etapas 3-5.
 *
 * Fuente de verdad de las reglas: Codigo.gs / Code_Producción.gs v20260904a.
 * Cada bloque indica la función de origen que replica.
 * ========================================================================= */
(function (global) {

  // ---- CONFIGURACIÓN ----
  // La clave publicable va en el código a propósito (igual que en la PWA de
  // partes): lo que protege los datos son las políticas RLS de la base.
  var SUPABASE_URL = 'https://sququxlqcrbsoqvmycfa.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_pN_FUHE3sbU98ReSQriUpg_zQeBko7R';
  var DOMINIO      = 'tecsul.com.py';       // "jose.espinola" → jose.espinola@tecsul.com.py
  var STORAGE_KEY  = 'cronograma-auth';     // dónde guarda la sesión supabase-js
  var PAGINA       = 1000;                  // filas por pedido (límite de PostgREST)
  var CONV_ESTADOS = ['en_tramite', 'aprobado', 'rechazado'];
  var CONV_TOPE_PCT = 0.20;                 // tope legal MOPC: 20 % del monto original
  var VERSION      = 'supabase-v20261003a';

  var OBRA_ID = '1012500000';
  try { var _lastObra = localStorage.getItem('obra_current'); if (_lastObra) OBRA_ID = _lastObra; } catch (e) {}

  var sb = null;
  try {
    sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY }
    });
  } catch (e) {
    console.error('[ObraAPI] no se pudo crear el cliente Supabase', e);
  }

  function config(url, obraId) { if (obraId) OBRA_ID = obraId; }
  function getObraId() { return OBRA_ID; }
  function setObraId(id) { OBRA_ID = id; try { localStorage.setItem('obra_current', id); } catch (e) {} }

  var BASE_REV = null;
  function setBaseRev(r) { BASE_REV = (r === undefined || r === null || r === '') ? null : Number(r); }
  function getBaseRev() { return BASE_REV; }

  // ---------------------------------------------------------------- errores
  // Mismo contrato que el cliente viejo: 'auth_required' muestra el login.
  function errAuth() {
    if (global.__showLogin) global.__showLogin();
    return new Error('auth_required');
  }
  function traducir(error, contexto) {
    var msg = (error && (error.message || error.details)) || String(error);
    var code = error && error.code;
    if (code === 'PGRST301' || code === '401' || /jwt|not authenticated|invalid claim/i.test(msg)) return errAuth();
    var e = new Error((contexto ? contexto + ': ' : '') + msg);
    if (/fetch|network|failed to fetch|load failed/i.test(msg)) e.transitorio = true;
    return e;
  }
  function pendiente(nombre) {
    return Promise.reject(new Error('Todavía no disponible en la versión Supabase: ' + nombre +
      '. Llega en una próxima etapa de la migración.'));
  }

  function haySesion() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
  }
  async function exigirSesion() {
    if (!sb) throw new Error('No se pudo iniciar la conexión con Supabase');
    var r = await sb.auth.getSession();
    if (!r.data || !r.data.session) throw errAuth();
  }

  // Lee TODAS las filas (PostgREST corta en 1000 por pedido).
  async function todo(tabla, columnas, filtro, orden) {
    var out = [], desde = 0;
    for (;;) {
      var q = sb.from(tabla).select(columnas);
      if (filtro) q = filtro(q);
      (orden || []).forEach(function (o) { q = q.order(o, { ascending: true }); });
      var r = await q.range(desde, desde + PAGINA - 1);
      if (r.error) throw traducir(r.error, tabla);
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < PAGINA) return out;
      desde += PAGINA;
    }
  }
  function deObra(oid) { return function (q) { return q.eq('obra_id', String(oid)); }; }

  // ------------------------------------------------- utilidades (Codigo.gs)
  function nid_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function nnum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function nmes_(v) {
    if (v === null || v === undefined || v === '') return '';
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-\/](\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + parseInt(m[2], 10)).slice(-2);
    m = s.match(/^(\d{1,2})[-\/](\d{4})$/);
    if (m) return m[2] + '-' + ('0' + parseInt(m[1], 10)).slice(-2);
    return s;
  }
  function pad2(n) { return ('0' + n).slice(-2); }
  function ymdLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // Copia literal de isoWeek_: con una fecha 'yyyy-mm-dd' en el navegador
  // (zona de Paraguay) da exactamente la misma semana que daba Apps Script.
  function isoWeek_(d) {
    if (!(d instanceof Date)) { if (!d) return null; d = new Date(d); }
    var t = new Date(d.getTime()); var day = (t.getDay() + 6) % 7; t.setDate(t.getDate() - day + 3);
    var firstThu = new Date(t.getFullYear(), 0, 4);
    var week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + ('0' + week).slice(-2);
  }
  function esGrupoVal(v) { return v === 1 || v === '1' || v === true || v === 'true'; }
  // Los valores de Config vivían en celdas de Sheets: los números llegaban como
  // números. En Postgres son texto; se devuelven con el mismo tipo de antes.
  function valorConfig(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s);
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    return s;
  }
  // claseDiaClima_
  function claseDiaClima_(estado) {
    var s = String(estado || '').toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').trim();
    if (!s) return '';
    if (s.indexOf('lluvia') > -1) return 'lluvia';
    if (s.indexOf('humedad') > -1 || s.indexOf('umedad') > -1) return 'humedad';
    if (s.indexOf('receso') > -1) return 'receso';
    return 'trabajado';
  }
  // Vocabulario: el esquema SQL usa borrador/presentado; el front, en_tramite.
  function estadoConvenio(e) {
    e = String(e || '').trim().toLowerCase();
    if (e === 'aprobado' || e === 'rechazado') return e;
    return 'en_tramite';
  }
  function tipoDetalleConvenio(t) {
    t = String(t || '').trim().toLowerCase();
    if (t === 'item_nuevo' || t === 'supresion') return t;
    return 'modificacion';
  }

  // ------------------------------------------------------ plazo (calcPlazo_)
  function convFecha_(v) {
    if (v === null || v === undefined || v === '') return null;
    var m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function convSumarDias_(fecha, dias) {
    if (!fecha) return null;
    var d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    d.setDate(d.getDate() + Math.round(Number(dias) || 0));
    return d;
  }
  function convTipoItem_(it) {
    var t = String((it && it.tipo) || '').trim().toLowerCase();
    if (t) return t;
    return esGrupoVal(it && it.es_grupo) ? 'grupo' : 'item';
  }
  function convComputable_(it) {
    var t = convTipoItem_(it);
    return !(t === 'grupo' || t === 'actividad' || t === 'hito' || t === 'subdivision');
  }

  function calcPlazo(obra, items, convs, det) {
    obra = obra || {};
    var diasPorMes = nnum_(obra.dias_por_mes) || 30;
    var plazoMeses = nnum_(obra.plazo_meses) || 0;
    var plazoDias  = Math.round(plazoMeses * diasPorMes);
    var inicio     = convFecha_(obra.fecha_inicio);
    var finOriginal = convFecha_(obra.fecha_fin);
    if (!finOriginal && inicio && plazoDias) finOriginal = convSumarDias_(inicio, plazoDias);

    var pu = {}, base = {}, comput = {};
    items.forEach(function (it) {
      var id = nid_(it.item_id); if (!id) return;
      pu[id] = nnum_(it.precio_unit); base[id] = nnum_(it.cant_contrato); comput[id] = convComputable_(it);
    });
    function monto(acum, puMap) {
      var s = 0;
      Object.keys(acum).forEach(function (id) {
        if (comput[id] === false) return;
        s += (acum[id] || 0) * (puMap[id] != null ? puMap[id] : (pu[id] || 0));
      });
      return s;
    }
    var montoOriginal = monto(base, pu);

    var detBy = {};
    (det || []).forEach(function (d) { var c = String(d.convenio_id || ''); (detBy[c] = detBy[c] || []).push(d); });
    var ordenados = (convs || []).filter(function (c) { return String(c.convenio_id || '').trim() !== ''; })
      .slice().sort(function (a, b) {
        var oa = nnum_(a.orden) || 0, ob = nnum_(b.orden) || 0;
        if (oa !== ob) return oa - ob;
        return String(a.convenio_id).localeCompare(String(b.convenio_id));
      });

    var acumApr = {}, acumEsc = {}, puApr = {}, puEsc = {};
    Object.keys(base).forEach(function (id) { acumApr[id] = base[id]; acumEsc[id] = base[id]; });
    Object.keys(pu).forEach(function (id) { puApr[id] = pu[id]; puEsc[id] = pu[id]; });
    function aplicar(acum, puMap, filas) {
      (filas || []).forEach(function (d) {
        var id = nid_(d.item_id); if (!id) return;
        acum[id] = nnum_(d.cant);
        var p = d.pu;
        if (p !== null && p !== undefined && p !== '') { puMap[id] = nnum_(p); if (pu[id] == null) pu[id] = nnum_(p); }
        if (comput[id] === undefined) comput[id] = true;
      });
    }
    var diasAcumApr = 0, diasAcumEsc = 0, calcAcumApr = 0, calcAcumEsc = 0, pctPrevApr = 0, pctPrevEsc = 0;

    var pasos = ordenados.map(function (c) {
      var cid = String(c.convenio_id || '');
      var estado = estadoConvenio(c.estado);
      var filas = detBy[cid] || [];
      var esAmpliacionSola = String(c.tipo || '').trim().toLowerCase() === 'ampliacion_informal';
      var pctAcum = 0, diasCalc = 0, diasAcumTeorico = 0, pctIncr = 0;
      if (estado !== 'rechazado') {
        if (estado === 'aprobado') { aplicar(acumApr, puApr, filas); aplicar(acumEsc, puEsc, filas); }
        else aplicar(acumEsc, puEsc, filas);
        if (esAmpliacionSola) { pctAcum = 0; diasCalc = 0; }
        else if (estado === 'aprobado') {
          var mApr = monto(acumApr, puApr);
          pctAcum = montoOriginal ? (mApr - montoOriginal) / montoOriginal : 0;
          pctIncr = pctAcum - pctPrevApr; pctPrevApr = pctAcum; pctPrevEsc = Math.max(pctPrevEsc, pctAcum);
          diasAcumTeorico = Math.max(0, Math.floor(pctAcum * plazoDias));          // TRUNCAR
          diasCalc = Math.max(0, diasAcumTeorico - calcAcumApr);                    // nunca acorta
          calcAcumApr += diasCalc; calcAcumEsc = Math.max(calcAcumEsc, calcAcumApr);
        } else {
          var mEsc = monto(acumEsc, puEsc);
          pctAcum = montoOriginal ? (mEsc - montoOriginal) / montoOriginal : 0;
          pctIncr = pctAcum - pctPrevEsc; pctPrevEsc = pctAcum;
          diasAcumTeorico = Math.max(0, Math.floor(pctAcum * plazoDias));
          diasCalc = Math.max(0, diasAcumTeorico - calcAcumEsc); calcAcumEsc += diasCalc;
        }
      }
      var dAmpRaw = c.dias_ampliacion;
      var dAmp = (dAmpRaw === null || dAmpRaw === undefined || dAmpRaw === '') ? diasCalc : Math.max(0, Math.round(nnum_(dAmpRaw)));
      if (estado === 'rechazado') dAmp = 0;
      if (estado === 'aprobado') { diasAcumApr += dAmp; diasAcumEsc = Math.max(diasAcumEsc, diasAcumApr); }
      else if (estado === 'en_tramite') { diasAcumEsc += dAmp; }
      var acumHastaAca = (estado === 'aprobado') ? diasAcumApr : (estado === 'en_tramite') ? diasAcumEsc : diasAcumApr;
      var finHastaAca = finOriginal ? convSumarDias_(finOriginal, acumHastaAca) : null;
      return {
        convenio_id: cid, orden: nnum_(c.orden) || 0, nro: String(c.nro || ''),
        tipo: String(c.tipo || 'modificatorio'), estado: estado,
        fecha_presentacion: c.fecha_presentacion || null, fecha_resolucion: c.fecha_resolucion || null,
        descripcion: String(c.descripcion || ''), doc_url: String(c.doc_url || ''),
        monto_original: montoOriginal,
        monto_convenio: (estado === 'aprobado') ? monto(acumApr, puApr) : (estado === 'en_tramite') ? monto(acumEsc, puEsc) : montoOriginal,
        pct_acumulado: pctAcum, pct_incremento: pctIncr,
        dias_calculados: diasCalc, dias_ampliacion: dAmp, dias_difieren: (dAmp !== diasCalc),
        dias_acumulados: acumHastaAca,
        fecha_fin_contrato: finHastaAca ? ymdLocal(finHastaAca) : null,
        supera_tope: pctAcum > CONV_TOPE_PCT, items_afectados: filas.length
      };
    });
    var finVigente = finOriginal ? convSumarDias_(finOriginal, diasAcumApr) : null;
    var pctVigente = 0;
    for (var k = pasos.length - 1; k >= 0; k--) { if (pasos[k].estado === 'aprobado') { pctVigente = pasos[k].pct_acumulado; break; } }
    return {
      fecha_inicio: inicio ? ymdLocal(inicio) : null, plazo_meses: plazoMeses, dias_por_mes: diasPorMes,
      plazo_dias_original: plazoDias, fin_original: finOriginal ? ymdLocal(finOriginal) : null,
      dias_ampliacion_total: diasAcumApr, dias_escenario_total: diasAcumEsc,
      fin_vigente: finVigente ? ymdLocal(finVigente) : null,
      fin_escenario: finOriginal ? ymdLocal(convSumarDias_(finOriginal, diasAcumEsc)) : null,
      monto_original: montoOriginal, monto_vigente: monto(acumApr, puApr),
      pct_vigente: pctVigente, supera_tope: pctVigente > CONV_TOPE_PCT, tope_pct: CONV_TOPE_PCT,
      convenios: pasos
    };
  }

  // --------------------------------------------------------- clima (leerClimaRaw_)
  function armarClima(jornadas) {
    var porDia = {}, rank = { lluvia: 3, humedad: 2, receso: 1 };
    jornadas.forEach(function (j) {
      var cls = claseDiaClima_(j.estado);
      if (cls !== 'lluvia' && cls !== 'humedad' && cls !== 'receso') return;
      var day = j.fecha; if (!day) return;
      var mm = nnum_(j.lluvia_mm);
      var prev = porDia[day];
      if (!prev || rank[cls] > rank[prev.cls]) porDia[day] = { cls: cls, mm: mm };
      else if (prev && mm > prev.mm) prev.mm = mm;
    });
    var out = {};
    Object.keys(porDia).forEach(function (day) {
      var mk = day.slice(0, 7);
      var o = out[mk] || (out[mk] = { lluvia: 0, humedad: 0, receso: 0, mm: 0, dias: {}, mmDia: {} });
      var cls = porDia[day].cls;
      o[cls]++; o.mm += (porDia[day].mm || 0); o.dias[day] = cls; o.mmDia[day] = porDia[day].mm || 0;
    });
    return out;
  }

  // -------------------------------------------------------- revisión de la obra
  function revisionDe(o) {
    o = o || {};
    var ts = '';
    if (o.rev_ts) {
      var d = new Date(o.rev_ts);
      if (!isNaN(d.getTime())) ts = ymdLocal(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return { rev: nnum_(o.rev) || 0, por: String(o.rev_por || ''), ts: ts };
  }

  // ======================================================= getObra (getObra_)
  async function getObra(obraId) {
    await exigirSesion();
    var oid = String(obraId !== undefined ? obraId : OBRA_ID);

    var r = await Promise.all([
      sb.from('obra').select('*').eq('obra_id', oid).maybeSingle(),
      todo('item', '*', deObra(oid), ['orden', 'item_id']),
      todo('distribucion_mensual', 'item_id,mes,cant', deObra(oid), ['item_id', 'mes']),
      todo('item_dependencia', 'item_id,pred_id,tipo,lag_dias', deObra(oid), ['item_id', 'pred_id']),
      todo('categoria', 'nombre,orden', deObra(oid), ['orden', 'nombre']),
      todo('plan_semanal', '*', deObra(oid), ['semana', 'plan_id']),
      todo('linea_base', '*', deObra(oid), ['fecha_snapshot', 'baseline_id']),
      todo('linea_base_detalle', '*', deObra(oid), ['baseline_id', 'item_id']),
      todo('certificacion', 'item_id,mes,cant_certificada', deObra(oid), ['item_id', 'mes']),
      todo('config', 'obra_id,clave,valor', function (q) { return q.or('obra_id.is.null,obra_id.eq.' + oid); }, ['clave']),
      todo('calendario', 'fecha,tipo,descripcion', deObra(oid), ['fecha']),
      todo('convenio', '*', deObra(oid), ['orden', 'convenio_id']),
      todo('convenio_detalle', '*', deObra(oid), ['convenio_id', 'item_id'])
    ]);
    if (r[0].error) throw traducir(r[0].error, 'obra');
    var obra = r[0].data || {};
    var items = r[1], dist = r[2], deps = r[3], cats = r[4], weekly = r[5];
    var blH = r[6], blD = r[7], certRows = r[8], cfgRows = r[9], calRows = r[10], convRows = r[11], convDetRows = r[12];

    // config: la global primero, la de la obra pisa (leerConfigObra_)
    var cfg = {};
    cfgRows.forEach(function (c) { if (c.obra_id === null) cfg[c.clave] = valorConfig(c.valor); });
    cfgRows.forEach(function (c) { if (c.obra_id !== null) cfg[c.clave] = valorConfig(c.valor); });

    // producción: si la obra es una copia, se lee la de la obra de origen
    var obraProd = cfg['prod:obra_origen'] ? String(cfg['prod:obra_origen']) : oid;
    var pr = await Promise.all([
      todo('produccion_jornada', 'submission_id,fecha,estado,lluvia_mm', deObra(obraProd), ['fecha', 'submission_id']),
      todo('produccion_fila', 'submission_id,item_id,cantidad', deObra(obraProd), ['submission_id', 'fila_nro'])
    ]);
    var jornadas = pr[0], filas = pr[1];
    var fechaDe = {};
    jornadas.forEach(function (j) { fechaDe[j.submission_id] = j.fecha; });

    var distByItem = {};
    dist.forEach(function (d) {
      var id = nid_(d.item_id); var mk = nmes_(d.mes);
      if (mk) (distByItem[id] = distByItem[id] || {})[mk] = nnum_(d.cant);
    });
    var depByItem = {};
    deps.forEach(function (d) {
      var id = nid_(d.item_id);
      (depByItem[id] = depByItem[id] || []).push({ id: nid_(d.pred_id), type: String(d.tipo || 'FS'), lag: nnum_(d.lag_dias) });
    });

    var validItemIds = {};
    items.forEach(function (it) { validItemIds[nid_(it.item_id)] = true; });
    var prod = {};
    function addProd_(id, day, q) {
      if (!id || !day || !q) return;
      var p = prod[id] || (prod[id] = { total: 0, by_date: {} });
      p.total += q; p.by_date[day] = (p.by_date[day] || 0) + q;
    }
    filas.forEach(function (f) {
      var id = nid_(f.item_id);
      if (!validItemIds[id]) return;
      addProd_(id, fechaDe[f.submission_id], nnum_(f.cantidad));
    });

    var certByItem = {}, certByItemMes = {};
    certRows.forEach(function (c) {
      var id = nid_(c.item_id); if (!id) return;
      var mk = nmes_(c.mes); var q = nnum_(c.cant_certificada);
      certByItem[id] = (certByItem[id] || 0) + q;
      if (mk) (certByItemMes[id] = certByItemMes[id] || {})[mk] = ((certByItemMes[id] || {})[mk] || 0) + q;
    });

    // ---- propagación de subdivisiones al ítem padre (igual que getObra_) ----
    function kid_(v) { return nid_(v).replace(/,/g, '.'); }
    var itemPorId_ = {}, esGrupoId_ = {}, idRealDe_ = {};
    items.forEach(function (it) {
      var k = kid_(it.item_id); if (!k) return;
      itemPorId_[k] = it; idRealDe_[k] = nid_(it.item_id);
      var t = String(it.tipo || '').trim().toLowerCase();
      esGrupoId_[k] = (t === 'grupo') || (!t && esGrupoVal(it.es_grupo));
    });
    function padreItemDe_(k) {
      var it = itemPorId_[k]; if (!it) return null;
      var p = (it.padre_id != null && it.padre_id !== '') ? kid_(it.padre_id) : null;
      if (!p || !itemPorId_[p] || esGrupoId_[p]) return null;
      return p;
    }
    var prodPropia_ = {};
    Object.keys(prod).forEach(function (id) {
      var bd = {}, src = prod[id].by_date || {};
      Object.keys(src).forEach(function (d) { bd[d] = src[d]; });
      prodPropia_[kid_(id)] = { total: prod[id].total, by_date: bd };
    });
    Object.keys(prodPropia_).forEach(function (subK) {
      var ps = prodPropia_[subK];
      if (!ps || !ps.total) return;
      var visto = {}; visto[subK] = true;
      var padreK = padreItemDe_(subK);
      while (padreK && !visto[padreK]) {
        visto[padreK] = true;
        var pid = idRealDe_[padreK] || padreK;
        var pp = prod[pid] || (prod[pid] = { total: 0, by_date: {} });
        pp.total += ps.total;
        Object.keys(ps.by_date).forEach(function (d) { pp.by_date[d] = (pp.by_date[d] || 0) + ps.by_date[d]; });
        padreK = padreItemDe_(padreK);
      }
    });

    var itemsOut = items.map(function (it) {
      var id = nid_(it.item_id);
      var av = null, prd = prod[id];
      var cantC = nnum_(it.cant_contrato);
      var cantCv = it.cant_convenio == null ? null : nnum_(it.cant_convenio);
      var cantA = it.cant_ajustada == null ? null : nnum_(it.cant_ajustada);
      var puC = nnum_(it.precio_unit);
      var cantCtr = (cantCv != null) ? cantCv : cantC;          // contractual
      var cantVig = (cantA != null) ? cantA : cantCtr;          // vigente (0 explícito vale 0)
      if (prd && cantVig) av = prd.total / cantVig * 100;
      return {
        id: id,
        desc: it.descripcion, id_nivel3: it.id_nivel3, desc_nivel3: it.desc_nivel3,
        codigo_cc: it.codigo_cc, um: it.um,
        cant_contrato: cantC, cant_convenio: cantCv, cant_contractual: cantCtr, cant_ajustada: cantA,
        precio_unit: puC, precio_total: cantC * puC,
        incidencia: it.incidencia == null ? null : nnum_(it.incidencia),
        categoria: it.categoria, estado: it.estado,
        fecha_ini: it.fecha_ini || null, fecha_fin: it.fecha_fin || null,
        real_start: it.fecha_ini || null, real_end: it.fecha_fin || null,
        dependencia: null,
        deps: depByItem[id] || [],
        avance_esperado: it.avance_esperado == null ? null : nnum_(it.avance_esperado),
        avance_manual: it.avance_manual == null ? null : nnum_(it.avance_manual),
        avance_real_prod: av == null ? null : Math.round(av * 100) / 100,
        cant_certificada_acum: certByItem[id] || 0,
        cert_por_mes: certByItemMes[id] || {},
        nivel: parseInt(it.nivel, 10) || 1,
        es_grupo: esGrupoVal(it.es_grupo),
        tipo: (function () {
          var t = String(it.tipo || '').trim().toLowerCase();
          if (t) return t;
          return esGrupoVal(it.es_grupo) ? 'grupo' : 'item';
        })(),
        padre_id: it.padre_id != null && it.padre_id !== '' ? nid_(it.padre_id) : null,
        dist_mensual: distByItem[id] || {}
      };
    });

    // plan semanal + ejecutado real por ítem y semana ISO
    var execByItemWeek = {};
    Object.keys(prod).forEach(function (id) {
      var byd = prod[id].by_date || {};
      Object.keys(byd).forEach(function (day) {
        var wk = isoWeek_(day); if (!wk) return;
        var k = id + '|' + wk;
        execByItemWeek[k] = (execByItemWeek[k] || 0) + (byd[day] || 0);
      });
    });
    var weeklyOut = weekly.map(function (w) {
      var k = nid_(w.item_id) + '|' + String(w.semana);
      return {
        plan_id: String(w.plan_id || ''), item_id: nid_(w.item_id), actividad: w.actividad, frente: w.frente, um: w.um,
        week: String(w.semana), month: nmes_(w.mes || ''),
        cant_prevista: w.cant_prevista == null ? null : nnum_(w.cant_prevista),
        cant_ejecutada: execByItemWeek[k] != null ? execByItemWeek[k] : null,   // sin redondeo (la versión Sheets redondeaba a 2 decimales)
        causa: w.causa,
        mesSplit: w.split || {},
        _man: w.manual === true
      };
    });

    // líneas base
    var detByBl = {};
    blD.forEach(function (d) {
      (detByBl[String(d.baseline_id)] = detByBl[String(d.baseline_id)] || {})[String(d.item_id)] = {
        ini: d.fecha_ini || null, fin: d.fecha_fin || null, cant: nnum_(d.cant),
        cant_convenio: d.cant_convenio == null ? null : nnum_(d.cant_convenio),
        dist: d.dist || {}
      };
    });
    var baselinesOut = blH.map(function (b) {
      var tlb = String(b.tipo || '').trim().toLowerCase();
      return { id: String(b.baseline_id), name: b.nombre, date: b.fecha_snapshot || null,
               tipo_lb: tlb || 'replanificacion',
               convenio_id: (b.convenio_id != null && b.convenio_id !== '') ? String(b.convenio_id) : null,
               items: detByBl[String(b.baseline_id)] || {} };
    });

    var calendario = {};
    calRows.forEach(function (c) {
      var t = String(c.tipo || '').trim().toLowerCase();
      if (t !== 'laborable' && t !== 'no_laborable') t = 'feriado';
      calendario[c.fecha] = { tipo: t, desc: String(c.descripcion || '') };
    });

    var plazo = calcPlazo(obra, items, convRows, convDetRows);
    var convDet = convDetRows.map(function (d) {
      return { convenio_id: String(d.convenio_id), item_id: nid_(d.item_id), tipo: tipoDetalleConvenio(d.tipo),
               cant: nnum_(d.cant), pu: d.pu == null ? null : nnum_(d.pu) };
    });

    var revision = revisionDe(obra);
    setBaseRev(revision.rev);

    return {
      obra: {
        id: oid, nombre: obra.nombre || oid,
        fecha_inicio: obra.fecha_inicio || null, fecha_fin: obra.fecha_fin || null,
        tipo_obra: String(obra.tipo_obra || '').trim().toLowerCase() || 'privada',
        plazo_meses: obra.plazo_meses == null ? null : nnum_(obra.plazo_meses),
        dias_por_mes: obra.dias_por_mes == null ? 30 : nnum_(obra.dias_por_mes),
        fin_original: plazo ? plazo.fin_original : null,
        fin_vigente: plazo ? plazo.fin_vigente : null
      },
      revision: revision,
      plazo: plazo,
      convenios: plazo.convenios,
      convenio_detalle: convDet,
      items: itemsOut,
      weekly: weeklyOut,
      production: prod,
      production_rollup: 'padre_id_v2',     // no tocar sin tocar app.js
      categorias: cats.map(function (c) { return c.nombre; }),
      baselines: baselinesOut,
      config: cfg,
      clima: armarClima(jornadas),
      calendario: calendario,
      _ts: new Date().toISOString(),
      _backend: VERSION
    };
  }

  async function datosPlazo(obraId) {
    await exigirSesion();
    var oid = String(obraId !== undefined ? obraId : OBRA_ID);
    var r = await Promise.all([
      sb.from('obra').select('*').eq('obra_id', oid).maybeSingle(),
      todo('item', 'item_id,cant_contrato,precio_unit,tipo,es_grupo', deObra(oid), ['orden', 'item_id']),
      todo('convenio', '*', deObra(oid), ['orden', 'convenio_id']),
      todo('convenio_detalle', '*', deObra(oid), ['convenio_id', 'item_id'])
    ]);
    if (r[0].error) throw traducir(r[0].error, 'obra');
    return { plazo: calcPlazo(r[0].data || {}, r[1], r[2], r[3]), det: r[3] };
  }

  // ================================================================== API
  var API = {
    config: config,
    getObraId: getObraId,
    setObraId: setObraId,
    get url() { return SUPABASE_URL; },
    version: VERSION,

    login: async function (usuario, pass) {
      if (!sb) throw new Error('No se pudo iniciar la conexión con Supabase');
      var u = String(usuario || '').trim().toLowerCase();
      var email = u.indexOf('@') >= 0 ? u : (u + '@' + DOMINIO);
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) {
        throw new Error(/invalid/i.test(r.error.message || '') ? 'Usuario o contraseña incorrectos'
                                                             : ('No se pudo iniciar sesión: ' + r.error.message));
      }
      var w = await sb.rpc('app_whoami');
      if (w.error || !w.data) {
        await sb.auth.signOut();
        throw new Error('Tu usuario no está habilitado en el cronograma. Pedí el alta al administrador.');
      }
      return { usuario: w.data.email, rol: w.data.rol };
    },
    logout: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      if (sb) sb.auth.signOut().catch(function () {});
    },
    hasToken: function () { return haySesion(); },

    whoami: async function () {
      await exigirSesion();
      var r = await sb.rpc('app_whoami');
      if (r.error) throw traducir(r.error, 'whoami');
      if (!r.data) {
        API.logout();
        throw errAuth();
      }
      // el front conoce admin / residente / lectura: 'consulta' se comporta como lectura
      var rol = r.data.rol === 'consulta' ? 'lectura' : r.data.rol;
      return { user: r.data.nombre || r.data.email, role: rol, email: r.data.email,
               obras: (r.data.obras || []).join(',') };
    },
    listObras: async function () {
      await exigirSesion();
      var r = await sb.from('obra').select('obra_id,nombre,lote,activo,tipo_obra').order('obra_id');
      if (r.error) throw traducir(r.error, 'listObras');
      return (r.data || []).map(function (o) {
        return { obra_id: o.obra_id, nombre: o.nombre || o.obra_id, lote: o.lote, activo: o.activo,
                 tipo_obra: String(o.tipo_obra || '').trim().toLowerCase() || 'privada' };
      });
    },
    getObra: getObra,
    getBaseRev: getBaseRev,
    setBaseRev: setBaseRev,
    // Presencia en vivo llega con Supabase Realtime (etapa 3). Por ahora informa
    // la revisión vigente, que es lo que la PWA usa para avisar cambios ajenos.
    presencia: async function (obraId) {
      await exigirSesion();
      var oid = String(obraId !== undefined ? obraId : OBRA_ID);
      var r = await sb.from('obra').select('rev,rev_por,rev_ts').eq('obra_id', oid).maybeSingle();
      if (r.error) throw traducir(r.error, 'presencia');
      return { otros: [], editores: 0, misOtrasPestanas: 0, revision: revisionDe(r.data) };
    },

    // ---- etapa 3: escrituras del cronograma ----
    crearObra: function () { return pendiente('crear obra'); },
    duplicarObra: function () { return pendiente('duplicar obra'); },
    eliminarObra: function () { return pendiente('eliminar obra'); },
    saveItems: function () { return pendiente('guardar el cronograma'); },
    saveItemsParcial: function () { return pendiente('guardar el cronograma'); },
    firma: function (obj) {
      var str = JSON.stringify(obj), h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      return h.toString(36) + ':' + str.length;
    },
    deleteItems: function () { return pendiente('borrar ítems'); },
    saveWeekly: function () { return pendiente('guardar el plan semanal'); },
    saveBaseline: function () { return pendiente('crear línea base'); },
    borrarBaseline: function () { return pendiente('borrar línea base'); },
    saveConfig: function () { return pendiente('guardar configuración'); },
    saveCalendario: function () { return pendiente('guardar calendario'); },
    saveCategorias: function () { return pendiente('guardar categorías'); },
    refreshProduccion: function () { return Promise.resolve(0); },   // ya no hay planilla externa
    saveObra: function () { return pendiente('guardar datos de la obra'); },

    // ---- etapa 4: producción, certificación, comunicaciones, pista ----
    prodListas: function () { return pendiente('producción'); },
    _rawProdGuardar: function () { return pendiente('guardar producción'); },
    prodGuardar: function () { return pendiente('guardar producción'); },
    prodHistorial: function () { return pendiente('historial de producción'); },
    prodEditar: function () { return pendiente('editar producción'); },
    prodBorrar: function () { return pendiente('borrar producción'); },
    certListar: function () { return pendiente('certificación'); },
    certGuardar: function () { return pendiente('guardar certificación'); },
    comListar: function () { return pendiente('comunicaciones'); },
    comGuardar: function () { return pendiente('guardar comunicación'); },
    comCerrar: function () { return pendiente('cerrar comunicación'); },
    comBorrar: function () { return pendiente('borrar comunicación'); },
    pistaCargar: function () { return pendiente('situación de pista'); },
    pistaGuardarEjes: function () { return pendiente('guardar ejes'); },
    pistaGuardarEstados: function () { return pendiente('guardar estados de pista'); },
    pistaGuardarTramos: function () { return pendiente('guardar tramos'); },
    pistaSnapshot: function () { return pendiente('snapshot de pista'); },

    // ---- etapa 5: convenios (la lectura ya funciona) ----
    convListar: async function (obraId) {
      var d = await datosPlazo(obraId);
      return { plazo: d.plazo, detalle: d.det.map(function (x) {
        return { convenio_id: String(x.convenio_id), item_id: nid_(x.item_id), tipo: tipoDetalleConvenio(x.tipo),
                 cant: nnum_(x.cant), pu: x.pu == null ? null : nnum_(x.pu) };
      }) };
    },
    plazoCalc: async function (obraId) { return (await datosPlazo(obraId)).plazo; },
    convSugerir: function () { return pendiente('sugerir ítems de convenio'); },
    convPreview: function () { return pendiente('vista previa de convenio'); },
    convGuardar: function () { return pendiente('guardar convenio'); },
    convEstado: function () { return pendiente('cambiar estado de convenio'); },
    convBorrar: function () { return pendiente('borrar convenio'); },
    convVersion: function () { return pendiente('versiones de convenio'); },

    /* ---- serialización del modelo de app.js (sin cambios) ---- */
    serializeItems: function (ITEMS) {
      var items = [], dist = [], deps = [];
      ITEMS.forEach(function (i, k) {
        items.push({
          id: i.id, desc: i.desc, id_nivel3: i.id_nivel3 || '', desc_nivel3: i.desc_nivel3 || '',
          codigo_cc: i.codigo_cc || '', um: i.um || '', cant: i.cant || 0,
          // cant_convenio NO se serializa a propósito: es un caché derivado de
          // convenio_detalle y lo mantiene el backend.
          cant_ajustada: (i.cant_ajustada == null ? '' : i.cant_ajustada), pu: i.pu || 0,
          incidencia: (i.incidencia == null ? '' : i.incidencia),
          cat: i.cat || '', estado: i.estado || '',
          ini: i.ini || '', fin: i.fin || '', avance_esperado: (i.avE == null ? '' : i.avE),
          avance_manual: (i.avance_manual == null ? '' : i.avance_manual),
          nivel: i.nivel || 1, es_grupo: i.es_grupo ? 1 : '',
          tipo: i.tipo || '', padre_id: (i.padre_id != null && i.padre_id !== '' ? i.padre_id : ''),
          orden: k, _rev: i._rev || 0
        });
        Object.keys(i.dist_mensual || {}).forEach(function (m) {
          dist.push({ item_id: i.id, mes: m, cant: i.dist_mensual[m],
                      manual: !!(i._manualMonths && i._manualMonths[m]) });
        });
        (i.deps || []).forEach(function (dp) {
          deps.push({ item_id: i.id, pred_id: dp.id, tipo: dp.type || 'FS', lag_dias: dp.lag || 0 });
        });
      });
      return { items: items, dist: dist, deps: deps };
    },
    serializeWeekly: function (WEEKLY) {
      return WEEKLY.map(function (w) {
        return {
          plan_id: w.plan_id || '', item_id: w.item_id, actividad: w.actividad || '',
          frente: w.frente || '', um: w.um || '', week: w.week, month: w.month || '',
          cant_prevista: w.cant_prevista || 0, causa: w.causa || '',
          split_json: JSON.stringify(w.mesSplit || {}),
          manual: !!w._man, _rev: w._rev || 0
        };
      });
    },

    // acceso al cliente para el comparador y diagnósticos
    _sb: function () { return sb; },
    _calcPlazo: calcPlazo
  };

  global.ObraAPI = API;
})(window);
