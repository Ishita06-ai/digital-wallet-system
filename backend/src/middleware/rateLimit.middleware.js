const rateLimit = require('express-rate-limit');

/**
 * Creates a rate limiter for authentication endpoints.
 * Factory function allows fresh instances for testing isolation.
 *
 * @param {Object} options - Optional overrides for limit configuration
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.max - Max requests per window (default: 10)
 * @returns {Function} Express middleware
 */
function createAuthLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? 15 * 60 * 1000, // 15 minutes
    max: options.max ?? 10, // Limit each IP to 10 requests per windowMs
    message: {
      message: 'Too many authentication attempts, please try again after 15 minutes.',
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    statusCode: 429,
  });
}

// Export a default instance for production use
const authLimiter = createAuthLimiter();

module.exports = { authLimiter, createAuthLimiter };