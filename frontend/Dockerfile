# Interfaz del Divisor de Facturas PDF (Vite + React, servida por nginx)

# --- 1. Compilar ---
FROM node:22-alpine AS build

WORKDIR /app

# Capa aparte para las dependencias: solo se reinstalan si cambia el lockfile
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- 2. Servir ---
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1
