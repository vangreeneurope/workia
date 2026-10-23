## Qué cambia y por qué

<!-- Resumen en dos o tres frases. Enlaza la tarea o el documento si existe. -->

## Cómo se ha probado

- [ ] `npm run check` (tipos, lint, formato y unitarias)
- [ ] `npm run test:db` si toca migraciones, RLS o funciones SQL
- [ ] E2E afectados (`npm run test:e2e:minimo` o el spec concreto)
- [ ] Revisión manual (indica pantallas y tamaños)

## Base de datos

- [ ] No incluye migraciones
- [ ] Incluye migración nueva con su `supabase/rollbacks/<migración>.down.sql`, pruebas de
      aislamiento (otra empresa y membresía caducada) y `npm run db:types`
- [ ] Pérdida de datos al revertir: <!-- ninguna / cuál y cómo se protege -->
- [ ] Compatible con el código desplegado mientras se aplica (docs/CI_CD.md, § Migraciones)

## Seguridad y privacidad

- [ ] Sin secretos, datos personales ni datos reales (solo sintéticos)
- [ ] Permisos y RLS sin relajar; escáneres en verde
- [ ] Registros sin datos personales (`src/lib/log.ts`)

## Documentación

- [ ] `docs/ESTADO_PROYECTO.md` y, si hay decisión de arquitectura, ADR en `docs/DECISIONES.md`
- [ ] Entrada en `CHANGELOG.md` (sección «Sin publicar»)
