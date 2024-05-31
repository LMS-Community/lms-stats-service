export interface ValueCountsObject {
    v: string | number;
    c: number;
}

export const playerTypesMap: { [k: string]: string} = {
    baby: 'Squeezebox Radio',
    boom: 'Squeezebox Boom',
    controller: 'Squeezebox Controller',
    daphile: 'Daphile',
    euphony: 'Euphony',
    fab4: 'Squeezebox Touch',
    http: 'HTTP',
    ipengipad: 'iPeng iPad',
    ipengipod: 'iPeng iPhone',
    'ipeng ipad': 'iPeng iPad',
    'ipeng ipod': 'iPeng iPhone',
    'ipeng iphone': 'iPeng iPhone',
    m6encore: 'M6 Encore',
    receiver: 'Squeezebox Receiver',
    'ropieee [ropieeexl]': 'Ropieee',
    slimlibrary: 'SlimLibrary',
    slimp3: 'SliMP3',
    softsqueeze: 'Softsqueeze',
    'squeeze connect': 'Squeeze Connect',
    squeezebox: 'Squeezebox 1',
    squeezebox2: 'Squeezebox 2/3/Classic',
    squeezebox3: 'Squeezebox 2/3/Classic',
    'squeezebox classic': 'Squeezebox 2/3/Classic',
    squeezeesp32: 'SqueezeESP32',
    squeezelite: 'Squeezelite',
    squeezeplay: 'SqueezePlay',
    squeezeplayer: 'SqueezePlayer',
    squeezeslave: 'Squeezeslave',
    transporter: 'Transporter'
};


// How far back do we go to consider an installation active?
export const ACTIVE_INTERVAL = 86400 * 30
const MAX_HISTORY_BINS = 50
const PLUGINS_CACHE_TTL = 86400

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

export async function getPlayerModels(db: any, secs: number = 0, keys?: Array<string>, values: Array<string> = []): Promise<ValueCountsObject[]> {
    const { results: playerModels } = await db.prepare(`
        SELECT model AS v, SUM(count) AS c
        FROM (
            SELECT key AS model, value AS count, type, path
            FROM servers, JSON_TREE(data, '$.playerModels')
            ${ getConditions(secs, keys) }
        )
        WHERE type = 'integer' AND path = '$.playerModels'
        GROUP BY model
        ORDER BY c DESC;
    `).bind(secs, ...values).all()

    return playerModels.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
}

/*
 * squeezelite can be many things - return the more specific modelName instead
 * I've tried to optimize this query in order to be able to combine `playerTypes`
 * with `playerModels`:
 * 1. get a new object with only one or the other - depending on whether `playerModels` exists
 * 2. expand data using `JSON_TREE`
 * 3. get only defined values
 * 4. take the result set and apply additional player type mapping in JS
 * This is considerably faster than expanding all of the data object and filtering from there.
 */
export async function getMergedPlayerTypes(db: any, secs: number = 0, keys?: Array<string>, values: Array<string> = []): Promise<{ [k: string]: number}[]> {
    const { results: playerTypes } = await db.prepare(`
        SELECT JSON_TREE.key AS v, SUM(JSON_TREE.value) AS c
        FROM (
            SELECT JSON_TREE.value AS value
            FROM (
                SELECT CASE
                    WHEN data LIKE '%playerModels%' THEN JSON_OBJECT('playerTypes', JSON_EXTRACT(data, '$.playerModels'))
                    ELSE JSON_OBJECT('playerTypes', JSON_EXTRACT(data, '$.playerTypes'))
                END AS data
                FROM servers
                ${ getConditions(secs, keys) }
            ), JSON_TREE(data)
            WHERE NOT JSON_TREE.value IS NULL AND JSON_TREE.key = 'playerTypes'
        ) v, JSON_TREE(v.value)
        WHERE JSON_TREE.type = 'integer'
        GROUP BY LOWER(JSON_TREE.key)
        ORDER BY c DESC;
    `).bind(secs, ...values).all()

    // the database might return 'receiver' from playerTypes, and 'Squeezebox Receiver' from playerModels
    // let's join them here by applying a mapping, and recount results by new type names
    const regroupPlayerTypes = playerTypes.reduce((accumulator: { [k: string]: number }, item: ValueCountsObject) => {
        const k = mapPlayerType(item.v as string)
        accumulator[k] = (accumulator[k] || 0) + item.c
        return accumulator
    }, {})

    return Object.keys(regroupPlayerTypes).sort((a, b) => {
        return regroupPlayerTypes[b] - regroupPlayerTypes[a]
    }).map((k: string) => {
        return { [k]: regroupPlayerTypes[k] }
    })
}

function mapPlayerType(player: string): string {
    player = playerTypesMap[(player as string).toLowerCase()] || player

    // this seems to be created dynamically, can't be mapped statically
    if (player.match(/ropi.*ee/i)) player = 'Ropieee'
    else if (player.match(/^Aroio/)) player = 'AroioOS'
    else if (player.match(/^Yulong/)) player = 'Yulong'
    else if (player.match(/^Topping/)) player = 'Topping'
    else if (player.match(/^MusicServer4|MS4H/i)) player = 'MusicServer4(Home|Loxone)'

    return player
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
                WHEN osname LIKE '%os x 1%' THEN 'macOS'
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
export async function getPlugins(db: any, queryCache: any, secs: number = 0, fast: boolean = true, keys?: Array<string>, values: Array<string> = []): Promise<ValueCountsObject[]> {
    let query, response;

    const cacheKey: string = keys?.sort().join(':') + '-' + values.sort().join(':')

    try {
        const cached = await queryCache.get(cacheKey)
        response = JSON.parse(cached)
    }
    catch(e) {
        console.warn(`failed to parse query cache: ${e}`)
    }

    if (!response) {
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
        const { results: plugins } = await db.prepare(query).bind(secs, ...values).all()
        response = plugins.map((item: ValueCountsObject) => { return { [item.v]: item.c }})

        await queryCache.put(cacheKey, JSON.stringify(response), { expirationTtl: PLUGINS_CACHE_TTL })
    }

    return response

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
    const { results } = await db.prepare(`
        SELECT MAX(d) AS d, o, v, p FROM (
            SELECT NTILE(${MAX_HISTORY_BINS}) OVER date AS bucket,
                date AS d,
                JSON_EXTRACT(data, '$.os') AS o,
                JSON_EXTRACT(data, '$.versions') AS v,
                JSON_EXTRACT(data, '$.players') AS p
            FROM summary
            WINDOW date AS (ORDER BY date)
        )
        GROUP BY bucket
    `).all()

    return results
}
