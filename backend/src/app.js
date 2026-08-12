const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const app = express();
const router = express.Router();
/* ✅ 1. ADD CORS (VERY IMPORTANT) */
app.use(
  cors({
    origin: "http://localhost:5173", // frontend URL
    credentials: true,               // allow cookies
  })
);

/* ✅ 2. Body & cookie parsers */
app.use(express.json());
app.use(cookieParser());

/* ✅ 3. Import routes */
const authRouter = require("./routes/auth.routes");
const accountRouter = require("./routes/account.routes");
const transactionRoutes = require("./routes/transaction.routes");
 // admin routes
const adminRouter = require("./routes/admin.routes");
const userRouter = require("./routes/user.routes");


/* ✅ 4. Health check route */
app.get("/", (req, res) => {
  res.send("Ledger Service is up and running");
});

/* ✅ 5. Use routes */
app.use("/api/auth", authRouter);
app.use("/api/accounts", accountRouter);
app.use("/api/transactions", transactionRoutes);
app.use("/api/user", userRouter);
app.use("/api/admin", adminRouter);
/* ✅ 6. Export app for server */
module.exports = app;