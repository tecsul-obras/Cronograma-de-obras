# 71 · Foto del parte en papel + «Trasvase» → «Traspaso» (equipos-v78, 29/10/2026)

## Orden (importante)
1. **Primero** correr `71_parte_papel_y_traspaso.sql` en el SQL Editor de Supabase.
   Al final muestra: traspasos ≈ 651 · trasvases = 0 · sección «Traspaso» · campo nuevo en «Obra y actividad», orden 8, obligatorio.
2. **Después** publicar la app: mergear la rama `equipos-v78-parte-papel-traspaso` a `main`
   (cambia `equipos/parte_diario_v5.html`, `formularios.js`, `gestion.js`, `mis_cargas.js`, `sw.js` → equipos-v78).

Si se publica la app antes del SQL, el Historial de partes no carga (pide una columna que todavía
no existe) y los traspasos se rechazan. Al revés no hay problema: un celular con la app vieja que
manda «Trasvase entre tanques» se guarda solo como «Traspaso» (lo hace el trigger).

## Qué cambia
- **Parte diario:** último campo nuevo **«Foto del parte diario en papel»** (paso 5, después de la firma), obligatorio.
  Sacar foto o elegir de la galería, igual que la del horómetro. Se guarda en la columna nueva `partes.img_parte_papel`.
  Se ve en Historial de partes › detalle (junto con la del horómetro, la de la falla —que antes no se mostraba— y la firma).
  Editando un parte ya cargado no se exige foto nueva. Se puede renombrar u ocultar desde «Editar formulario», no borrar.
- **Combustible:** la actividad pasa a llamarse **Traspaso** (botón, sección, aviso de despacho grande, filtros de Control de
  combustible y «Mis cargas»). En la base el valor queda `Traspaso entre tanques` (los 651 registros se renombran);
  stock de tanques y cuenta litros siguen igual (probado sobre la base real en una transacción deshecha).
- Si Power BI o el espejo filtran por el texto «Trasvase entre tanques», cambiarlo a «Traspaso entre tanques».

## Volver atrás
- Foto opcional: `update form_campos set requerido = false where clave = 'foto_parte_papel';`
