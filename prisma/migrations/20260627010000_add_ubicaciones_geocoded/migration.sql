-- CreateTable
CREATE TABLE "ubicaciones_geocoded" (
    "id" SERIAL NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "display_name" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'nominatim',
    "not_found" BOOLEAN NOT NULL DEFAULT false,
    "geocoded_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ubicaciones_geocoded_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_geocoded_ubicacion_key" ON "ubicaciones_geocoded"("ubicacion");

-- CreateIndex
CREATE INDEX "ubicaciones_geocoded_not_found_idx" ON "ubicaciones_geocoded"("not_found");

-- CreateIndex
CREATE INDEX "ubicaciones_geocoded_provider_idx" ON "ubicaciones_geocoded"("provider");
