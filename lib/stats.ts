export interface StatsSummary {
    versions?: string[];
    countries?: string[];
    os?: string[];
    players?: number;
    plugins?: {
        names: string;
        counts: number;
    };
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

    const { results: os } = await db.prepare(`
        SELECT COUNT(1) AS c, (os || " - " || platform) AS v
        FROM (
            SELECT CASE WHEN osname LIKE '%windows%' THEN 'Windows' ELSE
                CASE WHEN osname LIKE '%macos%' THEN 'macOS' ELSE osname END
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
