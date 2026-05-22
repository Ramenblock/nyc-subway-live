# NYC Subway Live 🚇

A real-time NYC subway tracker with a dark, glowing aesthetic — like those
physical LED subway maps, but in your browser.

---

## What you need before starting

You need accounts with two free services. No MTA registration needed — their
feeds are publicly accessible.

| Service | What it's for | Cost |
|---------|--------------|------|
| [Mapbox](https://account.mapbox.com) | The dark map itself | Free (50k loads/mo) |
| [GitHub](https://github.com) | Stores your code so Vercel can deploy it | Free |
| [Vercel](https://vercel.com) | Hosts the website publicly | Free |

---

## Step 1 — Get your Mapbox token

Mapbox provides the beautiful dark map tiles. Their free tier allows
50,000 map loads per month — more than enough for personal use.

1. Go to **https://account.mapbox.com**
2. Click **Sign up** and create a free account
3. Once logged in, you'll see a **Default public token** on your dashboard
4. Copy it — it starts with `pk.eyJ1...`

Now paste it into `app.js`:

Open the file `app.js` and find this line near the top:

```
const MAPBOX_TOKEN = 'YOUR_MAPBOX_TOKEN_HERE';
```

Replace `YOUR_MAPBOX_TOKEN_HERE` with your actual token. It should look like:

```
const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFyd2FuIiwiYSI6ImNsaW5...';
```

Save the file.

---

## Step 2 — Put your code on GitHub

GitHub is a website for storing and sharing code. Vercel (the hosting service)
reads your code from GitHub to deploy your site.

1. Go to **https://github.com** and create a free account
2. Click the **+** icon in the top right → **New repository**
3. Name it `nyc-subway-live` (or anything you like)
4. Leave everything else as default and click **Create repository**

**The easiest way to upload your files:**
1. On the empty repository page, click **uploading an existing file**
2. Drag all the files from this folder into the upload area:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `package.json`
   - `vercel.json`
   - `.gitignore`
   - The `api/` folder (drag the whole folder)
3. Click **Commit changes**

---

## Step 3 — Deploy on Vercel

Vercel reads your GitHub repository and hosts it as a live website.

1. Go to **https://vercel.com** and sign up with your GitHub account
2. Click **Add New Project**
3. Find your `nyc-subway-live` repository and click **Import**
4. Vercel will detect the project automatically — just click **Deploy**
5. Wait about 30 seconds for it to build

Your site is now live and showing real trains! 🎉

---

## How it works (the short version)

```
Your browser
  │
  ├─ Loads index.html → loads styles.css + app.js
  │
  ├─ app.js calls /api/stops → Vercel serverless function
  │   └─ Fetches station coordinates from NYC Open Data (free, no key needed)
  │
  └─ app.js calls /api/subway every 15 seconds → Vercel serverless function
      └─ Fetches live train positions from MTA's public feeds (no key needed)
         └─ Returns clean JSON with every active train's position
```

Your Mapbox token lives in `app.js` (visible to anyone who views your source),
but that's fine for a personal project. You can restrict it in Mapbox's
dashboard to only work on your Vercel domain (Settings → Token scopes → Add URL restriction).

---

## Troubleshooting

**The map is blank / "Mapbox token not set"**
→ Make sure you've replaced `YOUR_MAPBOX_TOKEN_HERE` in `app.js` with your real token

**The map loads but no trains appear**
→ Open your browser's developer tools (F12 → Console tab) and look for error messages
→ The MTA feeds occasionally go offline briefly — wait a minute and refresh

**Trains appear but some lines are missing**
→ Normal — the MTA's individual feeds sometimes lag or restart independently

**The site works locally but not after deploying**
→ Check the **Functions** tab in your Vercel dashboard for error logs

---

## File overview

```
nyc-subway-live/
├── index.html          The page structure (what's on the page)
├── styles.css          The visual design (dark theme, glow effects)
├── app.js              The map logic (Mapbox, train animation, tooltips)
├── package.json        Tells Vercel which packages to install
├── vercel.json         Vercel deployment configuration
├── .gitignore          Files that should NOT be uploaded to GitHub
└── api/
    ├── subway.js       Server: fetches live train positions from MTA (public, no key)
    └── stops.js        Server: fetches station coordinates from NYC Open Data
```
