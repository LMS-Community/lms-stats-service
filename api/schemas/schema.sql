CREATE TABLE servers (
    id       TEXT PRIMARY KEY NOT NULL,
    created  TEXT NOT NULL,
    lastseen TEXT NOT NULL,
    data     BLOB NOT NULL
);
CREATE INDEX idx_lastseen ON servers (lastseen);
