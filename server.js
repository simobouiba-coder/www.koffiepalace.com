const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ─── PRODUCTS FILE ───────────────────────────────────────────────────
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

function readProducts() {
  if (!fs.existsSync(PRODUCTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8')); }
  catch(e) { return []; }
}

function writeProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

// ─── ORDERS FILE ────────────────────────────────────────────────────
const ORDERS_FILE = path.join(__dirname, 'orders.json');

function readOrders() {
  if (!fs.existsSync(ORDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch(e) { return []; }
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ─── PAGES ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/admin.html'));

// ─── PRODUCTS API ────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  res.json(readProducts());
});

app.post('/api/products', (req, res) => {
  const products = readProducts();
  const newProduct = { id: Date.now().toString(), ...req.body };
  products.push(newProduct);
  writeProducts(products);
  res.json(newProduct);
});

app.put('/api/products/:id', (req, res) => {
  const products = readProducts();
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Product niet gevonden' });
  products[index] = { ...products[index], ...req.body };
  writeProducts(products);
  res.json(products[index]);
});

app.delete('/api/products/:id', (req, res) => {
  let products = readProducts();
  products = products.filter(p => p.id !== req.params.id);
  writeProducts(products);
  res.json({ success: true });
});

// ─── ORDERS API ──────────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  res.json(readOrders());
});

// ─── PAYMENT ─────────────────────────────────────────────────────────
app.post('/api/create-payment', async (req, res) => {
  try {
    const { createMollieClient } = require('@mollie/api-client');
    const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });
    const { total, method, customer, items } = req.body;
    const methodMap = { ideal: 'ideal', paypal: 'paypal', card: 'creditcard', bank: 'banktransfer' };
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

app.post('/api/webhook', (req, res) => {
  try {
    const orders = readOrders();
    const { id } = req.body;
    const existing = orders.find(o => o.mollieId === id);
    if (!existing) {
      orders.push({
        id: Date.now().toString(),
        mollieId: id,
        status: 'betaald',
        date: new Date().toLocaleDateString('nl-NL'),
        ...req.body
      });
      writeOrders(orders);
    }
  } catch(e) {}
  res.send('OK');
});

app.get('/betaling-succes', (req, res) => {
  res.send('<html><body style="background:#07070A;color:#F5F0E8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><div><h1 style="color:#C9A84C">✅ Betaling geslaagd!</h1><p>Bedankt voor uw bestelling bij Koffie Palace.</p><a href="/" style="color:#C9A84C">← Terug</a></div></body></html>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Koffie Palace draait op poort ' + PORT));
