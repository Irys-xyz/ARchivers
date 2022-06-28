// @ts-ignore
import { readFile, writeFile } from "fs/promises";
import lockfile from "lockfile"
import { checkPath } from "./ARticle";

async function lock(path: string) {
    return new Promise(r => lockfile.lock(path, { wait: 10_000_000, poolPeriod: 1, stale: 10_000, retries: 10_000_000, retryWait: 1 }, r))
}

async function unlock(path: string) {
    return new Promise(r => lockfile.unlock(path, r))
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const idcachepath = "./idcache"

export async function getNextNFTId(): Promise<number> {
    if (!await checkPath(idcachepath)) {
        throw new Error("Unable to load NFT sequence from cache file!")
    }
    // const before = performance.now()
    await lock("./.idcachelock")
    // console.log(`Took ${performance.now() - before}ms `)
    const d = await readFile(idcachepath, { flag: "a+" })
    const newId = (+d) + 1
    console.log(newId)
    await writeFile(idcachepath, newId.toString(), { flag: "w" })
    // await unlock("./.idcachelock")
    return newId

}