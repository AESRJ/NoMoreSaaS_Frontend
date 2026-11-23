-- 004: procedencia y precisión por campo del perfil de equipo (entrega 007).
-- Aditiva tras 003: no modifica ni borra tablas existentes. Se ejecuta dentro
-- de la transacción de src/db.js; no incluir BEGIN/COMMIT. Los perfiles
-- anteriores no tienen fila aquí y se leen como manual/declared.
-- Rollback de aplicación: conservar la tabla; sin DROP automático.

-- ProfileProvenance: una fila por proyecto, borrada en cascada con él. Solo
-- metadatos normalizados (origen, certeza, fecha de captura por campo); nunca
-- el diagnóstico completo, nombres de equipo, series ni rutas. "fields" guarda
-- solo los campos no manuales: los ausentes son manual/declared.
CREATE TABLE project_profile_provenance (
  project_id TEXT NOT NULL PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('this-device', 'other-device')),
  fields TEXT NOT NULL
    CHECK (json_valid(fields) AND json_type(fields) = 'object' AND length(fields) <= 4096),
  collector_version TEXT CHECK (collector_version IS NULL OR length(collector_version) BETWEEN 1 AND 40),
  updated_at TEXT NOT NULL
    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z')
) STRICT, WITHOUT ROWID;
