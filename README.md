# Heights Live — Peoria Heights Community App

A community web app for Village of Peoria Heights featuring live events, dining, weather, and more.

---

## What's in this folder

```
heights-live/
├── src/
│   ├── App.jsx          ← The entire app (React component)
│   ├── main.jsx         ← Entry point (don't edit)
│   └── storage.js       ← Handles saving data locally
├── api/
│   ├── events.js        ← Backend: fetches live events (keeps API key secret)
│   └── weather.js       ← Backend: fetches live weather (keeps API key secret)
├── public/              ← Put your app icon here (favicon.svg)
├── index.html           ← HTML shell (don't edit)
├── package.json         ← Project config (don't edit)
├── vite.config.js       ← Build config (don't edit)
├── vercel.json          ← Deployment config for Vercel (don't edit)
└── .env.example         ← Template for your secret API key
```

---

## How to deploy (step by step, no coding required)

You'll need to do this once. It takes about 30–45 minutes.

### Step 1 — Get your Anthropic API key
1. Go to https://console.anthropic.com
2. Sign in or create an account
3. Click **API Keys** in the left menu
4. Click **Create Key**, name it "Heights Live", copy it somewhere safe

### Step 2 — Put the code on GitHub
1. Go to https://github.com and create a free account if you don't have one
2. Click the **+** button → **New repository**
3. Name it `heights-live`, make it **Private**, click **Create repository**
4. Click **uploading an existing file**
5. Drag and drop ALL the files and folders from this folder into the uploader
6. Click **Commit changes**

### Step 3 — Deploy to Vercel (free hosting)
1. Go to https://vercel.com and sign up with your GitHub account
2. Click **Add New Project**
3. Find and select your `heights-live` repository
4. Click **Deploy** — Vercel will detect everything automatically

### Step 4 — Add your API key to Vercel
This is the important security step — your key goes on the server, not in the code.

1. In Vercel, open your project
2. Click **Settings** → **Environment Variables**
3. Click **Add New**
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your key from Step 1
4. Click **Save**
5. Go to **Deployments**, click the three dots on the latest deploy → **Redeploy**

Your app is now live at a URL like `heights-live.vercel.app` 🎉

### Step 5 — Custom domain (optional, ~$12/year)
1. Buy a domain at https://namecheap.com (e.g. `heightslive.com`)
2. In Vercel: **Settings** → **Domains** → add your domain
3. Follow Vercel's instructions to point your domain at their servers

---

## How to turn it into a mobile app (for App Store / Google Play)

Once your website is live and working well, you can wrap it into a native app using **Capacitor** (free). You'll need a developer to do this, or follow Capacitor's guide at https://capacitorjs.com/docs/getting-started.

You'll also need:
- **Apple Developer Account** — $99/year (https://developer.apple.com)
- **Google Play Account** — $25 one-time (https://play.google.com/console)

---

## Making changes to the app

All the content lives in `src/App.jsx`:
- **Restaurants** — find `const RESTAURANTS = [` around line 9
- **Seed events** — find `const SEED_EVENTS = [` around line 230
- **Colors** — find `const C = {` at the very top

---

## Need help?

Bring this folder (or the GitHub link) to any developer and they'll know exactly what to do. The code is clean, well-commented, and uses standard React + Vercel — very common tools.
