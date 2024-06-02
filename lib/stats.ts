export interface QueryArgs {
    identifier?: string;
    secs?: number;
    keys?: Array<string>;
    values?: Array<string>;
    cacheKey?: string;
    cacheTtl?: number;
}

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

export const queryIdentifier = {
    countries: 'countries',
    history: 'history',
    mergedPlayerTypes: 'mergedPlayerTypes',
    os: 'os',
    players: 'players',
    playerCount: 'playerCount',
    playerModels: 'playerModels',
    playerTypes: 'playerTypes',
    plugins: 'plugins',
    trackCounts: 'trackCounts',
    versions: 'versions'
}

// How far back do we go to consider an installation active?
export const ACTIVE_INTERVAL = 86400 * 30
const MAX_HISTORY_BINS = 90
const DEFAULT_CACHE_TTL = 7200
const PLUGINS_CACHE_TTL = 23.5 * 3600   // not quite a day, to make sure we are fresh when running the daily snapshot

export class StatsDb {
    db: any;
    qc: any;

    constructor(db: any, queryCache: any) {
        this.db = db
        this.qc = queryCache
    }

    private getConditions(secs: number = 0, keys: Array<string> = []): string {
        let condition = (secs > 0)
            ? 'WHERE UNIXEPOCH(DATETIME()) - UNIXEPOCH(lastseen) < ?'
            : 'WHERE 1 > ?'

        for (let i = 0; i < keys.length; i++) {
            condition += ` AND JSON_EXTRACT(data, '$.${keys[i]}') = ?`
        }

        return condition
    }

    private getCacheKey(args: QueryArgs): string {
        args.cacheKey = args.cacheKey || [
            args.identifier,
            args.secs || 0,
            args.keys?.sort().join(':'),
            args.values?.sort().join(':')
        ].join('-')

        return args.cacheKey
    }

    private async cacheResults(data: ValueCountsObject[], args: QueryArgs): Promise<any> {
        await this.qc.put(this.getCacheKey(args), JSON.stringify(data), { expirationTtl: args.cacheTtl || DEFAULT_CACHE_TTL })
        return data
    }

    private async getStats(args: QueryArgs, groupIdentifier: string, castNumbers?: boolean): Promise<ValueCountsObject[]> {
        const { secs = 0, keys = [], values = [] } = args

        let groupBy = `JSON_EXTRACT(data, '$.${groupIdentifier}')`
        if (castNumbers) groupBy = `CAST (${groupBy} AS string)`

        const { results } = await this.db.prepare(`
            SELECT JSON_EXTRACT(data, '$.${groupIdentifier}') AS v, COUNT(1) AS c
            FROM servers
            ${ this.getConditions(secs, keys) }
            GROUP BY ${groupBy}
            ORDER BY c DESC;
        `).bind(secs, ...values).all()

        return this.cacheResults(results.map((item: ValueCountsObject) => { return { [item.v]: item.c } }), args)
    }

    async getTrackCountBinsC(args: QueryArgs) {
        return await this.withCache(this.getTrackCountBins, { identifier: queryIdentifier.trackCounts, ...args })
    }

    async getTrackCountBins(args: QueryArgs): Promise<ValueCountsObject[]> {
        const { secs = 0, keys, values = [] } = args

        const { results } = await this.db.prepare(`
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
                    ${ this.getConditions(secs, keys) }
                )
            )
            GROUP BY v
            ORDER BY v;
        `).bind(secs, ...values).all()

        return this.cacheResults(results.map((item: ValueCountsObject) => { return { [item.v]: item.c } }), { identifier: queryIdentifier. trackCounts, ...args })
    }

    async getVersionsC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getVersions, { identifier: queryIdentifier.versions, ...args })
    }

    async getVersions(args: QueryArgs): Promise<ValueCountsObject[]> {
        return this.getStats({ identifier: queryIdentifier.versions, ...args }, 'version')
    }

    async getCountriesC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getCountries, { identifier: queryIdentifier.countries, ...args })
    }

    async getCountries(args: QueryArgs): Promise<ValueCountsObject[]> {
        return this.getStats({ identifier: queryIdentifier.countries, ...args }, 'country')
    }

    async getPlayersC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getPlayers, { identifier: queryIdentifier.players, ...args })
    }

    async getPlayers(args: QueryArgs): Promise<ValueCountsObject[]> {
        return this.getStats({ identifier: queryIdentifier.players, ...args }, 'players', true)
    }

    async getPlayerCountC(args: QueryArgs): Promise<number> {
        return await this.withCache(this.getPlayerCount, { identifier: queryIdentifier.playerCount, ...args })
    }

    async getPlayerCount(args: QueryArgs): Promise<number> {
        const { secs = 0, keys = [], values = [] } = args

        const { results } = await this.db.prepare(`
            SELECT SUM(JSON_EXTRACT(data, '$.players')) AS p
            FROM servers
            ${ this.getConditions(secs, keys) }
        `).bind(secs, ...values).all()

        return this.cacheResults(results[0].p, {identifier: queryIdentifier.playerCount, ...args }) as Promise<number>
    }

    async getPlayerTypesC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getPlayerTypes, { identifier: queryIdentifier.playerTypes, ...args })
    }

    async getPlayerTypes(args: QueryArgs): Promise<ValueCountsObject[]> {
        const { secs = 0, keys = [], values = [] } = args

        const { results: playerTypes } = await this.db.prepare(`
            SELECT model AS v, SUM(count) AS c
            FROM (
                SELECT key AS model, value AS count, type, path
                FROM servers, JSON_TREE(data, '$.playerTypes')
                ${ this.getConditions(secs, keys) }
            )
            WHERE type = 'integer' AND path = '$.playerTypes'
            GROUP BY model
            ORDER BY c DESC;
        `).bind(secs, ...values).all()

        return this.cacheResults(playerTypes.map((item: ValueCountsObject) => {
            return { [item.v]: item.c }
        }), { identifier: queryIdentifier.playerTypes, ...args })
    }

    async getPlayerModelsC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getPlayerModels, { identifier: queryIdentifier.playerModels, ...args })
    }

    async getPlayerModels(args: QueryArgs): Promise<ValueCountsObject[]> {
        const { secs = 0, keys = [], values = [] } = args

        const { results: playerModels } = await this.db.prepare(`
            SELECT model AS v, SUM(count) AS c
            FROM (
                SELECT key AS model, value AS count, type, path
                FROM servers, JSON_TREE(data, '$.playerModels')
                ${ this.getConditions(secs, keys) }
            )
            WHERE type = 'integer' AND path = '$.playerModels'
            GROUP BY model
            ORDER BY c DESC;
        `).bind(secs, ...values).all()

        return this.cacheResults(playerModels.map((item: ValueCountsObject) => {
            return { [item.v]: item.c }
        }), { identifier: queryIdentifier.playerModels, ...args })
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
    async getMergedPlayerTypesC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getMergedPlayerTypes, { identifier: queryIdentifier.mergedPlayerTypes, ...args })
    }

    async getMergedPlayerTypes(args: QueryArgs): Promise<ValueCountsObject[]> {
        const { secs = 0, keys = [], values = [] } = args

        const { results: playerTypes } = await this.db.prepare(`
            SELECT JSON_TREE.key AS v, SUM(JSON_TREE.value) AS c
            FROM (
                SELECT JSON_TREE.value AS value
                FROM (
                    SELECT CASE
                        WHEN data LIKE '%playerModels%' THEN JSON_OBJECT('playerTypes', JSON_EXTRACT(data, '$.playerModels'))
                        ELSE JSON_OBJECT('playerTypes', JSON_EXTRACT(data, '$.playerTypes'))
                    END AS data
                    FROM servers
                    ${ this.getConditions(secs, keys) }
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
            const k = this.mapPlayerType(item.v as string)
            accumulator[k] = (accumulator[k] || 0) + item.c
            return accumulator
        }, {})

        return this.cacheResults(Object.keys(regroupPlayerTypes).sort((a, b) => {
            return regroupPlayerTypes[b] - regroupPlayerTypes[a]
        }).map((k: string) => {
            return { [k]: regroupPlayerTypes[k] } as ValueCountsObject
        }), { identifier: queryIdentifier.mergedPlayerTypes, ...args })
    }

    private mapPlayerType(player: string): string {
        player = playerTypesMap[(player as string).toLowerCase()] || player

        // this seems to be created dynamically, can't be mapped statically
        if (player.match(/ropi.*ee/i)) player = 'Ropieee'
        else if (player.match(/^Aroio/)) player = 'AroioOS'
        else if (player.match(/^Yulong/)) player = 'Yulong'
        else if (player.match(/^Topping/)) player = 'Topping'
        else if (player.match(/^MusicServer4|MS4H/i)) player = 'MusicServer4(Home|Loxone)'

        return player
    }

    async getOSC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getOS, { identifier: queryIdentifier.os, ...args })
    }

    async getOS(args: QueryArgs): Promise<ValueCountsObject[]> {
        const { secs = 0, keys = [], values = [] } = args

        const { results: os } = await this.db.prepare(`
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
                    ${ this.getConditions(secs, keys) }
                )
            )
            WHERE os NOT NULL
            GROUP BY os, platform
            ORDER BY c DESC;
        `).bind(secs, ...values).all()

        return this.cacheResults(os.map((item: ValueCountsObject) => { return { [item.v]: item.c } }), { identifier: queryIdentifier.os, ...args })
    }

    async getPluginsC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getPlugins, { identifier: queryIdentifier.plugins, ...args })
    }

    async getPlugins(args: QueryArgs): Promise<ValueCountsObject[]> {
        const { secs = 0, keys = [], values = [] } = args

        const { results: plugins } = await this.db.prepare(`
            SELECT * FROM (
                SELECT COUNT(1) AS c, JSON_EACH.value AS v
                FROM servers, JSON_EACH(data, '$.plugins')
                ${ this.getConditions(secs, keys) }
                GROUP BY JSON_EACH.value
            )
            WHERE c > 5
            ORDER BY c DESC
        `).bind(secs, ...values).all()

        return this.cacheResults(plugins.map((item: ValueCountsObject) => {
            return { [item.v]: item.c }
        }), {
            identifier: queryIdentifier.plugins,
            cacheTtl: args.cacheTtl || PLUGINS_CACHE_TTL,
            ...args
        })
    }

    async getHistoryC(args: QueryArgs): Promise<ValueCountsObject[]> {
        return await this.withCache(this.getHistory, { identifier: queryIdentifier.history, ...args })
    }

    async getHistory(args: QueryArgs): Promise<Object[]> {
        const { results } = await this.db.prepare(`
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

        return this.cacheResults(results, { identifier: queryIdentifier.history, ...args })
    }

    async withCache(handler: (args: QueryArgs) => Promise<ValueCountsObject[] | Object | number>, args: QueryArgs): Promise<any> {
        const cacheKey = this.getCacheKey(args)
        let response

        try {
            const cached = await this.qc.get(cacheKey)
            response = JSON.parse(cached)
        }
        catch(e) {
            console.warn(`failed to parse query cache: ${e}`)
        }

        return response || await handler.call(this, args)
    }
}