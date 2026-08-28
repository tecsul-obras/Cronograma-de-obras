/* =========================================================================
 * api.js — cliente de la PWA hacia el Apps Script gatekeeper
 * Configurado con tu Web App real.
 * ========================================================================= */
(function (global) {

  // ---- CONFIGURACIÓN ----
  var API_URL = 'https://script.google.com/macros/s/AKfycbxi0NEunsEIBHx4WWrOPwiG8dhcYmEWpYqBkAXNDPladJLSyqCOnk_lWLfjnf9oTq1Z/exec';
  var OBRA_ID = '1012500000';   // obra por defecto (se puede cambiar en runtime)
  // recordar la última obra elegida: clave para que un arranque SIN conexión
  // busque en el caché la obra correcta (no siempre la de por defecto).
  try { var _lastObra = localStorage.getItem('obra_current'); if (_lastObra) OBRA_ID = _lastObra; } catch (e) {}
  var API_KEY = '';             // opcional: si en Config ponés param:api_key, pegá el mismo valor acá

  /* Saca el tramo /u/N/ que Google mete cuando copiás la URL desde un navegador
     con varias cuentas abiertas. Esa forma de la URL ata la llamada a una
     cuenta concreta y rompe el acceso anónimo. */
  function limpiarUrl_(u) {
    return String(u || '').replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');
  }
  API_URL = limpiarUrl_(API_URL);

  function config(url, obraId, apiKey) {
    if (url) API_URL = limpiarUrl_(url);
    if (obraId) OBRA_ID = obraId;
    if (apiKey !== undefined) API_KEY = apiKey;
  }
  function getObraId() { return OBRA_ID; }
  function setObraId(id) { OBRA_ID = id; try { localStorage.setItem('obra_current', id); } catch (e) {} }

  /* ---- revisión del cronograma de la obra abierta ----
     Es la versión que este navegador tiene cargada. Viaja en cada guardado del
     cronograma; si en el servidor ya cambió, el guardado se rechaza en vez de
     pisar el trabajo de otra persona. Se actualiza al cargar la obra y después
     de cada guardado propio exitoso. */
  var BASE_REV = null;
  function setBaseRev(r) { BASE_REV = (r === undefined || r === null || r === '') ? null : Number(r); }
  function getBaseRev() { return BASE_REV; }

  /* ---- sesión: token guardado en el navegador, viaja en cada request ---- */
  var TOKEN = '';
  try { TOKEN = localStorage.getItem('obra_token') || ''; } catch (e) {}
  function setToken(t) {
    TOKEN = t || '';
    try { t ? localStorage.setItem('obra_token', t) : localStorage.removeItem('obra_token'); } catch (e) {}
  }

  /* Apps Script no responde bien al preflight CORS.
     Usamos text/plain (request "simple") para evitarlo.

     credentials:'omit' — NO mandar cookies de sesión de Google en la llamada.
     Sin esto, cuando el navegador tiene varias cuentas de Google abiertas,
     Google enruta el 302 de /exec hacia .../u/N/... según la cuenta ACTIVA;
     si esa cuenta no es la dueña del script, el destino final
     (script.googleusercontent.com/macros/echo?user_content_key=...) responde
     404 y la app cae en "Sin conexión" sin causa visible. Con 'omit' la
     llamada es siempre anónima, que es justo lo que la implementación espera
     ("Ejecutar como: Yo" + "Quién tiene acceso: Cualquier usuario"), y el
     enrutamiento por cuenta deja de existir. La seguridad real no cambia:
     vive en el token de sesión y en la validación server-side de Code.gs,
     no en el login de Google del navegador. */
  // acciones que reemplazan el cronograma entero de la obra: son las que se pisan
  var CON_REVISION = { saveItems:1, saveWeekly:1, saveCategorias:1 };

  function post(action, payload, obraId) {
    var cuerpo = {
      action: action,
      obra_id: obraId !== undefined ? obraId : OBRA_ID,
      api_key: API_KEY,
      token: TOKEN,
      payload: payload || {}
    };
    // solo si es la obra abierta: un trabajo encolado para OTRA obra no puede
    // validarse contra la revisión de ésta
    if (CON_REVISION[action] && BASE_REV !== null && String(cuerpo.obra_id) === String(OBRA_ID)) {
      cuerpo.base_rev = BASE_REV;
    }
    return fetch(API_URL, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo)
    })
    .then(function (r) { return r.text().then(function (t) { return { status: r.status, body: t }; }); })
    .then(function (res) {
      var t = res.body, j;
      try { j = JSON.parse(t); }
      catch (e) {
        /* Apps Script devolvió HTML en vez de JSON. Antes el mensaje culpaba
           siempre a la publicación del script, que casi nunca es la causa (si
           no estuviera publicado NADA funcionaría) y mandaba a buscar el
           problema al lugar equivocado. Ahora se muestra lo que de verdad
           llegó: el código HTTP y el texto del error de Google, que es lo que
           permite distinguir un timeout de una falta de autorización.        */
        var err = new Error(descripcionNoJson_(res.status, t, action));
        err.noJson = true;
        err.transitorio = true;   // casi siempre pasajero: NO es un rechazo de negocio
        err.httpStatus = res.status;
        throw err;
      }
      if (!j.ok) {
        if (j.error === 'auth_required') {
          setToken('');                                   // sesión vencida o inexistente
          if (global.__showLogin) global.__showLogin();   // mostrar pantalla de ingreso
        }
        if (j.error === 'conflicto') {
          var c = j.conflicto || {};
          var e2 = new Error('Otra persona guardó esta obra mientras la tenías abierta' +
                             (c.por ? ' (' + c.por + (c.ts ? ', ' + c.ts : '') + ')' : '') + '.');
          e2.conflicto = c;      // app.js lo usa para ofrecer recargar
          throw e2;
        }
        throw new Error(j.error || 'Error del API');
      }
      // guardado propio aceptado: adoptamos la revisión que dejó el servidor
      if (CON_REVISION[action] && j.rev != null) setBaseRev(j.rev);
      return j;
    });
  }

  /* Traduce la página HTML de error de Apps Script a algo accionable. */
  function descripcionNoJson_(status, body, action) {
    var txt = String(body || '');
    var plano = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    var base = action + ': el script no devolvió JSON (HTTP ' + status + ').';
    if (/autoriza|authoriz|permission|permiso/i.test(plano))
      return base + ' Parece un problema de AUTORIZACIÓN: abrí el proyecto en Apps Script, ' +
             'ejecutá cualquier función a mano para volver a autorizar, y volvé a implementar el Web App.';
    if (/exceeded|too many|excedido|demasiad|quota|cuota/i.test(plano))
      return base + ' Se superó un límite de Google (tiempo o ejecuciones simultáneas). ' +
             'Suele resolverse reintentando en unos segundos.';
    if (/error|excepción|exception/i.test(plano))
      return base + ' El script lanzó un error: "' + plano.slice(0, 160) + '". ' +
             'Miralo en Apps Script → Ejecuciones.';
    return base + ' Respuesta: "' + plano.slice(0, 160) + '"';
  }

  /* Reintento con espera creciente, SOLO para lo transitorio y SOLO para
     acciones idempotentes (las que reemplazan un set completo). Repetir un
     append como prodGuardar duplicaría datos, así que esas nunca se reintentan
     acá: de eso se ocupa la cola offline, que sabe si ya se envió. */
  var IDEMPOTENTES = { saveItems:1, saveWeekly:1, saveCategorias:1, saveConfig:1,
                       pistaGuardarTramos:1, pistaGuardarEjes:1, pistaGuardarEstados:1,
                       saveCalendario:1, saveObra:1, certGuardar:1 };
  function postR(action, payload, obraId, intentos) {
    intentos = intentos == null ? 2 : intentos;
    return post(action, payload, obraId).catch(function (err) {
      if (!err || !err.transitorio || !IDEMPOTENTES[action] || intentos <= 0) throw err;
      var espera = (3 - intentos) * 1200 + 800;   // 800ms, 2000ms
      return new Promise(function (r) { setTimeout(r, espera); })
        .then(function () { return postR(action, payload, obraId, intentos - 1); });
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
    getObra: function (obraId) {
      return post('getObra', {}, obraId).then(function (j) {
        // la obra viene con su revisión: desde acá se cuenta para detectar conflictos
        setBaseRev(j.data && j.data.revision ? j.data.revision.rev : null);
        return j.data;
      });
    },
    getBaseRev: getBaseRev,
    setBaseRev: setBaseRev,
    /* Quién más está parado en esta obra ahora. Marca presencia propia y
       devuelve las otras sesiones vivas. Barato: no toca el lock de escritura. */
    presencia: function (obraId) {
      return post('presencia', {}, obraId).then(function (j) {
        return { otros: j.otros || [], editores: j.editores || 0,
                 misOtrasPestanas: j.mis_otras_pestanas || 0,
                 revision: j.revision || null };
      });
    },

    crearObra: function (obra) { return post('crearObra', { obra: obra }).then(function (j) { return j.obra; }); },

    duplicarObra: function (origenId, nueva) {
      return post('duplicarObra', { nueva: nueva }, origenId).then(function (j) { return j.obra; });
    },
    eliminarObra: function (obraId, confirmNombre) {
      return post('eliminarObra', { confirm: confirmNombre }, obraId).then(function (j) { return j.obra; });
    },

    saveItems: function (items, dist, deps) {
      return post('saveItems', { items: items, dist: dist, deps: deps }).then(function (j) { return j.saved; });
    },
    /* Guardado PARCIAL: manda solo las tablas que cambiaron.
       El backend escribe únicamente las claves presentes en el payload, así que
       { items: [...] } no toca DistribucionMensual ni Dependencias.
       Mover una fecha del Gantt dejaba de reescribir ítems × meses de la obra
       entera; ahora reescribe la tabla que corresponde y nada más. */
    /* obraId explícito: la cola offline reenvía trabajos de la obra en la que
       se encolaron, que puede NO ser la obra abierta ahora. Sin este parámetro
       un guardado encolado se escribía en la obra equivocada. */
    saveItemsParcial: function (parcial, obraId) {
      var p = {};
      if (parcial.items) p.items = parcial.items;
      if (parcial.dist)  p.dist  = parcial.dist;
      if (parcial.deps)  p.deps  = parcial.deps;
      if (!p.items && !p.dist && !p.deps) return Promise.resolve(0);
      return postR('saveItems', p, obraId).then(function (j) { return j.saved; });
    },
    /* firma de contenido barata (djb2). Sirve para saber si una tabla cambió
       respecto del último guardado exitoso, sin comparar objeto por objeto. */
    firma: function (obj) {
      var str = JSON.stringify(obj), h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      return h.toString(36) + ':' + str.length;
    },
    deleteItems: function (ids) { return post('deleteItems', { ids: ids }).then(function (j) { return j.deleted; }); },
    saveWeekly: function (rows, deleted, obraId) {
      return postR('saveWeekly', { rows: rows, deleted: deleted || [] }, obraId)
        .then(function (j) { return j.saved; });
    },
    /* tipoLb: 'inicial' | 'convenio' | 'replanificacion'; convenioId opcional.
       Cargar el convenio y crear la línea base son DOS acciones separadas: el
       convenio se etiqueta acá a mano, días después de cargarlo. */
    saveBaseline: function (name, items, tipoLb, convenioId) {
      return post('saveBaseline', { name: name, items: items,
        tipo_lb: tipoLb || '', convenio_id: convenioId || '' })
        .then(function (j) { return j.baseline; });
    },
    borrarBaseline: function (baselineId, confirmNro) {
      return post('borrarBaseline', { baseline_id: baselineId, confirm: confirmNro || '' })
        .then(function (j) { return j.borrada; });
    },
    saveConfig: function (config, obraId) {
      return postR('saveConfig', { config: config }, obraId).then(function (j) { return j.saved; });
    },
    /* calendario laboral de la obra: feriados y excepciones puntuales.
       El panel manda la lista COMPLETA; el backend reemplaza las filas de esta
       obra en la pestaña Calendario y no toca las de las demás. */
    saveCalendario: function (calendario, obraId) {
      return post('saveCalendario', { calendario: calendario || [] }, obraId)
        .then(function (j) { return j.saved; });
    },
    saveCategorias: function (cats, obraId) {
      return postR('saveCategorias', { categorias: cats }, obraId).then(function (j) { return j.saved; });
    },
    refreshProduccion: function () { return post('refreshProduccion').then(function (j) { return j.updated; }); },

    /* ---- PRODUCCIÓN (hoja nueva, formato Power BI) ---- */
    prodListas: function (obraId) {
      return post('prodListas', {}, obraId).then(function (j) {
        // tipo_obra decide contra qué cantidad se topea la certificación
        // (pública = contractual · privada = ajustada). Viene resuelto del backend.
        return { obras: j.obras, items: j.items, estados: j.estados, lados: j.lados,
                 tipoObra: j.tipo_obra || 'privada' };
      });
    },
    // envío directo al servidor (lo usa la cola offline para reenviar sin re-encolar)
    _rawProdGuardar: function (jornada, obraId) {
      return post('prodGuardar', jornada, obraId).then(function (j) {
        return { guardados: j.guardados, submission_id: j.submission_id, fotos_urls: j.fotos_urls || [] };
      });
    },
    // guardado con red de seguridad: si no hay conexión, encola y sigue trabajando
    prodGuardar: function (jornada, obraId) {
      var oid = obraId !== undefined ? obraId : OBRA_ID;
      return this._rawProdGuardar(jornada, oid).catch(function (err) {
        var sinRed = (global.navigator && global.navigator.onLine === false) ||
                     /fetch|network|failed to fetch|load failed|networkerror/i.test((err && err.message) || '');
        if (!sinRed || !global.Outbox) throw err;   // error real de negocio → que lo vea la vista
        var nFotos = (jornada.fotos || []).length;
        // offline: las fotos (pesadas) van a IndexedDB; en la cola de texto solo sus IDs
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
    prodHistorial: function (limite, obraId) {
      return post('prodHistorial', { limite: limite || 300 }, obraId).then(function (j) { return j.registros; });
    },
    prodEditar: function (submissionId, cambios, obraId) {
      return post('prodEditar', { submission_id: submissionId, cambios: cambios }, obraId)
        .then(function (j) { return { editado: j.editado, cantFinal: j.cantFinal }; });
    },
    prodBorrar: function (submissionId, obraId) {
      return post('prodBorrar', { submission_id: submissionId }, obraId).then(function (j) { return j.borrado; });
    },

    /* ---- CERTIFICACIÓN (item × mes) ---- */
    certListar: function (obraId) {
      return post('certListar', {}, obraId).then(function (j) { return { registros: j.registros, meses: j.meses }; });
    },
    certGuardar: function (mes, filas, nroCert, obraId) {
      return post('certGuardar', { mes: mes, filas: filas, nro_certificado: nroCert || '' }, obraId)
        .then(function (j) { return { guardados: j.guardados, mes: j.mes }; });
    },

    /* ---------- COMUNICACIONES (archivo de correspondencia) ----------
       El backend devuelve la dirección (entra/sale), el estado del hilo y los
       KPIs ya calculados: la vista no recalcula nada, solo dibuja. Si mañana
       cambia la definición de "pendiente", cambia en un solo lugar. */
    comListar: function (obraId) {
      return post('comListar', {}, obraId).then(function (j) {
        return { registros: j.registros, kpi: j.kpi, mi_rol: j.mi_rol,
                 partes: j.partes || [], tipos: j.tipos || [], medios: j.medios || [] };
      });
    },
    // sin com_id = alta; con com_id = edición. El backend rechaza editar cerradas.
    comGuardar: function (nota, obraId) {
      return post('comGuardar', nota, obraId)
        .then(function (j) { return { com_id: j.com_id, alta: j.alta }; });
    },
    comCerrar: function (comId, obraId) {
      return post('comCerrar', { com_id: comId }, obraId).then(function (j) { return j.cerrada; });
    },
    comBorrar: function (comId, obraId) {
      return post('comBorrar', { com_id: comId }, obraId).then(function (j) { return j.borrada; });
    },

    /* ---------- SITUACIÓN DE PISTA ----------
       Capa visual por progresivas. El backend devuelve el catálogo de estados
       de la obra (o el propuesto, marcado con estados_default), los ejes con
       sus progresivas, los tramos de todos los ejes y los snapshots.
       Los tramos se guardan por EJE: guardar uno no toca los otros, y el set
       que se manda es completo (reemplazo), así que se puede reintentar. */
    pistaCargar: function (obraId) {
      return post('pistaCargar', {}, obraId).then(function (j) {
        return { activo: j.activo, ejes: j.ejes || [], estados: j.estados || [],
                 estados_default: !!j.estados_default,
                 tramos: j.tramos || [], snapshots: j.snapshots || [] };
      });
    },
    pistaGuardarEjes: function (ejes, obraId) {
      return postR('pistaGuardarEjes', { ejes: ejes }, obraId);
    },
    pistaGuardarEstados: function (estados, obraId) {
      return postR('pistaGuardarEstados', { estados: estados }, obraId);
    },
    pistaGuardarTramos: function (ejeId, tramos, obraId) {
      return postR('pistaGuardarTramos', { eje_id: ejeId, tramos: tramos }, obraId);
    },
    // el snapshot NO se reintenta: es un append y repetirlo duplicaría el punto
    // de la serie (el backend igual lo protege: uno por eje y por día).
    pistaSnapshot: function (ejeId, fecha, nota, resumen, obraId) {
      return post('pistaSnapshot', { eje_id: ejeId, fecha: fecha, nota: nota, resumen: resumen }, obraId);
    },

    /* ---------- convenios modificatorios y plazo ----------
       El sistema PROPONE y el usuario CONFIRMA: nada se escribe sin que el
       preview haya sido aceptado. El convenio tiene peso legal.              */
    saveObra: function (obra, obraId) {
      return post('saveObra', { obra: obra }, obraId).then(function (j) { return j.obra; });
    },
    convListar: function (obraId) {
      return post('convListar', {}, obraId)
        .then(function (j) { return { plazo: j.plazo, detalle: j.detalle }; });
    },
    convSugerir: function (obraId) {
      return post('convSugerir', {}, obraId).then(function (j) { return j.items; });
    },
    convPreview: function (payload, obraId) {
      return post('convPreview', payload, obraId);
    },
    convGuardar: function (payload, obraId) {
      return post('convGuardar', payload, obraId);
    },
    convEstado: function (convenioId, estado, obraId) {
      return post('convEstado', { convenio_id: convenioId, estado: estado }, obraId);
    },
    convBorrar: function (convenioId, confirmNro, obraId) {
      return post('convBorrar', { convenio_id: convenioId, confirm: confirmNro || '' }, obraId);
    },
    convVersion: function (convenioId, obraId) {
      return post('convVersion', { convenio_id: convenioId || '' }, obraId)
        .then(function (j) { return j.cantidades; });
    },
    plazoCalc: function (obraId) {
      return post('plazoCalc', {}, obraId).then(function (j) { return j.plazo; });
    },

    /* ---- serialización del modelo de app.js al formato del backend ---- */
    serializeItems: function (ITEMS) {
      var items = [], dist = [], deps = [];
      ITEMS.forEach(function (i, k) {
        items.push({
          id: i.id, desc: i.desc, id_nivel3: i.id_nivel3 || '', desc_nivel3: i.desc_nivel3 || '',
          codigo_cc: i.codigo_cc || '', um: i.um || '', cant: i.cant || 0,
          // OJO: cant_convenio NO se serializa a propósito. Es un caché derivado
          // de ConvenioDetalle y lo mantiene el backend; si lo mandáramos desde
          // acá, una pantalla desactualizada podría pisar el valor contractual.
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
    }
  };

  global.ObraAPI = API;
})(window);
