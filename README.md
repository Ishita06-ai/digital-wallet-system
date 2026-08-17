# Digital Wallet System — Backend Ledger API

A backend REST API implementing a digital wallet system with a double-entry accounting ledger, atomic multi-document MongoDB transactions, and idempotent transfer handling. Built with Express.js and Mongoose.

## Key Features

- **Double-entry ledger** — every transfer creates a matched debit and credit entry; account balances are derived, never stored directly
- **Atomic transfers** — MongoDB multi-document transactions ensure all-or-nothing semantics across the transaction record and both ledger entries
- **Idempotency** — a unique idempotency key per transfer prevents duplicate processing, even under concurrent requests
- **Concurrency handling** — duplicate key detection, `TransientTransactionError` retry, and exponential backoff for race conditions
- **JWT authentication** — stateless token-based auth with cookie and header support, and a token blacklist with TTL expiry
- **Role-based access control** — distinct middleware for authenticated users and system/admin users
- **Authorization enforcement** — ownership checks prevent users from transferring from or viewing another user's accounts (IDOR prevention)
- **Automated tests** — 32 tests (29 core + 3 sanity) covering transfer logic, atomicity, idempotency, concurrency, authorization, and admin access

## Architecture Overview

```
Client
  │
  ▼
Express.js  ──►  Route handlers
  │
  ├── Middleware (auth, RBAC)
  │
  ├── Controllers (business logic)
  │     ├── Transaction controller  (atomic transfers, idempotency, concurrency)
  │     ├── Auth controller         (register, login, logout)
  │     ├── Account controller      (create, list, balance)
  │     └── Admin controller        (fund requests, seeding)
  │
  ├── Mongoose models + schema validation
  │
  └── MongoDB (replica set for transactions)
```

**Request flow for a transfer:**

1. Middleware validates JWT, checks blacklist, attaches `req.user`
2. Controller validates input fields, account existence, account status
3. Controller verifies the authenticated user owns the `fromAccount`
4. A MongoDB session starts; the controller checks the idempotency key inside the transaction
5. Sender balance is re-derived from the ledger within the same session
6. Three writes occur atomically: Transaction document (pending), DEBIT ledger entry, CREDIT ledger entry
7. Transaction status is updated to `completed`; the session commits
8. On duplicate key or write conflict, the controller retries with exponential backoff (up to 5 attempts)

## Technology Stack

| Layer            | Technology                         |
|------------------|------------------------------------|
| Runtime          | Node.js                            |
| Framework        | Express 5                          |
| Database         | MongoDB 7 (via Mongoose 9)         |
| Authentication   | JSON Web Tokens (JWT)              |
| Password hashing | bcrypt                             |
| Email (planned)  | SendGrid                           |
| Testing          | Vitest, mongodb-memory-server      |
| Dev tooling      | nodemon, dotenv                    |

## Double-Entry Ledger

Account balances are **not** stored as a single mutable field. Instead, every financial movement is recorded as an immutable ledger entry with a `type` of `"debit"` or `"credit"`. The current balance is derived at read time by aggregating all ledger entries for an account:

```
balance = sum(credit entries) - sum(debit entries)
```

This is implemented in `Account.getBalance()`, which runs a MongoDB aggregation pipeline:

```js
accountSchema.methods.getBalance = async function (session) {
  const result = await ledgerModel.aggregate([
    { $match: { account: this._id } },
    {
      $group: {
        _id: null,
        totalDebit:   { $sum: { $cond: [{ $eq: ["$type", "debit"] }, "$amount", 0] } },
        totalCredit:  { $sum: { $cond: [{ $eq: ["$type", "credit"] }, "$amount", 0] } },
      },
    },
    { $project: { _id: 0, balance: { $subtract: ["$totalCredit", "$totalDebit"] } } },
  ]).session(session);

  return result.length ? result[0].balance : 0;
};
```

The optional `session` parameter allows this aggregation to run inside a MongoDB transaction, ensuring the balance read is consistent with any writes happening in the same transaction.

Each ledger entry references the `Transaction` document it belongs to, making every debit/credit traceable to its originating transfer.

## Atomic MongoDB Transactions

Transfers use MongoDB multi-document transactions (requires a replica set). Every transfer is wrapped in a session that atomically:

1. Creates a `Transaction` document with status `"pending"`
2. Creates a DEBIT ledger entry on the sender's account
3. Creates a CREDIT ledger entry on the receiver's account
4. Updates the `Transaction` status to `"completed"`

If any step fails, the entire transaction is aborted — no partial state (a debit without a matching credit, or a transaction record without ledger entries) is ever committed.

```
session.startTransaction()
  → write Transaction (pending)
  → write Ledger DEBIT
  → write Ledger CREDIT
  → update Transaction (completed)
  → commitTransaction()
```

The test suite verifies this atomicity explicitly: a failed transfer leaves zero ledger entries and zero transaction records.

## Idempotency and Concurrent-Request Handling

Every transfer requires a client-supplied `idempotencyKey` (unique index in MongoDB). This ensures:

- **Duplicate prevention** — if a completed transaction with the same key already exists, the API returns `200` with the existing transaction instead of processing again
- **In-flight detection** — if a pending transaction with the same key exists, the API returns `200` indicating the transfer is still processing
- **Concurrent safety** — when multiple requests with the same key arrive simultaneously, only one succeeds (`201`). The rest receive the existing transaction. This is enforced by:
  - The unique index on `idempotencyKey` (duplicate key error code `11000`)
  - The idempotency check happening inside the MongoDB transaction
  - Retry logic with exponential backoff for `TransientTransactionError` and `WriteConflict` (error code `112`)

The concurrency test fires 5 simultaneous requests with the same idempotency key and asserts that exactly one succeeds while the rest return `200` (already processed).

## Authentication and Authorization

**JWT-based authentication:**
- Tokens are issued on registration and login with a 2-day expiry
- Tokens are passed via `Authorization: Bearer <token>` header or `token` cookie
- On logout, the token is added to a blacklist collection with a 3-day TTL index

**Two middleware levels:**

| Middleware                    | Purpose                                        |
|-------------------------------|------------------------------------------------|
| `authMiddleware`              | Verifies JWT, checks blacklist, attaches user  |
| `authSystemUserMiddleware`    | Same as above, plus requires `systemUser: true`|

**Ownership checks (beyond middleware):**
- **Transfer creation** — the controller verifies `fromAccount.user === req.user._id` before allowing a transfer, returning `403` if the sender account does not belong to the authenticated user
- **Transaction history** — the route handler verifies account ownership before returning transaction data, returning `403` for unauthorized access and `404` for non-existent accounts
- **Account balance** — the account controller queries by both `_id` and `user` to prevent cross-user access

## Database Models

### User
| Field            | Type     | Notes                          |
|------------------|----------|--------------------------------|
| `name`           | String   | required                       |
| `email`          | String   | required, unique               |
| `password`       | String   | required, select: false, bcrypt-hashed |
| `balance`        | Number   | default: 0 (legacy field)      |
| `systemUser`     | Boolean  | default: false, immutable, select: false |
| `isFunded`       | Boolean  | default: false                 |
| `fundRequested`  | Boolean  | default: false                 |
| `fundRequestedAt`| Date     |                                |

### Account
| Field    | Type       | Notes                                   |
|----------|------------|-----------------------------------------|
| `user`   | ObjectId   | ref: User, indexed                      |
| `status` | String     | enum: `active`, `inactive`              |
| `currency`| String    | default: `"INR"`                        |
| `balance`| Number     | default: 0 (legacy; actual balance derived from ledger) |

### Transaction
| Field           | Type     | Notes                              |
|-----------------|----------|------------------------------------|
| `fromAccount`   | ObjectId | ref: Account, indexed              |
| `toAccount`     | ObjectId | ref: Account, indexed              |
| `status`        | String   | enum: `pending`, `completed`, `failed`, `reversed` |
| `amount`        | Number   | required, min: 0                   |
| `idempotencyKey`| String   | required, unique, indexed          |

### Ledger
| Field         | Type     | Notes                          |
|---------------|----------|--------------------------------|
| `account`     | ObjectId | ref: Account, required         |
| `type`        | String   | enum: `debit`, `credit`        |
| `amount`      | Number   | required                       |
| `transaction` | ObjectId | ref: Transaction, indexed      |
| `description` | String   | optional                       |

### FundRequest
| Field        | Type     | Notes                            |
|--------------|----------|----------------------------------|
| `user`       | ObjectId | ref: User, required              |
| `account`    | ObjectId | ref: Account, required           |
| `amount`     | Number   | default: 1000                    |
| `status`     | String   | enum: `pending`, `approved`, `rejected` |
| `requestedAt`| Date     | default: now                     |
| `approvedAt` | Date     |                                  |

### Blacklist
| Field     | Type   | Notes                            |
|-----------|--------|----------------------------------|
| `token`   | String | required, unique                 |

Has a TTL index on `createdAt` with `expireAfterSeconds: 259200` (3 days).

## API Endpoints

### Authentication

| Method | Path              | Auth   | Description                    |
|--------|-------------------|--------|--------------------------------|
| POST   | `/api/auth/register` | Public | Register a new user and account |
| POST   | `/api/auth/login`    | Public | Authenticate and receive JWT   |
| POST   | `/api/auth/logout`   | Any    | Blacklist token, clear cookie  |

### Accounts

| Method | Path                        | Auth   | Description                    |
|--------|-----------------------------|--------|--------------------------------|
| POST   | `/api/accounts/`            | User   | Create a new account           |
| GET    | `/api/accounts/`            | User   | List all accounts for the user |
| GET    | `/api/accounts/:accountId/balance` | User | Get account balance (derived from ledger) |

### Transactions

| Method | Path                              | Auth   | Description                   |
|--------|-----------------------------------|--------|-------------------------------|
| GET    | `/api/transactions/:accountId`    | User   | Transaction history for an account (ownership verified) |
| POST   | `/api/transactions/`              | User   | Create a transfer             |
| POST   | `/api/transactions/system/initial-funds` | Admin | Seed initial funds from system account |

### User

| Method | Path                   | Auth | Description                       |
|--------|------------------------|------|-----------------------------------|
| POST   | `/api/user/request-funds` | User | Request funds from admin          |

### Admin

| Method | Path                        | Auth  | Description                     |
|--------|-----------------------------|-------|---------------------------------|
| GET    | `/api/admin/pending-users`  | Admin | List non-system users           |
| GET    | `/api/admin/pending-requests` | Admin | List pending fund requests   |
| POST   | `/api/admin/approve-funds`  | Admin | Approve a fund request          |
| POST   | `/api/admin/seed-funds`     | Admin | Seed funds directly to a user   |

### Health Check

| Method | Path | Description       |
|--------|------|-------------------|
| GET    | `/`  | Returns `"Ledger Service is up and running"` |

## Project Structure

```
digital-wallet-system/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js                    # MongoDB connection
│   │   ├── controllers/
│   │   │   ├── account.controller.js    # Account CRUD, balance query
│   │   │   ├── admin.controller.js      # Fund request management
│   │   │   ├── auth.controller.js       # Register, login, logout
│   │   │   └── transaction.controller.js # Atomic transfers, idempotency
│   │   ├── middleware/
│   │   │   └── auth.middleware.js       # JWT auth, RBAC
│   │   ├── models/
│   │   │   ├── account.model.js         # Account schema + getBalance()
│   │   │   ├── blacklist.model.js       # Token blacklist with TTL
│   │   │   ├── fundRequest.model.js     # Fund request records
│   │   │   ├── ledger.model.js          # Double-entry ledger
│   │   │   ├── transaction.model.js     # Transaction records
│   │   │   └── user.model.js            # User schema + password hashing
│   │   ├── routes/
│   │   │   ├── account.routes.js
│   │   │   ├── admin.routes.js
│   │   │   ├── auth.routes.js
│   │   │   ├── transaction.routes.js
│   │   │   └── user.routes.js
│   │   ├── services/
│   │   │   └── email.services.js        # SendGrid email service (planned)
│   │   └── app.js                       # Express app configuration
│   ├── test/
│   │   ├── setup.js                     # In-memory MongoDB replica set
│   │   ├── hello.test.js               # Sanity checks
│   │   └── transaction.test.js         # Core transfer and auth tests
│   ├── seedSystemUser.js               # Seed system admin and initial funds
│   ├── server.js                        # Server entry point
│   ├── vitest.config.js                 # Test configuration
│   └── package.json
├── frontend/                            # React scaffolding (not yet implemented)
│   ├── package.json
│   └── ...
├── package.json                         # Root package.json
├── .env                                 # Environment variables (gitignored)
└── .gitignore
```

## Environment Setup

Create a `.env` file in the `backend/` directory:

```env
MONGO_URI=mongodb://localhost:27017/digital-wallet
JWT_SECRET=your-secret-key-here
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=your-email@example.com
```

| Variable          | Required | Description                                |
|-------------------|----------|--------------------------------------------|
| `MONGO_URI`       | Yes      | MongoDB connection string (replica set required for transactions) |
| `JWT_SECRET`      | Yes      | Secret key for signing JWT tokens          |
| `SENDGRID_API_KEY`| No       | SendGrid API key for email notifications   |
| `EMAIL_FROM`      | No       | Sender email address for SendGrid          |

## Local Installation

**Prerequisites:** Node.js 18+, MongoDB 6+ (with replica set enabled), npm

```bash
# Clone the repository
git clone <repository-url>
cd digital-wallet-system

# Install backend dependencies
cd backend
npm install

# Create .env file (see Environment Setup above)
# Copy the template below into backend/.env and edit with your values
```

## Running the Backend

```bash
cd backend

# Development (with auto-reload via nodemon)
npm run dev

# Production
npm start
```

The server starts on port `3000`. Verify with:

```bash
curl http://localhost:3000
# → "Ledger Service is up and running"
```

### Seeding the System User

Before using admin features, seed the system (admin) user:

```bash
cd backend
node seedSystemUser.js
```

This creates a system user with a system account funded with ₹100,000.

## Running Tests

```bash
cd backend
npm test
```

Tests use [Vitest](https://vitest.dev/) with `mongodb-memory-server` to spin up an in-memory MongoDB replica set. No external database is needed. The test timeout is 30 seconds.

To run tests in watch mode:

```bash
npm run test:watch
```

## Test Coverage Summary

The test suite contains **32 tests** (29 in `transaction.test.js` + 3 sanity checks in `hello.test.js`) across 5 `describe` blocks. All tests run against an in-memory MongoDB replica set with full transaction support.

### createTransaction (16 tests)

| Test | Description |
|------|-------------|
| A | Successful transfer with ledger entries and balance verification |
| B | Reject transfer with insufficient balance |
| C | Reject transfer when sender account does not exist |
| D | Reject transfer when receiver account does not exist |
| E | Atomicity: failed transfer leaves no partial state (zero ledger entries, zero transactions) |
| F | Idempotency: repeated request returns existing transaction |
| F2 | Idempotency: unique index prevents duplicate creation |
| G | Concurrency: 5 simultaneous requests with same key → exactly 1 succeeds, 4 return "already processed" |
| — | Reject transfer to same account |
| — | Reject transfer with zero or negative amount |
| — | Reject transfer with missing required fields |
| — | Reject transfer from inactive account |
| — | Reject transfer to inactive account |
| H | Authorization: reject transfer when fromAccount belongs to another user (403) |
| I | Authorization: allow legitimate transfer from own account |
| J | Authorization: idempotency key reuse across users returns existing transaction |

### createInitialFundsTransaction (4 tests)

| Test | Description |
|------|-------------|
| — | Successful seed from system account with balance verification |
| — | Reject seeding with invalid toAccount |
| — | Reject seeding with missing fields |
| — | Idempotency for seeding: duplicate key returns existing transaction |

### Transaction History — GET /:accountId (5 tests)

| Test | Description |
|------|-------------|
| K | User can access own transaction history (sender perspective) |
| L | User can access own transaction history (receiver perspective) |
| M | Reject access to another user's transaction history (403, no data leakage) |
| N | Return 404 for nonexistent account |
| O | No information leakage: 403 does not reveal whether another user's account has transactions |

### Admin Authorization — GET /api/admin/pending-requests (4 tests)

| Test | Description |
|------|-------------|
| P | Placeholder for unauthenticated request (middleware-level) |
| Q | Reject normal authenticated user (403) |
| R | Allow authorized admin/system user |
| S | Reject user without systemUser flag |

### Backend Functionality (3 sanity tests)

| Test | Description |
|------|-------------|
| — | Valid condition returns true |
| — | Basic addition works correctly |
| — | Invalid condition returns false |

**Note:** Tests P–S simulate the `authSystemUserMiddleware` logic inline rather than testing through HTTP. Full middleware integration tests would require a framework like supertest.

## Security Considerations

**Implemented:**

- Passwords are hashed with bcrypt (10 rounds) before storage
- Password field is excluded from queries by default (`select: false`)
- JWT tokens are validated against a blacklist on every request
- Blacklisted tokens are automatically purged after 3 days via TTL index
- Ownership verification on transfers prevents users from spending from another user's account
- IDOR prevention on transaction history: users can only view their own account's transactions
- Admin routes require `systemUser: true` flag
- All writes inside a transfer are atomic — no partial state is committed on failure
- Idempotency keys prevent duplicate processing of the same transfer
- Concurrent requests are handled safely via unique index + retry logic

**Not implemented (known gaps):**

- Rate limiting on authentication endpoints
- Input sanitization / XSS protection middleware
- HTTPS enforcement
- Request logging / audit trail
- Input validation library (e.g., Joi, Zod) — validation is manual
- API versioning
- Refresh token rotation
- CORS is hardcoded to `localhost:5173`
- The `balance` field on both User and Account models is a legacy field that can drift from the ledger-derived balance

## Future Improvements

- **Frontend** — a React-based UI for wallet operations (scaffold exists but is not implemented)
- **Input validation** — adopt a schema validation library for request body validation
- **Rate limiting** — protect auth and transfer endpoints from abuse
- **Audit logging** — record all financial operations for compliance
- **Transfer reversal** — implement the `reversed` status with compensating ledger entries
- **Multi-currency support** — the `currency` field exists on Account but is not enforced in transfers
- **Webhook notifications** — replace or complement email notifications
- **API documentation** — OpenAPI/Swagger spec
- **CI/CD pipeline** — automated test runs on push
- **Middleware integration tests** — use supertest to test routes through HTTP instead of simulating middleware inline
