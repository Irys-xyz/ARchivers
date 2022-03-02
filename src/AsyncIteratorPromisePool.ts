/**
 * Promise pool but with additional async iterator ingest capabilities for batch processing
 * currently doesn't save output, but can be easily modified to do so.
 * more done just as a learning experience 
 */

export default class AsyncIterPromisePool {
    private iterator: any[] | AsyncIterable<any>
    private processing = []
    private concurrency: number
    private handler: (any) => Promise<any>
    private preprocessor = async (i) => { return i }


    constructor(iterator: AsyncIterable<any>, handler: (any) => Promise<any>, concurrency?: number, preprocessor?: (any) => Promise<any>) {
        this.iterator = iterator
        this.handler = handler
        this.concurrency = concurrency ?? 10
        if (preprocessor) {
            this.preprocessor = preprocessor
        }
    }

    private removeFinished(task) {
        this.processing.splice(
            this.processing.indexOf(task), 1
        )
    }


    async processItem(item) {
        const task = this.handler(item)
            .then(_ => {
                this.removeFinished(task);
                return
            })
            .catch(e => {
                console.log(e);
                this.removeFinished(task);
                return;
            })
        this.processing.push(task)
    }

    async startProcessing() {
        for await (const item of this.iterator) {
            if (this.processing.length >= this.concurrency) {
                await Promise.race(this.processing)
            }
            this.processItem(await this.preprocessor(item))
        }
        return await Promise.allSettled(this.processing)
    }
}
