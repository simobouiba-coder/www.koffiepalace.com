# 📘 Koffie Palace – Complete Opstartgids

---

## 📁 Projectstructuur

```
koffie-palace/
├── public/
│   └── index.html        ← Jouw website
├── server/
│   └── server.js         ← Node.js backend (Mollie)
├── .env.example          ← Voorbeeldbestand voor instellingen
├── .env                  ← Jouw geheime instellingen (zelf aanmaken!)
└── package.json          ← Node.js projectbestand
```

---

## 🚀 Stap 1 – Node.js installeren

1. Ga naar https://nodejs.org
2. Download de **LTS versie** (aanbevolen)
3. Installeer het programma
4. Open Terminal (Mac) of Opdrachtprompt (Windows)
5. Controleer de installatie:
   ```
   node --version
   npm --version
   ```
   Je ziet zoiets als `v20.11.0` en `10.2.0`

---

## 📦 Stap 2 – Dependencies installeren

Open Terminal in de map `koffie-palace` en typ:

```bash
npm install
```

Dit installeert Express, Mollie en dotenv automatisch.

---

## 🔑 Stap 3 – Mollie account & API key

### Account aanmaken
1. Ga naar https://mollie.com/nl
2. Klik op **Gratis account aanmaken**
3. Vul je bedrijfsgegevens in (Koffie Palace / Nadira Store)
4. Verifieer je e-mailadres

### API key ophalen
1. Log in op https://my.mollie.com
2. Ga naar **Developers → API keys**
3. Kopieer de **Test API key** (begint met `test_`) voor testen
4. Later gebruik je de **Live API key** (begint met `live_`) voor echte betalingen

### iDEAL activeren
1. In Mollie dashboard → **Betaalmethoden**
2. Activeer: iDEAL, PayPal, Creditcard, Bankoverschrijving
3. Volg de verificatiestappen (KvK-nummer nodig)

---

## ⚙️ Stap 4 – .env bestand aanmaken

1. Kopieer het voorbeeldbestand:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` in een teksteditor (Kladblok, VS Code)
3. Vul jouw Mollie API key in:
   ```
   MOLLIE_API_KEY=test_jouwApiKeyHier
   BASE_URL=http://localhost:3000
   ```

---

## ▶️ Stap 5 – Server starten

```bash
npm start
```

Open je browser en ga naar: **http://localhost:3000**

Je ziet de Koffie Palace website. Je kunt nu testbetalingen doen!

### Testbetalingen
Mollie heeft testkaarten en test-iDEAL:
- In de betaalpagina kies je "Succeeded" → betaling geslaagd
- Kies "Failed" → betaling mislukt

---

## 🌐 Stap 6 – Domein kopen (koffiepalace.nl)

### Aanbevolen registrars voor .nl domeinen:
| Aanbieder        | Prijs/jaar | URL                    |
|------------------|-----------|------------------------|
| **TransIP**      | ~€ 3,–    | transip.nl             |
| **Antagonist**   | ~€ 4,–    | antagonist.nl          |
| **Versio**       | ~€ 3,–    | versio.nl              |
| **SIDN direct**  | ~€ 5,–    | sidn.nl                |

### Domein registreren (voorbeeld TransIP):
1. Ga naar **transip.nl**
2. Zoek op `koffiepalace.nl`
3. Als beschikbaar → klik **Registreren**
4. Maak een account aan met jouw bedrijfsgegevens
5. Betaal (± €3,– per jaar)
6. Klaar – je bent eigenaar van koffiepalace.nl

---

## 📧 Stap 7 – E-mailadres aanmaken (info@koffiepalace.nl)

### Optie A: TransIP E-mail (eenvoudig, NL)
1. Log in op TransIP → **E-mail**
2. Kies **E-mailhosting** (± €2,50/maand)
3. Maak aan: `info@koffiepalace.nl`
4. Gebruik via webmail of stel in Outlook/Gmail in

### Optie B: Google Workspace (professioneel)
1. Ga naar workspace.google.com
2. Koppel jouw domein `koffiepalace.nl`
3. Maak aan: `info@koffiepalace.nl`
4. Kosten: ± €6,– per maand
5. Voordeel: Gmail interface, Google Drive, Meet

### Optie C: Microsoft 365 (voor bedrijven)
1. microsoft.com/nl-nl/microsoft-365/business
2. Koppel jouw domein
3. Kosten: ± €5,60 per maand
4. Voordeel: Outlook, Word, Excel inbegrepen

**Aanbeveling:** TransIP e-mail voor simpel en goedkoop,
Google Workspace als je meer functies wilt.

---

## ☁️ Stap 8 – Website online zetten (hosting)

### Optie A: Railway (eenvoudig, gratis te beginnen)
1. Ga naar https://railway.app
2. Maak account aan met GitHub
3. Klik **New Project → Deploy from GitHub**
4. Upload jouw code via GitHub
5. Voeg Environment Variables toe (MOLLIE_API_KEY, BASE_URL)
6. Koppel jouw domein koffiepalace.nl

### Optie B: Render (gratis tier beschikbaar)
1. Ga naar https://render.com
2. Maak account aan
3. **New Web Service** → upload code
4. Voeg environment variables toe
5. Koppel domein

### Optie C: TransIP STACK (alles-in-één NL)
Als je TransIP gebruikt voor domein + e-mail, kun je ook
hun VPS hosting gebruiken voor de Node.js server.

---

## 🔒 Stap 9 – Live gaan met echte betalingen

1. Verifieer je bedrijf in Mollie dashboard (KvK + bankrekening)
2. Wacht op goedkeuring (1-3 werkdagen)
3. Vervang in `.env`:
   ```
   MOLLIE_API_KEY=live_jouwLiveApiKeyHier
   BASE_URL=https://www.koffiepalace.nl
   ```
4. Herstart de server

---

## 📞 Hulp nodig?

- Mollie support: https://help.mollie.com/nl
- TransIP support: https://www.transip.nl/support/
- Node.js docs: https://nodejs.org/docs

---

*Koffie Palace – By Nadira Store · Nederland*
