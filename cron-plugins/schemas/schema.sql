CREATE TABLE plugins (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin TEXT (20)
);
CREATE INDEX idx_plugins ON plugins (plugin);
