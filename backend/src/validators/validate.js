/**
 * Validation middleware factory
 * Uses Zod schemas to validate request body, query, and params
 * Returns consistent 400 responses with structured error details
 */

const validationMiddleware = (schema) => {
  return (req, res, next) => {
    try {
      // Validate body, query, and params
      const result = schema.safeParse({
        body: req.body || {},
        query: req.query || {},
        params: req.params || {},
      });

      if (!result.success) {
        // Format Zod errors into a consistent response
        const errors = result.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));

        return res.status(400).json({
          message: 'Validation failed',
          errors,
        });
      }

      // Attach validated data to request (optional - can be used instead of req.body)
      req.validated = result.data;
      next();
    } catch (error) {
      // Should not happen with safeParse, but handle gracefully
      console.error('Validation middleware error:', error);
      return res.status(500).json({
        message: 'Internal validation error',
      });
    }
  };
};

module.exports = { validationMiddleware };