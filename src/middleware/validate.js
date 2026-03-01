/**
 * Request Validation Middleware
 * Uses Joi for schema validation on request body, params, query.
 */

/**
 * Validate request body against a Joi schema.
 * Returns 400 with descriptive error on failure.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const message = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ error: message });
    }

    req.body = value;
    next();
  };
}

/**
 * Validate request params against a Joi schema.
 */
function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const message = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ error: message });
    }

    req.params = value;
    next();
  };
}

module.exports = { validateBody, validateParams };
