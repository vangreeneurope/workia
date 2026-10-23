# Copias y restauración

Qué se copia, dónde, cómo se restaura y qué está probado. Las copias contienen datos personales:
se tratan con las mismas reglas de acceso, cifrado, región y conservación que el sistema original
(docs/PRIVACIDAD.md).

## 1. Qué contiene cada copia

| Elemento                                                                            | Copia de base de datos de Supabase | Copia lógica (`pg_dump`) | Necesita copia propia |
| ----------------------------------------------------------------------------------- | ---------------------------------- | ------------------------ | --------------------- |
| Tablas de la app (`public`, `private`), auditoría                                   | Sí                                 | Sí                       | No                    |
| Usuarios y factores de Auth (esquema `auth`)                                        | Sí                                 | Sí, si se incluye `auth` | No                    |
| Metadatos de archivos (`storage.objects`: ruta, tamaño, propietario)                | Sí                                 | Sí, si se incluye        | No                    |
| **Archivos de Storage** (tickets, justificantes, selfies, logotipos, exportaciones) | **No**                             | **No**                   | **Sí** (§ 4)          |
| Configuración del proyecto (Auth, SMTP, claves de API, ajustes)                     | No                                 | No                       | Documentarla (§ 5)    |
| Secretos de ejecución (hosting) y del CI (GitHub)                                   | No                                 | No                       | En sus gestores       |

La copia de la base **no incluye los archivos de Storage**: restaurar solo la base deja filas que
apuntan a archivos inexistentes si estos se perdieron.

## 2. Copias de PostgreSQL

**Nativas de Supabase**: dependen del plan contratado (copias diarias y, como complemento de pago,
recuperación a un instante, PITR). Antes del piloto se rellena esta tabla con lo contratado; no se
anotan valores supuestos:

| Dato                                      | Valor                                 |
| ----------------------------------------- | ------------------------------------- |
| Plan de Supabase de producción            | PENDIENTE                             |
| Copias diarias: retención                 | PENDIENTE                             |
| PITR: contratado y ventana                | PENDIENTE                             |
| Región del proyecto (UE)                  | PENDIENTE                             |
| RPO objetivo (pérdida máxima aceptable)   | PENDIENTE (lo decide la organización) |
| RTO objetivo (tiempo máximo sin servicio) | PENDIENTE (lo decide la organización) |

**Copia lógica adicional** (recomendada; protege frente a la pérdida del proyecto o de la cuenta y
permite conservarla bajo control de la organización):

```bash
# Desde un equipo o ejecutor seguro, nunca en GitHub Actions ni en sus artefactos.
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db dump --linked --password "$SUPABASE_DB_PASSWORD" -f esquema.sql
supabase db dump --linked --password "$SUPABASE_DB_PASSWORD" --data-only -f datos.sql
# Cifrar antes de guardar (p. ej. age o gpg con la clave de la organización) y subir a un
# almacenamiento en la UE con acceso restringido y retención acorde a docs/PRIVACIDAD.md.
```

Las copias no se suben a GitHub ni a artefactos del CI. Una supresión ejercida por una persona
(derecho de supresión) debe reaplicarse si se restaura una copia anterior (§ 6, paso 6).

## 3. Momentos en que se exige copia

- **Antes de migrar producción** con migraciones pendientes: el workflow pide «copia confirmada»
  (copia nativa reciente verificada, punto PITR o copia lógica) y registra la hora previa como punto
  de restauración (docs/CI_CD.md, § 4).
- Antes de ejecutar una reversión que pierda datos, de activar la retención real
  (`RETENTION_MODE=execute`) o de una operación masiva manual.

## 4. Archivos de Storage

| Bucket                | Contenido                     | Conservación en la app | ¿Copia?                                                            |
| --------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `expense-receipts`    | Tickets de gastos             | Según matriz           | Sí: son justificantes contables                                    |
| `absence-attachments` | Justificantes de ausencias    | Según matriz           | Sí                                                                 |
| `accounting-exports`  | Paquetes de cierre contable   | Según matriz           | Recomendable (se pueden regenerar del lote si los tickets existen) |
| `company-logos`       | Logotipos                     | Indefinida             | Opcional (se pueden volver a subir)                                |
| `punch-selfies`       | Selfies opcionales de fichaje | 30 días                | No (temporales por diseño)                                         |
| `report-exports`      | Exportaciones de informes     | 7 días                 | No (temporales; se vuelven a pedir)                                |

Los nombres de bucket están comprobados contra las migraciones que los crean.

Opciones (decisión pendiente, registrar en un ADR):

1. Copia periódica de los buckets marcados con «Sí» a un almacenamiento separado en la UE, cifrado,
   con una cuenta de solo lectura. Supabase Storage ofrece un acceso compatible con S3 que permite
   herramientas de sincronización estándar; verificar su disponibilidad y límites en el plan.
2. Aceptar el riesgo de forma documentada para algún bucket.

Mientras no se decida, la pérdida de archivos de Storage **no es recuperable** con las copias
actuales. Está en docs/PENDIENTES_LEGALES.md y en el informe de preparación del piloto.

## 5. Configuración que hay que poder rehacer

Lista mantenida en docs/RELEASE.md (§ Entorno): ajustes de Auth (MFA TOTP, contraseña mínima,
registro cerrado, URLs de redirección, SMTP), buckets y sus límites (los crean las migraciones),
claves de API, variables del hosting y de GitHub, planificador de tareas, sonda de salud y destino
de registros.

## 6. Restaurar

Siempre en un **proyecto nuevo**; producción no se sobrescribe.

1. Avisar a la organización y al DPD si hay pérdida de datos (RUNBOOKS, § 3). Anotar el instante al
   que se restaura.
2. Crear el proyecto de destino (misma región) y restaurar:
   - desde la copia nativa o PITR, con la opción de restauración del panel de Supabase que permita
     el plan; o
   - desde la copia lógica: aplicar `esquema.sql` y después `datos.sql` con `psql` sobre la base nueva.
3. Comprobar que el estado de migraciones coincide con el código (`supabase migration list --linked`)
   y aplicar las posteriores a la copia con el flujo normal.
4. Verificar: recuentos de control por empresa frente a los últimos conocidos, que todas las tablas
   de `public` tienen RLS (comprobaciones de `97_seguridad_catalogo`), `/api/salud/listo` en 200 y el
   E2E mínimo contra el entorno si es staging.
5. Restaurar los archivos de Storage desde su copia (§ 4), o listar los que faltan.
6. Revisar retención y derechos: volver a ejecutar `run_retention` y reaplicar las supresiones
   registradas en `data_subject_requests` posteriores a la copia.
7. Cambiar la app al proyecto restaurado (variables del entorno) y desplegar.

## 7. Pruebas de restauración

| Prueba                                                                                     | Estado                   | Resultado                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Copia lógica y restauración local con datos sintéticos (`npm run ops:prueba-restauracion`) | **Ejecutada** 2026-10-23 | Esquema idéntico, 81 tablas y 251 filas coinciden, escáner de catálogo (24 comprobaciones) en verde. Copia 166 ms (1,1 MB), restauración 1,7 s |
| Restauración de la copia nativa o PITR de Supabase a un proyecto nuevo (staging)           | **Pendiente**            | Requiere el proyecto de Supabase y el plan contratado                                                                                          |
| Copia y restauración de archivos de Storage                                                | **Pendiente**            | Requiere decidir la opción del § 4                                                                                                             |
| Restauración completa cronometrada (base + Storage + app)                                  | **Pendiente**            | Antes del piloto y después cada trimestre                                                                                                      |

La prueba local demuestra que el procedimiento lógico (pg_dump/pg_restore) reproduce el esquema,
los datos y las protecciones de seguridad; no demuestra los tiempos ni el funcionamiento de las
copias de Supabase. Una diferencia esperada: `pg_dump` no conserva una lista de permisos que sea
igual a la del propietario por defecto (queda vacía, con los mismos permisos efectivos); la prueba
normaliza solo ese caso y falla ante cualquier otra diferencia.

Registro de cada prueba: fecha, persona, origen (instante), destino, duración de cada fase,
comprobaciones del § 6 y problemas encontrados.
