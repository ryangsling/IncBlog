-- SQLite tables captured from IncBlog 81a79ce.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
  passwordHash VARCHAR(255), username VARCHAR(255) NOT NULL UNIQUE, bio TEXT DEFAULT '', avatar VARCHAR(255),
  customDomain VARCHAR(255), googleId VARCHAR(255), emailVerified TINYINT(1) DEFAULT 0,
  emailVerifyToken VARCHAR(255) UNIQUE, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL UNIQUE, slug VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL,
  content TEXT DEFAULT '', excerpt TEXT DEFAULT '', summary TEXT DEFAULT '', metaTitle VARCHAR(255) DEFAULT '',
  metaDescription VARCHAR(255) DEFAULT '', ogImage VARCHAR(255), featuredImage VARCHAR(255), status TEXT DEFAULT 'draft',
  publishAt DATETIME, views INTEGER DEFAULT 0, format TEXT DEFAULT 'markdown', createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL, deletedAt DATETIME, userId INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  categoryId INTEGER REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, filename VARCHAR(255) NOT NULL, originalName VARCHAR(255),
  url VARCHAR(255) NOT NULL, thumbUrl VARCHAR(255), size INTEGER DEFAULT 0, mimetype VARCHAR(255) DEFAULT 'image/webp',
  createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL, userId INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO users (id, name, username, email, avatar, createdAt, updatedAt)
VALUES (77, 'Original Author', 'original-author', 'owner@example.test', '/uploads/avatar.webp', '2025-01-02 00:00:00.000 +00:00', '2025-01-02 00:00:00.000 +00:00');
INSERT INTO media (id, filename, url, thumbUrl, userId, createdAt, updatedAt)
VALUES (22, 'library.webp', 'https://old-media.example.test/library.webp', 'https://old-media.example.test/thumb-library.webp', 77, '2025-01-02 00:00:00.000 +00:00', '2025-01-02 00:00:00.000 +00:00'),
       (23, 'unpublished.webp', '/uploads/unpublished.webp', NULL, 77, '2025-01-02 00:00:00.000 +00:00', '2025-01-02 00:00:00.000 +00:00');
INSERT INTO posts (id, title, slug, content, featuredImage, ogImage, userId, status, createdAt, updatedAt)
VALUES (42, 'Old post', 'public-slug', '![inline](https://old-media.example.test/thumb-library.webp)', '/uploads/feature.webp',
        'https://old-media.example.test/share.webp', 77, 'published', '2025-01-02 00:00:00.000 +00:00', '2025-01-02 00:00:00.000 +00:00'),
       (43, 'Old draft', 'private-slug', 'Private content', '/uploads/unpublished.webp',
        NULL, 77, 'draft', '2025-01-02 00:00:00.000 +00:00', '2025-01-02 00:00:00.000 +00:00');
