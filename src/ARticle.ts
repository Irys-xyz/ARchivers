import axios from "axios"
import { CronJob } from "cron";

import crypto from "crypto"
import { PathLike, readFileSync } from "fs";
import { pageArchiver } from "./pageArchiver";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { compareTwoStrings } from "string-similarity"
import Bundlr from "@bundlr-network/client";

import pLimit from "p-limit";

import knex, { Knex } from "knex";

export const checkPath = async (path: PathLike): Promise<boolean> => { return stat(path).then(_ => true).catch(_ => false) }
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface archiveRow {
  url: string,
  lastCheck: string,
  firstCheck: string,
  normalisedDiff: number,
  updates: number
}

export default class ARticle {

  private keys
  private db: Knex
  private bundlr
  protected instances: number;
  private query: string
  private diff: number



  constructor(config: { instances: number, query: string, walletPath: string, bundlrNode: string, difference: number }) {
    this.instances = config.instances;
    this.query = config.query;
    this.diff = config.difference

    this.db = knex({
      client: "better-sqlite3",
      connection: {
        filename: "./ARchiver.db",
        flags: []
      },
      asyncStackTraces: true,

    })

    this.keys = JSON.parse(readFileSync(config.walletPath).toString());
    this.bundlr = new Bundlr(config.bundlrNode, "arweave", this.keys.arweave)
    console.log(this.bundlr.address);
  }


  public async ready() {
    await this.db.raw(`PRAGMA journal_mode=WAL`);

    if (!await this.db.schema.hasTable('ARticle')) {
      console.log("regenerating table")
      // 2022-02-21 18:25:13
      await this.db.schema.createTable('ARticle', (tbl) => {
        tbl.string("url").primary().unique();
        tbl.date("lastCheck").defaultTo(new Date().toISOString().slice(0, 19).replace('T', ' ')).notNullable()
        tbl.date("firstCheck").defaultTo(new Date().toISOString().slice(0, 19).replace('T', ' ')).notNullable()
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
  async processURL(url): Promise<any> {
    // check, add if missing, and then get DB entry for URL.
    const entry: archiveRow = await this.db("ARticle").select(["normalisedDiff", "updates"]).where('url', '=', url).whereRaw(`lastCheck < Datetime('now', '-3 minutes', 'localtime')`).first();

    if (!entry) { return }

    // if (!((+new Date() - +entry.lastCheck) >= 1_800_000)) { // if it's been > 30mins since last check  continue
    //   console.log(`${url} was checked < 30 minutes ago, skipping...`)
    //   return;
    // }
    // if (((+new Date() - +entry.start) >= 2_592_000_000)) { // if it's been tracked for more than a month abort
    //   console.log("tracked for more than a month, stopping...")
    // }

    // get storage hash ID
    const storeHash = crypto.createHash('sha256').update(url).digest('hex');
    console.log(`URL:SH ${url} : ${storeHash}`)
    const storePath = "./sites" // TODO: configurable
    const indexPath = `${storePath}/${storeHash}.html`

    if (!await checkPath(storePath)) {
      await mkdir(storePath, { recursive: true })
    };

    const siteData = await pageArchiver(url)
    const indexPresent = await checkPath(indexPath)
    let cachedData;
    if ((!indexPresent) || entry.updates % 5 === 0) {
      // re-calibrate difference if it's the "5nth" update
      // perform another query to get the average difference between pages regardless of critical content change.
      let siteData2 = await pageArchiver(url);
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
    const relativeDiff = Math.abs(diffVal - entry.normalisedDiff)
    // console.log(`relDiff: ${relativeDiff}`);
    if (relativeDiff < this.diff) { // must be at least 2% different 
      console.log(`${url} was not different enough from saved copy (${relativeDiff}).. assuming no changes.`)
      return
    } else {
      console.log(`Update detected for ${url} - RD: ${relativeDiff}`)
      entry.updates++;
      //entry.lastCheck = new Date();
      await writeFile(indexPath, siteData)

      const tags = [
        { name: "Application", value: "ARticle" },
        { name: "Content-Type", value: "text/html" },
        { name: "Query-ID", value: "ukraine1" },
        { name: "URL", value: `${url}` }
      ];
      const tx = await this.bundlr.createTransaction(siteData, { tags })
      await tx.sign();
      await tx.upload()
      console.log(`Uploaded ${url} to ${tx.id}`)
    }
    await this.db("ARticle").where('url', '=', url).update({ updates: entry.updates, lastCheck: new Date().toISOString().slice(0, 19).replace('T', ' '), normalisedDiff: entry.normalisedDiff })
    return;


  }

  public async addUrl(url) {
    await this.db("ARticle").insert({ url }).onConflict("url").ignore()
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
    await res.data.articles.forEach(async (a) => {
      await this.addUrl(a.url)
    })
    console.log(`Added articles`)
  }

  async update() {
    const limit = pLimit(this.instances)
    let toProcess = []
    const urls = this.db("ARticle").select("url").stream();
    for await (const { url } of urls) {
      toProcess.push(
        limit(() => this.processURL(url))
      )
    }
    console.log(`Processing...`)
    await Promise.allSettled(toProcess)

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
  // await article.updateNewsApi("ukraine");
  // await article.update();
  createCron("update sources", "0 */3 * * * *", () => article.updateNewsApi())
  createCron("scan for changes", "0 */1 * * * *", () => article.update())
  console.log("cron init done")
  //await article.update();
}


if (typeof require !== 'undefined' && require.main === module) { // eqv. of pythons name == main 
  init("./config.json");
}
