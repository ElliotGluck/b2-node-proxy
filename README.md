# B2 Proxy Server

Node.js proxy server for Backblaze B2 with PDF version merging support.

## Features

- Serves files from Backblaze B2 bucket
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
B2_BUCKET_ID=your_bucket_id_here

# Optional
MERGE_PDF_VERSIONS=true                # Enable PDF merging (default: false)
BROWSER_CACHE_TTL=14400               # Browser cache: 4 hours (default)
CDN_CACHE_TTL=31536000                # CDN cache: 1 year (default)
PORT=3000                              # Server port (default: 3000)
```

## Installation

### Using Docker (Recommended)

1. Copy `.env.example` to `.env` and configure your B2 credentials
2. Build and run with Docker Compose:

```bash
docker-compose up -d
```

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

Once running, access files at:

```
http://localhost:3000/path/to/file.pdf
```

### How It Works

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
docker run -p 3000:3000 \
  -e B2_APPLICATION_KEY_ID=your_key_id \
  -e B2_APPLICATION_KEY=your_secret_key \
  -e B2_BUCKET_ID=your_bucket_id \
  -e MERGE_PDF_VERSIONS=true \
  b2-proxy
```

## License

MIT
