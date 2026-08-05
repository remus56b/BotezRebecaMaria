# Invitație botez — Rebeca Maria

Mini proiect Node.js + SQLite pentru invitația de botez cu tematica „Scufița Roșie”. Pagina publică este servită din `public/`, iar fotografiile originale, configurația și baza de date sunt în afara directorului public.

## Pornire locală

Ai nevoie de Node.js 22+; proiectul folosește SQLite inclus în Node, fără pachete externe.

Din rădăcina proiectului:

```powershell
node server.mjs
```

Deschide [http://localhost:8080](http://localhost:8080).

## Publicare online recomandată: Railway

Pentru că RSVP-urile sunt salvate în SQLite, creează un Volume Railway și montează-l la `/app/storage`; altfel datele din tabel se pot pierde la redeploy. Railway confirmă că Volume-urile sunt persistente, iar fișierele din afara lor sunt temporare.

1. Creează un repository privat pe GitHub și urcă proiectul. Nu urca `.env`; fotografiile nefolosite sunt excluse automat prin `.gitignore`.
2. În Railway: **New Project → Deploy from GitHub Repo** și selectează repository-ul.
3. Railway va folosi scriptul `npm start` din `package.json`.
4. Adaugă variabilele `APP_KEY`, `RESULTS_PATH` și `RESULTS_PASSWORD` în Railway Variables, cu valori noi și secrete.
5. Creează un Volume conectat la serviciu și setează mount path-ul exact la `/app/storage`.
6. Generează domeniul public Railway și testează invitația, formularul și `/Rezultate-tabel-invitatie`.

Nu folosi Render Free pentru această variantă cu SQLite: filesystem-ul serviciului este temporar, iar persistent disks sunt disponibile pe servicii web plătite. Alternativa este să mutăm răspunsurile într-o bază de date PostgreSQL/Supabase.

Pagina privată este disponibilă la `/Rezultate-tabel-invitatie`, dar cere parola din fișierul `.env`. Pentru publicare, schimbă `APP_KEY`, `RESULTS_PATH` și `RESULTS_PASSWORD`; nu încărca `.env` în Git.

## Structură și securitate

- RSVP-ul este validat server-side, folosește query-uri pregătite, token CSRF, câmp honeypot și limitare de trimitere.
- IP-ul nu este salvat în clar: se păstrează doar un hash HMAC pentru limitare.
- Baza de date este în `storage/responses.sqlite`, iar fotografiile sunt livrate doar printr-o listă albă din `private/config.php`.
- Ruta de rezultate este citită din `.env`, nu apare în HTML/CSS/JavaScript și nu există link către ea în invitația publică.
- Răspunsurile sunt accesibile doar după autentificarea cu parola de administrare și au `noindex, nofollow, noarchive`.

## Personalizare rapidă

Anul evenimentului este setat în `private/config.php` și `public/assets/app.js` la 2026, deoarece ai menționat doar ziua și luna. Dacă botezul este în alt an, schimbă valoarea ISO din ambele locuri; textul vizibil rămâne „13 septembrie”. Locațiile și numele se editează în `public/index.php`.
