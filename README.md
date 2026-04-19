# WordleVS

Competitive two-player Wordle. Share an invite code and race to guess the same secret word first. Runs entirely in the browser — no server required.

**Live site:** https://JGM-89.github.io/WordleVS/

---

## Setup

The game uses **Firebase Realtime Database** (free tier) for real-time sync between players. You need to create a free Firebase project and paste the config into `js/firebase.js` before deploying.

### 1 — Create a Firebase project (~5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Name it `WordleVS`, click through (skip Google Analytics), then **Create project**.
3. On the project overview, click the **Web** icon (`</>`).
4. Nickname it `WordleVS`, click **Register app**.
5. Copy the `firebaseConfig` object shown on screen. It looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "wordlevs-....firebaseapp.com",
     databaseURL: "https://wordlevs-...-default-rtdb.firebaseio.com",
     projectId: "wordlevs-...",
     storageBucket: "wordlevs-....appspot.com",
     messagingSenderId: "12345...",
     appId: "1:12345...",
   };
   ```
6. Click **Continue to console**.

### 2 — Enable Realtime Database

1. In the Firebase console left sidebar, go to **Build → Realtime Database**.
2. Click **Create Database**.
3. Choose a region (any is fine), click **Next**.
4. Select **Start in test mode**, click **Enable**.

### 3 — Set security rules

1. In Realtime Database, click the **Rules** tab.
2. Replace the rules with:
   ```json
   {
     "rules": {
       "codes": {
         ".read": true,
         ".write": true
       },
       "rooms": {
         "$roomId": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
3. Click **Publish**.

### 4 — Paste config into the project

Open `js/firebase.js` and replace the `FIREBASE_CONFIG` placeholder values with the values you copied in step 1.

### 5 — Restrict to your domain (recommended)

1. In Firebase console, go to **Build → Authentication → Settings → Authorized domains**.
2. Add `JGM-89.github.io`.

This prevents anyone else's site from using your Firebase project.

---

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/JGM-89/WordleVS.git
git push -u origin main
```

Then in the GitHub repo:

1. Go to **Settings → Pages**.
2. Source: **Deploy from a branch** → Branch: `main`, folder: `/ (root)`.
3. Click **Save**.

The site goes live at `https://JGM-89.github.io/WordleVS/` within a couple of minutes.

---

## How to play

1. Player 1 opens the site and clicks **Create Game** — a 6-character invite code appears.
2. Player 1 shares the code with Player 2 (text, DM, etc.).
3. Player 2 opens the site, enters the code, and clicks **Join**.
4. Both players see the game board. The same secret 5-letter word is used for both.
5. Type a 5-letter word and press **Enter** to guess. Each player's board updates in real time.
6. You can see your opponent's colour feedback (green / yellow / grey) but not their letters.
7. First to guess the word correctly wins. If neither player solves it in 6 guesses, it's a draw.

---

## Project structure

```
WordleVS/
├── index.html          Single-page shell (four screens)
├── css/
│   └── style.css       Dark theme, tile animations, responsive layout
├── js/
│   ├── words.js        ANSWER_WORDS array + VALID_GUESSES Set
│   ├── game.js         evaluateGuess, isValidGuess, selectSecretWord
│   ├── firebase.js     Firebase init + all DB helpers
│   ├── ui.js           DOM manipulation (no game logic, no Firebase)
│   └── main.js         App entry point — state, events, game loop
└── README.md
```

No build step. No dependencies to install. Pure HTML/CSS/JS.
