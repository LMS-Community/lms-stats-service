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

// How far back do we go to consider an installation active?
export const ACTIVE_INTERVAL = 86400 * 30

function getConditions(secs: number = 0, keys: Array<string> = []): string {
    let condition = (secs > 0)
        ? 'WHERE UNIXEPOCH(DATETIME()) - UNIXEPOCH(lastseen) < ?'
        : 'WHERE 1 > ?'

    for (let i = 0; i < keys.length; i++) {
        condition += ` AND JSON_EXTRACT(data, '$.${keys[i]}') = ?`
    }

    return condition
}

async function getStats (db: any, identifier: string, secs: number = 0, keys: Array<string> = [], values: Array<string> = [], castNumbers?: boolean) {
    let groupBy = `JSON_EXTRACT(data, '$.${identifier}')`
    if (castNumbers) groupBy = `CAST (${groupBy} AS string)`

    console.log(JSON.stringify({secs, keys, values}, null, 2));
    const { results } = await db.prepare(`
        SELECT JSON_EXTRACT(data, '$.${identifier}') AS v, COUNT(1) AS c
        FROM servers
        ${ getConditions(secs, keys) }
        GROUP BY ${groupBy}
        ORDER BY c DESC;
    `).bind(secs, ...values).all()

    return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getTrackCountBins(db: any, secs: number = 0, keys?: Array<string>, values: Array<string> = []): Promise<ValueCountsObject[]> {
    const { results } = await db.prepare(`
        SELECT COUNT(1) AS c, v FROM (
            SELECT CASE
                WHEN tc > 1000000 THEN 1000000
                WHEN tc > 500000 THEN 500000
                WHEN tc > 100000 THEN 100000
                WHEN tc > 50000 THEN 50000
                WHEN tc > 20000 THEN 20000
                WHEN tc > 10000 THEN 10000
                WHEN tc > 5000 THEN 5000
                WHEN tc > 1000 THEN 1000
                WHEN tc > 500 THEN 500
                WHEN tc > 0 THEN 1
                ELSE 0
            END AS v
            FROM (
                SELECT CAST(JSON_EXTRACT(data, '$.tracks') AS number) AS tc
                FROM servers
                ${ getConditions(secs, keys) }
            )
        )
        GROUP BY v
        ORDER BY v;
    `).bind(secs, ...values).all()

    return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getVersions (db: any, secs: number, keys?: Array<string>, values?: Array<string>): Promise<ValueCountsObject[]> {
    return getStats(db, 'version', secs, keys, values)
}

export async function getCountries(db: any, secs: number, keys?: Array<string>, values?: Array<string>): Promise<ValueCountsObject[]> {
    return getStats(db, 'country', secs, keys, values)
}

export async function getPlayers(db: any, secs: number, keys?: Array<string>, values?: Array<string>): Promise<ValueCountsObject[]> {
    return getStats(db, 'players', secs, keys, values, true)
}

export async function getPlayerCount(db: any, secs: number = 0, keys?: Array<string>, values: Array<string> = []): Promise<number> {
    const { results } = await db.prepare(`
        SELECT SUM(JSON_EXTRACT(data, '$.players')) AS p
        FROM servers
        ${ getConditions(secs, keys) }
    `).bind(secs, ...values).all()

    return results[0].p
}


export async function getPlayerTypes(db: any, secs: number = 0, keys?: Array<string>, values: Array<string> = []): Promise<ValueCountsObject[]> {
    const { results: playerTypes } = await db.prepare(`
        SELECT model AS v, SUM(count) AS c
        FROM (
            SELECT key AS model, value AS count, type, path
            FROM servers, JSON_TREE(data, '$.playerTypes')
            ${ getConditions(secs, keys) }
        )
        WHERE type = 'integer' AND path = '$.playerTypes'
        GROUP BY model
        ORDER BY c DESC;
    `).bind(secs, ...values).all()

    return playerTypes.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

export async function getOS(db: any, secs: number = 0, keys?: Array<string>, values: Array<string> = []): Promise<ValueCountsObject[]> {
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
                ${ getConditions(secs, keys) }
            )
        )
        WHERE os NOT NULL
        GROUP BY os, platform
        ORDER BY c DESC;
    `).bind(secs, ...values).all()

    return os.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

// "fast" would look up from helper table, which is updated hourly only; set to false for most accurate results (if CPU time allows)
export async function getPlugins(db: any, secs: number = 0, fast: boolean = false, keys?: Array<string>, values: Array<string> = []): Promise<ValueCountsObject[]> {
    let query;
    if (fast) {
        // fast doesn't have timestamps, so we can't filter by time
        values = keys = []
        query = `
            SELECT plugin AS v, plugins.count AS c
            FROM plugins
            WHERE c > 5 AND -1 < ?
            ORDER BY c DESC
        `
    } else {
        query = `
            SELECT * FROM (
                SELECT COUNT(1) AS c, JSON_EACH.value AS v
                FROM servers, JSON_EACH(data, '$.plugins')
                ${ getConditions(secs, keys) }
                GROUP BY JSON_EACH.value
            )
            WHERE c > 5
            ORDER BY c DESC
        `
    }

    const { results: plugins } = await db.prepare(query).bind(secs, ...values).all()

    return plugins.map((item: ValueCountsObject) => { return { [item.v]: item.c }})
}

export async function extractPlugins(db: any, secs: number = 0): Promise<undefined> {
    await db.prepare('DELETE FROM plugins').run()
    await db.prepare(`
        INSERT INTO plugins (plugin, count)
            SELECT plugin, COUNT(1) AS count FROM (
                SELECT JSON_EACH.value AS plugin
                FROM servers, JSON_EACH(servers.data, '$.plugins')
                ${ getConditions(secs) }
            )
            GROUP BY plugin
    `).bind(secs).run()
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

export async function getSummary(db: any, secs: number = 0, keys?: Array<string>, values?: Array<string>): Promise<StatsSummary> {
    return {
        versions: await getVersions(db, secs, keys, values),
        countries: await getCountries(db, secs, keys, values),
        connectedPlayers: await getPlayers(db, secs, keys, values),
        playerTypes: await getPlayerTypes(db, secs, keys, values),
        os: await getOS(db, secs, keys, values),
        tracks: await getTrackCountBins(db, secs, keys, values)
    }
}
