SELECT date,
       t,
       u,
       ROUND((u * 100 / CAST(t AS REAL)), 2) AS percentage
  FROM (
           SELECT date,
                  json_extract(data, '$.players') AS t,
                  json_extract(json_tree.value, '$.unknown') AS u
             FROM summary,
                  json_tree(data, '$.playerTypes')
            WHERE value LIKE '{"unknown":%'
       )
 ORDER BY date;
