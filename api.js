/* =========================================================================
 * api.js — cliente de la PWA hacia el Apps Script gatekeeper
 * Configurado con tu Web App real.
 * ========================================================================= */
(function (global) {

  // ---- CONFIGURACIÓN ----
  var API_URL = 'https://script.google.com/macros/s/AKfycbyDeDgN6HSfHEaIHP1YwOIkaj0qMh_SAYBnykrW6wgFko_KaWAK6LBScYom76ojGoP8/exec';
  var OBRA_ID = '1012500000';   // obra por defecto (se puede cambiar en runtime)
  var API_KEY = '';             // opcional: si en Config ponés param:api_key, pegá el mismo valor acá

  function config(url, obraId, apiKey) {
    if (url) API_URL = url;
    if (obraId) OBRA_ID = obraId;
    if (apiKey !== undefined) API_KEY = apiKey;
  }
  function getObraId() { return OBRA_ID; }
  function setObraId(id) { OBRA_ID = id; }

  /* ---- sesión: token guardado en el navegador, viaja en cada request ---- */
  var TOKEN = '';
  try { TOKEN = localStorage.getItem('obra_token') || ''; } catch (e) {}
  function setToken(t) {
    TOKEN = t || '';
    try { t ? localStorage.setItem('obra_token', t) : localStorage.removeItem('obra_token'); } catch (e) {}
  }

  /* Apps Script no responde bien al preflight CORS.
     Usamos text/plain (request "simple") para evitarlo. */
  function post(action, payload, obraId) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: action,
        obra_id: obraId !== undefined ? obraId : OBRA_ID,
        api_key: API_KEY,
        token: TOKEN,
        payload: payload || {}
      })
    })
    .then(function (r) { return r.text(); })
    .then(function (t) {
      var j;
      try { j = JSON.parse(t); }
      catch (e) { throw new Error('Respuesta no-JSON del script (¿está publicado como "Cualquiera con el enlace"?)'); }
      if (!j.ok) {
        if (j.error === 'auth_required') {
          setToken('');                                   // sesión vencida o inexistente
          if (global.__showLogin) global.__showLogin();   // mostrar pantalla de ingreso
        }
        throw new Error(j.error || 'Error del API');
      }
      return j;
    });
  }

  var API = {
    config: config,
    getObraId: getObraId,
    setObraId: setObraId,
    get url() { return API_URL; },

    login: function (usuario, pass) {
      return post('login', { usuario: usuario, pass: pass })
        .then(function (j) { setToken(j.token); return { usuario: j.usuario, rol: j.rol }; });
    },
    logout: function () { setToken(''); },
    hasToken: function () { return !!TOKEN; },

    whoami: function () { return post('whoami').then(function (j) { return { user: j.user, role: j.role }; }); },
    listObras: function () { return post('listObras').then(function (j) { return j.obras; }); },
    getObra: function (obraId) { return post('getObra', {}, obraId).then(function (j) { return j.data; }); },

    crearObra: function (obra) { return post('crearObra', { obra: obra }).then(function (j) { return j.obra; }); },

    saveItems: function (items, dist, deps) {
      return post('saveItems', { items: items, dist: dist, deps: deps }).then(function (j) { return j.saved; });
    },
    deleteItems: function (ids) { return post('deleteItems', { ids: ids }).then(function (j) { return j.deleted; }); },
    saveWeekly: function (rows, deleted) {
      return post('saveWeekly', { rows: rows, deleted: deleted || [] }).then(function (j) { return j.saved; });
    },
    saveBaseline: function (name, items) {
      return post('saveBaseline', { name: name, items: items }).then(function (j) { return j.baseline; });
    },
    saveCategorias: function (cats) { return post('saveCategorias', { categorias: cats }).then(function (j) { return j.saved; }); },
    refreshProduccion: function () { return post('refreshProduccion').then(function (j) { return j.updated; }); },

    /* ---- serialización del modelo de app.js al formato del backend ---- */
    serializeItems: function (ITEMS) {
      var items = [], dist = [], deps = [];
      ITEMS.forEach(function (i, k) {
        items.push({
          id: i.id, desc: i.desc, id_nivel3: i.id_nivel3 || '', desc_nivel3: i.desc_nivel3 || '',
          codigo_cc: i.codigo_cc || '', um: i.um || '', cant: i.cant || 0, pu: i.pu || 0,
          incidencia: (i.incidencia == null ? '' : i.incidencia),
          cat: i.cat || '', estado: i.estado || '',
          ini: i.ini || '', fin: i.fin || '', avance_esperado: (i.avE == null ? '' : i.avE),
          nivel: i.nivel || 1, es_grupo: i.es_grupo ? 1 : '',
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
    }
  };

  global.ObraAPI = API;
})(window);
