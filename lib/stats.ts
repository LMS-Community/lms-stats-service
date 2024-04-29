export interface StatsSummary {
    versions?: object[];
    countries?: object[];
    os?: object[];
    connectedPlayers?: object[]
    playerTypes?: object[];
    plugins?: object[];
    tracks?: object[];
}

export interface ValueCountsObject {
    v: string | number;
    c: number;
}

function getTimeCondition(secs: number = 0): string {
    return (secs > 0) ? 'WHERE UNIXEPOCH(DATETIME()) - UNIXEPOCH(lastseen) < ' + secs.toString() : '';
}

async function getStats (db: any, identifier: string, secs?: number) {
    const { results } = await db.prepare(`
        SELECT JSON_EXTRACT(data, '$.${identifier}') AS v, COUNT(1) AS c
        FROM servers
        ${ getTimeCondition(secs) }
        GROUP BY JSON_EXTRACT(data, '$.${identifier}')
        ORDER BY c DESC;
    `).all()

    return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getTrackCountBins(db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    const { results } = await db.prepare(`
        SELECT COUNT(1) AS c, v FROM (
            SELECT CASE WHEN tc > 1000000 THEN 1000000 ELSE
                CASE WHEN tc > 500000 THEN 500000 ELSE
                    CASE WHEN tc > 100000 THEN 100000 ELSE
                        CASE WHEN tc > 50000 THEN 50000 ELSE
                            CASE WHEN tc > 20000 THEN 20000 ELSE
                                CASE WHEN tc > 10000 THEN 10000 ELSE
                                    CASE WHEN tc > 5000 THEN 5000 ELSE
                                        CASE WHEN tc > 1000 THEN 1000 ELSE
                                            CASE WHEN tc > 500 THEN 500 ELSE
                                                CASE WHEN tc > 0 THEN 1 ELSE
                                                    0
                                                END
                                            END
                                        END
                                    END
                                END
                            END
                        END
                    END
                END
            END AS v
            FROM (
                SELECT JSON_EXTRACT(data, '$.tracks') AS tc
                FROM servers
                ${ getTimeCondition(secs) }
            )
        )
        GROUP BY v
        ORDER BY v;
    `).all()

    return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getVersions (db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    return getStats(db, 'version', secs)
}

export async function getCountries(db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    return getStats(db, 'country', secs)
}

export async function getPlayers(db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    return getStats(db, 'players', secs)
}

export async function getPlayerCount(db: any, secs: number = 0): Promise<number> {
    const { results } = await db.prepare(`
        SELECT SUM(JSON_EXTRACT(data, '$.players')) AS p
        FROM servers
        ${ getTimeCondition(secs) }
    `).all()

    return results[0].p
}


export async function getPlayerTypes(db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    const { results: playerTypes } = await db.prepare(`
        SELECT model AS v, SUM(count) AS c
        FROM (
            SELECT key AS model, value AS count, type, path
            FROM servers, JSON_TREE(data, '$.playerTypes')
            ${ getTimeCondition(secs) }
        )
        WHERE type = 'integer' AND path = '$.playerTypes'
        GROUP BY model
        ORDER BY c DESC;
    `).all()

    return playerTypes.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getOS(db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    const { results: os } = await db.prepare(`
        SELECT COUNT(1) AS c, (os || " - " || platform) AS v
        FROM (
            SELECT CASE
                WHEN osname LIKE '%windows%' AND osname LIKE '%64-bit%' THEN 'Windows (64-bit)'
                WHEN osname LIKE '%windows%' THEN 'Windows (32-bit)'
                WHEN osname LIKE '%Debian%Docker%' THEN 'Debian (Docker)'
                WHEN osname LIKE 'QLMS %' THEN REPLACE(REPLACE(osname, ' 9 stretch', ''), ' (QNAP TurboStation)', '')
                WHEN osname LIKE '%macos%' THEN 'macOS'
                ELSE osname
            END AS os, REPLACE(platform, '-linux', '') AS platform
            FROM (
                SELECT JSON_EXTRACT(data, '$.osname') AS osname, JSON_EXTRACT(data, '$.platform') AS platform
                FROM servers
                ${ getTimeCondition(secs) }
            )
        )
        WHERE os NOT NULL
        GROUP BY os, platform
        ORDER BY c DESC;
    `).all();

    return os.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getPlugins(db: any, secs: number = 0): Promise<ValueCountsObject[]> {
    const { results: plugins } = await db.prepare(`
        SELECT * FROM (
            SELECT COUNT(1) AS c, JSON_EACH.value AS v
            FROM servers, JSON_EACH(data, '$.plugins')
            ${ getTimeCondition(secs) }
            GROUP BY JSON_EACH.value
            ORDER BY c DESC
        )
        WHERE c > 5
    `).all()

    return plugins.map((item: ValueCountsObject) => { return { [item.v]: item.c }})
}

export async function getHistory(db: any): Promise<Object[]> {
    // TODO group into buckets/windows using window functions (if they exist in D1 - https://www.sqlite.org/windowfunctions.html)
    const { results } = await db.prepare(`
        SELECT summary.date AS d,
            JSON_EXTRACT(data, '$.os') AS o,
            JSON_EXTRACT(data, '$.versions') AS v,
            JSON_EXTRACT(data, '$.players') AS p
        FROM summary
        ORDER BY d ASC;
    `).all()

    return results
}

export async function getSummary(db: any, secs: number = 0): Promise<StatsSummary> {
    return {
        versions: await getVersions(db, secs),
        countries: await getCountries(db, secs),
        connectedPlayers: await getPlayers(db, secs),
        playerTypes: await getPlayerTypes(db, secs),
        os: await getOS(db, secs),
        tracks: await getTrackCountBins(db, secs)
    }
}
