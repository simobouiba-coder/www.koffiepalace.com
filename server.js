const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ─── POSTGRESQL ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false },
});

const DEFAULT_PRODUCTS = [
  { name: 'Espresso Classico',    price: 2.50,  description: 'Krachtig, vol en romig — de perfecte basis voor elke espresso.',                    category: 'espresso',    image_url: null },
  { name: 'Ristretto',            price: 2.50,  description: 'Kort en intens — geconcentreerde espresso voor de echte liefhebber.',                category: 'espresso',    image_url: null },
  { name: 'Lungo',                price: 2.75,  description: 'Verlengde espresso met een zachte, volle smaak.',                                    category: 'espresso',    image_url: null },
  { name: 'Dubbele Espresso',     price: 3.25,  description: 'Dubbele shot espresso — extra krachtig en aromatisch.',                              category: 'espresso',    image_url: null },
  { name: 'Cappuccino',           price: 3.25,  description: 'Espresso met romige melkschuim — de klassieker van het koffiecafé.',                 category: 'cappuccino',  image_url: null },
  { name: 'Droge Cappuccino',     price: 3.25,  description: 'Cappuccino met extra veel luchtig schuim en weinig melk.',                           category: 'cappuccino',  image_url: null },
  { name: 'Natte Cappuccino',     price: 3.25,  description: 'Cappuccino met meer melk en minder schuim — zacht en romig.',                        category: 'cappuccino',  image_url: null },
  { name: 'Iced Cappuccino',      price: 3.75,  description: 'Koude cappuccino over ijs — verfrissend en romig.',                                  category: 'cappuccino',  image_url: null },
  { name: 'Caffè Latte',          price: 3.50,  description: 'Espresso met veel gestoomde melk en een dun laagje schuim.',                         category: 'latte',       image_url: null },
  { name: 'Latte Macchiato',      price: 3.75,  description: 'Gelaagde drank van gestoomde melk met een shot espresso.',                           category: 'latte',       image_url: null },
  { name: 'Vanilla Latte',        price: 4.00,  description: 'Caffè latte met een vleugje vanillesiroop — zoet en zacht.',                         category: 'latte',       image_url: null },
  { name: 'Caramel Latte',        price: 4.00,  description: 'Romige latte met karamelsiroop — een verwennerij in een glas.',                      category: 'latte',       image_url: null },
  { name: 'Flat White',           price: 3.75,  description: 'Dubbele ristretto met zijdezachte microfoam — sterk en romig.',                      category: 'specialties', image_url: null },
  { name: 'Cortado',              price: 3.25,  description: 'Espresso aangelengd met een gelijke hoeveelheid warme melk.',                        category: 'specialties', image_url: null },
  { name: 'Cold Brew',            price: 4.25,  description: 'Koud gebrouwen koffie — glad, zoet en laag in zuurgraad.',                           category: 'specialties', image_url: null },
  { name: 'Affogato',             price: 4.50,  description: 'Vanille-ijs overgoten met een shot hete espresso — dessert en koffie in één.',       category: 'specialties', image_url: null },
];

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        price       DECIMAL(10, 2) NOT NULL,
        description TEXT,
        category    VARCHAR(100),
        image_url   VARCHAR(255),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const { rows } = await client.query('SELECT COUNT(*) FROM products');
    if (parseInt(rows[0].count, 10) === 0) {
      for (const p of DEFAULT_PRODUCTS) {
        await client.query(
          'INSERT INTO products (name, price, description, category, image_url) VALUES ($1, $2, $3, $4, $5)',
          [p.name, p.price, p.description, p.category, p.image_url]
        );
      }
      console.log(`Standaard producten ingevoegd (${DEFAULT_PRODUCTS.length} stuks)`);
    }

    console.log('Database klaar ✓');
  } finally {
    client.release();
  }
}

// ─── ORDERS FILE (JSON — blijft ongewijzigd) ─────────────────────────
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
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY category, id');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/products fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, price, description, category, image_url } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO products (name, price, description, category, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, price, description || null, category || null, image_url || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('POST /api/products fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, price, description, category, image_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE products
          SET name = $1, price = $2, description = $3, category = $4, image_url = $5,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *`,
      [name, price, description || null, category || null, image_url || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /api/products/:id fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/products/:id fout:', err.message);
    res.status(500).json({ error: err.message });
  }
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

// ─── START ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDatabase()
  .then(() => {
    app.listen(PORT, () => console.log('Koffie Palace draait op poort ' + PORT));
  })
  .catch(err => {
    console.error('Database initialisatie mislukt:', err.message);
    process.exit(1);
  });
