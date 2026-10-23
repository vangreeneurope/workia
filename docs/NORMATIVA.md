# Normativa aplicable

> Este documento resume requisitos normativos que condicionan el diseño técnico. **No es
> asesoramiento jurídico.** Antes de producción debe revisarlo la asesoría laboral y la persona
> responsable de protección de datos (DPD) del grupo. Los puntos marcados "verificar" pueden haber
> cambiado o depender del convenio aplicable.

## 1. Registro de jornada

**Norma**: artículo 34.9 del Estatuto de los Trabajadores (introducido por el Real Decreto-ley
8/2019).

Requisitos y su reflejo en el producto:

| Requisito                                                                                      | Cómo lo cubre la plataforma                                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Registro diario con hora concreta de inicio y fin de la jornada de cada persona                | Fichajes de entrada y salida (y pausas) con hora del servidor                                 |
| Conservación durante 4 años                                                                    | Sin borrado de registros; política de conservación mínima de 4 años                           |
| A disposición de las personas trabajadoras, su representación legal y la Inspección de Trabajo | Consulta personal, vista de RR. HH. y exportación por persona y periodo                       |
| Fiabilidad e invariabilidad del registro (criterio de la Inspección y de los tribunales)       | Registros originales inmutables; correcciones como filas nuevas con motivo, autor y auditoría |

**Verificar**: el Gobierno tramitó en 2025 una reforma reglamentaria del registro de jornada
orientada a un registro digital accesible a distancia por la Inspección. Antes de la fase 1 hay que
confirmar si está aprobada y en vigor y qué requisitos añade (formato, acceso remoto, campos).

## 2. Protección de datos

**Normas**: Reglamento (UE) 2016/679 (RGPD) y Ley Orgánica 3/2018 (LOPDGDD), en especial los
artículos 87 (intimidad y dispositivos digitales), 88 (desconexión digital), 89 (videovigilancia y
grabación de sonido) y 90 (geolocalización) en el ámbito laboral.

Principios de diseño adoptados:

- **Base jurídica**: ejecución del contrato y cumplimiento de obligaciones legales (registro de
  jornada, obligaciones fiscales). No se basa en el consentimiento de la plantilla.
- **Minimización**: solo los datos necesarios. Nada de biometría ni geolocalización continua.
- **Biometría**: excluida. La AEPD, en su guía sobre control de presencia mediante sistemas
  biométricos (2023), considera estos datos de categoría especial y, con carácter general, no
  justificado su uso para el control horario.
- **Geolocalización**: excluido el rastreo continuo. La ubicación puntual al fichar está desactivada
  por defecto; cada empresa o centro puede activarla (opcional o exigida) con un texto de
  información previa obligatorio que se muestra antes de pedir el permiso (art. 90 LOPDGDD). Antes
  de activarla, la empresa debe hacer la evaluación de proporcionalidad con el DPD.
- **Selfie al fichar**: opcional y desactivada por defecto; no se usa para identificar (sin
  biometría), se eliminan los metadatos y se conserva 30 días (**verificar** el plazo con la
  asesoría). Si se activa, informar a la plantilla de su finalidad.
- **Desconexión digital** (art. 88): las notificaciones de la plataforma respetarán la política de
  desconexión de cada empresa (sin avisos fuera de horario salvo urgencia definida).
- **Confidencialidad**: control de acceso por rol y empresa (RLS), auditoría, almacenamiento
  privado, HTTPS, sin datos personales en la caché del dispositivo.
- **Encargados del tratamiento**: Supabase, el hosting y el proveedor de OCR requieren contrato de
  encargo (DPA). Preferir región UE; si hay transferencias internacionales, documentar la garantía
  aplicable.
- **Registro de actividades de tratamiento**: añadir los tratamientos "control horario",
  "gestión de ausencias" y "gastos de empresa".
- **Derechos**: acceso (la persona ve sus datos), rectificación (vía RR. HH. y correcciones
  auditadas), supresión limitada por obligaciones legales de conservación.
- **Evaluación de impacto (EIPD)**: valorar con el DPD si procede, especialmente por el tratamiento
  sistemático de datos de la plantilla y por el OCR de tickets. **Necesaria antes de activar** la
  ubicación puntual al fichar o la selfie, y ante cualquier ampliación hacia geolocalización más
  invasiva (ver PRIVACIDAD, § 5).
- **Reconocimiento facial y biometría**: no existen en la plataforma (sin dependencias ni código que
  los implemente, comprobado por prueba automática); la selfie no se analiza. Cualquier biometría
  futura exigiría EIPD, base del art. 9 RGPD y decisión expresa.
- **Derechos y soporte**: flujo de solicitudes con revisión humana, bloqueos por obligaciones de
  conservación, retenciones legales y acceso de soporte temporal y auditado (PRIVACIDAD, §§ 3 y 4).
- **Información a la plantilla y consulta a la representación legal** antes de implantar el
  sistema de registro de jornada.

## 3. Vacaciones y ausencias

Estatuto de los Trabajadores, artículo 38 (vacaciones anuales, mínimo de 30 días naturales) y
artículo 37 (permisos retribuidos), además del convenio colectivo de cada empresa. Los tipos de
ausencia, su duración y el cómputo serán configurables por empresa, no fijados en el código.
**Verificar** los permisos vigentes y los del convenio de cada empresa.

Implementación (2026-10-26, `docs/AUSENCIAS.md`): no hay catálogo legal en el código; cada empresa
crea sus tipos y políticas e indica su fuente. Los justificantes pueden contener datos de salud
(categoría especial, art. 9 RGPD): bucket separado, acceso solo de la persona y de RR. HH. con
permiso específico, sin copia en registros. **Pendiente**: plazo de conservación de justificantes
con la asesoría.

## 4. Gastos y justificantes

- Conservación de justificantes: **verificar con la asesoría**. Referencias habituales: plazo de
  prescripción tributaria de 4 años (Ley General Tributaria) y conservación de documentación
  contable durante 6 años (artículo 30 del Código de Comercio).
- Si se pretendiera prescindir del ticket en papel tras digitalizarlo, comprobar los requisitos de
  digitalización certificada aplicables. Hasta entonces, la imagen se trata como copia de apoyo.
- Los tickets pueden contener datos personales (nombre, tarjeta parcial): almacenamiento privado y
  acceso solo para la persona, su responsable y Contabilidad de la empresa.

Implementación (2026-10-27, `docs/GASTOS.md`): bucket privado `expense-receipts` con URL firmada de
60 s; metadatos de las fotos eliminados; el ticket original no se modifica ni se borra al corregir.
El OCR solo propone datos y la persona confirma. **Ningún ticket se envía a terceros**: no hay
proveedor de OCR configurado; elegir uno exige ADR, contrato de encargo de tratamiento (art. 28
RGPD) y comprobar dónde trata los datos. No se guarda el texto completo del ticket. **Pendiente**:
plazo de conservación de tickets con la asesoría y su borrado.

Avisos (2026-10-29, `docs/AVISOS.md`): los correos solo dicen empresa, acción y fecha, y enlazan al
portal (exige sesión). No incluyen motivos ni tipos de ausencia, importes, tickets, coordenadas ni
imágenes. No se guardan sus cuerpos. Los recordatorios de aprobaciones solo se envían en día
laborable entre las 9:00 y las 18:00 locales (desconexión digital, art. 88 LOPDGDD) y con límite
diario. **Pendiente**: proveedor de correo con contrato de encargo de tratamiento y plazo de
conservación de avisos.

Liquidación (2026-10-28, `docs/LIQUIDACION_GASTOS.md`): los lotes contables y su paquete (PDF, CSV,
XLSX y ZIP de justificantes) son inmutables, se guardan en un bucket privado y solo los descarga
Contabilidad con enlace firmado de 60 s; cada descarga queda registrada. Los tickets no se envían por
correo. **Pendiente**: plazo de conservación de lotes y paquetes (referencias habituales de 4 a 6
años, a validar con la asesoría).

## 5. Conservación (propuesta a validar)

La matriz completa (finalidad, base, acceso, plazo y borrado) y la retención automática están en
[PRIVACIDAD.md](PRIVACIDAD.md); las decisiones abiertas, en [PENDIENTES_LEGALES.md](PENDIENTES_LEGALES.md).

| Dato                                | Plazo mínimo propuesto                                          | Motivo                   |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------ |
| Registros de jornada y correcciones | 4 años                                                          | Art. 34.9 ET             |
| Selfies de fichaje                  | 30 días (decisión de 2026-10-25, a validar)                     | Minimización             |
| Auditoría de cambios                | Igual que el dato auditado de mayor plazo                       | Trazabilidad             |
| Ausencias y justificantes           | Según asesoría laboral                                          | Convenio y prescripción  |
| Gastos y tickets                    | Según asesoría (4-6 años)                                       | LGT / Código de Comercio |
| Cuentas de personas dadas de baja   | Desactivadas; sin borrado mientras haya obligación de conservar | Obligaciones legales     |
