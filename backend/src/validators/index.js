/**
 * Validators barrel export
 */

const { validationMiddleware } = require('./validate');
const {
  registerSchema,
  loginSchema,
  createTransactionSchema,
  initialFundsSchema,
  transactionHistorySchema,
  createAccountSchema,
  getBalanceSchema,
  requestFundsSchema,
  approveFundsSchema,
  seedFundsSchema,
} = require('./schemas');

module.exports = {
  validationMiddleware,
  // Auth validators
  validateRegister: validationMiddleware(registerSchema),
  validateLogin: validationMiddleware(loginSchema),
  // Transaction validators
  validateCreateTransaction: validationMiddleware(createTransactionSchema),
  validateInitialFunds: validationMiddleware(initialFundsSchema),
  validateTransactionHistory: validationMiddleware(transactionHistorySchema),
  // Account validators
  validateCreateAccount: validationMiddleware(createAccountSchema),
  validateGetBalance: validationMiddleware(getBalanceSchema),
  // User validators
  validateRequestFunds: validationMiddleware(requestFundsSchema),
  // Admin validators
  validateApproveFunds: validationMiddleware(approveFundsSchema),
  validateSeedFunds: validationMiddleware(seedFundsSchema),
};