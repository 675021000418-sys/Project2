// Middleware สำหรับ Validation ด้วย Zod
const { ZodError } = require('zod');

const validate = (schema) => {
  return (req, res, next) => {
    try {
      if (schema.shape && (schema.shape.body || schema.shape.query || schema.shape.params)) {
        schema.parse({
          body: req.body,
          query: req.query,
          params: req.params,
        });
      } else {
        req.body = schema.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง', details: errors });
      }
      next(error);
    }
  };
};

module.exports = validate;

