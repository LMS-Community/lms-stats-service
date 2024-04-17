export interface StatsSummary {
    versions?: object[];
    countries?: object[];
    os?: object[];
    connectedPlayers?: object[]
    playerTypes?: object[];
    plugins?: object[];
}

export interface ValueCountsObject {
    v: string | number;
    c: number;
}

export async function getSummary(db: any, secs: number = 0): Promise<StatsSummary> {
    const results: StatsSummary = {}

    const condition = (secs > 0) ? 'WHERE UNIXEPOCH(DATETIME()) - UNIXEPOCH(lastseen) < ' + secs.toString() : '';

    const getStats = async (identifier: string) => {
        const { results } = await db.prepare(`
            SELECT JSON_EXTRACT(data, '$.${identifier}') AS v, COUNT(1) AS c
            FROM servers
            ${ condition }
            GROUP BY JSON_EXTRACT(data, '$.${identifier}')
            ORDER BY c DESC;
        `).all()

        return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
    }

    results.versions = await getStats('version')
    results.countries = await getStats('country')
    results.connectedPlayers = await getStats('players')

    const { results: playerTypes } = await db.prepare(`
        SELECT model AS v, SUM(count) AS c
        FROM (
            SELECT key AS model, value AS count, type, path
            FROM servers, JSON_TREE(data, '$.playerTypes')
            ${ condition }
        )
        WHERE type = 'integer' AND path = '$.playerTypes'
        GROUP BY model
        ORDER BY c DESC;
    `).all()

    results.playerTypes = playerTypes.map((item: ValueCountsObject) => { return { [item.v]: item.c } })

    const { results: os } = await db.prepare(`
        SELECT COUNT(1) AS c, (os || " - " || platform) AS v
        FROM (
            SELECT CASE WHEN osname LIKE '%windows%' AND osname LIKE '%64-bit%' THEN 'Windows (64-bit)'
                ELSE
                    CASE WHEN osname LIKE '%windows%' THEN 'Windows (32-bit)' ELSE
                        CASE WHEN osname LIKE '%macos%' THEN 'macOS' ELSE osname END
                    END
            END AS os, REPLACE(platform, '-linux', '') AS platform
            FROM (
                SELECT JSON_EXTRACT(data, '$.osname') AS osname, JSON_EXTRACT(data, '$.platform') AS platform
                FROM servers
                ${ condition }
            )
        )
        WHERE os NOT NULL
        GROUP BY os, platform
        ORDER BY c DESC;
    `).all();

    results.os = os.map((item: ValueCountsObject) => { return { [item.v]: item.c } })

    const { results: plugins } = await db.prepare(`
        SELECT * FROM (
            SELECT COUNT(1) AS c, JSON_EACH.value AS v
            FROM servers, JSON_EACH(data, '$.plugins')
            ${ condition }
            GROUP BY JSON_EACH.value
            ORDER BY c DESC
        )
        WHERE c > 5
    `).all()

    results.plugins = plugins.map((item: ValueCountsObject) => { return { [item.v]: item.c }})

    return results
}
