-- CreateTable
CREATE TABLE "reportes" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "fuente" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "tipo_incidente" TEXT NOT NULL,
    "gravedad" TEXT,
    "hora" TEXT,
    "vehiculo" TEXT,
    "patente" TEXT,
    "descripcion" TEXT NOT NULL,
    "texto_original" TEXT NOT NULL,
    "url_noticia" TEXT,
    "victimas" TEXT,
    "detenidos" TEXT,
    "framer_enviado" BOOLEAN NOT NULL DEFAULT false,
    "framer_intentos" INTEGER NOT NULL DEFAULT 0,
    "portal_origen" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provincia" TEXT,
    "tipo_incidente_framer" TEXT,
    "fuerza_interviniente" TEXT,
    "tipo_vehiculo" TEXT,
    "carga_transportada" TEXT,
    "modus_operandi" TEXT,
    "hubo_violencia" TEXT,
    "tipo_vehiculo_involucrado" TEXT,
    "cantidad_vehiculos_involucrados" TEXT,
    "cantidad_personas_involucradas" TEXT,
    "campos_faltantes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "aprobado_por" TEXT,
    "aprobado_en" TIMESTAMP(3),
    "framer_item_id" TEXT,
    "framer_slug" TEXT,
    "og_image_url" TEXT,

    CONSTRAINT "reportes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumenes_diarios" (
    "id" SERIAL NOT NULL,
    "fecha" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumenes_diarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "ultimo_cambio_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_mensaje_en" TIMESTAMP(3),
    "ultimo_evento" TEXT,
    "detalles" JSONB,

    CONSTRAINT "wa_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "evento" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "reporte_id" INTEGER,
    "ip" TEXT,
    "user_agent" TEXT,
    "meta" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "severidad" TEXT NOT NULL DEFAULT 'warn',
    "meta" JSONB,
    "estado_envio" TEXT NOT NULL DEFAULT 'pending',
    "vista_en" TIMESTAMP(3),
    "resuelta_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reportes_hash_key" ON "reportes"("hash");

-- CreateIndex
CREATE INDEX "reportes_estado_idx" ON "reportes"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "resumenes_diarios_fecha_key" ON "resumenes_diarios"("fecha");

-- CreateIndex
CREATE INDEX "audit_log_reporte_id_idx" ON "audit_log"("reporte_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_idx" ON "audit_log"("actor");

-- CreateIndex
CREATE INDEX "audit_log_evento_idx" ON "audit_log"("evento");

-- CreateIndex
CREATE INDEX "audit_log_ts_idx" ON "audit_log"("ts");

-- CreateIndex
CREATE INDEX "alertas_vista_en_idx" ON "alertas"("vista_en");

-- CreateIndex
CREATE INDEX "alertas_tipo_idx" ON "alertas"("tipo");

-- CreateIndex
CREATE INDEX "alertas_creado_en_idx" ON "alertas"("creado_en");

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 7.8.0                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
