-- 0004: 商品分类支持二级层级
-- 旧表把 name 写成了建表级 UNIQUE（全站唯一），二级分类无法在不同一级下重名；
-- SQLite 不能 ALTER 掉建表约束，只能整表重建。id 原样保留，products.category_id 无外键约束，引用不断。
CREATE TABLE IF NOT EXISTS categories__v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER                              -- NULL = 一级分类；非 NULL = 该一级下的二级分类
);
INSERT INTO categories__v2 (id, name, sort, parent_id)
  SELECT id, name, sort, NULL FROM categories;
DROP TABLE categories;
ALTER TABLE categories__v2 RENAME TO categories;
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(IFNULL(parent_id, 0), sort, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_parent_name ON categories(IFNULL(parent_id, 0), name);
