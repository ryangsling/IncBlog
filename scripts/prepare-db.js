async function prepareDatabase() {
  if (process.env.DATABASE_URL && !process.env.MIGRATION_DATABASE_URL) {
    throw new Error('Provide MIGRATION_DATABASE_URL for PostgreSQL schema changes.');
  }
  if (process.env.MIGRATION_DATABASE_URL) process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  const { sequelize } = require('../src/models');
  try {
    await require('../src/migrations').runMigrations();
    console.log('Database migrations are current.');
  } finally {
    await sequelize.close();
  }
}

prepareDatabase().catch((error) => {
  console.error(`Database migration failed (${error.name}). Check the target and migration prerequisites.`);
  process.exitCode = 1;
});
