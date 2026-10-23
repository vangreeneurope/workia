# PRD · Portal del empleado del grupo

Documento de requisitos de producto. Versión 0.1 (fase 0). Las secciones marcadas como
"pendiente de confirmar" necesitan validación de negocio antes de construir el módulo.

## 1. Visión

Una aplicación web única, instalable en el móvil, para que todas las empresas del grupo gestionen
el registro de jornada, las vacaciones y ausencias, y los gastos comerciales. Sustituye hojas de
cálculo y procesos en papel, cumple la normativa española de registro de jornada y protección de
datos, y respeta la identidad de cada empresa.

## 2. Objetivos

1. Cumplir la obligación legal de registro diario de jornada con registros fiables e inalterables.
2. Reducir el tiempo de gestión de vacaciones y ausencias para empleados, responsables y RR. HH.
3. Digitalizar los tickets de gasto con OCR y acortar el ciclo de aprobación y liquidación.
4. Ofrecer una visión consolidada al grupo sin mezclar los datos de cada empresa.

## 3. Usuarios y roles

| Rol                                | Ámbito                | Necesidad principal                                        |
| ---------------------------------- | --------------------- | ---------------------------------------------------------- |
| Administrador global               | Todo el grupo         | Alta de empresas, configuración general, soporte           |
| Administrador de empresa / RR. HH. | Una o varias empresas | Plantilla, roles, calendarios, políticas, informes legales |
| Manager o responsable              | Personas asignadas    | Aprobar ausencias y gastos, revisar fichajes de su equipo  |
| Empleado / comercial               | Sus propios datos     | Fichar, pedir ausencias, registrar gastos                  |
| Contabilidad                       | Gastos de su empresa  | Validar y liquidar gastos, exportar a contabilidad         |

Reglas: una persona puede pertenecer a varias empresas y tener varios roles en cada una; un
manager puede supervisar a personas de distintas empresas; un empleado solo consulta sus datos.

## 4. Alcance funcional por módulo

### 4.1 Base (fase 0, completada)

Acceso con correo y contraseña, recuperación de contraseña, invitaciones por correo, navegación
protegida según rol, selector de empresa activa con su identidad visual, perfil, PWA instalable.

### 4.2 Administración (fase 1)

Alta y edición de empresas (razón social, CIF, zona horaria, logotipo, color). Alta de personas por
invitación, asignación de roles por empresa, baja (desactivación, nunca borrado), asignación de
responsables (incluso entre empresas). Visor de auditoría.

### 4.3 Control horario (fase 1)

Fichar entrada, pausa, reanudación y salida. Registro original inmutable con hora de servidor.
Solicitud de corrección con motivo, aprobada por el responsable o RR. HH., que crea un registro
nuevo enlazado al original. Historial personal y resumen de horas. Vista de equipo para
responsables. Informe exportable por persona y periodo para la Inspección de Trabajo.

### 4.4 Vacaciones y ausencias (fase 2)

Tipos de ausencia configurables por empresa (vacaciones, permisos retribuidos, bajas, asuntos
propios…). Calendario laboral por empresa y centro con festivos. Saldo de vacaciones según la
política de la empresa. Flujo solicitud → aprobación del responsable → registro. Justificantes en
almacenamiento privado. Calendario de equipo.

### 4.5 Gastos comerciales con OCR (fase 3)

Captura del ticket con la cámara del móvil o subida de archivo. Extracción por OCR de fecha,
importe, impuestos, proveedor y NIF, siempre revisable por la persona antes de enviar.
Kilometraje y dietas según la política de la empresa. Flujo: borrador → enviado → aprobado por el
responsable → validado por Contabilidad → liquidado. Exportación para contabilidad.

### 4.6 Informes y notificaciones (fase 4)

Informes consolidados por empresa y grupo, exportaciones, notificaciones (correo y, opcionalmente,
push en la PWA) respetando el derecho a la desconexión digital.

## 5. Requisitos no funcionales

- **Seguridad**: autorización en servidor y RLS; auditoría de cambios relevantes; documentos en
  almacenamiento privado; sin secretos en el cliente; cabeceras de seguridad y HTTPS.
- **Privacidad**: minimización de datos, sin biometría ni geolocalización continua, sin datos
  personales en caché del dispositivo. Ver `docs/NORMATIVA.md`.
- **Usabilidad**: mobile-first, fichar en un toque, interfaz íntegramente en español, accesible
  (objetivo WCAG 2.2 AA).
- **Fiabilidad**: hora de fichaje tomada del servidor; registros originales inmutables.
- **Mantenibilidad**: TypeScript estricto, pruebas automáticas (unitarias, E2E y RLS), documentación
  y ADR actualizados.

## 6. Fuera de alcance

Reconocimiento facial o huella, rastreo GPS continuo, cálculo de nóminas, gestión de turnos
complejos (pendiente de confirmar si se necesita), app nativa en tiendas (se usa PWA).

## 7. Preguntas abiertas (pendiente de confirmar)

1. **Proveedor de OCR** (servicio cloud o modelo propio) y requisito de que los datos se procesen
   en la UE.
2. **Hosting** de la aplicación y dominio definitivo; región del proyecto Supabase.
3. **Ubicación al fichar**: resuelto técnicamente (2026-10-25) como política por empresa o centro
   (no se registra / opcional / exigida), lectura puntual con aviso previo y nunca seguimiento
   (docs/CONTROL_HORARIO.md). Pendiente: que cada empresa decida y documente su uso con la
   asesoría y el DPD antes de activarla.
4. **Políticas por empresa** (el modelo ya es configurable, docs/AUSENCIAS.md; faltan los valores
   reales de cada empresa): convenios aplicables, jornada, cómputo de vacaciones (días naturales o
   laborables), tipos de ausencia, límites de gasto, precio por kilómetro y dietas.
5. **Integraciones**: ¿exportación a nómina o a un ERP/contabilidad concreto?
6. **Turnos**: ¿hay personal con turnos rotativos o jornadas irregulares?
7. **Proveedor de correo (SMTP)** para invitaciones y notificaciones.
8. **Conservación** de tickets y justificantes: plazo exacto a validar con la asesoría.
