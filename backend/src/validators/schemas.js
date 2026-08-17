const { z } = require('zod');

/**
 * Validation schemas using Zod
 * All schemas are strict by default - they reject unknown fields
 */

// MongoDB ObjectId validation (24 hex characters)
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

/**
 * Authentication schemas
 */

// Register: name, email, password
const registerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long').trim(),
    email: z.string().email('Invalid email format').toLowerCase().trim(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password too long'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

// Login: email, password
const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format').toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * Transaction schemas
 */

// Create transfer: fromAccount, toAccount, amount, idempotencyKey
const createTransactionSchema = z.object({
  body: z.object({
    fromAccount: objectIdSchema,
    toAccount: objectIdSchema,
    amount: z.number().finite('Amount must be a finite number').positive('Amount must be greater than zero'),
    idempotencyKey: z.string().min(1, 'Idempotency key is required').max(128, 'Idempotency key too long'),
  }).refine(data => data.fromAccount !== data.toAccount, {
    message: 'Cannot transfer to the same account',
    path: ['toAccount'],
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

// System initial funds: toAccount, amount, idempotencyKey
const initialFundsSchema = z.object({
  body: z.object({
    toAccount: objectIdSchema,
    amount: z.number().finite('Amount must be a finite number').positive('Amount must be greater than zero'),
    idempotencyKey: z.string().min(1, 'Idempotency key is required').max(128, 'Idempotency key too long'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * Account schemas
 */

// Create account: no body required (uses authenticated user)
const createAccountSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

// Get balance: accountId param
const getBalanceSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({
    accountId: objectIdSchema,
  }),
});

/**
 * User schemas
 */

// Request funds: no body required (uses authenticated user, fixed amount)
const requestFundsSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * Admin schemas
 */

// Approve funds: userId, amount, requestId
const approveFundsSchema = z.object({
  body: z.object({
    userId: objectIdSchema,
    amount: z.number().finite('Amount must be a finite number').positive('Amount must be greater than zero'),
    requestId: objectIdSchema,
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

// Seed funds: userId, amount, idempotencyKey
const seedFundsSchema = z.object({
  body: z.object({
    userId: objectIdSchema,
    amount: z.number().finite('Amount must be a finite number').positive('Amount must be greater than zero'),
    idempotencyKey: z.string().min(1, 'Idempotency key is required').max(128, 'Idempotency key too long'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * Transaction history: accountId param
 */
const transactionHistorySchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({
    accountId: objectIdSchema,
  }),
});

module.exports = {
  // Auth
  registerSchema,
  loginSchema,
  // Transactions
  createTransactionSchema,
  initialFundsSchema,
  transactionHistorySchema,
  // Accounts
  createAccountSchema,
  getBalanceSchema,
  // User
  requestFundsSchema,
  // Admin
  approveFundsSchema,
  seedFundsSchema,
};