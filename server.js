const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── PostgreSQL connectie ───────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal')
    ? false  // intern Railway netwerk — geen SSL nodig
    : { rejectUnauthorized: false }
});

// ─── Database initialisatie ─────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    // Producten tabel
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,         -- 'beans' | 'machines' | 'onderdelen'
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC(10,2),
        image TEXT,
        variants JSONB,                  -- bijv. [{size:'250g', price:9.95}, ...]
        specs JSONB,                     -- machine specs of extra info
        in_stock BOOLEAN DEFAULT true,
        featured BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Bestellingen tabel
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number TEXT UNIQUE NOT NULL,
        customer JSONB NOT NULL,         -- naam, email, adres, land
        items JSONB NOT NULL,            -- [{slug, name, qty, price, variant}]
        shipping JSONB,                  -- {method, country, cost}
        payment JSONB,                   -- {method, mollie_id, status}
        subtotal NUMERIC(10,2),
        shipping_cost NUMERIC(10,2),
        total NUMERIC(10,2),
        status TEXT DEFAULT 'pending',   -- pending | paid | shipped | cancelled
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Auto-update timestamp trigger
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

    // Seed standaard producten als tabel leeg is
    const { rowCount } = await client.query('SELECT 1 FROM products LIMIT 1');
    if (rowCount === 0) {
      await seedProducts(client);
    }

  } finally {
    client.release();
  }
}

// ─── Seed standaard Koffie Palace producten ─────────────────────────────────
async function seedProducts(client) {
  const products = [
    // Koffiebonen
    {
      slug: 'palace-blend',
      category: 'beans',
      name: 'Palace Blend',
      description: 'Onze signature blend — rijk, romig, met een subtiele chocoladenoot.',
      price: 12.95,
      image: '/images/beans-palace-blend.jpg',
      variants: JSON.stringify([
        { size: '250g', price: 12.95 },
        { size: '500g', price: 22.95 },
        { size: '1kg',  price: 39.95 }
      ]),
      specs: JSON.stringify({ origin: 'Brazil & Ethiopia', roast: 'Medium', grind: 'Whole bean' }),
      featured: true
    },
    {
      slug: 'single-origin-ethiopia',
      category: 'beans',
      name: 'Single Origin Ethiopia',
      description: 'Fruitig en bloemenachtig — een echte specialty koffie.',
      price: 15.95,
      image: '/images/beans-ethiopia.jpg',
      variants: JSON.stringify([
        { size: '250g', price: 15.95 },
        { size: '500g', price: 28.95 }
      ]),
      specs: JSON.stringify({ origin: 'Yirgacheffe, Ethiopia', roast: 'Light', grind: 'Whole bean' }),
      featured: false
    },
    {
      slug: 'espresso-classico',
      category: 'beans',
      name: 'Espresso Classico',
      description: 'Krachtige Italiaanse espresso blend voor thuis en horeca.',
      price: 11.95,
      image: '/images/beans-espresso.jpg',
      variants: JSON.stringify([
        { size: '250g', price: 11.95 },
        { size: '500g', price: 20.95 },
        { size: '1kg',  price: 36.95 }
      ]),
      specs: JSON.stringify({ origin: 'Brazil & Robusta', roast: 'Dark', grind: 'Whole bean' }),
      featured: false
    },
    {
      slug: 'decaf-arabica',
      category: 'beans',
      name: 'Decaf Arabica',
      description: 'Alle smaak, zonder cafeïne — perfect voor de avond.',
      price: 13.95,
      image: '/images/beans-decaf.jpg',
      variants: JSON.stringify([
        { size: '250g', price: 13.95 },
        { size: '500g', price: 24.95 }
      ]),
      specs: JSON.stringify({ origin: 'Colombia', roast: 'Medium', grind: 'Whole bean', decaf: true }),
      featured: false
    },
    // Machines
    {
      slug: 'delonghi-dedica',
      category: 'machines',
      name: 'De\'Longhi Dedica',
      description: 'Compact en stijlvol — ideaal voor thuis gebruik.',
      price: 199.00,
      image: '/images/machine-dedica.jpg',
      variants: null,
      specs: JSON.stringify({ brand: 'De\'Longhi', type: 'Pistonmachine', pressure: '15 bar', milk: 'Stoompijpje', warranty: '2 jaar' }),
      featured: true
    },
    {
      slug: 'jura-e6',
      category: 'machines',
      name: 'Jura E6',
      description: 'Volautomaat met één druk op de knop — perfect voor kantoor.',
      price: 799.00,
      image: '/images/machine-jura-e6.jpg',
      variants: null,
      specs: JSON.stringify({ brand: 'Jura', type: 'Volautomaat', pressure: '15 bar', milk: 'Geïntegreerd', grinder: 'Ingebouwd', warranty: '2 jaar' }),
      featured: true
    },
    {
      slug: 'philips-3200',
      category: 'machines',
      name: 'Philips 3200 LatteGo',
      description: 'Eenvoudig te reinigen melksysteem, uitstekende espresso.',
      price: 549.00,
      image: '/images/machine-philips.jpg',
      variants: null,
      specs: JSON.stringify({ brand: 'Philips', type: 'Volautomaat', pressure: '15 bar', milk: 'LatteGo', warranty: '2 jaar' }),
      featured: false
    },
    {
      slug: 'siemens-ti9573',
      category: 'machines',
      name: 'Siemens EQ.9 Plus',
      description: 'Premium volautomaat — barista kwaliteit voor thuis.',
      price: 1199.00,
      image: '/images/machine-siemens.jpg',
      variants: null,
      specs: JSON.stringify({ brand: 'Siemens', type: 'Volautomaat', pressure: '19 bar', milk: 'oneTouch Double Cup', warranty: '3 jaar' }),
      featured: false
    },
    {
      slug: 'sage-barista-express',
      category: 'machines',
      name: 'Sage Barista Express',
      description: 'Ingebouwde molen + pistonmachine — voor de echte koffieliefhebber.',
      price: 699.00,
      image: '/images/machine-sage.jpg',
      variants: null,
      specs: JSON.stringify({ brand: 'Sage', type: 'Pistonmachine met molen', pressure: '15 bar', milk: 'Stoompijpje', warranty: '2 jaar' }),
      featured: true
    },
    {
      slug: 'la-marzocco-linea-mini',
      category: 'machines',
      name: 'La Marzocco Linea Mini',
      description: 'Professionele horeca kwaliteit — voor thuis of kleine zaak.',
      price: 3499.00,
      image: '/images/machine-lamarzocco.jpg',
      variants: null,
      specs: JSON.stringify({ brand: 'La Marzocco', type: 'Pistonmachine', pressure: '9 bar', milk: 'Dubbel boiler', warranty: '2 jaar' }),
      featured: false
    },
    // Onderdelen
    {
      slug: 'filterhouder-universeel',
      category: 'onderdelen',
      name: 'Filterhouder Universeel 58mm',
      description: 'Past op de meeste pistonmachines met 58mm groepshoofden.',
      price: 24.95,
      image: '/images/onderdeel-filterhouder.jpg',
      variants: JSON.stringify([
        { type: 'Enkel (1 cup)', price: 24.95 },
        { type: 'Dubbel (2 cup)', price: 26.95 }
      ]),
      specs: JSON.stringify({ diameter: '58mm', material: 'RVS' }),
      featured: false
    },
    {
      slug: 'waterfilter-brita',
      category: 'onderdelen',
      name: 'Waterfilter Brita Intenza+',
      description: 'Compatibel met Siemens, Bosch en Gaggenau volautomaten.',
      price: 14.95,
      image: '/images/onderdeel-waterfilter.jpg',
      variants: JSON.stringify([
        { pack: '1 stuks', price: 14.95 },
        { pack: '3 stuks', price: 39.95 }
      ]),
      specs: JSON.stringify({ compatible: 'Siemens EQ, Bosch VeroSeries' }),
      featured: false
    },
    {
      slug: 'ontkalker-250ml',
      category: 'onderdelen',
      name: 'Ontkalker 250ml',
      description: 'Universele ontkalker — geschikt voor alle koffiemachines.',
      price: 9.95,
      image: '/images/onderdeel-ontkalker.jpg',
      variants: null,
      specs: JSON.stringify({ volume: '250ml', doses: '2 ontkalkbeurten' }),
      featured: false
    }
  ];

  for (const p of products) {
    await client.query(`
      INSERT INTO products (slug, category, name, description, price, image, variants, specs, featured)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (slug) DO NOTHING
    `, [p.slug, p.category, p.name, p.description, p.price, p.image,
        p.variants || null, p.specs ? p.specs : null, p.featured || false]);
  }
  console.log('✅ Standaard producten geseed');
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Statische bestanden vanuit root (index.html, admin.html, css/, js/, images/)
app.use(express.static(__dirname));

// ─── API: Producten ──────────────────────────────────────────────────────────

// GET alle producten (optioneel filter op category)
app.get('/api/products', async (req, res) => {
  try {
    const { category, featured } = req.query;
    let query = 'SELECT * FROM products WHERE in_stock = true';
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (featured === 'true') {
      query += ' AND featured = true';
    }

    query += ' ORDER BY category, id';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/products:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// GET één product op slug
app.get('/api/products/:slug', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE slug = $1',
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/products/:slug:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// POST nieuw product aanmaken (admin)
app.post('/api/products', async (req, res) => {
  try {
    const { slug, category, name, description, price, image, variants, specs, in_stock, featured } = req.body;

    if (!slug || !category || !name) {
      return res.status(400).json({ error: 'slug, category en name zijn verplicht' });
    }

    const { rows } = await pool.query(`
      INSERT INTO products (slug, category, name, description, price, image, variants, specs, in_stock, featured)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [slug, category, name, description, price, image,
        variants ? JSON.stringify(variants) : null,
        specs ? JSON.stringify(specs) : null,
        in_stock !== false, featured || false]);

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug bestaat al' });
    console.error('POST /api/products:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// PUT product updaten (admin)
app.put('/api/products/:slug', async (req, res) => {
  try {
    const { category, name, description, price, image, variants, specs, in_stock, featured } = req.body;

    const { rows } = await pool.query(`
      UPDATE products SET
        category    = COALESCE($1, category),
        name        = COALESCE($2, name),
        description = COALESCE($3, description),
        price       = COALESCE($4, price),
        image       = COALESCE($5, image),
        variants    = COALESCE($6, variants),
        specs       = COALESCE($7, specs),
        in_stock    = COALESCE($8, in_stock),
        featured    = COALESCE($9, featured)
      WHERE slug = $10
      RETURNING *
    `, [category, name, description, price, image,
        variants ? JSON.stringify(variants) : null,
        specs ? JSON.stringify(specs) : null,
        in_stock, featured, req.params.slug]);

    if (rows.length === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /api/products/:slug:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// DELETE product (admin)
app.delete('/api/products/:slug', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM products WHERE slug = $1',
      [req.params.slug]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Product niet gevonden' });
    res.json({ success: true, message: 'Product verwijderd' });
  } catch (err) {
    console.error('DELETE /api/products/:slug:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// ─── API: Bestellingen ───────────────────────────────────────────────────────

// POST nieuwe bestelling aanmaken
app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, shipping, payment, subtotal, shipping_cost, total, notes } = req.body;

    if (!customer || !items || items.length === 0) {
      return res.status(400).json({ error: 'customer en items zijn verplicht' });
    }

    // Uniek bestelnummer genereren
    const orderNumber = 'KP-' + Date.now().toString(36).toUpperCase();

    const { rows } = await pool.query(`
      INSERT INTO orders (order_number, customer, items, shipping, payment, subtotal, shipping_cost, total, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [orderNumber,
        JSON.stringify(customer),
        JSON.stringify(items),
        JSON.stringify(shipping || {}),
        JSON.stringify(payment || {}),
        subtotal, shipping_cost, total, notes]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/orders:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// GET alle bestellingen (admin)
app.get('/api/orders', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM orders';
    const params = [];

    if (status) {
      params.push(status);
      query += ` WHERE status = $1`;
    }

    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/orders:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// GET één bestelling op order_number
app.get('/api/orders/:orderNumber', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE order_number = $1',
      [req.params.orderNumber]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/orders/:orderNumber:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// PATCH bestelling status updaten (admin / Mollie webhook)
app.patch('/api/orders/:orderNumber/status', async (req, res) => {
  try {
    const { status, payment } = req.body;
    const { rows } = await pool.query(`
      UPDATE orders SET
        status  = COALESCE($1, status),
        payment = COALESCE($2, payment)
      WHERE order_number = $3
      RETURNING *
    `, [status, payment ? JSON.stringify(payment) : null, req.params.orderNumber]);

    if (rows.length === 0) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/orders/:orderNumber/status:', err);
    res.status(500).json({ error: 'Database fout' });
  }
});

// ─── Mollie webhook ──────────────────────────────────────────────────────────
app.post('/api/webhook/mollie', async (req, res) => {
  // Mollie stuurt payment ID — hier kun je de betaalstatus ophalen en order updaten
  const { id: molliePaymentId } = req.body;
  console.log('Mollie webhook ontvangen:', molliePaymentId);
  // TODO: Mollie SDK aanroepen om status op te halen en order bij te werken
  res.sendStatus(200);
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

// ─── Catch-all: stuur altijd index.html terug voor client-side routing ────────
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
