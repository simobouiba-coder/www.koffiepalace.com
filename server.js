const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/api/create-payment', async (req, res) => {
  try {
    const { createMollieClient } = require('@mollie/api-client');
    const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });
    const { total, method, customer, items } = req.body;
    const methodMap = { ideal:'ideal', paypal:'paypal', card:'creditcard', bank:'banktransfer' };
    const payment = await mollie.payments.create({
      amount: { currency: 'EUR', value: parseFloat(total).toFixed(2) },
      method: methodMap[method] || method,
      description: 'Koffie Palace bestelling',
      redirectUrl: (process.env.BASE_URL || 'https://wwwkoffiepalacecom-production.up.railway.app') + '/betaling-succes?email=' + encodeURIComponent(customer.email),
      webhookUrl: (process.env.BASE_URL || 'https://wwwkoffiepalacecom-production.up.railway.app') + '/api/webhook',
      metadata: { customer, items },
    });
    res.json({ checkoutUrl: payment.getCheckoutUrl() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/webhook', (req, res) => res.send('OK'));

app.get('/betaling-succes', (req, res) => {
  res.send('<html><body style="background:#07070A;color:#F5F0E8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><div><h1 style="color:#C9A84C">✅ Betaling geslaagd!</h1><p>Bedankt voor uw bestelling bij Koffie Palace.</p><a href="/" style="color:#C9A84C">← Terug</a></div></body></html>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Koffie Palace draait op poort ' + PORT));
