const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'WiGo-Enterprise-Production-Key-2026';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'wigo.db');

const DENOMINATIONS = [200, 300, 500, 1000, 2000, 5000];
const NETWORKS = ['al-alam_net', 'Tawfeer-Net', '5G-NET', 'YemenLink', 'MikroTik-Home'];

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
  console.log('SQLite connected to', DB_PATH);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function deriveKey() {
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encryptText(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptText(payload) {
  if (!payload) return '';
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, 16);
  const tag = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function generateCode(prefix = 'WIGO') {
  const stamp = Date.now().toString().slice(-8);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function generateCardCode(denomination = 500, networkName = 'al-alam_net') {
  const networkToken = (networkName || 'al-alam_net').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase();
  return `${denomination}-${networkToken}-${Math.random().toString().slice(2, 10)}`;
}

function normalizeNetworkName(name) {
  const raw = (name || 'al-alam_net').trim();
  const fallback = NETWORKS.includes(raw) ? raw : NETWORKS[0];
  return fallback;
}

function parseCardText(rawText, fileName = 'upload.txt') {
  const text = String(rawText || '');
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const parsed = [];
  const defaultNetwork = NETWORKS[Math.floor(Math.random() * NETWORKS.length)];

  const normalizeValue = (value) => {
    const match = String(value).match(/\d+/g);
    return match ? Number(match[0]) : null;
  };

  for (const line of lines) {
    const compact = line.replace(/\|/g, ' ').replace(/\s+/g, ' ');
    const match = compact.match(/(\d{3,5})\s*[,;:\-\s]*([A-Za-z0-9\-_]+)?\s*[,;:\-\s]*(\d{5,20})/i);

    if (match) {
      const denomination = normalizeValue(match[1]);
      const networkName = normalizeNetworkName(match[2] || defaultNetwork);
      const code = match[3] || generateCardCode(denomination, networkName);

      if (DENOMINATIONS.includes(denomination)) {
        parsed.push({
          denomination,
          networkName,
          cardCode: `${denomination}-${networkName}-${code}`,
          source: fileName
        });
      }
    } else {
      const numberMatch = compact.match(/\b(\d{3,5})\b/);
      const denomination = numberMatch ? normalizeValue(numberMatch[1]) : null;
      if (DENOMINATIONS.includes(denomination)) {
        parsed.push({
          denomination,
          networkName: defaultNetwork,
          cardCode: `${denomination}-${defaultNetwork}-${generateCardCode(denomination, defaultNetwork)}`,
          source: fileName
        });
      }
    }
  }

  if (!parsed.length) {
    for (const denomination of DENOMINATIONS) {
      parsed.push({
        denomination,
        networkName: defaultNetwork,
        cardCode: `${denomination}-${defaultNetwork}-${generateCardCode(denomination, defaultNetwork)}`,
        source: fileName
      });
    }
  }

  return parsed.slice(0, 50);
}

function extractTextFromPdf(rawBuffer) {
  const data = rawBuffer.toString('latin1');
  const cleaned = data
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\d{5,}/g, ' $& ');
  return cleaned;
}

async function ensureDemoData() {
  const ownerExists = await get('SELECT id FROM owners LIMIT 1');
  if (ownerExists) {
    return;
  }

  const ownerId = 'owner-001';
  const retailerId = 'retailer-001';
  const warehouseId = 'warehouse-001';
  const clientId = 'client-001';
  const ownerPasswordHash = await bcrypt.hash('admin123', 10);

  await run(
    `INSERT INTO owners (id, name, email, password_hash, credit_limit, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [ownerId, 'WiGo Holdings', 'admin@wigo-enterprise.com', ownerPasswordHash, 50000, 'active']
  );

  await run(
    `INSERT INTO retailers (id, owner_id, name, code, phone, credit_limit, balance, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [retailerId, ownerId, 'Yemen Net Partner', '790901', '+9677000001', 50000, 0, 'active']
  );

  await run(
    `INSERT INTO clients (id, retailer_id, name, phone, network_preference, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [clientId, retailerId, 'Ahmed Ali', '+96777123456', '5G-NET']
  );

  await run(
    `INSERT INTO warehouses (id, owner_id, name, location, network_name, capacity, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [warehouseId, ownerId, 'Central District Warehouse', 'Sana’a', 'al-alam_net', 5000, 'active']
  );

  const seededEntries = [
    { denomination: 200, networkName: 'al-alam_net' },
    { denomination: 300, networkName: 'al-alam_net' },
    { denomination: 500, networkName: 'Tawfeer-Net' },
    { denomination: 1000, networkName: '5G-NET' },
    { denomination: 2000, networkName: '5G-NET' },
    { denomination: 5000, networkName: 'MikroTik-Home' }
  ];

  for (const item of seededEntries) {
    const cardCode = generateCardCode(item.denomination, item.networkName);
    await run(
      `INSERT INTO inventory
       (id, owner_id, warehouse_id, retailer_id, denomination, network_name, card_code, encrypted_payload, source_file, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [uuidv4(), ownerId, warehouseId, null, item.denomination, item.networkName, cardCode, encryptText(cardCode), 'seed-demo.txt', 'available']
    );
  }

  await run(
    `INSERT INTO ledger_entries (id, owner_id, retailer_id, client_id, type, amount, currency, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [uuidv4(), ownerId, retailerId, null, 'owner_dispatch', 23000, 'YER', 'Initial inventory dispatch to retailer',]
  );

  await run(
    `INSERT INTO transaction_logs (id, type, actor_type, actor_id, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [uuidv4(), 'seed_demo', 'system', ownerId, JSON.stringify({ message: 'Demo data initialized' }), 'success']
  );
}

async function initializeDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    credit_limit REAL DEFAULT 50000,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS retailers (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    phone TEXT,
    credit_limit REAL DEFAULT 50000,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES owners (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    retailer_id TEXT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    network_preference TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (retailer_id) REFERENCES retailers (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    location TEXT,
    network_name TEXT,
    capacity INTEGER DEFAULT 1000,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES owners (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    warehouse_id TEXT,
    retailer_id TEXT,
    denomination INTEGER NOT NULL,
    network_name TEXT NOT NULL,
    card_code TEXT,
    encrypted_payload TEXT NOT NULL,
    source_file TEXT,
    status TEXT DEFAULT 'available',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES owners (id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
    FOREIGN KEY (retailer_id) REFERENCES retailers (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    retailer_id TEXT,
    client_id TEXT,
    type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'YER',
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES owners (id),
    FOREIGN KEY (retailer_id) REFERENCES retailers (id),
    FOREIGN KEY (client_id) REFERENCES clients (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS payment_receipts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    retailer_id TEXT NOT NULL,
    amount REAL NOT NULL,
    receipt_number TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES owners (id),
    FOREIGN KEY (retailer_id) REFERENCES retailers (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS card_requests (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    retailer_id TEXT NOT NULL,
    network_name TEXT,
    denomination INTEGER,
    requested_amount REAL,
    status TEXT DEFAULT 'pending',
    source_code TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients (id),
    FOREIGN KEY (retailer_id) REFERENCES retailers (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS wallet_cards (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    retailer_id TEXT,
    network_name TEXT,
    card_code TEXT,
    encrypted_payload TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients (id),
    FOREIGN KEY (retailer_id) REFERENCES retailers (id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS transaction_logs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    actor_type TEXT,
    actor_id TEXT,
    details TEXT,
    status TEXT DEFAULT 'success',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await ensureDemoData();
}

async function getOwnerSummary(ownerId) {
  const owner = await get('SELECT * FROM owners WHERE id = ?', [ownerId]);
  const warehouses = await all('SELECT * FROM warehouses WHERE owner_id = ?', [ownerId]);
  const inventory = await all('SELECT * FROM inventory WHERE owner_id = ?', [ownerId]);
  const entries = await all('SELECT * FROM ledger_entries WHERE owner_id = ?', [ownerId]);

  let totalDebt = 0;
  let payments = 0;

  for (const entry of entries) {
    if (entry.type === 'owner_dispatch') totalDebt += Number(entry.amount || 0);
    if (entry.type === 'payment_receipt') payments += Number(entry.amount || 0);
  }

  return {
    owner,
    warehouses,
    inventory,
    totalDebt,
    payments,
    netBalance: totalDebt - payments,
    totalInventory: inventory.length,
    activeWarehouses: warehouses.filter((w) => w.status === 'active').length
  };
}

async function getRetailerSummary(retailerId) {
  const retailer = await get('SELECT * FROM retailers WHERE id = ?', [retailerId]);
  const inventory = await all('SELECT * FROM inventory WHERE retailer_id = ?', [retailerId]);
  const ledger = await all('SELECT * FROM ledger_entries WHERE retailer_id = ?', [retailerId]);
  const requests = await all('SELECT * FROM card_requests WHERE retailer_id = ?', [retailerId]);

  let totalDebt = 0;
  let payments = 0;
  let sales = 0;

  for (const entry of ledger) {
    if (entry.type === 'owner_dispatch') totalDebt += Number(entry.amount || 0);
    if (entry.type === 'payment_receipt') payments += Number(entry.amount || 0);
    if (entry.type === 'client_sale') sales += Number(entry.amount || 0);
  }

  return {
    retailer,
    inventory,
    requests,
    totalDebt,
    payments,
    sales,
    netBalance: totalDebt - payments,
    availableCards: inventory.filter((item) => item.status === 'available').length
  };
}

async function getClientSummary(clientId) {
  const client = await get('SELECT * FROM clients WHERE id = ?', [clientId]);
  const wallet = await all('SELECT * FROM wallet_cards WHERE client_id = ?', [clientId]);
  const requests = await all('SELECT * FROM card_requests WHERE client_id = ?', [clientId]);

  return {
    client,
    wallet,
    requests,
    networkPreference: client?.network_preference || '5G-NET'
  };
}

async function getRetailerBalance(retailerId) {
  const rows = await all('SELECT type, amount FROM ledger_entries WHERE retailer_id = ?', [retailerId]);
  let debit = 0;
  let credit = 0;

  for (const row of rows) {
    if (['owner_dispatch', 'client_sale'].includes(row.type)) debit += Number(row.amount || 0);
    if (['payment_receipt', 'owner_credit'].includes(row.type)) credit += Number(row.amount || 0);
  }

  return debit - credit;
}

async function ensureRetailerCreditLimit(retailerId, amount) {
  const retailer = await get('SELECT * FROM retailers WHERE id = ?', [retailerId]);
  if (!retailer) {
    throw new Error('Retailer not found');
  }

  const netDebt = Math.max(0, await getRetailerBalance(retailerId));
  const nextDebt = netDebt + Number(amount || 0);
  const limit = Number(retailer.credit_limit || 50000);

  if (nextDebt > limit) {
    throw new Error(`Credit limit exceeded. Net debt ${nextDebt} YER exceeds limit ${limit} YER.`);
  }

  return { retailer, netDebt, limit, nextDebt };
}

async function createLedgerEntry(payload) {
  const id = uuidv4();
  await run(
    `INSERT INTO ledger_entries (id, owner_id, retailer_id, client_id, type, amount, currency, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      id,
      payload.owner_id || null,
      payload.retailer_id || null,
      payload.client_id || null,
      payload.type,
      Number(payload.amount || 0),
      payload.currency || 'YER',
      payload.description || ''
    ]
  );
  return id;
}

async function createTransaction(type, actorType, actorId, payload, status = 'success') {
  await run(
    `INSERT INTO transaction_logs (id, type, actor_type, actor_id, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [uuidv4(), type, actorType, actorId, JSON.stringify(payload || {}), status]
  );
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    service: 'WiGo Enterprise',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/cards/parse', async (req, res) => {
  try {
    const { content, fileName, fileType } = req.body || {};
    if (!content) {
      return res.status(400).json({ message: 'No card content supplied' });
    }

    const allRecords = parseCardText(content, fileName || 'upload.txt');
    res.json({
      success: true,
      fileType: fileType || 'txt',
      records: allRecords,
      summary: {
        total: allRecords.length,
        byDenomination: Object.fromEntries(
          DENOMINATIONS.map((denomination) => [denomination, allRecords.filter((item) => item.denomination === denomination).length])
        )
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to parse cards' });
  }
});

app.post('/api/cards/upload', async (req, res) => {
  try {
    const { content, fileName, warehouseId, retailerId, ownerId } = req.body || {};
    if (!content) {
      return res.status(400).json({ message: 'No card content supplied' });
    }

    const parsed = parseCardText(content, fileName || 'upload.txt');
    const targetWarehouse = warehouseId || 'warehouse-001';
    const activeOwnerId = ownerId || 'owner-001';

    const inserted = [];

    for (const record of parsed) {
      const encrypted = encryptText(record.cardCode);
      const refId = uuidv4();
      await run(
        `INSERT INTO inventory (id, owner_id, warehouse_id, retailer_id, denomination, network_name, card_code, encrypted_payload, source_file, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [refId, activeOwnerId, targetWarehouse, retailerId || null, record.denomination, record.networkName, record.cardCode, encrypted, fileName || 'upload.txt', 'available']
      );
      inserted.push({ ...record, id: refId, encrypted_payload: encrypted });
    }

    await createTransaction('card_upload', 'owner', activeOwnerId, { records: inserted.length, fileName }, 'success');

    res.json({
      success: true,
      uploaded: inserted.length,
      warehouseId: targetWarehouse,
      records: inserted
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to upload cards' });
  }
});

app.post('/api/batches/dispatch', async (req, res) => {
  try {
    const { ownerId, retailerId, warehouseId, batchName, items = [] } = req.body || {};
    if (!retailerId || !ownerId || !items.length) {
      return res.status(400).json({ message: 'Owner, retailer, and dispatch items are required' });
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.denomination || 0) * Number(item.quantity || 1), 0);
    await ensureRetailerCreditLimit(retailerId, totalAmount);

    for (const item of items) {
      const itemCode = generateCardCode(item.denomination, item.networkName || 'al-alam_net');
      const encrypted = encryptText(itemCode);
      await run(
        `INSERT INTO inventory (id, owner_id, warehouse_id, retailer_id, denomination, network_name, card_code, encrypted_payload, source_file, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [uuidv4(), ownerId, warehouseId, retailerId, Number(item.denomination || 500), item.networkName || 'al-alam_net', itemCode, encrypted, batchName || 'dispatch', 'available']
      );
    }

    await createLedgerEntry({
      owner_id: ownerId,
      retailer_id: retailerId,
      type: 'owner_dispatch',
      amount: totalAmount,
      currency: 'YER',
      description: `Owner batch dispatch: ${batchName || 'bulk dispatch'}`
    });

    await createTransaction('batch_dispatch', 'owner', ownerId, { retailerId, totalAmount, batchName }, 'success');

    res.json({
      success: true,
      totalAmount,
      retailerId,
      status: 'approved',
      message: 'Batch dispatch approved and recorded.'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Batch dispatch rejected',
      code: 'CREDIT_LIMIT_BLOCKED'
    });
  }
});

app.post('/api/payments/receipt', async (req, res) => {
  try {
    const { ownerId, retailerId, amount, receiptNumber, note } = req.body || {};
    if (!ownerId || !retailerId || !amount) {
      return res.status(400).json({ message: 'Owner, retailer, and payment amount are required' });
    }

    const receiptId = uuidv4();

    await run(
      `INSERT INTO payment_receipts (id, owner_id, retailer_id, amount, receipt_number, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [receiptId, ownerId, retailerId, Number(amount), receiptNumber || `RCPT-${Date.now()}`, note || 'Cash receipt for retailer debt reduction']
    );

    await createLedgerEntry({
      owner_id: ownerId,
      retailer_id: retailerId,
      type: 'payment_receipt',
      amount: Number(amount),
      currency: 'YER',
      description: `Cash receipt ${receiptNumber || receiptId}`
    });

    await createTransaction('receipt', 'retailer', retailerId, { amount, receiptNumber }, 'success');

    res.json({
      success: true,
      amount: Number(amount),
      receiptNumber: receiptNumber || receiptId,
      message: 'Cash payment receipt registered successfully.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Receipt registration failed' });
  }
});

app.post('/api/clients/register', async (req, res) => {
  try {
    const { name, phone, retailerId, networkPreference } = req.body || {};
    if (!name || !phone) {
      return res.status(400).json({ message: 'Client name and phone number are required' });
    }

    const existing = await get('SELECT * FROM clients WHERE phone = ?', [phone]);
    if (existing) {
      return res.json({ success: true, client: existing, existing: true });
    }

    const id = uuidv4();
    await run(
      `INSERT INTO clients (id, retailer_id, name, phone, network_preference, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, retailerId || 'retailer-001', name, phone, networkPreference || '5G-NET', 'active']
    );

    const client = await get('SELECT * FROM clients WHERE id = ?', [id]);
    await createTransaction('client_register', 'client', id, { name, phone, retailerId }, 'success');
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Client registration failed' });
  }
});

app.get('/api/clients/:clientId/wallet', async (req, res) => {
  try {
    const { clientId } = req.params;
    const wallet = await all('SELECT * FROM wallet_cards WHERE client_id = ?', [clientId]);
    const decrypted = wallet.map((card) => ({
      ...card,
      decryptedCard: decryptText(card.encrypted_payload || ''),
      cardCode: card.card_code || decryptText(card.encrypted_payload || '')
    }));
    res.json({ success: true, wallet: decrypted });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Wallet retrieval failed' });
  }
});

app.post('/api/requests', async (req, res) => {
  try {
    const { clientId, retailerId, networkName, denomination, amount } = req.body || {};
    if (!clientId || !retailerId) {
      return res.status(400).json({ message: 'Client and retailer are required' });
    }

    const requestId = uuidv4();
    await run(
      `INSERT INTO card_requests (id, client_id, retailer_id, network_name, denomination, requested_amount, status, source_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [requestId, clientId, retailerId, networkName || '5G-NET', Number(denomination || 500), Number(amount || 500), 'pending', 'req-' + requestId.slice(0, 8)]
    );

    const request = await get('SELECT * FROM card_requests WHERE id = ?', [requestId]);
    await createTransaction('card_request', 'client', clientId, { requestId, retailerId, networkName }, 'pending');

    res.json({ success: true, request });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Request creation failed' });
  }
});

app.post('/api/requests/:requestId/approve', async (req, res) => {
  try {
    const { requestId } = req.params;
    const request = await get('SELECT * FROM card_requests WHERE id = ?', [requestId]);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const inventoryRow = await get(
      `SELECT * FROM inventory WHERE retailer_id = ? AND network_name = ? AND status = 'available' ORDER BY created_at DESC LIMIT 1`,
      [request.retailer_id, request.network_name || '5G-NET']
    );

    const cardCode = inventoryRow ? decryptText(inventoryRow.encrypted_payload) : generateCardCode(request.denomination || 500, request.network_name || '5G-NET');
    const encrypted = encryptText(cardCode);
    const walletId = uuidv4();

    await run(
      `INSERT INTO wallet_cards (id, client_id, retailer_id, network_name, card_code, encrypted_payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [walletId, request.client_id, request.retailer_id, request.network_name || '5G-NET', cardCode, encrypted, 'active']
    );

    if (inventoryRow) {
      await run('UPDATE inventory SET status = ? WHERE id = ?', ['dispatched', inventoryRow.id]);
    }

    await run('UPDATE card_requests SET status = ? WHERE id = ?', ['approved', requestId]);

    await createLedgerEntry({
      owner_id: 'owner-001',
      retailer_id: request.retailer_id,
      client_id: request.client_id,
      type: 'client_sale',
      amount: Number(request.requested_amount || 500),
      currency: 'YER',
      description: `Client card sale to ${request.client_id}`
    });

    await createTransaction('request_approve', 'retailer', request.retailer_id, { requestId, cardCode }, 'success');

    res.json({
      success: true,
      requestId,
      card: {
        code: cardCode,
        network: request.network_name || '5G-NET',
        amount: Number(request.requested_amount || 500)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Approval failed' });
  }
});

app.get('/api/owner/:ownerId/summary', async (req, res) => {
  const summary = await getOwnerSummary(req.params.ownerId);
  res.json({ success: true, summary });
});

app.get('/api/retailer/:retailerId/summary', async (req, res) => {
  const summary = await getRetailerSummary(req.params.retailerId);
  res.json({ success: true, summary });
});

app.get('/api/client/:clientId/summary', async (req, res) => {
  const summary = await getClientSummary(req.params.clientId);
  res.json({ success: true, summary });
});

app.get('/api/networks', async (req, res) => {
  res.json({
    success: true,
    networks: NETWORKS.map((network, index) => ({
      id: index + 1,
      name: network,
      strength: `${70 + index * 8}%`,
      status: index % 2 === 0 ? 'online' : 'active',
      signal: index + 3
    }))
  });
});

app.get('/api/retailers', async (req, res) => {
  const rows = await all('SELECT * FROM retailers ORDER BY created_at DESC');
  res.json({ success: true, retailers: rows });
});

app.post('/api/wallet/sync', async (req, res) => {
  try {
    const { clientId, networkName } = req.body || {};
    const client = await get('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const cards = await all('SELECT * FROM wallet_cards WHERE client_id = ?', [clientId]);
    const walletData = cards.map((card) => ({
      ...card,
      code: card.card_code || decryptText(card.encrypted_payload || ''),
      networkName: card.network_name || networkName || client.network_preference || '5G-NET'
    }));

    res.json({ success: true, client, wallet: walletData });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Wallet sync failed' });
  }
});

app.get('/api/ledger', async (req, res) => {
  const rows = await all('SELECT * FROM ledger_entries ORDER BY created_at DESC');
  res.json({ success: true, entries: rows });
});

app.get('/api/warehouses', async (req, res) => {
  const rows = await all('SELECT * FROM warehouses ORDER BY created_at DESC');
  res.json({ success: true, warehouses: rows });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`WiGo Enterprise server running on http://localhost:${PORT}`);
      console.log('Default owner credentials: admin@wigo-enterprise.com / admin123');
    });
  } catch (error) {
    console.error('Failed to initialize WiGo Enterprise.', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, db, encryptText, decryptText, parseCardText, initializeDatabase };
