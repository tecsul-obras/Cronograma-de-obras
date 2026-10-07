/* =========================================================================
 * costos_xlsm.js — Exportar costos a la Plantilla de Costos (.xlsm) · v20261007b
 *
 * Arma el archivo trabajando directo sobre el XML del libro (JSZip), para
 * conservar las macros (vbaProject.bin), las tablas dinámicas, el modelo de
 * datos y los formatos de la plantilla. Lo que hace:
 *   1. Saca las hojas APU de ítems que traiga la plantilla (las de otra obra).
 *   2. Crea una hoja APU por ítem, copiando «Plantilla APU», y le carga lo
 *      que se escribe a mano: códigos, rendimiento, personal y horas, P/H,
 *      cuantía y desperdicio. Todo lo demás lo calculan las fórmulas.
 *   3. Actualiza los materiales in situ (Base Granular, H25…) que existan.
 *   4. Maestros: escribe los precios de la versión (solo si cambian, para no
 *      pisar fórmulas) y agrega los recursos que falten.
 *   5. Presupuesto: N°, descripción, unidad, cantidad, «Es igual a» y las
 *      fórmulas a cada hoja (G66 costo directo, G71 precio).
 *   6. _Config: lista de hojas (APU / InSitu) para las macros.
 *   7. Marca el libro para recalcular todo al abrir y borra calcChain.
 * Funciona en el navegador y en node (se le pasa JSZip).
 * ========================================================================= */
(function (global) {
  'use strict';

  // ------------------------------------------------------------ utilidades XML
  function escXml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function colNum(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n; }
  function colLet(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function splitRef(ref) { var m = /^([A-Z]+)(\d+)$/.exec(ref); return { c: m[1], r: Number(m[2]) }; }
  function guid() {
    var h = '0123456789ABCDEF', s = '';
    for (var i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
    return '{' + s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20) + '}';
  }
  function esNumero(v) { return typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())); }

  // shared strings → array de textos
  function leerSST(xml) {
    var out = [];
    if (!xml) return out;
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var t = '', r2 = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, k;
      var sinFon = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
      while ((k = r2.exec(sinFon))) t += unesc(k[1]);
      out.push(t);
    }
    return out;
  }

  /* -------- hoja: acceso a celdas sobre el texto XML --------
     Las hojas de Excel tienen <row r="n"> ordenadas y <c r="A1"> ordenadas. */
  function Hoja(xml, sst) { this.xml = xml; this.sst = sst; }
  Hoja.prototype.celdaRe = function (ref) { return new RegExp('<c r="' + ref + '"(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)'); };
  Hoja.prototype.valor = function (ref) {
    var m = this.celdaRe(ref).exec(this.xml); if (!m) return null;
    var at = m[1] || '', body = m[2] || '';
    var t = (/\st="([^"]+)"/.exec(at) || [])[1];
    var v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
    if (t === 'inlineStr') { var it = /<is>([\s\S]*?)<\/is>/.exec(body); return it ? leerSST('<si>' + it[1] + '</si>')[0] : ''; }
    if (v == null) return null;
    if (t === 's') return this.sst[Number(v)];
    if (t === 'str' || t === 'e') return unesc(v);
    if (t === 'b') return v === '1';
    var n = Number(v); return isFinite(n) ? n : unesc(v);
  };
  Hoja.prototype.tieneFormula = function (ref) { var m = this.celdaRe(ref).exec(this.xml); return !!(m && /<f[\s>]/.test(m[2] || '')); };
  Hoja.prototype.estilo = function (ref) { var m = this.celdaRe(ref).exec(this.xml); return m ? ((/\ss="(\d+)"/.exec(m[1] || '') || [])[1] || null) : null; };
  function celdaXml(ref, s, v, formula) {
    var sa = s != null ? ' s="' + s + '"' : '';
    if (formula != null) {
      return '<c r="' + ref + '"' + sa + '><f>' + escXml(formula) + '</f></c>';
    }
    if (v === null || v === undefined || v === '') return '<c r="' + ref + '"' + sa + '/>';
    if (typeof v === 'number') return isFinite(v) ? '<c r="' + ref + '"' + sa + '><v>' + v + '</v></c>' : '<c r="' + ref + '"' + sa + '/>';
    return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(v) + '</t></is></c>';
  }
  // escribe una celda (valor o fórmula), conservando el estilo
  Hoja.prototype.poner = function (ref, v, formula, estilo) {
    var re = this.celdaRe(ref), m = re.exec(this.xml);
    if (m) {
      var s = estilo != null ? estilo : (/\ss="(\d+)"/.exec(m[1] || '') || [])[1];
      // si era maestra de una fórmula compartida, las dependientes quedarían huérfanas
      if (/<f[^>]*t="shared"[^>]*ref=/.test(m[2] || '')) this.desarmarCompartida(m[2]);
      this.xml = this.xml.slice(0, m.index) + celdaXml(ref, s, v, formula) + this.xml.slice(m.index + m[0].length);
      return;
    }
    var p = splitRef(ref), rowRe = new RegExp('<row r="' + p.r + '"[^>]*?(?:/>|>([\\s\\S]*?)</row>)'), rm = rowRe.exec(this.xml);
    var nueva = celdaXml(ref, estilo, v, formula);
    if (rm) {
      var fila = rm[0];
      if (/\/>$/.test(fila) && !/<\/row>$/.test(fila)) fila = fila.replace(/\/>$/, '></row>');
      var cells = fila.replace(/^<row[^>]*>/, '').replace(/<\/row>$/, '');
      var head = /^<row[^>]*>/.exec(fila)[0].replace(/\sspans="[^"]*"/, '');
      var trozos = cells.match(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
      var cn = colNum(p.c), ins = false, out = '';
      trozos.forEach(function (t) {
        var c = /<c r="([A-Z]+)\d+"/.exec(t)[1];
        if (!ins && colNum(c) > cn) { out += nueva; ins = true; }
        out += t;
      });
      if (!ins) out += nueva;
      this.xml = this.xml.slice(0, rm.index) + head + out + '</row>' + this.xml.slice(rm.index + rm[0].length);
      return;
    }
    // la fila no existe: se inserta en orden
    var sd = /<sheetData\s*\/>/.exec(this.xml);
    if (sd) { this.xml = this.xml.replace(/<sheetData\s*\/>/, '<sheetData><row r="' + p.r + '">' + nueva + '</row></sheetData>'); return; }
    var rows = /<row r="(\d+)"/g, mm, pos = -1;
    while ((mm = rows.exec(this.xml))) { if (Number(mm[1]) > p.r) { pos = mm.index; break; } }
    var txt = '<row r="' + p.r + '">' + nueva + '</row>';
    if (pos < 0) pos = this.xml.indexOf('</sheetData>');
    this.xml = this.xml.slice(0, pos) + txt + this.xml.slice(pos);
  };
  // pone el valor solo si cambia (así no se pierden fórmulas de la plantilla)
  Hoja.prototype.ponerSiCambia = function (ref, v) {
    var act = this.valor(ref);
    if (typeof v === 'number' && typeof act === 'number' && Math.abs(act - v) <= 1e-9 * Math.max(1, Math.abs(v))) return false;
    if ((v === null || v === undefined || v === '') && (act === null || act === '' || act === 0) && !this.tieneFormula(ref)) return false;
    if (typeof v === 'string' && String(act) === v) return false;
    this.poner(ref, v);
    return true;
  };
  // convierte en valores las celdas que dependen de una fórmula compartida maestra
  Hoja.prototype.desarmarCompartida = function (body) {
    var si = (/si="(\d+)"/.exec(body) || [])[1]; if (si == null) return;
    this.xml = this.xml.replace(new RegExp('<f t="shared" si="' + si + '"\\s*/>', 'g'), '');
  };
  Hoja.prototype.ultimaFila = function () {
    var re = /<row r="(\d+)"/g, m, u = 0; while ((m = re.exec(this.xml))) u = Math.max(u, Number(m[1])); return u;
  };
  Hoja.prototype.borrarFilasDesde = function (desde) {
    this.xml = this.xml.replace(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, function (t, r) { return Number(r) >= desde ? '' : t; });
  };

  /* ======================================================================
   * Generar
   * datos = { obra, fecha (Date), items:[{clave, orden, descripcion, um, cantidad, igual_a,
   *           prod_ph, lineas:[{bloque, recurso_id, rendimiento, personal, horas, cuantia, desperdicio}]}],
   *           insitu:[{codigo, descripcion, um, prod_ph, lineas}],
   *           precios:[{recurso_id, tipo, nombre, um, detalle, precio, dmt, factor_dmt, precio_transporte}] }
   * ====================================================================== */
  async function generar(JSZip, plantilla, datos) {
    var zip = await JSZip.loadAsync(plantilla);
    var avisos = [];
    var leer = async function (p) { var f = zip.file(p); return f ? f.async('string') : null; };
    var wb = await leer('xl/workbook.xml');
    var wbr = await leer('xl/_rels/workbook.xml.rels');
    var ct = await leer('[Content_Types].xml');
    var sst = leerSST(await leer('xl/sharedStrings.xml'));
    if (!wb || !wbr) throw new Error('El archivo no parece un libro de Excel.');

    // ---- hojas en orden
    var rels = {};
    (wbr.match(/<Relationship [^>]*>/g) || []).forEach(function (r) {
      var id = (/Id="([^"]+)"/.exec(r) || [])[1], t = (/Target="([^"]+)"/.exec(r) || [])[1];
      if (id) rels[id] = t;
    });
    var hojas = (wb.match(/<sheet [^>]*\/>/g) || []).map(function (tag) {
      var rid = (/r:id="([^"]+)"/.exec(tag) || [])[1], t = rels[rid] || '';
      var path = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      return { tag: tag, name: unesc((/name="([^"]*)"/.exec(tag) || [])[1]), sheetId: Number((/sheetId="(\d+)"/.exec(tag) || [])[1]), rid: rid, path: path };
    });
    var porNombre = function (n) { n = String(n).toLowerCase(); return hojas.find(function (h) { return h.name.toLowerCase() === n; }); };
    var plantillaApu = porNombre('Plantilla APU');
    if (!plantillaApu) throw new Error('La plantilla no tiene la hoja «Plantilla APU».');
    var presH = porNombre('Presupuesto');
    if (!presH) throw new Error('La plantilla no tiene la hoja «Presupuesto».');
    var xmlDe = {};
    for (var i = 0; i < hojas.length; i++) xmlDe[hojas[i].path] = await leer(hojas[i].path);

    // ---- configuración de bloques (_Config)
    var cfg = { eq: [10, 20], mo: [24, 37], mat: [43, 53], tr: [57, 64], prod: 'D39' };
    var hc = porNombre('_Config');
    if (hc) {
      var H0 = new Hoja(xmlDe[hc.path], sst);
      for (var r0 = 3; r0 <= 10; r0++) {
        var a = String(H0.valor('A' + r0) || '').toLowerCase(), b = H0.valor('B' + r0), c = H0.valor('C' + r0);
        if (/^equipos/.test(a) && b && c) cfg.eq = [b, c]; else if (/^mano de obra/.test(a) && b && c) cfg.mo = [b, c];
        else if (/^materiales/.test(a) && b && c) cfg.mat = [b, c]; else if (/^transporte/.test(a) && b && c) cfg.tr = [b, c];
        else if (/^producci/.test(a) && typeof b === 'string') cfg.prod = b;
      }
    }

    // ---- clasificar hojas APU
    var esApu = function (h) { var H = new Hoja(xmlDe[h.path], sst); return /^EQUIPOS/i.test(String(H.valor('B8') || '')) && /^MATERIALES/i.test(String(H.valor('B41') || '')); };
    var aBorrar = [], insituHoja = {};
    hojas.forEach(function (h) {
      if (h === plantillaApu || !esApu(h)) return;
      var H = new Hoja(xmlDe[h.path], sst), a2 = H.valor('A2'), i1 = H.valor('I1');
      if (typeof a2 === 'number' && a2 > 0) aBorrar.push(h);
      else if (i1 != null && i1 !== '' && i1 !== 0) insituHoja[String(i1).toUpperCase()] = h;
    });
    var nombresBorrados = aBorrar.map(function (h) { return h.name; });

    // ---- nuevas hojas de ítems (clonadas de Plantilla APU)
    var plantXml = xmlDe[plantillaApu.path];
    var usados = {};
    hojas.forEach(function (h) { if (aBorrar.indexOf(h) < 0) usados[h.name.toLowerCase()] = true; });
    function nombreHoja(base) {
      var n = String(base).replace(/[:\\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
      if (!n) n = 'Item';
      n = n.slice(0, 31).trim();
      var k = 2, out = n;
      while (usados[out.toLowerCase()]) { var suf = ' (' + k++ + ')'; out = n.slice(0, 31 - suf.length).trim() + suf; }
      usados[out.toLowerCase()] = true;
      return out;
    }
    var maxSheet = 0;
    zip.forEach(function (p) { var m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(p); if (m) maxSheet = Math.max(maxSheet, Number(m[1])); });
    var maxRid = 0; Object.keys(rels).forEach(function (k) { var m = /^rId(\d+)$/.exec(k); if (m) maxRid = Math.max(maxRid, Number(m[1])); });
    var maxSheetId = Math.max.apply(null, hojas.map(function (h) { return h.sheetId; }));

    /* Carga lo que se escribe a mano en un APU. Cada renglón va a su fila
       original (orden = posición dentro del bloque) si entra; si no, en orden.
       Equipos: si hay rendimiento va en J (I = 1/J); si no, las horas van
       directo en I, como en las hojas donde se cargaron así. */
    function cargarInsumos(H, it, limpiar) {
      var bl = { equipo: cfg.eq, mano_obra: cfg.mo, material: cfg.mat, transporte: cfg.tr };
      var put = limpiar ? function (ref, v) { H.ponerSiCambia(ref, v); } : function (ref, v) { H.poner(ref, v); };
      Object.keys(bl).forEach(function (k) {
        var ls = (it.lineas || []).filter(function (l) { return l.bloque === k; }).sort(function (x, y) { return (x.orden || 0) - (y.orden || 0); });
        var cap = bl[k][1] - bl[k][0] + 1;
        if (ls.length > cap) avisos.push((it.clave || it.codigo) + ': ' + ls.length + ' renglones de ' + k.replace('_', ' ') + ' y la hoja tiene lugar para ' + cap + '; se cargan los primeros.');
        var pos = {}, vistos = {}, porPos = ls.every(function (l) { var o = Number(l.orden); if (!(o >= 1 && o <= cap) || vistos[o]) return false; vistos[o] = true; return true; });
        ls.slice(0, cap).forEach(function (l, j) { pos[porPos ? Number(l.orden) - 1 : j] = l; });
        for (var j = 0; j < cap; j++) {
          var r = bl[k][0] + j, l = pos[j];
          if (!l) {
            if (!limpiar) continue;
            var a0 = H.valor('A' + r);
            if (a0 == null || a0 === '' || a0 === 0) continue;   // fila sin código: se deja como está
            put('A' + r, null);
            if (k === 'equipo') { if (!H.tieneFormula('I' + r)) put('I' + r, null); put('J' + r, null); }
            else { put('I' + r, null); put('J' + r, null); }
            continue;
          }
          put('A' + r, esNumero(l.recurso_id) ? Number(l.recurso_id) : String(l.recurso_id));
          if (k === 'equipo') {
            var hs = l.horas != null ? l.horas : l.cantidad;
            var porRend = l.rendimiento != null && l.rendimiento !== 0 && (hs == null || Math.abs(1 / l.rendimiento - hs) <= 1e-9 * Math.max(1, Math.abs(hs)));
            if (porRend) {
              if (!H.tieneFormula('I' + r)) H.poner('I' + r, null, 'IFERROR(1/J' + r + ',)');
              put('J' + r, l.rendimiento);
            } else { put('I' + r, hs != null ? hs : null); put('J' + r, l.rendimiento != null ? l.rendimiento : null); }
          } else if (k === 'mano_obra') { put('I' + r, l.personal); put('J' + r, l.horas); }
          else { put('I' + r, l.cuantia); put('J' + r, l.desperdicio || null); }
        }
      });
      var pp = it.prod_ph != null ? it.prod_ph : 1;
      put(cfg.prod, pp);
    }

    var nuevas = [];      // {name, path, rid, sheetId, xml}
    var hojaDeItem = {};  // clave → nombre de hoja
    function clonar(nombre) {
      var n = ++maxSheet, rid = 'rId' + (++maxRid), sid = ++maxSheetId;
      var x = plantXml
        .replace(/xr:uid="\{[0-9A-Fa-f-]+\}"/g, function () { return 'xr:uid="' + guid() + '"'; })
        .replace(/(<sheetPr[^>]*?)\scodeName="[^"]*"/, '$1')
        .replace(/\stabSelected="1"/g, '')
        .replace(/(<pageSetup[^>]*?)\sr:id="[^"]*"/, '$1')
        .replace(/<legacyDrawing[^>]*\/>|<drawing[^>]*\/>/g, '');
      return { name: nombre, path: 'xl/worksheets/sheet' + n + '.xml', rid: rid, sheetId: sid, hoja: new Hoja(x, sst) };
    }
    (datos.items || []).forEach(function (it) {
      if (it.igual_a && !(it.lineas && it.lineas.length)) return;   // usa el APU de otro ítem
      var h = clonar(nombreHoja(it.clave + ' ' + (it.descripcion || '')));
      h.hoja.poner('A2', Number(it.orden));
      cargarInsumos(h.hoja, it, false);
      hojaDeItem[it.clave] = h.name;
      nuevas.push(h);
    });

    // ---- in situ: actualizar los que existen; los que faltan se crean
    var hojaInsitu = {}, insituNuevos = [];
    (datos.insitu || []).forEach(function (is) {
      var h0 = insituHoja[String(is.codigo).toUpperCase()];
      if (h0) {
        var H = new Hoja(xmlDe[h0.path], sst);
        cargarInsumos(H, is, true);
        xmlDe[h0.path] = H.xml;
        hojaInsitu[is.codigo] = h0.name;
      } else {
        var h = clonar(nombreHoja(is.descripcion || ('In situ ' + is.codigo)));
        h.hoja.poner('A2', 0);
        h.hoja.poner('I1', esNumero(is.codigo) ? Number(is.codigo) : String(is.codigo));
        h.hoja.poner('C6', is.descripcion || '');
        h.hoja.poner('G6', is.um || '');
        cargarInsumos(h.hoja, is, false);
        hojaInsitu[is.codigo] = h.name;
        nuevas.push(h);
        insituNuevos.push({ codigo: is.codigo, descripcion: is.descripcion, um: is.um, hoja: h.name });
      }
    });

    // ---- in situ nuevos: se agregan a «Materiales in situ» con el precio de su hoja
    if (insituNuevos.length) {
      var hmi = porNombre('Materiales in situ');
      if (hmi) {
        var Hm = new Hoja(xmlDe[hmi.path], sst), fm = 3;
        for (var rm = Hm.ultimaFila(); rm >= 4; rm--) { var vm = Hm.valor('B' + rm); if (vm != null && vm !== '') { fm = rm; break; } }
        insituNuevos.forEach(function (n) {
          fm++;
          Hm.poner('B' + fm, esNumero(n.codigo) ? Number(n.codigo) : String(n.codigo)); Hm.poner('C' + fm, n.descripcion || '');
          Hm.poner('D' + fm, n.um || ''); Hm.poner('F' + fm, null, "+'" + n.hoja.replace(/'/g, "''") + "'!G66");
        });
        xmlDe[hmi.path] = Hm.xml;
        avisos.push('Materiales in situ nuevos (se crearon su hoja y su renglón en «Materiales in situ»): ' + insituNuevos.map(function (n) { return n.codigo; }).join(', ') +
          '. Si un ítem los usa como material, tienen que estar también en «Materiales».');
      }
    }

    // ---- maestros
    var prec = datos.precios || [];
    var porTipo = function (t) { return prec.filter(function (p) { return p.tipo === t; }); };
    function maestro(nombreH, colCod, filaIni, escribir, nuevo, lista) {
      var h = porNombre(nombreH); if (!h || !lista.length) return;
      var H = new Hoja(xmlDe[h.path], sst), ult = H.ultimaFila(), idx = {};
      for (var r = filaIni; r <= ult; r++) { var v = H.valor(colCod + r); if (v != null && v !== '') idx[String(v).trim().toUpperCase()] = r; }
      var fin = ult;
      // última fila con código (para agregar debajo)
      for (r = ult; r >= filaIni; r--) { var vv = H.valor(colCod + r); if (vv != null && vv !== '') { fin = r; break; } }
      var agregados = 0;
      lista.forEach(function (p) {
        var r = idx[String(p.recurso_id).toUpperCase()];
        if (r) escribir(H, r, p);
        else { r = ++fin; nuevo(H, r, p); agregados++; }
      });
      if (agregados) avisos.push(nombreH + ': se agregaron ' + agregados + ' recurso(s) que no estaban en la plantilla.');
      xmlDe[h.path] = H.xml;
    }
    var cod = function (p) { return esNumero(p.recurso_id) ? Number(p.recurso_id) : String(p.recurso_id); };
    maestro('Equipos', 'A', 5, function (H, r, p) { if (p.precio != null) H.ponerSiCambia('O' + r, p.precio); },
      function (H, r, p) { H.poner('A' + r, cod(p)); H.poner('B' + r, p.nombre || ''); H.poner('C' + r, p.detalle || ''); H.poner('O' + r, p.precio); H.poner('P' + r, p.um || 'h'); },
      porTipo('Equipos'));
    maestro('Mano de Obra', 'A', 3, function (H, r, p) { if (p.precio != null) H.ponerSiCambia('C' + r, p.precio); },
      function (H, r, p) { H.poner('A' + r, cod(p)); H.poner('B' + r, p.nombre || ''); H.poner('C' + r, p.precio); H.poner('D' + r, p.um || 'hs'); H.poner('E' + r, p.detalle || ''); },
      porTipo('Mano de obra'));
    maestro('Materiales', 'B', 4, function (H, r, p) {
        if (p.precio != null) H.ponerSiCambia('F' + r, p.precio);
        if (p.factor_dmt != null) H.ponerSiCambia('I' + r, p.factor_dmt);
        if (p.precio_transporte != null) H.ponerSiCambia('J' + r, p.precio_transporte);
      },
      function (H, r, p) {
        H.poner('A' + r, p.tipo === 'Transporte' ? 'Transporte' : (p.clase || '')); H.poner('B' + r, cod(p)); H.poner('C' + r, p.nombre || '');
        H.poner('D' + r, p.um || ''); H.poner('F' + r, p.precio); if (p.dmt != null) H.poner('H' + r, p.dmt);
        if (p.factor_dmt != null) H.poner('I' + r, p.factor_dmt); if (p.precio_transporte != null) H.poner('J' + r, p.precio_transporte);
      },
      prec.filter(function (p) { return (p.tipo === 'Materiales' || p.tipo === 'Transporte') && !insituHoja[String(p.recurso_id).toUpperCase()] && p.detalle !== 'in situ'; }));

    // ---- Presupuesto
    (function () {
      var H = new Hoja(xmlDe[presH.path], sst), cab = 0;
      for (var r = 1; r <= 40; r++) { if (/^ITEM/i.test(String(H.valor('B' + r) || '')) && /^DESCRIP/i.test(String(H.valor('C' + r) || ''))) { cab = r; break; } }
      if (!cab) throw new Error('En «Presupuesto» no encontré la fila de títulos (ITEM Nº / DESCRIPCIÓN).');
      var f0 = cab + 1, cols = 'ABCDEFGHIJKLMNOPQR'.split(''), st = {}, stT = {};
      cols.forEach(function (c) { st[c] = H.estilo(c + f0); });
      // fila de totales de la plantilla (para copiar estilos)
      var ult = H.ultimaFila(), filaTot = 0;
      for (r = f0; r <= ult; r++) if (/^totales?$/i.test(String(H.valor('C' + r) || '').trim())) { filaTot = r; break; }
      cols.forEach(function (c) { stT[c] = filaTot ? H.estilo(c + filaTot) : null; });
      var altoFila = (new RegExp('<row r="' + f0 + '"[^>]*?\\sht="([\\d.]+)"').exec(H.xml) || [])[1];
      H.borrarFilasDesde(f0);
      // quitar hipervínculos, celdas combinadas y validaciones de las filas borradas
      H.xml = H.xml.replace(/<hyperlink [^>]*ref="[A-Z]+(\d+)[^"]*"[^>]*\/>/g, function (t, rr) { return Number(rr) >= f0 ? '' : t; })
        .replace(/<hyperlinks>\s*<\/hyperlinks>/, '')
        .replace(/<mergeCell ref="[A-Z]+(\d+):[A-Z]+\d+"\/>/g, function (t, rr) { return Number(rr) >= f0 ? '' : t; });
      H.xml = H.xml.replace(/<mergeCells count="\d+">([\s\S]*?)<\/mergeCells>/, function (t, body) {
        var n = (body.match(/<mergeCell /g) || []).length; return n ? '<mergeCells count="' + n + '">' + body + '</mergeCells>' : '';
      });
      var its = datos.items || [], n = its.length, last = f0 + Math.max(n, 1) - 1, tot = last + 2;
      var filaDe = {}; its.forEach(function (it, k) { filaDe[String(it.clave).toLowerCase()] = f0 + k; });
      var filas = '';
      its.forEach(function (it, k) {
        var rr = f0 + k, cel = [];
        var hoja = hojaDeItem[it.clave];
        if (!hoja && it.igual_a) {
          var ref = its.find(function (x) { return String(x.clave).toLowerCase() === String(it.igual_a).toLowerCase(); });
          hoja = ref ? hojaDeItem[ref.clave] : null;
        }
        var q = function (nm) { return "'" + nm.replace(/'/g, "''") + "'"; };
        cel.push(celdaXml('A' + rr, st.A, Number(it.orden != null ? it.orden : k + 1)));
        cel.push(celdaXml('B' + rr, st.B, esNumero(it.clave) ? Number(it.clave) : String(it.clave)));
        cel.push(celdaXml('C' + rr, st.C, it.descripcion || ''));
        cel.push(celdaXml('D' + rr, st.D, it.um || ''));
        cel.push(celdaXml('E' + rr, st.E, it.cantidad != null ? Number(it.cantidad) : null));
        cel.push(celdaXml('F' + rr, st.F, it.igual_a ? (esNumero(it.igual_a) ? Number(it.igual_a) : it.igual_a) : null));
        cel.push(hoja ? celdaXml('G' + rr, st.G, null, q(hoja) + '!G66') : celdaXml('G' + rr, st.G, it.costo_directo != null ? it.costo_directo : null));
        cel.push(celdaXml('H' + rr, st.H, null, '+$E' + rr + '*G' + rr));
        cel.push(celdaXml('I' + rr, st.I, null, 'IFERROR(+H' + rr + '/$H$' + tot + ',0)'));
        cel.push(celdaXml('J' + rr, st.J, null));
        cel.push(hoja ? celdaXml('K' + rr, st.K, null, q(hoja) + '!G71') : celdaXml('K' + rr, st.K, it.costo_adoptado != null ? it.costo_adoptado : null));
        cel.push(celdaXml('L' + rr, st.L, null, '+$E' + rr + '*K' + rr));
        cel.push(celdaXml('M' + rr, st.M, null, 'IFERROR(+L' + rr + '/$L$' + tot + ',0)'));
        cel.push(celdaXml('N' + rr, st.N, null));
        cel.push(celdaXml('O' + rr, st.O, null));
        cel.push(celdaXml('P' + rr, st.P, null, 'ROUND(E' + rr + '*O' + rr + ',0)'));
        cel.push(celdaXml('Q' + rr, st.Q, null, 'IFERROR(+P' + rr + '/$P$' + tot + ',0)'));
        filas += '<row r="' + rr + '"' + (altoFila ? ' ht="' + altoFila + '" customHeight="1"' : '') + '>' + cel.join('') + '</row>';
      });
      filas += '<row r="' + tot + '">' +
        celdaXml('C' + tot, stT.C || st.C, 'Totales') +
        celdaXml('H' + tot, stT.H || st.H, null, 'SUM(H' + f0 + ':H' + last + ')') +
        celdaXml('L' + tot, stT.L || st.L, null, 'SUM(L' + f0 + ':L' + last + ')') +
        celdaXml('M' + tot, stT.M || st.M, null, 'SUM(M' + f0 + ':M' + last + ')') +
        celdaXml('P' + tot, stT.P || st.P, null, 'SUM(P' + f0 + ':P' + last + ')') + '</row>';
      H.xml = H.xml.replace('</sheetData>', filas + '</sheetData>');
      // rangos de formato condicional / validaciones que empezaban en la primera fila de datos
      var ajustar = function (t) { return t.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g, function (x, c1, r1, c2, r2) { return Number(r1) === f0 ? c1 + r1 + ':' + c2 + last : x; }); };
      H.xml = H.xml.replace(/sqref="([^"]*)"/g, function (t, v) { return 'sqref="' + ajustar(v) + '"'; })
        .replace(/<xm:sqref>([^<]*)<\/xm:sqref>/g, function (t, v) { return '<xm:sqref>' + ajustar(v) + '</xm:sqref>'; })
        .replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:Q' + tot + '"/>');
      if (datos.obra) H.poner('C2', datos.obra);
      if (datos.fecha instanceof Date) H.poner('C1', Math.round((Date.UTC(datos.fecha.getFullYear(), datos.fecha.getMonth(), datos.fecha.getDate()) - Date.UTC(1899, 11, 30)) / 86400000));
      xmlDe[presH.path] = H.xml;
      presH._ultimaFilaDatos = last; presH._f0 = f0; presH._cab = cab;
    })();
    // tablas (ListObject) del Presupuesto: que abarquen las filas nuevas
    var relPres = presH.path.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
    var rpx = await leer(relPres);
    if (rpx) {
      var tablas = (rpx.match(/Target="\.\.\/tables\/[^"]+"/g) || []).map(function (t) { return 'xl/tables/' + t.split('/').pop().replace('"', ''); });
      for (var ti = 0; ti < tablas.length; ti++) {
        var tx = await leer(tablas[ti]); if (!tx) continue;
        tx = tx.replace(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, function (t, c1, r1, c2, r2) {
          return Number(r1) === presH._cab ? 'ref="' + c1 + r1 + ':' + c2 + Math.max(presH._ultimaFilaDatos, presH._cab + 1) + '"' : t;
        });
        zip.file(tablas[ti], tx);
      }
    }

    // ---- _Config: lista de hojas para las macros
    if (hc) {
      var Hc = new Hoja(xmlDe[hc.path], sst);
      var conTipo = [];
      (datos.items || []).forEach(function (it) { if (hojaDeItem[it.clave]) conTipo.push([hojaDeItem[it.clave], 'APU']); });
      (datos.insitu || []).forEach(function (is) { if (hojaInsitu[is.codigo]) conTipo.push([hojaInsitu[is.codigo], 'InSitu']); });
      var ultC = Math.max(Hc.ultimaFila(), 3 + conTipo.length);
      for (var rc = 3; rc <= ultC; rc++) {
        var par = conTipo[rc - 3];
        if (par) { Hc.poner('E' + rc, par[0]); Hc.poner('F' + rc, par[1]); }
        else if (Hc.valor('E' + rc) != null || Hc.valor('F' + rc) != null) { Hc.poner('E' + rc, null); Hc.poner('F' + rc, null); }
      }
      xmlDe[hc.path] = Hc.xml;
    }

    // ---- quitar las hojas de ítems de la plantilla
    var ordenViejo = hojas.slice();
    var insertarEn = aBorrar.length ? ordenViejo.indexOf(aBorrar[0]) : ordenViejo.indexOf(plantillaApu) + 1;
    var finales = [];
    ordenViejo.forEach(function (h, k) {
      if (k === insertarEn) nuevas.forEach(function (nh) { finales.push({ nueva: nh }); });
      if (aBorrar.indexOf(h) < 0) finales.push({ vieja: h, idx: k });
    });
    if (insertarEn >= ordenViejo.length) nuevas.forEach(function (nh) { finales.push({ nueva: nh }); });
    var mapa = {}; finales.forEach(function (f, k) { if (f.vieja) mapa[f.idx] = k; });

    // referencias a hojas borradas en fórmulas de otras hojas → quedan como valor
    // (si una hoja nueva se llama igual que una borrada, la referencia sigue valiendo)
    var nombresNuevos = {}; nuevas.forEach(function (h) { nombresNuevos[h.name.toLowerCase()] = true; });
    nombresBorrados = nombresBorrados.filter(function (n) { return !nombresNuevos[n.toLowerCase()]; });
    var refBorrada = nombresBorrados.length ? new RegExp('(?:\'(?:' + nombresBorrados.map(function (n) { return reEsc(escXml(n).replace(/'/g, "''")); }).join('|') + ')\'|(?:' +
      nombresBorrados.filter(function (n) { return /^[A-Za-z_][\w.]*$/.test(n); }).map(reEsc).concat(['\u0000']).join('|') + '))!') : null;
    if (refBorrada) {
      Object.keys(xmlDe).forEach(function (p) {
        if (aBorrar.some(function (h) { return h.path === p; })) return;
        var x = xmlDe[p]; if (!x || !refBorrada.test(x)) return;
        var H = new Hoja(x, sst);
        H.xml = H.xml.replace(/<c r="([A-Z]+\d+)"([^>]*?)>([\s\S]*?)<\/c>/g, function (t, ref, at, body) {
          var fm = /<f[^>]*>([\s\S]*?)<\/f>|<f[^>]*\/>/.exec(body);
          if (!fm || !fm[1] || !refBorrada.test(unesc(fm[1])) && !refBorrada.test(fm[1])) return t;
          if (/t="shared"[^>]*ref=/.test(fm[0])) H.desarmarCompartida(fm[0]);
          return '<c r="' + ref + '"' + at + '>' + body.replace(fm[0], '') + '</c>';
        });
        H.xml = H.xml.replace(/<hyperlink [^>]*location="([^"]*)"[^>]*\/>/g, function (t, loc) { return refBorrada.test(loc) ? '' : t; })
          .replace(/<hyperlinks>\s*<\/hyperlinks>/, '');
        xmlDe[p] = H.xml;
      });
    }

    // ---- workbook.xml
    var sheetsXml = finales.map(function (f) {
      if (f.vieja) return f.vieja.tag;
      return '<sheet name="' + escXml(f.nueva.name) + '" sheetId="' + f.nueva.sheetId + '" r:id="' + f.nueva.rid + '"/>';
    }).join('');
    wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, '<sheets>' + sheetsXml + '</sheets>');
    wb = wb.replace(/<definedName ([^>]*)>([\s\S]*?)<\/definedName>/g, function (t, at, body) {
      var ls = (/localSheetId="(\d+)"/.exec(at) || [])[1];
      if (ls != null) {
        if (mapa[Number(ls)] == null) return '';
        at = at.replace(/localSheetId="\d+"/, 'localSheetId="' + mapa[Number(ls)] + '"');
      }
      if (refBorrada && refBorrada.test(unesc(body))) return '';
      return '<definedName ' + at + '>' + body + '</definedName>';
    });
    wb = wb.replace(/<definedNames>\s*<\/definedNames>/, '');
    wb = wb.replace(/(<workbookView[^>]*?)\sactiveTab="(\d+)"/, function (t, pre, n) { var v = mapa[Number(n)]; return pre + ' activeTab="' + (v != null ? v : mapa[ordenViejo.indexOf(presH)]) + '"'; })
      .replace(/(<workbookView[^>]*?)\sfirstSheet="(\d+)"/, function (t, pre, n) { var v = mapa[Number(n)]; return pre + ' firstSheet="' + (v != null ? v : 0) + '"'; });
    if (/<calcPr[^>]*\/>/.test(wb)) wb = wb.replace(/<calcPr([^>]*?)\s*\/>/, function (t, at) { return '<calcPr' + at.replace(/\sfullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>'; });
    else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');

    // ---- relaciones y tipos de contenido
    aBorrar.forEach(function (h) {
      wbr = wbr.replace(new RegExp('<Relationship [^>]*Id="' + h.rid + '"[^>]*/>'), '');
      ct = ct.replace(new RegExp('<Override PartName="/' + reEsc(h.path) + '"[^>]*/>'), '');
      zip.remove(h.path);
      var rp = h.path.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
      zip.remove(rp);
    });
    nuevas.forEach(function (h) {
      wbr = wbr.replace('</Relationships>', '<Relationship Id="' + h.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/' + h.path.split('/').pop() + '"/></Relationships>');
      ct = ct.replace('</Types>', '<Override PartName="/' + h.path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
      zip.file(h.path, h.hoja.xml);
    });
    // calcChain: se borra, Excel la rearma
    wbr = wbr.replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, '');
    ct = ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    zip.remove('xl/calcChain.xml');

    Object.keys(xmlDe).forEach(function (p) { if (zip.file(p) && !aBorrar.some(function (h) { return h.path === p; })) zip.file(p, xmlDe[p]); });
    zip.file('xl/workbook.xml', wb);
    zip.file('xl/_rels/workbook.xml.rels', wbr);
    zip.file('[Content_Types].xml', ct);

    // docProps/app.xml: lista de hojas (si está, se rehace la parte de hojas)
    var app = await leer('docProps/app.xml');
    if (app && /<TitlesOfParts>/.test(app)) {
      var nombres = finales.map(function (f) { return f.vieja ? f.vieja.name : f.nueva.name; });
      app = app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Hojas de cálculo</vt:lpstr></vt:variant><vt:variant><vt:i4>' + nombres.length + '</vt:i4></vt:variant></vt:vector></HeadingPairs>')
        .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, '<TitlesOfParts><vt:vector size="' + nombres.length + '" baseType="lpstr">' + nombres.map(function (n) { return '<vt:lpstr>' + escXml(n) + '</vt:lpstr>'; }).join('') + '</vt:vector></TitlesOfParts>');
      zip.file('docProps/app.xml', app);
    }

    var tipo = typeof Blob !== 'undefined' && typeof window !== 'undefined' ? 'blob' : 'nodebuffer';
    var out = await zip.generateAsync({ type: tipo, compression: 'DEFLATE', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
    return { archivo: out, avisos: avisos, hojas: nuevas.length, borradas: aBorrar.map(function (h) { return h.name; }) };
  }

  global.CostosXLSM = { generar: generar };
})(typeof window !== 'undefined' ? window : globalThis);
