# Purr Points API

Backend API for Purrlend Points System

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub"
4. Select this repo
5. Add environment variable: `CRON_SECRET=purrlend_points_secret_2026`
6. Railway will auto-deploy

## Set up Cron (after deployment)

1. In Railway dashboard, click your project
2. Go to "Cron Jobs" tab (or "Settings" → "Cron")
3. Add new cron:
   - Schedule: `0 * * * *` (every hour)
   - Command: `bash cron.sh`

## API Endpoints

- `GET /api/points/leaderboard?season=1&limit=100`
- `GET /api/points/user?wallet=0x...&season=1`
- `POST /api/points/snapshot` (internal, called by cron)

## Frontend Integration

Update frontend leaderboard component to call:
```
https://your-railway-url.up.railway.app/api/points/leaderboard
```
