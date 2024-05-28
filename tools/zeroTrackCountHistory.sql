SELECT date,
       t,
       z,
       ROUND((z * 100 / CAST(t AS REAL)), 2) AS percentage
  FROM (
           SELECT DATE,
                  json_tree.value AS z,
                  SUM(json_tree.value) AS t
             FROM summary,
                  json_tree(data, '$.tracks')
            WHERE json_tree.type = 'integer'
            GROUP BY date
            ORDER BY date,
                     key
       );
