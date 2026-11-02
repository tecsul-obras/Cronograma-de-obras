/* =========================================================================
 * presentacion.js — PRESENTACIÓN SEMANAL de obra en PowerPoint · v20261102d
 *
 * Botón «📊 Presentación semanal» en Avance / Informes y en ☰ Funciones.
 * Arma un .pptx en el navegador (pptxgenjs, se carga recién al usarlo) con
 * los datos que ya tiene la app, para la reunión de los lunes:
 *   1 Portada (foto de la última jornada)
 *   2 Resumen económico + curva S (mismas tarjetas que el cronograma)
 *   · Avance por categoría / subfrente (opcional, una por categoría)
 *   3 Cronograma filtrado: en ejecución, atrasados y por iniciar (vigente)
 *   4 Saldos de obra (cantidad y monto)
 *   5 Semana analizada: estado de las jornadas + programado vs ejecutado
 *     con montos y total (sigue en otra diapositiva si no entra)
 *   6 Causas de incumplimiento y PPC de las últimas 8 semanas
 *   7 Programación de la semana siguiente
 *   8 Situación de pista · 9 Certificación · 10 Equipos (partes)
 *  11 Combustible y transporte · 12 Compras sin OC · 13 Costos (Power BI)
 *  14 Pendientes de comité, alertas y planes de acción · 15 Fotos de la semana
 *
 * Reglas:
 *  · Nada se escribe en la base: solo lee.
 *  · Los números salen de las mismas funciones que la pantalla (app.js):
 *    tarjetas = renderKPIs, curvas = calcularCurvas, plan semanal =
 *    filasPlanSemana (foto si la semana cerró), % planeado = itemAvancePlaneado
 *    (cronograma VIGENTE), ejecutado = producción (liberaciones).
 *  · Los textos de «Alertas automáticas» son reglas fijas sobre los datos
 *    (mismo dato → mismo texto). Incidentes y planes de acción quedan en
 *    blanco para el residente.
 *  · Si un módulo no tiene datos o el usuario no tiene permiso de leerlo
 *    (equipos, combustible, minuta…), esa diapositiva se omite o lo avisa.
 * ========================================================================= */
(function (global) {
  'use strict';

  var VERSION = '20261102d';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function leer(n) { try { return (0, eval)(n); } catch (e) { return undefined; } }
  function fn(n) { var f = leer(n); return typeof f === 'function' ? f : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rol() { return global.__role || ''; }
  function puedeUsar() { return ['transporte', 'produccion', ''].indexOf(rol()) < 0; }
  function sb() { try { return global.ObraAPI._sb(); } catch (e) { return null; } }
  function obraId() { try { return global.ObraAPI.getObraId(); } catch (e) { var o = leer('OBRA'); return o && o.id || ''; } }
  function toast(m) { var t = fn('toast'); if (t) t(m); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }

  // ------------------------------------------------------------- formatos
  function num(v, d) {
    if (v == null || !isFinite(v)) return '—';
    d = d || 0;
    return Number(v).toLocaleString('es-PY', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function M(gs) { return '₲ ' + num((gs || 0) / 1e6) + ' M'; }
  function pc(v, d) { return v == null || !isFinite(v) ? '—' : num(v, d == null ? 1 : d) + '%'; }
  function cant(v) { var a = Math.abs(v || 0); return num(v, a === 0 ? 0 : (a < 100 ? 2 : 0)); }
  function sgn(v, txt) { return (v > 0 ? '+' : v < 0 ? '−' : '') + txt; }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dm(d) { return d.getDate() + '/' + (d.getMonth() + 1); }
  function dmy(s) { if (!s) return '—'; var p = String(s).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function parseD(s) { return s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null; }
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  function mesCorto(mk) { return MES[+mk.slice(5, 7) - 1] + '-' + mk.slice(2, 4); }
  function mesLargo(mk) { return MESL[+mk.slice(5, 7) - 1] + ' ' + mk.slice(0, 4); }
  var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // ------------------------------------------------------------- paleta
  var C = {
    navy: '0E2A44', brand: '005D95', light: '92C5EA', ink: '1D2B38', muted: '6B7A89',
    bg2: 'F2F5F8', line: 'DDE3EA', plan: '9AA9B8', prod: '005D95', cert: 'E39B2B', meta: '6FAF8E',
    ok: '2E9E5B', bad: 'D64545', warn: 'E39B2B', white: 'FFFFFF',
    okBg: 'DDF1E4', badBg: 'FBE3E3', infoBg: 'DCEBF5', grisBg: 'E9EDF2'
  };
  var W = 13.333, MX = 0.5;

  // ------------------------------------------------------------- librerías
  var libs = {};
  function cargarScript(src, g) {
    if (global[g]) return Promise.resolve(global[g]);
    if (!libs[src]) libs[src] = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { ok(global[g]); };
      s.onerror = function () { libs[src] = null; mal(new Error('No se pudo cargar ' + src + ' (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return libs[src];
  }
  async function cargarPptx() {
    await cargarScript('jszip.min.js?v=3.10.1', 'JSZip');
    return cargarScript('pptxgen.min.js?v=4.0.1', 'PptxGenJS');
  }
  function blobADataURL(b) {
    return new Promise(function (ok, mal) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = mal; r.readAsDataURL(b); });
  }
  // foto → JPEG reducido (máx. 1400 px) para que el .pptx no pese de más
  async function fotoReducida(url) {
    var r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var b = await r.blob();
    var bmp = await createImageBitmap(b);
    var k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return { data: cv.toDataURL('image/jpeg', 0.82).replace(/^data:/, ''), w: cv.width, h: cv.height };
  }

  // ------------------------------------------------------------- consultas
  async function q(promesa) {
    try { var r = await promesa; if (r.error) return { error: r.error, data: null }; return { data: r.data || [] }; }
    catch (e) { return { error: e, data: null }; }
  }

  /* ======================================================================
   *  DATOS — todo lo que necesita la presentación, leído de app.js y la base
   * ====================================================================== */
  async function juntar(opt, avance) {
    var A = {};
    var ITEMS = leer('ITEMS') || [], PROD = leer('PROD') || {}, CERT = leer('CERT') || {};
    var byId = leer('byId') || {}, OBRA = leer('OBRA') || {}, CLIMA = leer('CLIMA') || {};
    var esComp = fn('esComputable'), cv = fn('cantVigente'), cc = fn('cantContractual');
    var avPlanItem = fn('itemAvancePlaneado'), prodEnSemana = fn('prodEnSemana');
    var lunes = fn('lunesDeSemana_'), isoWeekOf = fn('isoWeekOf'), fechasEf = fn('fechasEfectivas');
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var oid = obraId();
    A.oid = oid; A.hoy = hoy;
    A.comp = ITEMS.filter(function (i) { return esComp(i); });

    // ---- obra
    A.obra = { nombre: OBRA.nombre || (leer('D') && leer('D').obra && leer('D').obra.nombre) || oid, tipo: OBRA.tipo_obra || 'privada',
               ini: OBRA.fecha_inicio, fin: OBRA.fin_vigente || OBRA.fecha_fin, plazo: OBRA.plazo_meses };
    var S = sb();
    if (S) {
      var ro = await q(S.from('obra').select('nombre,llamado,lote,fecha_inicio,fecha_fin,plazo_meses').eq('obra_id', oid).maybeSingle());
      if (ro.data && !Array.isArray(ro.data)) { A.obra.llamado = ro.data.llamado; A.obra.lote = ro.data.lote; A.obra.ini = A.obra.ini || ro.data.fecha_inicio; A.obra.fin = A.obra.fin || ro.data.fecha_fin; A.obra.plazo = A.obra.plazo || ro.data.plazo_meses; }
      var rc = await q(S.from('obras').select('clave').eq('codigo', oid).limit(1));
      A.clave = rc.data && rc.data[0] ? rc.data[0].clave : null;
    }
    var dIni = parseD(A.obra.ini), dFin = parseD(A.obra.fin);
    if (dIni && dFin && dFin > dIni) {
      A.plazoPct = Math.max(0, Math.min(100, (hoy - dIni) / (dFin - dIni) * 100));
      A.mesesTransc = Math.max(0, Math.round((hoy - dIni) / (30.44 * 864e5)));
      A.mesesTot = Math.round((dFin - dIni) / (30.44 * 864e5));
    }

    // ---- semanas
    A.wkA = opt.wkA; A.wkP = opt.wkP;
    A.lunA = lunes(A.wkA); A.domA = new Date(A.lunA); A.domA.setDate(A.lunA.getDate() + 6);
    A.lunP = lunes(A.wkP); A.domP = new Date(A.lunP); A.domP.setDate(A.lunP.getDate() + 6);
    A.txtA = A.wkA.split('-')[1] + ' · ' + dm(A.lunA) + ' – ' + dm(A.domA) + '/' + A.domA.getFullYear();
    A.txtP = A.wkP.split('-')[1] + ' · ' + dm(A.lunP) + ' – ' + dm(A.domP) + '/' + A.domP.getFullYear();

    // ---- tarjetas (idéntico a renderKPIs de app.js)
    avance('Calculando tarjetas y curvas…');
    var contrato = fn('contratoTotal')();
    var planTo = 0, planTot = 0, prod = 0;
    A.comp.forEach(function (i) {
      var base = i.ptot; planTot += base;
      if (base) { var fp = avPlanItem(i); if (fp != null) planTo += base * (fp / 100); }
      var pr = PROD[i.id];
      if (pr && pr.total) prod += pr.total * i.pu;
      else if (i.avance_real_prod != null) prod += base * (i.avance_real_prod / 100);
    });
    var contratoOrig = fn('contratoOriginalTotal')();
    var esPub = fn('esObraPublica')();
    var aprob = (fn('conveniosAprobados')() || []).slice().sort(function (a, b) { return (+a.orden || 0) - (+b.orden || 0); });
    var hayConv = esPub && (aprob.length > 0 || ITEMS.some(fn('tieneConvenio')));
    var montoConv = null;
    if (hayConv) montoConv = A.comp.reduce(function (s, i) { return s + cc(i) * (i.pu || 0); }, 0);
    var hayAjustes = ITEMS.some(fn('tieneAjuste'));
    var montoCert = ITEMS.reduce(function (s, i) { return s + (i.cant_certificada_acum || 0) * i.pu; }, 0);
    var prodSem = A.comp.reduce(function (s, i) { return s + (prodEnSemana(i.id, A.wkA) || 0) * (i.pu || 0); }, 0);
    A.k = {
      contrato: contrato, contratoOrig: contratoOrig, montoConv: montoConv, ultConv: aprob[aprob.length - 1] || null,
      muestraAjustado: hayAjustes || (!esPub && Math.abs(contrato - contratoOrig) > 0.5),
      prod: prod, cert: montoCert, prodSem: prodSem, nItems: ITEMS.length,
      avPlan: planTot ? planTo / planTot * 100 : 0, avProd: contrato ? prod / contrato * 100 : 0
    };
    A.k.brecha = A.k.avProd - A.k.avPlan;
    A.convenios = (leer('CONVENIOS') || []).slice();

    // ---- curvas (idéntico a renderCurvas)
    var BL = leer('BASELINES') || [], blDe = fn('baselinesDe');
    var contrs = blDe('contractual'), metas = blDe('meta');
    var cId = leer('CURVA_BL_CONTR'), mId = leer('CURVA_BL_META');
    var blC = cId ? BL.find(function (b) { return b.id === cId; }) : contrs[contrs.length - 1];
    var blM = mId ? BL.find(function (b) { return b.id === mId; }) : metas[metas.length - 1];
    A.curvas = fn('calcularCurvas')(blC, blM);
    A.blCnombre = blC ? blC.name : '';

    // ---- por categoría (subfrentes)
    var CATS = leer('CATS') || [];
    var porCat = {};
    A.comp.forEach(function (i) { var k = i.cat || 'Sin categoría'; (porCat[k] = porCat[k] || []).push(i); });
    A.cats = CATS.filter(function (c) { return porCat[c] && porCat[c].some(function (i) { return (i.cant || 0) * (i.pu || 0) > 0 || i.ptot > 0; }); })
      .map(function (c) { return { nombre: c, items: porCat[c] }; });
    Object.keys(porCat).forEach(function (c) { if (CATS.indexOf(c) < 0) A.cats.push({ nombre: c, items: porCat[c] }); });

    // ---- cronograma filtrado (vigente)
    var vent0 = new Date(A.lunP); vent0.setDate(vent0.getDate() - 28);
    var vent1 = new Date(A.lunP); vent1.setDate(vent1.getDate() + 56);
    A.vent0 = vent0; A.vent1 = vent1;
    var crono = [];
    A.comp.forEach(function (i) {
      var q0 = cv(i) || 0; if (!(q0 > 0) || !(i.pu > 0)) return;
      var f = fechasEf(i); var a = parseD(f.ini), b = parseD(f.fin); if (!a || !b) return;
      var pPlan = avPlanItem(i); pPlan = pPlan == null ? 0 : pPlan;
      var pr = PROD[i.id]; var ej = pr && pr.total ? pr.total : 0;
      var pProd = ej / q0 * 100;
      if (pProd >= 99.5) return;                                   // terminado
      var atraso = Math.max(0, (Math.min(pPlan, 100) - pProd) / 100 * q0 * i.pu);
      var enVentana = a <= vent1 && b >= vent0;
      var atrasado = pPlan - pProd > 2 && a <= vent1;
      if (!enVentana && !atrasado) return;
      crono.push({ id: i.id, desc: i.desc, um: i.um, ini: a, fin: b, pPlan: pPlan, pProd: pProd, atraso: atraso,
                   vencido: b < hoy, brecha: pProd - Math.min(pPlan, 100) });
    });
    crono.sort(function (x, y) { return (y.atraso - x.atraso) || (x.ini - y.ini); });
    A.crono = crono;

    // ---- saldos de obra (igual que Avance › Saldos de obra, ejecutado según producción)
    var sal = [], pend = 0, sobre = 0, nSobre = 0, nSaldo = 0;
    A.comp.forEach(function (i) {
      var q0 = cv(i) || 0; var pr = PROD[i.id]; var ej = pr && pr.total ? pr.total : 0;
      var s = q0 - ej, m = s * (i.pu || 0);
      if (s > 1e-9) { pend += m; nSaldo++; sal.push({ id: i.id, desc: i.desc, um: i.um, cv: q0, ej: ej, s: s, m: m }); }
      else if (s < -1e-9) { sobre += -m; nSobre++; }
    });
    sal.sort(function (a, b) { return b.m - a.m; });
    A.saldos = { filas: sal, pend: pend, sobre: sobre, nSobre: nSobre, nSaldo: nSaldo };

    // ---- plan semanal: semana analizada, siguiente e historial de PPC
    avance('Leyendo el plan semanal…');
    A.semA = semana(A.wkA, true);
    A.semP = semana(A.wkP, false);
    var ALL = leer('ALLWEEKS') || [];
    var ia = ALL.indexOf(A.wkA);
    A.ppcHist = [];
    for (var k = Math.max(0, ia - 7); k <= ia && ia >= 0; k++) {
      var s1 = k === ia ? A.semA : semana(ALL[k], false);
      if (s1.nPlan) A.ppcHist.push([ALL[k].split('-')[1], s1.ppc]);
    }

    // ---- jornadas de la semana (estado, lluvia, fotos)
    avance('Leyendo jornadas y fotos…');
    A.jorn = {}; A.fotos = [];
    if (S) {
      var rj = await q(S.from('produccion_jornada').select('fecha,estado,lluvia_mm,fotos,cargado_en').eq('obra_id', oid)
        .gte('fecha', ymd(A.lunA)).lte('fecha', ymd(A.domA)).order('fecha'));
      (rj.data || []).forEach(function (j) {
        var f = String(j.fecha).slice(0, 10);
        var prev = A.jorn[f];
        // si hay varias el mismo día, gana la que tuvo actividad
        if (!prev || /con actividad/i.test(j.estado || '')) A.jorn[f] = { estado: j.estado || '', mm: j.lluvia_mm };
        (Array.isArray(j.fotos) ? j.fotos : String(j.fotos || '').split(/\n|,/)).forEach(function (u) {
          u = String(u || '').trim(); if (/^https?:\/\//.test(u)) A.fotos.push({ url: u, fecha: f });
        });
      });
      if (!A.fotos.length) {   // portada: la última foto cargada aunque no sea de la semana
        var ru = await q(S.from('produccion_jornada').select('fecha,fotos').eq('obra_id', oid).not('fotos', 'is', null)
          .lte('fecha', ymd(A.domA)).order('fecha', { ascending: false }).limit(15));
        (ru.data || []).some(function (j) {
          var l = (Array.isArray(j.fotos) ? j.fotos : []).filter(function (u) { return /^https?:\/\//.test(u); });
          if (l.length) { A.fotoPortadaUrl = { url: l[0], fecha: String(j.fecha).slice(0, 10) }; return true; }
          return false;
        });
      }
    }
    var mk = ymd(A.lunA).slice(0, 7);
    A.climaMes = { mk: mk, c: CLIMA[mk] || null };

    // ---- situación de pista
    avance('Leyendo situación de pista y certificados…');
    try {
      var P = await global.ObraAPI.pistaCargar(oid);
      if (P && P.tramos && P.tramos.length) A.pista = P;
    } catch (e) { A.pista = null; }

    // ---- certificación
    var certMes = {}, prodMes = {};
    A.comp.forEach(function (i) {
      var c = CERT[i.id]; if (c && c.by_month) Object.keys(c.by_month).forEach(function (m) { certMes[m] = (certMes[m] || 0) + (c.by_month[m] || 0) * (i.pu || 0); });
      var pr = PROD[i.id]; if (pr && pr.by_date) Object.keys(pr.by_date).forEach(function (d) { var m = d.slice(0, 7); prodMes[m] = (prodMes[m] || 0) + (pr.by_date[d] || 0) * (i.pu || 0); });
    });
    A.certMes = certMes; A.prodMes = prodMes;
    var mesesCert = Object.keys(certMes).filter(function (m) { return Math.abs(certMes[m]) > 0.5; }).sort();
    A.ultCertMes = mesesCert[mesesCert.length - 1] || null;
    if (S) {
      var rce = await q(S.from('certificado').select('nro,mes,estado').eq('obra_id', oid).order('mes'));
      A.certs = rce.data || [];
    }
    var mesesSinCert = Object.keys(prodMes).filter(function (m) { return (!A.ultCertMes || m > A.ultCertMes) && prodMes[m] > 0.5 && m < ymd(hoy).slice(0, 7); }).sort();
    A.prodSinCert = mesesSinCert.reduce(function (s, m) { return s + prodMes[m]; }, 0);
    A.mesesSinCert = mesesSinCert;

    // ---- equipos, combustible, transporte, compras, minuta, Power BI
    avance('Leyendo equipos, combustible, transporte y compras…');
    var d0 = ymd(A.lunA), d1 = ymd(A.domA);
    if (S && A.clave) {
      var rp = await q(S.from('partes').select('equipo_id,fecha,horas_horometro,horas_totales,tiene_falla').eq('obra_clave', A.clave).gte('fecha', d0).lte('fecha', d1));
      if (!rp.error) {
        var eq = {};
        rp.data.forEach(function (p) {
          var e = eq[p.equipo_id] || (eq[p.equipo_id] = { id: p.equipo_id, n: 0, h: 0, f: 0, ult: '' });
          e.n++; e.h += Number(p.horas_horometro != null ? p.horas_horometro : (p.horas_totales || 0)) || 0;
          if (p.tiene_falla) e.f++; if (p.fecha > e.ult) e.ult = p.fecha;
        });
        var ids = Object.keys(eq);
        if (ids.length) {
          var rd = await q(S.from('equipos').select('id,descripcion').in('id', ids));
          (rd.data || []).forEach(function (x) { if (eq[x.id]) eq[x.id].desc = x.descripcion; });
        }
        A.equipos = ids.map(function (k) { return eq[k]; }).sort(function (a, b) { return b.h - a.h; });
      }
      var rcm = await q(S.from('combustible_movimientos').select('equipo_id,litros,fecha').eq('obra_clave', A.clave)
        .eq('actividad', 'Despacho de combustible').gte('fecha', d0).lte('fecha', d1));
      if (!rcm.error) {
        var lt = {};
        rcm.data.forEach(function (m) { var k2 = m.equipo_id || 'Sin equipo'; lt[k2] = (lt[k2] || 0) + (Number(m.litros) || 0); });
        A.combustible = Object.keys(lt).map(function (k2) { return [k2, lt[k2]]; }).sort(function (a, b) { return b[1] - a[1]; });
      }
    }
    if (S) {
      var rt = await q(S.from('transporte_carga').select('carga_id,tipo_material,origen,destino').eq('obra_id', oid).gte('fecha', d0).lte('fecha', d1));
      if (!rt.error) {
        var cargas = rt.data, porCarga = {};
        cargas.forEach(function (c) { porCarga[c.carga_id] = c; });
        var grupo = {};
        if (cargas.length) {
          var idsC = cargas.map(function (c) { return c.carga_id; });
          var viajes = [];
          for (var b0 = 0; b0 < idsC.length; b0 += 150) {
            var rv = await q(S.from('transporte_viaje').select('carga_id,viajes,toneladas').eq('obra_id', oid).in('carga_id', idsC.slice(b0, b0 + 150)));
            viajes = viajes.concat(rv.data || []);
          }
          viajes.forEach(function (v) {
            var c = porCarga[v.carga_id] || {};
            var kk = (c.tipo_material || 'Sin material') + '|' + (c.origen || '—') + ' → ' + (c.destino || '—');
            var g = grupo[kk] || (grupo[kk] = { mat: c.tipo_material || 'Sin material', ruta: (c.origen || '—') + ' → ' + (c.destino || '—'), v: 0, t: 0 });
            g.v += Number(v.viajes) || 0; g.t += Number(v.toneladas) || 0;
          });
        }
        A.transporte = Object.keys(grupo).map(function (k3) { return grupo[k3]; }).sort(function (a, b) { return b.v - a.v; });
      }
      var rco = await q(S.from('compra').select('descripcion,cantidad,um,fecha_solicitud,fecha_requerida,estado_oc,entrega').eq('obra_id', oid));
      if (!rco.error) {
        A.compras = rco.data.filter(function (c) { return !String(c.estado_oc || '').trim() && !String(c.entrega || '').trim(); })
          .map(function (c) {
            var fr = parseD(c.fecha_requerida || c.fecha_solicitud);
            return { desc: c.descripcion || '—', cant: Number(c.cantidad) || 0, um: c.um || '', freq: c.fecha_requerida || c.fecha_solicitud || '',
                     dias: fr ? Math.round((hoy - fr) / 864e5) : null };
          }).sort(function (a, b) { return (b.dias || 0) - (a.dias || 0); });
      }
      var rm = await q(S.from('minuta_items').select('titulo,responsables,estado,fecha_limite,fecha_comite,obra_clave').neq('estado', 'Listo').order('fecha_comite', { ascending: false }).limit(400));
      if (!rm.error) {
        var STOP = ['ruta', 'obra', 'lote', 'del', 'los', 'las', 'para', 'con', 'contrato'];
        var pal = norm(A.obra.nombre).split(' ').filter(function (w) { return w.length >= 4 && STOP.indexOf(w) < 0; })[0] || norm(A.obra.nombre);
        A.minuta = rm.data.filter(function (m) {
          if (A.clave && m.obra_clave === A.clave) return true;
          var t = norm(m.titulo);
          return t.indexOf(norm(A.obra.nombre)) >= 0 || (pal && t.indexOf(pal) >= 0);
        }).slice(0, 6);
      }
      var rb = await q(S.from('reportes_bi').select('nombre,url,activo'));
      var pbi = (rb.data || []).find(function (r) { return r.activo !== false && /costo/i.test(r.nombre || ''); });
      A.pbiCostos = pbi ? pbi.url : null;
    }

    // ---- fotos (se bajan y se achican)
    A.fotosImg = [];
    if (opt.fotos) {
      var lista = A.fotos.slice(0, 24);
      for (var f0 = 0; f0 < lista.length; f0++) {
        avance('Bajando fotos de la semana (' + (f0 + 1) + ' de ' + lista.length + ')…');
        try { var im = await fotoReducida(lista[f0].url); im.fecha = lista[f0].fecha; A.fotosImg.push(im); }
        catch (e) { A.fotosFallidas = (A.fotosFallidas || 0) + 1; }
      }
    }
    var fp0 = A.fotosImg[A.fotosImg.length - 1] || null;
    if (!fp0 && A.fotoPortadaUrl) { try { fp0 = await fotoReducida(A.fotoPortadaUrl.url); fp0.fecha = A.fotoPortadaUrl.fecha; } catch (e) { fp0 = null; } }
    A.fotoPortada = fp0;
    try { A.logo = (await blobADataURL(await (await fetch('tecsul-logo.png?v=1')).blob())).replace(/^data:/, ''); } catch (e) { A.logo = null; }

    A.alertas = alertas(A);
    return A;

    /* filas del plan semanal de una semana, con la misma lógica de renderWeekly */
    function semana(wk, conNoPlan) {
      var out = { wk: wk, filas: [], nPlan: 0, done: 0, mp: 0, me: 0, ppc: 0 };
      if (!wk) return out;
      var cerr = fn('semanaCerrada')(wk), vis = fn('filaVisiblePlan_'), sinCant = fn('sinCantidadPlan'), estEf = fn('estadoEfectivo');
      var rows = (fn('filasPlanSemana')(wk) || []).filter(function (w) { return vis(w, cerr); });
      if (conNoPlan) {
        var ya = {}; rows.forEach(function (w) { ya[String(w.item_id)] = 1; });
        ITEMS.forEach(function (i) {
          if (ya[String(i.id)] || !fn('vaAlPlanSemanal')(i)) return;
          var e = prodEnSemana(i.id, wk);
          if (e > 0) rows.push({ item_id: i.id, actividad: '', um: i.um || '', cant_prevista: null, cant_ejecutada: e, causa: '', _noPlan: true, week: wk });
        });
      }
      rows.sort(function (a, b) { var f = fn('cmpItemId'); return f ? f(a.item_id, b.item_id) : String(a.item_id).localeCompare(String(b.item_id)); });
      rows.forEach(function (w) {
        var it = byId[w.item_id]; var pu = it ? it.pu || 0 : 0;
        var prev = w.cant_prevista || 0;
        var ejec = (w.cant_ejecutada != null ? w.cant_ejecutada : prodEnSemana(w.item_id, w.week || wk)) || 0;
        var noPlan = !!w._noPlan;
        var sc = !noPlan && !!it && sinCant(it);
        var listo = it ? estEf(it) === 'Listo' : false;
        var cp = sc ? (listo ? 100 : 0) : (prev ? Math.min(200, ejec / prev * 100) : (ejec ? 100 : 0));
        out.me += ejec * pu;
        var completa = false;
        if (!noPlan) {
          out.nPlan++;
          if (sc) { if (listo) { out.done++; completa = true; } }
          else { out.mp += prev * pu; if (cp >= 99.5) { out.done++; completa = true; } }
        }
        out.filas.push({ id: w.item_id, act: w.actividad || (it ? it.desc : ''), um: w.um || (it ? it.um : ''), frente: w.frente || '',
          prev: noPlan ? null : prev, ejec: ejec, cp: cp, mp: prev * pu, me: ejec * pu, causa: w.causa || '', noPlan: noPlan, sinCant: sc, completa: completa });
      });
      out.ppc = out.nPlan ? out.done / out.nPlan * 100 : 0;
      out.cumpl = out.mp ? out.me / out.mp * 100 : null;
      return out;
    }
  }

  /* reglas fijas: mismo dato → mismo texto */
  function alertas(A) {
    var L = [];
    var dias = Object.keys(A.jorn).filter(function (f) { return /lluvia|humedad/i.test(A.jorn[f].estado); }).length;
    if (dias) L.push(dias + (dias === 1 ? ' jornada' : ' jornadas') + ' sin actividad por lluvia o humedad en la semana.');
    var c = A.climaMes.c;
    if (c && ((c.lluvia || 0) + (c.humedad || 0)) > 0) L.push('En ' + mesLargo(A.climaMes.mk) + ': ' + num(c.lluvia || 0) + ' días de lluvia y ' + num(c.humedad || 0) + ' de exceso de humedad.');
    if (A.semA.nPlan && A.semA.ppc < 50) L.push('PPC de la semana: ' + pc(A.semA.ppc, 0) + ' (' + A.semA.done + ' de ' + A.semA.nPlan + ' actividades completas).');
    var venc = A.crono.filter(function (r) { return r.vencido; });
    if (venc.length) L.push(venc.length + (venc.length === 1 ? ' ítem venció' : ' ítems vencieron') + ' sin terminar: ' + venc.slice(0, 3).map(function (r) { return r.desc; }).join(', ') + (venc.length > 3 ? '…' : '') + '.');
    if (A.compras && A.compras.length) {
      var v30 = A.compras.filter(function (x) { return (x.dias || 0) > 30; }).length;
      L.push(A.compras.length + ' pedidos de compra sin OC' + (v30 ? ' (' + v30 + ' con más de 30 días de atraso)' : '') + '.');
    }
    if (A.mesesSinCert.length) L.push('Producción sin certificar desde ' + mesLargo(A.mesesSinCert[0]) + ': ' + M(A.prodSinCert) + '.');
    if (A.k.cert > A.k.prod * 1.02 && A.k.cert - A.k.prod > 1e6) L.push('El certificado supera lo producido en ' + M(A.k.cert - A.k.prod) + ': revisar la carga de producción.');
    (A.convenios || []).forEach(function (cv) {
      if (['aprobado', 'rechazado', 'anulado'].indexOf(String(cv.estado || '').toLowerCase()) < 0) L.push((cv.nro || 'Convenio') + ' ' + (cv.estado === 'en_tramite' ? 'en trámite' : (cv.estado || 'pendiente')) + ', sin aprobar.');
    });
    if (A.saldos.nSobre) L.push(A.saldos.nSobre + ' ítems con sobre-ejecución (' + M(A.saldos.sobre) + ').');
    return L;
  }

  /* ======================================================================
   *  ARMADO DEL .pptx
   * ====================================================================== */
  function armar(PptxGenJS, A, opt) {
    var pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    pres.theme = { headFontFace: 'Calibri', bodyFontFace: 'Calibri' };
    pres.title = 'Reunión semanal · ' + A.obra.nombre + ' · ' + A.wkA;
    pres.company = 'TECSUL S.A.E.';
    var FOOT = A.obra.nombre + '  ·  Reunión semanal  ·  analizada ' + A.txtA.split(' · ')[1] + '  ·  programa ' + A.txtP.split(' · ')[1];

    var objs = [
      { text: { text: FOOT, options: { x: MX, y: 7.05, w: 10, h: 0.3, fontSize: 10, color: C.muted, margin: 0 } } },
      { placeholder: { options: { name: 'title', type: 'title', x: MX, y: 0.28, w: 10.9, h: 0.6, fontSize: 28, bold: true, color: C.navy, margin: 0, valign: 'middle', align: 'left' }, text: '' } },
      { placeholder: { options: { name: 'sub', type: 'body', x: MX, y: 0.86, w: 10.9, h: 0.36, fontSize: 14, color: C.muted, margin: 0, valign: 'top', align: 'left' }, text: '' } }
    ];
    if (A.logo) objs.unshift({ image: { data: A.logo, x: W - MX - 1.15, y: 0.32, w: 1.15, h: 0.447 } });
    pres.defineSlideMaster({ title: 'CONTENIDO', background: { color: C.white }, margin: [0.5, 0.5, 0.6, 0.5], objects: objs,
      slideNumber: { x: W - MX - 0.6, y: 7.05, w: 0.6, h: 0.3, fontSize: 10, color: C.muted, align: 'right' } });
    pres.defineSlideMaster({ title: 'PORTADA', background: { color: C.navy },
      objects: A.logo ? [{ image: { data: A.logo, x: MX, y: 0.5, w: 1.8, h: 0.7 } }] : [] });

    // helpers (cada llamada arma objetos nuevos: pptxgenjs los modifica)
    function T(s, text, o) { s.addText(text, Object.assign({ isTextBox: true, margin: 0, fontSize: 14, color: C.ink, valign: 'top', fontFace: 'Calibri' }, o)); }
    function box(s, x, y, w, h, fill, o) { s.addShape(pres.shapes.ROUNDED_RECTANGLE, Object.assign({ x: x, y: y, w: w, h: h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.08 }, o || {})); }
    function slide(sec, titulo, sub) { var s = pres.addSlide({ masterName: 'CONTENIDO', sectionTitle: sec }); s.addText(titulo, { placeholder: 'title' }); if (sub) s.addText(sub, { placeholder: 'sub' }); return s; }
    function ax(extra) {
      return Object.assign({
        catAxisLabelColor: C.muted, valAxisLabelColor: C.muted, catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
        catAxisLabelFontFace: 'Calibri', valAxisLabelFontFace: 'Calibri', dataLabelFontFace: 'Calibri', legendFontFace: 'Calibri',
        valGridLine: { color: 'E6EAF0', size: 0.75 }, catGridLine: { style: 'none' }, catAxisLineShow: false, valAxisLineShow: false,
        legendFontSize: 12, legendColor: C.ink, dataLabelFontSize: 10, dataLabelColor: C.ink
      }, extra);
    }
    function stat(s, x, y, w, h, lab, val, sub, col, vs) {
      box(s, x, y, w, h, C.bg2);
      T(s, lab.toUpperCase(), { x: x + 0.18, y: y + 0.12, w: w - 0.34, h: 0.25, fontSize: 10.5, bold: true, color: C.muted, charSpacing: 0.5, fit: 'shrink' });
      T(s, val, { x: x + 0.18, y: y + 0.38, w: w - 0.34, h: 0.48, fontSize: vs || 22, bold: true, color: col || C.navy, fit: 'shrink' });
      if (sub) T(s, sub, { x: x + 0.18, y: y + h - 0.4, w: w - 0.34, h: 0.32, fontSize: 10.5, color: C.muted, fit: 'shrink' });
    }
    function hdr(cols) { return cols.map(function (h) { return { text: h, options: { bold: true, color: C.white, fill: { color: C.navy } } }; }); }
    function R(o) { return Object.assign({ align: 'right' }, o || {}); }
    function tabla(s, filas, o) {
      s.addTable(filas, Object.assign({ fontSize: 11, fontFace: 'Calibri', color: C.ink, border: { type: 'solid', pt: 0.5, color: C.line },
        valign: 'middle', margin: [0.02, 0.06, 0.02, 0.06] }, o));
    }
    function vacio(s, txt) { box(s, MX, 1.5, W - 2 * MX, 1.2, C.bg2); T(s, txt, { x: MX + 0.3, y: 1.5, w: W - 2 * MX - 0.6, h: 1.2, fontSize: 15, color: C.muted, valign: 'middle' }); }

    var k = A.k;

    // =================================================== 1 · PORTADA
    pres.addSection({ title: 'Dónde estamos' });
    (function () {
      var s = pres.addSlide({ masterName: 'PORTADA', sectionTitle: 'Dónde estamos' });
      T(s, 'REUNIÓN SEMANAL DE OBRA', { x: MX, y: 1.9, w: 7, h: 0.4, fontSize: 14, bold: true, color: C.light, charSpacing: 3 });
      T(s, A.obra.nombre, { x: MX, y: 2.35, w: 7.2, h: 1.1, fontSize: 44, bold: true, color: C.white, fit: 'shrink' });
      var sub = [A.obra.tipo === 'publica' ? 'MOPC' : 'Obra privada', A.obra.llamado ? 'Llamado ' + A.obra.llamado : '', A.obra.lote ? 'Lote ' + A.obra.lote : ''].filter(Boolean).join(' · ');
      T(s, sub, { x: MX, y: 3.45, w: 7.2, h: 0.4, fontSize: 16, color: C.light });
      [['Semana analizada', A.txtA], ['Semana que se programa', A.txtP], ['Generado', dmy(ymd(A.hoy)) + ' · app v' + VERSION]].forEach(function (r, i) {
        T(s, r[0].toUpperCase(), { x: MX, y: 4.45 + i * 0.72, w: 6, h: 0.26, fontSize: 11, bold: true, color: C.plan, charSpacing: 1.5 });
        T(s, r[1], { x: MX, y: 4.7 + i * 0.72, w: 6.8, h: 0.36, fontSize: 18, color: C.white });
      });
      var fx = 7.9, fy = 1.0, fw = 4.93, fh = 5.5;
      if (A.fotoPortada) {
        s.addImage({ data: A.fotoPortada.data, x: fx, y: fy, w: fw, h: fh, sizing: { type: 'cover', w: fw, h: fh }, rounding: false });
        T(s, 'Foto del ' + dmy(A.fotoPortada.fecha), { x: fx, y: fy + fh + 0.1, w: fw, h: 0.3, fontSize: 11, color: C.plan, align: 'right' });
      } else {
        box(s, fx, fy, fw, fh, '17395A', { rectRadius: 0.12 });
        T(s, 'Sin fotos cargadas en producción', { x: fx, y: 3.5, w: fw, h: 0.4, fontSize: 14, color: C.light, align: 'center' });
      }
    })();

    // =================================================== 2 · RESUMEN + CURVA S
    (function () {
      var sub = (A.mesesTot ? A.mesesTransc + ' de ' + A.mesesTot + ' meses de plazo (' + pc(A.plazoPct, 0) + ') · ' : '') + 'montos a la fecha y avance acumulado en % del contrato original';
      var s = slide('Dónde estamos', 'Resumen económico y curva S: brecha de ' + sgn(k.brecha, num(Math.abs(k.brecha), 1)) + ' pp', sub);
      var top = [['Monto contrato', M(k.contratoOrig), k.nItems + ' ítems · original', C.ink]];
      if (k.montoConv != null) top.push(['Monto convenio', M(k.montoConv), (k.ultConv && k.ultConv.nro ? k.ultConv.nro + ' · ' : '') + sgn(k.montoConv - k.contratoOrig, pc(Math.abs((k.montoConv - k.contratoOrig) / (k.contratoOrig || 1) * 100), 2)) + ' vs contrato', C.ink]);
      if (k.muestraAjustado) { var ref = k.montoConv != null ? k.montoConv : k.contratoOrig; if (k.montoConv == null || Math.abs(k.contrato - k.montoConv) > 0.5) top.push(['Monto ajustado', M(k.contrato), sgn(k.contrato - ref, M(Math.abs(k.contrato - ref))) + (k.montoConv != null ? ' vs convenio' : ' vs contrato'), C.ink]); }
      top.push(['Monto producido', M(k.prod), sgn(k.prodSem, M(Math.abs(k.prodSem))) + ' en la semana', C.prod]);
      top.push(['Monto certificado', M(k.cert), pc(k.cert / (k.contratoOrig || 1) * 100) + ' del contrato' + (A.ultCertMes ? ' · últ. ' + mesCorto(A.ultCertMes) : ''), C.cert]);
      var n = top.length, cw = (W - 2 * MX - (n - 1) * 0.2) / n;
      top.forEach(function (c, i) { stat(s, MX + i * (cw + 0.2), 1.4, cw, 1.2, c[0], c[1], c[2], c[3], 21); });
      // curva S
      var Cv = A.curvas, eje = Cv._eje || [];
      var cada = Math.max(1, Math.ceil(eje.length / 9));
      var labels = eje.map(function (m, i) { return i % cada === 0 ? mesCorto(m) : ' '; });
      var ser = [['Línea base contractual', Cv.contractual, C.light], ['Meta', Cv.meta, C.meta], ['Planeado vigente', Cv.operativa, C.plan], ['Producido', Cv.real, C.prod], ['Certificado', Cv.certificado, C.cert]]
        .filter(function (x) { return x[1] && x[1].some(function (v) { return v != null; }); });
      var maxV = 100; ser.forEach(function (x) { x[1].forEach(function (v) { if (v != null && v > maxV) maxV = v; }); });
      if (ser.length && eje.length > 1) {
        s.addChart(pres.charts.LINE, ser.map(function (x) { return { name: x[0], labels: labels, values: x[1].map(function (v) { return v == null ? null : Math.round(v * 10) / 10; }) }; }),
          ax({ x: MX, y: 2.8, w: 8.35, h: 4.15, chartColors: ser.map(function (x) { return x[2]; }), lineSize: 2.5, lineDataSymbol: 'none',
            showLegend: true, legendPos: 'b', legendFontSize: 11, catAxisLabelRotate: 0, valAxisMaxVal: Math.ceil(maxV / 25) * 25, valAxisMinVal: 0, valAxisMajorUnit: 25,
            valAxisLabelFormatCode: '0"%"', displayBlanksAs: 'gap', objectName: 'curva-s' }));
      }
      var pCert = k.cert / (k.contratoOrig || 1) * 100;
      var rows = [
        ['Avance planeado', pc(k.avPlan), 'cronograma vigente', C.plan],
        ['Avance producido', pc(k.avProd), sgn(k.prodSem, num(Math.abs(k.prodSem / (k.contrato || 1) * 100), 2)) + ' pp en la semana', C.prod],
        ['Certificado', pc(pCert), 'del contrato original', C.cert],
        ['Pendiente a ejecutar', M(Math.max(0, k.contrato - k.prod)), pc(Math.max(0, k.contrato - k.prod) / (k.contrato || 1) * 100) + ' del ajustado', C.ink],
        ['Pendiente a certificar', M(Math.max(0, k.contrato - k.cert)), k.prod - k.cert > 0 ? M(k.prod - k.cert) + ' ya ejecutado sin certificar' : (k.prod - k.cert < 0 ? 'certificado ' + M(k.cert - k.prod) + ' sobre lo producido' : 'al día con lo producido'), C.ink]
      ];
      var rx = 9.1, rw = W - MX - rx, rh = 0.78;
      rows.forEach(function (r, i) {
        var y = 2.85 + i * (rh + 0.06);
        box(s, rx, y, rw, rh, C.bg2);
        T(s, r[0].toUpperCase(), { x: rx + 0.16, y: y + 0.08, w: rw - 0.3, h: 0.22, fontSize: 10, bold: true, color: C.muted, charSpacing: 0.5 });
        T(s, r[1], { x: rx + 0.16, y: y + 0.32, w: 1.75, h: 0.38, fontSize: 18, bold: true, color: r[3], fit: 'shrink' });
        T(s, r[2], { x: rx + 1.9, y: y + 0.32, w: rw - 2.02, h: 0.38, fontSize: 10.5, color: C.muted, align: 'right', valign: 'middle', fit: 'shrink' });
      });
      s.addNotes('Tarjetas: mismas cuentas que la tira de la pestaña Cronograma. Curvas: las de Avance / Informes, en % del contrato original' + (A.blCnombre ? ' (línea base: ' + A.blCnombre + ')' : '') + '. «Planeado vigente» es el cronograma actual.');
    })();

    // =================================================== · POR CATEGORÍA (subfrentes)
    if (opt.porCategoria && A.cats.length > 1) {
      var cats = A.cats;
      var eje = A.curvas._eje || [];
      var mAct = ymd(A.hoy).slice(0, 7);
      var PROD = leer('PROD') || {}, CERT = leer('CERT') || {};
      var avPlanItem = fn('itemAvancePlaneado'), cv = fn('cantVigente'), distPlan = fn('distPlanItem');
      cats.forEach(function (cat) {
        var it = cat.items, orig = 0, vig = 0, prod = 0, cert = 0, planTo = 0, planTot = 0;
        var pm = {}, rm = {}, cm = {};
        it.forEach(function (i) {
          orig += (i.cant || 0) * (i.pu || 0); vig += i.ptot || 0;
          var base = i.ptot || 0; planTot += base; var fp = avPlanItem(i); if (base && fp != null) planTo += base * fp / 100;
          var pr = PROD[i.id]; if (pr && pr.total) prod += pr.total * i.pu; else if (i.avance_real_prod != null) prod += base * i.avance_real_prod / 100;
          cert += (i.cant_certificada_acum || 0) * i.pu;
          var dist = distPlan(i) || {}; Object.keys(dist).forEach(function (m) { pm[m] = (pm[m] || 0) + (+dist[m] || 0) * i.pu; });
          if (pr && pr.by_date) Object.keys(pr.by_date).forEach(function (d) { var m = d.slice(0, 7); rm[m] = (rm[m] || 0) + (pr.by_date[d] || 0) * i.pu; });
          var c = CERT[i.id]; if (c && c.by_month) Object.keys(c.by_month).forEach(function (m) { cm[m] = (cm[m] || 0) + (c.by_month[m] || 0) * i.pu; });
        });
        if (!(orig > 0 || vig > 0)) return;
        var den = orig || vig, ultC = Object.keys(cm).filter(function (m) { return Math.abs(cm[m]) > 0.5; }).sort().pop();
        var acum = function (mapa, corte) { var a = 0; return eje.map(function (m) { a += mapa[m] || 0; return corte && m > corte ? null : Math.round(a / den * 1000) / 10; }); };
        var avP = planTot ? planTo / planTot * 100 : 0, avR = vig ? prod / vig * 100 : 0;
        var s = slide('Dónde estamos', cat.nombre, 'Avance del subfrente · ' + it.length + ' ítems · brecha ' + sgn(avR - avP, num(Math.abs(avR - avP), 1)) + ' pp');
        var cards = [['Monto contrato', M(orig), C.ink], ['Monto vigente', M(vig), C.ink], ['Producido', M(prod), C.prod], ['Certificado', M(cert), C.cert], ['Avance plan / prod.', pc(avP, 0) + ' / ' + pc(avR, 0), avR - avP < -5 ? C.bad : C.navy]];
        var cw = (W - 2 * MX - 4 * 0.2) / 5;
        cards.forEach(function (c, i) { stat(s, MX + i * (cw + 0.2), 1.4, cw, 1.1, c[0], c[1], '', c[2], 20); });
        var labels = eje.map(function (m, i) { return i % Math.max(1, Math.ceil(eje.length / 9)) === 0 ? mesCorto(m) : ' '; });
        if (eje.length > 1) s.addChart(pres.charts.LINE, [
          { name: 'Planeado vigente', labels: labels, values: acum(pm) },
          { name: 'Producido', labels: labels, values: acum(rm, mAct) },
          { name: 'Certificado', labels: labels, values: acum(cm, ultC || '0000') }
        ], ax({ x: MX, y: 2.75, w: W - 2 * MX, h: 4.15, chartColors: [C.plan, C.prod, C.cert], lineSize: 2.5, lineDataSymbol: 'none', showLegend: true, legendPos: 'b',
          catAxisLabelRotate: 0, valAxisMinVal: 0, valAxisLabelFormatCode: '0"%"', displayBlanksAs: 'gap', objectName: 'curva-' + norm(cat.nombre).replace(/\W+/g, '-') }));
        s.addNotes('Categoría «' + cat.nombre + '». Curvas en % del monto contrato de la categoría.');
      });
    }

    // =================================================== 3 · CRONOGRAMA FILTRADO
    pres.addSection({ title: 'Cronograma' });
    (function () {
      var s = slide('Cronograma', 'Cronograma: ítems en ejecución, atrasados y por iniciar', 'Cronograma vigente · 4 semanas atrás a 8 adelante · ordenado por atraso en ₲');
      var rows = A.crono.slice(0, 14);
      if (!rows.length) { vacio(s, 'No hay ítems en ejecución ni atrasados en la ventana.'); return; }
      var w0 = A.vent0, nW = 12, d2w = function (d) { return (d - w0) / (7 * 864e5); };
      var cols = [['Ítem', 0.6], ['Descripción', 2.75], ['% plan', 0.75], ['% prod', 0.75], ['Brecha', 0.8], ['Atraso', 1.0]];
      var gx = MX + cols.reduce(function (a, c) { return a + c[1]; }, 0) + 0.1, gw = W - MX - gx, cw = gw / nW;
      var y0 = 1.45, rh = Math.min(0.34, 4.6 / rows.length);
      var x = MX;
      cols.forEach(function (c, j) { T(s, c[0], { x: x, y: y0, w: c[1] - 0.05, h: 0.42, fontSize: 11, bold: true, color: C.muted, align: j < 2 ? 'left' : 'right', valign: 'bottom' }); x += c[1]; });
      for (var kk = 0; kk < nW; kk++) {
        var d = new Date(w0.getTime() + kk * 7 * 864e5);
        if (kk % 2 === 0) s.addShape(pres.shapes.RECTANGLE, { x: gx + kk * cw, y: y0 + 0.48, w: cw, h: rh * rows.length, fill: { color: 'F6F8FA' }, line: { color: 'F6F8FA', width: 0 } });
        T(s, dm(d), { x: gx + kk * cw, y: y0, w: cw, h: 0.42, fontSize: 10, color: C.muted, align: 'center', valign: 'bottom' });
      }
      rows.forEach(function (r, i) {
        var y = y0 + 0.48 + i * rh, late = r.brecha < -10, xx = MX;
        [r.id, r.desc, pc(Math.min(r.pPlan, 100), 0), pc(r.pProd, 0), num(r.brecha, 0) + ' pp', num(r.atraso / 1e6) + ' M'].forEach(function (v, j) {
          T(s, String(v), { x: xx, y: y, w: cols[j][1] - 0.05, h: rh, fontSize: 11, valign: 'middle', align: j < 2 ? 'left' : 'right', color: j === 4 && late ? C.bad : C.ink, bold: j === 4 && late, fit: 'shrink' });
          xx += cols[j][1];
        });
        var a = Math.max(0, d2w(r.ini)), z = Math.min(nW, d2w(r.fin) + 1 / 7);
        if (z > 0 && a < nW) {
          s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: gx + a * cw, y: y + rh * 0.25, w: Math.max(0.08, (z - a) * cw), h: rh * 0.5, fill: { color: r.vencido ? C.bad : (late ? 'E7A6A6' : C.light) }, line: { color: C.white, width: 0 }, rectRadius: 0.05 });
          if (r.vencido) T(s, 'venció ' + dm(r.fin), { x: gx + z * cw + 0.05, y: y, w: 1.3, h: rh, fontSize: 10, bold: true, color: C.bad, valign: 'middle' });
          else if (z >= nW) T(s, '→ ' + String(r.fin.getMonth() + 1).padStart(2, '0') + '/' + String(r.fin.getFullYear()).slice(2), { x: gx + (nW - 1.2) * cw, y: y, w: 1.2 * cw, h: rh, fontSize: 10, color: C.navy, align: 'right', valign: 'middle' });
        } else if (r.vencido && z <= 0) {
          T(s, '← venció ' + dmy(ymd(r.fin)), { x: gx + 0.05, y: y, w: 2.2, h: rh, fontSize: 10, bold: true, color: C.bad, valign: 'middle' });
        }
        s.addShape(pres.shapes.LINE, { x: MX, y: y + rh, w: W - 2 * MX, h: 0, line: { color: C.line, width: 0.5 } });
      });
      var xh = gx + d2w(A.hoy) * cw;
      s.addShape(pres.shapes.LINE, { x: xh, y: y0 + 0.45, w: 0, h: rh * rows.length + 0.05, line: { color: C.navy, width: 1.5, dashType: 'dash' } });
      T(s, 'hoy', { x: xh - 0.3, y: y0 + 0.5 + rh * rows.length, w: 0.6, h: 0.25, fontSize: 10, bold: true, color: C.navy, align: 'center' });
      T(s, [{ text: '■ ', options: { color: C.bad } }, { text: 'Venció sin terminar    ' }, { text: '■ ', options: { color: 'E7A6A6' } }, { text: 'Atrasado más de 10 pp    ' }, { text: '■ ', options: { color: C.light } }, { text: 'En plazo' },
        { text: A.crono.length > rows.length ? '    · y ' + (A.crono.length - rows.length) + ' ítems más con menor atraso' : '' }],
        { x: MX, y: 6.68, w: 11, h: 0.3, fontSize: 11, color: C.muted });
      s.addNotes('% plan = avance planeado a la fecha del cronograma VIGENTE (mismo cálculo que la grilla). % prod = producción / cantidad vigente. Atraso = (plan − producido) × cantidad vigente × PU.');
    })();

    // =================================================== 4 · SALDOS
    (function () {
      var Sd = A.saldos, top = Sd.filas.slice(0, 12), sumTop = top.reduce(function (a, x) { return a + x.m; }, 0);
      var s = slide('Cronograma', 'Saldos de obra: ' + M(Sd.pend) + ' pendientes de ejecutar', 'Saldo por ítem en cantidad y monto · ordenado por monto pendiente · ejecutado según producción');
      if (!top.length) { vacio(s, 'No hay ítems con saldo pendiente.'); return; }
      var g = { fill: { color: C.bg2 } };
      var body = top.map(function (x) {
        return [x.id, x.desc, x.um, { text: cant(x.cv), options: R() }, { text: cant(x.ej), options: R() }, { text: cant(x.s), options: R({ bold: true }) },
          { text: pc(x.s / (x.cv || 1) * 100, 0), options: R({ color: C.muted }) }, { text: M(x.m), options: R({ bold: true }) }];
      });
      if (Sd.filas.length > top.length) body.push(['', { text: 'Resto de ítems con saldo (' + (Sd.filas.length - top.length) + ')', options: g }, '', '', '', '', '', { text: M(Sd.pend - sumTop), options: R(g) }].map(function (c) { return typeof c === 'string' ? { text: c, options: g } : c; }));
      body.push(['', { text: 'Total pendiente de ejecutar', options: Object.assign({ bold: true }, g) }, '', '', '', '', '', { text: M(Sd.pend), options: R(Object.assign({ bold: true }, g)) }].map(function (c) { return typeof c === 'string' ? { text: c, options: g } : c; }));
      tabla(s, [hdr(['Ítem', 'Descripción', 'UM', 'Cant. vigente', 'Ejecutado', 'Saldo', '% saldo', 'Monto pendiente'])].concat(body),
        { x: MX, y: 1.4, w: 9.2, colW: [0.55, 2.8, 0.5, 1.15, 1.1, 1.1, 0.75, 1.25], rowH: 0.33, objectName: 'tabla-saldos' });
      var st = [['Monto pendiente de ejecutar', M(Sd.pend), pc(Sd.pend / (k.contrato || 1) * 100) + ' del vigente · ' + Sd.nSaldo + ' ítems', C.warn],
        ['Monto ejecutado', M(k.prod), pc(k.avProd) + ' según producción', C.prod],
        ['Los ' + top.length + ' ítems de la tabla', pc(sumTop / (Sd.pend || 1) * 100, 0), 'del saldo pendiente', C.navy],
        ['Sobre-ejecución', M(Sd.sobre), Sd.nSobre + ' ítems con saldo negativo (no descuentan del pendiente)', Sd.nSobre ? C.bad : C.navy]];
      st.forEach(function (r, i) { stat(s, 10.0, 1.4 + i * 1.33, 2.83, 1.18, r[0], r[1], r[2], r[3], 20); });
      s.addNotes('Igual que Avance › Saldos de obra › Saldos por ítem con ejecutado según producción. Sin costos: se ven en Power BI.');
    })();

    // =================================================== 5 · SEMANA ANALIZADA (jornadas + plan vs ejecutado)
    pres.addSection({ title: 'Plan semanal' });
    (function () {
      var Sa = A.semA;
      var filas = Sa.filas, porSlide = filas.length <= 18 ? Math.max(1, filas.length) : 16, nPag = Math.max(1, Math.ceil(filas.length / porSlide));
      var diasPerd = Object.keys(A.jorn).filter(function (f) { return /lluvia|humedad/i.test(A.jorn[f].estado); }).length;
      for (var p = 0; p < nPag; p++) {
        var s = slide('Plan semanal', 'Semana pasada: programado vs ejecutado' + (nPag > 1 ? ' (' + (p + 1) + '/' + nPag + ')' : ''),
          A.txtA + ' · ' + Sa.nPlan + ' actividades programadas' + (fn('semanaCerrada')(A.wkA) ? ' · foto del plan al cerrar la semana' : ''));
        if (p === 0) {   // tira de jornadas
          var dw = (9.0 - 6 * 0.1) / 7;
          for (var d = 0; d < 7; d++) {
            var dia = new Date(A.lunA); dia.setDate(A.lunA.getDate() + d);
            var j = A.jorn[ymd(dia)], est = j ? j.estado : '';
            var act = /con actividad/i.test(est), llu = /lluvia/i.test(est), hum = /humedad/i.test(est);
            var fill = act ? C.okBg : llu ? C.infoBg : (hum ? C.grisBg : (est ? C.bg2 : 'F7F7F7'));
            var x = MX + d * (dw + 0.1);
            box(s, x, 1.38, dw, 0.82, fill);
            T(s, DIAS[dia.getDay()] + ' ' + dm(dia), { x: x + 0.08, y: 1.43, w: dw - 0.16, h: 0.26, fontSize: 11, bold: true, color: C.navy });
            var tx = act ? 'Con actividad' : llu ? 'Lluvia' : hum ? 'Exceso de humedad' : (est ? est.replace(/^Sin actividad\s*/i, 'Sin act. ') : 'Sin parte');
            T(s, tx + (j && j.mm ? ' · ' + num(j.mm) + ' mm' : ''), { x: x + 0.08, y: 1.72, w: dw - 0.16, h: 0.42, fontSize: 10, color: act ? C.ok : C.ink, bold: act, fit: 'shrink' });
          }
        }
        var ty = p === 0 ? 2.35 : 1.4;
        var chunk = filas.slice(p * porSlide, (p + 1) * porSlide);
        var body = chunk.map(function (r) {
          var col = r.noPlan ? C.muted : (r.cp >= 99.5 ? C.ok : r.cp >= 50 ? C.warn : C.bad);
          var causa = r.noPlan ? 'No planeado' : (r.completa ? '—' : (r.causa && r.causa !== 'Sin observaciones' ? r.causa : 'Sin causa cargada'));
          return [r.id, { text: r.act, options: {} }, r.um, { text: r.prev == null ? '—' : (r.sinCant ? 's/cant' : cant(r.prev)), options: R() }, { text: r.sinCant ? (r.completa ? 'Listo' : '—') : cant(r.ejec), options: R() },
            { text: r.noPlan ? '—' : pc(r.cp, 0), options: R({ bold: true, color: col }) }, { text: r.noPlan ? '—' : M(r.mp), options: R() }, { text: M(r.me), options: R() },
            { text: causa, options: { color: (r.completa || r.noPlan) ? C.muted : C.ink } }];
        });
        if (p === nPag - 1) {
          var g = { fill: { color: C.bg2 }, bold: true };
          body.push(['', 'Total semana', '', '', '', { text: Sa.cumpl == null ? '—' : pc(Sa.cumpl, 0), options: R() }, { text: M(Sa.mp), options: R() }, { text: M(Sa.me), options: R() }, ''].map(function (c) {
            return typeof c === 'string' ? { text: c, options: g } : { text: c.text, options: Object.assign({}, c.options, g) }; }));
        }
        if (!body.length) body.push([{ text: 'Sin actividades programadas en la semana', options: { colspan: 9, color: C.muted } }]);
        tabla(s, [hdr(['Ítem', 'Actividad', 'UM', 'Previsto', 'Ejecutado', '%', 'Monto previsto', 'Monto ejecutado', 'Causa'])].concat(body),
          { x: MX, y: ty, w: 9.0, colW: [0.45, 2.3, 0.45, 0.8, 0.8, 0.5, 1.05, 1.05, 1.6], rowH: Math.min(0.29, (6.95 - ty) / (body.length + 1)), fontSize: body.length > 15 ? 9 : 9.5, objectName: 'tabla-semana' });
        // columna derecha
        stat(s, 9.75, 1.38, 3.08, 1.35, 'PPC · actividades completas', pc(Sa.ppc, 0), Sa.done + ' de ' + Sa.nPlan, Sa.ppc >= 80 ? C.ok : Sa.ppc >= 50 ? C.warn : C.bad, 30);
        stat(s, 9.75, 2.88, 3.08, 1.35, 'Cumplimiento en monto', Sa.cumpl == null ? '—' : pc(Sa.cumpl, 0), M(Sa.me) + ' de ' + M(Sa.mp), Sa.cumpl >= 80 ? C.ok : Sa.cumpl >= 50 ? C.warn : C.bad, 30);
        stat(s, 9.75, 4.38, 3.08, 1.35, 'Días sin actividad', String(diasPerd), 'por lluvia o exceso de humedad', C.brand, 30);
        var cm = A.climaMes.c;
        if (cm) T(s, 'En ' + mesLargo(A.climaMes.mk) + ': ' + num(cm.lluvia || 0) + ' días de lluvia y ' + num(cm.humedad || 0) + ' de humedad' + (cm.mm ? ' · ' + num(cm.mm) + ' mm' : '') + '. Respaldo para días ganados.',
          { x: 9.75, y: 5.85, w: 3.08, h: 0.9, fontSize: 11.5, color: C.muted });
      }
      s.addNotes('Programado = plan semanal (foto si la semana cerró). Ejecutado = liberaciones de la semana. PPC y cumplimiento en monto con la misma cuenta que la pestaña Plan semanal. Estado de cada día = jornada de producción.');
    })();

    // =================================================== 6 · CAUSAS + PPC
    (function () {
      var s = slide('Plan semanal', 'Por qué no se cumplió y cómo viene el PPC', 'Causas de las actividades incompletas · PPC de las últimas semanas');
      var cnt = {};
      A.semA.filas.forEach(function (r) { if (r.noPlan || r.completa) return; var c = r.causa && r.causa !== 'Sin observaciones' ? r.causa : 'Sin causa cargada'; cnt[c] = (cnt[c] || 0) + 1; });
      var cs = Object.keys(cnt).map(function (c) { return [c, cnt[c]]; }).sort(function (a, b) { return a[1] - b[1]; });
      T(s, 'CAUSAS · N° DE ACTIVIDADES INCOMPLETAS', { x: MX, y: 1.4, w: 5.9, h: 0.3, fontSize: 11, bold: true, color: C.muted, charSpacing: 1 });
      if (cs.length) s.addChart(pres.charts.BAR, [{ name: 'Actividades', labels: cs.map(function (c) { return c[0]; }), values: cs.map(function (c) { return c[1]; }) }],
        ax({ x: MX, y: 1.75, w: 5.9, h: 4.8, barDir: 'bar', chartColors: [C.bad], showLegend: false, showValue: true, dataLabelPosition: 'outEnd',
          valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLabelFontSize: 12, barGapWidthPct: 50, objectName: 'causas' }));
      else T(s, 'Todas las actividades programadas se completaron.', { x: MX, y: 2, w: 5.9, h: 0.5, fontSize: 14, color: C.ok });
      T(s, 'PPC SEMANAL · META 80%', { x: 6.9, y: 1.4, w: 5.9, h: 0.3, fontSize: 11, bold: true, color: C.muted, charSpacing: 1 });
      if (A.ppcHist.length) s.addChart(pres.charts.BAR, [{ name: 'PPC', labels: A.ppcHist.map(function (p) { return p[0]; }), values: A.ppcHist.map(function (p) { return Math.round(p[1]); }) }],
        ax({ x: 6.9, y: 1.75, w: 5.93, h: 4.8, barDir: 'col', chartColors: [C.prod], showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0"%"',
          valAxisMaxVal: 100, valAxisMinVal: 0, valAxisMajorUnit: 25, valAxisLabelFormatCode: '0"%"', barGapWidthPct: 45, objectName: 'ppc' }));
      if (cnt['Sin causa cargada']) T(s, cnt['Sin causa cargada'] + ' actividades sin causa cargada: completala en Plan semanal › Causa.', { x: MX, y: 6.6, w: 12, h: 0.35, fontSize: 11, color: C.muted });
      s.addNotes('Causas: columna Causa del plan semanal. PPC de cada semana: foto del plan contra lo liberado, igual que la pestaña Plan semanal.');
    })();

    // =================================================== 7 · PROGRAMACIÓN SIGUIENTE
    (function () {
      var Sp = A.semP;
      var s = slide('Plan semanal', 'Programación de la semana que viene', A.txtP + ' · ' + Sp.filas.length + ' actividades');
      var filas = Sp.filas.slice(0, 16);
      var body = filas.map(function (r) { return [r.id, r.act, r.um, { text: r.sinCant ? 's/cant' : cant(r.prev), options: R() }, { text: M(r.mp), options: R() }, r.frente || '']; });
      var g = { fill: { color: C.bg2 }, bold: true };
      body.push(['', 'Total semana' + (Sp.filas.length > filas.length ? ' (incluye ' + (Sp.filas.length - filas.length) + ' más)' : ''), '', '', { text: M(Sp.mp), options: R() }, ''].map(function (c) { return typeof c === 'string' ? { text: c, options: g } : { text: c.text, options: Object.assign({}, c.options, g) }; }));
      tabla(s, [hdr(['Ítem', 'Actividad', 'UM', 'Cantidad', 'Monto', 'Frente / responsable'])].concat(body),
        { x: MX, y: 1.4, w: 9.0, colW: [0.55, 3.3, 0.55, 1.1, 1.45, 2.05], rowH: Math.min(0.32, 5.3 / (body.length + 1)), fontSize: 11, objectName: 'tabla-programa' });
      stat(s, 9.8, 1.4, 3.03, 1.45, 'Monto programado', M(Sp.mp), Sp.filas.length + ' actividades · semana pasada ' + M(A.semA.mp), C.navy, 26);
      var enPlan = {}; Sp.filas.forEach(function (r) { enPlan[String(r.id)] = 1; });
      var venc = A.crono.filter(function (r) { return r.vencido && !enPlan[String(r.id)]; }).slice(0, 3);
      var atr = A.crono.filter(function (r) { return enPlan[String(r.id)]; }).slice(0, 2);
      var bl = [{ text: 'Alertas automáticas', options: { bold: true, breakLine: true } }];
      if (venc.length) bl.push({ text: 'Vencieron sin terminar y no se programan: ' + venc.map(function (r) { return r.desc; }).join(', ') + '.', options: { bullet: true, breakLine: true } });
      if (atr.length) bl.push({ text: 'Mayor atraso en ₲ que sí se programa: ' + atr.map(function (r) { return r.desc; }).join(' y ') + '.', options: { bullet: true, breakLine: true } });
      if (bl.length === 1) bl.push({ text: 'Sin alertas.', options: { color: C.muted } });
      else bl[bl.length - 1].options.breakLine = false;
      T(s, bl, { x: 9.8, y: 3.1, w: 3.03, h: 3.6, fontSize: 12, paraSpaceAfter: 6 });
      s.addNotes('Plan semanal de la semana siguiente: es el cronograma vigente (no está congelada).');
    })();

    // =================================================== 8 · SITUACIÓN DE PISTA
    pres.addSection({ title: 'Obra' });
    if (A.pista) (function () {
      var P = A.pista, est = {};
      P.estados.forEach(function (e) { est[e.estado_id] = e; });
      var ejes = P.ejes.filter(function (e) { return P.tramos.some(function (t) { return t.eje_id === e.eje_id; }); }).slice(0, 3);
      var tot = 0, km = {};
      P.tramos.forEach(function (t) { var L = Math.abs(t.fin - t.ini); tot += L; km[t.estado] = (km[t.estado] || 0) + L; });
      var esPk = ejes.some(function (e) { return e.formato === 'pk'; });
      var lg = function (v) { return esPk ? num(v / 1000, 2) + ' km' : num(v) + ' m'; };
      var s = slide('Obra', 'Situación de pista: ' + lg(tot) + (ejes.length === 1 ? ' del ' + ejes[0].nombre.toLowerCase() : ' en ' + ejes.length + ' ejes'), 'Estado de cada tramo por progresiva');
      var by = 1.5, bh = ejes.length > 1 ? 0.55 : 0.9;
      ejes.forEach(function (e, ie) {
        var ini = e.prog_ini, fin = e.prog_fin, L = fin - ini || 1, bx = MX + (ejes.length > 1 ? 1.6 : 0), bw = W - MX - bx;
        var y = by + ie * (bh + 0.55);
        if (ejes.length > 1) T(s, e.nombre, { x: MX, y: y, w: 1.5, h: bh, fontSize: 12, bold: true, color: C.navy, valign: 'middle' });
        P.tramos.filter(function (t) { return t.eje_id === e.eje_id; }).forEach(function (t) {
          var col = String((est[t.estado] || {}).color || '#cdd5db').replace('#', '');
          s.addShape(pres.shapes.RECTANGLE, { x: bx + (Math.min(t.ini, t.fin) - ini) / L * bw, y: y, w: Math.max(0.01, Math.abs(t.fin - t.ini) / L * bw), h: bh, fill: { color: col }, line: { color: C.white, width: 0.5 } });
        });
        var paso = e.formato === 'pk' ? (L > 20000 ? 2000 : 1000) : Math.pow(10, Math.floor(Math.log10(L)));
        for (var v = Math.ceil(ini / paso) * paso; v <= fin; v += paso) {
          var xx = bx + (v - ini) / L * bw;
          s.addShape(pres.shapes.LINE, { x: xx, y: y + bh, w: 0, h: 0.1, line: { color: C.muted, width: 0.75 } });
          T(s, e.formato === 'pk' ? Math.floor(v / 1000) + '+' + String(Math.round(v % 1000)).padStart(3, '0') : num(v), { x: xx - 0.4, y: y + bh + 0.12, w: 0.8, h: 0.22, fontSize: 9, color: C.muted, align: 'center' });
        }
      });
      var orden = P.estados.filter(function (e) { return km[e.estado_id]; }).sort(function (a, b) { return (b.orden || 0) - (a.orden || 0); });
      var nE = Math.min(6, orden.length), lw = (W - 2 * MX - (nE - 1) * 0.2) / Math.max(1, nE);
      var yE = by + ejes.length * (bh + 0.55) + 0.25;
      orden.slice(0, 6).forEach(function (e, i) {
        var x = MX + i * (lw + 0.2), col = String(e.color || '#cdd5db').replace('#', '');
        box(s, x, yE, lw, 1.4, C.bg2);
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.18, y: yE + 0.2, w: 0.3, h: 0.3, fill: { color: col }, line: { color: col, width: 0 }, rectRadius: 0.05 });
        T(s, e.nombre, { x: x + 0.58, y: yE + 0.16, w: lw - 0.68, h: 0.4, fontSize: 12, bold: true, valign: 'middle', fit: 'shrink' });
        T(s, lg(km[e.estado_id]), { x: x + 0.18, y: yE + 0.62, w: lw - 0.3, h: 0.42, fontSize: 20, bold: true, color: C.navy, fit: 'shrink' });
        T(s, pc(km[e.estado_id] / (tot || 1) * 100), { x: x + 0.18, y: yE + 1.03, w: lw - 0.3, h: 0.28, fontSize: 11, color: C.muted });
      });
      var pred = Object.keys(km).sort(function (a, b) { return km[b] - km[a]; })[0];
      var mas = orden[0];
      T(s, [{ text: 'Lectura: ', options: { bold: true } }, { text: 'estado predominante ' + ((est[pred] || {}).nombre || pred) + ' (' + pc(km[pred] / (tot || 1) * 100) + '). Estado más avanzado: ' + (mas ? mas.nombre + ', ' + lg(km[mas.estado_id]) : '—') + '.' }],
        { x: MX, y: Math.min(6.4, yE + 1.6), w: W - 2 * MX, h: 0.5, fontSize: 13 });
      s.addNotes('Situación de pista tal como está cargada en la pestaña.');
    })();

    // =================================================== 9 · CERTIFICACIÓN
    (function () {
      var ult = A.ultCertMes;
      var tit = A.mesesSinCert.length ? 'Certificación: producción de ' + MESL[+A.mesesSinCert[0].slice(5) - 1] + ' sin certificar' : 'Certificación al día con la producción';
      var nro = (A.certs || []).length ? (A.certs[A.certs.length - 1].nro || A.certs.length) : null;
      var s = slide('Obra', tit, ((A.certs || []).length ? A.certs.length + ' certificados' + (nro ? ' · último N° ' + nro : '') + ' · ' : '') + (ult ? 'último mes certificado: ' + mesLargo(ult) : 'sin certificados cargados'));
      var st = [['Certificado acumulado', M(k.cert), pc(k.cert / (k.contratoOrig || 1) * 100) + ' del contrato', C.cert],
        ['Producido acumulado', M(k.prod), pc(k.avProd) + ' del ajustado', C.prod],
        k.cert >= k.prod ? ['Certificado sobre lo producido', M(k.cert - k.prod), 'revisar carga de producción', k.cert - k.prod > 1e6 ? C.bad : C.navy]
                         : ['Ejecutado sin certificar', M(k.prod - k.cert), 'lo que se puede certificar', C.navy],
        ['Producido después del último certificado', M(A.prodSinCert), A.mesesSinCert.length ? A.mesesSinCert.map(mesCorto).join(', ') : 'nada pendiente', C.navy]];
      st.forEach(function (r, i) { stat(s, MX, 1.4 + i * 1.33, 3.6, 1.15, r[0], r[1], r[2], r[3], 22); });
      var meses = Object.keys(Object.assign({}, A.prodMes, A.certMes)).filter(function (m) { return m <= ymd(A.hoy).slice(0, 7); }).sort().slice(-12);
      if (meses.length) s.addChart(pres.charts.BAR, [
        { name: 'Producido', labels: meses.map(mesCorto), values: meses.map(function (m) { return Math.round((A.prodMes[m] || 0) / 1e6); }) },
        { name: 'Certificado', labels: meses.map(mesCorto), values: meses.map(function (m) { return Math.round((A.certMes[m] || 0) / 1e6); }) }
      ], ax({ x: 4.45, y: 1.35, w: 8.38, h: 5.5, barDir: 'col', barGrouping: 'clustered', chartColors: [C.prod, C.cert], showLegend: true, legendPos: 't',
        valAxisLabelFormatCode: '#,##0', valAxisTitle: 'M₲', showValAxisTitle: true, valAxisTitleColor: C.muted, valAxisTitleFontSize: 11, barGapWidthPct: 50, objectName: 'cert-prod' }));
      s.addNotes('Producido por mes (liberaciones) contra certificado por mes, en millones de guaraníes.');
    })();

    // =================================================== 10 · EQUIPOS
    pres.addSection({ title: 'Equipos, insumos y compras' });
    (function () {
      var s = slide('Equipos, insumos y compras', 'Equipos en obra' + (A.equipos ? ': ' + A.equipos.length + ' con parte diario en la semana' : ''), 'Horas de horómetro por equipo · ' + A.txtA);
      if (!A.equipos) { vacio(s, A.clave ? 'No se pudieron leer los partes de equipos (permiso o conexión).' : 'La obra no está vinculada a una obra de Equipos.'); return; }
      if (!A.equipos.length) { vacio(s, 'No hay partes diarios de equipos cargados en la semana.'); return; }
      var eq = A.equipos.slice(0, 14).reverse();
      s.addChart(pres.charts.BAR, [{ name: 'Horas', labels: eq.map(function (e) { return e.id + (e.desc ? ' · ' + e.desc : ''); }), values: eq.map(function (e) { return Math.round(e.h * 10) / 10; }) }],
        ax({ x: MX, y: 1.4, w: 7.6, h: 5.45, barDir: 'bar', chartColors: [C.brand], showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0.0',
          valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLabelFontSize: 11, barGapWidthPct: 45, objectName: 'horas-equipo' }));
      var h = A.equipos.reduce(function (a, e) { return a + e.h; }, 0), n = A.equipos.reduce(function (a, e) { return a + e.n; }, 0), f = A.equipos.reduce(function (a, e) { return a + e.f; }, 0);
      var ult = A.equipos.reduce(function (a, e) { return e.ult > a ? e.ult : a; }, '');
      stat(s, 8.6, 1.5, 4.23, 1.15, 'Horas trabajadas', num(h, 1) + ' h', 'entre ' + A.equipos.length + ' equipos', C.navy, 26);
      stat(s, 8.6, 2.8, 4.23, 1.15, 'Partes cargados', String(n), 'último: ' + dmy(ult), C.navy, 26);
      stat(s, 8.6, 4.1, 4.23, 1.15, 'Partes con falla', String(f), f ? 'revisar en Equipos › Flota' : 'ningún parte con falla', f ? C.bad : C.navy, 26);
      if (A.equipos.length > 14) T(s, '+ ' + (A.equipos.length - 14) + ' equipos más con menos horas.', { x: 8.6, y: 5.45, w: 4.23, h: 0.4, fontSize: 11, color: C.muted });
      s.addNotes('Partes diarios de Equipos con la obra ' + (A.clave || '') + ' en la semana.');
    })();

    // =================================================== 11 · COMBUSTIBLE + TRANSPORTE
    (function () {
      var s = slide('Equipos, insumos y compras', 'Combustible y transporte de la semana', 'Litros despachados por equipo · viajes por material');
      T(s, 'COMBUSTIBLE · LITROS POR EQUIPO', { x: MX, y: 1.4, w: 6, h: 0.3, fontSize: 11, bold: true, color: C.muted, charSpacing: 1 });
      if (A.combustible && A.combustible.length) {
        var cb = A.combustible.slice(0, 12).reverse();
        s.addChart(pres.charts.BAR, [{ name: 'Litros', labels: cb.map(function (e) { return e[0]; }), values: cb.map(function (e) { return Math.round(e[1]); }) }],
          ax({ x: MX, y: 1.75, w: 5.9, h: 4.3, barDir: 'bar', chartColors: [C.cert], showLegend: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '#,##0',
            valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLabelFontSize: 12, barGapWidthPct: 45, objectName: 'litros' }));
        var lt = A.combustible.reduce(function (a, e) { return a + e[1]; }, 0), h = (A.equipos || []).reduce(function (a, e) { return a + e.h; }, 0);
        T(s, [{ text: num(lt) + ' L', options: { bold: true, fontSize: 20, color: C.navy } }, { text: h ? '   ' + num(lt / h, 1) + ' L por hora trabajada' : '', options: { fontSize: 13, color: C.muted } }], { x: MX, y: 6.15, w: 5.9, h: 0.45, valign: 'middle' });
      } else T(s, A.combustible ? 'Sin despachos de combustible a equipos de la obra en la semana.' : 'No se pudieron leer los despachos de combustible.', { x: MX, y: 1.9, w: 5.9, h: 0.8, fontSize: 13, color: C.muted });
      T(s, 'TRANSPORTE · VIAJES POR MATERIAL', { x: 6.9, y: 1.4, w: 5.9, h: 0.3, fontSize: 11, bold: true, color: C.muted, charSpacing: 1 });
      if (A.transporte && A.transporte.length) {
        var tr = A.transporte.slice(0, 9), g = { bold: true, fill: { color: C.bg2 } };
        var body = tr.map(function (r) { return [r.mat, r.ruta, { text: num(r.v), options: R() }, { text: num(r.t), options: R() }]; });
        body.push([{ text: 'Total', options: g }, { text: '', options: g }, { text: num(A.transporte.reduce(function (a, r) { return a + r.v; }, 0)), options: R(g) }, { text: num(A.transporte.reduce(function (a, r) { return a + r.t; }, 0)), options: R(g) }]);
        tabla(s, [hdr(['Material', 'Origen → destino', 'Viajes', 'Ton'])].concat(body), { x: 6.9, y: 1.8, w: 5.93, colW: [1.8, 2.63, 0.7, 0.8], rowH: 0.4, fontSize: 11, objectName: 'tabla-transporte' });
      } else T(s, A.transporte ? 'Sin cargas de transporte en la semana.' : 'No se pudo leer Transporte.', { x: 6.9, y: 1.9, w: 5.9, h: 0.8, fontSize: 13, color: C.muted });
      s.addNotes('Combustible: despachos a equipos con la obra de Equipos. Transporte: cargas de la pestaña Transporte en la semana.');
    })();

    // =================================================== 12 · COMPRAS
    (function () {
      var L = A.compras || [];
      var s = slide('Equipos, insumos y compras', L.length ? 'Compras: ' + L.length + ' pedidos de la obra sin orden de compra' : 'Compras: sin pedidos pendientes de OC', 'Pedidos sin OC ni entrega · días de atraso al ' + dmy(ymd(A.hoy)));
      if (!A.compras) { vacio(s, 'No se pudo leer Compras.'); return; }
      if (!L.length) { vacio(s, 'Todos los pedidos de la obra tienen orden de compra o entrega.'); return; }
      var body = L.slice(0, 12).map(function (r) { return [r.desc, { text: cant(r.cant), options: R() }, r.um, dmy(r.freq), { text: r.dias == null ? '—' : num(r.dias), options: R({ bold: true, color: (r.dias || 0) > 30 ? C.bad : C.ink }) }]; });
      tabla(s, [hdr(['Material', 'Cantidad', 'UM', 'Fecha requerida', 'Días de atraso'])].concat(body), { x: MX, y: 1.4, w: 8.2, colW: [3.0, 1.3, 0.8, 1.6, 1.5], rowH: Math.min(0.45, 5.2 / (body.length + 1)), fontSize: 12, objectName: 'tabla-compras' });
      var v30 = L.filter(function (x) { return (x.dias || 0) > 30; }).length, v120 = L.filter(function (x) { return (x.dias || 0) > 120; }).length;
      var bl = [{ text: 'Alertas automáticas', options: { bold: true, breakLine: true, color: C.navy } },
        { text: v30 + ' de ' + L.length + ' pedidos con más de 30 días de atraso' + (v120 ? ' (' + v120 + ' con más de 4 meses)' : '') + '.', options: { bullet: true, breakLine: true } },
        { text: 'El más antiguo: ' + L[0].desc + ' (' + num(L[0].dias) + ' días).', options: { bullet: true } }];
      if (L.length > 12) { bl[bl.length - 1].options.breakLine = true; bl.push({ text: '+ ' + (L.length - 12) + ' pedidos más en la pestaña Compras.', options: { bullet: true, color: C.muted } }); }
      T(s, bl, { x: 9.1, y: 1.4, w: 3.73, h: 4.5, fontSize: 13, paraSpaceAfter: 8 });
      s.addNotes('Pedidos de la pestaña Compras sin estado de OC ni entrega.');
    })();

    // =================================================== 13 · COSTOS (Power BI)
    pres.addSection({ title: 'Costos de obra' });
    (function () {
      var s = slide('Costos de obra', 'Costos de obra', 'Se revisan en vivo en el reporte de Power BI');
      box(s, MX, 1.4, W - 2 * MX, 4.9, C.bg2, { objectName: 'marco-powerbi' });
      T(s, 'Espacio para la captura del reporte de costos', { x: MX, y: 3.25, w: W - 2 * MX, h: 0.45, fontSize: 18, bold: true, color: C.navy, align: 'center' });
      T(s, 'Pegá acá la captura o abrí el reporte durante la reunión', { x: MX, y: 3.7, w: W - 2 * MX, h: 0.35, fontSize: 13, color: C.muted, align: 'center' });
      box(s, 4.67, 6.45, 4.0, 0.45, C.brand, { rectRadius: 0.22 });
      T(s, [{ text: 'Abrir reporte de costos en Power BI', options: { hyperlink: { url: A.pbiCostos || 'https://app.powerbi.com/', tooltip: 'Costos de obra' } } }], { x: 4.67, y: 6.45, w: 4.0, h: 0.45, fontSize: 13, bold: true, color: C.white, align: 'center', valign: 'middle' });
      s.addNotes(A.pbiCostos ? 'Enlace: reporte de costos de Reportes Power BI.' : 'No hay un reporte con «costo» en el nombre en Reportes Power BI: el enlace va a la portada de Power BI.');
    })();

    // =================================================== 14 · PENDIENTES / ALERTAS / PLANES
    pres.addSection({ title: 'Cierre' });
    (function () {
      var s = slide('Cierre', 'Pendientes, riesgos y planes de acción', 'Pendientes de comité, alertas automáticas y lo que se acuerda en la reunión');
      T(s, 'PENDIENTES DE COMITÉ', { x: MX, y: 1.4, w: 5.6, h: 0.3, fontSize: 11, bold: true, color: C.muted, charSpacing: 1 });
      var mn = A.minuta || [];
      if (!mn.length) T(s, A.minuta ? 'Sin pendientes abiertos de esta obra en la minuta.' : 'No se pudo leer la minuta de comité.', { x: MX, y: 1.8, w: 5.6, h: 0.6, fontSize: 13, color: C.muted });
      mn.slice(0, 5).forEach(function (m, i) {
        var y = 1.8 + i * 0.95;
        box(s, MX, y, 5.6, 0.82, C.bg2);
        T(s, m.titulo || '', { x: MX + 0.2, y: y + 0.08, w: 3.8, h: 0.48, fontSize: 12, bold: true, fit: 'shrink' });
        T(s, (Array.isArray(m.responsables) ? m.responsables.join(', ') : (m.responsables || '—')) + (m.fecha_limite ? ' · límite ' + dmy(m.fecha_limite) : ''), { x: MX + 0.2, y: y + 0.55, w: 3.8, h: 0.24, fontSize: 10, color: C.muted, fit: 'shrink' });
        var e = m.estado || '';
        box(s, MX + 4.1, y + 0.24, 1.35, 0.34, /curso/i.test(e) ? C.infoBg : /program/i.test(e) ? C.okBg : C.badBg, { rectRadius: 0.17 });
        T(s, e, { x: MX + 4.1, y: y + 0.24, w: 1.35, h: 0.34, fontSize: 10, bold: true, align: 'center', valign: 'middle', fit: 'shrink' });
      });
      var al = A.alertas.slice(0, 6);
      box(s, 6.5, 1.4, 6.33, 2.05, C.bg2, { line: { color: C.line, width: 1 } });
      T(s, 'Alertas automáticas', { x: 6.7, y: 1.5, w: 5.9, h: 0.35, fontSize: 15, bold: true, color: C.navy });
      T(s, al.length ? al.map(function (t, i) { return { text: t, options: { bullet: true, breakLine: i < al.length - 1 } }; }) : 'Sin alertas.', { x: 6.7, y: 1.88, w: 5.9, h: 1.5, fontSize: 11, paraSpaceAfter: 2, fit: 'shrink' });
      [['Incidentes y riesgos', 3.6], ['Planes de acción y responsables', 5.15]].forEach(function (b) {
        box(s, 6.5, b[1], 6.33, 1.4, C.white, { line: { color: C.line, width: 1 } });
        T(s, b[0], { x: 6.7, y: b[1] + 0.1, w: 5.9, h: 0.35, fontSize: 15, bold: true, color: C.navy });
        for (var r = 0; r < 3; r++) s.addShape(pres.shapes.LINE, { x: 6.7, y: b[1] + 0.68 + r * 0.25, w: 5.9, h: 0, line: { color: C.line, width: 0.75, dashType: 'dash' } });
      });
      s.addNotes('Alertas automáticas: reglas fijas sobre los datos (lluvia, PPC, ítems vencidos, compras sin OC, certificación, convenios, sobre-ejecución). Incidentes y planes de acción los completa el residente.');
    })();

    // =================================================== 15 · FOTOS
    (function () {
      var F = A.fotosImg || [];
      if (!opt.fotos) return;
      if (!F.length) {
        var s0 = slide('Cierre', 'Fotos de la semana', A.txtA);
        vacio(s0, A.fotos.length ? 'No se pudieron bajar las fotos de la semana (' + A.fotos.length + ').' : 'No hay fotos cargadas en los partes de producción de la semana.');
        return;
      }
      var porS = 6, nS = Math.ceil(F.length / porS);
      for (var p = 0; p < nS; p++) {
        var s = slide('Cierre', 'Fotos de la semana' + (nS > 1 ? ' (' + (p + 1) + '/' + nS + ')' : ''), 'Fotos cargadas en los partes de producción · ' + A.txtA);
        var fw = (W - 2 * MX - 2 * 0.3) / 3, fh = 2.45;
        F.slice(p * porS, (p + 1) * porS).forEach(function (im, i) {
          var x = MX + (i % 3) * (fw + 0.3), y = 1.4 + Math.floor(i / 3) * (fh + 0.35);
          s.addImage({ data: im.data, x: x, y: y, w: fw, h: fh - 0.35, sizing: { type: 'cover', w: fw, h: fh - 0.35 } });
          T(s, dmy(im.fecha), { x: x, y: y + fh - 0.3, w: fw, h: 0.3, fontSize: 12 });
        });
        if (p === nS - 1 && A.fotos.length > F.length) T(s, (A.fotos.length - F.length) + ' fotos no se incluyeron (máximo 24 o no se pudieron bajar).', { x: MX, y: 6.7, w: 9, h: 0.3, fontSize: 10, color: C.muted });
      }
    })();

    return pres;
  }

  /* ======================================================================
   *  DIÁLOGO
   * ====================================================================== */
  function semanas() {
    var ALL = (leer('ALLWEEKS') || []).slice();
    var isoWeekOf = fn('isoWeekOf');
    var cur = isoWeekOf ? isoWeekOf(new Date()) : '';
    var hace7 = new Date(); hace7.setDate(hace7.getDate() - 7);
    var ant = isoWeekOf ? isoWeekOf(hace7) : '';
    [cur, ant].forEach(function (w) { if (w && ALL.indexOf(w) < 0) ALL.push(w); });
    ALL.sort();
    return { all: ALL, cur: cur, ant: ant };
  }
  function etiquetaSemana(wk) {
    var l = fn('lunesDeSemana_')(wk); if (!l) return wk;
    var d = new Date(l); d.setDate(l.getDate() + 6);
    return wk.split('-')[1] + ' · ' + dm(l) + ' – ' + dm(d) + '/' + d.getFullYear();
  }
  function estilos() {
    if ($('#pptCss')) return;
    var st = document.createElement('style'); st.id = 'pptCss';
    st.textContent = [
      '.rep-sub .rep-ppt{margin-left:auto;border:1px solid #d0d6e0 !important;border-radius:8px;background:#fff !important;color:#1a2744 !important;padding:6px 12px !important;margin-bottom:6px !important;font-weight:700}',
      '.rep-sub .rep-ppt:hover{background:#f0f4fa !important}',
      '.ppt-back{position:fixed;inset:0;background:rgba(15,30,60,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.ppt-card{background:#fff;color:#1f2937;border-radius:14px;max-width:520px;width:100%;padding:20px 22px;box-shadow:0 20px 50px rgba(15,30,60,.3)}',
      '.ppt-card h3{margin:0 0 4px;font-size:calc(18px*var(--fs,1));color:#1a2744}',
      '.ppt-card p{margin:0 0 14px;color:#5b6778;font-size:calc(13px*var(--fs,1))}',
      '.ppt-card label{display:block;font-size:calc(12px*var(--fs,1));font-weight:700;color:#4a5568;margin:10px 0 4px}',
      '.ppt-card select{width:100%;padding:8px 10px;border:1px solid #d0d6e0;border-radius:8px;font-size:calc(14px*var(--fs,1));background:#fff;color:#1f2937}',
      '.ppt-card .chk{display:flex;gap:8px;align-items:flex-start;font-weight:600;color:#1f2937;margin-top:12px}',
      '.ppt-card .chk input{margin-top:3px}',
      '.ppt-card .chk small{display:block;font-weight:400;color:#7a8699}',
      '.ppt-acc{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}',
      '.ppt-acc button{padding:9px 16px;border-radius:9px;border:1px solid #d0d6e0;background:#fff;font-weight:700;cursor:pointer;font-size:calc(13px*var(--fs,1))}',
      '.ppt-acc .ok{background:#005d95;border-color:#005d95;color:#fff}',
      '.ppt-acc button:disabled{opacity:.55;cursor:default}',
      '.ppt-est{margin-top:12px;font-size:calc(12.5px*var(--fs,1));color:#005d95;min-height:18px}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function abrir() {
    if (!puedeUsar()) { toast('Tu rol no puede generar la presentación.'); return; }
    if (!(leer('ITEMS') || []).length) { toast('Abrí una obra primero.'); return; }
    estilos();
    var W0 = semanas();
    var opts = function (sel) { return W0.all.map(function (w) { return '<option value="' + w + '"' + (w === sel ? ' selected' : '') + '>' + esc(etiquetaSemana(w)) + '</option>'; }).join(''); };
    var ITEMS = leer('ITEMS') || [], esComp = fn('esComputable');
    var cats = {}; ITEMS.forEach(function (i) { if (esComp(i)) cats[i.cat || 'Sin categoría'] = 1; });
    var nCats = Object.keys(cats).length;
    var b = document.createElement('div'); b.className = 'ppt-back'; b.id = 'pptBack';
    b.innerHTML = '<div class="ppt-card" role="dialog" aria-label="Presentación semanal">' +
      '<h3>📊 Presentación semanal</h3><p>Arma el PowerPoint de la reunión con los datos de la obra. No cambia nada en la app.</p>' +
      '<label>Semana analizada (programado vs ejecutado)</label><select id="pptWkA">' + opts(W0.ant) + '</select>' +
      '<label>Semana que se programa</label><select id="pptWkP">' + opts(W0.cur) + '</select>' +
      (nCats > 1 ? '<label class="chk"><input type="checkbox" id="pptCat" checked><span>Avance por categoría (subfrente)<small>' + nCats + ' categorías: una diapositiva con tarjetas y curva por cada una</small></span></label>' : '') +
      '<label class="chk"><input type="checkbox" id="pptFotos" checked><span>Incluir las fotos de la semana<small>De los partes de producción (hasta 24)</small></span></label>' +
      '<div class="ppt-est" id="pptEst"></div>' +
      '<div class="ppt-acc"><button type="button" id="pptNo">Cancelar</button><button type="button" class="ok" id="pptOk">Generar PowerPoint</button></div></div>';
    document.body.appendChild(b);
    var cerrar = function () { b.remove(); };
    $('#pptNo', b).onclick = cerrar;
    b.addEventListener('click', function (e) { if (e.target === b && !b.dataset.ocupado) cerrar(); });
    $('#pptOk', b).onclick = async function () {
      var est = $('#pptEst', b), ok = $('#pptOk', b), no = $('#pptNo', b);
      var opt = { wkA: $('#pptWkA', b).value, wkP: $('#pptWkP', b).value, porCategoria: !!($('#pptCat', b) && $('#pptCat', b).checked), fotos: $('#pptFotos', b).checked };
      ok.disabled = true; no.disabled = true; b.dataset.ocupado = '1';
      var avance = function (t) { est.textContent = t; };
      try {
        avance('Cargando PowerPoint…');
        var P = await cargarPptx();
        var A = await juntar(opt, avance);
        avance('Armando diapositivas…');
        var pres = armar(P, A, opt);
        var nombre = ('Reunion_semanal_' + A.obra.nombre + '_' + A.wkA).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/g, '_').replace(/_+/g, '_') + '.pptx';
        avance('Guardando ' + nombre + '…');
        await pres.writeFile({ fileName: nombre });
        cerrar();
        toast('✓ Presentación descargada: ' + esc(nombre));
      } catch (e) {
        console.error('[presentacion]', e);
        est.style.color = '#c0392b'; est.textContent = 'No se pudo generar: ' + (e && e.message || e);
        ok.disabled = false; no.disabled = false; delete b.dataset.ocupado;
      }
    };
  }

  // ------------------------------------------------------------- botones
  function ponerBotones() {
    var rs = $('#repSub');
    if (rs && !$('#btnPptRep')) {
      var x = document.createElement('button'); x.type = 'button'; x.id = 'btnPptRep'; x.className = 'rep-ppt';
      x.title = 'PowerPoint para la reunión semanal'; x.textContent = '📊 Presentación semanal';
      x.onclick = abrir; rs.appendChild(x);
    }
    var col = $('#btnNuevaObra') && $('#btnNuevaObra').parentNode;
    if (col && !$('#btnPptFn')) {
      var y = document.createElement('button'); y.id = 'btnPptFn'; y.className = 'fnit'; y.title = 'PowerPoint para la reunión semanal';
      y.textContent = '📊 Presentación semanal';
      y.onclick = function () { var m = $('#fnMenu'); if (m) m.classList.remove('open'); abrir(); };
      col.insertBefore(y, $('#btnNuevaObra'));
    }
    var vis = puedeUsar();
    ['#btnPptRep', '#btnPptFn'].forEach(function (s) { var e = $(s); if (e) e.style.display = vis ? '' : 'none'; });
  }
  estilos();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ponerBotones); else ponerBotones();
  setInterval(ponerBotones, 3000);   // el rol llega después del login

  global.PresentacionSemanal = { abrir: abrir, version: VERSION, _juntar: juntar, _armar: armar };
})(window);
