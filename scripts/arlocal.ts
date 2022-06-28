import Arweave from "arweave"
import { readFileSync } from "fs"
import { SourceImpl, WarpNodeFactory } from "warp-contracts"

(async function () {
    const keys = JSON.parse(readFileSync("./wallet.json", { encoding: "utf-8" }))

    const arweave = Arweave.init({
        host: "localhost",
        port: 1984,
        protocol: "http",
        timeout: 20000,
        logging: false,
    });

    const warp = WarpNodeFactory.forTesting(arweave)

    const wallet = keys.arweave
    const mine = () => arweave.api.get("mine");

    const address = await arweave.wallets.getAddress(wallet)
    await arweave.api.get(`/mint/${address}/99999999999999999`)
    const tmpWallet = await arweave.wallets.generate()
    await arweave.api.get(`/mint/${await arweave.wallets.getAddress(tmpWallet)}/99999999999999999`)


    await mine()
    // deploy 
    const commonPath = "./node_modules/@bundlr-network/hero-funds/build/contracts/"

    const src = new SourceImpl(arweave)
    const nftSrc = readFileSync(commonPath + "NFT/contract.js", "utf8")
    const nft = await src.save({ src: nftSrc }, tmpWallet)
    const poolSrc = readFileSync(commonPath + "pool/contract.js", "utf8")
    const initState = JSON.parse(readFileSync(commonPath + "pool/init.json", "utf8"))

    const poolOwner = await arweave.wallets.generate()
    const poolOwnerAddress = await arweave.wallets.getAddress(poolOwner)
    initState.owner = poolOwnerAddress

    const contractTxId = await warp.createContract.deploy({
        wallet: tmpWallet,
        initState: JSON.stringify(initState),
        src: poolSrc
    });

    await mine()

    const holder = await arweave.wallets.generate()
    await arweave.api.get(`/mint/${await arweave.wallets.getAddress(holder)}/99999999999999999`)

    await mine()

    const conInteractor = warp.contract(contractTxId).connect(holder);

    await conInteractor.writeInteraction({
        function: "contribute"
    }, [], {
        target: poolOwnerAddress,
        winstonQty: `1000000`
    });

    await mine()

    console.log({ state: JSON.stringify((await conInteractor.readState()).state) })

    console.log({ pool: contractTxId, nft: nft.id })

})()