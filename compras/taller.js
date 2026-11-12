/* =========================================================================
 * compras/taller.js — COMPRAS DE TALLER · v20261112d  (SQL 79 · histórico SQL 85/86 · UCC SQL 110 · envío SQL 111)
 *  v20261112d (SQL 111): sin paso «Preparado en bodega» (se envía directo lo que hay
 *    en central); el envío lleva tipo y número de documento; desde stock se puede
 *    atender con menos de lo pedido y «Cerrar con lo entregado» (con motivo).
 *  v20261112c: el mismo módulo arma dos secciones (fábrica por canal):
 *    TallerCompras = canal «taller» (TAL-, pasa por bodega central) y
 *    ComprasUCC    = canal «ucc» (UCC-, ⭐ Estratégicas UCC: pedidos especiales
 *    que el taller manda directo a Compras, sin bodega; compras puede pedir
 *    aclaración, rechazar o reabrir). Ver esquema/110_compras_estrategicas_ucc.sql.
 *  v20261109a: cotización sin campo Flete (no se usa; las viejas con flete
 *  lo conservan y se siguen mostrando) y con archivos adjuntos (PDF o foto)
 *  vinculados a la cotización (tc_adjunto.ref_id = id de la cotización).
 *  v20261109b: en la tabla de cotizaciones, quién cotizó y la fecha van debajo
 *  del proveedor (no se enciman) y la columna Proveedor es más ancha.
 *
 *  Sección «Taller» del módulo Compras. Pedidos de repuestos y servicios de
 *  las obras al taller central con un mismo número TAL-000001 de punta a punta:
 *
 *    Solicitud → Bodega central (stock / comprar / aclaración / rechazo)
 *      · stock: enviar (con documento) → la obra confirma (sin cotizar ni comprar)
 *      · comprar: cotizaciones → pedir autorización → autorizar o devolver →
 *        registrar compra (OC / factura / comprobante, caja chica sí/no) →
 *        entrega por central, directa a la obra o mixta, con parciales.
 *
 *  Todo lo decide la base (funciones tc_*): permisos, saldos, versión del
 *  pedido (si otro lo cambió, avisa) y clave de operación (reintentar no
 *  duplica). Esconder un botón acá no es el permiso: es comodidad.
 *  La etapa no se guarda: la calcula la base (fase). Fotos y PDF en el bucket
 *  privado taller_compras con URLs firmadas.
 *
 *  Estilos con prefijo .tc- (no toca los de Compras de obras).
 *  Uso: TallerCompras.abrir(elemento)
 * ========================================================================= */
(function (global) {
  'use strict';

  function fabrica(CANAL) {
  var UCC = CANAL === 'ucc';
  var BUCKET = 'taller_compras';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var EL = null, YO = null, CAT = { obras: [], equipos: [], proveedores: [] };
  var TAB = 'pedidos', LIST = null, CARGANDO = false, genL = 0;
  var FIL = { fase: 'activos', obra: '', q: '', mios: false };
  var KPI = null, KPI_DESDE = '', PERM = null, PERM_TXT = '';
  var DET = null, DTAB = 'resumen';
  var HIST = null, HFIL = { archivo: '', q: '' }, genH = 0;   // histórico de Monday (SQL 85)
  var URLS = {};            // ruta → url firmada (1 h)

  var FASES = [
    ['bodega', 'Bodega', 'am'], ['aclaracion', 'Aclaración', 'am'], ['cotizacion', 'Cotización', 'az'], ['autorizacion', 'Autorización', 'am'],
    ['compra', 'Registrar compra', 'az'], ['entrega', 'Entrega', 'az'], ['cerrado', 'Cerrado', 'ok'],
    ['rechazado', 'Rechazado', 'mal'], ['anulado', 'Anulado', 'gr']
  ];
  var NFASE = {}; FASES.forEach(function (f) { NFASE[f[0]] = f; });
  var BANDEJA_FASES = UCC ? {
    pedidos: ['aclaracion', 'cotizacion', 'autorizacion', 'compra', 'entrega', 'cerrado', 'rechazado', 'anulado'],
    compras: ['cotizacion', 'autorizacion', 'compra'], entregas: ['entrega']
  } : {
    pedidos: ['bodega', 'cotizacion', 'autorizacion', 'compra', 'entrega', 'cerrado', 'rechazado', 'anulado'],
    bodega: ['bodega'], compras: ['cotizacion', 'autorizacion', 'compra'], entregas: ['entrega']
  };
  var ABIERTAS = ['bodega', 'aclaracion', 'cotizacion', 'autorizacion', 'compra', 'entrega'];
  var LS_TAB = UCC ? 'ucc_tab' : 'tc_tab';
  var SIN_SQL110 = false;
  var DOCS_ENVIO = [['nota_remision', 'Nota de remisión'], ['remito', 'Remito'], ['vale_salida', 'Vale de salida'], ['factura', 'Factura'], ['otro', 'Otro']];
  function docTxt(x) { if (!x || !x.doc_numero) return ''; var d = DOCS_ENVIO.filter(function (k) { return k[0] === x.doc_tipo; })[0]; return (d ? d[1] : 'Doc.') + ' ' + x.doc_numero; }
  var UNIDADES = ['un', 'kit', 'juego', 'par', 'lt', 'gl', 'kg', 'm', 'rollo', 'caja', 'servicio'];
  var MOV = {
    central: 'Recepción en taller central', prepara: 'Preparado en bodega (paso anterior)', envio: 'Envío a obra',
    recepcion: 'Recepción en obra', directa: 'Recepción directa en obra', servicio: 'Conformidad del servicio'
  };

  // ------------------------------------------------------------ utilidades
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fq(v) { return n(v).toLocaleString('es-PY', { maximumFractionDigits: 4 }); }
  function fm(v, mon) { if (v === null || v === undefined || v === '') return '–'; return (mon === 'USD' ? 'US$ ' : '₲ ') + n(v).toLocaleString('es-PY', { maximumFractionDigits: mon === 'USD' ? 2 : 0 }); }
  function fd(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : s; }
  function fdt(s) { if (!s) return ''; var d = new Date(s); return isNaN(d) ? s : d.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  // números como se escriben acá: 1.500.000 · 2,5 · 100000
  function parseNum(v) {
    var s = String(v == null ? '' : v).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var x = Number(s); return isFinite(x) ? x : NaN;
  }
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function sb() { return global.ObraAPI && global.ObraAPI._sb && global.ObraAPI._sb(); }
  function puede(c) { return !!(YO && YO[c]); }
  function puedeObra(obra) { return puede('solicitar') && (YO.sol_todas || (YO.sol_obras || []).indexOf(obra) >= 0); }
  function chip(txt, cls, tit) { return '<span class="tc-chip ' + (cls || '') + '"' + (tit ? ' title="' + esc(tit) + '"' : '') + '>' + txt + '</span>'; }
  function chipFase(f) { var x = NFASE[f] || [f, f, '']; return chip(x[1], x[2]); }
  function atrasado(p) { return p.fecha_requerida && p.fecha_requerida < hoy() && ['cerrado', 'rechazado', 'anulado'].indexOf(p.fase) < 0; }

  async function rpc(fn, args) {
    var r = await sb().rpc(fn, args || {});
    if (r.error) {
      var e = new Error(r.error.message || 'Error');
      e.code = r.error.code;
      if (/auth_required|JWT/i.test(e.message)) e.message = 'La sesión venció. Volvé a entrar.';
      if (/Could not find the function|does not exist/i.test(e.message)) e.message = 'Falta correr SQL 79 (Compras de taller) en la base.';
      if (/supera lo preparado|tienen? que haber al menos|Acción desconocida: (cerrar_parcial|cierre_deshacer)/i.test(e.message)) e.message = 'Falta correr el SQL 111 (envío directo, documento y cierre con lo entregado) en la base.';
      throw e;
    }
    return r.data;
  }

  // Saldos de un pedido (mismas reglas que la base)
  function saldos(p) {
    var q = p.q || {}, Q = n(p.cantidad), c = n(q.c), d = n(q.d), pr = n(q.p), e = n(q.e), r = n(q.r), s = n(q.s);
    var stock = p.estado === 'stock', serv = p.tipo === 'servicio', base = stock ? Q : c;
    return {
      Q: Q, c: c, d: d, p: pr, e: e, r: r, s: s, stock: stock, serv: serv,
      provPend: stock || serv ? 0 : Math.max(0, Q - c - d),
      enCentral: Math.max(0, base - e),
      transito: Math.max(0, e - r), enObra: r + d + s, pendFinal: Math.max(0, Q - r - d - s),
      max: { central: Q - c - d, directa: Q - c - d, envio: base - e, recepcion: e - r, servicio: Q - s }
    };
  }
  // Qué movimientos se pueden registrar ahora y quién
  function movsPosibles(p) {
    var S = saldos(p), L = [];
    var bod = puede('bodega'), obra = puedeObra(p.obra_clave);
    if (p.estado === 'stock') {
      if (bod) L.push('envio');
      if (obra) L.push('recepcion');
    } else if (p.estado === 'compra' && p.comprado) {
      if (S.serv) { if (obra) L.push('servicio'); }
      else {
        if (bod && p.ruta !== 'directa') L.push('central', 'envio');
        if (obra && p.ruta !== 'central') L.push('directa');
        if (obra && p.ruta !== 'directa') L.push('recepcion');
      }
    }
    return L.filter(function (t) { return S.max[t] > 0; });
  }

  // ------------------------------------------------------------ estilos
  function estilos() {
    if ($('#tcCss')) return;
    var st = document.createElement('style'); st.id = 'tcCss';
    st.textContent = [
      '#v-taller,#v-ucc{min-height:calc(100vh - 54px);background:#f4f6f9}',
      '.tc-wrap{padding:14px 18px 40px;max-width:1800px;margin:0 auto;color:#1f2937}',
      '.tc-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.tc-bar .grow{flex:1}',
      '.tc-bar input,.tc-bar select{font:inherit;font-size:calc(13px*var(--fs,1));padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937}',
      '.tc-seg{display:flex;border:1px solid #c9d1dc;border-radius:9px;overflow:auto;background:#fff;max-width:100%}',
      '.tc-seg button{padding:8px 14px;font-size:calc(13px*var(--fs,1));font-weight:700;color:#4a5568;background:none;border:0;cursor:pointer;white-space:nowrap}',
      '.tc-seg button.on{background:#1a2744;color:#fff}',
      '.tc-seg button b{background:#e8640a;color:#fff;border-radius:9px;padding:0 6px;margin-left:5px;font-size:calc(11px*var(--fs,1))}',
      '.tc-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:8px;padding:8px 12px;font-size:calc(13px*var(--fs,1));font-weight:600;cursor:pointer;white-space:nowrap}',
      '.tc-btn:hover{background:#f4f7fb}.tc-btn:disabled{opacity:.5;cursor:default}',
      '.tc-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}.tc-btn.ok{background:#e3f6ea;border-color:#9ed0ae;color:#1e7a43}',
      '.tc-btn.mal{color:#b03a2e;border-color:#efb7b0}.tc-btn.am{background:#fff4e0;border-color:#f1cf8f;color:#8a5800}',
      '.tc-colas{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px}',
      '.tc-colas button{border:1px solid #c9d1dc;background:#fff;border-radius:18px;padding:6px 12px;font-size:calc(13px*var(--fs,1));font-weight:600;cursor:pointer;color:#1f2937}',
      '.tc-colas button b{background:#eef2f7;border-radius:10px;padding:0 7px;margin-left:4px}',
      '.tc-colas button.on{background:#1a2744;color:#fff;border-color:#1a2744}.tc-colas button.on b{background:#e8640a;color:#fff}',
      '.tc-tw{overflow:auto;border:1px solid #d0d6e0;border-radius:10px;background:#fff;max-height:calc(100vh - 270px)}',
      '.tc-t{width:100%;border-collapse:collapse;font-size:calc(12.5px*var(--fs,1));min-width:1250px}',
      '.tc-t th{position:sticky;top:0;background:#f0f2f5;font-size:calc(10.5px*var(--fs,1));text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0;z-index:1;white-space:nowrap}',
      '.tc-t td{padding:5px 6px;border-bottom:1px solid #eef0f4;vertical-align:top}',
      '.tc-t td.r,.tc-t th.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.tc-t td small{color:#7a8699;display:block}',
      '.tc-t tr.cl{cursor:pointer}.tc-t tr.cl:hover td{background:#f7f9fc}',
      '.tc-t tr.urg td:first-child{box-shadow:inset 3px 0 0 #c0392b}.tc-t tr.alta td:first-child{box-shadow:inset 3px 0 0 #e8640a}',
      '.tc-chip{display:inline-block;font-size:calc(11px*var(--fs,1));font-weight:700;padding:2px 8px;border-radius:10px;background:#eef2f7;color:#4a5568;white-space:nowrap}',
      '.tc-chip.ok{background:#e3f6ea;color:#1e7a43}.tc-chip.mal{background:#fdecea;color:#b03a2e}.tc-chip.am{background:#fff4e0;color:#9a6200}.tc-chip.az{background:#e6eefb;color:#2c4a8a}.tc-chip.gr{background:#eceff3;color:#6b7487}',
      '.tc-bar-prog{display:inline-block;width:70px;height:6px;border-radius:3px;background:#e4e8ef;vertical-align:middle;margin-right:6px;overflow:hidden}',
      '.tc-bar-prog i{display:block;height:100%;background:#2d8a4e}',
      '.tc-vacio{padding:30px;text-align:center;color:#4a5568;background:#fff;border:1px solid #d0d6e0;border-radius:10px}',
      '.tc-info{font-size:calc(12.5px*var(--fs,1));color:#4a5568;background:#eef3fa;border-radius:8px;padding:8px 10px;margin-bottom:10px}',
      '.tc-warn{color:#9a6200}.tc-neg{color:#b03a2e;font-weight:700}',
      /* modal */
      '.tc-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto}',
      '.tc-box{background:#fff;border-radius:12px;max-width:1040px;width:100%;padding:16px 20px 20px;color:#1f2937}',
      '.tc-box.chico{max-width:640px}',
      '.tc-box h3{margin:0;color:#1a2744;font-size:calc(18px*var(--fs,1))}.tc-box .sub{font-size:calc(12.5px*var(--fs,1));color:#4a5568;margin:2px 0 10px}',
      '.tc-hd{display:flex;gap:10px;align-items:flex-start}.tc-hd .t{flex:1;min-width:0}',
      '.tc-x{border:0;background:#eef2f7;border-radius:8px;width:36px;height:36px;font-size:18px;cursor:pointer}',
      '.tc-sec{border:1px solid #e1e6ee;border-radius:10px;padding:10px 12px;margin-bottom:10px}',
      '.tc-sec>h4{margin:0 0 8px;font-size:calc(12px*var(--fs,1));text-transform:uppercase;letter-spacing:.4px;color:#2c4a8a}',
      '.tc-sec.sigue{border-color:#f1cf8f;background:#fffaf0}.tc-sec.sigue>h4{color:#9a6200}',
      '.tc-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px}',
      '.tc-g .w2{grid-column:span 2}.tc-g .w4{grid-column:1/-1}',
      '.tc-f{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.tc-f label{font-size:calc(11px*var(--fs,1));font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}',
      '.tc-f input,.tc-f select,.tc-f textarea{font:inherit;font-size:calc(14px*var(--fs,1));padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937;width:100%;box-sizing:border-box}',
      '.tc-f textarea{min-height:58px;resize:vertical}',
      '.tc-f input:focus,.tc-f select:focus,.tc-f textarea:focus{outline:2px solid #e8640a;border-color:#e8640a}',
      '.tc-f .v{font-size:calc(14px*var(--fs,1));padding:2px 0}',
      '.tc-acc{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px}',
      '.tc-dt{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #e1e6ee;margin:6px 0 12px}',
      '.tc-dt button{border:0;background:none;padding:8px 12px;font-weight:700;color:#4a5568;cursor:pointer;border-bottom:3px solid transparent;font-size:calc(13px*var(--fs,1))}',
      '.tc-dt button.on{color:#1a2744;border-bottom-color:#e8640a}',
      '.tc-saldos{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}',
      '.tc-saldo{background:#f6f8fb;border-radius:8px;padding:6px 9px}.tc-saldo span{display:block;font-size:calc(10.5px*var(--fs,1));color:#6b7487;text-transform:uppercase}.tc-saldo b{font-size:calc(17px*var(--fs,1));font-variant-numeric:tabular-nums}',
      '.tc-saldo.hl{background:#e3f6ea}.tc-saldo.wa{background:#fff4e0}',
      '.tc-ev{border-left:3px solid #d0d6e0;padding:2px 0 8px 10px;margin-left:4px}.tc-ev b{display:block;font-size:calc(13px*var(--fs,1))}.tc-ev small{color:#6b7487}',
      '.tc-ev .d{font-size:calc(12.5px*var(--fs,1));color:#374151}',
      '.tc-fotos{display:flex;gap:8px;flex-wrap:wrap}',
      '.tc-foto{width:110px;border:1px solid #d0d6e0;border-radius:8px;overflow:hidden;background:#f6f8fb;font-size:calc(11px*var(--fs,1));position:relative}',
      '.tc-foto .im{height:84px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:#e9edf3;color:#4a5568;font-size:24px}',
      '.tc-foto img{width:100%;height:84px;object-fit:cover;display:block}',
      '.tc-foto .nm{padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tc-foto button{position:absolute;top:3px;right:3px;border:0;border-radius:6px;background:rgba(255,255,255,.9);color:#b03a2e;cursor:pointer;font-size:12px}',
      '.tc-adj{border:1.5px dashed #c3ccd9;border-radius:10px;padding:10px;background:#f8fafc;margin-top:10px}.tc-adj.sobre{border-color:#2f4b8a;background:#eef3fb}',
      '.tc-adj .lst{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.tc-adj .ar{display:inline-flex;align-items:center;gap:6px;border:1px solid #d0d6e0;border-radius:8px;background:#fff;padding:4px 8px;font-size:calc(12px*var(--fs,1));max-width:100%}',
      '.tc-adj .ar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}.tc-adj .ar span.lk{cursor:pointer;color:#2f4b8a;text-decoration:underline}.tc-adj .ar button{border:0;background:none;color:#b03a2e;cursor:pointer;font-size:13px;padding:0}',
      '.tc-adj .ay{font-size:calc(11.5px*var(--fs,1));color:#6b7487;margin-left:6px}.tc-clip{border:1px solid #d0d6e0;background:#fff;border-radius:6px;padding:1px 6px;cursor:pointer;font-size:calc(11.5px*var(--fs,1));margin-left:4px;white-space:nowrap}',
      '.tc-radio{display:flex;gap:14px;align-items:center;padding:6px 0}.tc-radio label{font-size:calc(14px*var(--fs,1));text-transform:none;letter-spacing:0;font-weight:600;display:flex;gap:6px;align-items:center}',
      '.tc-cot{width:100%;border-collapse:collapse;font-size:calc(13px*var(--fs,1))}',
      '.tc-cot th{font-size:calc(10.5px*var(--fs,1));text-transform:uppercase;color:#6b7487;text-align:left;padding:4px 6px;border-bottom:1px solid #e1e6ee}',
      '.tc-cot td{padding:6px;border-bottom:1px solid #f0f2f5;vertical-align:top}.tc-cot td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.tc-cot tr.anul td{color:#9aa3b2;text-decoration:line-through}.tc-cot tr.elegida td{background:#fffaf0}',
      '.tc-cot td small{display:block;color:#7a8699;font-size:calc(11.5px*var(--fs,1));margin-top:2px}.tc-cot td.prov{min-width:220px;max-width:340px;white-space:normal;overflow-wrap:anywhere}',
      '.tc-mini{border:1px solid #d0d6e0;background:#fff;border-radius:6px;padding:2px 8px;font-size:calc(12px*var(--fs,1));cursor:pointer}',
      '.tc-mini.mal{color:#b03a2e}',
      '.tc-kst{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:12px}',
      '.tc-kc{background:#fff;border:1px solid #d0d6e0;border-top:4px solid #2c4a8a;border-radius:10px;padding:10px 12px}',
      '.tc-kc .t{font-size:calc(11px*var(--fs,1));font-weight:700;color:#4a5568;text-transform:uppercase}.tc-kc .big{font-size:calc(28px*var(--fs,1));color:#1a2744;font-variant-numeric:tabular-nums}.tc-kc .lbl{font-size:calc(12px*var(--fs,1));color:#7a8699}',
      '.tc-perm td{vertical-align:middle}.tc-perm input[type=checkbox]{width:18px;height:18px}',
      '.tc-perm select{font:inherit;font-size:calc(12px*var(--fs,1));max-width:260px}',
      'body.mobile .tc-wrap{padding:10px 10px 80px}',
      'body.mobile .tc-g{grid-template-columns:1fr 1fr}',
      'body.mobile .tc-modal{padding:0}body.mobile .tc-box{border-radius:0;min-height:100%}',
      '@media (max-width:600px){.tc-g{grid-template-columns:1fr}.tc-g .w2{grid-column:auto}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------ arranque
  async function abrir(el) {
    EL = el; estilos();
    EL.innerHTML = '<div class="tc-wrap"><div class="tc-vacio">Cargando ' + (UCC ? 'Compras estratégicas UCC' : 'Compras de taller') + '…</div></div>';
    try {
      var d = await rpc('tc_inicio');
      YO = d.yo || {};
      CAT.obras = d.obras || []; CAT.equipos = d.equipos || []; CAT.proveedores = d.proveedores || [];
    } catch (e) {
      EL.innerHTML = '<div class="tc-wrap"><div class="tc-vacio">' + esc(e.message) + '<br><br><a href="">Reintentar</a></div></div>';
      return;
    }
    if (!YO.ver) {
      EL.innerHTML = '<div class="tc-wrap"><div class="tc-vacio">Tu usuario no tiene acceso a Compras de taller.<br>' +
        'Lo usan el personal de taller, los administradores de obra (sus obras), bodega central, compras y los autorizadores.<br>' +
        'Un administrador te puede dar permiso en <b>Taller › Permisos</b>.</div></div>';
      return;
    }
    if (UCC) {
      // sin el SQL 110 la base ignora el canal: cargaría pedidos TAL que pasan por bodega
      var chk = await sb().from('tc_pedido').select('canal').limit(1);
      SIN_SQL110 = !!(chk.error && /canal/i.test(chk.error.message || ''));
      if (SIN_SQL110) {
        EL.innerHTML = '<div class="tc-wrap"><div class="tc-vacio">Falta correr el <b>SQL 110</b> (Compras estratégicas UCC) en la base.<br>' +
          'Mientras tanto los pedidos de taller siguen en <b>🔧 Taller</b>.</div></div>';
        return;
      }
    }
    try { var t = localStorage.getItem(LS_TAB); if (t) TAB = t; } catch (e) {}
    if (!BANDEJA_FASES[TAB] && ['proveedores', 'kpis', 'permisos', 'historico'].indexOf(TAB) < 0) TAB = 'pedidos';
    if (UCC && (TAB === 'permisos' || TAB === 'historico')) TAB = 'pedidos';
    if (TAB === 'permisos' && !puede('super')) TAB = 'pedidos';
    if (TAB === 'historico') { if (puede('ver_todas')) cargarHist(); else TAB = 'pedidos'; }
    if (!global.__tcTeclas) {
      global.__tcTeclas = true;
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var m = $$('.tc-modal'); if (m.length) m[m.length - 1].remove(); } });
    }
    cargarLista();
  }

  function esBandeja() { return !!BANDEJA_FASES[TAB]; }
  async function cargarLista() {
    if (!esBandeja()) { render(); return; }
    var g = ++genL; CARGANDO = true; render();
    try {
      var r = await rpc('tc_listar', { p: { canal: CANAL, bandeja: TAB, fase: FIL.fase === 'activos' && TAB !== 'pedidos' ? null : FIL.fase, obra: FIL.obra || null, q: FIL.q || null, mios: FIL.mios, limite: 400 } });
      if (g !== genL) return;
      LIST = r;
    } catch (e) { if (g === genL) { LIST = { error: e.message }; } }
    CARGANDO = false;
    if (g === genL) render();
  }

  // ------------------------------------------------------------ pantalla
  function render() {
    if (!EL) return;
    var ae = document.activeElement, aeId = ae && ae.id && EL.contains(ae) ? ae.id : null, s0 = null;
    try { s0 = ae.selectionStart; } catch (e) {}
    var tabs = UCC ? [['pedidos', '⭐ Pedidos estratégicos'], ['compras', '🛒 Compras'], ['entregas', '🚚 Entregas'], ['proveedores', 'Proveedores'], ['kpis', '📊 KPIs']] :
      [['pedidos', '🗂 Pedidos de taller'], ['bodega', '📦 Bodega central'], ['compras', '🛒 Compras'], ['entregas', '🚚 Entregas'],
      ['proveedores', 'Proveedores'], ['kpis', '📊 KPIs']];
    if (!UCC && puede('ver_todas')) tabs.push(['historico', '🕘 Histórico Monday']);
    if (!UCC && puede('super')) tabs.push(['permisos', '🔑 Permisos']);
    var cnt = LIST && LIST.conteos ? LIST.conteos : null;
    var h = '<div class="tc-wrap"><div class="tc-bar"><div class="tc-seg">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '" class="' + (TAB === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
    }).join('') + '</div><span class="grow"></span>';
    if (esBandeja()) {
      h += '<button class="tc-btn" id="tcRec">⟳ Actualizar</button><button class="tc-btn" id="tcXls">⬇ Excel</button>' +
        (puede('solicitar') ? '<button class="tc-btn pri" id="tcNuevo">＋ Nuevo pedido</button>' : '');
    } else if (TAB === 'proveedores' && puede('compras')) h += '<button class="tc-btn pri" id="tcProvNuevo">＋ Proveedor</button>';
    else if (TAB === 'historico') h += '<button class="tc-btn" id="tcHRec">⟳ Actualizar</button>';
    h += '</div>';
    if (esBandeja()) h += htmlBandeja(cnt);
    else if (TAB === 'historico') h += htmlHist();
    else if (TAB === 'proveedores') h += htmlProveedores();
    else if (TAB === 'kpis') h += htmlKpis();
    else if (TAB === 'permisos') h += htmlPermisos();
    EL.innerHTML = h + '</div>';
    if (aeId) { var e2 = EL.querySelector('#' + aeId); if (e2) { e2.focus(); try { if (s0 !== null) e2.setSelectionRange(s0, s0); } catch (e) {} } }
    enlazar();
  }

  function htmlBandeja(cnt) {
    var fs = BANDEJA_FASES[TAB];
    var h = '';
    var ayuda = UCC ? {
      pedidos: 'Pedidos especiales que el taller manda directo a Compras (no pasan por bodega central): repuestos o compras grandes, importaciones, cubiertas, baterías por lote… Tocá una fila para ver la ficha y lo que sigue.',
      compras: 'Pedidos estratégicos para cotizar, pedir autorización (otra persona autoriza) y registrar la compra. Si falta información, pedí aclaración al solicitante.',
      entregas: 'Lo comprado que todavía no llegó completo a la obra o al taller. Enviar no cierra: cierra la recepción.'
    }[TAB] : {
      pedidos: 'Todas las solicitudes de repuestos y servicios de taller, con su etapa. Tocá una fila para ver la ficha y lo que sigue.',
      bodega: 'Bodega central revisa cada pedido: verifica el repuesto y si hay stock. Con stock se envía (aunque sea menos de lo pedido); si no hay nada, se deriva a compras.',
      compras: 'Pedidos derivados por bodega: cotizar, pedir autorización (otra persona autoriza) y registrar la compra.',
      entregas: 'Lo que ya salió de stock o se compró y todavía no llegó completo a la obra. Enviar no cierra: cierra la recepción en obra.'
    }[TAB];
    h += '<div class="tc-info">' + ayuda + '</div>';
    if (fs.length > 1) {
      var colas = TAB === 'pedidos' ? [['activos', 'En curso']].concat(fs.map(function (f) { return [f, NFASE[f][1]]; })).concat([['', 'Todos']]) :
        [['activos', 'Todos']].concat(fs.map(function (f) { return [f, NFASE[f][1]]; }));
      var tot = 0; fs.forEach(function (f) { tot += cnt ? n(cnt[f]) : 0; });
      var act = 0; ABIERTAS.forEach(function (f) { if (fs.indexOf(f) >= 0) act += cnt ? n(cnt[f]) : 0; });
      h += '<div class="tc-colas">' + colas.map(function (c) {
        var k = c[0], v = !cnt ? '…' : k === 'activos' ? (TAB === 'pedidos' ? act : tot) : k === '' ? tot : n(cnt[k]);
        return '<button data-fase="' + k + '" class="' + (FIL.fase === k ? 'on' : '') + '">' + c[1] + ' <b>' + v + '</b></button>';
      }).join('') + '</div>';
    }
    var obras = (LIST && LIST.obras) || [];
    if (FIL.obra && !obras.some(function (o) { return o.clave === FIL.obra; })) obras = obras.concat([{ clave: FIL.obra, nombre: (CAT.obras.filter(function (o) { return o.clave === FIL.obra; })[0] || {}).nombre || FIL.obra }]);
    h += '<div class="tc-bar"><select id="tcObra"><option value="">Todas las obras</option>' + obras.slice().sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); }).map(function (o) {
      return '<option value="' + esc(o.clave) + '"' + (FIL.obra === o.clave ? ' selected' : '') + '>' + esc(o.nombre) + '</option>';
    }).join('') + '</select><input id="tcQ" class="grow" placeholder="Buscar: ' + (UCC ? 'UCC' : 'TAL') + '-…, repuesto, código, equipo, solicitante, OC…" value="' + esc(FIL.q) + '">' +
      '<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="tcMios"' + (FIL.mios ? ' checked' : '') + '> Solo los que pedí yo</label></div>';
    if (!LIST || (CARGANDO && !LIST.filas)) return h + '<div class="tc-vacio">Cargando…</div>';
    if (LIST.error) return h + '<div class="tc-vacio">' + esc(LIST.error) + '</div>';
    var L = LIST.filas || [];
    if (!L.length) return h + '<div class="tc-vacio">' + (TAB === 'pedidos' && !FIL.q && !FIL.obra ? 'Todavía no hay pedidos ' + (UCC ? 'estratégicos' : 'de taller') + '. ' + (puede('solicitar') ? 'Cargá el primero con <b>＋ Nuevo pedido</b>.' : '') : 'No hay pedidos con estos filtros.') + '</div>';
    h += '<div class="tc-tw"><table class="tc-t"><thead><tr><th>Pedido</th><th>Obra / destino</th><th>Fecha</th><th>Requerido</th><th>Repuesto / servicio</th><th>Equipo</th>' +
      '<th class="r">Cant.</th><th>Solicitante</th><th>Etapa</th><th>' + (UCC ? 'Revisión' : 'Bodega') + '</th><th>Cotización / autorización</th><th>Compra</th><th>Entrega</th><th>📷</th></tr></thead><tbody>';
    L.forEach(function (p) {
      var S = saldos(p);
      var bod = p.estado === 'pendiente' ? chip('Pendiente', 'am') : p.estado === 'revision' ? chip('Aclaración', 'am', p.bodega_nota) :
        p.estado === 'stock' ? chip('Desde stock', 'ok', p.bodega_nota) : p.estado === 'compra' ? chip(UCC ? 'En compras' : 'Comprar', 'az', p.bodega_nota) :
        p.estado === 'rechazado' ? chip('Rechazado', 'mal', p.bodega_nota) : chip('Anulado', 'gr');
      var cot = p.estado !== 'compra' ? '<small>—</small>' :
        (p.n_cotizaciones ? p.n_cotizaciones + ' cotiz.' : p.comprado ? '' : '<span class="tc-warn">sin cotizar</span>') +
        (p.aut_estado === 'pendiente' ? ' ' + chip('Por autorizar', 'am') : p.aut_estado === 'autorizada' && !p.comprado ? ' ' + chip('Autorizada', 'ok') : '') +
        (p.aut_proveedor && !p.comprado ? '<small>' + esc(p.aut_proveedor) + ' · ' + fm(p.aut_total, p.aut_moneda) + '</small>' : '');
      var com = p.comprado ? esc((p.doc_tipo || '').toUpperCase() + ' ' + (p.doc_numero || '')) + (p.uso_caja_chica ? ' ' + chip('caja chica', 'gr') : '') +
        '<small>' + esc(p.compra_proveedor || '') + ' · ' + fm(p.compra_total, p.compra_moneda) + '</small>' : '<small>—</small>';
      var ent = (p.estado === 'stock' || p.comprado) ? '<span class="tc-bar-prog"><i style="width:' + Math.min(100, Math.round(S.enObra / (S.Q || 1) * 100)) + '%"></i></span>' + fq(S.enObra) + '/' + fq(S.Q) +
        '<small>' + (S.transito ? fq(S.transito) + ' en tránsito · ' : '') + (S.provPend ? fq(S.provPend) + ' del proveedor · ' : '') +
        (p.estado === 'stock' ? 'desde stock' : p.ruta === 'central' ? 'por central' : p.ruta === 'directa' ? 'directo a obra' : 'mixta') + '</small>' : '<small>—</small>';
      h += '<tr class="cl ' + (p.prioridad === 'urgente' ? 'urg' : p.prioridad === 'alta' ? 'alta' : '') + '" data-id="' + p.id + '">' +
        '<td><b>' + esc(p.codigo) + '</b>' + (p.prioridad !== 'normal' ? '<small style="color:' + (p.prioridad === 'urgente' ? '#b03a2e' : '#9a6200') + '">' + esc(p.prioridad) + '</small>' : '') + '</td>' +
        '<td>' + esc(p.obra_nombre) + '</td><td>' + fd(p.creado_en) + '</td>' +
        '<td' + (atrasado(p) ? ' class="tc-neg" title="Atrasado"' : '') + '>' + fd(p.fecha_requerida) + '</td>' +
        '<td>' + esc(p.descripcion) + (p.tipo === 'servicio' ? ' ' + chip('servicio', 'gr') : '') +
        ((p.codigo_repuesto || p.marca_modelo) ? '<small>' + esc([p.codigo_repuesto, p.marca_modelo].filter(Boolean).join(' · ')) + '</small>' : '') + '</td>' +
        '<td>' + esc(p.equipo_id || p.equipo_texto || '') + (p.ot_numero ? '<small>OT ' + esc(p.ot_numero) + '</small>' : '') + '</td>' +
        '<td class="r">' + fq(p.cantidad) + ' ' + esc(p.unidad) + '</td><td>' + esc(p.solicitante_nombre) + '</td>' +
        '<td>' + chipFase(p.fase) + '</td><td>' + bod + '</td><td>' + cot + '</td><td>' + com + '</td><td>' + ent + '</td>' +
        '<td>' + (p.n_fotos ? p.n_fotos : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (n(LIST.total) > L.length) h += '<div class="tc-info" style="margin-top:8px">Se muestran ' + L.length + ' de ' + LIST.total + '. Usá el buscador o los filtros para acotar.</div>';
    return h;
  }

  // ------------------------------------------------------------ histórico de Monday (SQL 85, solo lectura)
  // Un pedido por fila (SQL 86 junta las copias de cada tablero; «fuentes» guarda las originales). No son pedidos TAL.
  function tablero(archivo) { return String(archivo || '').replace(/_\d+\.xlsx$/i, '').replace(/_/g, ' '); }
  var H_CORTO = { 'Pedidos Taller': 'Pedidos', 'Compras Taller': 'Compras', 'Compras Taller UCC': 'UCC', 'Compra Caja Chica': 'Caja chica',
    'Traslados Taller': 'Traslados', 'Consolidado Taller': 'Consolidado', 'Pedidos de Compra Taller UCC': 'Pedidos UCC' };
  function tableroCorto(archivo) { var t = tablero(archivo); return H_CORTO[t] || t; }
  function campo(c, claves) { for (var i = 0; i < claves.length; i++) { var v = c[claves[i]]; if (v !== undefined && v !== null && v !== '') return v; } return ''; }
  var H_ESTADO = ['Estado de Compra', 'Estado de compra', 'Estado De Compra', 'Estado Compra', 'ESTADO GENERAL', 'Estado de envío',
    'Validación', 'Validación pedido', 'Aprobación', 'Estado comercial'];

  async function cargarHist(mas) {
    var g = ++genH, prev = mas && HIST && HIST.filas ? HIST.filas : [];
    if (!mas) { HIST = { cargando: true, tableros: HIST && HIST.tableros }; render(); }
    try {
      var r = await rpc('tc_hist_listar', { p: { archivo: HFIL.archivo || null, q: HFIL.q || null, limite: 200, desplazar: prev.length } });
      if (g !== genH) return;
      r.filas = prev.concat(r.filas || []);
      HIST = r;
    } catch (e) {
      if (g !== genH) return;
      HIST = { error: /SQL 79/.test(e.message) ? 'Falta correr SQL 85 (ver el histórico de Monday) en la base.' : e.message };
    }
    if (TAB === 'historico') render();
  }

  function htmlHist() {
    var h = '<div class="tc-info">Pedidos de los tableros viejos de Monday, uno por fila: las copias que el pedido dejó en cada tablero ' +
      '(Pedidos → Consolidado → Compras / Caja chica / UCC → Traslados) están juntas. Son solo de consulta: no son pedidos TAL ni mueven saldos. ' +
      'Tocá una fila para ver lo que dice cada tablero.</div>';
    var tabs = (HIST && HIST.tableros) || [];
    h += '<div class="tc-bar"><select id="tcHArch"><option value="">Todos los tableros</option>' + tabs.map(function (t) {
      return '<option value="' + esc(t.archivo) + '"' + (HFIL.archivo === t.archivo ? ' selected' : '') + '>Pasó por ' + esc(tablero(t.archivo)) + ' (' + fq(t.filas) + ')</option>';
    }).join('') + '</select><input id="tcHQ" class="grow" placeholder="Buscar: repuesto, solicitante, taller, centro de costo, OC, proveedor…" value="' + esc(HFIL.q) + '"></div>';
    if (!HIST || HIST.cargando) return h + '<div class="tc-vacio">Cargando…</div>';
    if (HIST.error) return h + '<div class="tc-vacio">' + esc(HIST.error) + '</div>';
    var L = HIST.filas || [];
    if (!L.length) return h + '<div class="tc-vacio">' + (!tabs.length ? 'Todavía no se cargó el histórico de Monday. Lo carga un administrador con ' +
      '<b>esquema/herramientas/cargar_historico_taller.py</b> (ver LEEME 79/80).' : 'No hay filas con estos filtros.') + '</div>';
    h += '<div class="tc-tw"><table class="tc-t"><thead><tr><th>Tableros</th><th>Solicitado</th><th>Requerido</th><th>Repuesto / servicio</th><th class="r">Cant.</th>' +
      '<th>Solicitante</th><th>Centro de costo</th><th>Estado</th><th>OC</th></tr></thead><tbody>';
    L.forEach(function (x) {
      var c = x.campos || {}, sol = campo(c, ['Nombre solicitante']), tal = campo(c, ['Taller solicitante']);
      h += '<tr class="cl" data-hist="' + x.id + '"><td>' + (x.tableros || [x.archivo]).map(function (a) { return chip(esc(tableroCorto(a)), '', tablero(a)); }).join(' ') +
        (x.estado === 'conflicto' ? ' ' + chip('conflicto', 'am', 'Una fila cambió entre dos cargas') : '') + '</td>' +
        '<td>' + fd(campo(c, ['Fecha solicitud'])) + '</td><td>' + fd(campo(c, ['Fecha requerida', 'Fecha Requerida'])) + '</td>' +
        '<td>' + esc(c.Name || '') + '</td><td class="r">' + esc(campo(c, ['Cantidad requerida', 'Cantidad'])) + '</td>' +
        '<td>' + esc(sol || tal) + (sol && tal ? '<small>' + esc(tal) + '</small>' : '') + '</td>' +
        '<td>' + esc(campo(c, ['Centro de costo', 'Centro de Costo'])) + '</td>' +
        '<td>' + esc(campo(c, H_ESTADO)) + (c._grupo ? '<small>' + esc(c._grupo) + '</small>' : '') + '</td>' +
        '<td>' + esc(campo(c, ['Orden de Compra', 'Orden de compra', 'N° OC o Recep'])) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (n(HIST.total) > L.length) h += '<div class="tc-acc" style="justify-content:center"><span class="tc-info" style="margin:0">Se muestran ' + fq(L.length) + ' de ' + fq(HIST.total) + '.</span>' +
      '<button class="tc-btn" id="tcHMas">Ver 200 más</button></div>';
    return h;
  }

  async function fichaHist(x) {
    if (!x) return;
    var m = modal('<div class="tc-vacio">Cargando…</div>', true), d;
    try { d = await rpc('tc_hist_detalle', { p_id: x.id }); }
    catch (e) { $('.tc-box', m).innerHTML = '<div class="tc-vacio">' + esc(/SQL 79/.test(e.message) ? 'Falta correr SQL 86 en la base.' : e.message) + '</div>'; return; }
    var c = d.campos || {};
    var val = function (v) {
      var s = String(v);
      if (!/https?:\/\//.test(s)) return esc(s);
      return s.split(/,\s*(?=https?:\/\/)/).map(function (u) {
        var nom = u.split('/').pop() || u; try { nom = decodeURIComponent(nom); } catch (e) {}
        return /^https?:\/\//.test(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(nom) + '</a>' : esc(u);
      }).join('<br>');
    };
    var tabla = function (o) {
      return '<table class="tc-cot"><tbody>' + Object.keys(o).filter(function (k) { return k !== '_grupo'; }).map(function (k) {
        return '<tr><th style="width:34%">' + esc(k) + '</th><td>' + val(o[k]) + '</td></tr>';
      }).join('') + '</tbody></table>';
    };
    var F = d.fuentes || [];
    $('.tc-box', m).innerHTML = '<div class="tc-hd"><div class="t"><h3>' + esc(c.Name || 'Fila de Monday') + '</h3>' +
      '<div class="sub">Pasó por ' + (d.tableros || []).map(function (a) { return esc(tablero(a)); }).join(' · ') + '</div></div>' +
      '<button class="tc-x" data-cerrar>✕</button></div>' +
      (d.estado === 'conflicto' ? '<div class="tc-info tc-warn">Una de estas filas cambió entre dos cargas del mismo archivo: se muestra la primera versión.</div>' : '') +
      '<div class="tc-info">Los enlaces a archivos son de Monday: se abren solo con una sesión de Monday.</div>' +
      '<div class="tc-dt">' + [['', 'Resumen']].concat(F.map(function (f, i) { return [String(i), tableroCorto(f.archivo)]; })).map(function (t, i) {
        return '<button data-hf="' + t[0] + '" class="' + (i ? '' : 'on') + '">' + esc(t[1]) + '</button>';
      }).join('') + '</div><div id="tcHF">' + tabla(c) + '</div>';
    $$('[data-cerrar]', m).forEach(function (b) { b.onclick = function () { m.remove(); }; });
    $$('[data-hf]', m).forEach(function (b) {
      b.onclick = function () {
        $$('[data-hf]', m).forEach(function (o) { o.classList.toggle('on', o === b); });
        var k = b.getAttribute('data-hf'), f = F[+k];
        $('#tcHF', m).innerHTML = k === '' ? tabla(c) : '<div class="sub">' + esc(tablero(f.archivo)) + (f.campos && f.campos._grupo ? ' · grupo «' + esc(f.campos._grupo) + '»' : '') +
          ' · hoja «' + esc(f.hoja) + '», fila ' + f.fila + '</div>' + tabla(f.campos || {});
      };
    });
  }

  function enlazar() {
    $$('[data-tab]', EL).forEach(function (b) {
      b.onclick = function () {
        TAB = b.getAttribute('data-tab'); try { localStorage.setItem(LS_TAB, TAB); } catch (e) {}
        FIL.fase = 'activos'; LIST = null;
        if (TAB === 'kpis') { KPI = null; cargarKpis(); } else if (TAB === 'permisos') { PERM = null; cargarPermisos(); }
        else if (TAB === 'historico') cargarHist();
        cargarLista();
      };
    });
    var ha = $('#tcHArch', EL); if (ha) ha.onchange = function () { HFIL.archivo = ha.value; cargarHist(); };
    var hq = $('#tcHQ', EL); if (hq) { var th = null; hq.oninput = function () { clearTimeout(th); th = setTimeout(function () { HFIL.q = hq.value.trim(); cargarHist(); }, 350); }; }
    var hr = $('#tcHRec', EL); if (hr) hr.onclick = function () { cargarHist(); };
    var hm = $('#tcHMas', EL); if (hm) hm.onclick = function () { cargarHist(true); };
    $$('tr[data-hist]', EL).forEach(function (tr) {
      tr.onclick = function () { fichaHist(HIST.filas.filter(function (x) { return String(x.id) === tr.getAttribute('data-hist'); })[0]); };
    });
    $$('[data-fase]', EL).forEach(function (b) { b.onclick = function () { FIL.fase = b.getAttribute('data-fase'); cargarLista(); }; });
    var o = $('#tcObra', EL); if (o) o.onchange = function () { FIL.obra = o.value; cargarLista(); };
    var q = $('#tcQ', EL); if (q) { var tq = null; q.oninput = function () { clearTimeout(tq); tq = setTimeout(function () { FIL.q = q.value.trim(); cargarLista(); }, 350); }; }
    var mi = $('#tcMios', EL); if (mi) mi.onchange = function () { FIL.mios = mi.checked; cargarLista(); };
    var r = $('#tcRec', EL); if (r) r.onclick = cargarLista;
    var x = $('#tcXls', EL); if (x) x.onclick = excel;
    var nv = $('#tcNuevo', EL); if (nv) nv.onclick = function () { formPedido(null); };
    $$('tr[data-id]', EL).forEach(function (tr) { tr.onclick = function () { abrirPedido(tr.getAttribute('data-id')); }; });
    var pn = $('#tcProvNuevo', EL); if (pn) pn.onclick = function () { formProveedor(null); };
    $$('[data-prov]', EL).forEach(function (b) { b.onclick = function () { formProveedor(CAT.proveedores.filter(function (p) { return p.id === b.getAttribute('data-prov'); })[0]); }; });
    var kd = $('#tcKdesde', EL); if (kd) kd.onchange = function () { KPI_DESDE = kd.value; cargarKpis(); };
    var pt = $('#tcPermQ', EL); if (pt) pt.oninput = function () { PERM_TXT = pt.value; render(); };
    $$('[data-permsave]', EL).forEach(function (b) { b.onclick = function () { guardarPermiso(b.getAttribute('data-permsave')); }; });
  }

  // ------------------------------------------------------------ modal genérico
  function modal(html, chico) {
    var m = document.createElement('div'); m.className = 'tc-modal';
    m.innerHTML = '<div class="tc-box' + (chico ? ' chico' : '') + '">' + html + '</div>';
    document.body.appendChild(m);
    m.addEventListener('mousedown', function (e) { if (e.target === m) m.remove(); });
    $$('[data-cerrar]', m).forEach(function (b) { b.onclick = function () { m.remove(); }; });
    return m;
  }
  function f(lab, html, cls) { return '<div class="tc-f ' + (cls || '') + '"><label>' + lab + '</label>' + html + '</div>'; }
  function ocupado(btn, si) { if (!btn) return; btn.disabled = si; if (si) { btn.dataset.t = btn.textContent; btn.textContent = 'Guardando…'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

  // ------------------------------------------------------------ nuevo / editar pedido
  function formPedido(p) {
    var obras = CAT.obras.filter(function (o) { return o.pide; });
    if (!obras.length) { toast('Tu usuario no puede pedir para ninguna obra.'); return; }
    var v = p || { prioridad: 'normal', tipo: 'producto', unidad: 'un' };
    var m = modal('<div class="tc-hd"><div class="t"><h3>' + (p ? 'Editar ' + esc(p.codigo) : UCC ? '⭐ Nuevo pedido estratégico (UCC)' : 'Nuevo pedido de taller') + '</h3>' +
      '<div class="sub">' + (p ? (p.estado === 'revision' ? (UCC ? 'Compras' : 'Bodega') + ' pidió aclaración: <b>' + esc(p.bodega_nota || '') + '</b>. Al guardar vuelve a ' + (UCC ? 'compras' : 'bodega') + '.' :
          UCC ? 'Se puede editar hasta que compras cargue la primera cotización.' : 'Se puede editar hasta que bodega decida.') :
        UCC ? 'Va directo a <b>Compras</b> (no pasa por bodega central). Lo podés editar o anular hasta que compras cargue la primera cotización.' :
        'Bodega central lo revisa primero: si hay stock se envía desde central; si no, pasa a compras.') + '</div></div><button class="tc-x" data-cerrar>✕</button></div>' +
      '<div class="tc-sec"><h4>Repuesto o servicio</h4><div class="tc-g">' +
      f('Descripción *', '<input id="fp_descripcion" value="' + esc(v.descripcion || '') + '" placeholder="ej.: Espejo retrovisor lado acompañante">', 'w4') +
      f('Código / N° de parte', '<input id="fp_codigo_repuesto" value="' + esc(v.codigo_repuesto || '') + '">', 'w2') +
      f('Marca / modelo de referencia', '<input id="fp_marca_modelo" value="' + esc(v.marca_modelo || '') + '">', 'w2') +
      f('Tipo', '<select id="fp_tipo"><option value="producto"' + (v.tipo !== 'servicio' ? ' selected' : '') + '>Repuesto / material</option><option value="servicio"' + (v.tipo === 'servicio' ? ' selected' : '') + '>Servicio</option></select>') +
      f('Cantidad *', '<input id="fp_cantidad" inputmode="decimal" value="' + esc(v.cantidad != null ? String(v.cantidad).replace('.', ',') : '') + '">') +
      f('Unidad *', '<input id="fp_unidad" list="tcUms" value="' + esc(v.unidad || '') + '"><datalist id="tcUms">' + UNIDADES.map(function (u) { return '<option value="' + u + '">'; }).join('') + '</datalist>') +
      f('Prioridad', '<select id="fp_prioridad">' + [['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente (máquina parada)']].map(function (o) { return '<option value="' + o[0] + '"' + (v.prioridad === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
      '</div></div>' +
      '<div class="tc-sec"><h4>Para dónde y para qué</h4><div class="tc-g">' +
      f('Obra / destino *', '<select id="fp_obra_clave"><option value="">— elegí —</option>' + obras.map(function (o) { return '<option value="' + esc(o.clave) + '"' + (v.obra_clave === o.clave ? ' selected' : '') + '>' + esc(o.nombre) + '</option>'; }).join('') + '</select>', 'w2') +
      f('Equipo (flota)', '<input id="fp_equipo_id" list="tcEqs" value="' + esc(v.equipo_id || '') + '" placeholder="ej.: TC-04"><datalist id="tcEqs">' + CAT.equipos.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.d || '') + '</option>'; }).join('') + '</datalist>') +
      f('N° de OT', '<input id="fp_ot_numero" inputmode="numeric" value="' + esc(v.ot_numero || '') + '">') +
      f('Equipo / destino (si no está en la flota)', '<input id="fp_equipo_texto" value="' + esc(v.equipo_texto || '') + '">', 'w2') +
      f('Fecha requerida', '<input id="fp_fecha_requerida" type="date" value="' + esc(v.fecha_requerida || '') + '">') +
      '<div></div>' +
      f(UCC ? 'Por qué es estratégico / especificaciones, proveedor sugerido' : 'Observaciones', '<textarea id="fp_notas">' + esc(v.notas || '') + '</textarea>', 'w4') +
      (p ? '' : f('Fotos (opcional)', '<input id="fp_fotos" type="file" accept="image/*" multiple capture="environment">', 'w4')) +
      '</div></div><div class="tc-acc"><button class="tc-btn" data-cerrar>Cancelar</button><button class="tc-btn pri" id="fpOk">' + (p ? 'Guardar' : UCC ? 'Enviar a compras' : 'Enviar a bodega') + '</button></div>');
    var g = function (k) { var e = $('#fp_' + k, m); return e ? e.value.trim() : ''; };
    $('#fp_equipo_id', m).addEventListener('change', function () {
      var e = CAT.equipos.filter(function (x) { return x.id.toLowerCase() === g('equipo_id').toLowerCase(); })[0];
      if (e) $('#fp_equipo_id', m).value = e.id;
    });
    $('#fpOk', m).onclick = async function () {
      var btn = this;
      var q = parseNum(g('cantidad'));
      if (g('descripcion').length < 3) return toast('Describí el repuesto o servicio.');
      if (!q || q <= 0 || isNaN(q)) return toast('Indicá una cantidad mayor a cero.');
      if (!g('unidad')) return toast('Indicá la unidad.');
      if (!g('obra_clave')) return toast('Elegí la obra / destino.');
      var eq = g('equipo_id');
      if (eq && !CAT.equipos.some(function (x) { return x.id === eq; })) return toast('El equipo «' + esc(eq) + '» no está en la flota. Si no es de la flota, escribilo en «Equipo / destino».');
      var datos = { descripcion: g('descripcion'), codigo_repuesto: g('codigo_repuesto'), marca_modelo: g('marca_modelo'), tipo: g('tipo'),
        cantidad: q, unidad: g('unidad'), prioridad: g('prioridad'), obra_clave: g('obra_clave'), equipo_id: eq, ot_numero: g('ot_numero'),
        equipo_texto: g('equipo_texto'), fecha_requerida: g('fecha_requerida'), notas: g('notas') };
      if (!p) datos.canal = CANAL;
      var files = !p && $('#fp_fotos', m) ? Array.prototype.slice.call($('#fp_fotos', m).files || []) : [];
      ocupado(btn, true);
      try {
        var id;
        if (p) { await accion(p, 'editar', datos); id = p.id; }
        else {
          var r = await rpc('tc_pedido_crear', { p_op: btn.dataset.op || (btn.dataset.op = uuid()), p: datos });
          id = r.id; toast('Pedido <b>' + esc(r.codigo) + '</b> enviado a ' + (UCC ? 'compras' : 'bodega central') + '.');
          for (var i = 0; i < files.length; i++) {
            try { await subirArchivo(id, files[i], 'foto'); } catch (e) { toast('El pedido se guardó, pero una foto no subió: ' + esc(e.message)); }
          }
        }
        m.remove(); cargarLista(); abrirPedido(id);
      } catch (e) { ocupado(btn, false); if (!e.conflicto) toast(esc(e.message)); }
    };
  }

  // Una acción sobre el pedido: versión + clave de operación. Si otro lo cambió, recarga.
  async function accion(p, acc, datos, op) {
    try {
      return await rpc('tc_accion', { p_pedido: p.id, p_accion: acc, p_version: p.version, p_op: op || uuid(), p: datos || {} });
    } catch (e) {
      if (e.code === '40001') { toast(esc(e.message)); e.conflicto = true; $$('.tc-modal').forEach(function (x) { x.remove(); }); abrirPedido(p.id); cargarLista(); }
      throw e;
    }
  }

  // ------------------------------------------------------------ ficha del pedido
  async function abrirPedido(id, tab) {
    var vieja = $('.tc-modal.tc-ficha'); if (vieja) vieja.remove();
    if (tab) DTAB = tab;
    var m = modal('<div class="tc-vacio">Cargando…</div>'); m.classList.add('tc-ficha');
    try { DET = await rpc('tc_detalle', { p_pedido: id }); }
    catch (e) { $('.tc-box', m).innerHTML = '<div class="tc-vacio">' + esc(e.message) + '</div>'; return; }
    pintarFicha(m);
  }
  function recargarFicha(id, tab) { cargarLista(); abrirPedido(id || DET.id, tab); }

  function pintarFicha(m) {
    var p = DET, S = saldos(p);
    var subt = esc(p.obra_nombre) + ' · ' + fq(p.cantidad) + ' ' + esc(p.unidad) + (p.equipo_id ? ' · ' + esc(p.equipo_id) + (p.equipo_desc ? ' (' + esc(p.equipo_desc) + ')' : '') : p.equipo_texto ? ' · ' + esc(p.equipo_texto) : '') +
      (p.ot_numero ? ' · OT ' + esc(p.ot_numero) : '') + ' · pidió ' + esc(p.solicitante_nombre) + ' el ' + fd(p.creado_en) +
      (p.fecha_requerida ? ' · requerido ' + '<span' + (atrasado(p) ? ' class="tc-neg"' : '') + '>' + fd(p.fecha_requerida) + '</span>' : '');
    var nAdj = (p.adjuntos || []).length;
    var tabs = [['resumen', 'Resumen'], ['cotizaciones', 'Cotizaciones' + (p.n_cotizaciones ? ' (' + p.n_cotizaciones + ')' : '')], ['compra', 'Compra'],
      ['movimientos', 'Movimientos' + ((p.movimientos || []).length ? ' (' + p.movimientos.filter(function (x) { return !x.anulado_en; }).length + ')' : '')],
      ['fotos', 'Fotos y archivos' + (nAdj ? ' (' + nAdj + ')' : '')], ['historial', 'Historial']];
    if (!tabs.some(function (t) { return t[0] === DTAB; })) DTAB = 'resumen';
    var h = '<div class="tc-hd"><div class="t"><h3>' + esc(p.codigo) + ' · ' + esc(p.descripcion) + ' ' + chipFase(p.fase) +
      (p.prioridad !== 'normal' ? ' ' + chip(p.prioridad, p.prioridad === 'urgente' ? 'mal' : 'am') : '') + '</h3><div class="sub">' + subt + '</div></div>' +
      '<button class="tc-x" data-cerrar>✕</button></div>';
    h += htmlSigue(p, S);
    h += '<div class="tc-dt">' + tabs.map(function (t) { return '<button data-dtab="' + t[0] + '" class="' + (DTAB === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    h += '<div id="tcDcuerpo">' + (DTAB === 'resumen' ? htmlResumen(p, S) : DTAB === 'cotizaciones' ? htmlCotizaciones(p) : DTAB === 'compra' ? htmlCompra(p) :
      DTAB === 'movimientos' ? htmlMovimientos(p, S) : DTAB === 'fotos' ? htmlFotos(p) : htmlHistorial(p)) + '</div>';
    $('.tc-box', m).innerHTML = h;
    $$('[data-cerrar]', m).forEach(function (b) { b.onclick = function () { m.remove(); }; });
    $$('[data-dtab]', m).forEach(function (b) { b.onclick = function () { DTAB = b.getAttribute('data-dtab'); pintarFicha(m); }; });
    enlazarFicha(m, p, S);
    if (DTAB === 'fotos') cargarMiniaturas(m, p);
  }

  // «Qué sigue»: el panel de acciones según la etapa y lo que puede el usuario
  function htmlSigue(p, S) {
    var h = '', mine = YO.uid === p.solicitante_id || puede('super');
    var uccEditable = UCC && mine && (p.estado === 'revision' || (p.estado === 'compra' && !n(p.n_cotizaciones) && !p.aut_id && !p.comprado));
    var uccRevisa = UCC && puede('compras') && p.estado === 'compra' && !p.aut_id && !p.comprado;
    if (p.fase === 'aclaracion') {
      h += '<p style="margin:0">Compras pidió aclaración' + (p.bodega_nombre ? ' (' + esc(p.bodega_nombre) + ')' : '') + ': <b>' + esc(p.bodega_nota || '') + '</b>' +
        (mine ? '<br>Corregí el pedido y se reenvía a compras.' : '<br>Esperando que el solicitante corrija el pedido.') + '</p>';
    }
    if (p.fase === 'aclaracion') {
      /* listo arriba */
    } else if (p.fase === 'bodega') {
      if (puede('bodega')) {
        h += '<p style="margin:0 0 8px">Verificá el repuesto en bodega central y decidí:</p><div class="tc-g">' +
          f('Stock verificado para este pedido', '<input id="sg_stock" inputmode="decimal" placeholder="cantidad física">') +
          f('Nota / motivo (lo ve el solicitante)', '<input id="sg_motivo">', 'w2') + '<div></div></div>' +
          '<div class="tc-acc" style="justify-content:flex-start">' +
          (p.tipo !== 'servicio' ? '<button class="tc-btn ok" data-bod="bodega_stock">✓ Hay stock: atender desde central</button>' : '') +
          '<button class="tc-btn pri" data-bod="bodega_compra">🛒 Derivar a compras</button>' +
          '<button class="tc-btn am" data-bod="bodega_revision">? Pedir aclaración</button>' +
          '<button class="tc-btn mal" data-bod="bodega_rechazar">✕ Rechazar</button></div>' +
          '<div class="tc-info" style="margin:8px 0 0">«Stock» es lo que verificás físicamente para ESTE pedido; no reserva existencias de otros. Si hay menos de lo pedido se puede atender igual: se envía lo que hay y después se cierra «con lo entregado».</div>';
      } else h += '<p style="margin:0">Esperando la revisión de <b>bodega central</b>.' + (p.estado === 'revision' ? ' Bodega pidió aclaración: <b>' + esc(p.bodega_nota || '') + '</b>' : '') + '</p>';
      if (mine) h += '<div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn" id="sgEditar">✎ ' + (p.estado === 'revision' ? 'Corregir y reenviar' : 'Editar') + '</button><button class="tc-btn mal" id="sgAnular">Anular pedido</button></div>';
    } else if (p.fase === 'cotizacion') {
      h += '<p style="margin:0">' + (puede('compras') ? 'Cargá las cotizaciones y pedí autorización de la elegida (pestaña <b>Cotizaciones</b>).' : 'En compras: cotizando.') +
        ((p.autorizaciones || []).some(function (a) { return a.estado === 'devuelta'; }) ? ' <span class="tc-warn">La última autorización fue devuelta: ' + esc(ultimaAut(p, 'devuelta').motivo_resolucion || '') + '</span>' : '') + '</p>';
      if (puede('compras')) h += '<div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn pri" data-irtab="cotizaciones">Ir a cotizaciones</button></div>';
      if (uccRevisa) h += '<div class="tc-g" style="margin-top:8px">' + f('Motivo (lo ve el solicitante)', '<input id="sg_motivo">', 'w4') + '</div>' +
        '<div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn am" data-ucc="ucc_aclaracion">? Pedir aclaración</button><button class="tc-btn mal" data-ucc="ucc_rechazar">✕ Rechazar</button></div>';
    } else if (p.fase === 'autorizacion') {
      var a = ultimaAut(p, 'pendiente');
      h += '<p style="margin:0 0 6px">' + esc(a.solicitado_nombre) + ' pidió autorizar <b>' + esc(a.oferta.proveedor_nombre) + '</b> por <b>' + fm(a.total, a.moneda) + '</b>' +
        ' (' + fm(a.oferta.precio_unit, a.moneda) + ' c/u' + (n(a.oferta.flete) ? ' + flete ' + fm(a.oferta.flete, a.moneda) : '') + (a.oferta.plazo_dias != null ? ' · ' + a.oferta.plazo_dias + ' días' : '') + ')' +
        ' — «' + esc(a.motivo) + '» · ' + fdt(a.solicitado_en) + '</p>';
      if (puede('autorizar') && a.solicitado_por !== YO.uid) {
        h += '<div class="tc-g">' + f('Comentario (obligatorio para devolver)', '<input id="sg_motivo">', 'w4') + '</div>' +
          '<div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn ok" data-aut="autorizar">✓ Autorizar compra</button><button class="tc-btn mal" data-aut="devolver">↩ Devolver a compras</button></div>';
      } else if (puede('autorizar')) h += '<div class="tc-info" style="margin:0">Vos pediste esta autorización: la tiene que resolver otra persona.</div>';
      else h += '<div class="tc-info" style="margin:0">Esperando al autorizador.</div>';
    } else if (p.fase === 'compra') {
      if (puede('compras')) h += htmlFormCompra(p);
      else h += '<p style="margin:0">Compra autorizada: falta que compras la registre.</p>';
    } else if (p.fase === 'entrega') {
      var ms = movsPosibles(p);
      h += '<p style="margin:0 0 6px">' + (p.estado === 'stock' ? 'Se atiende desde stock de central.' : 'Comprado · ' + (p.ruta === 'central' ? 'entrega por central' : p.ruta === 'directa' ? 'entrega directa del proveedor a la obra' : 'entrega mixta (central y directa)') + '.') +
        ' En obra: <b>' + fq(S.enObra) + ' de ' + fq(S.Q) + ' ' + esc(p.unidad) + '</b>' + (S.transito ? ' · ' + fq(S.transito) + ' en tránsito' : '') + (S.provPend ? ' · ' + fq(S.provPend) + ' por recibir del proveedor' : '') + '.</p>';
      if (ms.length) h += '<div class="tc-acc" style="justify-content:flex-start">' + ms.map(function (t) { return '<button class="tc-btn ' + (t === 'recepcion' || t === 'directa' || t === 'servicio' ? 'ok' : 'pri') + '" data-mov="' + t + '">＋ ' + MOV[t] + '</button>'; }).join('') + '</div>';
      else h += '<div class="tc-info" style="margin:0">' + (S.transito && !puedeObra(p.obra_clave) ? 'Falta que la obra confirme lo recibido.' : 'Nada para registrar con tu usuario en este momento.') + '</div>';
      if (puedeCerrar(p) && S.enObra > 0 && !S.transito && S.pendFinal > 0)
        h += '<div style="margin-top:8px"><button class="tc-mini" id="sgCierre">✓ Cerrar con lo entregado (' + fq(S.enObra) + ' de ' + fq(S.Q) + ' ' + esc(p.unidad) + ')</button>' +
          ' <small style="color:#667">si no se va a mandar más (stock parcial, urgencia, cantidad de más).</small></div>';
    } else if (p.fase === 'cerrado' && p.cierre_en) {
      h += '<p style="margin:0">✓ Cerrado con lo entregado: <b>' + fq(S.enObra) + ' de ' + fq(S.Q) + ' ' + esc(p.unidad) + '</b> · ' + esc(p.cierre_nombre || '') + ', ' + fdt(p.cierre_en) +
        (p.cierre_motivo ? ' — «' + esc(p.cierre_motivo) + '»' : '') + '</p>';
      if (puede('bodega') || puede('compras')) h += '<div style="margin-top:6px"><button class="tc-mini" id="sgCierreDeshacer">↺ Deshacer cierre (vuelve a entrega)</button></div>';
    } else if (p.fase === 'cerrado') h += '<p style="margin:0">✓ Recibido completo en obra' + (p.ult_recepcion ? ' el ' + fd(p.ult_recepcion) : '') + '.</p>';
    else if (p.fase === 'rechazado') {
      h += '<p style="margin:0">' + (UCC ? 'Compras' : 'Bodega') + ' rechazó el pedido: <b>' + esc(p.bodega_nota || '') + '</b></p>';
      if (UCC && puede('compras')) h += '<div style="margin-top:6px"><button class="tc-mini" id="sgReabrir">↺ Reabrir (vuelve a compras)</button></div>';
    }
    else if (p.fase === 'anulado') h += '<p style="margin:0">Pedido anulado.</p>';
    if (uccEditable) h += '<div class="tc-acc" style="justify-content:flex-start;margin-top:8px"><button class="tc-btn" id="sgEditar">✎ ' + (p.estado === 'revision' ? 'Corregir y reenviar' : 'Editar') + '</button><button class="tc-btn mal" id="sgAnular">Anular pedido</button></div>';
    if (!UCC && puede('bodega') && ['stock', 'compra', 'rechazado'].indexOf(p.estado) >= 0 && !p.comprado && !p.aut_id && !(p.movimientos || []).some(function (x) { return !x.anulado_en; }))
      h += '<div style="margin-top:6px"><button class="tc-mini" id="sgVolver">↺ Deshacer decisión de bodega</button></div>';
    return h ? '<div class="tc-sec sigue"><h4>Qué sigue</h4>' + h + '</div>' : '';
  }
  function puedeCerrar(p) { return puede('bodega') || (p.comprado && puede('compras')); }
  function ultimaAut(p, est) { var L = (p.autorizaciones || []).filter(function (a) { return !est || a.estado === est; }); return L[L.length - 1] || { oferta: {} }; }

  function htmlFormCompra(p) {
    var a = ultimaAut(p, 'autorizada');
    return '<p style="margin:0 0 8px">Autorizado por ' + esc(a.resuelto_nombre) + ' (' + fdt(a.resuelto_en) + '): <b>' + esc(a.oferta.proveedor_nombre) + '</b> · ' + fm(a.total, a.moneda) +
      '. Registrá la compra cuando esté hecha (comprar no es pagar).</p><div class="tc-g">' +
      f('Documento', '<select id="cp_doc_tipo"><option value="oc">Orden de compra</option><option value="factura">Factura</option><option value="comprobante">Comprobante</option></select>') +
      f('Número *', '<input id="cp_doc_numero">') + f('Fecha de compra *', '<input id="cp_fecha" type="date" value="' + hoy() + '">') +
      (p.tipo === 'servicio' ? '<div></div>' : f('Entrega', '<select id="cp_ruta"><option value="central">Por taller central</option><option value="directa">Directa del proveedor a la obra</option><option value="mixta">Mixta (una parte por central)</option></select>')) +
      f('¿Se pagó con caja chica? *', '<div class="tc-radio"><label><input type="radio" name="cp_caja" value="no"> No</label><label><input type="radio" name="cp_caja" value="si"> Sí</label></div>', 'w2') +
      '</div><div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn pri" id="cpOk">Registrar compra</button></div>';
  }

  function htmlResumen(p, S) {
    var h = '<div class="tc-sec"><h4>Solicitud</h4><div class="tc-g">' +
      f('Repuesto / servicio', '<div class="v">' + esc(p.descripcion) + (p.tipo === 'servicio' ? ' ' + chip('servicio', 'gr') : '') + '</div>', 'w2') +
      f('Código / N° de parte', '<div class="v">' + esc(p.codigo_repuesto || '—') + '</div>') + f('Marca / modelo', '<div class="v">' + esc(p.marca_modelo || '—') + '</div>') +
      f('Cantidad', '<div class="v">' + fq(p.cantidad) + ' ' + esc(p.unidad) + '</div>') + f('Obra / destino', '<div class="v">' + esc(p.obra_nombre) + '</div>') +
      f('Equipo', '<div class="v">' + esc(p.equipo_id || p.equipo_texto || '—') + (p.ot_numero ? ' · OT ' + esc(p.ot_numero) : '') + '</div>') +
      f('Requerido', '<div class="v">' + (fd(p.fecha_requerida) || '—') + '</div>') +
      (p.notas ? f('Observaciones', '<div class="v">' + esc(p.notas) + '</div>', 'w4') : '') + '</div></div>';
    if (UCC) h += p.bodega_en ? '<div class="tc-sec"><h4>Revisión de compras</h4><div>' + esc(p.bodega_nombre) + ' · ' + fdt(p.bodega_en) + ' — ' +
      ({ revision: 'pidió aclaración', rechazado: 'rechazó', compra: 'reabrió / en compras' }[p.estado] || p.estado) + (p.bodega_nota ? ' · «' + esc(p.bodega_nota) + '»' : '') + '</div></div>' : '';
    else h += '<div class="tc-sec"><h4>Bodega central</h4>' + (p.bodega_en ?
      '<div>' + esc(p.bodega_nombre) + ' · ' + fdt(p.bodega_en) + ' — ' + ({ stock: 'atender desde stock', compra: 'derivado a compras', revision: 'pidió aclaración', rechazado: 'rechazó' }[p.estado] || p.estado) +
      (p.bodega_stock != null ? ' · stock verificado ' + fq(p.bodega_stock) + ' ' + esc(p.unidad) : '') + (p.bodega_nota ? ' · «' + esc(p.bodega_nota) + '»' : '') + '</div>' : '<div class="tc-warn">Pendiente de revisión.</div>') + '</div>';
    if (p.estado === 'stock' || p.comprado) h += '<div class="tc-sec"><h4>Saldos</h4>' + htmlSaldos(S) + '</div>';
    if (p.legacy_canal) h += '<div class="tc-info">Procedencia histórica: ' + esc(p.legacy_canal) + '</div>';
    return h;
  }
  function htmlSaldos(S) {
    var c = function (t, v, cls) { return '<div class="tc-saldo ' + (cls || '') + '"><span>' + t + '</span><b>' + fq(v) + '</b></div>'; };
    if (S.serv) return '<div class="tc-saldos">' + c('Pedido', S.Q) + c('Conforme', S.s, 'hl') + c('Pendiente', S.pendFinal, S.pendFinal ? 'wa' : '') + '</div>';
    return '<div class="tc-saldos">' + c('Pedido', S.Q) + (S.stock ? '' : c('Por recibir del proveedor', S.provPend, S.provPend ? 'wa' : '')) +
      (S.stock ? '' : c('Recibido en central', S.c)) + (S.d ? c('Directo en obra', S.d) : '') +
      c('En central para enviar', S.enCentral) + c('En tránsito', S.transito, S.transito ? 'wa' : '') +
      c('Recibido en obra', S.enObra, 'hl') + c('Falta en obra', S.pendFinal, S.pendFinal ? 'wa' : '') + '</div>';
  }

  function htmlCotizaciones(p) {
    var L = p.cotizaciones || [], Q = n(p.cantidad), act = L.filter(function (c) { return !c.anulada; });
    var autAct = (p.autorizaciones || []).filter(function (a) { return a.estado === 'pendiente' || a.estado === 'autorizada'; })[0];
    var minPor = {};
    act.forEach(function (c) { var t = n(c.precio_unit) * Q + n(c.flete), k = c.moneda + '|' + c.impuesto; if (minPor[k] === undefined || t < minPor[k]) minPor[k] = t; });
    var edita = puede('compras') && p.estado === 'compra' && !p.comprado;
    var conFlete = L.some(function (c) { return n(c.flete); });   // el flete ya no se carga: la columna queda solo si alguna vieja lo tiene
    var h = '';
    if (p.estado !== 'compra') return '<div class="tc-vacio">' + (p.estado === 'stock' ? 'Se atiende desde stock: no lleva cotizaciones.' : UCC ? (p.estado === 'revision' ? 'Compras pidió aclaración: se cotiza cuando el solicitante corrija el pedido.' : 'El pedido no está en compras.') : 'Las cotizaciones se cargan cuando bodega deriva el pedido a compras.') + '</div>';
    if (!L.length) h += '<div class="tc-vacio" style="margin-bottom:10px">Sin cotizaciones.</div>';
    else {
      h += '<table class="tc-cot"><thead><tr><th>Proveedor</th><th class="r">P. unit.</th>' + (conFlete ? '<th class="r">Flete</th>' : '') + '<th class="r">Total (' + fq(Q) + ' ' + esc(p.unidad) + ')</th><th>Impuesto</th><th>Plazo</th><th>Condiciones</th><th></th></tr></thead><tbody>';
      L.forEach(function (c) {
        var t = n(c.precio_unit) * Q + n(c.flete), el = autAct && autAct.cotizacion_id === c.id, nA = adjCot(p, c.id).length;
        h += '<tr class="' + (c.anulada ? 'anul' : el ? 'elegida' : '') + '"><td class="prov"><b>' + esc(c.proveedor_nombre) + '</b>' + (el ? ' ' + chip(autAct.estado === 'autorizada' ? 'autorizada' : 'por autorizar', autAct.estado === 'autorizada' ? 'ok' : 'am') : '') +
          (!c.anulada && minPor[c.moneda + '|' + c.impuesto] === t && act.length > 1 ? ' ' + chip('menor total', 'ok', 'entre las de la misma moneda e impuesto') : '') +
          '<small>' + esc(c.creado_nombre || '') + ' · ' + fd(c.creado_en) + (c.unidad && c.unidad !== p.unidad ? ' · <span class="tc-warn">unidad ' + esc(c.unidad) + '</span>' : '') + '</small></td>' +
          '<td class="r">' + fm(c.precio_unit, c.moneda) + '</td>' + (conFlete ? '<td class="r">' + (n(c.flete) ? fm(c.flete, c.moneda) : '–') + '</td>' : '') + '<td class="r"><b>' + fm(t, c.moneda) + '</b></td>' +
          '<td>' + ({ incluido: 'IVA incluido', no_incluido: 'sin IVA', exento: 'exento' }[c.impuesto] || c.impuesto) + '</td><td>' + (c.plazo_dias != null ? c.plazo_dias + ' días' : '–') + '</td>' +
          '<td>' + esc(c.condiciones || '') + (nA ? '<button class="tc-clip" data-cotadj="' + c.id + '" title="Ver archivos de la cotización">📎 ' + nA + '</button>' : '') + (c.nota ? '<small>' + esc(c.nota) + '</small>' : '') + '</td>' +
          '<td style="white-space:nowrap">' + (edita && !c.anulada ? '<button class="tc-mini" data-coted="' + c.id + '">✎</button> <button class="tc-mini mal" data-cotan="' + c.id + '">Anular</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table>';
      var monedas = {}; act.forEach(function (c) { monedas[c.moneda + ' ' + c.impuesto] = 1; });
      if (Object.keys(monedas).length > 1) h += '<div class="tc-info" style="margin-top:8px">Hay ofertas en distinta moneda o base de impuesto: no se comparan como equivalentes.</div>';
    }
    if (edita) {
      h += '<div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn" id="cotNueva">＋ Cotización</button></div>';
      if (!autAct && act.length) {
        h += '<div class="tc-sec" style="margin-top:10px"><h4>Pedir autorización</h4><div class="tc-g">' +
          f('Oferta elegida', '<select id="au_cot">' + act.map(function (c) { return '<option value="' + c.id + '">' + esc(c.proveedor_nombre) + ' · ' + fm(n(c.precio_unit) * Q + n(c.flete), c.moneda) + '</option>'; }).join('') + '</select>', 'w2') +
          f('Por qué esta oferta *', '<input id="au_motivo" placeholder="ej.: menor total con entrega en 3 días">', 'w2') +
          '</div><div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn pri" id="auPedir">Pedir autorización</button></div>' +
          '<div class="tc-info" style="margin:8px 0 0">Si después cambiás o anulás la oferta elegida, la autorización queda sin efecto y hay que pedirla de nuevo.</div></div>';
      }
    }
    var hist = (p.autorizaciones || []).filter(function (a) { return a.estado === 'devuelta' || a.estado === 'anulada'; });
    if (hist.length) h += '<div class="tc-sec" style="margin-top:10px"><h4>Autorizaciones anteriores</h4>' + hist.map(function (a) {
      return '<div class="tc-ev"><b>' + (a.estado === 'devuelta' ? 'Devuelta' : 'Sin efecto') + ' · ' + esc(a.oferta.proveedor_nombre) + ' ' + fm(a.total, a.moneda) + '</b><small>pidió ' + esc(a.solicitado_nombre) + ' ' + fdt(a.solicitado_en) +
        (a.resuelto_nombre ? ' · resolvió ' + esc(a.resuelto_nombre) : '') + ' ' + fdt(a.resuelto_en) + '</small><div class="d">' + esc(a.motivo_resolucion || '') + '</div></div>';
    }).join('') + '</div>';
    return h;
  }

  function htmlCompra(p) {
    if (!p.comprado) return '<div class="tc-vacio">' + (p.estado === 'stock' ? 'Se atiende desde stock: no hay compra.' : 'Todavía no se registró la compra.') + '</div>';
    var c = p.compra || {}, o = c.oferta || {};
    var h = '<div class="tc-sec"><h4>Compra registrada</h4><div class="tc-g">' +
      f('Documento', '<div class="v">' + esc({ oc: 'Orden de compra', factura: 'Factura', comprobante: 'Comprobante' }[c.doc_tipo] || c.doc_tipo) + ' ' + esc(c.doc_numero) + '</div>') +
      f('Fecha de compra', '<div class="v">' + fd(c.fecha_compra) + '</div>') +
      f('Proveedor', '<div class="v">' + esc(o.proveedor_nombre) + '</div>') + f('Total', '<div class="v">' + fm(c.total, c.moneda) + '</div>') +
      f('Caja chica', '<div class="v">' + (c.uso_caja_chica === true ? 'Sí' : c.uso_caja_chica === false ? 'No' : 'Sin dato') + '</div>') +
      f('Entrega', '<div class="v">' + (p.ruta === 'central' ? 'Por taller central' : p.ruta === 'directa' ? 'Directa a obra' : 'Mixta') + '</div>') +
      f('Registró', '<div class="v">' + esc(c.registrado_nombre || '') + ' · ' + fdt(c.registrado_en) + (c.corregido_en ? ' · corregida ' + fdt(c.corregido_en) : '') + '</div>', 'w2') +
      f('Oferta autorizada (copia)', '<div class="v">' + fm(o.precio_unit, c.moneda) + ' c/u' + (n(o.flete) ? ' + flete ' + fm(o.flete, c.moneda) : '') + (o.plazo_dias != null ? ' · ' + o.plazo_dias + ' días' : '') + (o.condiciones ? ' · ' + esc(o.condiciones) : '') + '</div>', 'w4') +
      '</div></div>';
    if (puede('compras')) {
      h += '<div class="tc-sec"><h4>Corregir</h4><div class="tc-g">' +
        f('Documento', '<select id="cc_doc_tipo">' + [['oc', 'Orden de compra'], ['factura', 'Factura'], ['comprobante', 'Comprobante']].map(function (x) { return '<option value="' + x[0] + '"' + (c.doc_tipo === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>') +
        f('Número', '<input id="cc_doc_numero" value="' + esc(c.doc_numero || '') + '">') + f('Fecha', '<input id="cc_fecha" type="date" value="' + esc(c.fecha_compra || '') + '">') +
        f('Caja chica', '<select id="cc_caja"><option value="">(sin cambio)</option><option value="no"' + (c.uso_caja_chica === false ? ' selected' : '') + '>No</option><option value="si"' + (c.uso_caja_chica === true ? ' selected' : '') + '>Sí</option></select>') +
        f('Motivo de la corrección *', '<input id="cc_motivo">', 'w4') + '</div><div class="tc-acc" style="justify-content:flex-start"><button class="tc-btn" id="ccOk">Guardar corrección</button></div>';
      if (p.tipo !== 'servicio') h += '<div class="tc-g" style="margin-top:10px">' + f('Ruta de entrega', '<select id="cc_ruta">' + [['central', 'Por taller central'], ['directa', 'Directa a obra'], ['mixta', 'Mixta']].map(function (x) { return '<option value="' + x[0] + '"' + (p.ruta === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>', 'w2') +
        '<div class="tc-f"><label>&nbsp;</label><button class="tc-btn" id="ccRuta">Cambiar ruta</button></div></div>';
      h += '</div>';
    }
    return h;
  }

  function htmlMovimientos(p, S) {
    var L = p.movimientos || [];
    var h = (p.estado === 'stock' || p.comprado) ? '<div class="tc-sec"><h4>Saldos</h4>' + htmlSaldos(S) + '</div>' : '';
    if (!L.length) return h + '<div class="tc-vacio">Sin movimientos.</div>';
    h += '<table class="tc-cot"><thead><tr><th>Fecha</th><th>Movimiento</th><th class="r">Cantidad</th><th>Documento / referencia</th><th>Responsable / receptor</th><th>Registró</th><th></th></tr></thead><tbody>';
    L.forEach(function (x) {
      var pAnular = !x.anulado_en && (['central', 'prepara', 'envio'].indexOf(x.tipo) >= 0 ? puede('bodega') : puedeObra(p.obra_clave));
      h += '<tr class="' + (x.anulado_en ? 'anul' : '') + '"><td>' + fd(x.fecha) + '</td><td>' + esc(MOV[x.tipo] || x.tipo) + (x.nota ? '<small>' + esc(x.nota) + '</small>' : '') +
        (x.anulado_en ? '<small style="text-decoration:none">anulado por ' + esc(x.anulado_nombre || '') + ': ' + esc(x.anulado_motivo || '') + '</small>' : '') + '</td>' +
        '<td class="r">' + fq(x.cantidad) + ' ' + esc(p.unidad) + '</td><td>' + (docTxt(x) ? '<b>' + esc(docTxt(x)) + '</b>' + (x.referencia ? '<small>' + esc(x.referencia) + '</small>' : '') : esc(x.referencia || '')) + '</td><td>' + esc(x.responsable || '') + '</td>' +
        '<td><small>' + esc(x.registrado_nombre || '') + ' · ' + fdt(x.registrado_en) + '</small></td>' +
        '<td>' + (pAnular ? '<button class="tc-mini mal" data-movan="' + x.id + '">Anular</button>' : '') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function htmlFotos(p) {
    var L = p.adjuntos || [];
    var sube = puedeObra(p.obra_clave) || puede('bodega') || puede('compras');
    var h = '';
    if (sube) h += '<div class="tc-acc" style="justify-content:flex-start;margin-bottom:10px"><label class="tc-btn" style="cursor:pointer">📷 Agregar fotos<input type="file" id="adjFoto" accept="image/*" multiple hidden></label>' +
      (puede('compras') ? '<label class="tc-btn" style="cursor:pointer">📄 Cotización / factura (PDF o foto)<input type="file" id="adjDoc" accept="application/pdf,image/*" multiple hidden></label>' : '') +
      '<label class="tc-btn" style="cursor:pointer">🧾 Remito / entrega<input type="file" id="adjEnt" accept="application/pdf,image/*" multiple hidden></label></div>';
    if (!L.length) return h + '<div class="tc-vacio">Sin fotos ni archivos.</div>';
    var grupos = [['foto', 'Fotos del pedido'], ['cotizacion', 'Cotizaciones'], ['compra', 'Compra (OC / factura)'], ['entrega', 'Entregas / remitos'], ['otro', 'Otros']];
    grupos.forEach(function (g) {
      var de = L.filter(function (a) { return a.tipo === g[0]; }); if (!de.length) return;
      h += '<div class="tc-sec"><h4>' + g[1] + '</h4><div class="tc-fotos">' + de.map(function (a) {
        var quita = a.subido_por === YO.uid || puede('super');
        return '<div class="tc-foto" title="' + esc(a.nombre + ' · ' + (a.subido_nombre || '') + ' · ' + fdt(a.subido_en)) + '"><div class="im" data-ver="' + a.id + '">' + (/^image\//.test(a.mime || '') ? '<img data-ruta="' + esc(a.ruta) + '" alt="">' : '📄') + '</div>' +
          '<div class="nm">' + esc(a.nombre || '') + '</div>' + (quita ? '<button data-quitar="' + a.id + '" title="Quitar">✕</button>' : '') + '</div>';
      }).join('') + '</div></div>';
    });
    return h;
  }

  function htmlHistorial(p) {
    var L = (p.eventos || []).slice().reverse();
    return L.map(function (e) { return '<div class="tc-ev"><b>' + esc(e.titulo) + '</b><small>' + fdt(e.en) + ' · ' + esc(e.actor_nombre || '') + '</small>' + (e.detalle ? '<div class="d">' + esc(e.detalle) + '</div>' : '') + '</div>'; }).join('') || '<div class="tc-vacio">Sin historial.</div>';
  }

  // ------------------------------------------------------------ acciones de la ficha
  function enlazarFicha(m, p, S) {
    var g = function (id) { var e = $('#' + id, m); return e ? e.value.trim() : ''; };
    var hacer = async function (btn, acc, datos, okMsg, tab) {
      ocupado(btn, true);
      try { await accion(p, acc, datos, btn.dataset.op || (btn.dataset.op = uuid())); if (okMsg) toast(okMsg); recargarFicha(p.id, tab); }
      catch (e) { ocupado(btn, false); if (!e.conflicto) toast(esc(e.message)); }
    };
    $$('[data-irtab]', m).forEach(function (b) { b.onclick = function () { DTAB = b.getAttribute('data-irtab'); pintarFicha(m); }; });
    // bodega
    $$('[data-bod]', m).forEach(function (b) {
      b.onclick = function () {
        var acc = b.getAttribute('data-bod'), st = g('sg_stock'), mot = g('sg_motivo');
        var stn = st ? parseNum(st) : null;
        if (st && (isNaN(stn) || stn < 0)) return toast('El stock tiene que ser un número.');
        if ((acc === 'bodega_revision' || acc === 'bodega_rechazar') && !mot) return toast('Escribí el motivo: lo ve el solicitante.');
        if (acc === 'bodega_stock' && (stn === null || stn <= 0)) return toast('Indicá cuánto stock hay para este pedido. Si no hay nada, derivá a compras.');
        if (acc === 'bodega_stock' && stn < n(p.cantidad) && !confirm('Hay ' + fq(stn) + ' de ' + fq(p.cantidad) + ' ' + p.unidad + ' pedidos.\nSe envía lo que hay y después se cierra con lo entregado. ¿Seguir?')) return;
        if (acc === 'bodega_rechazar' && !confirm('¿Rechazar el pedido ' + p.codigo + '?')) return;
        hacer(b, acc, { stock: stn, motivo: mot }, { bodega_stock: 'Se atiende desde stock: queda para enviar.', bodega_compra: 'Derivado a compras.', bodega_revision: 'Se pidió aclaración al solicitante.', bodega_rechazar: 'Pedido rechazado.' }[acc]);
      };
    });
    var v = $('#sgVolver', m); if (v) v.onclick = function () { var mot = prompt('¿Por qué se deshace la decisión de bodega?'); if (mot && mot.trim()) hacer(v, 'bodega_volver', { motivo: mot.trim() }, 'El pedido vuelve a pendiente de bodega.'); };
    $$('[data-ucc]', m).forEach(function (b) {
      b.onclick = function () {
        var acc = b.getAttribute('data-ucc'), mot = g('sg_motivo');
        if (!mot) return toast('Escribí el motivo: lo ve el solicitante.');
        if (acc === 'ucc_rechazar' && !confirm('¿Rechazar el pedido ' + p.codigo + '?')) return;
        hacer(b, acc, { motivo: mot }, acc === 'ucc_rechazar' ? 'Pedido rechazado.' : 'Se pidió aclaración al solicitante.');
      };
    });
    var ra = $('#sgReabrir', m); if (ra) ra.onclick = function () { var mot = prompt('¿Por qué se reabre ' + p.codigo + '?'); if (mot && mot.trim()) hacer(ra, 'ucc_reabrir', { motivo: mot.trim() }, 'El pedido vuelve a compras.'); };
    var ci = $('#sgCierre', m); if (ci) ci.onclick = function () {
      var mot = prompt('Cerrar ' + p.codigo + ' con lo entregado. Motivo (por qué se entrega menos de lo pedido):');
      if (mot && mot.trim()) hacer(ci, 'cerrar_parcial', { motivo: mot.trim() }, 'Pedido cerrado con lo entregado.');
    };
    var cd = $('#sgCierreDeshacer', m); if (cd) cd.onclick = function () { var mot = prompt('¿Por qué se deshace el cierre de ' + p.codigo + '?'); if (mot && mot.trim()) hacer(cd, 'cierre_deshacer', { motivo: mot.trim() }, 'El pedido vuelve a entrega.'); };
    var ed = $('#sgEditar', m); if (ed) ed.onclick = function () { formPedido(p); };
    var an = $('#sgAnular', m); if (an) an.onclick = function () { var mot = prompt('Motivo para anular ' + p.codigo + ':'); if (mot && mot.trim()) hacer(an, 'anular', { motivo: mot.trim() }, 'Pedido anulado.'); };
    // autorización
    $$('[data-aut]', m).forEach(function (b) {
      b.onclick = function () {
        var d = b.getAttribute('data-aut'), mot = g('sg_motivo'), a = ultimaAut(p, 'pendiente');
        if (d === 'devolver' && !mot) return toast('Escribí el motivo para devolver a compras.');
        hacer(b, 'aut_resolver', { autorizacion_id: a.id, decision: d, motivo: mot }, d === 'autorizar' ? 'Compra autorizada.' : 'Devuelto a compras.');
      };
    });
    // compra
    var cp = $('#cpOk', m); if (cp) cp.onclick = function () {
      var caja = $('input[name=cp_caja]:checked', m);
      if (!g('cp_doc_numero')) return toast('Indicá el número del documento.');
      if (!g('cp_fecha')) return toast('Indicá la fecha de compra.');
      if (!caja) return toast('Indicá si se pagó con caja chica (sí o no).');
      hacer(cp, 'compra_registrar', { doc_tipo: g('cp_doc_tipo'), doc_numero: g('cp_doc_numero'), fecha_compra: g('cp_fecha'), ruta: g('cp_ruta') || null, uso_caja_chica: caja.value === 'si' }, 'Compra registrada.', 'movimientos');
    };
    var cc = $('#ccOk', m); if (cc) cc.onclick = function () {
      if (!g('cc_motivo')) return toast('Indicá el motivo de la corrección.');
      var d = { doc_tipo: g('cc_doc_tipo'), doc_numero: g('cc_doc_numero'), fecha_compra: g('cc_fecha'), motivo: g('cc_motivo') };
      if (g('cc_caja')) d.uso_caja_chica = g('cc_caja') === 'si';
      hacer(cc, 'compra_corregir', d, 'Compra corregida.', 'compra');
    };
    var cr = $('#ccRuta', m); if (cr) cr.onclick = function () { if (g('cc_ruta') !== p.ruta) hacer(cr, 'ruta_cambiar', { ruta: g('cc_ruta') }, 'Ruta de entrega cambiada.', 'compra'); };
    // cotizaciones
    var cn = $('#cotNueva', m); if (cn) cn.onclick = function () { formCotizacion(p, null); };
    $$('[data-cotadj]', m).forEach(function (b) { b.onclick = function () { verAdjuntos(adjCot(p, b.getAttribute('data-cotadj')), 0); }; });
    $$('[data-coted]', m).forEach(function (b) { b.onclick = function () { formCotizacion(p, p.cotizaciones.filter(function (c) { return c.id === b.getAttribute('data-coted'); })[0]); }; });
    $$('[data-cotan]', m).forEach(function (b) {
      b.onclick = function () {
        var c = p.cotizaciones.filter(function (x) { return x.id === b.getAttribute('data-cotan'); })[0];
        if (!confirm('¿Anular la cotización de ' + c.proveedor_nombre + '?' + (p.aut_id && ultimaAut(p).cotizacion_id === c.id ? '\nEs la elegida: la autorización queda sin efecto.' : ''))) return;
        hacer(b, 'cot_anular', { id: c.id }, 'Cotización anulada.', 'cotizaciones');
      };
    });
    var ap = $('#auPedir', m); if (ap) ap.onclick = function () {
      if (!g('au_motivo')) return toast('Escribí por qué se elige esta oferta.');
      hacer(ap, 'aut_solicitar', { cotizacion_id: g('au_cot'), motivo: g('au_motivo') }, 'Autorización pedida.', 'resumen');
    };
    // movimientos
    $$('[data-mov]', m).forEach(function (b) { b.onclick = function () { formMovimiento(p, b.getAttribute('data-mov')); }; });
    $$('[data-movan]', m).forEach(function (b) {
      b.onclick = function () {
        var mot = prompt('Motivo para anular el movimiento:'); if (!mot || !mot.trim()) return;
        hacer(b, 'mov_anular', { movimiento_id: b.getAttribute('data-movan'), motivo: mot.trim() }, 'Movimiento anulado.', 'movimientos');
      };
    });
    // archivos
    [['adjFoto', 'foto'], ['adjDoc', null], ['adjEnt', 'entrega']].forEach(function (x) {
      var inp = $('#' + x[0], m); if (!inp) return;
      inp.onchange = async function () {
        var files = Array.prototype.slice.call(inp.files || []); if (!files.length) return;
        toast('Subiendo ' + files.length + ' archivo(s)…');
        var tipo = x[1] || (p.comprado ? 'compra' : 'cotizacion');
        var ok = 0;
        for (var i = 0; i < files.length; i++) { try { await subirArchivo(p.id, files[i], tipo); ok++; } catch (e) { toast(esc(files[i].name) + ': ' + esc(e.message)); } }
        if (ok) { toast(ok + ' archivo(s) subidos.'); recargarFicha(p.id, 'fotos'); }
      };
    });
    $$('[data-quitar]', m).forEach(function (b) {
      b.onclick = async function (ev) {
        ev.stopPropagation();
        if (!confirm('¿Quitar este archivo de la ficha? (queda en el historial)')) return;
        try { await rpc('tc_adjunto_quitar', { p_adjunto: b.getAttribute('data-quitar'), p_motivo: '' }); recargarFicha(p.id, 'fotos'); } catch (e) { toast(esc(e.message)); }
      };
    });
    $$('[data-ver]', m).forEach(function (d) {
      d.onclick = function () {
        var L = p.adjuntos || [], i = L.map(function (a) { return a.id; }).indexOf(d.getAttribute('data-ver'));
        verAdjuntos(L, i);
      };
    });
  }

  // archivos vinculados a una cotización (tc_adjunto.ref_id = id de la cotización)
  function adjCot(p, cotId) { return (p.adjuntos || []).filter(function (a) { return a.ref_id === cotId; }); }
  function verAdjuntos(L, i) {
    if (!global.Visor || !L.length) return;
    global.Visor.abrir(L.map(function (a) { return { nombre: a.nombre, mime: a.mime, obtenerUrl: function () { return urlFirmada(a.ruta); } }; }), Math.max(0, i || 0));
  }

  function formCotizacion(p, c) {
    var v = c || { moneda: 'PYG', impuesto: 'incluido', unidad: p.unidad };
    var provs = CAT.proveedores.filter(function (x) { return x.activo !== false; });
    var yaAdj = c ? adjCot(p, c.id) : [], nuevos = [];
    var m = modal('<div class="tc-hd"><div class="t"><h3>' + (c ? 'Modificar cotización' : 'Nueva cotización') + '</h3><div class="sub">' + esc(p.codigo) + ' · ' + esc(p.descripcion) + ' · ' + fq(p.cantidad) + ' ' + esc(p.unidad) + '</div></div><button class="tc-x" data-cerrar>✕</button></div>' +
      '<div class="tc-g">' +
      f('Proveedor *', '<input id="co_prov" list="tcProvs" value="' + esc(v.proveedor_nombre || '') + '"><datalist id="tcProvs">' + provs.map(function (x) { return '<option value="' + esc(x.nombre) + '">' + esc(x.categoria || '') + '</option>'; }).join('') + '</datalist>', 'w2') +
      f('Moneda', '<select id="co_moneda"><option value="PYG"' + (v.moneda === 'PYG' ? ' selected' : '') + '>Guaraníes</option><option value="USD"' + (v.moneda === 'USD' ? ' selected' : '') + '>Dólares</option></select>') +
      f('Impuesto', '<select id="co_impuesto">' + [['incluido', 'IVA incluido'], ['no_incluido', 'Sin IVA'], ['exento', 'Exento']].map(function (x) { return '<option value="' + x[0] + '"' + (v.impuesto === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>') +
      f('Precio unitario *', '<input id="co_precio" inputmode="decimal" value="' + esc(v.precio_unit != null ? String(v.precio_unit).replace('.', ',') : '') + '">') +
      f('Unidad de la oferta', '<input id="co_unidad" value="' + esc(v.unidad || p.unidad) + '">') +
      f('Plazo de entrega (días)', '<input id="co_plazo" inputmode="numeric" value="' + esc(v.plazo_dias != null ? v.plazo_dias : '') + '">') +
      f('Condiciones', '<input id="co_cond" value="' + esc(v.condiciones || '') + '" placeholder="ej.: crédito 30 días">', 'w2') +
      f('Nota', '<input id="co_nota" value="' + esc(v.nota || '') + '">', 'w2') +
      '<div class="tc-f w4"><label>Total</label><div class="v" id="co_total"></div></div></div>' +
      '<div class="tc-adj" id="co_adj"><label class="tc-btn" style="cursor:pointer">📎 Adjuntar cotización (PDF o foto)<input type="file" id="co_files" accept="application/pdf,image/*" multiple hidden></label>' +
      '<span class="ay">o arrastrá los archivos acá · hasta 10 MB c/u</span><div class="lst" id="co_lst"></div></div>' +
      (c && p.aut_id && ultimaAut(p).cotizacion_id === c.id ? '<div class="tc-info" style="margin-top:8px">Es la oferta elegida: al modificarla, la autorización queda sin efecto.</div>' : '') +
      '<div class="tc-acc"><button class="tc-btn" data-cerrar>Cancelar</button><button class="tc-btn pri" id="coOk">Guardar</button></div>', true);
    var g = function (k) { return $('#co_' + k, m).value.trim(); };
    var fl0 = n(v.flete);   // flete de cotizaciones viejas: se conserva tal cual (ya no se edita)
    var calc = function () { var pu = parseNum(g('precio')); $('#co_total', m).textContent = pu && !isNaN(pu) ? fm(pu * n(p.cantidad) + fl0, g('moneda')) + ' (' + fq(p.cantidad) + ' × precio' + (fl0 ? ' + flete ' + fm(fl0, g('moneda')) + ' cargado antes' : '') + ')' : '—'; };
    $$('input,select', m).forEach(function (e) { e.addEventListener('input', calc); }); calc();
    // archivos: los ya subidos se ven (y se pueden quitar si los subiste vos); los nuevos se suben al guardar
    var pintarAdj = function () {
      $('#co_lst', m).innerHTML = yaAdj.map(function (a, i) {
        var quita = a.subido_por === YO.uid || puede('super');
        return '<div class="ar">' + (/^image\//.test(a.mime || '') ? '🖼️' : '📄') + '<span class="lk" data-ya="' + i + '" title="' + esc(a.nombre + ' · ' + (a.subido_nombre || '') + ' · ' + fdt(a.subido_en)) + '">' + esc(a.nombre || 'archivo') + '</span>' +
          (quita ? '<button data-yaq="' + a.id + '" title="Quitar">✕</button>' : '') + '</div>';
      }).join('') + nuevos.map(function (fi, i) {
        return '<div class="ar">' + (/pdf/i.test(fi.type) || /\.pdf$/i.test(fi.name) ? '📄' : '🖼️') + '<span title="Se sube al guardar">' + esc(fi.name) + '</span><small style="color:#6b7487">nuevo</small><button data-nq="' + i + '" title="Sacar">✕</button></div>';
      }).join('');
      $$('[data-ya]', m).forEach(function (x) { x.onclick = function () { verAdjuntos(yaAdj, +x.getAttribute('data-ya')); }; });
      $$('[data-nq]', m).forEach(function (x) { x.onclick = function () { nuevos.splice(+x.getAttribute('data-nq'), 1); pintarAdj(); }; });
      $$('[data-yaq]', m).forEach(function (x) {
        x.onclick = async function () {
          if (!confirm('¿Quitar este archivo de la cotización? (queda en el historial)')) return;
          try { await rpc('tc_adjunto_quitar', { p_adjunto: x.getAttribute('data-yaq'), p_motivo: 'quitado de la cotización' }); yaAdj = yaAdj.filter(function (a) { return a.id !== x.getAttribute('data-yaq'); }); p.adjuntos = (p.adjuntos || []).filter(function (a) { return a.id !== x.getAttribute('data-yaq'); }); pintarAdj(); }
          catch (e) { toast(esc(e.message)); }
        };
      });
    };
    var agregar = function (lista) {
      Array.prototype.slice.call(lista || []).forEach(function (fi) {
        if (!(/pdf/i.test(fi.type) || /\.pdf$/i.test(fi.name) || /^image\//i.test(fi.type))) return toast(esc(fi.name) + ': solo PDF o imágenes.');
        nuevos.push(fi);
      });
      pintarAdj();
    };
    var inp = $('#co_files', m); inp.onchange = function () { agregar(inp.files); inp.value = ''; };
    var zona = $('#co_adj', m);
    zona.addEventListener('dragover', function (e) { e.preventDefault(); zona.classList.add('sobre'); });
    zona.addEventListener('dragleave', function () { zona.classList.remove('sobre'); });
    zona.addEventListener('drop', function (e) { e.preventDefault(); zona.classList.remove('sobre'); agregar(e.dataTransfer && e.dataTransfer.files); });
    pintarAdj();
    $('#coOk', m).onclick = async function () {
      var btn = this, pu = parseNum(g('precio'));
      if (!g('prov')) return toast('Indicá el proveedor.');
      if (pu === null || isNaN(pu) || pu < 0) return toast('Indicá el precio unitario.');
      var prov = provs.filter(function (x) { return x.nombre.toLowerCase() === g('prov').toLowerCase(); })[0];
      var antes = (p.cotizaciones || []).map(function (x) { return x.id; });
      ocupado(btn, true);
      var cotId = c ? c.id : btn.dataset.cot || null;
      try {
        if (!btn.dataset.guardado) {
          await accion(p, 'cot_guardar', { id: c ? c.id : null, proveedor_id: prov ? prov.id : null, proveedor_nombre: g('prov'), precio_unit: pu, flete: fl0,
            moneda: g('moneda'), impuesto: g('impuesto'), unidad: g('unidad'), plazo_dias: g('plazo'), condiciones: g('cond'), nota: g('nota') }, btn.dataset.op || (btn.dataset.op = uuid()));
          btn.dataset.guardado = '1';
        }
      } catch (e) { ocupado(btn, false); if (!e.conflicto) toast(esc(e.message)); return; }
      if (nuevos.length) {
        // la cotización nueva: la que no estaba antes de guardar (la base devuelve el id del pedido, no el de la cotización)
        if (!cotId) {
          try {
            var d = await rpc('tc_detalle', { p_pedido: p.id });
            var nueva = (d.cotizaciones || []).filter(function (x) { return antes.indexOf(x.id) < 0 && x.creado_por === YO.uid; })
              .sort(function (a, b) { return String(b.creado_en).localeCompare(String(a.creado_en)); })[0];
            if (nueva) cotId = btn.dataset.cot = nueva.id;
          } catch (e) { /* se sube igual, sin vínculo */ }
        }
        toast('Subiendo ' + nuevos.length + ' archivo(s)…');
        var fallan = [];
        for (var i = 0; i < nuevos.length; i++) {
          try { await subirArchivo(p.id, nuevos[i], 'cotizacion', cotId); }
          catch (e) { fallan.push(nuevos[i]); toast(esc(nuevos[i].name) + ': ' + esc(e.message)); }
        }
        if (fallan.length) {
          // la cotización ya quedó guardada: solo queda reintentar los archivos que no subieron
          nuevos = fallan; pintarAdj(); ocupado(btn, false); btn.textContent = 'Reintentar archivos';
          return;
        }
      }
      m.remove(); toast(c ? 'Cotización modificada.' : 'Cotización cargada.'); recargarFicha(p.id, 'cotizaciones');
    };
  }

  function formMovimiento(p, tipo) {
    var S = saldos(p), mx = S.max[tipo];
    var ayuda = {
      central: 'El proveedor entregó en taller central. Falta recibir del proveedor: ' + fq(S.provPend) + '.',
      envio: 'Sale de central hacia la obra (queda en tránsito hasta que la obra confirme). En central para enviar: <b>' + fq(S.enCentral) + ' de ' + fq(S.Q) + ' ' + esc(p.unidad) + '</b> pedidos.' +
        ' Se puede enviar menos (lo que haya); si no se va a mandar más, después se cierra «con lo entregado».',
      recepcion: 'Confirmá lo que llegó a la obra desde central. En tránsito: ' + fq(S.transito) + '.',
      directa: 'El proveedor entregó directamente en la obra (no pasa por central). Falta del proveedor: ' + fq(S.provPend) + '.',
      servicio: 'Conformidad del servicio realizado. Pendiente: ' + fq(S.pendFinal) + '.'
    }[tipo];
    var receptor = tipo === 'recepcion' || tipo === 'directa' || tipo === 'servicio';
    var m = modal('<div class="tc-hd"><div class="t"><h3>' + MOV[tipo] + '</h3><div class="sub">' + esc(p.codigo) + ' · ' + esc(p.descripcion) + '</div></div><button class="tc-x" data-cerrar>✕</button></div>' +
      '<div class="tc-info">' + ayuda + '</div><div class="tc-g">' +
      f('Cantidad (' + esc(p.unidad) + ') *', '<input id="mv_cant" inputmode="decimal" value="' + String(mx).replace('.', ',') + '">') +
      f('Fecha *', '<input id="mv_fecha" type="date" value="' + hoy() + '">') +
      f(receptor ? 'Recibió' : 'Responsable', '<input id="mv_resp" value="' + esc(receptor ? YO.nombre || '' : '') + '">', 'w2') +
      (tipo === 'envio' ? f('Tipo de documento *', '<select id="mv_doc_tipo">' + DOCS_ENVIO.map(function (d) { return '<option value="' + d[0] + '">' + d[1] + '</option>'; }).join('') + '</select>') +
        f('Número de documento *', '<input id="mv_doc_numero" placeholder="001-001-0000123">') : '') +
      f(tipo === 'envio' ? 'Transporte / chapa / chofer' : 'Referencia (remito, factura…)', '<input id="mv_ref">', 'w2') +
      f('Nota', '<input id="mv_nota">', 'w2') + '</div>' +
      '<div class="tc-acc"><button class="tc-btn" data-cerrar>Cancelar</button><button class="tc-btn pri" id="mvOk">Registrar</button></div>', true);
    var g = function (k) { return $('#mv_' + k, m).value.trim(); };
    $('#mvOk', m).onclick = async function () {
      var btn = this, q = parseNum(g('cant'));
      if (!q || isNaN(q) || q <= 0) return toast('Indicá la cantidad.');
      if (q > mx + 1e-9) return toast('Como máximo ' + fq(mx) + ' ' + esc(p.unidad) + '.');
      var dt = tipo === 'envio' ? g('doc_tipo') : null, dn = tipo === 'envio' ? g('doc_numero') : null;
      if (tipo === 'envio' && !dn) return toast('Indicá el número del documento del envío.');
      ocupado(btn, true);
      try {
        await accion(p, 'mov_registrar', { tipo: tipo, cantidad: q, fecha: g('fecha'), responsable: g('resp'), referencia: g('ref'), nota: g('nota'), doc_tipo: dt, doc_numero: dn }, btn.dataset.op || (btn.dataset.op = uuid()));
        m.remove(); toast(MOV[tipo] + ': ' + fq(q) + ' ' + esc(p.unidad) + '.'); recargarFicha(p.id);
      } catch (e) { ocupado(btn, false); if (!e.conflicto) toast(esc(e.message)); }
    };
  }

  // ------------------------------------------------------------ archivos
  async function achicarImagen(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && !/^image\//i.test(file.type)) return { blob: file, w: null, h: null };
    if (/svg/i.test(file.type)) throw new Error('No se aceptan imágenes SVG.');
    try {
      var bmp = await createImageBitmap(file);
      var k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      var w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.82); });
      return { blob: blob || file, w: w, h: h };
    } catch (e) {
      if (/^image\/(jpeg|png|webp)$/i.test(file.type)) return { blob: file, w: null, h: null };
      throw new Error('Formato de imagen no soportado (usá JPG, PNG o WebP).');
    }
  }
  async function sha256(blob) {
    try { var b = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
    catch (e) { return null; }
  }
  async function subirArchivo(pedidoId, file, tipo, refId) {
    if (file.size > 25 * 1024 * 1024) throw new Error('pesa más de 25 MB.');
    var esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
    var r = esPdf ? { blob: file, w: null, h: null } : await achicarImagen(file);
    if (r.blob.size > 10 * 1024 * 1024) throw new Error('pesa más de 10 MB.');
    var mime = esPdf ? 'application/pdf' : (r.blob.type || file.type);
    var nombre = String(file.name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-70);
    if (!esPdf && mime === 'image/jpeg') nombre = nombre.replace(/\.(png|webp|heic|heif)$/i, '.jpg');
    var ruta = pedidoId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + nombre;
    var up = await sb().storage.from(BUCKET).upload(ruta, r.blob, { contentType: mime, upsert: false });
    if (up.error) throw new Error(/mime|type/i.test(up.error.message || '') ? 'tipo de archivo no permitido (JPG, PNG, WebP o PDF)' : /size|large/i.test(up.error.message || '') ? 'archivo demasiado grande' : up.error.message);
    await rpc('tc_adjunto_registrar', { p_pedido: pedidoId, p_op: uuid(), p: { tipo: tipo, ref_id: refId || null, ruta: ruta, nombre: file.name, sha256: await sha256(r.blob), ancho: r.w, alto: r.h } });
  }
  async function urlFirmada(ruta) {
    var u = URLS[ruta]; if (u && u.t > Date.now()) return u.url;
    var r = await sb().storage.from(BUCKET).createSignedUrl(ruta, 3600);
    if (r.error) throw new Error(r.error.message);
    URLS[ruta] = { url: r.data.signedUrl, t: Date.now() + 55 * 60e3 };
    return r.data.signedUrl;
  }
  async function cargarMiniaturas(m, p) {
    var imgs = $$('img[data-ruta]', m); if (!imgs.length) return;
    var faltan = imgs.map(function (i) { return i.getAttribute('data-ruta'); }).filter(function (r) { return !(URLS[r] && URLS[r].t > Date.now()); });
    if (faltan.length) {
      var r = await sb().storage.from(BUCKET).createSignedUrls(faltan, 3600);
      (r.data || []).forEach(function (x) { if (x.signedUrl) URLS[x.path] = { url: x.signedUrl, t: Date.now() + 55 * 60e3 }; });
    }
    imgs.forEach(function (i) { var u = URLS[i.getAttribute('data-ruta')]; if (u) i.src = u.url; });
  }

  // ------------------------------------------------------------ proveedores
  function htmlProveedores() {
    var L = CAT.proveedores;
    var h = '<div class="tc-info">Proveedores de taller para elegir al cotizar. También se puede escribir uno nuevo directo en la cotización.</div>';
    if (!L.length) return h + '<div class="tc-vacio">Sin proveedores cargados.</div>';
    h += '<div class="tc-tw"><table class="tc-t" style="min-width:800px"><thead><tr><th>Nombre</th><th>RUC</th><th>Rubro</th><th>Contacto</th><th>Teléfono / correo</th><th>Condiciones</th><th></th></tr></thead><tbody>';
    L.forEach(function (p) {
      h += '<tr' + (p.activo === false ? ' style="opacity:.5"' : '') + '><td><b>' + esc(p.nombre) + '</b>' + (p.activo === false ? ' ' + chip('inactivo', 'gr') : '') + '</td><td>' + esc(p.ruc || '') + '</td><td>' + esc(p.categoria || '') + '</td>' +
        '<td>' + esc(p.contacto || '') + '</td><td>' + esc([p.telefono, p.email].filter(Boolean).join(' · ')) + '</td><td>' + esc(p.condiciones || '') + '</td>' +
        '<td>' + (puede('compras') ? '<button class="tc-mini" data-prov="' + p.id + '">✎</button>' : '') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function formProveedor(p) {
    var v = p || {};
    var m = modal('<div class="tc-hd"><div class="t"><h3>' + (p ? 'Editar proveedor' : 'Nuevo proveedor') + '</h3></div><button class="tc-x" data-cerrar>✕</button></div><div class="tc-g">' +
      f('Nombre *', '<input id="pv_nombre" value="' + esc(v.nombre || '') + '">', 'w2') + f('RUC', '<input id="pv_ruc" value="' + esc(v.ruc || '') + '">') +
      f('Rubro', '<input id="pv_categoria" value="' + esc(v.categoria || '') + '">') + f('Contacto', '<input id="pv_contacto" value="' + esc(v.contacto || '') + '">', 'w2') +
      f('Teléfono', '<input id="pv_telefono" value="' + esc(v.telefono || '') + '">') + f('Correo', '<input id="pv_email" value="' + esc(v.email || '') + '">') +
      f('Condiciones', '<input id="pv_condiciones" value="' + esc(v.condiciones || '') + '">', 'w4') +
      (p ? f('Activo', '<select id="pv_activo"><option value="true">Sí</option><option value="false"' + (p.activo === false ? ' selected' : '') + '>No</option></select>') : '') +
      '</div><div class="tc-acc"><button class="tc-btn" data-cerrar>Cancelar</button><button class="tc-btn pri" id="pvOk">Guardar</button></div>', true);
    $('#pvOk', m).onclick = async function () {
      var d = { id: p ? p.id : null };
      ['nombre', 'ruc', 'categoria', 'contacto', 'telefono', 'email', 'condiciones'].forEach(function (k) { d[k] = $('#pv_' + k, m).value.trim(); });
      if ($('#pv_activo', m)) d.activo = $('#pv_activo', m).value === 'true';
      if (!d.nombre) return toast('Indicá el nombre.');
      try { await rpc('tc_proveedor_guardar', { p: d }); var c = await rpc('tc_inicio'); CAT.proveedores = c.proveedores || []; m.remove(); render(); }
      catch (e) { toast(esc(e.message)); }
    };
  }

  // ------------------------------------------------------------ KPIs
  async function cargarKpis() {
    try { KPI = await rpc('tc_kpis', { p: { canal: CANAL, desde: KPI_DESDE || null } }); } catch (e) { KPI = { error: e.message }; }
    if (TAB === 'kpis') render();
  }
  function htmlKpis() {
    if (!KPI) { cargarKpis(); return '<div class="tc-vacio">Cargando…</div>'; }
    if (KPI.error) return '<div class="tc-vacio">' + esc(KPI.error) + '</div>';
    var k = KPI, fz = k.fases || {};
    var d = function (v) { return v === null || v === undefined ? '–' : String(v).replace('.', ','); };
    var abiertos = ABIERTAS.reduce(function (a, f) { return a + n(fz[f]); }, 0);
    var h = '<div class="tc-bar"><label style="font-size:13px">Pedidos desde <input type="date" id="tcKdesde" value="' + esc(KPI_DESDE || k.desde) + '"></label></div>';
    var kc = function (t, big, lbl) { return '<div class="tc-kc"><div class="t">' + t + '</div><div class="big">' + big + '</div><div class="lbl">' + (lbl || '') + '</div></div>'; };
    h += '<div class="tc-kst">' + kc('Pedidos', n(k.n), abiertos + ' en curso · ' + n(fz.cerrado) + ' cerrados') +
      kc('Atrasados en curso', n(k.atrasados_abiertos), 'pasaron la fecha requerida') +
      (UCC ? kc('Rechazados', n(fz.rechazado), n(fz.aclaracion) + ' esperando aclaración') : kc('Desde stock', n(k.desde_stock), 'vs. ' + n(k.por_compra) + ' por compra')) +
      kc('A tiempo', k.con_fecha ? Math.round(n(k.a_tiempo) / n(k.con_fecha) * 100) + ' %' : '–', 'cerrados con fecha requerida (' + n(k.con_fecha) + ')') +
      kc('Caja chica', n(k.caja_chica), 'de ' + n(k.comprados) + ' compras registradas') + '</div>';
    h += '<div class="tc-kst">' + (UCC ? '' : kc('Bodega', d(k.dias_bodega) + ' d', 'pedido → decisión de bodega')) + kc('Cotizar', d(k.dias_cotizar) + ' d', (UCC ? 'pedido' : 'bodega') + ' → pedido de autorización') +
      kc('Autorizar', d(k.dias_autorizar) + ' d', 'pedido → autorización') + kc('Comprar', d(k.dias_comprar) + ' d', 'autorización → compra') +
      kc('Total', d(k.dias_total) + ' d', 'pedido → recibido completo en obra') + '</div>';
    var po = k.por_obra || [];
    if (po.length) h += '<div class="tc-tw" style="max-height:none"><table class="tc-t" style="min-width:600px"><thead><tr><th>Obra</th><th class="r">Pedidos</th><th class="r">En curso</th><th class="r">Atrasados</th><th class="r">Cerrados</th></tr></thead><tbody>' +
      po.map(function (o) { return '<tr><td>' + esc(o.obra_nombre) + '</td><td class="r">' + o.n + '</td><td class="r">' + o.abiertos + '</td><td class="r' + (o.atrasados ? ' tc-neg' : '') + '">' + o.atrasados + '</td><td class="r">' + o.cerrados + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }

  // ------------------------------------------------------------ permisos
  async function cargarPermisos() {
    try { PERM = await rpc('tc_permisos_listar'); } catch (e) { PERM = { error: e.message }; }
    if (TAB === 'permisos') render();
  }
  var CAPS = [['solicitar', 'Pedir / recibir en obra'], ['bodega', 'Bodega central'], ['compras', 'Compras'], ['autorizar', 'Autorizar'], ['ver', 'Solo ver']];
  function porDefecto(u) {
    var d = {}, ob = u.rol_obras, eq = u.rol_equipos, sup = ob === 'admin' || eq === 'admin_central';
    if (sup) CAPS.forEach(function (c) { d[c[0]] = 'admin'; });
    if (eq === 'taller') d.solicitar = 'taller';
    if (eq === 'admin_obra') d.solicitar = 'admin de obra (sus obras)';
    if (ob === 'compras') d.compras = 'rol compras';
    if (ob === 'gerente' || eq === 'gerente' || ob === 'compras') d.ver = d.ver || 'por su rol';
    return d;
  }
  function htmlPermisos() {
    if (!PERM) { cargarPermisos(); return '<div class="tc-vacio">Cargando…</div>'; }
    if (PERM.error) return '<div class="tc-vacio">' + esc(PERM.error) + '</div>';
    var t = PERM_TXT.toLowerCase();
    var L = PERM.filter(function (u) { return !t || (u.nombre + ' ' + u.email + ' ' + (u.rol_obras || '') + ' ' + (u.rol_equipos || '')).toLowerCase().indexOf(t) >= 0; });
    var h = '<div class="tc-info">Quién hace qué en Compras de taller. Lo gris viene del rol que ya tiene la persona (admin de Obras y admin central: todo; taller: pedir; admin de obra de Equipos: pedir para sus obras; compras: compras). ' +
      'Acá se suman permisos: <b>bodega central</b> y <b>autorizar</b> se dan siempre a mano. Quien pide una autorización nunca la puede resolver. Los límites de monto por autorizador todavía no están definidos.</div>' +
      '<div class="tc-bar"><input id="tcPermQ" class="grow" placeholder="Buscar persona…" value="' + esc(PERM_TXT) + '"></div>';
    var obras = CAT.obras;
    h += '<div class="tc-tw"><table class="tc-t tc-perm" style="min-width:1000px"><thead><tr><th>Persona</th><th>Rol Obras / Equipos</th>' + CAPS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th>Obras para pedir</th><th></th></tr></thead><tbody>';
    L.slice(0, 300).forEach(function (u) {
      var d = porDefecto(u), pm = u.permisos || {};
      h += '<tr data-u="' + u.user_id + '"><td><b>' + esc(u.nombre) + '</b><small>' + esc(u.email) + '</small></td><td>' + esc(u.rol_obras || '—') + ' / ' + esc(u.rol_equipos || '—') + '</td>' +
        CAPS.map(function (c) {
          return '<td>' + (d[c[0]] ? '<span class="tc-chip gr" title="' + esc(d[c[0]]) + '">✓ ' + esc(d[c[0]]) + '</span>' : '<input type="checkbox" data-cap="' + c[0] + '"' + (pm[c[0]] ? ' checked' : '') + '>') + '</td>';
        }).join('') +
        '<td><select multiple size="2" data-obras>' + obras.map(function (o) { return '<option value="' + esc(o.clave) + '"' + ((pm.solicitar || []).indexOf(o.clave) >= 0 ? ' selected' : '') + '>' + esc(o.nombre) + '</option>'; }).join('') + '</select><small>ninguna = todas</small></td>' +
        '<td><button class="tc-mini" data-permsave="' + u.user_id + '">Guardar</button></td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  async function guardarPermiso(uid) {
    var tr = $('tr[data-u="' + uid + '"]', EL); if (!tr) return;
    var caps = $$('[data-cap]', tr).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-cap'); });
    var u = PERM.filter(function (x) { return x.user_id === uid; })[0];
    Object.keys(u.permisos || {}).forEach(function (k) { if (!$('[data-cap="' + k + '"]', tr) && caps.indexOf(k) < 0) caps.push(k); });   // conserva los que el rol ya cubre
    var obras = Array.prototype.slice.call($('[data-obras]', tr).selectedOptions || []).map(function (o) { return o.value; });
    try { await rpc('tc_permiso_guardar', { p_user: uid, p_capacidades: caps, p_obras: obras }); toast('Permisos de ' + esc(u.nombre) + ' guardados.'); PERM = null; cargarPermisos(); }
    catch (e) { toast(esc(e.message)); }
  }

  // ------------------------------------------------------------ Excel
  async function excel() {
    if (!global.ExcelJS) return toast('Falta ExcelJS.');
    try {
      var r = await rpc('tc_listar', { p: { canal: CANAL, bandeja: TAB, fase: FIL.fase === 'activos' && TAB !== 'pedidos' ? null : FIL.fase, obra: FIL.obra || null, q: FIL.q || null, mios: FIL.mios, limite: 1000 } });
      var wb = new global.ExcelJS.Workbook(), ws = wb.addWorksheet(UCC ? 'Estratégicas UCC' : 'Compras de taller');
      ws.columns = [['Pedido', 14], ['Obra / destino', 34], ['Fecha', 11], ['Requerido', 11], ['Prioridad', 10], ['Repuesto / servicio', 40], ['Código', 16], ['Marca / modelo', 18],
        ['Equipo', 12], ['OT', 9], ['Cantidad', 10], ['Unidad', 8], ['Solicitante', 24], ['Etapa', 16], [UCC ? 'Revisión' : 'Bodega', 14], ['Stock verificado', 10], ['Cotizaciones', 8],
        ['Autorización', 12], ['Proveedor', 26], ['Moneda', 7], ['Total', 14], ['Documento', 18], ['Fecha compra', 11], ['Caja chica', 9], ['Ruta', 10],
        ['Recibido en obra', 10], ['En tránsito', 10], ['Falta del proveedor', 10]].map(function (c) { return { header: c[0], width: c[1] }; });
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2744' } };
      (r.filas || []).forEach(function (p) {
        var S = saldos(p);
        ws.addRow([p.codigo, p.obra_nombre, p.creado_en ? new Date(p.creado_en) : null, p.fecha_requerida ? new Date(p.fecha_requerida + 'T12:00:00') : null, p.prioridad,
          p.descripcion, p.codigo_repuesto || '', p.marca_modelo || '', p.equipo_id || p.equipo_texto || '', p.ot_numero || '', n(p.cantidad), p.unidad, p.solicitante_nombre,
          (NFASE[p.fase] || [0, p.fase])[1], p.estado, p.bodega_stock, p.n_cotizaciones, p.aut_estado || '', p.compra_proveedor || p.aut_proveedor || '',
          p.compra_moneda || p.aut_moneda || '', p.compra_total != null ? n(p.compra_total) : p.aut_total != null ? n(p.aut_total) : null,
          p.comprado ? (p.doc_tipo || '').toUpperCase() + ' ' + (p.doc_numero || '') : '', p.fecha_compra ? new Date(p.fecha_compra + 'T12:00:00') : null,
          p.uso_caja_chica === true ? 'Sí' : p.uso_caja_chica === false ? 'No' : '', p.estado === 'stock' ? 'stock' : p.comprado ? p.ruta : '', S.enObra, S.transito, S.provPend]);
      });
      [3, 4, 23].forEach(function (c) { ws.getColumn(c).numFmt = 'dd/mm/yy'; });
      ws.getColumn(21).numFmt = '#,##0';
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: 'A1', to: 'AB1' };
      var buf = await wb.xlsx.writeBuffer();
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = (UCC ? 'compras_estrategicas_ucc_' : 'compras_taller_') + hoy() + '.xlsx'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { toast('No se pudo armar el Excel: ' + esc(e.message)); }
  }

  return { abrir: abrir, _saldos: saldos, _movsPosibles: function (p, yo) { var y = YO; YO = yo; try { return movsPosibles(p); } finally { YO = y; } } };
  }

  global.TallerCompras = fabrica('taller');
  global.ComprasUCC = fabrica('ucc');
})(window);
