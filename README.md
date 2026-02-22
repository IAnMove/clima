# Clima Visual (SvelteKit + AEMET)

App de clima por ciudad con ruta dinámica (`/:city`), modo visual híbrido (foto/minimalista) y arquitectura desacoplada para cambiar de proveedor meteorológico.

## Stack

- SvelteKit (UI en CSR con `ssr=false`)
- API interna en SvelteKit (oculta la API key de AEMET)
- Clean Architecture (domain/application/infrastructure)
- Adapter: `@sveltejs/adapter-node`

## Variables de entorno

Copia `.env.example` a `.env` y rellena:

```env
AEMET_API_KEY=tu_clave_real
WEATHER_PROVIDER=aemet
```

## Desarrollo

```sh
npm install
npm run dev
```

Abre `http://localhost:5173/oviedo`.

Para exponer en red/VPN:

```sh
npm run dev:vpn
```

Abre `http://IP_DE_TU_EQUIPO:4173/oviedo` desde la red VPN.

## Flujo de datos

1. `/:city` -> API interna `GET /api/weather/:city`
2. Resolución de municipio (AEMET maestro)
3. Predicción horaria + diaria por código de municipio
4. Render visual con paginación por horas y por días
5. Si no existe o hay ambigüedad, devuelve sugerencias y filtro por provincia

## Endpoints internos

- `GET /api/weather/:city?province=&code=`
- `GET /api/municipalities?province=&q=`

## Build

```sh
npm run check
npm run build
npm run preview
```

Con `adapter-node`, `npm run preview` levanta el servidor Node; en este proyecto queda fijado en `http://127.0.0.1:4173` y carga variables desde `.env`.

Para servir el build en red/VPN:

```sh
npm run preview:vpn
```

Si necesitas URL pública temporal (sin tocar DNS), puedes usar un túnel:

```sh
npx localtunnel --port 4173
```
