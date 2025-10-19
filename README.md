# B2 Proxy Server

Node.js proxy server for Backblaze B2 with PDF version merging support.

## Features

- Serves files from Backblaze B2 bucket(s)
- **Multiple bucket support** - Map different paths to different buckets
- Automatically deduplicates file versions by SHA1 hash
- Merges multiple PDF versions into a single combined PDF
- Configurable caching headers for browsers and CDNs
- Docker support for easy deployment

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Required
B2_APPLICATION_KEY_ID=your_key_id_here
B2_APPLICATION_KEY=your_secret_key_here

# Bucket mapping - Map custom paths to bucket IDs (JSON format)
B2_BUCKET_MAP={"invoices":"bucket_id_1","reports":"bucket_id_2","documents":"bucket_id_3"}

# Optional
MERGE_PDF_VERSIONS=true                # Enable PDF merging (default: false)
BROWSER_CACHE_TTL=14400               # Browser cache: 4 hours (default)
CDN_CACHE_TTL=31536000                # CDN cache: 1 year (default)
PORT=3001                              # Server port (default: 3001)
```

## Installation

### Deploying on Coolify (Recommended)

This application is optimized for [Coolify](https://coolify.io) deployment:

1. **Create a new resource** in Coolify
   - Choose "Docker Compose" or "Dockerfile"
   - Point to this Git repository

2. **Set environment variables** in Coolify:
   ```bash
   B2_APPLICATION_KEY_ID=your_key_id
   B2_APPLICATION_KEY=your_secret_key
   B2_BUCKET_MAP={"invoices":"bucket_id_1","reports":"bucket_id_2"}
   MERGE_PDF_VERSIONS=true
   BROWSER_CACHE_TTL=14400
   CDN_CACHE_TTL=31536000
   ```

3. **Configure domain** in Coolify
   - Add your custom domain (e.g., `files.yourdomain.com`)
   - Coolify handles SSL automatically

4. **Deploy** - Coolify will:
   - Build the Docker image
   - Set the PORT automatically
   - Handle reverse proxy and SSL

**Note:** You don't need to set `PORT` in Coolify - it's automatically assigned. The app listens on `0.0.0.0` and works with any port Coolify assigns.

### Using Docker Compose (Local/Manual)

1. Copy `.env.example` to `.env` and configure your B2 credentials
2. Build and run with Docker Compose:

```bash
docker-compose up -d
```

Access at `http://localhost:3001`

### Manual Installation

1. Install dependencies:

```bash
npm install
```

2. Set environment variables (or create `.env` file)

3. Start the server:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Usage

Access files using the bucket prefix path:

```
# Example with B2_BUCKET_MAP={"invoices":"bucket1","reports":"bucket2"}

http://localhost:3001/invoices/2024/january.pdf    # Accesses bucket1
http://localhost:3001/reports/annual-report.pdf    # Accesses bucket2
```

The first path segment (`invoices`, `reports`) is mapped to the corresponding bucket ID, and the remaining path is used as the file path within that bucket.

### How PDF Merging Works

1. **Single Version**: If a file has only one version, it's returned directly
2. **Multiple Versions**:
   - Lists all versions of the requested file
   - Groups by SHA1 hash to identify duplicates
   - Deletes duplicate versions (keeping the oldest)
   - If PDF merging is enabled and multiple unique versions exist, combines them into one PDF
   - Returns the result

### Health Check

```
GET /health
```

Returns `200 OK` when the server is running.

## Docker Build

Build the Docker image manually:

```bash
docker build -t b2-proxy .
```

Run the container:

```bash
docker run -p 3001:3001 \
  -e B2_APPLICATION_KEY_ID=your_key_id \
  -e B2_APPLICATION_KEY=your_secret_key \
  -e B2_BUCKET_MAP='{"invoices":"bucket_id_1"}' \
  -e MERGE_PDF_VERSIONS=true \
  b2-proxy
```

Access at `http://localhost:3001`

## License

MIT
