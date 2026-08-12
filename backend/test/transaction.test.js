const mongoose = require('mongoose');
const { describe, it, expect, beforeEach, afterEach } = require('vitest');

const transactionModel = require('../src/models/transaction.model');
const ledgerModel = require('../src/models/ledger.model');
const accountModel = require('../src/models/account.model');
const userModel = require('../src/models/user.model');
const { createTransaction, createInitialFundsTransaction } = require('../src/controllers/transaction.controller');

describe('Transaction Controller', () => {
    let systemUser, systemAccount, user1, account1, user2, account2;

    beforeEach(async () => {
        // Create system user (admin)
        systemUser = await userModel.create({
            name: 'System Admin',
            email: 'system@test.com',
            password: 'password123',
            systemUser: true
        });
        systemAccount = await accountModel.create({ user: systemUser._id, status: 'active', balance: 0 });
        // Seed system account with funds
        await ledgerModel.create({ account: systemAccount._id, amount: 100000, type: 'credit', description: 'SYSTEM' });

        // Create regular user 1
        user1 = await userModel.create({
            name: 'User One',
            email: 'user1@test.com',
            password: 'password123'
        });
        account1 = await accountModel.create({ user: user1._id, status: 'active', balance: 0 });
        // Fund user1 with 5000
        await ledgerModel.create({ account: account1._id, amount: 5000, type: 'credit', description: 'INITIAL' });

        // Create regular user 2
        user2 = await userModel.create({
            name: 'User Two',
            email: 'user2@test.com',
            password: 'password123'
        });
        account2 = await accountModel.create({ user: user2._id, status: 'active', balance: 0 });
    });

    afterEach(async () => {
        // Clean up - done in setup.js afterEach
    });

    describe('createTransaction', () => {
        it('A. should successfully transfer funds between accounts', async () => {
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account2._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-1'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(201);
            expect(res.body.message).toBe('Transaction completed successfully');
            expect(res.body.transaction.status).toBe('completed');
            expect(res.body.transaction.amount).toBe(1000);
            expect(res.body.transaction.fromAccount.toString()).toBe(account1._id.toString());
            expect(res.body.transaction.toAccount.toString()).toBe(account2._id.toString());

            // Verify ledger entries
            const debitEntries = await ledgerModel.find({ account: account1._id, type: 'debit' });
            const creditEntries = await ledgerModel.find({ account: account2._id, type: 'credit' });
            expect(debitEntries.length).toBe(1);
            expect(creditEntries.length).toBe(1);
            expect(debitEntries[0].amount).toBe(1000);
            expect(creditEntries[0].amount).toBe(1000);
            expect(debitEntries[0].transaction.toString()).toBe(creditEntries[0].transaction.toString());

            // Verify balances
            const balance1 = await account1.getBalance();
            const balance2 = await account2.getBalance();
            expect(balance1).toBe(4000); // 5000 - 1000
            expect(balance2).toBe(1000); // 0 + 1000
        });

        it('B. should reject transfer with insufficient balance', async () => {
            const req = {
                body: {
                    fromAccount: account2._id.toString(), // account2 has 0 balance
                    toAccount: account1._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-2'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('Insufficient balance');

            // Verify no transaction was created
            const transactions = await transactionModel.find({ idempotencyKey: 'test-key-2' });
            expect(transactions.length).toBe(0);
        });

        it('C. should reject transfer when sender account not found', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const req = {
                body: {
                    fromAccount: fakeId.toString(),
                    toAccount: account2._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-3'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid fromAccount or toAccount');
        });

        it('D. should reject transfer when receiver account not found', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: fakeId.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-4'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid fromAccount or toAccount');
        });

        it('E. should not leave partial state when transaction fails', async () => {
            // This test verifies atomicity by checking that a failure
            // doesn't leave partial debit/credit entries

            // First, create a transaction that will fail (e.g., invalid receiver)
            const fakeId = new mongoose.Types.ObjectId();
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: fakeId.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-atomic-1'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            // Should fail
            expect(res.statusCode).toBe(400);

            // Verify NO ledger entries were created
            const debitEntries = await ledgerModel.find({ account: account1._id, type: 'debit' });
            const creditEntries = await ledgerModel.find({ account: fakeId.toString(), type: 'credit' });
            const transactions = await transactionModel.find({ idempotencyKey: 'test-key-atomic-1' });

            expect(debitEntries.length).toBe(0);
            expect(creditEntries.length).toBe(0);
            expect(transactions.length).toBe(0);

            // Verify balance unchanged
            const balance1 = await account1.getBalance();
            expect(balance1).toBe(5000);
        });

        it('F. should handle repeated request with same idempotency key (already completed)', async () => {
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account2._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-idempotent'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            // First request
            await createTransaction(req, res);
            expect(res.statusCode).toBe(201);
            const firstTransactionId = res.body.transaction._id;

            // Second request with same idempotency key
            const res2 = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };
            await createTransaction(req, res2);

            expect(res2.statusCode).toBe(200);
            expect(res2.body.message).toBe('Transaction already processed');
            expect(res2.body.transaction._id.toString()).toBe(firstTransactionId.toString());

            // Verify only ONE transaction exists
            const transactions = await transactionModel.find({ idempotencyKey: 'test-key-idempotent' });
            expect(transactions.length).toBe(1);

            // Verify only ONE debit and ONE credit entry
            const debitEntries = await ledgerModel.find({ account: account1._id, type: 'debit' });
            const creditEntries = await ledgerModel.find({ account: account2._id, type: 'credit' });
            expect(debitEntries.length).toBe(1);
            expect(creditEntries.length).toBe(1);
        });

        it('F2. should handle repeated request with same idempotency key (pending)', async () => {
            // We can't easily test "pending" state since transaction is atomic now
            // But we can verify the unique index prevents duplicate creation
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account2._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-idempotent-2'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);
            expect(res.statusCode).toBe(201);

            // Try to create another with same idempotency key directly in DB
            // The unique index should prevent this
            await expect(
                transactionModel.create({
                    fromAccount: account1._id,
                    toAccount: account2._id,
                    amount: 500,
                    idempotencyKey: 'test-key-idempotent-2',
                    status: 'pending'
                })
            ).rejects.toThrow();
        });

        it('G. should handle concurrent transfer attempts safely', async () => {
            // Simulate concurrent requests with the same idempotency key
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account2._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-concurrent'
                }
            };

            // Fire multiple concurrent requests
            const promises = Array(5).fill(null).map(() => {
                const res = {
                    statusCode: 0,
                    body: {},
                    status(code) { this.statusCode = code; return this; },
                    json(data) { this.body = data; return this; }
                };
                return createTransaction(req, res).then(() => res);
            });

            const results = await Promise.all(promises);

            // Exactly one should succeed (201), others should return 200 (already processed)
            const successCount = results.filter(r => r.statusCode === 201).length;
            const alreadyProcessedCount = results.filter(r => r.statusCode === 200 && r.body.message === 'Transaction already processed').length;

            expect(successCount).toBe(1);
            expect(alreadyProcessedCount).toBe(4);

            // Verify only ONE transaction and ONE debit/credit pair
            const transactions = await transactionModel.find({ idempotencyKey: 'test-key-concurrent' });
            expect(transactions.length).toBe(1);

            const debitEntries = await ledgerModel.find({ account: account1._id, type: 'debit' });
            const creditEntries = await ledgerModel.find({ account: account2._id, type: 'credit' });
            expect(debitEntries.length).toBe(1);
            expect(creditEntries.length).toBe(1);

            // Balance should reflect single transfer
            const balance1 = await account1.getBalance();
            const balance2 = await account2.getBalance();
            expect(balance1).toBe(4000);
            expect(balance2).toBe(1000);
        });

        it('should reject transfer to same account', async () => {
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account1._id.toString(),
                    amount: 1000,
                    idempotencyKey: 'test-key-same'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Cannot transfer to the same account');
        });

        it('should reject transfer with invalid amount (zero or negative)', async () => {
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account2._id.toString(),
                    amount: 0,
                    idempotencyKey: 'test-key-zero'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Amount must be positive');
        });

        it('should reject transfer with missing fields', async () => {
            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: account2._id.toString()
                    // missing amount and idempotencyKey
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        it('should reject transfer from inactive account', async () => {
            // Create inactive account
            const inactiveUser = await userModel.create({
                name: 'Inactive User',
                email: 'inactive@test.com',
                password: 'password123'
            });
            const inactiveAccount = await accountModel.create({
                user: inactiveUser._id,
                status: 'inactive',
                balance: 0
            });
            await ledgerModel.create({ account: inactiveAccount._id, amount: 1000, type: 'credit' });

            const req = {
                body: {
                    fromAccount: inactiveAccount._id.toString(),
                    toAccount: account2._id.toString(),
                    amount: 500,
                    idempotencyKey: 'test-key-inactive'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('ACTIVE');
        });

        it('should reject transfer to inactive account', async () => {
            const inactiveUser = await userModel.create({
                name: 'Inactive User 2',
                email: 'inactive2@test.com',
                password: 'password123'
            });
            const inactiveAccount = await accountModel.create({
                user: inactiveUser._id,
                status: 'inactive',
                balance: 0
            });

            const req = {
                body: {
                    fromAccount: account1._id.toString(),
                    toAccount: inactiveAccount._id.toString(),
                    amount: 500,
                    idempotencyKey: 'test-key-inactive-2'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('ACTIVE');
        });
    });

    describe('createInitialFundsTransaction', () => {
        it('should successfully seed funds from system account', async () => {
            const req = {
                user: systemUser,
                body: {
                    toAccount: account2._id.toString(),
                    amount: 5000,
                    idempotencyKey: 'seed-key-1'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createInitialFundsTransaction(req, res);

            expect(res.statusCode).toBe(201);
            expect(res.body.message).toBe('Transaction completed');

            // Verify transaction created
            const transactions = await transactionModel.find({ idempotencyKey: 'seed-key-1' });
            expect(transactions.length).toBe(1);
            expect(transactions[0].status).toBe('completed');
            expect(transactions[0].fromAccount.toString()).toBe(systemAccount._id.toString());
            expect(transactions[0].toAccount.toString()).toBe(account2._id.toString());
            expect(transactions[0].amount).toBe(5000);

            // Verify ledger entries
            const debitEntries = await ledgerModel.find({ account: systemAccount._id, type: 'debit' });
            const creditEntries = await ledgerModel.find({ account: account2._id, type: 'credit' });
            expect(debitEntries.length).toBe(1);
            expect(creditEntries.length).toBe(1);
            expect(debitEntries[0].amount).toBe(5000);
            expect(creditEntries[0].amount).toBe(5000);

            // Verify balance
            const balance2 = await account2.getBalance();
            expect(balance2).toBe(5000);
        });

        it('should reject seeding with invalid toAccount', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const req = {
                user: systemUser,
                body: {
                    toAccount: fakeId.toString(),
                    amount: 5000,
                    idempotencyKey: 'seed-key-2'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createInitialFundsTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid toAccount');
        });

        it('should reject seeding with missing fields', async () => {
            const req = {
                user: systemUser,
                body: {
                    toAccount: account2._id.toString()
                    // missing amount and idempotencyKey
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createInitialFundsTransaction(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        it('should handle idempotency for seeding', async () => {
            const req = {
                user: systemUser,
                body: {
                    toAccount: account2._id.toString(),
                    amount: 5000,
                    idempotencyKey: 'seed-key-idempotent'
                }
            };
            const res = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };

            await createInitialFundsTransaction(req, res);
            expect(res.statusCode).toBe(201);

            // Second request with same key
            const res2 = {
                statusCode: 0,
                body: {},
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };
            await createInitialFundsTransaction(req, res2);

            expect(res2.statusCode).toBe(200);
            expect(res2.body.message).toBe('Transaction already processed');

            // Verify only one transaction
            const transactions = await transactionModel.find({ idempotencyKey: 'seed-key-idempotent' });
            expect(transactions.length).toBe(1);
        });
    });
});