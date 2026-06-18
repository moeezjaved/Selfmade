# Selfmade Creative Worker — Deployment

A self-hosted Playwright worker that scrapes Meta ad creatives at unlimited scale.
Replaces the `/api/thumbnails` Browserless flow once you outgrow the 1k/mo free tier.

## Architecture

```
                ┌──────────────────────────┐
   Supabase ◄──►│  DigitalOcean Droplet    │
   (queue +     │  ┌────────────────────┐  │
    creative    │  │ Node.js worker     │  │
    fields)     │  │ (this repo)        │  │
                │  │                    │  │
                │  │ Playwright + Chrome│  │──► Facebook CDN (download .jpg/.mp4)
                │  └────────────────────┘  │
                └──────────────────────────┘
                        │
                        ▼
                  Cloudflare R2
                  (permanent storage)
```

## Recommended droplet sizing

| Droplet | Concurrency | Throughput | Cost |
|---------|-------------|------------|------|
| 2GB / 1 CPU | 3-4 | ~80 ads/min | $12/mo |
| 4GB / 2 CPU | 6-8 | ~150 ads/min | $24/mo |
| **8GB / 4 CPU** ⭐ | **10-12** | **~250 ads/min** | **$48/mo** |
| 16GB / 8 CPU | 18-20 | ~450 ads/min | $96/mo |

For 1M ads: $48 droplet ≈ 3 days end-to-end.

## Option A: Deploy with Docker (recommended)

### 1. Create droplet

- DigitalOcean → Create Droplet → **Ubuntu 24.04 LTS**
- Plan: Basic, **Regular SSD**, 8GB / 4 CPU = $48/mo
- Region: SFO3 or NYC3 (closest to Cloudflare R2 SFO endpoint)
- Authentication: SSH key (set yours up via `Settings → Security`)
- Hostname: `creative-worker-1`

### 2. SSH in & install Docker

```bash
ssh root@YOUR_DROPLET_IP

# Install Docker (one-liner)
curl -fsSL https://get.docker.com | sh
```

### 3. Copy this `worker/` folder to the droplet

From your laptop:
```bash
# From repo root
rsync -avz --exclude node_modules --exclude dist worker/ root@YOUR_DROPLET_IP:/opt/worker/
```

### 4. Create `.env` on the droplet

```bash
ssh root@YOUR_DROPLET_IP
cd /opt/worker
cp .env.example .env
nano .env  # paste real values
```

### 5. Build & run

```bash
cd /opt/worker
docker build -t selfmade-worker .
docker run -d \
  --name worker \
  --env-file .env \
  --restart unless-stopped \
  --memory=6g \
  selfmade-worker

# Watch logs
docker logs -f worker
```

You should see something like:
```
🚀 Selfmade Creative Worker starting…
✅ Chromium launched
🔄 Polling for ads…
📦 Got 50 ads to process
  ✅ [1/50] 1632261441427867 (3.2s) img
  ✅ [2/50] 2195954000836396 (4.1s) img+vid
  ...
✅ Batch done in 18.4s — 48 ok, 2 failed
📊 Lifetime: 48/50 ok (96%) | 156 ads/min | queue: 7456 | ETA: 47 min
```

### 6. Stop / restart / update

```bash
docker stop worker        # pause
docker start worker       # resume
docker restart worker     # restart
docker logs --tail 100 worker

# To update after code changes:
cd /opt/worker
# rsync new files...
docker build -t selfmade-worker .
docker stop worker && docker rm worker
docker run -d --name worker --env-file .env --restart unless-stopped selfmade-worker
```

## Option B: Bare metal (no Docker)

If you don't want Docker:

```bash
ssh root@YOUR_DROPLET_IP

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install worker
mkdir -p /opt/worker && cd /opt/worker
# rsync files from your laptop
npm install
npx playwright install --with-deps chromium
npm run build

# Set up env
cp .env.example .env
nano .env

# Run with PM2 for auto-restart
npm install -g pm2
pm2 start dist/index.js --name worker --max-memory-restart 6G
pm2 save
pm2 startup  # follow the instructions it prints
```

## Monitoring

```bash
# Live ad/min throughput from logs
docker logs -f worker | grep "ads/min"

# Queue depth (run from your laptop)
curl 'https://www.tryselfmade.ai/api/admin/indexer?action=stats' \
  -H 'Cookie: ...'  # use browser cookies
```

## Migrating from Browserless

Once this worker is running and successfully draining the queue:

1. Disable Browserless in `/api/thumbnails` (or just stop calling it).
2. The Vercel cron can be removed — the worker self-polls.
3. Cancel your Browserless subscription.

## Tuning concurrency

If you see memory pressure (`docker stats worker` showing >80% RAM):
- Lower `WORKER_CONCURRENCY` (e.g. 6 instead of 10)

If CPU is idle and ads/min looks low:
- Raise `WORKER_CONCURRENCY`
- Or upgrade droplet size

## Cost reality check

- $48/mo droplet running 24/7 = unlimited extraction
- Can process ~10M ads/month on this single droplet
- Compare to Browserless Scale plan ($200/mo) which only allows 500K units
