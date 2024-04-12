CREATE TABLE summary (
    id   INTEGER   PRIMARY KEY AUTOINCREMENT,
    date TEXT (20) UNIQUE,
    data BLOB
);
CREATE INDEX idx_summary_date ON summary (date);
