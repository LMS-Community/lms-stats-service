SELECT date,
       t,
       u,
       (u * 100 / t) AS percentage
  FROM (
           SELECT date,
                  json_extract(data, '$.players') AS t,
                  json_extract(json_tree.value, '$.unknown') AS u
             FROM summary,
                  json_tree(data, '$.playerTypes')
            WHERE value LIKE '{"unknown":%'
       )
 ORDER BY date;

;