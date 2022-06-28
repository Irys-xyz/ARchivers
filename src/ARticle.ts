import axios from "axios"
import { CronJob } from "cron";

import crypto from "crypto"
import { PathLike, readFileSync, promises } from "fs";
import { pageArchiver } from "./pageArchiver";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { compareTwoStrings } from "string-similarity"
import Bundlr from "@bundlr-network/client";
import Arweave from "arweave"

import knex, { Knex } from "knex";
import AsyncIterPromisePool from "./AsyncIteratorPromisePool";
import { FundingPool } from "@bundlr-network/hero-funds"
import { Warp, WarpNodeFactory } from "warp-contracts";
import { getNextNFTId } from "./lock";


export const checkPath = async (path: PathLike): Promise<boolean> => { return stat(path).then(_ => true).catch(_ => false) }

interface archiveRow {
  url: string,
  lastCheck: string,
  firstCheck: string,
  normalisedDiff: number,
  updates: number,
  lastUpdate: string
}

export default class ARticle {

  private keys
  private db: Knex
  private bundlr: Bundlr
  protected instances: number;
  private query: string
  private diff: number
  refreshPeriod: string;
  keywordListID: string
  pool: FundingPool
  config: Record<string, any>
  id: number
  warp: Warp
  keywordListVersion: string;



  constructor(config: { instances: number, query: string, walletPath: string, bundlrNode: string, difference: number, refreshPeriod: string, queryID: string, keywordListID: string, pool: { contract: string, transferable: string }, nftContractSrc: string, keywordListVersion: string }) {
    this.config = config;
    this.instances = config.instances;
    this.query = config.query;
    this.diff = config.difference
    this.refreshPeriod = config.refreshPeriod ?? `-4 hours`;
    // this.queryID = config.queryID ?? "unknown"
    this.keywordListID = config.keywordListID ?? "unknown"
    this.keywordListVersion = config.keywordListVersion ?? "unknown"

    const arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
      timeout: 20000,
      logging: false,
    });

    // const arweave = Arweave.init({
    //   host: "localhost",
    //   port: 1984,
    //   protocol: "http",
    //   timeout: 20000,
    //   logging: false,
    // });

    this.pool = new FundingPool({ poolId: config.pool.contract, arweave, nftContractSrc: config.nftContractSrc })

    this.db = knex({
      client: "better-sqlite3",
      connection: {
        filename: "./ARchiver.db",
        flags: []
      },
      asyncStackTraces: true,

    })

    // testing only!
    // this.warp = WarpNodeFactory.forTesting(arweave)


    // LoggerFactory.INST.logLevel('trace');
    // LoggerFactory.INST.logLevel("trace", "DefaultStateEvaluator");
    // LoggerFactory.INST.logLevel("trace", "HandlerBasedContract");
    // LoggerFactory.INST.logLevel("trace", "HandlerExecutorFactory");

    this.warp = WarpNodeFactory.memCached(arweave)

    this.keys = JSON.parse(readFileSync(config.walletPath).toString());
    this.bundlr = new Bundlr(config.bundlrNode, "arweave", this.keys.arweave)
    console.log(this.bundlr.address);
  }


  public async ready() {


    const idcachePath = "./.idcache"
    // check for file
    if (!await checkPath(idcachePath)) {
      // get number of artefacts uploaded by this pool
      console.error("Unable to restore ID from cache file!")
      await writeFile(idcachePath, "0")
    }

    this.id = +(await readFile(idcachePath)).toString()


    await this.db.raw(`PRAGMA journal_mode=WAL`);

    if (!await this.db.schema.hasTable('ARticle')) {
      console.log("regenerating table")
      await this.db.schema.createTable('ARticle', (tbl) => {
        tbl.string("url").primary().unique();
        tbl.date("lastCheck").defaultTo(new Date().toISOString().slice(0, 19).replace('T', ' ')).notNullable()
        tbl.date("firstCheck").defaultTo(new Date().toISOString().slice(0, 19).replace('T', ' ')).notNullable()
        tbl.date("lastUpdate").defaultTo(new Date().toISOString().slice(0, 19).replace('T', ' ')).notNullable()
        tbl.float("normalisedDiff").defaultTo(0).notNullable()
        tbl.integer("updates").defaultTo(0).notNullable()
      })
    }
    await this.db.raw(`PRAGMA main.auto_vacuum = 1`);
  }


  /**
 * Checks to see if a given URL has changed since last time it was requested - if it has, it will update the local copy and
 * upload the new version to arweave.
 * designed for use on articles, actually works on basically anything (provided proper modifications to pageArchiver are made)
 * @param url - URL to check
 */
  public async processURL(url: string): Promise<any> {
    try {
      let Url = url
      // check, add if missing, and then get DB entry for URL.
      const entry: archiveRow = await this.db("ARticle").select(["normalisedDiff", "updates", "lastUpdate"]).where('url', '=', Url).whereRaw(`lastCheck < Datetime('now', ? , 'localtime')`, [this.refreshPeriod]).first()

      if (!entry) { return "no entry" }

      // if (!((+new Date() - +entry.lastCheck) >= 1_800_000)) { // if it's been > 30mins since last check  continue
      //   console.log(`${url} was checked < 30 minutes ago, skipping...`)
      //   return;
      // }
      // if (((+new Date() - +entry.start) >= 2_592_000_000)) { // if it's been tracked for more than a month abort
      //   console.log("tracked for more than a month, stopping...")
      // }

      // if the last update was more than a month ago...
      if (((+new Date() - +entry.lastUpdate) >= 2_592_000_000)) {
        console.log(`Last update for ${Url} was > a month ago, removing from archival scanner...`)
        await this.db("ARticle").where("url", "=", Url).delete()
      }


      const [siteData, resolvedUrl] = await pageArchiver(Url)

      if (Url != resolvedUrl) {
        // check if another entry with this resolved URL exists.
        if (!await this.db("ARticle").select(["url"]).where('url', '=', Url)) {
          // remove this entry in favour of the existing one.
          await this.db("ARticle").where("url", "=", Url).delete()
          return;
          //   await this.db("ARticle").update("url", resolvedUrl).where("url", "=", Url) //.onConflict("*").ignore()
          //   const newHash = crypto.createHash('sha256').update(resolvedUrl).digest('hex');
          //   if (await checkPath(indexPath)) {
          //     await promises.rename(indexPath, `${storePath}/${newHash}.html`)
          //   }
          // }
          // indexPath = `${storePath}/${newHash}.html`
          // 
        } else {
          await this.db("ARticle").update("url", resolvedUrl).where("url", "=", Url)
        }
      }

      Url = resolvedUrl

      // get storage hash ID
      const storeHash = crypto.createHash('sha256').update(Url).digest('hex');
      console.log(`URL:SH ${Url} : ${storeHash}`)
      const storePath = "./sites" // TODO: configurable
      let indexPath = `${storePath}/${storeHash}.html`

      if (!await checkPath(storePath)) {
        await mkdir(storePath, { recursive: true })
      };

      const indexPresent = await checkPath(indexPath)
      let cachedData;
      if ((!indexPresent) || entry.updates % 5 === 0) {
        // re-calibrate difference if it's the "5th" update
        // perform another query to get the average difference between pages regardless of critical content change.
        let [siteData2, _] = await pageArchiver(Url);
        entry.normalisedDiff = await compareTwoStrings(siteData, siteData2)
        siteData2 = ""; //wipe it
        // console.log(`normDiff: ${entry.normalisedDiff}`)
        await writeFile(indexPath, siteData)
        cachedData = siteData
      }
      if (indexPresent) {
        cachedData = await readFile(indexPath, { encoding: "utf8" })
      }

      const diffVal = await compareTwoStrings(siteData, cachedData);
      let relativeDiff = Math.abs(diffVal - entry.normalisedDiff)

      // console.log(`relDiff: ${relativeDiff}`);

      // if (relativeDiff < this.diff) { // must be at least 2% different 
      //   console.log(`${Url} was not different enough from saved copy (${relativeDiff}).. assuming no changes.`)
      //   return "not different enough"
      // } else {

      console.log(`Update detected for ${Url} - RD: ${relativeDiff}`)
      entry.updates++;
      //entry.lastCheck = new Date();
      await writeFile(indexPath, siteData)

      let tags = [
        { name: "Application", value: "ARticle" },
        { name: "Key-Word-List", value: `${this.keywordListID}` },
        { name: "Key-Word-List-Version", value: `${this.keywordListVersion ?? "unknown"}` },
        { name: "URL", value: `${Url}` }
      ];


      const manifest = {
        manifest: "arweave/paths",
        version: "0.1.0",
        index: {},
        paths: {}
      }

      const dataTx = this.bundlr.createTransaction(siteData, { tags: [...tags, { name: "Content-Type", value: "text/html" }] })
      await dataTx.sign()
      const dataTxRes = await dataTx.upload()

      manifest.paths["index.html"] = { id: dataTxRes.data.id }
      manifest.index = { path: "index.html" }


      const { tags: nftTags, initState } = await this.pool.getNftData((await getNextNFTId()).toString(), this.config.pool.transferable ?? false)
      tags = tags.concat(nftTags)
      tags.push({ name: "Type", value: "manifest" })


      const txRes = await this.warp.createContract.deployFromSourceTx({
        srcTxId: this.pool.nftContractSrc,
        wallet: this.keys.arweave,
        initState: JSON.stringify(initState),
        data: { "Content-Type": "application/x.arweave-manifest+json", body: JSON.stringify(manifest) },
        tags
      }, true)

      // const tx = this.bundlr.createTransaction(siteData, { tags })
      // await tx.sign()
      // const txRes = await tx.upload()

      console.log(`Uploaded ${Url} to ${txRes}`)
      // }
      await this.db("ARticle").where('url', '=', Url).update({ updates: entry.updates, lastCheck: new Date().toISOString().slice(0, 19).replace('T', ' '), normalisedDiff: entry.normalisedDiff })
      return "done";
    } catch (err) {
      console.log(`Error processing URL ${url} - ${JSON.stringify(err)}`)
    }
  }

  public async addUrl(url) {
    await this.db("ARticle").insert({ url }).onConflict("url").ignore()
  }

  private async getNextArtefactId(): Promise<number> {
    let id = ++this.id
    await writeFile("./.idcache", id.toString())
    return id
  }

  public async updateNewsApi(customDate = new Date()) {
    const d1 = customDate.getDate() - 1
    const date = new Date(new Date().setDate(d1)) //seriously JS?
    const yearMonthDay = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; // 0 indexed months
    // should be retrieved every ~ 30 minutes
    let res = await axios.get(`https://newsapi.org/v2/everything?q=${this.query}&from=${yearMonthDay}&sortBy=publishedAt&pageSize=100&apiKey=${this.keys.newsapi}`)
    if (res.status != 200) {
      console.error(`Error getting newsAPI articles - ${res.statusText}`)
    }
    console.log(`adding ${res.data.articles.length} articles to the pool...`);
    const articles = res?.data?.articles ?? [];

    for (let i = 0; i < articles.length; i++) {
      await this.addUrl(articles[i].url)
    }
    // await res.data.articles.forEach(async (a) => {
    //   await this.addUrl(a.url)
    // })
    console.log(`Added articles`)
  }


  async update() {

    const source = async function* () {
      const count = (await this.db("ARticle").count("*").first())["count(*)"]
      for (let i = 0; i < count; i++) {
        const r = await this.db("ARticle").select().offset(i).limit(1)
        yield r[0]
      }
    }.bind(this) // allow access to class methods

    const preprocessor = async (i) => {
      return i?.url ?? "https://bbc.co.uk"
    }//.bind(this)

    console.log(`Processing...`)
    const urls = source.call()
    console.log((await this.db("ARticle").count("*").first())["count(*)"], "many URLS")
    const pool = new AsyncIterPromisePool(urls, this.processURL.bind(this), this.instances, preprocessor)
    await pool.startProcessing();
  }
}


export function createCron(name: string, time: string, fn: () => Promise<void>): void {
  let jobLocked = false;
  new CronJob(
    time,
    async function () {
      if (!jobLocked) {
        jobLocked = true;
        await fn()
          .catch(e => console.error(`Error occurred while doing ${name} - ${e}`));
        jobLocked = false;
      } else {
        console.warn(`job for ${name} locked`);
      }
    },
    null,
    true
  ).start()
}

process.on('unhandledRejection', (reason, p) => {
  console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
});


export async function init(configPath) {
  const config = JSON.parse(readFileSync(configPath).toString());
  const article = new ARticle(config)
  await article.ready();
  createCron("update sources", "0 */3 * * * *", () => article.updateNewsApi())
  createCron("scan for changes", "0 */1 * * * *", () => article.update())
  console.log("cron init done")
  await article.updateNewsApi()
  // await article.update();
}


if (typeof require !== 'undefined' && require.main === module) { // eqv. of pythons name == main 
  init("./config.json");
}
