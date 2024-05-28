SELECT
    date,
    t,
    z,
    ROUND((z * 100 / CAST(t AS REAL)), 2) AS percentage
FROM
    (
        SELECT
            DATE,
            t,
            SUM(json_extract (v, '$.0')) AS z
        FROM
            (
                SELECT
                    DATE,
                    json_extract (data, '$.players') AS t,
                    json_tree.value AS v
                FROM
                    summary,
                    json_tree (data, '$.connectedPlayers')
                WHERE
                    VALUE LIKE '{"0":%'
            )
        GROUP BY
            DATE
    );