const { Client } = require('pg');
require('dotenv').config();

async function populateEndpoints() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://farm_db_zlvu_user:Ufb5D2R3m0LibEf5oEvO3cpTTzQFRc1a@dpg-db5nn92d0e5s7383dgt0-a.oregon-postgres.render.com/farm_db_zlvu',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const endpoints = [
    // Requests
    { method: 'GET', pattern: '^/app/requests$', key: 'request.read' },
    { method: 'POST', pattern: '^/app/requests/[0-9]+/approve$', key: 'request.approve' },
    { method: 'POST', pattern: '^/app/requests/[0-9]+/reject$', key: 'request.reject' },
    { method: 'POST', pattern: '^/app/requests/[0-9]+/dispense$', key: 'request.dispense' },
    { method: 'POST', pattern: '^/app/requests/[0-9]+/cancel$', key: 'request.cancel' },
    { method: 'POST', pattern: '^/app/inventory/[0-9]+/request$', key: 'request.create' },

    // Admin Users API
    { method: 'GET', pattern: '^/api/admin/users$', key: 'user.read' },
    { method: 'POST', pattern: '^/api/admin/users$', key: 'user.create' },
    { method: 'PUT', pattern: '^/api/admin/users/[0-9]+$', key: 'user.update' },
    { method: 'DELETE', pattern: '^/api/admin/users/[0-9]+$', key: 'user.delete' },
    { method: 'POST', pattern: '^/api/admin/users/role$', key: 'user.update' },

    // Admin Roles API
    { method: 'GET', pattern: '^/api/admin/roles$', key: 'role.read' },
    { method: 'POST', pattern: '^/api/admin/roles$', key: 'role.create' },
    { method: 'PUT', pattern: '^/api/admin/roles/[0-9]+$', key: 'role.update' },
    { method: 'DELETE', pattern: '^/api/admin/roles/[0-9]+$', key: 'role.delete' },

    // Admin Permissions API
    { method: 'GET', pattern: '^/api/admin/permissions$', key: 'permission.read' },
    { method: 'POST', pattern: '^/api/admin/permissions$', key: 'permission.create' },
    { method: 'PUT', pattern: '^/api/admin/permissions/[0-9]+$', key: 'permission.update' },
    { method: 'DELETE', pattern: '^/api/admin/permissions/[0-9]+$', key: 'permission.delete' },

    // Admin ACL API
    { method: 'GET', pattern: '^/api/admin/acl$', key: 'acl.manage' },
    { method: 'POST', pattern: '^/api/admin/acl$', key: 'acl.manage' },

    // Admin Endpoints API
    { method: 'GET', pattern: '^/api/admin/endpoints$', key: 'endpoint.manage' },
    { method: 'GET', pattern: '^/api/admin/endpoint-permissions$', key: 'endpoint.manage' },
    { method: 'POST', pattern: '^/api/admin/endpoint-permissions$', key: 'endpoint.manage' },
    { method: 'DELETE', pattern: '^/api/admin/endpoint-permissions/[0-9]+$', key: 'endpoint.manage' },

    // Admin Logs & Stats
    { method: 'GET', pattern: '^/api/admin/logs$', key: 'log.view' },
    { method: 'GET', pattern: '^/api/admin/stats$', key: 'user.read' },

    // Reports API
    { method: 'GET', pattern: '^/api/reports/usage$', key: 'report.usage' }
  ];

  for (const ep of endpoints) {
    await client.query(`
      INSERT INTO endpoint_permissions (method, path_pattern, permission_id)
      SELECT $1, $2, id FROM permissions WHERE key = $3
      ON CONFLICT (method, path_pattern) DO UPDATE
      SET permission_id = EXCLUDED.permission_id
    `, [ep.method, ep.pattern, ep.key]);
  }

  console.log(`Successfully mapped ${endpoints.length} endpoint permissions!`);
  await client.end();
}

populateEndpoints().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
