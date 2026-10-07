/* =========================================================================
 * costos.js — Pestaña COSTOS UNITARIOS (APU) · v20261007e
 *
 * Presupuesto (oferta, uno por obra, congelado) y recosteos con fecha. Se
 * cargan desde la «Plantilla de Costos» (Excel rev19, .xlsm):
 *   · Presupuesto            N°, descripción, unidad, cantidad, «Es igual a»
 *   · una hoja APU por ítem  equipos / mano de obra / materiales / transporte
 *   · materiales in situ     Base Granular, H9…H40, Mezcla asfáltica (recurso
 *                            padre con su propio APU)
 *   · maestros               Equipos, Mano de Obra, Materiales, in situ
 *   · Gastos Generales       % GG, beneficio e impuestos, IVA
 * Se leen los VALORES que dejó Excel (lo último que calculó), sin redondeo.
 *
 * Ven: admin, gerente y residente de la obra. Importa / borra: solo admin.
 * Lectura en ObraAPI.costosVersiones / costoVersionDatos; escritura con
 * costoImportar / costoBorrar (SQL 26).
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function leer(n) { try { return (0, eval)(n); } catch (e) { return undefined; } }
  function rol() { return global.__role || ''; }
  function esAdmin() { return rol() === 'admin'; }
  function api() { return global.ObraAPI; }
  function obraId() { try { return api().getObraId(); } catch (e) { return ''; } }

  // ---------------------------------------------------------------- formatos
  function fg(v) {     // guaraníes, sin decimales en pantalla (el dato queda exacto)
    if (v == null || !isFinite(v)) return '—';
    return Math.round(v).toLocaleString('es-PY');
  }
  function fn(v, d) {
    if (v == null || !isFinite(v)) return '—';
    if (d == null) d = Math.abs(v) < 10 ? 4 : (Math.abs(v) < 1000 ? 2 : 0);
    return Number(v).toLocaleString('es-PY', { maximumFractionDigits: d });
  }
  function fp(v) { return (v == null || !isFinite(v)) ? '—' : (v * 100).toLocaleString('es-PY', { maximumFractionDigits: 1 }) + ' %'; }
  function exacto(v) { return (v == null || !isFinite(v)) ? '' : String(v); }

  /* ======================================================================
   * 1. LECTOR DE LA PLANTILLA (ExcelJS)
   * ====================================================================== */
  function val(c) {
    if (!c) return null;
    var v = c.value;
    if (v == null) return null;
    if (typeof v === 'object') {
      if (v instanceof Date) return v;
      if (v.error) return null;
      if (Object.prototype.hasOwnProperty.call(v, 'result')) {
        var r = v.result;
        if (r && typeof r === 'object' && r.error) return null;
        return r === undefined ? null : r;
      }
      if (v.richText) return v.richText.map(function (t) { return t.text; }).join('');
      if (v.text) return v.text;
      if (v.hyperlink) return v.text || v.hyperlink;
      return null;
    }
    return v;
  }
  function txt(c) { var v = val(c); return v == null ? '' : String(v).trim(); }
  function num(c) {
    var v = val(c);
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
    return null;
  }
  function codigo(c) {
    var v = val(c);
    if (v == null || v === 0 || v === '0') return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).trim();
  }
  function hoja(wb, nombre) {
    var n = String(nombre).toLowerCase();
    var w = null;
    wb.eachSheet(function (ws) { if (!w && ws.name.toLowerCase() === n) w = ws; });
    return w;
  }
  // N° de ítem normalizado para cruzar con el cronograma: «1,1» = «1.1», «2.0» = «2»
  function normItem(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s;
  }

  function leerConfig(wb) {
    var cfg = { eq: [10, 20], mo: [24, 37], mat: [43, 53], tr: [57, 64], prod: 'D39' };
    var ws = hoja(wb, '_Config'); if (!ws) return cfg;
    for (var r = 3; r <= 10; r++) {
      var a = txt(ws.getCell(r, 1)).toLowerCase(), b = num(ws.getCell(r, 2)), c = num(ws.getCell(r, 3));
      if (/^equipos/.test(a) && b && c) cfg.eq = [b, c];
      else if (/^mano de obra/.test(a) && b && c) cfg.mo = [b, c];
      else if (/^materiales/.test(a) && b && c) cfg.mat = [b, c];
      else if (/^transporte/.test(a) && b && c) cfg.tr = [b, c];
      else if (/^producci/.test(a) && txt(ws.getCell(r, 2))) cfg.prod = txt(ws.getCell(r, 2));
    }
    return cfg;
  }

  function leerMaestros(wb) {
    var m = {};   // CÓDIGO (mayúsculas) → {recurso_id, tipo, nombre, um, detalle, precio, dmt, factor_dmt, precio_transporte}
    function poner(id, o) { id = String(id || '').trim(); if (!id) return; o.recurso_id = id; m[id.toUpperCase()] = o; }
    var ws = hoja(wb, 'Equipos');
    if (ws) for (var r = 5; r <= ws.rowCount; r++) {
      var id = codigo(ws.getCell(r, 1)); if (!id) continue;
      poner(id, { tipo: 'Equipos', nombre: txt(ws.getCell(r, 2)), detalle: txt(ws.getCell(r, 3)), um: txt(ws.getCell(r, 16)), precio: num(ws.getCell(r, 15)) });
    }
    ws = hoja(wb, 'Mano de Obra');
    if (ws) for (r = 3; r <= ws.rowCount; r++) {
      id = codigo(ws.getCell(r, 1)); if (!id) continue;
      poner(id, { tipo: 'Mano de obra', nombre: txt(ws.getCell(r, 2)), um: txt(ws.getCell(r, 4)), detalle: txt(ws.getCell(r, 5)), precio: num(ws.getCell(r, 3)) });
    }
    ws = hoja(wb, 'Materiales');
    if (ws) for (r = 4; r <= ws.rowCount; r++) {
      id = codigo(ws.getCell(r, 2)); if (!id) continue;
      var cat = txt(ws.getCell(r, 1));
      poner(id, { tipo: /^transporte/i.test(cat) ? 'Transporte' : 'Materiales', nombre: txt(ws.getCell(r, 3)), um: txt(ws.getCell(r, 4)),
                  detalle: txt(ws.getCell(r, 7)), precio: num(ws.getCell(r, 6)), dmt: num(ws.getCell(r, 8)),
                  factor_dmt: num(ws.getCell(r, 9)), precio_transporte: num(ws.getCell(r, 10)), clase: cat });
    }
    var insitu = {};
    ws = hoja(wb, 'Materiales in situ');
    if (ws) for (r = 4; r <= ws.rowCount; r++) {
      id = codigo(ws.getCell(r, 2)); if (!id) continue;
      insitu[id.toUpperCase()] = true;
      poner(id, { tipo: 'Materiales', nombre: txt(ws.getCell(r, 3)), um: txt(ws.getCell(r, 4)), detalle: 'in situ', precio: num(ws.getCell(r, 6)), clase: txt(ws.getCell(r, 1)) });
    }
    return { recursos: m, insitu: insitu };
  }

  function leerPorcentajes(wb) {
    var out = { gg: null, bi: null, iva: null };
    var ws = hoja(wb, 'Gastos Generales'); if (!ws) return out;
    for (var r = 1; r <= ws.rowCount; r++) {
      var a = txt(ws.getCell(r, 1)).toUpperCase();
      if (/^\(H\)\s*GASTOS GENERALES/.test(a)) out.gg = num(ws.getCell(r, 2));
      else if (/^\(I\)\s*BENEFICIO/.test(a)) out.bi = num(ws.getCell(r, 2));
      else if (/^\(K\)\s*IMPUESTO AL VALOR/.test(a)) out.iva = num(ws.getCell(r, 2));
    }
    return out;
  }

  function leerPresupuesto(wb, avisos) {
    var ws = hoja(wb, 'Presupuesto'); if (!ws) { avisos.push('No está la hoja «Presupuesto».'); return { filas: [], obra: '', fecha: null }; }
    var cab = 0;
    for (var r = 1; r <= Math.min(ws.rowCount, 40); r++) {
      if (/^ITEM/i.test(txt(ws.getCell(r, 2))) && /^DESCRIP/i.test(txt(ws.getCell(r, 3)))) { cab = r; break; }
    }
    if (!cab) { avisos.push('En «Presupuesto» no encontré la fila de títulos (ITEM Nº / DESCRIPCIÓN).'); return { filas: [], obra: '', fecha: null }; }
    var filas = [], vacias = 0;
    for (r = cab + 1; r <= ws.rowCount && vacias < 5; r++) {
      var item = txt(ws.getCell(r, 2)), desc = txt(ws.getCell(r, 3));
      if (/^totales?$/i.test(desc)) break;
      if (!item && !desc) { vacias++; continue; }
      vacias = 0;
      if (!item) continue;
      filas.push({ fila: r, orden: num(ws.getCell(r, 1)), item: item, descripcion: desc, um: txt(ws.getCell(r, 4)),
                   cantidad: num(ws.getCell(r, 5)), igual_a: txt(ws.getCell(r, 6)),
                   cu: num(ws.getCell(r, 7)), pu: num(ws.getCell(r, 11)) });
    }
    var f = val(ws.getCell(1, 3));
    return { filas: filas, obra: txt(ws.getCell(2, 3)), fecha: f instanceof Date ? f : null };
  }

  function esAPU(ws) {
    return /^EQUIPOS/i.test(txt(ws.getCell(8, 2))) && /^MATERIALES/i.test(txt(ws.getCell(41, 2)));
  }

  function leerAPU(ws, cfg, clave, maestro) {
    var lineas = [], r, k;
    function base(bloque, orden, id) {
      var m = maestro.recursos[String(id).toUpperCase()] || {};
      return { clave: clave, bloque: bloque, orden: orden, recurso_id: id, nombre: '', detalle: '', um: m.um || '' };
    }
    for (r = cfg.eq[0], k = 1; r <= cfg.eq[1]; r++) {
      var id = codigo(ws.getCell(r, 1)); if (!id) continue;
      var l = base('equipo', r - cfg.eq[0] + 1, id);
      l.nombre = txt(ws.getCell(r, 2)); l.detalle = txt(ws.getCell(r, 4));
      l.cantidad = num(ws.getCell(r, 5)); l.precio = num(ws.getCell(r, 6)); l.parcial = num(ws.getCell(r, 7));
      l.rendimiento = num(ws.getCell(r, 10));
      l.horas = num(ws.getCell(r, 9));       // horas por unidad tal como están en I (sin el redondeo de E)
      lineas.push(l);
    }
    for (r = cfg.mo[0], k = 1; r <= cfg.mo[1]; r++) {
      id = codigo(ws.getCell(r, 1)); if (!id) continue;
      l = base('mano_obra', r - cfg.mo[0] + 1, id);
      l.nombre = txt(ws.getCell(r, 2)); l.personal = num(ws.getCell(r, 4)); l.horas = num(ws.getCell(r, 5));
      l.precio = num(ws.getCell(r, 6)); l.parcial = num(ws.getCell(r, 7)); l.detalle = txt(ws.getCell(r, 11));
      l.cantidad = (l.personal != null && l.horas != null) ? l.personal * l.horas : l.horas;
      lineas.push(l);
    }
    for (r = cfg.mat[0], k = 1; r <= cfg.mat[1]; r++) {
      id = codigo(ws.getCell(r, 1)); if (!id) continue;
      l = base('material', r - cfg.mat[0] + 1, id);
      l.nombre = txt(ws.getCell(r, 2)); l.um = txt(ws.getCell(r, 4)) || l.um;
      l.cantidad = num(ws.getCell(r, 5)); l.precio = num(ws.getCell(r, 6)); l.parcial = num(ws.getCell(r, 7));
      l.cuantia = num(ws.getCell(r, 9)); l.desperdicio = num(ws.getCell(r, 10));
      lineas.push(l);
    }
    for (r = cfg.tr[0], k = 1; r <= cfg.tr[1]; r++) {
      id = codigo(ws.getCell(r, 1)); if (!id) continue;
      l = base('transporte', r - cfg.tr[0] + 1, id);
      l.nombre = txt(ws.getCell(r, 2));
      l.dmt = num(ws.getCell(r, 26)); if (l.dmt == null) l.dmt = num(ws.getCell(r, 4));
      l.cantidad = num(ws.getCell(r, 5)); l.precio = num(ws.getCell(r, 6)); l.parcial = num(ws.getCell(r, 7));
      l.cuantia = num(ws.getCell(r, 9)); l.desperdicio = num(ws.getCell(r, 10)); l.detalle = txt(ws.getCell(r, 11));
      lineas.push(l);
    }
    var g = cfg.tr[1] + 2;    // (G) costo directo: dos filas debajo del bloque de transporte
    var tot = {
      tot_equipos: num(ws.getCell(cfg.eq[1] + 1, 7)), tot_mo: num(ws.getCell(cfg.mo[1] + 1, 7)),
      prod_ph: num(ws.getCell(cfg.prod)), costo_ejec: num(ws.getCell(cfg.mo[1] + 3, 7)),
      tot_mat: num(ws.getCell(cfg.mat[1] + 1, 7)), tot_transp: num(ws.getCell(cfg.tr[1] + 1, 7)),
      costo_directo: num(ws.getCell(g, 7)), gg_pct: num(ws.getCell(g + 1, 5)), bi_pct: num(ws.getCell(g + 2, 5)),
      costo_unitario: num(ws.getCell(g + 3, 7)), iva_pct: num(ws.getCell(g + 4, 5)), costo_adoptado: num(ws.getCell(g + 5, 7))
    };
    var errores = 0;
    [cfg.eq, cfg.mo, cfg.mat, cfg.tr].forEach(function (b) {
      for (var rr = b[0]; rr <= b[1]; rr++) {
        if (codigo(ws.getCell(rr, 1)) && ws.getCell(rr, 7).value && ws.getCell(rr, 7).value.result && ws.getCell(rr, 7).value.result.error) errores++;
      }
    });
    return { lineas: lineas, tot: tot, errores: errores };
  }

  /* Lee todo el libro. Devuelve { datos (para costo_importar), resumen, avisos } */
  function parsear(wb, itemsCron) {
    var avisos = [];
    var cfg = leerConfig(wb);
    var maestro = leerMaestros(wb);
    var pct = leerPorcentajes(wb);
    var pres = leerPresupuesto(wb, avisos);
    var porOrden = {}, porItem = {};
    pres.filas.forEach(function (f) { if (f.orden != null) porOrden[f.orden] = f; porItem[normItem(f.item)] = f; });

    var cron = {};
    (itemsCron || []).forEach(function (i) { cron[normItem(i.id)] = i.id; });

    var items = [], lineas = [], usados = {}, conHoja = {}, salteadas = [], hojasErr = [];
    wb.eachSheet(function (ws) {
      if (/^plantilla apu$/i.test(ws.name) || !esAPU(ws)) return;
      var orden = num(ws.getCell(2, 1));
      var i1 = codigo(ws.getCell(1, 9));
      var clave, it;
      if (orden && porOrden[orden]) {
        var f = porOrden[orden];
        clave = f.item;
        it = { clave: clave, es_insitu: false, item_id: cron[normItem(f.item)] || null, orden: f.orden, descripcion: f.descripcion,
               um: f.um, cantidad: f.cantidad, igual_a: f.igual_a, hoja: ws.name };
      } else if (i1 && maestro.insitu[i1.toUpperCase()]) {
        var mi = maestro.recursos[i1.toUpperCase()];
        clave = 'IS:' + i1;
        it = { clave: clave, es_insitu: true, item_id: null, orden: null, descripcion: (mi && mi.nombre) || txt(ws.getCell(6, 3)) || ws.name,
               um: txt(ws.getCell(6, 7)) || (mi && mi.um) || '', cantidad: null, igual_a: '', hoja: ws.name };
      } else { salteadas.push(ws.name); return; }
      if (conHoja[clave]) { avisos.push('Dos hojas para el mismo ítem ' + clave.replace(/^IS:/, '') + ': «' + conHoja[clave] + '» y «' + ws.name + '». Se usa la primera.'); return; }
      conHoja[clave] = ws.name;
      var apu = leerAPU(ws, cfg, clave, maestro);
      Object.keys(apu.tot).forEach(function (k) { it[k] = apu.tot[k]; });
      if (apu.errores || it.costo_adoptado == null) hojasErr.push(ws.name);
      items.push(it);
      apu.lineas.forEach(function (l) { lineas.push(l); usados[String(l.recurso_id).toUpperCase()] = l; });
    });

    // ítems del Presupuesto sin hoja propia: «Es igual a» otro ítem, o sin APU
    var sinApu = [];
    pres.filas.forEach(function (f) {
      if (conHoja[f.item]) return;
      items.push({ clave: f.item, es_insitu: false, item_id: cron[normItem(f.item)] || null, orden: f.orden, descripcion: f.descripcion,
                   um: f.um, cantidad: f.cantidad, igual_a: f.igual_a, hoja: '', costo_directo: f.cu, costo_adoptado: f.pu });
      if (!f.igual_a) sinApu.push(f.item);
    });
    // los in situ usados como material también tienen precio
    Object.keys(maestro.insitu).forEach(function (k) { if (usados[k]) usados[k] = usados[k]; });

    var precios = [], nuevosCod = [];
    Object.keys(usados).forEach(function (k) {
      var m = maestro.recursos[k], l = usados[k];
      var tipo = m ? m.tipo : ({ equipo: 'Equipos', mano_obra: 'Mano de obra', material: 'Materiales', transporte: 'Materiales' })[l.bloque];
      precios.push({ recurso_id: m ? m.recurso_id : l.recurso_id, tipo: tipo, nombre: (m && m.nombre) || l.nombre, um: (m && m.um) || l.um || '',
                     detalle: (m && m.detalle) || l.detalle || '', precio: m ? m.precio : (l.bloque === 'transporte' ? null : l.precio),
                     dmt: m ? m.dmt : null, factor_dmt: m ? m.factor_dmt : null, precio_transporte: m ? m.precio_transporte : null });
    });

    items.sort(function (a, b) { return (a.es_insitu - b.es_insitu) || ((a.orden || 0) - (b.orden || 0)) || String(a.clave).localeCompare(String(b.clave), 'es', { numeric: true }); });
    var deItems = items.filter(function (i) { return !i.es_insitu; });
    var totalArchivo = 0, totalDirecto = 0;
    deItems.forEach(function (i) {
      var ref = i;
      if (i.igual_a && !i.hoja) ref = items.find(function (x) { return normItem(x.clave) === normItem(i.igual_a); }) || i;
      totalDirecto += (i.cantidad || 0) * (ref.costo_directo || 0);
      totalArchivo += (i.cantidad || 0) * (ref.costo_adoptado || 0);
    });
    var sinCron = deItems.filter(function (i) { return !i.item_id; }).map(function (i) { return i.clave; });
    if (salteadas.length) avisos.push('Hojas con formato de APU que no corresponden a un ítem del Presupuesto ni a un material in situ (se ignoran): ' + salteadas.join(', ') + '.');
    if (hojasErr.length) avisos.push('Hojas con errores de cálculo (#N/A, #REF!…) o sin costo: ' + hojasErr.join(', ') + '. Revisalas en Excel.');
    if (sinApu.length) avisos.push('Ítems del Presupuesto sin hoja de APU ni «Es igual a»: ' + sinApu.join(', ') + '. Se guarda el costo del Presupuesto.');

    return {
      datos: { gg: pct.gg, bi: pct.bi, iva: pct.iva, items: items, lineas: lineas, precios: precios },
      resumen: { obraExcel: pres.obra, fecha: pres.fecha, nItems: deItems.length, nInsitu: items.length - deItems.length,
                 nLineas: lineas.length, nPrecios: precios.length, totalDirecto: totalDirecto, totalAdoptado: totalArchivo,
                 sinCron: sinCron, sinApu: sinApu },
      avisos: avisos,
      _nuevosCod: nuevosCod
    };
  }

  /* ======================================================================
   * 2. ESTADO Y DATOS
   * ====================================================================== */
  var S = { obra: null, versiones: [], vid: null, cmp: '', datos: {}, cant: 'archivo', vista: 'items', filtro: '', cargando: false, error: '' };

  async function cargarVersiones(forzar) {
    var oid = obraId();
    if (!forzar && S.obra === oid && S.versiones.length) return;
    S.obra = oid; S.datos = {}; S.error = '';
    S.versiones = await api().costosVersiones(oid);
    if (!S.versiones.some(function (v) { return v.version_id === S.vid; })) {
      var rec = S.versiones.filter(function (v) { return v.tipo === 'recosteo'; });
      S.vid = rec.length ? rec[rec.length - 1].version_id : (S.versiones[0] ? S.versiones[0].version_id : null);
    }
    var pres = S.versiones.find(function (v) { return v.tipo === 'presupuesto'; });
    if (S.cmp && !S.versiones.some(function (v) { return String(v.version_id) === String(S.cmp); })) S.cmp = '';
    if (!S.cmp && pres && pres.version_id !== S.vid) S.cmp = String(pres.version_id);
  }
  async function datosDe(vid) {
    if (!vid) return null;
    if (!S.datos[vid]) S.datos[vid] = api().costoVersionDatos(vid).then(armar);
    return S.datos[vid];
  }
  function armar(d) {
    var porClave = {};
    d.items.forEach(function (i) { i.lineas = []; porClave[i.clave] = i; });
    d.lineas.forEach(function (l) { var i = porClave[l.clave]; if (i) i.lineas.push(l); });
    var orden = { equipo: 1, mano_obra: 2, material: 3, transporte: 4 };
    d.items.forEach(function (i) { i.lineas.sort(function (a, b) { return (orden[a.bloque] - orden[b.bloque]) || (a.orden - b.orden); }); });
    var precio = {}; d.precios.forEach(function (p) { precio[String(p.recurso_id).toUpperCase()] = p; });
    d.porClave = porClave; d.precio = precio;
    d.porItemNorm = {}; d.items.forEach(function (i) { if (!i.es_insitu) d.porItemNorm[normItem(i.clave)] = i; });
    return d;
  }
  // el APU que vale para un ítem (si «Es igual a» otro y no tiene hoja propia, el del otro)
  function apuDe(d, it) {
    if (it && it.igual_a && !it.lineas.length) {
      var o = d.porItemNorm[normItem(it.igual_a)];
      if (o && o !== it) return o;
    }
    return it;
  }
  function itemsCron() {
    var I = leer('ITEMS') || [];
    return I.map(function (i) { return { id: i.id, desc: i.desc, um: i.um, pu: i.pu, cv: cantVig(i) }; });
  }
  function cantVig(i) { var f = leer('cantVigente'); try { return f ? f(i) : (i.cant_vigente || i.cant || 0); } catch (e) { return 0; } }

  /* ======================================================================
   * 3. PANTALLA
   * ====================================================================== */
  function estilos() {
    if ($('#ctuCss')) return;
    var st = document.createElement('style'); st.id = 'ctuCss';
    st.textContent = [
      '#v-costos{background:#f4f6f9;display:none;flex-direction:column;overflow:auto;color:#1f2937}#v-costos.on{display:flex}',
      '.ctu-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px;background:#fff;border-bottom:1px solid #d0d6e0;position:sticky;top:0;z-index:3}',
      '.ctu-bar label{font-size:12px;font-weight:700;color:#4a5568;display:flex;align-items:center;gap:6px}',
      '.ctu-bar select,.ctu-bar input[type=search]{font:inherit;font-size:13.5px;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff}',
      '.ctu-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:9px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer}',
      '.ctu-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}.ctu-btn.dan{color:#b42318;border-color:#f0c4bf}',
      '.ctu-btn:disabled{opacity:.5;cursor:default}',
      '.ctu-seg{display:inline-flex;border:1px solid #c9d1dc;border-radius:9px;overflow:hidden}',
      '.ctu-seg button{border:0;background:#fff;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;color:#1f2937}.ctu-seg button.on{background:#1a2744;color:#fff}',
      '.ctu-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:12px 14px}',
      '.ctu-kpi{background:#fff;border:1px solid #d0d6e0;border-radius:12px;padding:10px 12px}',
      '.ctu-kpi small{display:block;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#6b7280}',
      '.ctu-kpi b{display:block;font-size:19px;margin-top:3px;font-variant-numeric:tabular-nums}.ctu-kpi>span{font-size:11.5px;color:#4a5568}',
      '.ctu-wrap{padding:0 14px 18px}',
      '.ctu-tab{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d6e0;border-radius:10px;font-size:13px}',
      '.ctu-tab th{background:#f7f9fc;text-align:left;font-size:11.5px;font-weight:700;color:#4a5568;padding:8px 9px;border-bottom:1px solid #d0d6e0;position:sticky;top:52px;z-index:1}',
      '.ctu-tab td{padding:7px 9px;border-bottom:1px solid #eef1f5;vertical-align:top}',
      '.ctu-tab td.n,.ctu-tab th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ctu-tab tr.clic{cursor:pointer}.ctu-tab tr.clic:hover td{background:#f0f4fa}',
      '.ctu-tab tr.tot td{font-weight:700;background:#f7f9fc}',
      '.ctu-tab .desc{max-width:420px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.ctu-up{color:#b42318}.ctu-dn{color:#15784e}.ctu-mut{color:#9aa4b2}',
      '.ctu-tag{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:1px 6px;background:#eef2f9;color:#2c4a8a;margin-left:4px}',
      '.ctu-tag.warn{background:#fff4dc;color:#7a4b00}',
      '.ctu-vacio{margin:24px auto;max-width:720px;background:#fff;border:1px solid #d0d6e0;border-radius:12px;padding:26px;text-align:center;color:#4a5568;line-height:1.5}',
      '.ctu-ov{position:fixed;inset:0;background:rgba(15,30,60,.45);z-index:400;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}',
      '.ctu-modal{background:#fff;border-radius:14px;max-width:1100px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3);color:#1f2937}',
      '.ctu-mh{display:flex;gap:10px;align-items:flex-start;padding:14px 16px;border-bottom:1px solid #e1e6ee}.ctu-mh h3{margin:0;font-size:16px;flex:1}',
      '.ctu-mb{padding:12px 16px 18px}.ctu-mb h4{margin:14px 0 6px;font-size:13px;color:#1a2744}',
      '.ctu-res{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-top:12px}',
      '.ctu-res div{background:#f7f9fc;border-radius:8px;padding:7px 9px;font-size:12px}.ctu-res b{display:block;font-size:14px;font-variant-numeric:tabular-nums}',
      '.ctu-res div.fin{background:#1a2744;color:#fff}',
      '.ctu-av{background:#fff4dc;border:1px solid #f0cf8a;border-radius:9px;padding:8px 11px;font-size:12.5px;margin:6px 0;color:#5b3a00}',
      '.ctu-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:8px 0}',
      '.ctu-form label{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:700;color:#4a5568}',
      '.ctu-form input,.ctu-form select{font:inherit;font-size:14px;padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px}',
      '@media (max-width:760px){.ctu-tab .hm{display:none}.ctu-tab th{top:0}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function vSel() { return S.versiones.find(function (v) { return v.version_id === S.vid; }); }
  function nomVersion(v) {
    if (!v) return '';
    var f = v.fecha ? v.fecha.split('-').reverse().join('/') : '';
    return (v.tipo === 'presupuesto' ? '📌 ' : '') + (v.nombre || (v.tipo === 'presupuesto' ? 'Presupuesto' : 'Recosteo')) + (f ? ' · ' + f : '');
  }

  async function render() {
    var v = $('#v-costos'); if (!v) return;
    estilos();
    if (['admin', 'gerente', 'residente'].indexOf(rol()) < 0) {
      v.innerHTML = '<div class="ctu-vacio">Los costos unitarios los ven el administrador, el gerente y el residente de la obra.</div>'; return;
    }
    v.innerHTML = '<div class="ctu-vacio">Cargando costos…</div>';
    try { await cargarVersiones(); }
    catch (e) {
      var m = e.message || String(e);
      v.innerHTML = '<div class="ctu-vacio">' + (/costo_version|does not exist|schema cache/i.test(m)
        ? 'Falta correr el SQL 26 (costos unitarios) en Supabase.' : esc(m)) + '</div>';
      return;
    }
    var h = barra();
    if (!S.versiones.length) {
      h += '<div class="ctu-vacio"><div style="font-size:30px">💲</div><p>Esta obra todavía no tiene costos cargados.</p>' +
        '<p>Con <b>⬇ Exportar .xlsm</b> se arma la Plantilla de Costos de esta obra: todos los ítems del cronograma en el Presupuesto y una hoja APU por ítem, ' +
        'precargada con el desglose de recursos que ya tenga la obra. Se completa en Excel y se vuelve a importar.</p>' +
        (esAdmin() ? '<p>Con <b>⬆ Importar plantilla</b> se carga la planilla de costos. La primera que se carga es el <b>Presupuesto</b> (la oferta); las siguientes, <b>recosteos</b>.</p>'
                   : '<p>La importa el administrador.</p>') + '</div>';
      v.innerHTML = h; enlazarBarra(); return;
    }
    v.innerHTML = h + '<div id="ctuCuerpo"><div class="ctu-vacio">Cargando…</div></div>';
    enlazarBarra();
    var d, dc = null;
    try { d = await datosDe(S.vid); if (S.cmp) dc = await datosDe(S.cmp); }
    catch (e) { $('#ctuCuerpo').innerHTML = '<div class="ctu-vacio">' + esc(e.message || String(e)) + '</div>'; return; }
    var c = $('#ctuCuerpo'); if (!c) return;
    c.innerHTML = S.vista === 'recursos' ? vistaRecursos(d, dc) : (S.vista === 'insitu' ? vistaInsitu(d, dc) : vistaItems(d, dc));
    $$('[data-ctu-it]', c).forEach(function (tr) { tr.onclick = function () { abrirAPU(d, dc, tr.getAttribute('data-ctu-it')); }; });
  }

  function barra() {
    var opts = S.versiones.map(function (x) { return '<option value="' + x.version_id + '"' + (x.version_id === S.vid ? ' selected' : '') + '>' + esc(nomVersion(x)) + '</option>'; }).join('');
    var optsC = '<option value="">— sin comparar —</option>' + S.versiones.filter(function (x) { return x.version_id !== S.vid; })
      .map(function (x) { return '<option value="' + x.version_id + '"' + (String(x.version_id) === String(S.cmp) ? ' selected' : '') + '>' + esc(nomVersion(x)) + '</option>'; }).join('');
    return '<div class="ctu-bar">' +
      (S.versiones.length ? '<label>Versión <select id="ctuVer">' + opts + '</select></label>' +
        '<label>Comparar con <select id="ctuCmp">' + optsC + '</select></label>' +
        '<div class="ctu-seg"><button data-ctu-v="items" class="' + (S.vista === 'items' ? 'on' : '') + '">Ítems</button>' +
        '<button data-ctu-v="insitu" class="' + (S.vista === 'insitu' ? 'on' : '') + '">In situ</button>' +
        '<button data-ctu-v="recursos" class="' + (S.vista === 'recursos' ? 'on' : '') + '">Recursos</button></div>' +
        '<label title="Para los totales: la cantidad del archivo de costos o la cantidad vigente del cronograma">Cantidades <select id="ctuCant">' +
        '<option value="archivo"' + (S.cant === 'archivo' ? ' selected' : '') + '>del archivo</option>' +
        '<option value="vigente"' + (S.cant === 'vigente' ? ' selected' : '') + '>vigentes del cronograma</option></select></label>' +
        '<input type="search" id="ctuFil" placeholder="Buscar…" value="' + esc(S.filtro) + '">' : '') +
      '<span style="flex:1"></span>' +
      '<button class="ctu-btn" id="ctuExp" title="' + (S.versiones.length ? 'Bajar esta versión en la Plantilla de Costos (.xlsm), con macros, para editarla en Excel'
        : 'Armar la Plantilla de Costos (.xlsm) de esta obra con todos sus ítems y una hoja APU por ítem') + '">⬇ Exportar .xlsm</button>' +
      (esAdmin() ? '<button class="ctu-btn" id="ctuPlant" title="Guardar la Plantilla de Costos base que se usa para exportar">⚙ Plantilla base</button>' : '') +
      (esAdmin() ? '<button class="ctu-btn pri" id="ctuImp">⬆ Importar plantilla</button>' +
        (S.vid ? '<button class="ctu-btn dan" id="ctuDel" title="Borrar la versión elegida">🗑</button>' : '') : '') +
      '<input type="file" id="ctuFile" accept=".xlsm,.xlsx" style="display:none"><input type="file" id="ctuFileBase" accept=".xlsm" style="display:none"></div>';
  }
  function enlazarBarra() {
    var e;
    if ((e = $('#ctuVer'))) e.onchange = function () {
      S.vid = Number(this.value);
      if (String(S.cmp) === String(S.vid)) S.cmp = '';
      var pres = S.versiones.find(function (x) { return x.tipo === 'presupuesto'; });
      if (!S.cmp && pres && pres.version_id !== S.vid) S.cmp = String(pres.version_id);
      render();
    };
    if ((e = $('#ctuCmp'))) e.onchange = function () { S.cmp = this.value; render(); };
    if ((e = $('#ctuCant'))) e.onchange = function () { S.cant = this.value; render(); };
    if ((e = $('#ctuFil'))) e.oninput = function () {
      S.filtro = this.value; var p = this.selectionStart;
      clearTimeout(S._t); S._t = setTimeout(function () { render().then(function () { var f = $('#ctuFil'); if (f) { f.focus(); f.setSelectionRange(p, p); } }); }, 250);
    };
    $$('[data-ctu-v]').forEach(function (b) { b.onclick = function () { S.vista = b.getAttribute('data-ctu-v'); render(); }; });
    if ((e = $('#ctuImp'))) e.onclick = function () { $('#ctuFile').click(); };
    if ((e = $('#ctuFile'))) e.onchange = function () { var f = this.files && this.files[0]; this.value = ''; if (f) importar(f); };
    if ((e = $('#ctuDel'))) e.onclick = borrarVersion;
    if ((e = $('#ctuExp'))) e.onclick = dialogoExportar;
    if ((e = $('#ctuPlant'))) e.onclick = function () { S._baseDestino = 'guardar'; $('#ctuFileBase').click(); };
    if ((e = $('#ctuFileBase'))) e.onchange = function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      if (S._baseDestino === 'guardar') guardarBase(f);
      else if (S._baseResolver) { var r = S._baseResolver; S._baseResolver = null; r(f); }
    };
  }

  function cantidadDe(it) {
    if (S.cant === 'vigente' && it.item_id) {
      var I = leer('byId') || {}; var c = I[it.item_id];
      if (c) return cantVig(c);
    }
    return it.cantidad || 0;
  }
  function puContrato(it) {
    if (!it.item_id) return null;
    var I = leer('byId') || {}; var c = I[it.item_id];
    return c && c.pu != null ? Number(c.pu) : null;
  }
  function delta(a, b) {
    if (a == null || b == null || !b) return '';
    var x = (a - b) / Math.abs(b);
    if (Math.abs(x) < 0.0005) return '<span class="ctu-mut">=</span>';
    return '<span class="' + (x > 0 ? 'ctu-up' : 'ctu-dn') + '">' + (x > 0 ? '▲ ' : '▼ ') + fp(Math.abs(x)) + '</span>';
  }
  function coincide(it) {
    var f = S.filtro.trim().toLowerCase(); if (!f) return true;
    return (it.clave + ' ' + it.descripcion + ' ' + (it.item_id || '')).toLowerCase().indexOf(f) >= 0;
  }

  function sumaBloques(d, it) {
    var a = apuDe(d, it), o = { equipo: 0, mano_obra: 0, material: 0, transporte: 0 };
    if (a.lineas.length) {
      o.equipo = a.tot_equipos != null && a.prod_ph ? a.tot_equipos / a.prod_ph : 0;
      o.mano_obra = a.tot_mo != null && a.prod_ph ? a.tot_mo / a.prod_ph : 0;
      o.material = a.tot_mat || 0; o.transporte = a.tot_transp || 0;
    }
    return o;
  }

  /* Margen por ítem (definido por José, 07/10):
       margen unitario = PU contrato − costo directo × (1 + IVA)
     y en las tarjetas:
       costo indirecto total = Σ cantidad × costo directo × % gastos generales
       beneficios e impuestos esperados = margen total − costo indirecto total
     Solo entran en el margen los ítems que cruzan con el cronograma (tienen PU). */
  function vistaItems(d, dc) {
    var v = vSel();
    var its = d.items.filter(function (i) { return !i.es_insitu; });
    var T = { dir: 0, dirC: 0, cont: 0, marg: 0, ind: 0, nC: 0, eq: 0, mo: 0, mat: 0, tr: 0, cmpDir: 0, cmpOk: false };
    var filas = its.map(function (it) {
      var a = apuDe(d, it), q = cantidadDe(it), pu = puContrato(it);
      var iva = a.iva_pct != null ? a.iva_pct : (v && v.iva != null ? v.iva : 0.1);
      var gg = a.gg_pct != null ? a.gg_pct : (v && v.gg != null ? v.gg : 0);
      var cd = a.costo_directo || 0;
      var b = sumaBloques(d, it);
      T.dir += q * cd;
      T.eq += q * b.equipo; T.mo += q * b.mano_obra; T.mat += q * b.material; T.tr += q * b.transporte;
      var mu = null;
      if (pu != null) {
        mu = pu - cd * (1 + iva);
        T.cont += q * pu; T.dirC += q * cd; T.marg += q * mu; T.ind += q * cd * gg; T.nC++;
      }
      var c = null;
      if (dc) { var ic = dc.porItemNorm[normItem(it.clave)]; if (ic) { c = apuDe(dc, ic); T.cmpDir += q * (c.costo_directo || 0); T.cmpOk = true; } }
      if (!coincide(it)) return '';
      return '<tr class="clic" data-ctu-it="' + esc(it.clave) + '">' +
        '<td><b>' + esc(it.clave) + '</b>' + (it.item_id ? '' : ' <span class="ctu-tag warn" title="No cruza con un ítem del cronograma">sin cronograma</span>') +
        (it.igual_a && !it.lineas.length ? ' <span class="ctu-tag" title="Usa el APU de otro ítem">= ' + esc(it.igual_a) + '</span>' : '') + '</td>' +
        '<td><div class="desc" title="' + esc(it.descripcion) + '">' + esc(it.descripcion) + '</div></td>' +
        '<td class="hm">' + esc(it.um) + '</td>' +
        '<td class="n hm" title="' + exacto(q) + '">' + fn(q) + '</td>' +
        '<td class="n" title="' + exacto(cd) + '">' + fg(cd) + '</td>' +
        (dc ? '<td class="n">' + (c ? delta(cd, c.costo_directo) : '<span class="ctu-mut">—</span>') + '</td>' : '') +
        '<td class="n">' + (pu != null ? fg(pu) : '<span class="ctu-mut">—</span>') + '</td>' +
        '<td class="n" title="' + exacto(mu) + '">' + (mu == null ? '<span class="ctu-mut">—</span>' : '<span class="' + (mu < 0 ? 'ctu-up' : '') + '">' + fg(mu) + '</span>') + '</td>' +
        '<td class="n hm">' + (mu == null ? '' : '<span class="' + (mu < 0 ? 'ctu-up' : '') + '">' + fg(q * mu) + '</span>') + '</td>' +
        '<td class="n hm">' + (mu == null || !pu ? '' : fp(mu / pu)) + '</td></tr>';
    }).join('');
    var bi = T.marg - T.ind;
    var ivaV = v && v.iva != null ? v.iva : 0.1, ggV = v && v.gg != null ? v.gg : null;
    var k = '<div class="ctu-kpis">' +
      kpi('Costo directo total', fg(T.dir), 'Σ cantidad × costo directo (G) · ' + its.length + ' ítems') +
      kpi('Precio de contrato', T.nC ? fg(T.cont) : '—', T.nC ? T.nC + ' ítem(s) que cruzan con el cronograma (con IVA)' : 'ningún ítem cruza con el cronograma') +
      kpi('Margen total', T.nC ? '<span class="' + (T.marg < 0 ? 'ctu-up' : '') + '">' + fg(T.marg) + '</span>' : '—',
          T.nC ? 'contrato − costo directo × ' + fn(1 + ivaV, 2) + (T.cont ? ' · ' + fp(T.marg / T.cont) + ' del contrato' : '') : '') +
      kpi('Costo indirecto total', T.nC ? fg(T.ind) : '—', 'gastos generales ' + fp(ggV) + ' sobre el costo directo') +
      kpi('Beneficios e impuestos esperados', T.nC ? '<span class="' + (bi < 0 ? 'ctu-up' : '') + '">' + fg(bi) + '</span>' : '—',
          T.nC ? 'margen total − costo indirecto' + (T.cont ? ' · ' + fp(bi / T.cont) + ' del contrato' : '') : '') +
      (T.cmpOk ? kpi('Costo directo vs comparación', delta(T.dir, T.cmpDir) || '=', 'antes ' + fg(T.cmpDir)) : '') +
      kpi('Por tipo (directo)', '', 'Equipos ' + fp(T.dir ? T.eq / T.dir : null) + ' · M.O. ' + fp(T.dir ? T.mo / T.dir : null) +
          ' · Materiales ' + fp(T.dir ? T.mat / T.dir : null) + ' · Transporte ' + fp(T.dir ? T.tr / T.dir : null)) +
      '</div>';
    var nCol = dc ? 10 : 9;
    return k + '<div class="ctu-wrap"><table class="ctu-tab"><thead><tr><th>Ítem</th><th>Descripción</th><th class="hm">Unid.</th><th class="n hm">Cantidad</th>' +
      '<th class="n">Costo directo</th>' + (dc ? '<th class="n" title="Costo directo contra la versión de comparación">Δ</th>' : '') +
      '<th class="n">Precio de contrato</th><th class="n" title="Precio de contrato − costo directo × ' + fn(1 + ivaV, 2) + '">Margen unit.</th>' +
      '<th class="n hm">Margen total</th><th class="n hm" title="Margen unitario / precio de contrato">%</th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="' + nCol + '" class="ctu-mut" style="text-align:center;padding:18px">Nada coincide con la búsqueda.</td></tr>') +
      '<tr class="tot"><td colspan="3">Total</td><td class="hm"></td><td class="n">' + fg(T.dir) + '</td>' +
      (dc ? '<td class="n">' + (T.cmpOk ? delta(T.dir, T.cmpDir) : '') + '</td>' : '') +
      '<td class="n">' + (T.nC ? fg(T.cont) : '') + '</td><td></td><td class="n hm">' + (T.nC ? fg(T.marg) : '') +
      '</td><td class="n hm">' + (T.cont ? fp(T.marg / T.cont) : '') + '</td></tr>' +
      '</tbody></table><p class="ctu-mut" style="font-size:12px;margin:8px 2px">Margen unitario = precio de contrato − costo directo × ' + fn(1 + ivaV, 2) +
      ' (IVA). Tocá un ítem para ver su análisis de precio unitario. Los montos se muestran sin decimales; al pasar el mouse se ve el valor exacto.</p></div>';
  }
  function kpi(t, v, s) { return '<div class="ctu-kpi"><small>' + esc(t) + '</small><b>' + v + '</b><span>' + s + '</span></div>'; }

  function vistaInsitu(d, dc) {
    var its = d.items.filter(function (i) { return i.es_insitu && coincide(i); });
    if (!its.length) return '<div class="ctu-vacio">Esta versión no tiene materiales in situ (Base Granular, hormigones, mezcla asfáltica…).</div>';
    return '<div class="ctu-wrap" style="padding-top:12px"><table class="ctu-tab"><thead><tr><th>Código</th><th>Material in situ</th><th>Unid.</th>' +
      '<th class="n">Costo directo</th><th class="n hm">Comparación</th><th class="n">Δ</th><th class="n">Precio c/ coeficientes</th></tr></thead><tbody>' +
      its.map(function (it) {
        var c = dc ? dc.porClave[it.clave] : null;
        return '<tr class="clic" data-ctu-it="' + esc(it.clave) + '"><td><b>' + esc(it.clave.replace(/^IS:/, '')) + '</b></td><td>' + esc(it.descripcion) +
          '</td><td>' + esc(it.um) + '</td><td class="n">' + fg(it.costo_directo) + '</td><td class="n hm">' + (c ? fg(c.costo_directo) : '—') +
          '</td><td class="n">' + (c ? delta(it.costo_directo, c.costo_directo) : '') + '</td><td class="n">' + fg(it.costo_adoptado) + '</td></tr>';
      }).join('') + '</tbody></table><p class="ctu-mut" style="font-size:12px;margin:8px 2px">El costo directo del in situ es el precio que usan los ítems como material.</p></div>';
  }

  // consumo total por recurso: Σ cantidad del ítem × consumo por unidad
  function vistaRecursos(d, dc) {
    var R = {};
    d.items.filter(function (i) { return !i.es_insitu; }).forEach(function (it) {
      var a = apuDe(d, it), q = cantidadDe(it);
      var pp = a.prod_ph || 1;
      a.lineas.forEach(function (l) {
        var k = String(l.recurso_id).toUpperCase() + '|' + (l.bloque === 'transporte' ? 'T' : '');
        var r = R[k] = R[k] || { id: l.recurso_id, nombre: l.nombre, bloque: l.bloque, um: l.um, cant: 0, costo: 0, insitu: !!d.porClave['IS:' + l.recurso_id] };
        var porU = (l.bloque === 'equipo' || l.bloque === 'mano_obra') ? (l.cantidad || 0) / pp : (l.cantidad || 0);
        var cuU = (l.bloque === 'equipo' || l.bloque === 'mano_obra') ? (l.parcial || 0) / pp : (l.parcial || 0);
        r.cant += q * porU; r.costo += q * cuU;
      });
    });
    var lista = Object.keys(R).map(function (k) { return R[k]; }).filter(function (r) {
      var f = S.filtro.trim().toLowerCase(); return !f || (r.id + ' ' + r.nombre).toLowerCase().indexOf(f) >= 0;
    }).sort(function (a, b) { return b.costo - a.costo; });
    var tot = lista.reduce(function (s, r) { return s + r.costo; }, 0);
    var nom = { equipo: 'Equipo (h)', mano_obra: 'Mano de obra', material: 'Material', transporte: 'Transporte' };
    return '<div class="ctu-wrap" style="padding-top:12px"><table class="ctu-tab"><thead><tr><th>Código</th><th>Recurso</th><th class="hm">Tipo</th>' +
      '<th class="n">Cantidad total</th><th class="hm">Unid.</th><th class="n">Costo directo</th><th class="n">Incidencia</th></tr></thead><tbody>' +
      lista.map(function (r) {
        return '<tr><td><b>' + esc(r.id) + '</b></td><td>' + esc(r.nombre) + (r.insitu ? ' <span class="ctu-tag">in situ</span>' : '') +
          '</td><td class="hm">' + nom[r.bloque] + '</td><td class="n" title="' + exacto(r.cant) + '">' + fn(r.cant) + '</td><td class="hm">' +
          esc(r.bloque === 'equipo' ? 'h' : r.um) + '</td><td class="n">' + fg(r.costo) + '</td><td class="n">' + fp(tot ? r.costo / tot : null) + '</td></tr>';
      }).join('') + '<tr class="tot"><td colspan="5">Total</td><td class="n">' + fg(tot) + '</td><td></td></tr></tbody></table>' +
      '<p class="ctu-mut" style="font-size:12px;margin:8px 2px">Cantidad del ítem × consumo por unidad del APU. Los materiales in situ (hormigones, base, mezcla) figuran como tales, sin desglosar en sus componentes.</p></div>';
  }

  /* ---- detalle de un APU, con los mismos bloques que la hoja de Excel ---- */
  function abrirAPU(d, dc, clave) {
    var it = d.porClave[clave]; if (!it) return;
    var a = apuDe(d, it);
    var c = null;
    if (dc) { var ic = it.es_insitu ? dc.porClave[clave] : dc.porItemNorm[normItem(clave)]; if (ic) c = apuDe(dc, ic); }
    var lc = {}; if (c) c.lineas.forEach(function (l) { lc[l.bloque + '|' + String(l.recurso_id).toUpperCase()] = l; });
    function bloque(tit, b, cols) {
      var ls = a.lineas.filter(function (l) { return l.bloque === b; });
      if (!ls.length) return '';
      return '<h4>' + tit + '</h4><table class="ctu-tab"><thead><tr><th>Código</th><th>Recurso</th>' + cols.map(function (x) { return '<th class="n' + (x.hm ? ' hm' : '') + '">' + x.t + '</th>'; }).join('') +
        (c ? '<th class="n">Δ precio</th>' : '') + '</tr></thead><tbody>' +
        ls.map(function (l) {
          var o = lc[b + '|' + String(l.recurso_id).toUpperCase()];
          return '<tr><td>' + esc(l.recurso_id) + '</td><td>' + esc(l.nombre) + (l.detalle ? ' <span class="ctu-mut">' + esc(l.detalle) + '</span>' : '') +
            (d.porClave['IS:' + l.recurso_id] ? ' <span class="ctu-tag">in situ</span>' : '') + '</td>' +
            cols.map(function (x) { var v = l[x.k]; return '<td class="n' + (x.hm ? ' hm' : '') + '" title="' + exacto(v) + '">' + (x.g ? fg(v) : (x.p ? fp(v) : fn(v))) + '</td>'; }).join('') +
            (c ? '<td class="n">' + (o ? delta(l.precio, o.precio) : '<span class="ctu-tag">nuevo</span>') + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
    }
    var h = '<div class="ctu-ov" id="ctuOv"><div class="ctu-modal"><div class="ctu-mh"><h3>' + (it.es_insitu ? 'Material in situ ' + esc(clave.replace(/^IS:/, '')) : 'Ítem ' + esc(clave)) +
      ' · ' + esc(it.descripcion) + '<br><small class="ctu-mut">' + esc(it.um) + (it.cantidad != null ? ' · cantidad ' + fn(it.cantidad) : '') +
      (a !== it ? ' · usa el APU del ítem ' + esc(a.clave) : '') + (a.hoja ? ' · hoja «' + esc(a.hoja) + '»' : '') + '</small></h3>' +
      '<button class="ctu-btn" id="ctuCerrar">✕</button></div><div class="ctu-mb">' +
      (a.lineas.length ? '' : '<div class="ctu-av">Este ítem no tiene hoja de APU en el archivo: se guardó solo el costo del Presupuesto.</div>') +
      bloque('Equipos', 'equipo', [{ k: 'rendimiento', t: 'Rend. (u/h)' }, { k: 'cantidad', t: 'Horas' }, { k: 'precio', t: 'Costo hora', g: 1 }, { k: 'parcial', t: 'Costo horario', g: 1 }]) +
      bloque('Mano de obra', 'mano_obra', [{ k: 'personal', t: 'Personal' }, { k: 'horas', t: 'Horas c/u' }, { k: 'precio', t: 'Costo hora', g: 1 }, { k: 'parcial', t: 'Costo horario', g: 1 }]) +
      bloque('Materiales', 'material', [{ k: 'cuantia', t: 'Cuantía', hm: 1 }, { k: 'desperdicio', t: 'Desp.', p: 1, hm: 1 }, { k: 'cantidad', t: 'Consumo' }, { k: 'precio', t: 'Precio', g: 1 }, { k: 'parcial', t: 'Costo', g: 1 }]) +
      bloque('Transporte', 'transporte', [{ k: 'dmt', t: 'DMT' }, { k: 'cuantia', t: 'Cuantía', hm: 1 }, { k: 'desperdicio', t: 'Desp.', p: 1, hm: 1 }, { k: 'cantidad', t: 'Consumo' }, { k: 'precio', t: 'Tarifa', g: 1 }, { k: 'parcial', t: 'Costo', g: 1 }]) +
      '<div class="ctu-res">' +
      res('(A) Equipos', a.tot_equipos) + res('(B) Mano de obra', a.tot_mo) + res('(C) Producción P/H', a.prod_ph, true) +
      res('(D) Ejecución (A+B)/C', a.costo_ejec) + res('(E) Materiales', a.tot_mat) + res('(F) Transporte', a.tot_transp) +
      res('(G) Costo directo', a.costo_directo, false, c && c.costo_directo) + res('(H) Gastos generales ' + fp(a.gg_pct), a.costo_directo != null && a.gg_pct != null ? Math.round(a.costo_directo * a.gg_pct) : null) +
      res('(J) Costo unitario', a.costo_unitario) + res('(K) IVA ' + fp(a.iva_pct), a.costo_unitario != null && a.costo_adoptado != null ? a.costo_adoptado - a.costo_unitario : null) +
      '<div class="fin">(L) Precio unitario (con coeficientes)<b>' + fg(a.costo_adoptado) + '</b>' + (c ? delta(a.costo_adoptado, c.costo_adoptado) : '') + '</div></div>' +
      '</div></div></div>';
    var w = document.createElement('div'); w.innerHTML = h; document.body.appendChild(w.firstChild);
    var cerrar = function () { var o = $('#ctuOv'); if (o) o.remove(); document.removeEventListener('keydown', tecla); };
    var tecla = function (e) { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    $('#ctuCerrar').onclick = cerrar;
    $('#ctuOv').onclick = function (e) { if (e.target.id === 'ctuOv') cerrar(); };
  }
  function res(t, v, n, antes) {
    return '<div>' + t + '<b title="' + exacto(v) + '">' + (n ? fn(v) : fg(v)) + '</b>' + (antes != null ? delta(v, antes) : '') + '</div>';
  }

  /* ======================================================================
   * 4. IMPORTAR
   * ====================================================================== */
  var libs = {};
  function cargarLib(nombre, src, g) {
    if (global[g]) return Promise.resolve(global[g]);
    if (!libs[nombre]) libs[nombre] = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { ok(global[g]); };
      s.onerror = function () { libs[nombre] = null; mal(new Error('No se pudo cargar ' + nombre + ' (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return libs[nombre];
  }

  async function importar(file) {
    if (!esAdmin()) return;
    toast('Leyendo ' + esc(file.name) + '…');
    var r;
    try {
      var ExcelJS = await cargarLib('ExcelJS', 'exceljs.min.js?v=4.4.0', 'ExcelJS');
      var wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      r = parsear(wb, itemsCron());
    } catch (e) { alert('No se pudo leer el archivo: ' + (e.message || e)); return; }
    if (!r.datos.items.length) { alert('El archivo no tiene ítems en la hoja «Presupuesto».\n\n' + r.avisos.join('\n')); return; }
    var nuevos = [];
    try {
      var ids = await api().recursoIds();
      var set = {}; ids.forEach(function (x) { set[String(x).toUpperCase()] = true; });
      nuevos = r.datos.precios.filter(function (p) { return !set[String(p.recurso_id).toUpperCase()]; }).map(function (p) { return p.recurso_id + ' ' + p.nombre; });
    } catch (e) {}
    vistaPrevia(file, r, nuevos);
  }

  function vistaPrevia(file, r, nuevos) {
    var hayPres = S.versiones.some(function (v) { return v.tipo === 'presupuesto'; });
    var hoy = new Date();
    var iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    // las fechas de Excel llegan como medianoche UTC: se leen en UTC para no correrlas un día
    var f = r.resumen.fecha ? new Date(r.resumen.fecha.getUTCFullYear(), r.resumen.fecha.getUTCMonth(), r.resumen.fecha.getUTCDate()) : hoy;
    var R = r.resumen;
    var h = '<div class="ctu-ov" id="ctuOv"><div class="ctu-modal" style="max-width:820px"><div class="ctu-mh"><h3>Importar costos · ' + esc(file.name) +
      '<br><small class="ctu-mut">Obra en el archivo: ' + esc(R.obraExcel || '—') + '</small></h3><button class="ctu-btn" id="ctuCerrar">✕</button></div><div class="ctu-mb">' +
      '<div class="ctu-form">' +
      '<label>Tipo<select id="ctuTipo"><option value="presupuesto"' + (hayPres ? '' : ' selected') + '>Presupuesto (oferta)</option><option value="recosteo"' + (hayPres ? ' selected' : '') + '>Recosteo</option></select></label>' +
      '<label>Nombre<input id="ctuNom" value="' + esc(hayPres ? 'Recosteo ' + iso(hoy).split('-').reverse().join('/').slice(3) : 'Presupuesto') + '"></label>' +
      '<label>Fecha<input id="ctuFec" type="date" value="' + iso(f) + '"></label></div>' +
      '<label id="ctuReemp" style="display:none;font-size:13px;margin:4px 0"><input type="checkbox" id="ctuReempChk"> Ya hay un presupuesto: reemplazarlo (se borra el anterior)</label>' +
      '<div class="ctu-res">' +
      '<div>Ítems<b>' + R.nItems + '</b></div><div>Materiales in situ<b>' + R.nInsitu + '</b></div><div>Renglones de APU<b>' + R.nLineas + '</b></div>' +
      '<div>Recursos con precio<b>' + R.nPrecios + '</b></div><div>Costo directo total<b>' + fg(R.totalDirecto) + '</b></div>' +
      '<div class="fin">Total con coeficientes<b>' + fg(R.totalAdoptado) + '</b></div></div>' +
      '<div class="ctu-res"><div>GG<b>' + fp(r.datos.gg) + '</b></div><div>Beneficio e imp.<b>' + fp(r.datos.bi) + '</b></div><div>IVA<b>' + fp(r.datos.iva) + '</b></div></div>' +
      (R.sinCron.length ? '<div class="ctu-av">⚠ ' + R.sinCron.length + ' ítem(s) no cruzan con el cronograma de esta obra por número: <b>' + esc(R.sinCron.join(', ')) +
        '</b>. Se guardan igual, sin comparar con el precio de contrato.</div>' : '<div class="ctu-av" style="background:#e8f6ee;border-color:#b9e2c8;color:#1f6f43">✓ Todos los ítems cruzan con el cronograma.</div>') +
      (nuevos.length ? '<div class="ctu-av">➕ ' + nuevos.length + ' recurso(s) no están en el maestro y se agregan: ' + esc(nuevos.slice(0, 25).join(' · ')) + (nuevos.length > 25 ? ' …' : '') + '</div>' : '') +
      r.avisos.map(function (a) { return '<div class="ctu-av">⚠ ' + esc(a) + '</div>'; }).join('') +
      '<p class="ctu-mut" style="font-size:12px">Se toman los valores que calculó Excel la última vez que se guardó el archivo. Si cambiaste algo, abrilo, dejá que recalcule y guardalo antes de importar.' +
      ' Los precios de los recursos quedan como precios de esta obra (los usa Compras).</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="ctu-btn" id="ctuNo">Cancelar</button><button class="ctu-btn pri" id="ctuSi">Importar</button></div>' +
      '</div></div></div>';
    var w = document.createElement('div'); w.innerHTML = h; document.body.appendChild(w.firstChild);
    var cerrar = function () { var o = $('#ctuOv'); if (o) o.remove(); };
    $('#ctuCerrar').onclick = cerrar; $('#ctuNo').onclick = cerrar;
    var tipo = $('#ctuTipo');
    var ver = function () { $('#ctuReemp').style.display = (tipo.value === 'presupuesto' && hayPres) ? 'block' : 'none'; };
    tipo.onchange = function () { ver(); $('#ctuNom').value = tipo.value === 'presupuesto' ? 'Presupuesto' : 'Recosteo ' + iso(hoy).split('-').reverse().join('/').slice(3); };
    ver();
    $('#ctuSi').onclick = async function () {
      var bt = this;
      if (tipo.value === 'presupuesto' && hayPres && !$('#ctuReempChk').checked) { alert('Ya hay un presupuesto. Tildá «reemplazarlo» o cargalo como recosteo.'); return; }
      var datos = Object.assign({}, r.datos, { tipo: tipo.value, nombre: $('#ctuNom').value.trim(), fecha: $('#ctuFec').value,
        archivo: file.name, reemplazar: tipo.value === 'presupuesto' && hayPres });
      bt.disabled = true; bt.textContent = 'Importando…';
      try {
        var res = await api().costoImportar(datos);
        cerrar();
        toast('Costos importados: <b>' + res.items + '</b> ítems, <b>' + res.lineas + '</b> renglones' + (res.recursos_nuevos ? ', ' + res.recursos_nuevos + ' recursos nuevos en el maestro' : ''));
        S.vid = res.version_id; S.cmp = '';
        await cargarVersiones(true); render();
      } catch (e) { bt.disabled = false; bt.textContent = 'Importar'; alert(e.message || String(e)); }
    };
  }

  async function borrarVersion() {
    var v = vSel(); if (!v) return;
    var txt0 = v.tipo === 'presupuesto' ? 'PRESUPUESTO' : 'BORRAR';
    var r = prompt('Se va a borrar «' + nomVersion(v) + '» con todos sus APU.\nEscribí ' + txt0 + ' para confirmar:');
    if (r == null) return;
    if (r.trim().toUpperCase() !== txt0) { alert('No coincide: no se borró nada.'); return; }
    try {
      await api().costoBorrar(v.version_id);
      toast('Versión borrada'); S.vid = null; S.cmp = '';
      await cargarVersiones(true); render();
    } catch (e) { alert(e.message || String(e)); }
  }

  /* ======================================================================
   * 5. EXPORTAR a la Plantilla de Costos (.xlsm) — costos_xlsm.js
   * ====================================================================== */
  async function guardarBase(f) {
    if (!/\.xlsm$/i.test(f.name)) { alert('Elegí la plantilla en formato .xlsm (con macros).'); return; }
    try {
      toast('Revisando la plantilla…');
      var ExcelJS = await cargarLib('ExcelJS', 'exceljs.min.js?v=4.4.0', 'ExcelJS');
      var wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer());
      if (!hoja(wb, 'Plantilla APU') || !hoja(wb, 'Presupuesto')) { alert('Ese archivo no tiene las hojas «Plantilla APU» y «Presupuesto»: no parece la Plantilla de Costos.'); return; }
      await api().plantillaCostosSubir(f);
      toast('Plantilla base guardada: se usa para exportar en todas las obras');
    } catch (e) { alert(e.message || String(e)); }
  }
  function pedirBase() {
    return new Promise(function (ok) {
      S._baseDestino = 'usar'; S._baseResolver = ok;
      alert('No hay una Plantilla de Costos base guardada' + (esAdmin() ? ' (se guarda con «⚙ Plantilla base»)' : '') +
            '.\n\nElegí ahora la plantilla .xlsm a usar para esta exportación.');
      $('#ctuFileBase').click();
    });
  }

  function dialogoExportar() {
    var v = vSel();
    var h = '<div class="ctu-ov" id="ctuOv"><div class="ctu-modal" style="max-width:640px"><div class="ctu-mh"><h3>Exportar a la Plantilla de Costos (.xlsm)<br><small class="ctu-mut">' +
      (v ? esc(nomVersion(v)) : 'Desde el cronograma (la obra todavía no tiene costos cargados)') + '</small></h3><button class="ctu-btn" id="ctuCerrar">✕</button></div><div class="ctu-mb">' +
      (v ? '<div class="ctu-form"><label>Cantidades del Presupuesto<select id="ctuExCant"><option value="vigente">Vigentes del cronograma</option><option value="archivo">Las de la versión</option></select></label></div>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:6px 0"><input type="checkbox" id="ctuExNuevos" checked> ' +
      '<span>Agregar los ítems del cronograma que todavía no tienen APU, con su hoja vacía para completar.</span></label>'
       : '<p style="font-size:13px">Van todos los ítems del cronograma que se ejecutan (sin títulos ni ítems padre con tramos), con su cantidad vigente, y una hoja APU por ítem.</p>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:6px 0"><input type="checkbox" id="ctuExIr" checked> ' +
      '<span>Precargar cada APU con el desglose de recursos que ya tiene la obra (el recosteo cargado antes, el mismo que usa Compras) y sus precios. Sin tildar, las hojas salen vacías.</span></label>') +
      '<p class="ctu-mut" style="font-size:12.5px;line-height:1.45">Se arma sobre la plantilla base: una hoja APU por ítem, los materiales in situ, los maestros con los precios de esta versión y el Presupuesto. ' +
      'Al abrirlo, Excel recalcula todo; las tablas de resumen y el dashboard se actualizan con sus macros. Se puede editar y volver a importar como recosteo.</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="ctu-btn" id="ctuNo">Cancelar</button><button class="ctu-btn pri" id="ctuSi">Exportar</button></div>' +
      '</div></div></div>';
    var w = document.createElement('div'); w.innerHTML = h; document.body.appendChild(w.firstChild);
    var cerrar = function () { var o = $('#ctuOv'); if (o) o.remove(); };
    $('#ctuCerrar').onclick = cerrar; $('#ctuNo').onclick = cerrar;
    $('#ctuSi').onclick = async function () {
      var bt = this, opc = v ? { cant: $('#ctuExCant').value, nuevos: $('#ctuExNuevos').checked }
                             : { desdeCron: true, ir: $('#ctuExIr').checked };
      bt.disabled = true; bt.textContent = 'Armando…';
      try { await exportar(opc); cerrar(); }
      catch (e) { bt.disabled = false; bt.textContent = 'Exportar'; alert(e.message || String(e)); }
    };
  }

  function datosExportar(d, opc) {
    var I = leer('ITEMS') || [], byIdC = leer('byId') || {}, va = leer('vaAlPlanSemanal');
    var posC = {}; I.forEach(function (i, k) { posC[i.id] = k; });
    var lin = function (it) {
      return (it.lineas || []).map(function (l) {
        return { bloque: l.bloque, orden: l.orden, recurso_id: l.recurso_id, rendimiento: l.rendimiento, personal: l.personal,
                 horas: l.horas, cuantia: l.cuantia, desperdicio: l.desperdicio, cantidad: l.cantidad };
      });
    };
    var cantDe = function (it) {
      if (opc.cant === 'vigente' && it.item_id && byIdC[it.item_id]) return cantVig(byIdC[it.item_id]);
      return it.cantidad;
    };
    var items = d.items.filter(function (i) { return !i.es_insitu; }).map(function (it) {
      return { clave: it.clave, item_id: it.item_id, descripcion: it.descripcion, um: it.um, cantidad: cantDe(it), igual_a: it.igual_a,
               prod_ph: it.prod_ph, lineas: lin(it), costo_directo: it.costo_directo, costo_adoptado: it.costo_adoptado,
               _k: it.item_id != null && posC[it.item_id] != null ? posC[it.item_id] : 1e6 + (it.orden || 0) };
    });
    if (opc.nuevos) {
      var ya = {}; items.forEach(function (i) { if (i.item_id) ya[i.item_id] = true; });
      I.forEach(function (i, k) {
        if (ya[i.id] || i.es_grupo || i.tipo === 'grupo') return;
        try { if (va && !va(i)) return; } catch (e) {}
        var q = cantVig(i); if (!(q > 0)) return;
        items.push({ clave: i.id, item_id: i.id, descripcion: i.desc || '', um: i.um || '', cantidad: q, igual_a: '', prod_ph: 1, lineas: [], _k: k, _nuevo: true });
      });
    }
    items.sort(function (a, b) { return a._k - b._k; });
    items.forEach(function (it, k) { it.orden = k + 1; });
    var insitu = d.items.filter(function (i) { return i.es_insitu; }).map(function (it) {
      return { codigo: String(it.clave).replace(/^IS:/, ''), descripcion: it.descripcion, um: it.um, prod_ph: it.prod_ph, lineas: lin(it) };
    });
    var nomObra = (($('#obraName') || {}).textContent || '').trim();
    if (!nomObra || nomObra === '—') { var sel = $('#obraSel'); nomObra = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].text : ''; }
    return { obra: nomObra, fecha: new Date(), items: items, insitu: insitu, precios: d.precios.slice(),
             nuevos: items.filter(function (i) { return i._nuevo; }).length };
  }

  // sin versiones: Presupuesto = ítems del cronograma; APU = desglose de item_recurso (si se pide)
  async function datosDesdeCronograma(opc) {
    var d = { items: [], precios: [] };
    var datos = datosExportar(d, { cant: 'vigente', nuevos: true });
    if (!opc.ir) return datos;
    var x = await api().costoDesgloseObra(obraId());
    var bloque = { 'equipos': 'equipo', 'mano de obra': 'mano_obra', 'materiales': 'material', 'transporte': 'transporte' };
    var porItem = {}, sinBloque = {};
    x.lineas.forEach(function (l) {
      if (l.recurso_padre) return;                     // componentes de un in situ: ya están en su hoja
      var b = bloque[String(l.tipo || '').trim().toLowerCase()];
      if (!b) { sinBloque[l.tipo || '—'] = true; return; }
      (porItem[normItem(l.item_id)] = porItem[normItem(l.item_id)] || []).push({ l: l, b: b });
    });
    datos.items.forEach(function (it) {
      var ls = porItem[normItem(it.clave)] || [], cont = {};
      it.lineas = ls.map(function (o) {
        var l = o.l, n = cont[o.b] = (cont[o.b] || 0) + 1, q = l.cant_unitaria;
        var r = { bloque: o.b, orden: n, recurso_id: l.recurso_id };
        if (o.b === 'equipo') r.horas = q;
        else if (o.b === 'mano_obra') { r.personal = 1; r.horas = q; }
        else { r.cuantia = q; r.desperdicio = null; }
        return r;
      });
    });
    var usados = {};
    datos.items.forEach(function (it) { it.lineas.forEach(function (l) { usados[String(l.recurso_id).toUpperCase()] = l.bloque; }); });
    var rec = {}; x.recursos.forEach(function (r) { rec[String(r.recurso_id).toUpperCase()] = r; });
    var pre = {}; x.precios.forEach(function (p) { pre[String(p.recurso_id).toUpperCase()] = p.precio_sin_iva; });
    var costoIr = {}; x.lineas.forEach(function (l) { if (l.costo_unitario != null && l.costo_unitario !== 0) costoIr[String(l.recurso_id).toUpperCase()] = l.costo_unitario; });
    Object.keys(usados).forEach(function (k) {
      var r = rec[k] || {}, b = usados[k];
      var precio = pre[k] != null ? pre[k] : (costoIr[k] != null ? costoIr[k] : null);
      var tipo = b === 'equipo' ? 'Equipos' : (b === 'mano_obra' ? 'Mano de obra' : (b === 'transporte' || /^transporte/i.test(r.tipo || '') ? 'Transporte' : 'Materiales'));
      var p = { recurso_id: r.recurso_id || k, tipo: tipo, nombre: r.nombre || '', um: r.um || '', detalle: r.modelo_equipo || '', clase: r.clase || '' };
      if (tipo === 'Transporte') p.precio_transporte = precio; else p.precio = precio;
      datos.precios.push(p);
    });
    var nConApu = datos.items.filter(function (i) { return i.lineas.length; }).length;
    datos.avisoPre = nConApu + ' de ' + datos.items.length + ' ítems con APU precargado desde el desglose de la obra' +
      (Object.keys(sinBloque).length ? ' (no se cargaron los renglones de tipo ' + Object.keys(sinBloque).join(', ') + ')' : '') + '.';
    return datos;
  }

  async function exportar(opc) {
    var datos;
    if (opc.desdeCron) datos = await datosDesdeCronograma(opc);
    else datos = datosExportar(await datosDe(S.vid), opc);
    var base = await api().plantillaCostosBajar();
    if (!base) { var f = await pedirBase(); if (!f) return; base = await f.arrayBuffer(); }
    var JSZip = await cargarLib('JSZip', 'jszip.min.js?v=3.10.1', 'JSZip');
    await cargarLib('CostosXLSM', 'costos_xlsm.js?v=20261007e', 'CostosXLSM');
    toast('Armando el archivo…');
    var r = await global.CostosXLSM.generar(JSZip, base, datos);
    var v = vSel();
    var nom = ('Costos ' + (datos.obra || obraId()) + ' - ' + (v ? v.nombre : 'desde cronograma') + '.xlsm').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
    var a = document.createElement('a'); a.href = URL.createObjectURL(r.archivo); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Exportado: <b>' + r.hojas + '</b> hojas APU' + (opc.desdeCron ? '' : (datos.nuevos ? ' (' + datos.nuevos + ' ítems nuevos para completar)' : '')));
    if (datos.avisoPre) r.avisos.unshift(datos.avisoPre);
    if (r.avisos.length) setTimeout(function () { alert('Para revisar en el archivo:\n\n• ' + r.avisos.join('\n• ')); }, 400);
  }

  /* ---------------------------------------------------------------- arranque */
  function enganchar() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'costos') render(); });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  }
  global.CostosView = { abrir: render, parsear: parsear, _normItem: normItem, recargar: function () { S.obra = null; return render(); } };
})(typeof window !== 'undefined' ? window : globalThis);
