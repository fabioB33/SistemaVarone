-- Sprint flow-unificado-aprobacion (2026-06-28)
--
-- Antes había 2 estados: 'pendiente' (todo OK, aprobable) y
-- 'pendiente_revision' (faltan dropdowns, completar primero). Ahora son
-- UN solo estado: 'pendiente'. La lista `campos_faltantes` viaja en la
-- card y bloquea el botón "Aprobar" en frontend + backend.
--
-- Migración idempotente: si no hay reportes en pendiente_revision, no
-- hace nada. Si hay, los pasa todos a pendiente. La columna
-- campos_faltantes se preserva tal cual (la card del frontend los renderea
-- como selects amber inline).
UPDATE reportes
SET estado = 'pendiente'
WHERE estado = 'pendiente_revision';
