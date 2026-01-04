# WiredAlter Status

A lightweight, self-hosted status page and monitoring service built with Node.js and SQLite.

## Disclaimer

If you require a feature-rich, enterprise-grade monitoring solution, use **Uptime Kuma**. It is the gold standard for self-hosted monitoring.

This project was built as a lighter alternative for specific workflows. While a rootless Uptime Kuma image can consume nearly 1GB of disk space, this image is approximately 260MB while remaining secure and functional.

## Features

* **Lightweight:** Built on Node.js 24 Alpine.
* **Secure:** Runs as a non-root user (default UID/GID 1000).
* **Dual-Port Architecture:** Separates the public status page (Port 3000) from the admin dashboard (Port 3001).
* **Notifications:** Supports Webhook notifications (Discord, Ntfy, etc.).
* **Customizable:** Update title, logo, and footer text directly from the admin UI.
* **History:** Tracks latency and uptime history using a local SQLite database.

## Installation

### Prerequisites

* Docker and Docker Compose
* A reverse proxy (Caddy, Nginx, or Cloudflare Tunnel)

### Quick Start

1. Create a `.env` file:

```bash
ADMIN_PASSWORD=change_this_password
SESSION_SECRET=long_complex_random_string_at_least_32_chars
```

1. Create a `docker-compose.yml` file (or clone the repo):

```yaml
services:
  status:
    image: ghcr.io/buildplan/status:latest
    container_name: status-service
    restart: unless-stopped
    user: "1001:1001"
    ports:
      - "3909:3000"           # Public Interface
      - "127.0.0.1:4909:3001" # Admin Interface (Localhost only)
    environment:
      - NODE_ENV=production
      - TZ=Europe/London
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - SESSION_SECRET=${SESSION_SECRET}
    volumes:
      - ./data:/app/data
```

1. Start the service:

```bash
docker compose up -d
```

## Accessing the Admin Dashboard

For security, the Admin interface (Port 3001) is bound to `127.0.0.1` in the example configuration. This prevents accidental exposure to the public internet.

To access the admin panel from a remote machine, use an SSH tunnel:

```bash
ssh -L 4909:127.0.0.1:4909 user@your-server-ip
```

Open your browser and navigate to `http://localhost:4909/admin`.

## Deployment Options

### Option 1: Caddy Reverse Proxy (Recommended)

The repository includes a `Caddyfile` configuration. This handles automatic HTTPS certificate generation and compression.

1. Uncomment the Caddy service in `docker-compose.yml`.
2. Update the `Caddyfile` with your domain:

```Caddyfile
status.your-domain.com {
    encode zstd gzip
    reverse_proxy status:3000
}
```

1. Ensure your DNS records point to the server.

### Option 2: Cloudflare Tunnel

If you prefer not to open inbound ports (80/443), use Cloudflare Tunnel.

1. Create a Docker network for the tunnel:

```bash
docker network create cloudflare-net
```

1. Add the network to your `docker-compose.yml` and attach the status service to it.
2. Configure your `cloudflared` container on the same network to point to `http://status:3000`.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Password for the admin dashboard. | `admin` |
| `SESSION_SECRET` | Secret key for encrypting cookies. Must be 32+ chars. | (Hardcoded fallback) |
| `TZ` | Timezone for log timestamps. | `UTC` |
| `NODE_ENV` | Set to `production` for deployment. | `development` |

## Building from Source

To build the image locally instead of using the pre-built registry image:

```bash
docker compose build --build-arg USER_ID=$(id -u) --build-arg GROUP_ID=$(id -g)
docker compose up -d
```

Ensure you pass the correct `USER_ID` and `GROUP_ID` build arguments to match your host user permissions for the mapped volume.

---

## Screenshots

### Public Status Page

<img width="2940" height="2256" alt="image" src="https://github.com/user-attachments/assets/6bc6c93e-d2a7-41f4-9da3-af805dd649a8" />

### Lightmode and layout switch

<img width="2940" height="1846" alt="image" src="https://github.com/user-attachments/assets/ef1d53f4-580c-487a-a080-b6a6c2a8ea56" />

### Admin Interface

<img width="2940" height="1846" alt="image" src="https://github.com/user-attachments/assets/38523d6c-2f89-4d4a-8b53-3336df01cd85" />

### Status Page Configration and Notification settings

<img width="2940" height="1846" alt="image" src="https://github.com/user-attachments/assets/1eada262-eb18-4b82-ab43-c49284254e5f" />
