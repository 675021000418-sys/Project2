// Middleware สำหรับบันทึก Audit Log
const pool = require('../config/database');

const auditLogger = (event_type, resource = null) => {
  return (req, res, next) => {
    const originalSend = res.send;
    const startTime = Date.now();
    let logged = false;

    res.send = function (data) {
      if (!logged) {
        logged = true;
        const responseTime = Date.now() - startTime;
        const result = res.statusCode < 400 ? 'success' : (res.statusCode === 401 || res.statusCode === 403 ? 'denied' : 'fail');
        
        // บันทึก log เฉพาะกรณีสำคัญ และบันทึกทุกกรณีที่ถูกปฏิเสธ (denied)
        const importantEvents = [
          'login', 'logout', 'user.create', 'user.update', 'user.delete', 
          'role.create', 'role.update', 'role.delete', 'permission.create',
          'permission.update', 'permission.delete', 'acl.manage', 'endpoint.manage',
          'request.approve', 'request.reject', 'request.dispense', 'file.upload',
          'file.delete',
          'inventory.read', 'inventory.create', 'inventory.update', 'inventory.delete',
          'inventory.receive', 'inventory.issue', 'inventory.adjust'
        ];
        
        if (importantEvents.includes(event_type) || result === 'denied') {
          pool.query(
            `INSERT INTO audit_logs (user_id, username_attempted, event_type, resource, resource_id, result, ip, detail)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              req.user?.id || null,
              req.user?.username || req.body?.username || null,
              event_type,
              resource,
              req.params?.id && !isNaN(parseInt(req.params.id)) ? parseInt(req.params.id) : null,
              result,
              req.clientIp || req.ip || null,
              JSON.stringify({
                method: req.method,
                path: req.originalUrl || req.path,
                statusCode: res.statusCode,
                responseTime: responseTime,
              }),
            ]
          ).catch(err => console.error('บันทึก audit log ล้มเหลว:', err));
        }
      }

      return originalSend.call(this, data);
    };

    next();
  };
};

module.exports = auditLogger;

