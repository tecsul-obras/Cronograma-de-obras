// ══════════════════════════════════════════════════════════════════
// Service Worker — Equipos (parte diario, flota) dentro de la app Tecsul
// Solo borra SUS cachés (equipos-*): la del cronograma (obra-shell-*) es de
// la otra parte de la app, que tiene su propio service worker en la raíz.
//
// Permite que la app abra y funcione sin señal en obra.
//
// IMPORTANTE: subí CACHE_VERSION cada vez que cambies el HTML o el JS,
// si no los celulares siguen usando la copia vieja.
// ══════════════════════════════════════════════════════════════════
const CACHE_VERSION = 'equipos-v77';   // v77: consumo por equipo con la función combustible_consumo (SQL 70: ya no da statement timeout) · v76: indicadores de Power BI en la app (SQL 69) — ausencias del personal de taller (ausencias.js), Horas y costos por día y productividad, solapa Indicadores con disponibilidad, utilización y control de carga (indicadores.js), rendimiento semanal y ranking de sobreconsumo, feriados, meta / máximo de consumo y horas mínimas en la ficha, cargo y supervisor del técnico · v75: tanques de combustible unificados (SQL 67) — actividad Trasvase entre tanques, aviso de despacho grande a camión con tanque de despacho, sin tanques de emulsión en el formulario, Flota con «Montado en» y «Tanque del motor (L)» · v74: alquileres — eliminar contratos sin facturación (y el cliente si queda sin contratos), lista de Clientes · v73: alquileres — facturación del mes en un solo paso (monto a facturar del certificado, N° y fecha, factura y certificado firmado → FACTURADO) · v72: flota — sin la franja de operadores en varias máquinas (queda la tarjeta) · v71: tipo de OT por origen — TALLER CENTRAL siempre Taller, Registro de Trabajos siempre Pista, Diagnóstico sin elegir Taller (SQL 66) · v70: OT — tipo Taller/Pista en la bandeja, cierre solo con máquina Reparado / Reparado - Fallas menores / Servicio Tercerizado, OT de taller solo con Inspección Final, OT cerrada acepta horas 48 h, horómetro del último parte en el reporte de taller, horas y costos por técnico / máquina / OT con tarifa horaria (SQL 65); mantenimiento con responsable y más filtros · v69: letras 25 % más grandes en el celular (--fs) · v68: recursos de mantenimiento por modelo con precio (recursos.js, SQL 63/63b), ciclo 250 → 2.000 h, solapa Mantenimiento con kit, recursos necesarios y listas; personal con última máquina, desde/hasta y sin terceros (SQL 64) · v67: flota — botón Columnas para ocultar / ver columnas de la tabla · v66: operador en varias máquinas — un equipo con su accesorio enganchado cuenta como una sola máquina; la franja cuenta igual que la tarjeta · v65: filtros de selección múltiple con buscador (multisel.js), reporte de falla deja la OT Solicitada (SQL 60), avisos de operador en varias máquinas y de cambio de operador (SQL 61), accesorios enganchados a equipos (SQL 62) · v64: fotos — se achican apenas se eligen (createImageBitmap, sin pasar el original a texto), aviso en el momento, taller ya no envía sin la foto en silencio · v63: taller — Registro de Trabajos no se enviaba (medición con texto largo, SQL 59) y errores de subida reales en vez de "señal débil" · v62: flota — sin Situación actual (pasa a la observación), observaciones del último parte (SQL 58) · v61: flota — observación solo manual + último aviso automático del parte/OT aparte (SQL 57) · v60: admin central también ve el historial de taller y de combustible (filtro Persona) · v59: historial de taller y de combustible para mecánicos y despachadores (mis_cargas.js) · v58: alquileres — columnas monto facturado y facturado acumulado · v57: alquileres — monto del mes = certificado emitido, facturación sin pisar el monto, varios archivos por factura (SQL 56); certificado — cantidades suman solo HM, columna Facturación · v56: ítems de obra — filtro por obra y estado, selección de varios, eliminar · v55: catálogos de Flota — renombrar, unir y eliminar (SQL 55) · v54: corregir y eliminar combustible y reportes de taller, papelera de 7 días (SQL 54) · v53: flota — tabla editable (estado, disponibilidad, asignación, ubicación, responsable, operador) y edición de varios a la vez · v52: taller — fallas en 2 listas (sistema → falla, varias), Administración › Responsables de máquinas (SQL 53), sin solapa Formulario, aviso de obras sin ubicación · v51: parte — fecha = día de inicio del turno, aviso de parte del mismo día, último parte del equipo, foto y firma obligatorias de verdad, sin solape por máquina (SQL 52) · v50: editor de formularios en pantalla (editor_form.js, SQL 49) · v49: certificado — días operativos, litros por día y mínimo prorrateado · v48: Alquileres dentro de Certificado de máquinas (alquileres.js, SQL 48) · v47: reporte de taller igual a JotForm (condiciones, obligatorios, firma, OT de pista por máquina) · v46: tractorcito con imagen (ia_tractor.png) en el botón de la IA · v45: totales de horas en el historial de partes, tractorcito (ia_tractor.png) en el botón de la IA · v44: Minutas de reunión (minutas.js, SQL 46) · v43: casilla "De terceros" en filtros de flota · v42: certificados de maquinarias con formato oficial (cert_maquinas.js, SQL 45) · v41: turno del parte con zona horaria (antes quedaba 3 h antes) · v40: permisos de taller · v39: colores en disponibilidad, asignación y ubicación (tabla flota) · v38: admin de obra solo partes y flota (disponibilidad) · v37: horómetro sin saltos, buscador de catálogos · v36: Receso (HH 0), flechas en las solapas, ubicación de obra · v35: botón Descargar aplicación (instalar.js) · v34: guardados sin pisar a otros (estado de equipo) · v33: conciliación de combustible por función (SQL 39) · v32: rendimiento (flota y parte en paralelo) · v31: rol gerente (solo ver)

const APP_SHELL = [
  './',
  './index.html',
  './parte_diario_v5.html',
  './menu.js',
  './multisel.js',
  './formularios.js',
  './mis_cargas.js',
  './ausencias.js',
  './indicadores.js',
  './editor_form.js',
  './gestion.js',
  './gestion2.js',
  './recursos.js',
  './ia.js',
  './ia_tractor.png',
  './instalar.js',
  './certificado.js',
  './cert_maquinas.js',
  './alquileres.js',
  './minutas.js',
  './logo_tecsul.png',
  './flota.html',
  '../manifest.json',
  './icon-192.png',
  './icon-512.png',
  // La librería de Supabase se guarda también: si no, sin señal la app
  // ni siquiera arranca.
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => Promise.allSettled(APP_SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION && (k.startsWith('equipos-') || k.startsWith('parte-diario-'))).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Nada de lo que va a Supabase se guarda en caché: son datos vivos, y
  // además el token de sesión no debe quedar en el disco del teléfono.
  if (url.includes('.supabase.co')) return;
  if (e.request.method !== 'GET') return;

  // v32: la librería de Supabase lleva la versión en la dirección (@2.45.4): nunca
  // cambia, así que se sirve del caché sin esperar a la red. Antes se volvía a
  // pedir en cada cambio de pantalla (parte ⇄ flota), con hasta 8 s de espera
  // cuando la señal es mala.
  if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/')) {
    e.respondWith(caches.match(e.request).then(g => g || fetch(e.request).then(r => {
      const copia = r.clone();
      caches.open(CACHE_VERSION).then(c => c.put(e.request, copia)).catch(() => {});
      return r;
    })));
    return;
  }

  e.respondWith(
    // Primero la red, con un límite de 8 segundos: en obra la señal a
    // veces "está" pero no responde, y sin este corte la app queda
    // colgada en blanco en vez de abrir con la copia guardada.
    Promise.race([
      fetch(e.request).then(r => {
        const copia = r.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, copia)).catch(() => {});
        return r;
      }),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lento')), 8000))
    ]).catch(() =>
      caches.match(e.request).then(guardado => {
        if (guardado) return guardado;
        if (e.request.mode === 'navigate') return caches.match('./parte_diario_v5.html');
        return new Response('', { status: 504 });
      })
    )
  );
});
