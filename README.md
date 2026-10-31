# WiGo Enterprise

WiGo Enterprise is a production-ready commercial platform for distributor and agent management of MikroTik internet cards, with encrypted inventory, accounting controls, and client wallet delivery.

## Tech Stack

- Node.js + Express
- SQLite database with auto-initialization and schema creation
- AES-256-GCM encrypted card storage
- Credit limit enforcement and ledger accounting
- Single-page web dashboard for Owner, Retailer, and Client experiences

## Quick Start

1. Clone or open the repository.
2. Install dependencies:
   npm install
3. Start the server:
   node server.js
4. Open the web app at:
   http://localhost:3000

## Database Initialization

The server automatically initializes the SQLite database on startup. No separate migration step is required; the application creates the schema and seeds demo data when the database is empty.

## Default Demo Credentials

- Owner email: admin@wigo-enterprise.com
- Password: admin123

## Demo Workflow

- Upload or parse card files from the Owner dashboard.
- Dispatch batches to retailers with automated credit-limit blocking.
- Accept client card requests from the Retailer dashboard.
- Issue cards to clients using the Client portal wallet.

## Production Notes

- Set a strong ENCRYPTION_KEY environment variable before production deployment.
- Replace demo data with live business identities, real retailers, and secure access control.
- Add inventory audit events, job workers, and authentication hardening as needed for regional deployment.
