const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")

const mongoose = require("mongoose")

/**
 * - Create a new transaction
 * ATOMIC TRANSFER FLOW:
 *     * 1. Validate request
 *     * 2. Validate accounts exist and are active
 *     * 3. Start MongoDB session and transaction
 *     * 4. Check idempotency key atomically (inside transaction)
 *     * 5. Check sender balance (inside transaction)
 *     * 6. Create transaction (PENDING)
 *     * 7. Create DEBIT ledger entry
 *     * 8. Create CREDIT ledger entry
 *     * 9. Mark transaction COMPLETED
 *     * 10. Commit MongoDB session
 *     * 11. Send email notification (non-blocking)
 */

async function createTransaction(req, res) {
    const { fromAccount, toAccount, amount, idempotencyKey } = req.body
    const session = await mongoose.startSession()
    session.startTransaction()

    try {
        /**
         * 1. Validate request
         */
        if (fromAccount === undefined || toAccount === undefined || amount === undefined || idempotencyKey === undefined) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({
                message: "FromAccount, toAccount, amount and idempotencyKey are required"
            })
        }

        if (amount <= 0) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({
                message: "Amount must be positive"
            })
        }

        if (fromAccount === toAccount) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({
                message: "Cannot transfer to the same account"
            })
        }

        /**
         * 2. Validate accounts exist and are active (inside transaction)
         */
        const fromUserAccount = await accountModel.findOne({ _id: fromAccount }).session(session)
        const toUserAccount = await accountModel.findOne({ _id: toAccount }).session(session)

        if (!fromUserAccount || !toUserAccount) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({
                message: "Invalid fromAccount or toAccount"
            })
        }

        // 2a. Verify the authenticated user owns the fromAccount
        // Prevent an authenticated user from spending from another user's account
        if (fromUserAccount.user.toString() !== req.user._id.toString()) {
            await session.abortTransaction()
            session.endSession()
            return res.status(403).json({
                message: "You do not have permission to transfer from this account"
            })
        }

        if (fromUserAccount.status !== "active" || toUserAccount.status !== "active") {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({
                message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
            })
        }

        /**
         * 3. Check idempotency key atomically (inside transaction)
         * Use findOne with session to ensure we see any pending transaction
         */
        const existingTransaction = await transactionModel.findOne({ idempotencyKey }).session(session)

        if (existingTransaction) {
            await session.abortTransaction()
            session.endSession()

            if (existingTransaction.status === "completed") {
                return res.status(200).json({
                    message: "Transaction already processed",
                    transaction: existingTransaction
                })
            }

            if (existingTransaction.status === "pending") {
                return res.status(200).json({
                    message: "Transaction is still processing",
                })
            }

            if (existingTransaction.status === "failed") {
                return res.status(500).json({
                    message: "Transaction processing failed, please retry"
                })
            }

            if (existingTransaction.status === "reversed") {
                return res.status(500).json({
                    message: "Transaction was reversed, please retry"
                })
            }
        }

        /**
         * 4. Check sender balance (inside transaction)
         * Recompute balance from ledger within the same transaction
         */
        const currentBalance = await fromUserAccount.getBalance(session)

        if (currentBalance < amount) {
            await session.abortTransaction()
            session.endSession()
            return res.status(400).json({
                message: `Insufficient balance. Current balance is ${currentBalance}. Requested amount is ${amount}`
            })
        }

        /**
         * 5. Create transaction (PENDING)
         */
        const transaction = (await transactionModel.create([{
            fromAccount,
            toAccount,
            amount,
            idempotencyKey,
            status: "pending"
        }], { session }))[0]

        /**
         * 6. Create DEBIT ledger entry
         */
        await ledgerModel.create([{
            account: fromAccount,
            amount: amount,
            transaction: transaction._id,
            type: "debit"
        }], { session })

        /**
         * 7. Create CREDIT ledger entry
         */
        await ledgerModel.create([{
            account: toAccount,
            amount: amount,
            transaction: transaction._id,
            type: "credit"
        }], { session })

        /**
         * 8. Mark transaction COMPLETED
         */
        await transactionModel.findOneAndUpdate(
            { _id: transaction._id },
            { status: "completed" },
            { session, new: true }
        )

        /**
         * 9. Commit MongoDB session
         */
        await session.commitTransaction()
        session.endSession()

        /**
         * 10. Send email notification (non-blocking, fire-and-forget)
         * This runs outside the transaction to avoid delaying the response
         */
        // Email notification can be added here if needed
        // sendEmail(fromUserAccount.email, "Transfer Complete", `Transferred ${amount} to ${toAccount}`)

        return res.status(201).json({
            message: "Transaction completed successfully",
            transaction: {
                _id: transaction._id,
                fromAccount: transaction.fromAccount,
                toAccount: transaction.toAccount,
                amount: transaction.amount,
                idempotencyKey: transaction.idempotencyKey,
                status: "completed",
                createdAt: transaction.createdAt,
                updatedAt: transaction.updatedAt
            }
        })

    } catch (error) {
        /**
         * On ANY error, abort the transaction to ensure no partial state
         */
        try {
            await session.abortTransaction()
        } catch (abortError) {
            console.error("Failed to abort transaction:", abortError)
        }
        session.endSession()

        // Handle duplicate key error (idempotency key race condition) or WriteConflict
        // In case of concurrent requests with the same idempotencyKey, another request may have
        // already committed the transaction. Wait briefly and check if it's now completed.
        const isConflictError = error.code === 11000 || error.code === 112 ||
            (error.errorLabels && error.errorLabels.includes('TransientTransactionError'))

        if (isConflictError) {
            // Retry a few times to allow the winning transaction to complete
            for (let attempt = 0; attempt < 5; attempt++) {
                await new Promise(r => setTimeout(r, 50 * (attempt + 1)))
                const existing = await transactionModel.findOne({ idempotencyKey })
                if (existing && existing.status === "completed") {
                    return res.status(200).json({
                        message: "Transaction already processed",
                        transaction: existing
                    })
                }
            }
            return res.status(500).json({
                message: "Transaction processing failed, please retry"
            })
        }

        console.error("TRANSACTION ERROR:", error)
        return res.status(500).json({
            message: "Transaction failed, please retry"
        })
    }
}

async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body

    if (!toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "toAccount, amount and idempotencyKey are required"
        })
    }

    // These reads are outside the transaction (not critical for atomicity)
    const toUserAccount = await accountModel.findOne({ _id: toAccount })
    if (!toUserAccount) {
        return res.status(400).json({ message: "Invalid toAccount" })
    }

    const fromUserAccount = await accountModel.findOne({ user: req.user._id })
    if (!fromUserAccount) {
        return res.status(400).json({ message: "System user account not found" })
    }

    const session = await mongoose.startSession()
    session.startTransaction()

    try {
        // Idempotency check inside the transaction
        const existingTransaction = await transactionModel.findOne({ idempotencyKey }).session(session)
        if (existingTransaction) {
            await session.abortTransaction()
            session.endSession()
            if (existingTransaction.status === "completed") {
                return res.status(200).json({
                    message: "Transaction already processed",
                    transaction: existingTransaction
                })
            }
            return res.status(500).json({ message: "Transaction processing failed, please retry" })
        }

        const transaction = await transactionModel.create([{
            fromAccount: fromUserAccount._id,
            toAccount,
            amount,
            idempotencyKey,
            status: "pending"
        }], { session })

        await ledgerModel.create([{
            account: fromUserAccount._id,
            amount: amount,
            transaction: transaction[0]._id,
            type: "debit"
        }], { session })

        await ledgerModel.create([{
            account: toAccount,
            amount: amount,
            transaction: transaction[0]._id,
            type: "credit"
        }], { session })

        await transactionModel.findOneAndUpdate(
            { _id: transaction[0]._id },
            { status: "completed" },
            { session, returnDocument: 'after' }
        )

        await session.commitTransaction()
        session.endSession()

        if (res) {
            return res.status(201).json({ message: "Transaction completed" })
        }
    } catch (error) {
        try {
            await session.abortTransaction()
        } catch (abortError) {
            console.error("Failed to abort transaction:", abortError)
        }
        session.endSession()

        if (error.code === 11000) {
            const existing = await transactionModel.findOne({ idempotencyKey })
            if (existing && existing.status === "completed") {
                return res.status(200).json({
                    message: "Transaction already processed",
                    transaction: existing
                })
            }
            return res.status(500).json({ message: "Transaction processing failed, please retry" })
        }

        console.error("INITIAL FUNDS TRANSACTION ERROR:", error)
        return res.status(500).json({ message: "Transaction failed, please retry" })
    }
}

module.exports = {
    createTransaction,
    createInitialFundsTransaction
}