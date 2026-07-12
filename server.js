const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { createMollieClient } = require('@mollie/api-client');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Mollie client ───────────────────────────────────────────────────────────
const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });

// ─── Email transporter ──────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});

async function sendOrderConfirmation(customer, items, total, orderNumber) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ SMTP niet geconfigureerd, mail overgeslagen');
    return;
  }
  // customer kan JSON string of object zijn
  if (typeof customer === 'string') {
    try { customer = JSON.parse(customer); } catch(e) { customer = {}; }
  }
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  try {
    const itemsHtml = (items || []).map(i =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #333;">${i.name}${i.variant ? ' · ' + i.variant : ''} × ${i.qty}</td>
        <td style="padding:8px;border-bottom:1px solid #333;text-align:right;">€ ${(i.price * i.qty).toFixed(2)}</td>
       </tr>`
    ).join('');

    await transporter.sendMail({
      from: `"Koffie Palace" <${process.env.SMTP_USER}>`,
      to: customer.email,
      bcc: process.env.SMTP_USER,
      subject: `Bevestiging bestelling ${orderNumber} – Koffie Palace`,
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f0e8;padding:40px;">
          <h1 style="color:#c9a84c;font-size:28px;margin-bottom:8px;">Koffie Palace</h1>
          <p style="color:#888;margin-top:0;">Bestelling bevestigd</p>
          <hr style="border-color:#333;margin:24px 0;">
          <p>Beste ${customer.voornaam || ''},</p>
          <p>Bedankt voor uw bestelling! Wij hebben uw betaling ontvangen en gaan direct aan de slag.</p>
          <h3 style="color:#c9a84c;">Bestelling ${orderNumber}</h3>
          <table style="width:100%;border-collapse:collapse;">
            ${itemsHtml}
            <tr>
              <td style="padding:12px 8px;font-weight:bold;color:#c9a84c;">Totaal incl. verzending</td>
              <td style="padding:12px 8px;text-align:right;font-weight:bold;color:#c9a84c;">€ ${parseFloat(total || 0).toFixed(2)}</td>
            </tr>
          </table>
          <hr style="border-color:#333;margin:24px 0;">
          <p style="color:#888;font-size:14px;">Vragen? Mail ons op <a href="mailto:${process.env.SMTP_USER}" style="color:#c9a84c;">${process.env.SMTP_USER}</a></p>
          <p style="color:#888;font-size:12px;">© Koffie Palace · By Nadira Store · Nederland</p>
        </div>
      `
    });
    console.log('✅ Bevestigingsmail verstuurd naar', customer.email);
  } catch (err) {
    console.error('❌ Email fout:', err.message);
  }
}

// ─── PostgreSQL connectie ────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false }
});

// ─── Database initialisatie ──────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC(10,2),
        image TEXT,
        variants JSONB,
        specs JSONB,
        in_stock BOOLEAN DEFAULT true,
        featured BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Voorraadaantal (bestond nog niet — alleen in_stock true/false)
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      INSERT INTO settings (key, value) VALUES
        ('telefoon', ''), ('whatsapp', ''), ('email', ''), ('adres', ''), ('openingstijden', '')
      ON CONFLICT (key) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number TEXT UNIQUE NOT NULL,
        customer JSONB NOT NULL,
        items JSONB NOT NULL,
        shipping JSONB,
        payment JSONB,
        subtotal NUMERIC(10,2),
        shipping_cost NUMERIC(10,2),
        total NUMERIC(10,2),
        status TEXT DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Voorkomt dubbele/gemiste bevestigingsmails (zie syncPaymentByMollieId)
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ`);

    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS set_products_updated_at ON products;
      CREATE TRIGGER set_products_updated_at
        BEFORE UPDATE ON products
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS set_orders_updated_at ON orders;
      CREATE TRIGGER set_orders_updated_at
        BEFORE UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    `);

    console.log('✅ Database tabellen klaar');

    const { rowCount } = await client.query('SELECT 1 FROM products LIMIT 1');
    if (rowCount === 0) await seedProducts(client);

  } finally {
    client.release();
  }
}

// ─── Seed producten ──────────────────────────────────────────────────────────
async function seedProducts(client) {
  const products = [
    { slug: 'palace-blend', category: 'beans', name: 'Palace Blend', description: 'Onze signature blend — rijk, romig, met een subtiele chocoladenoot.', price: 12.95, image: '/images/beans-palace-blend.jpg', variants: JSON.stringify([{size:'250g',price:12.95},{size:'500g',price:22.95},{size:'1kg',price:39.95}]), specs: JSON.stringify({origin:'Brazil & Ethiopia',roast:'Medium'}), featured: true, stock_quantity: 40 },
    { slug: 'single-origin-ethiopia', category: 'beans', name: 'Single Origin Ethiopia', description: 'Fruitig en bloemenachtig — een echte specialty koffie.', price: 15.95, image: '/images/beans-ethiopia.jpg', variants: JSON.stringify([{size:'250g',price:15.95},{size:'500g',price:28.95}]), specs: JSON.stringify({origin:'Yirgacheffe, Ethiopia',roast:'Light'}), featured: false, stock_quantity: 25 },
    { slug: 'espresso-classico', category: 'beans', name: 'Espresso Classico', description: 'Krachtige Italiaanse espresso blend.', price: 11.95, image: '/images/beans-espresso.jpg', variants: JSON.stringify([{size:'250g',price:11.95},{size:'500g',price:20.95},{size:'1kg',price:36.95}]), specs: JSON.stringify({origin:'Brazil & Robusta',roast:'Dark'}), featured: false, stock_quantity: 25 },
    { slug: 'decaf-arabica', category: 'beans', name: 'Decaf Arabica', description: 'Alle smaak, zonder cafeïne.', price: 13.95, image: '/images/beans-decaf.jpg', variants: JSON.stringify([{size:'250g',price:13.95},{size:'500g',price:24.95}]), specs: JSON.stringify({origin:'Colombia',roast:'Medium'}), featured: false, stock_quantity: 25 },
    { slug: 'delonghi-dedica', category: 'machines', name: "De'Longhi Dedica", description: 'Compact en stijlvol — ideaal voor thuis gebruik.', price: 199.00, image: '/images/machine-dedica.jpg', variants: null, specs: JSON.stringify({brand:"De'Longhi",type:'Pistonmachine'}), featured: true, stock_quantity: 10 },
    { slug: 'jura-e6', category: 'machines', name: 'Jura E6', description: 'Volautomaat met één druk op de knop.', price: 799.00, image: '/images/machine-jura-e6.jpg', variants: null, specs: JSON.stringify({brand:'Jura',type:'Volautomaat'}), featured: true, stock_quantity: 6 },
    { slug: 'philips-3200', category: 'machines', name: 'Philips 3200 LatteGo', description: 'Eenvoudig te reinigen melksysteem.', price: 549.00, image: '/images/machine-philips.jpg', variants: null, specs: JSON.stringify({brand:'Philips',type:'Volautomaat'}), featured: false, stock_quantity: 8 },
    { slug: 'siemens-ti9573', category: 'machines', name: 'Siemens EQ.9 Plus', description: 'Premium volautomaat.', price: 1199.00, image: '/images/machine-siemens.jpg', variants: null, specs: JSON.stringify({brand:'Siemens',type:'Volautomaat'}), featured: false, stock_quantity: 4 },
    { slug: 'sage-barista-express', category: 'machines', name: 'Sage Barista Express', description: 'Ingebouwde molen + pistonmachine.', price: 699.00, image: '/images/machine-sage.jpg', variants: null, specs: JSON.stringify({brand:'Sage',type:'Pistonmachine met molen'}), featured: true, stock_quantity: 7 },
    { slug: 'la-marzocco-linea-mini', category: 'machines', name: 'La Marzocco Linea Mini', description: 'Professionele horeca kwaliteit.', price: 3499.00, image: '/images/machine-lamarzocco.jpg', variants: null, specs: JSON.stringify({brand:'La Marzocco',type:'Pistonmachine'}), featured: false, stock_quantity: 2 },
    { slug: 'filterhouder-universeel', category: 'onderdelen', name: 'Filterhouder Universeel 58mm', description: 'Past op de meeste pistonmachines.', price: 24.95, image: '/images/onderdeel-filterhouder.jpg', variants: JSON.stringify([{type:'Enkel',price:24.95},{type:'Dubbel',price:26.95}]), specs: JSON.stringify({diameter:'58mm'}), featured: false, stock_quantity: 50 },
    { slug: 'waterfilter-brita', category: 'onderdelen', name: 'Waterfilter Brita Intenza+', description: 'Compatibel met Siemens en Bosch.', price: 14.95, image: '/images/onderdeel-waterfilter.jpg', variants: JSON.stringify([{pack:'1 stuks',price:14.95},{pack:'3 stuks',price:39.95}]), specs: JSON.stringify({compatible:'Siemens EQ, Bosch VeroSeries'}), featured: false, stock_quantity: 50 },
    { slug: 'ontkalker-250ml', category: 'onderdelen', name: 'Ontkalker 250ml', description: 'Universele ontkalker voor alle koffiemachines.', price: 9.95, image: '/images/onderdeel-ontkalker.jpg', variants: null, specs: JSON.stringify({volume:'250ml'}), featured: false, stock_quantity: 60 }
  ];

  for (const p of products) {
    await client.query(`
      INSERT INTO products (slug, category, name, description, price, image, variants, specs, featured, stock_quantity)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (slug) DO NOTHING
    `, [p.slug, p.category, p.name, p.description, p.price, p.image, p.variants || null, p.specs || null, p.featured || false, p.stock_quantity ?? 0]);
  }
  console.log('✅ Standaard producten geseed');
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// ─── API: Producten ──────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const { category, featured } = req.query;
    let query = 'SELECT * FROM products WHERE in_stock = true';
    const params = [];
    if (category) { params.push(category); query += ` AND category = $${params.length}`; }
    if (featured === 'true') query += ' AND featured = true';
    query += ' ORDER BY category, id';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/products:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

app.get('/api/products/:slug', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE slug = $1', [req.params.slug]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// Let op: deze drie routes wijzigen data en vereisen daarom nu ook het admin-token
// (voorheen kon iedereen die de URL kende producten aanmaken/wijzigen/verwijderen)
app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const { slug, category, name, description, price, image, variants, specs, in_stock, featured, stock_quantity } = req.body;
    if (!slug || !category || !name) return res.status(400).json({ error: 'slug, category en name zijn verplicht' });
    const stockProvided = stock_quantity !== undefined && stock_quantity !== null;
    const stockQty = stockProvided ? Math.max(parseInt(stock_quantity, 10) || 0, 0) : 0;
    const computedInStock = stockProvided ? stockQty > 0 : in_stock !== false;
    const { rows } = await pool.query(`
      INSERT INTO products (slug, category, name, description, price, image, variants, specs, in_stock, featured, stock_quantity)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [slug, category, name, description, price, image,
        variants ? JSON.stringify(variants) : null,
        specs ? JSON.stringify(specs) : null,
        computedInStock, featured || false, stockQty]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug bestaat al' });
    res.status(500).json({ error: 'Database fout' });
  }
});

app.put('/api/products/:slug', requireAdmin, async (req, res) => {
  try {
    const { category, name, description, price, image, variants, specs, in_stock, featured, stock_quantity } = req.body;
    const stockProvided = stock_quantity !== undefined && stock_quantity !== null;
    const stockQty = stockProvided ? Math.max(parseInt(stock_quantity, 10) || 0, 0) : null;
    const computedInStock = stockProvided ? stockQty > 0 : in_stock;
    const { rows } = await pool.query(`
      UPDATE products SET
        category = COALESCE($1, category), name = COALESCE($2, name),
        description = COALESCE($3, description), price = COALESCE($4, price),
        image = COALESCE($5, image), variants = COALESCE($6, variants),
        specs = COALESCE($7, specs), in_stock = COALESCE($8, in_stock),
        featured = COALESCE($9, featured), stock_quantity = COALESCE($10, stock_quantity)
      WHERE slug = $11 RETURNING *
    `, [category, name, description, price, image,
        variants ? JSON.stringify(variants) : null,
        specs ? JSON.stringify(specs) : null,
        computedInStock, featured, stockQty, req.params.slug]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.delete('/api/products/:slug', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM products WHERE slug = $1', [req.params.slug]);
    if (rowCount === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// ─── API: Mollie betaling aanmaken ───────────────────────────────────────────
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, items, customer, shipping, method } = req.body;

    // Validatie
    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'amount is verplicht en moet een getal zijn' });
    }
    if (!description) {
      return res.status(400).json({ error: 'description is verplicht' });
    }
    if (!customer || !customer.email) {
      return res.status(400).json({ error: 'customer.email is verplicht' });
    }

    const baseUrl = process.env.BASE_URL || 'https://www.koffiepalace.nl';
    const orderNumber = 'KP-' + Date.now().toString(36).toUpperCase();
    const amountValue = parseFloat(amount).toFixed(2);
    const shippingCost = parseFloat(shipping?.cost || 0);

    // Bewaar order in database
    await pool.query(`
      INSERT INTO orders (order_number, customer, items, shipping, payment, subtotal, shipping_cost, total, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
    `, [
      orderNumber,
      JSON.stringify(customer),
      JSON.stringify(items || []),
      JSON.stringify(shipping || {}),
      JSON.stringify({ method: method || 'ideal', status: 'pending' }),
      parseFloat(amount) - shippingCost,
      shippingCost,
      parseFloat(amount)
    ]);

    // Mollie betaling aanmaken
    const payment = await mollie.payments.create({
      amount: { currency: 'EUR', value: amountValue },
      description,
      redirectUrl: `${baseUrl}/betaling-succes.html?order=${orderNumber}`,
      webhookUrl: `${baseUrl}/api/webhook/mollie`,
      method: method || undefined,
      metadata: { orderNumber, customerEmail: customer.email }
    });

    // Mollie payment ID opslaan
    await pool.query(
      `UPDATE orders SET payment = $1 WHERE order_number = $2`,
      [JSON.stringify({ method: method || 'ideal', mollie_id: payment.id, status: 'open' }), orderNumber]
    );

    console.log(`✅ Betaling aangemaakt: ${orderNumber} → ${payment.id}`);

    res.json({
      success: true,
      paymentUrl: payment._links.checkout.href,
      orderNumber
    });

  } catch (err) {
    console.error('POST /api/create-payment fout:', err);
    res.status(500).json({ error: 'Betaling aanmaken mislukt: ' + err.message });
  }
});

// ─── Bevestiging + voorraadafboeking bij "betaald" (idempotent) ────────────
// Losgetrokken van syncPaymentByMollieId zodat DEZE zelfde logica ook
// afgaat wanneer een order op een andere manier op "paid" terechtkomt —
// bijvoorbeeld doordat iemand de status handmatig in het admin-paneel
// corrigeert. Voorheen gebeurde dat alleen binnen de Mollie-webhook: als
// een medewerker de status met de hand op "Betaald" zette (bv. omdat de
// klant belde dat de webhook kennelijk had gefaald), werd er nooit alsnog
// een bevestigingsmail verstuurd — de order zag er correct uit, maar de
// klant had nog steeds niets ontvangen.
async function handleOrderPaid(order) {
  if (!order || order.confirmation_sent_at) return order;

  // Voorraad afboeken — alleen voor items met een numerieke id die
  // overeenkomt met een echt product in de database (de hardcoded
  // demo-catalogus in de frontend heeft geen bijbehorende db-rijen)
  for (const item of (order.items || [])) {
    const pid = parseInt(item.id, 10);
    if (!Number.isNaN(pid)) {
      await pool.query(
        `UPDATE products SET stock_quantity = GREATEST(stock_quantity - $1, 0),
           in_stock = (GREATEST(stock_quantity - $1, 0) > 0)
         WHERE id = $2`,
        [item.qty || 1, pid]
      );
    }
  }

  await sendOrderConfirmation(order.customer, order.items, order.total, order.order_number);
  const updated = await pool.query(
    `UPDATE orders SET confirmation_sent_at = NOW() WHERE order_number = $1 RETURNING *`,
    [order.order_number]
  );
  return updated.rows[0];
}

// ─── Betaalstatus synchroniseren (gedeeld door webhook + fallback-check) ────
// Wordt vanaf twee onafhankelijke plekken aangeroepen: de Mollie-webhook en de
// bedankpagina (betaling-succes.html). Welke van de twee er ook het eerst
// "paid" ziet, de bevestigingsmail + voorraadafboeking gebeurt maar één keer
// dankzij de confirmation_sent_at-vlag.
async function syncPaymentByMollieId(molliePaymentId) {
  const payment = await mollie.payments.get(molliePaymentId);
  const orderNumber = payment.metadata?.orderNumber;
  if (!orderNumber) return null;

  const status = payment.status === 'paid' ? 'paid'
    : payment.status === 'failed' ? 'failed'
    : payment.status === 'canceled' ? 'cancelled'
    : 'pending';

  const { rows } = await pool.query(
    `UPDATE orders SET status = $1, payment = $2 WHERE order_number = $3 RETURNING *`,
    [status, JSON.stringify({ mollie_id: molliePaymentId, status: payment.status }), orderNumber]
  );
  if (rows.length === 0) return null;
  let order = rows[0];
  console.log(`Order ${orderNumber} status → ${status}`);

  if (status === 'paid') {
    order = await handleOrderPaid(order);
  }

  return order;
}

// ─── Mollie webhook ──────────────────────────────────────────────────────────
app.post('/api/webhook/mollie', async (req, res) => {
  const { id: molliePaymentId } = req.body;
  if (!molliePaymentId) return res.sendStatus(200);
  try {
    await syncPaymentByMollieId(molliePaymentId);
    res.sendStatus(200);
  } catch (err) {
    // Belangrijk: NIET stilzwijgend 200 teruggeven bij een echte fout.
    // Bij 500 blijft Mollie de webhook automatisch een tijd lang opnieuw
    // proberen; bij 200 denkt Mollie dat het gelukt is en probeert het nooit
    // meer — en dan is de bevestiging voorgoed weg.
    console.error('Mollie webhook fout:', err.message);
    res.sendStatus(500);
  }
});

// ─── Fallback-check voor de bedankpagina ────────────────────────────────────
// De klant komt na betalen terug op betaling-succes.html?order=KP-XXXX. Die
// pagina roept dit endpoint aan, dat de status onafhankelijk van de webhook
// bij Mollie opvraagt. Zo is er niet één maar zijn er twee kansen om "betaald"
// te detecteren en de bevestiging te versturen.
app.get('/api/orders/:orderNumber/check-payment', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_number = $1', [req.params.orderNumber]);
    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    let order = rows[0];
    const mollieId = order.payment?.mollie_id;
    if (mollieId && order.status !== 'paid') {
      const updated = await syncPaymentByMollieId(mollieId);
      if (updated) order = updated;
    }
    res.json({
      orderNumber: order.order_number,
      status: order.status,
      confirmationSent: !!order.confirmation_sent_at,
      total: order.total
    });
  } catch (err) {
    console.error('check-payment fout:', err.message);
    res.status(500).json({ error: 'Kon status niet controleren' });
  }
});

// ─── API: Bestellingen ───────────────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, shipping, payment, subtotal, shipping_cost, total, notes } = req.body;
    if (!customer || !items || items.length === 0) return res.status(400).json({ error: 'customer en items zijn verplicht' });
    const orderNumber = 'KP-' + Date.now().toString(36).toUpperCase();
    const { rows } = await pool.query(`
      INSERT INTO orders (order_number, customer, items, shipping, payment, subtotal, shipping_cost, total, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [orderNumber, JSON.stringify(customer), JSON.stringify(items),
        JSON.stringify(shipping || {}), JSON.stringify(payment || {}),
        subtotal, shipping_cost, total, notes]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM orders';
    const params = [];
    if (status) { params.push(status); query += ` WHERE status = $1`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.get('/api/orders/:orderNumber', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_number = $1', [req.params.orderNumber]);
    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.patch('/api/orders/:orderNumber/status', async (req, res) => {
  try {
    const { status, payment } = req.body;
    const { rows } = await pool.query(`
      UPDATE orders SET status = COALESCE($1, status), payment = COALESCE($2, payment)
      WHERE order_number = $3 RETURNING *
    `, [status, payment ? JSON.stringify(payment) : null, req.params.orderNumber]);
    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    let order = rows[0];
    if (order.status === 'paid') order = await handleOrderPaid(order);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// ─── Instellingen ────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    const s = {};
    rows.forEach(r => s[r.key] = r.value);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// ─── Admin authenticatie ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const adminToken = process.env.ADMIN_TOKEN || 'koffiepalace2024';
  if (token === adminToken) return next();
  res.status(401).json({ error: 'Ongeautoriseerd' });
}

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM orders';
    const params = [];
    if (status) { params.push(status); query += ` WHERE status = $1`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.patch('/api/admin/orders/:orderNumber/status', requireAdmin, async (req, res) => {
  try {
    const { status, payment } = req.body;
    const { rows } = await pool.query(`
      UPDATE orders SET status = COALESCE($1, status), payment = COALESCE($2, payment)
      WHERE order_number = $3 RETURNING *
    `, [status, payment ? JSON.stringify(payment) : null, req.params.orderNumber]);
    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    // Als een medewerker de status hier met de hand op "paid" zet (bv. om een
    // gemiste webhook recht te trekken), moet de bevestigingsmail alsnog uit
    // dezelfde route lopen als de automatische flow — anders lijkt de order
    // correct terwijl de klant nog steeds niets ontvangen heeft.
    let order = rows[0];
    if (order.status === 'paid') order = await handleOrderPaid(order);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// Handmatig een bevestigingsmail (opnieuw) versturen — bv. als een klant
// belt dat hij niks ontvangen heeft, ook als de automatische flow om wat voor
// reden dan ook toch een keer misgaat.
app.post('/api/admin/orders/:orderNumber/resend-confirmation', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_number = $1', [req.params.orderNumber]);
    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    const order = rows[0];
    await sendOrderConfirmation(order.customer, order.items, order.total, order.order_number);
    await pool.query(`UPDATE orders SET confirmation_sent_at = NOW() WHERE order_number = $1`, [order.order_number]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Versturen mislukt: ' + err.message });
  }
});

app.get('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const { slug, category, name, description, price, image, variants, specs, in_stock, featured, stock_quantity } = req.body;
    const stockProvided = stock_quantity !== undefined && stock_quantity !== null;
    const stockQty = stockProvided ? Math.max(parseInt(stock_quantity, 10) || 0, 0) : 0;
    const computedInStock = stockProvided ? stockQty > 0 : (in_stock ?? true);
    const { rows } = await pool.query(
      `INSERT INTO products (slug, category, name, description, price, image, variants, specs, in_stock, featured, stock_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [slug, category, name, description, price, image, JSON.stringify(variants||[]), JSON.stringify(specs||{}), computedInStock, featured ?? false, stockQty]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.put('/api/admin/products/:slug', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, image, variants, specs, in_stock, featured, category, stock_quantity } = req.body;
    const stockProvided = stock_quantity !== undefined && stock_quantity !== null;
    const stockQty = stockProvided ? Math.max(parseInt(stock_quantity, 10) || 0, 0) : null;
    const computedInStock = stockProvided ? stockQty > 0 : in_stock;
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, image=$4, variants=$5, specs=$6,
       in_stock=COALESCE($7, in_stock), featured=$8, category=$9, stock_quantity=COALESCE($10, stock_quantity), updated_at=NOW() WHERE slug=$11 RETURNING *`,
      [name, description, price, image, JSON.stringify(variants||[]), JSON.stringify(specs||{}), computedInStock, featured, category, stockQty, req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// Snelle voorraad-aanpassing (los van het volledige bewerkformulier):
// { stock_quantity: 12 } zet het aantal exact, { delta: -1 } telt op/af
app.patch('/api/admin/products/:slug/stock', requireAdmin, async (req, res) => {
  try {
    const { stock_quantity, delta } = req.body;
    let query, params;
    if (delta !== undefined) {
      query = `UPDATE products SET stock_quantity = GREATEST(stock_quantity + $1, 0),
                 in_stock = (GREATEST(stock_quantity + $1, 0) > 0), updated_at = NOW()
               WHERE slug = $2 RETURNING *`;
      params = [parseInt(delta, 10) || 0, req.params.slug];
    } else if (stock_quantity !== undefined) {
      const qty = Math.max(parseInt(stock_quantity, 10) || 0, 0);
      query = `UPDATE products SET stock_quantity = $1, in_stock = ($1 > 0), updated_at = NOW()
               WHERE slug = $2 RETURNING *`;
      params = [qty, req.params.slug];
    } else {
      return res.status(400).json({ error: 'stock_quantity of delta is verplicht' });
    }
    const { rows } = await pool.query(query, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.delete('/api/admin/products/:slug', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM products WHERE slug = $1', [req.params.slug]);
    if (rowCount === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const keys = ['telefoon', 'whatsapp', 'email', 'adres', 'openingstijden'];
    for (const k of keys) {
      if (req.body[k] !== undefined) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
          [k, req.body[k]]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database fout' });
  }
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── Admin paneel routes ──────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ─── Catch-all ───────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint niet gevonden' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Koffie Palace server draait op poort ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Database initialisatie mislukt:', err);
    process.exit(1);
  });
