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
 * Etapa 3 (v20261003c): guardar el cronograma (ítems, distribución, dependencias,
 * plan semanal, categorías, config, calendario, líneas base) y las obras, con control
 * de revisión.
 * Etapa 4 (v20261003d): producción (con fotos en Supabase Storage y cola offline),
 * certificación, comunicaciones y situación de pista. Convenios: etapa 5.
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
  var DOMINIO_CAMPO = 'campo.tecsul.com.py';   // usuarios de campo sin correo: <cédula>@campo.tecsul.com.py
  var DOMINIO      = 'tecsul.com.py';       // "jose.espinola" → jose.espinola@tecsul.com.py
  var STORAGE_KEY  = 'cronograma-auth';     // dónde guarda la sesión supabase-js
  var PAGINA       = 1000;                  // filas por pedido (límite de PostgREST)
  var CONV_ESTADOS = ['en_tramite', 'aprobado', 'rechazado'];
  var CONV_TOPE_PCT = 0.20;                 // tope legal MOPC: 20 % del monto original
  var VERSION      = 'supabase-v20261006j';

  var OBRA_ID = '1012500000';
  try { var _lastObra = localStorage.getItem('obra_current'); if (_lastObra) OBRA_ID = _lastObra; } catch (e) {}

  // Volver del correo de "olvidé mi contraseña": la URL trae type=recovery. Se
  // mira ANTES de crear el cliente, porque supabase-js limpia la URL al leerla.
  // También el enlace de INVITACIÓN (type=invite): el usuario nuevo entra y
  // elige su contraseña con la misma tarjeta (v20261006i).
  var RECUPERACION = false, INVITACION = false, ERROR_ENLACE = '';
  try {
    var _url = String(global.location.hash) + String(global.location.search);
    RECUPERACION = /type=(recovery|invite)/.test(_url);
    INVITACION = /type=invite/.test(_url);
    // enlace vencido o ya usado (#error=access_denied&error_code=otp_expired…)
    var _err = (_url.match(/error_code=([\w-]+)/) || [])[1] || ((_url.match(/[#&?]error=([\w-]+)/) || [])[1]);
    if (_err) {
      ERROR_ENLACE = /otp_expired|expired|invalid/i.test(_url)
        ? 'El enlace del correo venció o ya se usó (a veces el filtro del correo lo abre antes que vos).'
        : 'No se pudo usar el enlace del correo (' + _err + ').';
      try { global.history.replaceState(null, '', global.location.pathname + global.location.search); } catch (e) {}
    }
  } catch (e) {}

  var sb = null;
  try {
    sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY }
    });
    sb.auth.onAuthStateChange(function (evento) {
      if (evento === 'PASSWORD_RECOVERY') {
        RECUPERACION = true;
        try { global.dispatchEvent(new Event('obra-recuperar-clave')); } catch (e) {}
      }
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
          // Como en la memoria técnica: % de incremento de ESTE convenio × plazo, redondeo común
          // (18,70 % × 24 × 30 = 134,64 → 135). Nunca acorta.
          diasCalc = Math.max(0, Math.round(pctIncr * plazoDias));
          calcAcumApr += diasCalc; calcAcumEsc = Math.max(calcAcumEsc, calcAcumApr);
        } else {
          var mEsc = monto(acumEsc, puEsc);
          pctAcum = montoOriginal ? (mEsc - montoOriginal) / montoOriginal : 0;
          pctIncr = pctAcum - pctPrevEsc; pctPrevEsc = pctAcum;
          diasCalc = Math.max(0, Math.round(pctIncr * plazoDias)); calcAcumEsc += diasCalc;
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
        fecha_presentacion: c.fecha_presentacion || null, fecha_resolucion: c.fecha_resolucion || null, fecha_suscripcion: c.fecha_suscripcion || null, dias_exactos: (estado === 'rechazado') ? 0 : null,
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
               tipo_det: String(d.tipo || ''), cant: nnum_(d.cant), pu: d.pu == null ? null : nnum_(d.pu),
               justificacion: d.justificacion || '' };
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

  // ============================================ escrituras (etapa 3)
  /* Cada guardado es UNA llamada a una función de Postgres (cron_*), que corre
     en una transacción: o se guarda todo o nada. Ver esquema/13_escrituras_cronograma.sql.

     Control de revisión (igual que Codigo.gs): saveItems, saveWeekly y
     saveCategorias mandan la revisión que se cargó con la obra (BASE_REV). Si
     otra persona guardó en el medio, la base rechaza con PT409 y acá se arma el
     mismo error que antes (err.conflicto), que app.js ya sabe mostrar. */
  var CON_REVISION = { cron_guardar_items: 1, cron_guardar_semanal: 1, cron_guardar_categorias: 1 };

  function nuevoReqId_() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Sin redondeo, pero sin ruido binario: 0.1 + 0.2 = 0.30000000000000004 viaja
     como 0.3. Se conservan 15 cifras significativas, que es todo lo que un
     double representa con seguridad. */
  function compactar_(v) {
    if (typeof v === 'number') return (isFinite(v) && !Number.isInteger(v)) ? Number(v.toPrecision(15)) : v;
    if (Array.isArray(v)) return v.map(compactar_);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = compactar_(v[k]); });
      return o;
    }
    return v;
  }

  var MENSAJES_RESTRICCION = {
    item_fechas_coherentes: 'Hay ítems con fecha de fin anterior a la de inicio. Corregí las fechas y volvé a guardar.',
    item_nivel_check: 'Hay ítems con un nivel fuera de rango (1 a 8).',
    item_avance_manual_check: 'El avance manual tiene que estar entre 0 y 100.',
    item_no_es_su_padre: 'Un ítem no puede ser su propio padre.',
    obra_dias_por_mes_check: 'Los días por mes tienen que estar entre 1 y 31.'
  };

  function errorEscritura_(error, accion) {
    var code = error && error.code;
    var msg = (error && error.message) || String(error);
    if (code === 'PT409' || msg === 'conflicto') {
      var c = {};
      try { c = JSON.parse(error.details || '{}'); } catch (e) {}
      var e2 = new Error('Otra persona guardó esta obra mientras la tenías abierta' +
                         (c.por ? ' (' + c.por + (c.ts ? ', ' + c.ts : '') + ')' : '') + '.');
      e2.conflicto = c;
      return e2;
    }
    if (code === '28000' || msg === 'auth_required') return errAuth();
    var m = /constraint "([^"]+)"/.exec(msg + ' ' + (error && error.details || ''));
    if (m && MENSAJES_RESTRICCION[m[1]]) return new Error(MENSAJES_RESTRICCION[m[1]]);
    // reglas de negocio de las funciones cron_/prod_/cert_/com_/pista_: el mensaje ya está escrito para la persona
    if (/^(22|23|42|P0)/.test(String(code || '')) && !/constraint "/.test(msg)) return new Error(msg);
    return traducir(error, accion);
  }

  /* Llama a una función de escritura. obraId explícito: la cola offline reenvía
     trabajos de la obra donde se encolaron, que puede no ser la abierta. */
  // funciones que no reciben p_obra (globales, no de una obra)
  var SIN_OBRA_ = { cron_duplicar_obra: 1, rec_importar: 1, tr_camion_guardar: 1, adm_usuario_guardar: 1 };
  async function escribir_(fn, args, obraId, accion, intentos, reqId) {
    await exigirSesion();
    var oid = String(obraId !== undefined && obraId !== null ? obraId : OBRA_ID);
    var a = compactar_(args || {});
    if (a.p_obra === undefined && !SIN_OBRA_[fn]) a.p_obra = oid;
    if (CON_REVISION[fn]) {
      reqId = reqId || nuevoReqId_();             // el mismo id en todos los reintentos
      a.p_req_id = reqId;
      // solo si es la obra abierta: un trabajo de OTRA obra no se valida contra esta revisión
      a.p_base_rev = (BASE_REV !== null && oid === String(OBRA_ID)) ? BASE_REV : null;
    }
    intentos = intentos == null ? 2 : intentos;
    var r;
    try { r = await sb.rpc(fn, a); }
    catch (err) { r = { error: { message: String(err && err.message || err) } }; }
    if (r.error) {
      var e = errorEscritura_(r.error, accion);
      if (e.transitorio && CON_REVISION[fn] && intentos > 0) {
        await new Promise(function (ok) { setTimeout(ok, (3 - intentos) * 1200 + 800); });
        return escribir_(fn, args, obraId, accion, intentos - 1, reqId);
      }
      throw e;
    }
    var d = r.data || {};
    // guardado propio aceptado: se adopta la revisión que dejó la base
    if (CON_REVISION[fn] && d.rev != null && oid === String(OBRA_ID)) setBaseRev(d.rev);
    return d;
  }

  // ======================================== etapa 4: lecturas operativas
  var PROD_ESTADOS = ['Con Actividad con liberaciones', 'Con actividad sin liberaciones',
                      'Sin Actividad por lluvia', 'Sin Actividad Exceso de Humedad', 'Receso'];
  var PROD_LADOS = ['Pista completa (ambos lados)', 'Derecho', 'Izquierdo', 'Eje'];
  var FOTOS_BUCKET = 'fotos-obra';

  function oidDe_(obraId) { return String(obraId !== undefined && obraId !== null ? obraId : OBRA_ID); }

  async function leerConfig_(oid) {
    var rows = await todo('config', 'obra_id,clave,valor', function (q) { return q.or('obra_id.is.null,obra_id.eq.' + oid); }, ['clave']);
    var cfg = {};
    rows.forEach(function (c) { if (c.obra_id === null) cfg[c.clave] = valorConfig(c.valor); });
    rows.forEach(function (c) { if (c.obra_id !== null) cfg[c.clave] = valorConfig(c.valor); });
    return cfg;
  }

  // prodListas_ (Code_Producción.gs)
  async function prodListas_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var r = await Promise.all([
      sb.from('obra').select('obra_id,nombre,moneda,activo,tipo_obra').order('obra_id'),
      todo('item', 'item_id,descripcion,codigo_cc,um,precio_unit,cant_contrato,cant_contractual,cant_vigente,tipo,es_grupo,nivel,padre_id,orden',
           deObra(oid), ['orden', 'item_id'])
    ]);
    if (r[0].error) throw traducir(r[0].error, 'obras');
    var obrasRaw = r[0].data || [], itemsObra = r[1];
    var obraSel = obrasRaw.filter(function (o) { return o.obra_id === oid; })[0] || {};
    var publica = String(obraSel.tipo_obra || '').toLowerCase() === 'publica';
    var obras = obrasRaw.filter(function (o) { return o.activo !== false; }).map(function (o) {
      return { idObra: o.obra_id, descObra: String(o.nombre || '').trim(), moneda: String(o.moneda || '').trim() };
    });
    function tipoEfectivo(idx) {
      var it = itemsObra[idx];
      var t = String(it.tipo || '').trim().toLowerCase();
      if (t) return t;
      if (it.es_grupo) return 'grupo';
      var sig = itemsObra[idx + 1];
      if (sig && (parseInt(sig.nivel) || 1) > (parseInt(it.nivel) || 1)) return 'grupo';
      return 'item';
    }
    var tienenSubdiv = {};
    itemsObra.forEach(function (it) {
      if (String(it.tipo || '').trim().toLowerCase() === 'subdivision' && it.padre_id) tienenSubdiv[nid_(it.padre_id)] = true;
    });
    var items = [];
    itemsObra.forEach(function (it, idx) {
      var te = tipoEfectivo(idx);
      if (te === 'grupo' || te === 'actividad' || te === 'hito') return;
      var tipo = String(it.tipo || '').trim().toLowerCase() || (it.es_grupo ? 'grupo' : 'item');
      var cCtr = nnum_(it.cant_contractual), cVig = nnum_(it.cant_vigente);
      items.push({
        idObra: oid, idItem: nid_(it.item_id), descItem: String(it.descripcion || '').trim(),
        codigoCc: String(it.codigo_cc || ''), um: String(it.um || '').trim(), pu: nnum_(it.precio_unit),
        cantContrato: nnum_(it.cant_contrato), cantContractual: cCtr, cantVigente: cVig,
        cantTope: publica ? cCtr : cVig,
        tipo: tipo, padreId: it.padre_id ? nid_(it.padre_id) : null,
        tieneSub: !!tienenSubdiv[nid_(it.item_id)]
      });
    });
    return { obras: obras, items: items, estados: PROD_ESTADOS, lados: PROD_LADOS,
             tipoObra: publica ? 'publica' : 'privada' };
  }

  /* prodHistorial_: un registro por FILA (como la hoja vieja). El identificador
     es "<submission_id>#<fila>"; una jornada sin filas (lluvia, nota del día)
     es un registro con el submission_id solo. */
  async function prodHistorial_(limite, obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    limite = limite || 300;
    var r = await Promise.all([
      sb.from('produccion_jornada')
        .select('submission_id,fecha,estado,responsable,lluvia_mm,observaciones,fotos,cargado_en,' +
                'produccion_fila(fila_nro,item_id,lado,prog_ini,prog_fin,cantidad,cantidad_dato,longitud,ancho_prom,espesor_prom,observaciones)')
        .eq('obra_id', oid).order('cargado_en', { ascending: false }).order('fecha', { ascending: false })
        .limit(limite),
      todo('item', 'item_id,descripcion,um', deObra(oid), ['item_id']),
      sb.from('obra').select('nombre').eq('obra_id', oid).maybeSingle()
    ]);
    if (r[0].error) throw traducir(r[0].error, 'historial de producción');
    var itemDe = {};
    r[1].forEach(function (it) { itemDe[nid_(it.item_id)] = it; });
    var descObra = (r[2].data && r[2].data.nombre) || '';
    var vac = function (v) { return v === null || v === undefined ? '' : v; };
    var out = [];
    (r[0].data || []).forEach(function (j) {
      var base = {
        fecha: j.fecha || '', responsable: j.responsable || '', estado: j.estado || '',
        idObra: oid, descObra: descObra, lluvia: vac(j.lluvia_mm),
        obsJornada: j.observaciones || '', fotos: (j.fotos || []).join('\n')
      };
      var conLib = /con actividad con liberaciones/i.test(j.estado || '');
      var filas = (j.produccion_fila || []).slice().sort(function (a, b) { return a.fila_nro - b.fila_nro; });
      if (!filas.length) {
        out.push(Object.assign({ submissionId: j.submission_id, idItem: '', descItem: '', lado: '', cantFinal: '',
          um: '', progIni: '', progFin: '', longitud: '', ancho: '', espesor: '', cantidad: '', observaciones: '' }, base));
        return;
      }
      filas.forEach(function (f) {
        var it = itemDe[nid_(f.item_id)] || {};
        var sinDim = f.longitud == null && f.ancho_prom == null;
        out.push(Object.assign({
          submissionId: j.submission_id + '#' + f.fila_nro,
          idItem: nid_(f.item_id), descItem: it.descripcion || '', lado: f.lado || '',
          cantFinal: conLib ? nnum_(f.cantidad) : '', um: it.um || '',
          progIni: vac(f.prog_ini), progFin: vac(f.prog_fin), longitud: vac(f.longitud),
          ancho: vac(f.ancho_prom), espesor: vac(f.espesor_prom),
          cantidad: f.cantidad_dato != null ? f.cantidad_dato : (sinDim && conLib ? nnum_(f.cantidad) : ''),
          observaciones: f.observaciones || ''
        }, base));
      });
    });
    return out.slice(0, limite);
  }

  // certListar_
  async function certListar_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var rows = await todo('certificacion', 'item_id,mes,cant_certificada,observacion,nro_certificado', deObra(oid), ['mes', 'item_id']);
    var registros = rows.map(function (c) {
      return { item_id: nid_(c.item_id), mes: nmes_(c.mes), cant: nnum_(c.cant_certificada),
               observacion: c.observacion || '', nro_certificado: c.nro_certificado || '' };
    }).filter(function (c) { return c.item_id && c.mes; });
    var meses = {};
    registros.forEach(function (c) { meses[c.mes] = true; });
    return { registros: registros, meses: Object.keys(meses).sort() };
  }

  // comListar_ (Code_Comunicaciones.gs): dirección, estado del hilo y KPIs
  var COM_TIPOS = ['Nota', 'Orden de servicio', 'Pedido de aclaración', 'Informe', 'Acta', 'Memorándum', 'Certificado', 'Otro'];
  var COM_MEDIOS = ['Papel', 'Email', 'Sistema', 'Mano propia'];
  function comNorm_(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function comDireccion_(de, para, miRolNorm) {
    if (!miRolNorm) return 'sin_definir';
    var d = comNorm_(de), p = comNorm_(para);
    var mioDe = d && (d.indexOf(miRolNorm) >= 0 || miRolNorm.indexOf(d) >= 0);
    var mioPara = p && (p.indexOf(miRolNorm) >= 0 || miRolNorm.indexOf(p) >= 0);
    if (mioDe) return 'sale';
    if (mioPara) return 'entra';
    return 'sin_definir';
  }
  async function comListar_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var r = await Promise.all([todo('comunicacion', '*', deObra(oid), ['com_id']), leerConfig_(oid)]);
    var miRol = String(r[1]['com:mi_rol'] || '').trim();
    var miRolNorm = comNorm_(miRol);
    var rows = r[0].map(function (c) {
      return { com_id: c.com_id, nro: c.nro || '', fecha_nota: c.fecha_nota || '', fecha_recepcion: c.fecha_recepcion || '',
               de: c.remitente || '', para: c.destinatario || '', asunto: c.asunto || '', resumen: c.resumen || '',
               tipo: c.tipo || '', medio: c.medio || '', requiere_resp: !!c.requiere_resp, vence: c.vence || '',
               resp_a: c.resp_a || '', responsable: c.responsable || '', link: c.link || '', cerrada: !!c.cerrada,
               creado_por: c.creado_por || '', creado_en: c.creado_en ? String(c.creado_en).slice(0, 10) : '' };
    });
    var contestada = {};
    rows.forEach(function (x) { if (x.resp_a) contestada[x.resp_a] = true; });
    var hoy = ymdLocal(new Date());
    var kpi = { debemos: 0, esperamos: 0, vencidas: 0, total: rows.length };
    rows.forEach(function (x) {
      x.direccion = comDireccion_(x.de, x.para, miRolNorm);
      x.respondida = !!contestada[x.com_id];
      x.estado_hilo = x.cerrada ? 'cerrada' : x.respondida ? 'respondida' : x.requiere_resp ? 'pendiente' : 'archivada';
      x.vencida = !!(x.estado_hilo === 'pendiente' && x.vence && x.vence < hoy);
      if (x.estado_hilo === 'pendiente') {
        if (x.direccion === 'entra') kpi.debemos++;
        else if (x.direccion === 'sale') kpi.esperamos++;
        if (x.vencida) kpi.vencidas++;
      }
    });
    rows.sort(function (a, b) {
      var fa = a.fecha_recepcion || a.fecha_nota || '', fb = b.fecha_recepcion || b.fecha_nota || '';
      if (fa === fb) return (b.nro || '').localeCompare(a.nro || '');
      if (!fa) return 1;
      if (!fb) return -1;
      return fb.localeCompare(fa);
    });
    var partes = {};
    rows.forEach(function (x) { [x.de, x.para].forEach(function (p) { p = String(p || '').trim(); if (p) partes[p] = true; }); });
    return { registros: rows, kpi: kpi, mi_rol: miRol, partes: Object.keys(partes).sort(), tipos: COM_TIPOS, medios: COM_MEDIOS };
  }

  // pistaCargar_ (Code Pista.gs)
  var PISTA_DEFAULT = [
    { estado_id: 'base', nombre: 'Base de asiento', color: '#b8895c', orden: 10, tipo: 'capa', derivable: true, alias_liberacion: 'Base de asiento' },
    { estado_id: 'terr', nombre: 'Terraplén', color: '#e0a458', orden: 20, tipo: 'capa', derivable: false, alias_liberacion: '' },
    { estado_id: 'terrc', nombre: 'Terraplén en corte', color: '#a97038', orden: 25, tipo: 'capa', derivable: false, alias_liberacion: '' },
    { estado_id: 'subr', nombre: 'Subrasante', color: '#4f9e63', orden: 30, tipo: 'capa', derivable: true, alias_liberacion: 'Subrasante' },
    { estado_id: 'reg', nombre: 'Regularización asfáltica', color: '#414e59', orden: 40, tipo: 'capa', derivable: true, alias_liberacion: 'Regularización asf.' },
    { estado_id: 'puente', nombre: 'Puente', color: '#9aa7b1', orden: 0, tipo: 'neutro', derivable: false, alias_liberacion: '' },
    { estado_id: 'sinint', nombre: 'Sin intervención', color: '#cdd5db', orden: 0, tipo: 'neutro', derivable: false, alias_liberacion: '' }
  ];
  function pistaBool_(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'si' || s === 'sí' || s === 'x' || s === 'verdadero';
  }
  async function pistaCargar_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var r = await Promise.all([
      todo('pista_eje', '*', deObra(oid), ['orden', 'nombre']),
      todo('pista_estado', '*', deObra(oid), ['orden', 'estado_id']),
      todo('pista_tramo', '*', deObra(oid), ['eje_id', 'orden', 'prog_ini']),
      todo('pista_snapshot', 'eje_id,fecha,nota,resumen', deObra(oid), ['fecha', 'eje_id']),
      leerConfig_(oid)
    ]);
    var ejes = r[0].map(function (e) {
      return { eje_id: e.eje_id, nombre: e.nombre || '', prog_ini: nnum_(e.prog_ini), prog_fin: nnum_(e.prog_fin),
               formato: e.formato === 'plano' ? 'plano' : 'pk', orden: nnum_(e.orden) };
    });
    var estados = r[1].map(function (e) {
      return { estado_id: e.estado_id, nombre: e.nombre || '', color: e.color || '#9aa7b1', orden: nnum_(e.orden),
               tipo: e.tipo === 'neutro' ? 'neutro' : 'capa', derivable: !!e.derivable, alias_liberacion: e.alias_liberacion || '' };
    });
    var usaDefault = !estados.length;
    if (usaDefault) estados = PISTA_DEFAULT.map(function (e) { return Object.assign({}, e); });
    var tramos = r[2].map(function (t) {
      return { eje_id: t.eje_id, orden: nnum_(t.orden), ini: nnum_(t.prog_ini), fin: nnum_(t.prog_fin),
               estado: t.estado_id, cota: t.cota == null ? null : nnum_(t.cota), proc: !!t.en_proceso, obs: t.nota || '' };
    }).sort(function (a, b) { return (a.orden - b.orden) || (a.ini - b.ini); });
    var snaps = r[3].map(function (x) {
      return { eje_id: x.eje_id, fecha: x.fecha, nota: x.nota || '', resumen: x.resumen || null };
    });
    return { activo: pistaBool_(r[4]['pista:activo']), ejes: ejes, estados: estados, estados_default: usaDefault,
             tramos: tramos, snapshots: snaps };
  }

  /* Todo lo que necesita la pestaña Certificación (formato MOPC): ítems con su
     jerarquía, certificados numerados con sus cantidades, plan contractual
     (línea base inicial) y plan vigente por mes, datos del contrato y plazo. */
  // ---------------------------------------------------------------- COMPRAS
  async function comprasDatos_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var r = await Promise.all([
      todo('compra', '*', deObra(oid), ['fecha_solicitud', 'creado_en', 'compra_id']),
      todo('item_recurso', '*', deObra(oid), ['item_id', 'orden']),
      todo('recurso', '*', null, ['recurso_id']),
      todo('item', 'item_id,descripcion,um,codigo_cc,tipo,es_grupo,nivel,orden,cant_contrato,cant_vigente,precio_unit', deObra(oid), ['orden', 'item_id']),
      todo('recurso_precio', 'recurso_id,precio_sin_iva', deObra(oid), ['recurso_id']).catch(function () { return []; })
    ]);
    var num = function (v) { return v === null || v === undefined ? null : nnum_(v); };
    var precios = {}; (r[4] || []).forEach(function (x) { precios[String(x.recurso_id)] = num(x.precio_sin_iva); });
    var compras = r[0].map(function (c) {
      var o = {}; Object.keys(c).forEach(function (k) { o[k] = c[k]; });
      ['cantidad', 'pu1', 'pu2', 'pu3', 'monto_regular', 'monto_logrado', 'cant_recibida'].forEach(function (k) { o[k] = num(c[k]); });
      o.item_id = c.item_id ? nid_(c.item_id) : '';
      return o;
    }).reverse();
    var ir = r[1].map(function (x) {
      return { item_id: nid_(x.item_id), recurso_id: String(x.recurso_id), nombre: x.nombre || '', tipo: x.tipo || '',
               cant_unitaria: num(x.cant_unitaria), costo_unitario: num(x.costo_unitario), recurso_padre: x.recurso_padre || '' };
    });
    var items = r[3].map(function (i) {
      return { id: nid_(i.item_id), desc: i.descripcion || '', um: i.um || '', cc: String(i.codigo_cc || '').trim(),
               grupo: !!i.es_grupo || i.tipo === 'grupo', cantVigente: nnum_(i.cant_vigente), pu: nnum_(i.precio_unit) };
    });
    // v20261006c (SQL 22): adjuntos de los pedidos y "ya pedido" manual por recurso.
    var ex = await Promise.all([
      todo('adjunto', 'adjunto_id,modulo,ref_id,tipo,nombre,mime,tamano,ruta,subido_por,subido_en', function (q) { return q.eq('obra_id', oid).eq('modulo', 'compra'); }, ['subido_en'])
        .catch(function () { return null; }),
      todo('compra_ajuste', 'recurso_id,cant_pedida,monto,obs,editado_por,editado_en', deObra(oid), ['recurso_id'])
        .catch(function () { return null; })
    ]);
    var adj = {}; (ex[0] || []).forEach(function (a) { (adj[a.ref_id] = adj[a.ref_id] || []).push(a); });
    var aj = {}; (ex[1] || []).forEach(function (a) { aj[String(a.recurso_id)] = { cant_pedida: num(a.cant_pedida), monto: num(a.monto), obs: a.obs || '', editado_por: a.editado_por, editado_en: a.editado_en }; });
    return { compras: compras, itemRecurso: ir, recursos: r[2], items: items, precios: precios,
             adjuntos: adj, ajustes: aj, sinAdjuntos: !ex[0], sinAjustes: !ex[1] };
  }

  // ---------------------------------------------------------- ADJUNTOS (bucket privado)
  var ADJ_BUCKET = 'adjuntos';
  async function adjuntoSubir_(file, modulo, refId, tipo, obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    if (!file) throw new Error('Elegí un archivo.');
    if (file.size > 25 * 1024 * 1024) throw new Error('El archivo pesa más de 25 MB.');
    var nombre = String(file.name || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
    var ruta = oid + '/' + modulo + '/' + String(refId).replace(/[^\w.\-]+/g, '_') + '/' + Date.now() + '_' + nombre;
    var up = await sb.storage.from(ADJ_BUCKET).upload(ruta, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (up.error) throw new Error('No se pudo subir el archivo: ' + (/mime|type/i.test(up.error.message || '') ? 'tipo de archivo no permitido (PDF, foto, Excel o Word)' : up.error.message));
    try {
      return await escribir_('adjunto_registrar', { p: { modulo: modulo, ref_id: String(refId), tipo: tipo || 'otro', nombre: file.name || nombre,
        mime: file.type || '', tamano: file.size || null, ruta: ruta } }, oid, 'registrar adjunto');
    } catch (e) { await sb.storage.from(ADJ_BUCKET).remove([ruta]).catch(function () {}); throw e; }
  }

  // ---------------------------------------------------------- TRANSPORTE / CAMIONES
  // Cargas de la obra (con sus camiones) desde una fecha + ítems con centro de costo.
  async function trDatos_(obraId, desde) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var filtroFecha = function (q) { q = q.eq('obra_id', oid); return desde ? q.gte('fecha', desde) : q; };
    var r = await Promise.all([
      todo('transporte_carga', '*', filtroFecha, ['fecha', 'cargado_en', 'carga_id']),
      todo('transporte_viaje', 'carga_id,orden,chapa,viajes,toneladas', deObra(oid), ['carga_id', 'orden']),
      todo('item', 'item_id,descripcion,um,codigo_cc,tipo,es_grupo,nivel,orden', deObra(oid), ['orden', 'item_id'])
    ]);
    var num = function (v) { return v === null || v === undefined ? null : nnum_(v); };
    var cargas = {}, lista = [];
    r[0].forEach(function (c) {
      var o = { id: c.carga_id, fecha: c.fecha, tipo_actividad: c.tipo_actividad || '', codigo_cc: c.codigo_cc || '',
        item_id: c.item_id ? nid_(c.item_id) : '', cc_texto: c.cc_texto || '', tipo_material: c.tipo_material || '',
        origen: c.origen || '', destino: c.destino || '', prog_origen: c.prog_origen || '', prog_ini: c.prog_ini || '',
        prog_fin: c.prog_fin || '', distancia_km: num(c.distancia_km), litros_ini: num(c.litros_ini),
        litros_fin: num(c.litros_fin), litros_usados: num(c.litros_usados), m2_pista: num(c.m2_pista),
        m3_hormigon: num(c.m3_hormigon), encargado: c.encargado || '', observaciones: c.observaciones || '',
        fotos: c.fotos || [], cargado_por: c.cargado_por || '', cargado_en: c.cargado_en, origen_dato: c.origen_dato || '',
        viajes: [] };
      cargas[o.id] = o; lista.push(o);
    });
    r[1].forEach(function (v) {
      var c = cargas[v.carga_id]; if (!c) return;
      c.viajes.push({ chapa: v.chapa || '', viajes: num(v.viajes), toneladas: num(v.toneladas) });
    });
    var items = r[2].filter(function (i) { return (i.codigo_cc || '').trim(); }).map(function (i) {
      return { id: nid_(i.item_id), desc: i.descripcion || '', um: i.um || '', cc: String(i.codigo_cc).trim(), grupo: !!i.es_grupo || i.tipo === 'grupo' };
    });
    var yo = '';
    try { var ss = await sb.auth.getSession(); yo = (ss.data.session && ss.data.session.user && ss.data.session.user.email || '').toLowerCase(); } catch (e) {}
    // v20261006c: maestro de camiones y conteos de stock (SQL 21). Si el SQL
    // todavía no se corrió, la pestaña funciona igual (sin validar chapas).
    var extra = await Promise.all([
      todo('transporte_camion', 'chapa,chapa_key,tipo,descripcion,marca,modelo,chasis,proveedor,ruc,chofer,telefono,contacto,propio,activo,observaciones', null, ['chapa'])
        .catch(function () { return null; }),
      todo('stock_conteo', 'conteo_id,deposito,material,fecha,toneladas,motivo,cargado_por,cargado_en', deObra(oid), ['fecha', 'conteo_id'])
        .catch(function () { return null; })
    ]);
    var camiones = extra[0], conteos = extra[1];
    if (camiones) { try { localStorage.setItem('tr:camiones', JSON.stringify(camiones)); } catch (e) {} }
    else { try { camiones = JSON.parse(localStorage.getItem('tr:camiones') || 'null'); } catch (e) {} }
    return { cargas: lista.reverse(), items: items, yo: yo,
             camiones: camiones || [], sinMaestro: !extra[0],
             conteos: (conteos || []).map(function (c) { return Object.assign({}, c, { toneladas: num(c.toneladas) }); }),
             sinStock: !conteos };
  }

  // ---------------------------------------------------------------- CÓMPUTO
  // Ítems de la obra + convenios + cómputo guardado (líneas y adoptadas) por etapa.
  async function compDatos_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var r = await Promise.all([
      sb.from('obra').select('obra_id,nombre,tipo_obra').eq('obra_id', oid).maybeSingle(),
      todo('item', 'item_id,descripcion,um,nivel,tipo,es_grupo,orden,cant_contrato,cant_contractual,cant_vigente,precio_unit', deObra(oid), ['orden', 'item_id']),
      todo('convenio', 'convenio_id,orden,nro,tipo,estado', deObra(oid), ['orden', 'convenio_id']),
      todo('convenio_detalle', 'convenio_id,item_id,cant', deObra(oid), ['convenio_id', 'item_id']),
      todo('computo_linea', '*', deObra(oid), ['etapa', 'item_id', 'orden']),
      todo('computo_item', '*', deObra(oid), ['etapa', 'item_id'])
    ]);
    if (r[0].error) throw traducir(r[0].error, 'obra');
    var itemsRaw = r[1];
    var items = itemsRaw.map(function (it, idx) {
      var t = String(it.tipo || '').trim().toLowerCase();
      if (!t) { var sig = itemsRaw[idx + 1]; t = it.es_grupo ? 'grupo' : (sig && (parseInt(sig.nivel) || 1) > (parseInt(it.nivel) || 1) ? 'grupo' : 'item'); }
      return { id: nid_(it.item_id), desc: it.descripcion || '', um: it.um || '', nivel: parseInt(it.nivel) || 1, tipo: t,
               cantContrato: nnum_(it.cant_contrato), cantVigente: nnum_(it.cant_vigente), pu: nnum_(it.precio_unit) };
    });
    var det = {};
    r[3].forEach(function (d) { (det[d.convenio_id] = det[d.convenio_id] || {})[nid_(d.item_id)] = nnum_(d.cant); });
    var lineas = {}, adoptadas = {};
    var num = function (v) { return v === null || v === undefined ? null : nnum_(v); };
    r[4].forEach(function (l) {
      var e = lineas[l.etapa] = lineas[l.etapa] || {};
      (e[nid_(l.item_id)] = e[nid_(l.item_id)] || []).push({ tramo: l.tramo || '', prog_ini: num(l.prog_ini), prog_fin: num(l.prog_fin),
        largo: num(l.largo), ancho: num(l.ancho), espesor: num(l.espesor), n: num(l.n), total: nnum_(l.total), obs: l.obs || '' });
    });
    r[5].forEach(function (a) {
      (adoptadas[a.etapa] = adoptadas[a.etapa] || {})[nid_(a.item_id)] = { adoptada: num(a.adoptada), obs: a.obs || '',
        actualizado: a.actualizado, por: a.actualizado_por || '' };
    });
    return { obra: r[0].data || {}, items: items, convenios: r[2], det: det, lineas: lineas, adoptadas: adoptadas };
  }

  async function certDatos_(obraId) {
    await exigirSesion();
    var oid = oidDe_(obraId);
    var r = await Promise.all([
      sb.from('obra').select('*').eq('obra_id', oid).maybeSingle(),
      todo('item', 'item_id,descripcion,um,nivel,tipo,es_grupo,padre_id,orden,cant_contrato,cant_contractual,cant_vigente,cant_ajustada,precio_unit',
           deObra(oid), ['orden', 'item_id']),
      todo('certificado', '*', deObra(oid), ['nro']),
      todo('certificacion', 'cert_id,item_id,cant_certificada,observacion', deObra(oid), ['cert_id', 'item_id']),
      todo('linea_base', 'baseline_id,nombre,tipo,activa,fecha_snapshot', deObra(oid), ['fecha_snapshot', 'baseline_id']),
      todo('distribucion_mensual', 'item_id,mes,cant', deObra(oid), ['item_id', 'mes']),
      leerConfig_(oid),
      datosPlazo(oid)
    ]);
    if (r[0].error) throw traducir(r[0].error, 'obra');
    var obra = r[0].data || {};
    var publica = String(obra.tipo_obra || '').toLowerCase() === 'publica';
    var itemsRaw = r[1];
    var pu = {};
    itemsRaw.forEach(function (it) { pu[nid_(it.item_id)] = nnum_(it.precio_unit); });
    var items = itemsRaw.map(function (it, idx) {
      var t = String(it.tipo || '').trim().toLowerCase();
      if (!t) {
        var sig = itemsRaw[idx + 1];
        t = it.es_grupo ? 'grupo' : (sig && (parseInt(sig.nivel) || 1) > (parseInt(it.nivel) || 1) ? 'grupo' : 'item');
      }
      var cCtr = nnum_(it.cant_contractual), cVig = nnum_(it.cant_vigente);
      return { id: nid_(it.item_id), desc: it.descripcion || '', um: it.um || '', nivel: parseInt(it.nivel) || 1,
               tipo: t, padre: it.padre_id ? nid_(it.padre_id) : null,
               cantContrato: nnum_(it.cant_contrato), cantContractual: cCtr, cantVigente: cVig,
               cantTope: publica ? cCtr : cVig, pu: nnum_(it.precio_unit), certificable: t === 'item' };
    });
    var filas = {};
    r[3].forEach(function (f) {
      (filas[f.cert_id] = filas[f.cert_id] || {})[nid_(f.item_id)] = { cant: nnum_(f.cant_certificada), obs: f.observacion || '' };
    });
    // plan contractual = la línea base INICIAL más reciente (activa primero)
    var inic = r[4].filter(function (b) { return b.tipo === 'inicial'; });
    var bl = inic.filter(function (b) { return b.activa; }).pop() || inic.pop() || null;
    var progContractual = null;
    if (bl) {
      progContractual = {};
      var det = await todo('linea_base_detalle', 'item_id,dist', function (q) {
        return q.eq('obra_id', oid).eq('baseline_id', bl.baseline_id); }, ['item_id']);
      det.forEach(function (d) {
        var p = pu[nid_(d.item_id)] || 0;
        Object.keys(d.dist || {}).forEach(function (m) {
          var mk = nmes_(m); if (!mk) return;
          progContractual[mk] = (progContractual[mk] || 0) + nnum_(d.dist[m]) * p;
        });
      });
    }
    var progVigente = {};
    r[5].forEach(function (d) {
      var mk = nmes_(d.mes); if (!mk) return;
      progVigente[mk] = (progVigente[mk] || 0) + nnum_(d.cant) * (pu[nid_(d.item_id)] || 0);
    });
    var cfg = {};
    Object.keys(r[6]).forEach(function (k) { if (k.indexOf('cert:') === 0) cfg[k.slice(5)] = r[6][k]; });
    return { obra: obra, publica: publica, items: items, certificados: r[2], filas: filas,
             progContractual: progContractual, lineaBase: bl ? bl.nombre : null, progVigente: progVigente,
             cfg: cfg, plazo: r[7].plazo };
  }

  // ---- fotos de la jornada → Supabase Storage (antes: Google Drive) ----
  function nuevoSid_() {
    return 'pwa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function base64ABytes_(b64) {
    var bin = global.atob(String(b64 || '').replace(/^data:[^,]*,/, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function subirFotos_(oid, fecha, sid, fotos) {
    var urls = [];
    for (var i = 0; i < (fotos || []).length; i++) {
      var f = fotos[i];
      if (!f || !f.dataBase64) continue;
      var nombre = String(f.name || 'foto').replace(/[^\w.\-]/g, '_');
      if (!/\.(jpe?g|png|webp|heic)$/i.test(nombre)) nombre += '.jpg';
      var ruta = oid + '/' + (fecha || 'sin_fecha') + '/' + sid + '_' + (i + 1) + '_' + nombre;
      var up = await sb.storage.from(FOTOS_BUCKET).upload(ruta, base64ABytes_(f.dataBase64),
                                                          { contentType: f.mime || 'image/jpeg', upsert: true });
      if (up.error) {
        // sin red: que corte y la jornada vaya a la cola; otro error: la foto no tumba la jornada
        if (/fetch|network|load failed/i.test(up.error.message || '')) throw new Error('Failed to fetch');
        console.warn('[ObraAPI] no se pudo subir la foto', ruta, up.error);
        continue;
      }
      urls.push(sb.storage.from(FOTOS_BUCKET).getPublicUrl(ruta).data.publicUrl);
    }
    return urls;
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
      // sin @: número de cédula → usuario de campo (sin correo); si no, nombre.apellido@tecsul.com.py
      var email = u.indexOf('@') >= 0 ? u
                : /^[\d.\s-]+$/.test(u) ? (u.replace(/\D/g, '') + '@' + DOMINIO_CAMPO)
                : (u + '@' + DOMINIO);
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

    /* ---- contraseña ----
       recuperarClave manda el correo con el enlace; al volver por ese enlace la
       PWA entra con una sesión temporal y enRecuperacion() da true: ahí se pide
       la clave nueva y se guarda con cambiarClave. */
    recuperarClave: async function (usuario) {
      if (!sb) throw new Error('No se pudo iniciar la conexión con Supabase');
      var u = String(usuario || '').trim().toLowerCase();
      if (!u) throw new Error('Escribí tu correo arriba y volvé a tocar «Olvidé mi contraseña».');
      var email = u.indexOf('@') >= 0 ? u : (u + '@' + DOMINIO);
      var destino = global.location.origin + global.location.pathname;
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: destino });
      if (r.error) {
        if (/rate|limit|seconds/i.test(r.error.message || ''))
          throw new Error('Se pidieron demasiados correos seguidos. Esperá unos minutos y probá de nuevo.');
        throw new Error('No se pudo enviar el correo: ' + r.error.message);
      }
      return email;
    },
    enRecuperacion: function () { return RECUPERACION; },
    esInvitacion: function () { return INVITACION; },
    errorEnlace: function () { return ERROR_ENLACE; },
    /* Código de 6 dígitos del correo (en vez del enlace): sirve aunque el filtro
       del correo haya "abierto" el enlace antes. Deja una sesión temporal para
       elegir la contraseña. Requiere {{ .Token }} en la plantilla del correo. */
    verificarCodigo: async function (usuario, codigo) {
      if (!sb) throw new Error('No se pudo iniciar la conexión con Supabase');
      var u = String(usuario || '').trim().toLowerCase();
      if (!u) throw new Error('Escribí tu correo (o cédula) en el campo de arriba.');
      var email = u.indexOf('@') >= 0 ? u : (u + '@' + DOMINIO);
      var c = String(codigo || '').replace(/\s+/g, '');
      if (!/^\d{6,10}$/.test(c)) throw new Error('El código son los números que vienen en el correo.');
      var r = await sb.auth.verifyOtp({ email: email, token: c, type: 'recovery' });
      if (r.error) {   // el código puede venir del correo de invitación
        var r2 = await sb.auth.verifyOtp({ email: email, token: c, type: 'invite' });
        if (!r2.error) { r = r2; INVITACION = true; }
      }
      if (r.error) {
        if (/expired|invalid/i.test(r.error.message || '')) throw new Error('El código venció o no es correcto. Pedí uno nuevo con «Olvidé mi contraseña».');
        throw new Error('No se pudo verificar el código: ' + r.error.message);
      }
      RECUPERACION = true;
      return email;
    },
    cambiarClave: async function (nueva) {
      await exigirSesion();
      if (String(nueva || '').length < 8) throw new Error('La contraseña tiene que tener al menos 8 caracteres.');
      var r = await sb.auth.updateUser({ password: nueva });
      if (r.error) {
        if (/different|same/i.test(r.error.message || '')) throw new Error('La contraseña nueva tiene que ser distinta de la anterior.');
        if (/weak|short|characters/i.test(r.error.message || '')) throw new Error('La contraseña es muy débil: usá al menos 8 caracteres, con letras y números.');
        throw new Error('No se pudo cambiar la contraseña: ' + r.error.message);
      }
      RECUPERACION = false; INVITACION = false;
      try { global.history.replaceState(null, '', global.location.pathname + global.location.search.replace(/[?&]type=(recovery|invite)/, '')); } catch (e) {}
      return true;
    },

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
    crearObra: function (obra) {
      return escribir_('cron_crear_obra', { p_obra: obra || {} }, null, 'crear obra');
    },
    duplicarObra: function (origenId, nueva) {
      return escribir_('cron_duplicar_obra', { p_origen: String(origenId), p_nueva: nueva || {} },
                       origenId, 'duplicar obra');
    },
    eliminarObra: function (obraId, confirmNombre) {
      return escribir_('cron_eliminar_obra', { p_confirm: confirmNombre || '' }, obraId, 'eliminar obra');
    },
    saveItems: function (items, dist, deps) {
      return API.saveItemsParcial({ items: items, dist: dist, deps: deps });
    },
    /* Guardado PARCIAL: solo las tablas que cambiaron. Lo que no viene (null)
       no se toca: mover una fecha no reescribe la distribución de toda la obra. */
    saveItemsParcial: function (parcial, obraId) {
      parcial = parcial || {};
      if (!parcial.items && !parcial.dist && !parcial.deps) return Promise.resolve(0);
      return escribir_('cron_guardar_items', {
        p_items: parcial.items || null, p_dist: parcial.dist || null, p_deps: parcial.deps || null
      }, obraId, 'guardar el cronograma').then(function (d) { return d.saved; });
    },
    firma: function (obj) {
      var str = JSON.stringify(obj), h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      return h.toString(36) + ':' + str.length;
    },
    deleteItems: function (ids) {
      return escribir_('cron_borrar_items', { p_ids: ids || [] }, null, 'borrar ítems')
        .then(function (d) { return d.deleted; });
    },
    saveWeekly: function (rows, deleted, obraId) {   // `deleted` ya no hace falta: se reemplaza el plan entero
      return escribir_('cron_guardar_semanal', { p_rows: rows || [] }, obraId, 'guardar el plan semanal')
        .then(function (d) { return d.saved; });
    },
    /* tipoLb: 'inicial' | 'convenio' | 'replanificacion'; convenioId opcional. */
    saveBaseline: function (name, items, tipoLb, convenioId) {
      return escribir_('cron_guardar_linea_base', { p_nombre: name || '', p_items: items || {},
        p_tipo: tipoLb || '', p_convenio: convenioId || '' }, null, 'crear línea base');
    },
    borrarBaseline: function (baselineId, confirmNro) {
      return escribir_('cron_borrar_linea_base', { p_baseline: String(baselineId), p_confirm: confirmNro || '' },
                       null, 'borrar línea base').then(function (d) { return d.borrada; });
    },
    saveConfig: function (config, obraId) {
      return escribir_('cron_guardar_config', { p_config: config || {} }, obraId, 'guardar configuración')
        .then(function (d) { return d.saved; });
    },
    saveCalendario: function (calendario, obraId) {
      return escribir_('cron_guardar_calendario', { p_calendario: calendario || [] }, obraId, 'guardar calendario')
        .then(function (d) { return d.saved; });
    },
    saveCategorias: function (cats, obraId) {
      return escribir_('cron_guardar_categorias', { p_cats: cats || [] }, obraId, 'guardar categorías')
        .then(function (d) { return d.saved; });
    },
    refreshProduccion: function () { return Promise.resolve(0); },   // ya no hay planilla externa
    /* Datos contractuales de la obra. Devuelve lo guardado + el plazo recalculado
       (calcPlazo), igual que saveObra_ del Apps Script. */
    saveObra: async function (obra, obraId) {
      var d = await escribir_('cron_guardar_obra', { p_datos: obra || {} }, obraId, 'guardar datos de la obra');
      d.plazo = (await datosPlazo(d.obra_id)).plazo;
      return d;
    },

    // ---- etapa 4: producción, certificación, comunicaciones, pista ----
    prodListas: function (obraId) { return prodListas_(obraId); },
    // envío directo (la cola offline lo usa para reenviar sin volver a encolar)
    _rawProdGuardar: async function (jornada, obraId) {
      await exigirSesion();
      var oid = oidDe_(obraId);
      var j = {};
      Object.keys(jornada || {}).forEach(function (k) { if (k !== 'fotos' && k !== 'fotos_ids') j[k] = jornada[k]; });
      j.submission_id = j.submission_id || nuevoSid_();
      var urls = await subirFotos_(oid, String(j.fecha || '').trim(), j.submission_id, (jornada || {}).fotos || []);
      var d = await escribir_('prod_guardar', { p_jornada: j, p_fotos: urls }, oid, 'guardar producción');
      return { guardados: d.guardados, submission_id: d.submission_id, fotos_urls: d.fotos_urls || [] };
    },
    // con red de seguridad: sin conexión, encola y sigue trabajando
    prodGuardar: function (jornada, obraId) {
      var oid = oidDe_(obraId);
      // el id se fija ACÁ: si la cola reenvía algo que ya llegó, la base lo reconoce y no lo duplica
      jornada = Object.assign({}, jornada, { submission_id: (jornada && jornada.submission_id) || nuevoSid_() });
      return API._rawProdGuardar(jornada, oid).catch(function (err) {
        var sinRed = (global.navigator && global.navigator.onLine === false) ||
                     /fetch|network|failed to fetch|load failed|networkerror/i.test((err && err.message) || '');
        if (!sinRed || !global.Outbox) throw err;
        var nFotos = (jornada.fotos || []).length;
        if (nFotos && global.PhotoStore) {
          return global.PhotoStore.stash(jornada.fotos).then(function (ids) {
            var light = {}; for (var k in jornada) if (k !== 'fotos') light[k] = jornada[k];
            light.fotos_ids = ids;
            global.Outbox.add({ action: 'prodGuardar', payload: light, obraId: oid });
            return { queued: true, guardados: (jornada.filas || []).length, submission_id: null, fotos: nFotos };
          });
        }
        global.Outbox.add({ action: 'prodGuardar', payload: jornada, obraId: oid });
        return { queued: true, guardados: (jornada.filas || []).length, submission_id: null, fotos: 0 };
      });
    },
    prodHistorial: function (limite, obraId) { return prodHistorial_(limite, obraId); },
    prodEditar: function (submissionId, cambios, obraId) {
      return escribir_('prod_editar', { p_id: String(submissionId), p_cambios: cambios || {} }, obraId, 'editar producción')
        .then(function (d) { return { editado: d.editado, cantFinal: d.cantFinal == null ? '' : d.cantFinal }; });
    },
    prodBorrar: function (submissionId, obraId) {
      return escribir_('prod_borrar', { p_id: String(submissionId) }, obraId, 'borrar producción')
        .then(function (d) { return d.borrado; });
    },
    certListar: function (obraId) { return certListar_(obraId); },
    certDatos: function (obraId) { return certDatos_(obraId); },
    /* cert = { cert_id?, nro?, mes, periodo_desde?, periodo_hasta?, fecha?, referencia?, observacion?, estado? }
       filas = [ { item_id, cant_certificada, observacion } ] — solo las de este certificado */
    certGuardarCertificado: function (cert, filas, obraId) {
      return escribir_('cert_guardar_certificado', { p_cert: cert || {}, p_filas: filas || [] }, obraId, 'guardar certificado');
    },
    comprasDatos: function (obraId) { return comprasDatos_(obraId); },
    compraGuardar: function (c, obraId) { return escribir_('compra_guardar', { p_compra: c || {} }, obraId, 'guardar pedido de compra'); },
    compraBorrar: function (id, obraId) { return escribir_('compra_borrar', { p_compra_id: String(id) }, obraId, 'borrar pedido de compra'); },
    compraEnlazar: function (pares, obraId) { return escribir_('compra_enlazar', { p_pares: pares || [] }, obraId, 'enlazar pedidos con recursos'); },
    compraImportar: function (filas, obraId) { return escribir_('compra_importar', { p_filas: filas || [] }, obraId, 'importar pedidos de compra'); },
    // ---- costos unitarios (SQL 26) ----
    costosVersiones: async function (obraId) {
      await exigirSesion();
      return todo('costo_version', 'version_id,obra_id,tipo,nombre,fecha,gg,bi,iva,archivo,nota,creado_por,creado_en',
                  deObra(oidDe_(obraId)), ['fecha', 'version_id']);
    },
    costoVersionDatos: async function (versionId) {
      await exigirSesion();
      var f = function (q) { return q.eq('version_id', versionId); };
      var r = await Promise.all([
        todo('costo_item', '*', f, ['clave']),
        todo('costo_linea', '*', f, ['clave', 'bloque', 'orden']),
        todo('costo_precio', '*', f, ['recurso_id'])
      ]);
      var n = function (v) { return v === null || v === undefined ? null : Number(v); };
      var NUM_I = ['orden', 'cantidad', 'prod_ph', 'tot_equipos', 'tot_mo', 'costo_ejec', 'tot_mat', 'tot_transp', 'costo_directo',
                   'gg_pct', 'bi_pct', 'iva_pct', 'costo_unitario', 'costo_adoptado'];
      var NUM_L = ['orden', 'rendimiento', 'personal', 'horas', 'cuantia', 'desperdicio', 'dmt', 'cantidad', 'precio', 'parcial'];
      var NUM_P = ['precio', 'dmt', 'factor_dmt', 'precio_transporte'];
      var conv = function (rows, ks) { rows.forEach(function (x) { ks.forEach(function (k) { x[k] = n(x[k]); }); }); return rows; };
      return { items: conv(r[0], NUM_I), lineas: conv(r[1], NUM_L), precios: conv(r[2], NUM_P) };
    },
    costoImportar: function (datos, obraId) { return escribir_('costo_importar', { p: datos || {} }, obraId, 'importar costos unitarios'); },
    costoBorrar: function (versionId, obraId) { return escribir_('costo_borrar', { p_version: versionId }, obraId, 'borrar versión de costos'); },
    recursoIds: async function () {
      await exigirSesion();
      return (await todo('recurso', 'recurso_id', null, ['recurso_id'])).map(function (x) { return x.recurso_id; });
    },
    recImportar: function (filas) { return escribir_('rec_importar', { p_filas: filas || [] }, null, 'cargar maestro de recursos'); },
    irImportar: function (filas, obraId) { return escribir_('ir_importar', { p_filas: filas || [] }, obraId, 'cargar recursos por ítem'); },
    trDatos: function (obraId, desde) { return trDatos_(obraId, desde); },
    _rawTrGuardar: async function (carga, obraId) {
      await exigirSesion();
      var oid = oidDe_(obraId);
      var c = {};
      Object.keys(carga || {}).forEach(function (k) { if (k !== 'fotos' && k !== 'fotos_ids' && k !== 'viajes') c[k] = carga[k]; });
      c.carga_id = c.carga_id || nuevoSid_();
      var urls = await subirFotos_(oid, String(c.fecha || '').trim(), 'tr_' + c.carga_id, (carga || {}).fotos || []);
      var d = await escribir_('tr_guardar', { p_carga: c, p_viajes: (carga || {}).viajes || [], p_fotos: urls }, oid, 'guardar carga de transporte');
      return { carga_id: d.carga_id, viajes: d.viajes, repetido: !!d.repetido };
    },
    // con red de seguridad: sin conexión, encola (fotos a IndexedDB) y sigue
    trGuardar: function (carga, obraId) {
      var oid = oidDe_(obraId);
      carga = Object.assign({}, carga, { carga_id: (carga && carga.carga_id) || nuevoSid_() });
      return API._rawTrGuardar(carga, oid).catch(function (err) {
        var sinRed = (global.navigator && global.navigator.onLine === false) ||
                     /fetch|network|failed to fetch|load failed|networkerror/i.test((err && err.message) || '');
        if (!sinRed || !global.Outbox) throw err;
        var nFotos = (carga.fotos || []).length;
        var encolar = function (payload) { global.Outbox.add({ action: 'trGuardar', payload: payload, obraId: oid }); return { queued: true, carga_id: carga.carga_id, fotos: nFotos }; };
        if (nFotos && global.PhotoStore) {
          return global.PhotoStore.stash(carga.fotos).then(function (ids) {
            var light = {}; for (var k in carga) if (k !== 'fotos') light[k] = carga[k];
            light.fotos_ids = ids;
            return encolar(light);
          });
        }
        return encolar(carga);
      });
    },
    trEditar: function (cargaId, cambios, viajes, obraId) {
      return escribir_('tr_editar', { p_carga_id: String(cargaId), p_cambios: cambios || {}, p_viajes: viajes === undefined ? null : viajes }, obraId, 'corregir carga de transporte');
    },
    adjuntosDe: function (modulo, refId, obraId) {
      var oid = oidDe_(obraId);
      return todo('adjunto', 'adjunto_id,modulo,ref_id,tipo,nombre,mime,tamano,ruta,subido_por,subido_en',
        function (q) { q = q.eq('obra_id', oid).eq('modulo', modulo); return refId != null ? q.eq('ref_id', String(refId)) : q; }, ['subido_en']);
    },
    adjuntoSubir: function (file, modulo, refId, tipo, obraId) { return adjuntoSubir_(file, modulo, refId, tipo, obraId); },
    adjuntoUrl: async function (ruta) {
      var r = await sb.storage.from(ADJ_BUCKET).createSignedUrl(ruta, 3600);
      if (r.error) throw new Error('No se pudo abrir el adjunto: ' + r.error.message);
      return r.data.signedUrl;
    },
    adjuntoBorrar: async function (adjuntoId, obraId) {
      var d = await escribir_('adjunto_borrar', { p_adjunto: String(adjuntoId) }, obraId, 'borrar adjunto');
      if (d && d.ruta) await sb.storage.from(ADJ_BUCKET).remove([d.ruta]).catch(function () {});
      return d;
    },
    // ---- circuito de aprobación (SQL 23) ----
    compraAprobar: function (compraId, decision, obs, obraId) {
      return escribir_('compra_aprobar', { p_compra_id: String(compraId), p_decision: decision || '', p_obs: obs || '' }, obraId, 'aprobar pedido');
    },
    compraAprobarCot: function (compraId, cot, obs, obraId) {
      return escribir_('compra_aprobar_cot', { p_compra_id: String(compraId), p_cot: cot || 0, p_obs: obs || '' }, obraId, 'aprobar cotización');
    },
    // pedidos de TODAS las obras que el usuario puede ver (Compras / Gerente / admin)
    comprasTodas: async function () {
      await exigirSesion();
      var r = await Promise.all([
        todo('compra', '*', null, ['fecha_solicitud', 'creado_en', 'compra_id']),
        sb.from('obra').select('obra_id,nombre').order('obra_id'),
        todo('adjunto', 'obra_id,ref_id', function (q) { return q.eq('modulo', 'compra'); }, ['obra_id']).catch(function () { return []; })
      ]);
      var nom = {}; ((r[1] && r[1].data) || []).forEach(function (o) { nom[o.obra_id] = o.nombre || o.obra_id; });
      var nAdj = {}; (r[2] || []).forEach(function (a) { var k = a.obra_id + '|' + a.ref_id; nAdj[k] = (nAdj[k] || 0) + 1; });
      var num = function (v) { return v === null || v === undefined ? null : nnum_(v); };
      return r[0].map(function (c) {
        var o = {}; Object.keys(c).forEach(function (k) { o[k] = c[k]; });
        ['cantidad', 'pu1', 'pu2', 'pu3', 'monto_regular', 'monto_logrado', 'cant_recibida'].forEach(function (k) { o[k] = num(c[k]); });
        o.item_id = c.item_id ? nid_(c.item_id) : ''; o.obra_nombre = nom[c.obra_id] || c.obra_id; o.n_adj = nAdj[c.obra_id + '|' + c.compra_id] || 0;
        return o;
      }).reverse();
    },
    // ---- administración de usuarios (solo admin) ----
    admUsuarios: async function () {
      await exigirSesion();
      var r = await sb.rpc('adm_usuarios');
      if (r.error) throw traducir(r.error, 'usuarios');
      return r.data || [];
    },
    admUsuarioGuardar: function (u) { return escribir_('adm_usuario_guardar', { p: u || {} }, null, 'guardar usuario'); },
    compraAjusteGuardar: function (aj, obraId) { return escribir_('compra_ajuste_guardar', { p: aj || {} }, obraId, 'guardar lo ya pedido'); },
    trCamionGuardar: function (camion) {
      return escribir_('tr_camion_guardar', { p: camion || {} }, null, 'guardar camión en el maestro');
    },
    stockConteoGuardar: function (conteo, obraId) {
      return escribir_('stock_conteo_guardar', { p: conteo || {} }, obraId, 'guardar ajuste de stock');
    },
    stockConteoBorrar: function (conteoId, obraId) {
      return escribir_('stock_conteo_borrar', { p_conteo: String(conteoId) }, obraId, 'borrar ajuste de stock');
    },
    trBorrar: function (cargaId, obraId) {
      return escribir_('tr_borrar', { p_carga_id: String(cargaId) }, obraId, 'borrar carga de transporte');
    },
    compDatos: function (obraId) { return compDatos_(obraId); },
    compGuardar: function (etapa, items, reemplazar, obraId) {
      return escribir_('comp_guardar', { p_etapa: String(etapa || 'contrato'), p_items: compactar_(items || []), p_reemplazar: !!reemplazar }, obraId, 'guardar cómputo');
    },
    compBorrarEtapa: function (etapa, obraId) { return escribir_('comp_borrar_etapa', { p_etapa: String(etapa) }, obraId, 'borrar cómputo'); },
    certBorrarCertificado: function (certId, obraId) {
      return escribir_('cert_borrar_certificado', { p_cert: String(certId) }, obraId, 'borrar certificado');
    },
    certGuardar: function (mes, filas, nroCert, obraId) {
      return escribir_('cert_guardar', { p_mes: String(mes || ''), p_filas: filas || [], p_nro: nroCert || '' },
                       obraId, 'guardar certificación');
    },
    comListar: function (obraId) { return comListar_(obraId); },
    // sin com_id = alta; con com_id = edición (una nota cerrada no se edita)
    comGuardar: function (nota, obraId) {
      return escribir_('com_guardar', { p_nota: nota || {} }, obraId, 'guardar comunicación');
    },
    comCerrar: function (comId, obraId) {
      return escribir_('com_cerrar', { p_com: String(comId) }, obraId, 'cerrar comunicación')
        .then(function (d) { return d.cerrada; });
    },
    comBorrar: function (comId, obraId) {
      return escribir_('com_borrar', { p_com: String(comId) }, obraId, 'borrar comunicación')
        .then(function (d) { return d.borrada; });
    },
    pistaCargar: function (obraId) { return pistaCargar_(obraId); },
    pistaGuardarEjes: function (ejes, obraId) {
      return escribir_('pista_guardar_ejes', { p_ejes: ejes || [] }, obraId, 'guardar ejes');
    },
    pistaGuardarEstados: function (estados, obraId) {
      return escribir_('pista_guardar_estados', { p_estados: estados || [] }, obraId, 'guardar estados de pista');
    },
    pistaGuardarTramos: function (ejeId, tramos, obraId) {
      return escribir_('pista_guardar_tramos', { p_eje: String(ejeId), p_tramos: tramos || [] }, obraId, 'guardar tramos');
    },
    pistaSnapshot: function (ejeId, fecha, nota, resumen, obraId) {
      return escribir_('pista_snapshot', { p_eje: String(ejeId), p_fecha: fecha || null, p_nota: nota || '',
                                           p_resumen: resumen || null }, obraId, 'snapshot de pista');
    },

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
    /* conv = { convenio_id?, nro?, tipo?, estado?, fecha_presentacion?, fecha_suscripcion?, fecha_resolucion?,
                dias_ampliacion?, descripcion?, doc_url? }
       filas = [ { item_id, cant (RESULTANTE), pu?, descripcion?, um?, justificacion? } ] */
    convGuardar: function (conv, filas, obraId) {
      return escribir_('conv_guardar', { p_conv: conv || {}, p_filas: filas || [] }, obraId, 'guardar convenio');
    },
    convEstado: function (convenioId, estado, obraId) {
      return escribir_('conv_estado', { p_convenio: String(convenioId), p_estado: String(estado || '') }, obraId, 'cambiar estado del convenio');
    },
    convBorrar: function (convenioId, confirmNro, obraId) {
      return escribir_('conv_borrar', { p_convenio: String(convenioId), p_confirm: confirmNro || '' }, obraId, 'borrar convenio');
    },
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
