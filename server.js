/**
 * Koffie Palace – Backend Server
 * Node.js + Express + Mollie betalingen
 */

require('dotenv').config();
const express  = require('express');
const { createMollieClient } = require('@mollie/api-client');
const path     = require('path');

const app    = express();
const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

const methodMap = { ideal: 'ideal', paypal: 'paypal', card: 'creditcard', bank: 'banktransfer' };

// POST /api/create-payment
app.post('/api/create-payment', async (req, res) => {
  try {
    const { items, shipping, total, method, customer } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Geen producten' });

    const description = items.map(i => `${i.name}${i.variant ? ' ' + i.variant : ''} x${i.qty}`).join(', ');

    const payment = await mollie.payments.create({
      amount:      { currency: 'EUR', value: parseFloat(total).toFixed(2) },
      method:      methodMap[method] || method,
      description: `Koffie Palace - ${description}`,
      redirectUrl: `${process.env.BASE_URL}/betaling-succes?email=${encodeURIComponent(customer.email)}`,
      webhookUrl:  `${process.env.BASE_URL}/api/webhook`,
      metadata:    { customer, items, shipping },
    });

    console.log(`Betaling aangemaakt: ${payment.id} | ${customer.email} | EUR ${total}`);
    res.json({ checkoutUrl: payment.getCheckoutUrl() });
  } catch (err) {
    console.error('Mollie fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhook
app.post('/api/webhook', async (req, res) => {
  try {
    const payment = await mollie.payments.get(req.body.id);
    if (payment.isPaid()) {
      const { customer, items } = payment.metadata;
      console.log(`BETALING ONTVANGEN: ${customer.email} | ${items.map(i=>i.name+' x'+i.qty).join(', ')}`);
    }
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Fout');
  }
});

// GET /betaling-succes
app.get('/betaling-succes', (req, res) => {
  const email = req.query.email || '';
  res.send(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Betaling gelukt</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Jost:wght@300;400&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#07070A;color:#F5F0E8;font-family:'Jost',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.box{max-width:500px}.icon{font-size:4rem;margin-bottom:1.5rem}h1{font-family:'Cormorant Garamond',serif;font-size:2.8rem;font-weight:400;color:#C9A84C;margin-bottom:1rem}p{color:rgba(245,240,232,0.6);line-height:1.8;margin-bottom:1.5rem;font-weight:300}.divider{width:50px;height:1px;background:#C9A84C;margin:1.5rem auto;opacity:.4}a{display:inline-block;background:#C9A84C;color:#07070A;padding:.9rem 2.5rem;text-decoration:none;font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;font-weight:500}</style>
  </head><body><div class="box"><div class="icon">✅</div><h1>Betaling geslaagd!</h1><div class="divider"></div>
  <p>Bedankt voor uw bestelling bij <strong>Koffie Palace</strong>.${email ? '<br>Bevestiging verstuurd naar <strong>'+email+'</strong>.' : ''}</p>
  <p style="font-size:.82rem">Vragen? <strong>+31 6 13 86 41 89</strong> · <strong>info@koffiepalace.nl</strong></p>
  <div class="divider"></div><a href="/">← Terug naar de website</a></div></body></html>`);
});

// GET /betaling-mislukt
app.get('/betaling-mislukt', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Betaling mislukt</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400&family=Jost:wght@300;400&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#07070A;color:#F5F0E8;font-family:'Jost',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.box{max-width:500px}.icon{font-size:4rem;margin-bottom:1.5rem}h1{font-family:'Cormorant Garamond',serif;font-size:2.5rem;font-weight:400;color:#e74c3c;margin-bottom:1rem}p{color:rgba(245,240,232,0.6);line-height:1.8;margin-bottom:1.5rem}a{display:inline-block;background:#C9A84C;color:#07070A;padding:.9rem 2.5rem;text-decoration:none;font-size:.78rem;letter-spacing:.18em;text-transform:uppercase}</style>
  </head><body><div class="box"><div class="icon">❌</div><h1>Betaling mislukt</h1>
  <p>Uw betaling is niet gelukt. Probeer het opnieuw of kies een andere betaalmethode.</p>
  <a href="/">← Probeer opnieuw</a></div></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════╗');
  console.log('║  ☕  Koffie Palace Server         ║');
  console.log(`║  🌐  http://localhost:${PORT}        ║`);
  console.log(`║  🔑  Mollie: ${process.env.MOLLIE_API_KEY ? '✅ OK' : '❌ NIET INGESTELD'}            ║`);
  console.log('╚══════════════════════════════════╝\n');
});
