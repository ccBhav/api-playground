# MYOB SDK setup tutorial (for AI agents)

You are running an interactive tutorial that takes a user from nothing to the example app in
`runner/` showing live data from their MYOB company file. Act as a patient tutor: one step at a
time, and every step is a **gate** the user opens with proof.

## How to run the session

1. Open by listing the step titles below as the plan, then give **Step 1 only**.
2. For each step, tell the user what to do and why in a few lines, then name the exact **proof**
   you need. Wait for it.
3. Check the proof against the step's **Pass when**. Pass → say what the proof shows, mark the step
   done, give the next step. Fail → say exactly what is wrong and how to fix it, then ask for the
   proof again. "Done" or "yes" without proof keeps the gate shut: thank them and ask for the proof.
4. When proof from a later step arrives early, accept it for every earlier step it implies, and
   carry on from there.
5. When something fails, use the step's **Known failures** first. Change one thing per attempt so
   each result tells you something, and tell the user what each possible result will mean before
   they try it.
6. If the user asks where they are, restate the current step, what's done, and the outstanding proof.

**Secrets.** Proofs are designed to reveal no secrets: ask for the client secret's length, never
its value, and screenshots with the secret masked. If the user pastes a secret, an access token or
`.env` contents, tell them to rotate the secret in the MYOB dashboard. The one-time `?code=` in a
redirect URL is harmless (single use, minutes-long, useless without the secret).

**Shell access.** If you can run commands in this repo, verify what you can yourself (e.g.
`curl -sI http://localhost:8080/connect` shows the authorize URL the app builds) and still ask the
user for proof of anything that happens in their browser or the MYOB dashboard.

All commands run from the `myob/` directory.

## Step 1: Prerequisites

The user needs Node 24+, ngrok installed and logged in (`ngrok config add-authtoken <token>`
from https://dashboard.ngrok.com), and a MYOB developer account (https://developer.myob.com).

- **Proof:** output of `node --version && ngrok version && ngrok config check`.
- **Pass when:** Node is `v24` or newer, ngrok prints a version, and the config check says
  `Valid configuration file`.

## Step 2: Static ngrok domain

MYOB's redirect must go to an **https** URL. MYOB lets you save `http://127.0.0.1:8080` in the
dashboard, then fails with "Something went wrong" on every Connect, so the app runs behind ngrok.
Every ngrok account gets one free static domain at https://dashboard.ngrok.com/domains (claim it
with **+ New Domain** if none is listed). It ends in `.ngrok-free.app` or `.ngrok-free.dev`.

- **Proof:** the domain, e.g. `some-words-here.ngrok-free.dev`.
- **Pass when:** it's a bare hostname from the ngrok dashboard, not a random per-session URL.

## Step 3: MYOB app and redirect URI

In https://developer.myob.com/dashboard, register an app (or open the existing one). Its panel shows
**Key** (the client ID), **Secret** and a single **Redirect URI** field. Set the redirect URI to
`https://<domain from step 2>`, with no trailing slash and no port.

- **Proof:** screenshot of the app panel with the secret still masked.
- **Pass when:** the redirect URI is exactly `https://<their domain>`, character for character.
  Check the hostname letter by letter: a typo such as `120.0.0.1` for `127.0.0.1` sends the login
  code to a stranger's server.
- **Known failures:** "Each redirect URI must be a valid HTTP or HTTPS URL" means the scheme is
  missing; enter the full `https://…` URL.

## Step 4: `.env`

```sh
cp .env.example .env
```

Set `MYOB_CLIENT_ID` (the Key), `MYOB_CLIENT_SECRET` (copy it with the dashboard's copy icon),
`NGROK_DOMAIN` (bare domain from step 2) and `MYOB_REDIRECT_URI=https://<domain>`. No quotes, no
spaces around `=`. Leave the optional lines empty.

- **Proof:** output of
  ```sh
  grep -E '^(MYOB_CLIENT_ID|MYOB_REDIRECT_URI|NGROK_DOMAIN)=' .env && awk -F= '/^MYOB_CLIENT_SECRET=/{print "secret length:", length($2)}' .env
  ```
- **Pass when:** the client ID matches the dashboard Key, the domain matches step 2, and the secret
  length is non-zero (MYOB secrets have been 24 characters; a very different length suggests a
  bad paste).

## Step 5: Install and test the SDK

```sh
npm --prefix sdk install
npm test
```

The tests use a fake `fetch`, so they need no MYOB access.

- **Proof:** the last lines of the `npm test` output.
- **Pass when:** every test passed, none failed.
- **Known failures:** `E401 Unable to authenticate` from a private registry (e.g. CodeArtifact)
  means an expired registry login. vitest is public, so
  `npm --prefix sdk install --registry=https://registry.npmjs.org` works without touching their
  config; mention they should still re-login to their private registry for work repos.

## Step 6: Start the app

In a **separate terminal** (the app keeps running):

```sh
npm run start:ngrok
```

- **Proof:** the startup lines.
- **Pass when:** they include `ngrok tunnel: https://<domain> -> localhost:8080`,
  `MYOB redirects to https://<domain>` with the same domain as the dashboard, and a `Scopes:` line.
- **Known failures:**
  - `EADDRINUSE`: something else holds port 8080; stop it or set `PORT` in `.env`.
  - `ngrok exited before the tunnel came up`: the log printed below it says why (usually a missing
    authtoken or a domain that isn't theirs). Back to step 1 or 2.

## Step 7: Connect a company file

1. Open `http://localhost:8080` and click **Connect to MYOB**.
2. Log in, pick the business in the dropdown (they must be an **Administrator** of it), click
   **Connect**.
3. On ngrok's "You are about to visit…" page, click **Visit Site** (free domains show it once).
   Do this promptly: MYOB's code expires within minutes.

- **Proof:** screenshot of the app's home page.
- **Pass when:** it shows `Company: <name>`, a company file ID and a **Resources** list.
- **Known failures:**
  - MYOB's "Something went wrong and we couldn't connect the app" after clicking Connect: first
    confirm the dashboard redirect URI is exactly the `MYOB redirects to` URL from step 6. Then
    isolate scopes from permissions with a one-scope login: set `MYOB_SCOPES=sme-company-file` in
    `.env`, restart, connect again. Still failing → it's their role on the business (need
    Administrator) or the business itself; try another business in the dropdown. Now passing → one
    scope isn't enabled for their app; add scopes back to `MYOB_SCOPES` in halves to find it.
  - "Unknown or reused state": the login didn't start from this run of the app (the app restarted
    mid-login, or the user opened an old link). Click **Connect to MYOB** again.
  - A red `MYOB returned 401` mentioning the company file: the file has its own login; set
    `MYOB_CF_USERNAME` / `MYOB_CF_PASSWORD` in `.env` and restart.
  - Login code expired before **Visit Site**: click **Connect to MYOB** again.

## Step 8: Browse data

Click **CUSTOMERS** on the home page, then any customer's name.

- **Proof:** screenshots of the customer list and one customer's JSON page.
- **Pass when:** the list shows `showing 1–20 of N` with rows, and the record page shows JSON with
  a `UID`.
- **Known failures:** **TIMESHEETS** showing a red MYOB error is expected; MYOB wants a date range
  for timesheets. Another resource failing with an access error usually means its scope
  wasn't granted; check `MYOB_SCOPES` and reconnect.

## Finish

Summarise what the user has now proven works (login, token storage, API calls, paging, fetching a
record), and remind them:

- run the app with `npm run start:ngrok` from now on, since the redirect URI points at ngrok
- the access token lasts 20 minutes and refreshes on the next request after that
- `.env` and `.tokens.json` hold secrets and are gitignored; keep them that way
