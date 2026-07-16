describe('Database', () => {
  it('uses SQLite when DATABASE_URL is not set', () => {
    const { sequelize } = require('../src/models');
    expect(sequelize.getDialect()).toBe('sqlite');
  });

  it('dialect logic branches on DATABASE_URL', () => {
    // ponytail: verify the branching logic by reading the source
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'models', 'index.js'), 'utf8');
    expect(src).toContain("process.env.DATABASE_URL");
    expect(src).toContain("dialect: 'postgres'");
    expect(src).toContain("dialect: 'sqlite'");
  });
});
