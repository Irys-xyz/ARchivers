import Twitter from "node-tweet-stream";
import Bundlr from "@bundlr-network/client"
import tmp from "tmp-promise"
import * as p from "path"
import { mkdir } from "fs/promises";
import { PathLike, promises, readFileSync } from "fs";
import { createWriteStream } from "fs";
import axios from "axios"
import ARticle from "./ARticle";
import Arweave from "arweave";
import FundPool from "@bundlr-network/hero-funds"
import mime from "mime-types";

let TPS = 0;
let pTPS = 0
setInterval(() => {
    console.log(`TPS: ${TPS} - pTPS: ${pTPS}`); TPS = 0; pTPS = 0
}, 1000)

const checkPath = async (path: PathLike): Promise<boolean> => { return promises.stat(path).then(_ => true).catch(_ => false) }

async function* walk(dir: string) {
    for await (const d of await promises.opendir(dir)) {
        const entry = p.join(dir, d.name);
        if (d.isDirectory()) yield* await walk(entry);
        else if (d.isFile()) yield entry;
    }
}

let twitter
let bundlr: Bundlr
let pool: FundPool
let article: ARticle
let config;

async function main() {
    config = JSON.parse(readFileSync("config.json").toString());
    const keys = JSON.parse(readFileSync(config.walletPath).toString());

    twitter = new Twitter({
        consumer_key: keys.tkeys.consumer_key,
        consumer_secret: keys.tkeys.consumer_secret,
        token: keys.tkeys.token,
        token_secret: keys.tkeys.token_secret,
        tweet_mode: "extended"
    })
    bundlr = new Bundlr(config.bundlrNode, "arweave", keys.arweave)

    console.log(`Loaded with account address: ${bundlr.address}`)
    const arweave = Arweave.init({
        host: "arweave.net",
        port: 443,
        protocol: "https",
        timeout: 20000,
        logging: false,
    });



    pool = new FundPool(config.pool.contract, arweave, true);
    article = new ARticle(config)
    console.log(`Loading archiving pool :${config.poolContract}`);

    twitter.on('tweet', processTweet);

    twitter.on('error', (e) => {
        console.error(`tStream error: ${e.stack}`)
    })
    const trackKeyWords = config.keywords
    const trackUsers = config.userIDs
    console.log(`Tracking key words: ${trackKeyWords}`);
    console.log(`Tracking users: ${trackUsers}`)
    twitter.track(trackKeyWords)
    twitter.follow(trackUsers)
}


async function processTweet(tweet) {
    const tmpdir = await tmp.dir({ unsafeCleanup: true })

    try {
        TPS++
        if (tweet.retweeted_status) { //retweet, ignore.
            return;
        }

        /**
         * Application: twittAR
         * Author-ID: author ID: int
         * Tweet-ID: tweet ID: int
         * Media-Manifest-ID: media manifest ID: int
         * Key-Word-List: keyword set : string
         */

        let tags = [
            { name: "Application", value: "TwittAR" },
            { name: "Tweet-ID", value: `${tweet.id_str ?? "unknown"}` },
            { name: "Author-ID", value: `${tweet.user.id_str ?? "unknown"}` },
            { name: "Author-Name", value: `${tweet.user.name ?? "unknown"}` },
            { name: "Author-Handle", value: `@${tweet.user.screen_name ?? "unknown"}` },
            { name: "Content-Type", value: "application/x.arweave-manifest+json" },
            { name: "Key-Word-List", value: `${config.keywordListID ?? "unknown"}` },
            { name: "Key-Word-List-Version", value: `${config.keywordListVersion ?? "unknown"}` },
            { name: "Type", value: "manifest" }
        ];

        const nftTags = await pool.getNftTags("TwittAR", tweet.id_str ?? "unknown", false);
        tags = tags.concat(nftTags);

        if (tweet?.in_reply_to_status_id) {
            tags.push({ name: "In-Response-To-ID", value: `${tweet.in_reply_to_status_id_str ?? "unknown"}` })
        }

        if (tweet?.extended_entities?.media?.length > 0) {
            try {
                const mediaDir = p.join(tmpdir.path, "media")
                if (!await checkPath(mediaDir)) {
                    await mkdir(mediaDir)
                }
                for (let i = 0; i < tweet.extended_entities.media.length; i++) {
                    const mobj = tweet.extended_entities.media[i]
                    const url = mobj.media_url
                    if ((mobj.type === "video" || mobj.type === "animated_gif") && mobj?.video_info?.variants) {
                        const variants = mobj?.video_info?.variants.sort((a, b) => ((a.bitrate ?? 1000) > (b.bitrate ?? 1000) ? -1 : 1))
                        await processMediaURL(variants[0].url, mediaDir, i)
                    } else {
                        await processMediaURL(url, mediaDir, i)
                    }
                }
            } catch (e) {
                console.error(`while archiving media: ${e.stack}`)
            }

        }

        if (tweet.entities.urls?.length > 0) {
            try {
                for (let i = 0; i < tweet.entities.urls.length; i++) {
                    const u = tweet.entities.urls[i]
                    const url = u.expanded_url
                    // tweets sometimes reference themselves
                    if (url === `https://twitter.com/i/web/status/${tweet.id_str}`) {
                        continue;
                    }
                    const headres = await axios.head(url).catch((e) => {
                        console.log(`heading ${url} - ${e.message}`)
                    })
                    if (!headres) { continue }
                    const contentType = headres.headers["content-type"]?.split(";")[0]?.toLowerCase() ?? "text/html"
                    const linkPath = p.join(tmpdir.path, `/links/${i}`)
                    if (!await checkPath(linkPath)) {
                        await mkdir(linkPath, { recursive: true })
                    }
                    // if it links a web page:
                    if (contentType === "text/html") {
                        // add to article DB.
                        console.log(`ignoring urls`)
                    } else {
                        await processMediaURL(url, linkPath, i)
                    }
                }
            } catch (e) {
                console.error(`While processing URLs: ${e.stack ?? e.message}`)
            }

        }
        // // if the tweet had some attachments, upload the tmp folder containing said media/site snapshots.
        // if (tmpdir) {
        // upload dir
        // const mres = await bundlr.uploader.uploadFolder(tmpdir.path, null, 10, false, async (_) => { })
        const manifest = {
            manifest: "arweave/paths",
            version: "0.1.0",
            index: {},
            paths: {}
        }

        const subTags = [
            { name: "Application", value: "TwittAR" },
            { name: "Tweet-ID", value: `${tweet.id_str ?? "unknown"}` }
        ]

        for await (const f of walk(tmpdir.path)) {
            const relPath = p.relative(tmpdir.path, f)
            try {
                const mimeType = mime.contentType(mime.lookup(relPath) || "application/octet-stream") as string
                const res = await bundlr.uploader.upload(await promises.readFile(p.resolve(f)), subTags.concat([{ name: "Content-Type", value: mimeType }]))
                if (!res?.data?.id) { throw new Error("Upload Error") }
                manifest.paths[relPath] = { id: res?.data?.id }
            } catch (e) {
                console.log(`Error uploading ${f} for ${tweet.id_str} - ${e}`)
                continue
            }

        }
        const tweetRes = await bundlr.uploader.upload(Buffer.from(JSON.stringify(tweet)), subTags.concat([{ name: "Content-Type", value: "application/json" }]))
        if (!tweetRes?.data?.id) {
            console.log(`Error uploading tweet ${tweet.id_str}`)
            return
        }
        manifest.paths["tweet.json"] = { id: tweetRes?.data?.id }
        manifest.index = { path: "tweet.json" }


        // if (mres && mres != "none") {
        //     tags.push({ name: "Media-Manifest-ID", value: `${mres}` })
        //     console.log(`https://node1.bundlr.network/tx/${mres}/data`)
        // }
        console.log(manifest)

        const manifestRes = await bundlr.uploader.upload(Buffer.from(JSON.stringify(manifest)), tags)
        console.log(manifestRes)
        await tmpdir.cleanup()
        pTPS++

    } catch (e) {
        console.log(`general error: ${e.stack ?? e.message}`)
        if (tmpdir) {
            await tmpdir.cleanup()
        }
    }
}


export async function processMediaURL(url: string, dir: string, i: number) {
    return new Promise(async (resolve, reject) => {
        const ext = url?.split("/")?.at(-1)?.split(".")?.at(1)?.split("?").at(0) ?? "unknown"
        const wstream = createWriteStream(p.join(dir, `${i}.${ext}`))
        const res = await axios.get(url, {
            responseType: "stream"
        }).catch((e) => {
            console.log(`getting ${url} - ${e.message}`)
        })
        if (!res) { return }
        await res.data.pipe(wstream) // pipe to file
        wstream.on('finish', () => {
            resolve("done")
        })
        wstream.on('error', (e) => {
            reject(e)
        })
    })

}
main();
